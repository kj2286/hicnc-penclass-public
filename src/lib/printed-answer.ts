/**
 * **인쇄 문항의 정답만 도출** (2026-08-24 사용자 요구).
 *
 * 정답지 기준 채점에는 문항의 정답이 필요한데, 학생이 본문에 아무것도 안 쓴
 * 문항은 채점을 아예 돌리지 않아(`blankGrade`) `correctAnswer` 가 비어 있다.
 * 그래서 "정답지에는 답을 적었고 그게 정답인데도" 정오를 매길 수 없었다.
 *
 * 정답은 **학생과 무관한 교재의 성질**이다 — 그래서 (교재, 문항번호) 단위로
 * 기기 캐시에 남기고, 같은 교재의 다음 학생부터는 AI 를 부르지 않는다.
 */
import { recognizeImage } from '@/lib/api';
import { repairModelJson } from './json-repair';
import { renderProblemRegionImage } from './problem-detect';
import type { ProblemCluster } from './problem-detect';

type PageAddr = { section: number; owner: number; noteId: number; pageNumber: number };

const CACHE_VER = 'v1';
const key = (pdfId: number) => `pc_printed_answer_${CACHE_VER}:${pdfId}`;

function load(pdfId: number): Record<number, string> {
  try {
    const raw = localStorage.getItem(key(pdfId));
    const o = raw ? (JSON.parse(raw) as Record<number, string>) : null;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function save(pdfId: number, map: Record<number, string>) {
  try {
    localStorage.setItem(key(pdfId), JSON.stringify(map));
  } catch {
    /* 저장소 가득 참 — 다음에 다시 구할 뿐 */
  }
}

/** 이 교재에서 이미 구해 둔 정답들 (AI 호출 없음) */
export function cachedPrintedAnswers(pdfId: number): Record<number, string> {
  return load(pdfId);
}

/**
 * 인쇄된 문제만 보고 정답을 구한다. 도출하지 못하면 빈 문자열 —
 * **틀린 정답으로 채점하느니 판정을 포기한다.**
 */
export async function resolvePrintedAnswer(args: {
  pdfId: number;
  no: number;
  page: PageAddr;
  cluster: ProblemCluster;
}): Promise<string> {
  const { pdfId, no, page, cluster } = args;
  const map = load(pdfId);
  const hit = map[no];
  if (typeof hit === 'string') return hit;

  // 필기를 빼고 **인쇄된 문제만** 넘긴다 — 학생 풀이가 정답 도출을 흔들면 안 된다
  const dataUrl = await renderProblemRegionImage({
    page,
    bbox: cluster.bbox,
    strokes: [],
    includeStrokeIds: [],
    topLimit: cluster.meta?.numberY,
    maxWidth: 1000,
  }).catch(() => null);
  if (!dataUrl) return '';

  const prompt = [
    `이 이미지는 시험지의 ${no}번 문제입니다 (학생 필기 없음, 인쇄 원본).`,
    '문제를 풀어 **정답만** 알려주세요.',
    '',
    '규칙:',
    '- 객관식이면 보기 번호를 숫자로 (①→"1").',
    '- 주관식이면 답 값만 (단위·설명 없이).',
    '- 문제가 잘려 있거나 확신이 서지 않으면 빈 문자열로 두세요 — 틀린 정답보다 낫습니다.',
    '',
    '아래 JSON 으로만 답하세요 (설명·마크다운 금지):',
    '{"answer":"4"}',
  ].join('\n');

  let answer = '';
  try {
    const { text } = await recognizeImage(dataUrl, prompt);
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const j = JSON.parse(repairModelJson(cleaned)) as { answer?: unknown };
    answer = String(j.answer ?? '').trim();
  } catch {
    answer = '';
  }
  map[no] = answer;
  save(pdfId, map);
  return answer;
}
