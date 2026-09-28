/**
 * 교재 특수 페이지 인식 — **정답지**와 **표지 본인정보** (2026-08-22 사용자 요구).
 *
 * 정답지: 학생이 답만 옮겨 적는 별도 페이지. 여기 적힌 답을 **채점의 기준**으로
 * 삼는다 — 본문 답과 다르면 정답지가 이긴다(실제 시험 채점 규칙). 본문과 다르게
 * 옮겨 적은 문항은 "잘못 옮겨 적음"으로 반드시 표시한다.
 *
 * 본인정보: 표지 기입란(이름·학교·학년)의 손글씨를 읽어 등록된 학생 정보와
 * 대조한다 — 필기 기록 화면에 일치/불일치 표시.
 *
 * 결과는 (학생, 제출)별 storage 캐시에 획 서명과 함께 저장 — 같은 필기면
 * AI 를 다시 부르지 않는다.
 */
import { sameGradedSheetAnswer, answerSheetRequestSig } from './korean-grading';
import { recognizeImage } from '@/lib/api';
import { repairModelJson } from './json-repair';
import { downloadJsonObject, uploadJsonObject } from './strokes-io';
import { renderProblemRegionImage } from './problem-detect';
import { usePaperStore } from '@/store/paper.store';
import type { Stroke } from '@/pen/live/model/stroke';
import type { ProblemGrade } from './grade-score';

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function strokesSig(strokes: readonly Stroke[]): string {
  return `${strokes.length}|${fnv([...strokes.map((s) => s.id)].sort().join(','))}`;
}

type PageAddr = { section: number; owner: number; noteId: number; pageNumber: number };

/** 페이지 전체(용지 범위)를 배경+필기로 렌더 — 특수 페이지 인식용 */
async function renderFullPage(
  page: PageAddr,
  strokes: Stroke[],
): Promise<string | null> {
  let bounds: { Xmin: number; Xmax: number; Ymin: number; Ymax: number } | null =
    null;
  try {
    const entry = await usePaperStore
      .getState()
      .ensurePaper(page.section, page.owner, page.noteId, page.pageNumber);
    bounds = entry.paperSize ?? null;
  } catch {
    /* 배경 없음 — 필기 범위로 렌더 */
  }
  const bbox = bounds
    ? { minX: bounds.Xmin, minY: bounds.Ymin, maxX: bounds.Xmax, maxY: bounds.Ymax }
    : null;
  if (!bbox) return null;
  return renderProblemRegionImage({
    page,
    bbox,
    strokes,
    includeStrokeIds: strokes.map((s) => s.id),
    expand: { left: 0, top: 0, right: 0, bottom: 0 },
    maxWidth: 1100,
  });
}

// ── 정답지 ───────────────────────────────────────────────────────────

export type AnswerSheetDoc = {
  v: 1;
  sig: string;
  /** 문제 번호(문자열) → 학생이 정답지에 적은 답 */
  answers: Record<string, string>;
};

const sheetPath = (sid: string, subId: string) => `${sid}/${subId}.answersheet.json`;

