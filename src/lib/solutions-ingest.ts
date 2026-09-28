/**
 * 풀이+답안 PDF 인제스트 — 교재 목록·업로드 다이얼로그의 풀이·답안 등록
 * (2026-09-02).
 *
 * 흐름: PDF 를 브라우저에서 쪽별 이미지로 렌더(pdfjs, 지연 로딩) →
 * 쪽마다 비전 OCR 로 손풀이·정답표를 구조화(parseSolutionsPdf) →
 * **테스트지 문항과 대조**(scanPaperProblems + compareSolutionsToPaper — 사용자
 * 요구: 문제수·풀이수·내용이 같은지 반드시 확인, 다르면 팝업) →
 * 확인되면 저장(saveSolutions): solutions/{pdfId}.json + p{n}.png.
 *
 * 저장이 끝나면 해설 서명(solutionsSignature)이 달라지므로, catch-up 이
 * 이 교재를 푼 학생들의 해당 문항만 골라 자동 재분석한다 (auto-grade 108차).
 *
 * ⚠️ 여기 프롬프트는 분석 캐시 서명과 무관하다 — 바꿔도 재분석은 업로드된
 * 해설 내용이 바뀔 때만 돈다.
 */
import { recognizeImage } from './api';
import { PAGE_PROMPT } from './solutions-prompt';
import { repairModelJson } from './json-repair';
import { detectPrintedProblems } from './problem-detect';
import {
  mergeSolutionPages,
  normalizeStage,
  type PaperProblemBrief,
  type SolutionPageParse,
  type SolutionsDoc,
} from './solutions';
import { invalidateSolutionsCache } from './solutions-io';
import { requireSupabase } from './supabase';
import { STROKES_BUCKET, downloadJsonObject, uploadJsonObject } from './strokes-io';
import { listPdfPagesFromIndex, usePaperStore } from '@/store/paper.store';

const MAX_PAGES = 20;

/** PDF → 쪽별 PNG dataURL (폭 ~1400px — 손글씨 OCR 에 충분한 해상도) */
async function renderPdfPages(
  file: File,
  onProgress: (note: string) => void,
): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const n = Math.min(doc.numPages, MAX_PAGES);
  const out: string[] = [];
  for (let i = 1; i <= n; i++) {
    onProgress(`페이지 렌더 ${i}/${n}`);
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1400 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas.toDataURL('image/png'));
  }
  return out;
}


async function parsePage(dataUrl: string): Promise<SolutionPageParse> {
  const { text } = await recognizeImage(dataUrl, PAGE_PROMPT);
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return JSON.parse(repairModelJson(cleaned)) as SolutionPageParse;
}

export type ParsedSolutions = {
  doc: SolutionsDoc;
  /** 쪽별 PNG dataURL — 저장 단계에서 올린다 */
  pages: string[];
  /** 단계별 문항 수 요약 — "계산력 8 · 1단계 8 …" */
  summary: string;
};

/** 풀이+답안 PDF 를 읽어 구조화한다 (저장 전 — 대조·팝업은 호출자 몫) */
export async function parseSolutionsPdf(
  file: File,
  onProgress: (note: string) => void,
): Promise<ParsedSolutions> {
  const pages = await renderPdfPages(file, onProgress);
  const parsed: SolutionPageParse[] = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress(`풀이 인식 ${i + 1}/${pages.length}`);
    // 한 쪽이 실패해도 나머지는 살린다 — 그 쪽만 빈 결과
    parsed.push(await parsePage(pages[i]).catch(() => ({}) as SolutionPageParse));
  }
  const doc = mergeSolutionPages(parsed, file.name);
  if (doc.problems.length === 0) {
    throw new Error(
      '해설에서 문항을 읽지 못했습니다 — 풀이+답안 PDF 가 맞는지 확인해 주세요.',
    );
  }
  const counts = new Map<string, number>();
  for (const p of doc.problems) {
    const k = p.stage ?? '단계 없음';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const summary = [...counts.entries()].map(([k, v]) => `${k} ${v}`).join(' · ');
  return { doc, pages, summary };
}