/** 정답지 페이지에서 문제 번호별 답 인식 (획 서명 캐시 — 같은 필기면 AI 0회) */
export async function recognizeAnswerSheet(args: {
  studentId: string;
  submissionId: string;
  page: PageAddr;
  strokes: Stroke[];
  expectedNos: readonly number[];
}): Promise<AnswerSheetDoc | null> {
  const expectedNos = [...new Set(args.expectedNos)].sort((a, b) => a - b);
  const sig = answerSheetRequestSig(args.page, args.strokes.map(st => st.id), expectedNos);
  const cached = await downloadJsonObject<AnswerSheetDoc | null>(
    sheetPath(args.studentId, args.submissionId),
  ).catch(() => null);
  if (cached && cached.v === 1 && cached.sig === sig) return cached;

  const dataUrl = await renderFullPage(args.page, args.strokes);
  if (!dataUrl) return null;
  const prompt = [
    '이 이미지는 시험지의 **정답지(답안 기입란) 페이지**이고, 파란 선이 학생이 스마트펜으로 쓴 필기입니다.',
    '인쇄된 문제 번호별 칸에 학생이 적은 **답**을 읽어주세요.',
    expectedNos.length > 0
      ? `이 시험지의 문제 번호: ${expectedNos.join(', ')}`
      : '',
    '',
    '규칙:',
    '- 객관식이면 번호(①→"1" 처럼 숫자), 주관식이면 적힌 값 그대로.',
    '- 학생이 아무것도 안 쓴 칸은 결과에 넣지 마세요.',
    '- 번호가 명확하지 않은 필기는 무시하세요.',
    '',
    '아래 JSON 으로만 답하세요 (설명·마크다운 금지):',
    '{"answers":{"1":"4","2":"12","5":"2,3"}}',
  ]
    .filter(Boolean)
    .join('\n');
  const { text } = await recognizeImage(dataUrl, prompt);
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let answers: Record<string, string> = {};
  try {
    const j = JSON.parse(repairModelJson(cleaned)) as {
      answers?: Record<string, unknown>;
    };
    for (const [k, v] of Object.entries(j.answers ?? {})) {
      const no = String(parseInt(k, 10));
      const val = String(v ?? '').trim();
      if (no !== 'NaN' && val) answers[no] = val;
    }
  } catch {
    answers = {};
  }
  const doc: AnswerSheetDoc = { v: 1, sig, answers };
  await uploadJsonObject(sheetPath(args.studentId, args.submissionId), doc).catch(
    () => {},
  );
  return doc;
}

/** 답 정규화 — ①~⑳/⑴류를 숫자로, 공백·구분자 정리. 복수답은 정렬 비교. */
export function normalizeAnswer(s: string): string {
  const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  let t = s.trim().toLowerCase();
  t = t.replace(/[①-⑳]/g, (ch) => String(CIRCLED.indexOf(ch) + 1));
  t = t.replace(/[()\s]/g, '');
  const parts = t
    .split(/[,·]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .sort();
  return parts.join(',');
}

export type SheetVerdict = {
  /** 최종 판정 (정답지 있으면 정답지 기준) */
  verdict: ProblemGrade['verdict'];
  /** 정답지에 적힌 답 (없으면 null) */
  sheetAnswer: string | null;
  /** 본문 답과 다르게 옮겨 적음 — 반드시 표시해야 하는 케이스 */
  transcriptionError: boolean;
  /** 본문은 정답인데 정답지가 틀려 오답 처리된 케이스 (강조 대상) */
  correctBodyButSheetWrong: boolean;
  source: 'sheet' | 'body';
};

/**
 * 정답지 기준 최종 판정.
 *  - 정답지에 답이 있으면: 정답지 답 vs 정답 → 판정 (정답지가 기준)
 *  - 정답지에 없으면: 본문 채점 결과 그대로
 *  - 본문 답과 정답지 답이 다르면 transcriptionError
 */
export function mergeSheetVerdict(
  grade: ProblemGrade | undefined,
  sheetAnswerRaw: string | undefined,
  semantic = false,
): SheetVerdict {
  const bodyVerdict = grade?.verdict ?? 'blank';
  const sheetAnswer = sheetAnswerRaw?.trim() || null;
  if (!sheetAnswer) {
    return {
      verdict: bodyVerdict,
      sheetAnswer: null,
      transcriptionError: false,
      correctBodyButSheetWrong: false,
      source: 'body',
    };
  }
  if (semantic) {
    const same = sameGradedSheetAnswer(grade, sheetAnswer);
    return {
      verdict: same ? grade!.verdict : 'unknown',
      sheetAnswer,
      transcriptionError: !!grade?.studentAnswer && grade.studentAnswer.trim() !== sheetAnswer,
      correctBodyButSheetWrong: false,
      source: 'sheet',
    };
  }
  const correct = grade?.correctAnswer?.trim() ?? '';
  if (!correct) {
    // 정답을 모르면 정답지만으로 판정 불가 — 본문 판정 유지하되 답은 노출
    return {
      verdict: bodyVerdict,
      sheetAnswer,
      transcriptionError:
        !!grade?.studentAnswer &&
        normalizeAnswer(grade.studentAnswer) !== normalizeAnswer(sheetAnswer),
      correctBodyButSheetWrong: false,
      source: 'body',
    };
  }
  const sheetCorrect = normalizeAnswer(sheetAnswer) === normalizeAnswer(correct);
  const verdict: ProblemGrade['verdict'] = sheetCorrect ? 'correct' : 'wrong';
  const transcriptionError =
    !!grade?.studentAnswer &&
    normalizeAnswer(grade.studentAnswer) !== normalizeAnswer(sheetAnswer);
  return {
    verdict,
    sheetAnswer,
    transcriptionError,
    correctBodyButSheetWrong: bodyVerdict === 'correct' && !sheetCorrect,
    source: 'sheet',
  };
}

// ── 페이지 유형 AI 판별 ──────────────────────────────────────────────
//
// 교재 만들기에서 "표지에 본인정보 기입란 있음"을 **선생님이 지정**해야만
// 본인정보 대조가 돌았다(022). 지정을 안 하면 표지가 문제 페이지로 오인되고
// 이름 대조도 건너뛴다 — 실제로 제4회 JMC.K 가 그랬다(사용자 지적 2026-08-24).
// 그래서 **인쇄 원본만 보고 AI 가 페이지 유형을 판별**한다.
//
// 판별 대상은 교재(PDF)의 성질이라 학생과 무관하다 → 결과는 **교재 단위**로
// 기기 캐시에 남기고, 같은 교재를 다시 열 때 AI 를 부르지 않는다.

/** info = 본인정보 기입란만 (문제 없음) / problems = 문제 있음 /
 *  answer = 답만 옮겨 적는 정답지 / blank = 사실상 빈 페이지 */
export type PageKind = 'info' | 'problems' | 'answer' | 'blank';

export type PageKindDoc = {
  v: 1;
  kind: PageKind;
  /** 이름 기입란이 있는가 — 본인 확인(이름 대조)을 할 수 있는 페이지인지 */
  hasNameField: boolean;
  /** AI 가 그렇게 본 근거 한 줄 (화면에 그대로 보여준다) */
  note: string;
};

const KIND_CACHE_VER = 'v1';
const kindCacheKey = (pdfId: number) => `pc_page_kind_${KIND_CACHE_VER}:${pdfId}`;

function loadKindCache(pdfId: number): Record<number, PageKindDoc> {
  try {
    const raw = localStorage.getItem(kindCacheKey(pdfId));
    const o = raw ? (JSON.parse(raw) as Record<number, PageKindDoc>) : null;
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function saveKindCache(pdfId: number, map: Record<number, PageKindDoc>) {
  try {
    localStorage.setItem(kindCacheKey(pdfId), JSON.stringify(map));
  } catch {
    /* 저장소 가득 참 — 다음에 다시 판별할 뿐 */
  }
}

/** 교재 한 페이지의 **인쇄 원본**(필기 제외)을 보고 유형을 판별한다.
 *  배경 교재를 못 구하면 null — 판별하지 않은 것으로 다룬다(추측 금지). */
export async function classifyPrintedPage(args: {
  pdfId: number | null;
  pageIndex: number | null;
  page: PageAddr;
}): Promise<PageKindDoc | null> {
  const { pdfId, pageIndex, page } = args;
  const cacheable = pdfId != null && pageIndex != null;
  if (cacheable) {
    const hit = loadKindCache(pdfId)[pageIndex];
    if (hit && hit.v === 1) return hit;
  }
  // 필기를 빼고 **인쇄된 것만** 보여준다 — 학생 필기가 문제로 오인되면 안 된다
  const dataUrl = await renderFullPage(page, []);
  if (!dataUrl) return null;
  const prompt = [
    '이 이미지는 학습지(시험지) **한 페이지의 인쇄 원본**입니다 (학생 필기 없음).',
    '이 페이지가 어떤 페이지인지 분류하세요.',
    '',
    '- "info": 이름·학교·학년 등 **본인정보 기입란만** 있고 풀어야 할 문제는 없는 페이지 (표지 등)',
    '- "problems": 번호가 붙은 문제가 하나라도 있는 페이지 (본인정보란이 함께 있어도 문제가 있으면 이쪽)',
    '- "answer": 문제 지문 없이 번호와 답란만 있어 답을 옮겨 적는 정답지·답안지',
    '- "blank": 인쇄된 내용이 사실상 없는 빈 페이지',
    '',
    'hasNameField 는 **이름을 적는 칸이 있는가** 입니다 (있으면 true).',
    '',
    '아래 JSON 으로만 답하세요 (설명·마크다운 금지):',
    '{"kind":"info","hasNameField":true,"note":"표지에 이름·학교 기입란만 있음"}',
  ].join('\n');
  const { text } = await recognizeImage(dataUrl, prompt);
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let doc: PageKindDoc | null = null;
  try {
    const j = JSON.parse(repairModelJson(cleaned)) as Record<string, unknown>;
    const k = String(j.kind ?? '');
    if (k === 'info' || k === 'problems' || k === 'answer' || k === 'blank') {
      doc = {
        v: 1,
        kind: k,
        hasNameField: j.hasNameField === true,
        note: String(j.note ?? '').trim(),
      };
    }
  } catch {
    /* 파싱 실패 — 판별하지 않은 것으로 둔다 */
  }
  if (doc && cacheable) {
    const map = loadKindCache(pdfId);
    map[pageIndex] = doc;
    saveKindCache(pdfId, map);
  }
  return doc;
}

/**
 * **페이지 머리 제목 읽기** — "1단계", "2단계(응용)", "계산력" 처럼 그 쪽의
 * 문항 묶음을 가리키는 인쇄 제목을 그대로 읽는다 (사용자 요구 2026-08-26:
 * "PDF 에 계산력이라는 타이틀이 있으면 그 페이지는 계산력 페이지야 — OCR 해야 돼").
 *
 * 문항 인식이 문항마다 group 을 못 읽는 경우가 있어(둘째 쪽, 표지 계산력) 이
 * 값을 **단계 이어받기의 시드**로 쓴다. 결과는 교재+쪽 단위 캐시라 한 번만 읽는다.
 */
const HEAD_CACHE_VER = 'v1';
const headKey = (pdfId: number) => `pc_page_head_${HEAD_CACHE_VER}:${pdfId}`;

export async function readPageHeading(args: {
  pdfId: number | null;
  pageIndex: number | null;
  page: PageAddr;
}): Promise<string> {
  const { pdfId, pageIndex, page } = args;
  const cacheable = pdfId != null && pageIndex != null;
  let map: Record<number, string> = {};
  if (cacheable) {
    try {
      const raw = localStorage.getItem(headKey(pdfId));
      map = raw ? (JSON.parse(raw) as Record<number, string>) : {};
    } catch {
      map = {};
    }
    const hit = map[pageIndex];
    if (typeof hit === 'string') return hit;
  }
  const dataUrl = await renderFullPage(page, []);
  if (!dataUrl) return '';
  const prompt = [
    '이 이미지는 학습지 한 페이지의 **인쇄 원본**입니다.',
    '이 페이지의 문항들이 묶여 있는 **제목**이 인쇄돼 있으면 그 텍스트를 그대로 옮기세요.',
    '예: "1단계", "2단계(응용)", "3단계(심화/통합사고력)", "계산력", "유형 3".',
    '',
    '규칙:',
    '- 문제 번호나 지문이 아니라 **묶음 제목**만입니다.',
    '- 제목이 없으면 **빈 문자열**로 두세요. 지어내지 마세요.',
    '- 앞 페이지에서 이어지는 페이지라 제목이 없을 수 있습니다 — 그때도 빈 문자열입니다.',
    '',
    '아래 JSON 으로만 답하세요 (설명·마크다운 금지):',
    '{"heading":"1단계(기본)"}',
  ].join('\n');
  let heading = '';
  try {
    const { text } = await recognizeImage(dataUrl, prompt);
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const j = JSON.parse(repairModelJson(cleaned)) as { heading?: unknown };
    heading = String(j.heading ?? '').trim().slice(0, 40);
  } catch {
    heading = '';
  }
  if (cacheable) {
    map[pageIndex] = heading;
    try {
      localStorage.setItem(headKey(pdfId), JSON.stringify(map));
    } catch {
      /* 저장소 가득 — 다음에 다시 읽을 뿐 */
    }
  }
  return heading;
}

/** 이 교재에서 이미 판별해 둔 페이지 유형 (AI 호출 없음) */
export function cachedPageKinds(pdfId: number): Record<number, PageKindDoc> {
  return loadKindCache(pdfId);
}

// ── 표지 본인정보 ────────────────────────────────────────────────────

export type IdCheckDoc = {
  v: 1;
  sig: string;
  name: string;
  school: string;
  grade: string;
};

const idPath = (sid: string, subId: string, slot = '') =>
  `${sid}/${subId}.idcheck${slot ? `.${slot}` : ''}.json`;

/** 손글씨 본인정보 인식 (획 서명 캐시).
 *  표지 말고 **정답지에 적힌 본인정보**도 읽어야 해서 slot 으로 갈라 저장한다
 *  (사용자 요구 2026-08-24) — 같은 파일에 덮어쓰면 둘을 대조할 수 없다. */
export async function recognizeIdInfo(args: {
  studentId: string;
  submissionId: string;
  page: PageAddr;
  strokes: Stroke[];
  /** 저장 슬롯 — 비우면 표지(기존 경로 그대로), 'sheet' 면 정답지 */
  slot?: string;
  /** 프롬프트에 쓸 페이지 설명 */
  pageLabel?: string;
}): Promise<IdCheckDoc | null> {
  const sig = strokesSig(args.strokes);
  const slot = args.slot ?? '';
  const cached = await downloadJsonObject<IdCheckDoc | null>(
    idPath(args.studentId, args.submissionId, slot),
  ).catch(() => null);
  if (cached && cached.v === 1 && cached.sig === sig) return cached;

  const dataUrl = await renderFullPage(args.page, args.strokes);
  if (!dataUrl) return null;
  const prompt = [
    `이 이미지는 ${args.pageLabel ?? '시험지 표지의 **본인정보 기입란**'}이고, 파란 선이 학생이 손으로 쓴 내용입니다.`,
    '학생이 적은 이름·학교·학년을 읽어주세요. 안 적힌 항목은 빈 문자열로.',
    '',
    '아래 JSON 으로만 답하세요 (설명·마크다운 금지):',
    '{"name":"김철수","school":"서울초","grade":"4"}',
  ].join('\n');
  const { text } = await recognizeImage(dataUrl, prompt);
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  let doc: IdCheckDoc = { v: 1, sig, name: '', school: '', grade: '' };
  try {
    const j = JSON.parse(repairModelJson(cleaned)) as Record<string, unknown>;
    doc = {
      v: 1,
      sig,
      name: String(j.name ?? '').trim(),
      school: String(j.school ?? '').trim(),
      grade: String(j.grade ?? '').trim(),
    };
  } catch {
    /* 파싱 실패 — 빈 값 */
  }
  await uploadJsonObject(
    idPath(args.studentId, args.submissionId, slot),
    doc,
  ).catch(() => {});
  return doc;
}

/** 본인정보 두 장 대조 — 표지와 정답지에 **서로 다른 사람**이 적혀 있는가.
 *  둘 중 하나라도 안 적혔으면 대조 불가(null). */
export function crossCheckIdInfo(
  a: IdCheckDoc,
  b: IdCheckDoc,
): { nameMatch: boolean | null; schoolMatch: boolean | null; gradeMatch: boolean | null } {
  const cmp = (x: string, y: string) =>
    x && y ? squash(x) === squash(y) : null;
  const gd = (x: string) => x.replace(/[^0-9]/g, '');
  return {
    nameMatch: cmp(a.name, b.name),
    schoolMatch: cmp(a.school, b.school),
    gradeMatch: gd(a.grade) && gd(b.grade) ? gd(a.grade) === gd(b.grade) : null,
  };
}

const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 본인정보 대조 — null = 시험지에 해당 항목이 안 적혀 판단 불가 */
export function compareIdInfo(
  id: IdCheckDoc,
  student: { name: string; school?: string | null; grade?: number | null },
): {
  nameMatch: boolean | null;
  schoolMatch: boolean | null;
  gradeMatch: boolean | null;
  allKnownMatch: boolean;
} {
  const nameMatch = id.name ? squash(id.name) === squash(student.name) : null;
  const schoolMatch =
    id.school && student.school
      ? squash(student.school).includes(squash(id.school)) ||
        squash(id.school).includes(squash(student.school))
      : null;
  const gradeDigit = id.grade.replace(/[^0-9]/g, '');
  const gradeMatch =
    gradeDigit && student.grade != null
      ? parseInt(gradeDigit, 10) === student.grade
      : null;
  const known = [nameMatch, schoolMatch, gradeMatch].filter(
    (x): x is boolean => x !== null,
  );
  return {
    nameMatch,
    schoolMatch,
    gradeMatch,
    allKnownMatch: known.length > 0 && known.every(Boolean),
  };
}