/** 구조화된 해설을 스토리지에 저장한다 (대조·확인이 끝난 뒤에만 부를 것) */
export async function saveSolutions(
  pdfId: number,
  parsed: ParsedSolutions,
  onProgress: (note: string) => void,
): Promise<void> {
  onProgress('저장 중');
  const supabase = requireSupabase();
  for (let i = 0; i < parsed.pages.length; i++) {
    const blob = await (await fetch(parsed.pages[i])).blob();
    const { error } = await supabase.storage
      .from(STROKES_BUCKET)
      .upload(`solutions/${pdfId}/p${i + 1}.png`, blob, {
        upsert: true,
        contentType: 'image/png',
        cacheControl: '0',
      });
    if (error) throw new Error(`해설 이미지 저장 실패: ${friendlyStorageError(error.message)}`);
  }
  try {
    await uploadJsonObject(`solutions/${pdfId}.json`, parsed.doc);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`해설 문서 저장 실패: ${friendlyStorageError(msg)}`);
  }
  invalidateSolutionsCache(pdfId);
}

/**
 * 스토리지 정책 에러를 사람이 읽을 문장으로. 2026-09-04 실사고:
 * `invalid input syntax for type uuid: "solutions"` — 학생 폴더용 옛 쓰기 정책이
 * 첫 폴더명을 무조건 ::uuid 로 캐스팅해 solutions/ 쓰기가 매번 터졌다(027 로 수정).
 * 원문만 보여주면 무엇을 해야 하는지 알 수 없다.
 */
function friendlyStorageError(msg: string): string {
  if (/invalid input syntax for type uuid/i.test(msg)) {
    return (
      '스토리지 쓰기 정책이 아직 옛 버전입니다 — supabase/027_storage_write_uuid_guard.sql 을 ' +
      '1회 실행하면 해결됩니다. (원문: ' + msg + ')'
    );
  }
  if (/row-level security|violates.*policy/i.test(msg)) {
    return '스토리지 쓰기 권한이 없습니다 — 선생님·관리자 계정인지 확인해주세요. (원문: ' + msg + ')';
  }
  return msg;
}

// ── 테스트지 문항 스캔 — 풀이+답안 대조용 ──────────────────────────────

type PaperScanCache = { v: 1; problems: PaperProblemBrief[] };
const scanCachePath = (pdfId: number) => `solutions/${pdfId}.paper-scan.json`;

/**
 * 테스트지(문제 PDF)의 전체 문항을 인식해 (단계, 번호, 지문 요약)으로 요약한다.
 * NGS 에 등록된 페이지 배경을 그대로 읽으므로 파일이 따로 필요 없다.
 * 결과는 교재 단위 캐시 — 같은 교재의 두 번째 대조부터는 호출이 없다.
 */
export async function scanPaperProblems(
  pdfId: number,
  onProgress: (note: string) => void,
): Promise<PaperProblemBrief[]> {
  const cached = await downloadJsonObject<PaperScanCache>(
    scanCachePath(pdfId),
  ).catch(() => null);
  if (cached && cached.v === 1 && Array.isArray(cached.problems)) {
    return cached.problems;
  }
  let pages = await listPdfPagesFromIndex(pdfId).catch(() => []);
  if (pages.length === 0) {
    // 방금 등록한 교재 — 인덱스를 새로 지어 다시 찾는다
    await usePaperStore.getState().refreshIndex();
    pages = await listPdfPagesFromIndex(pdfId).catch(() => []);
  }
  const out: PaperProblemBrief[] = [];
  let curStage: string | null = null;
  for (let i = 0; i < pages.length; i++) {
    onProgress(`테스트지 대조 ${i + 1}/${pages.length}`);
    const ip = pages[i];
    const clusters = await detectPrintedProblems(ip.key, ip, []).catch(() => null);
    for (const c of clusters ?? []) {
      if (c.meta?.no == null) continue;
      // 단계 제목은 첫 쪽에만 인쇄된다 — 이어받는다 (carryStages 와 같은 이유)
      const st = normalizeStage(c.meta.group);
      if (st) curStage = st;
      out.push({
        stage: st ?? curStage,
        no: c.meta.no,
        question: c.meta.question?.slice(0, 80) || null,
      });
    }
  }
  if (out.length > 0) {
    await uploadJsonObject(scanCachePath(pdfId), {
      v: 1,
      problems: out,
    } satisfies PaperScanCache).catch(() => {});
  }
  return out;
}
