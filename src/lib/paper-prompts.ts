/**
 * **교재·문항별 AI 프롬프트 (학원 개별 설정, 2026-08-22 사용자 요구).**
 *
 * 학원마다 학생을 평가하는 방식이 달라, 운영사(수학비서) 공통 프롬프트에 더해
 * 학원이 교재 전체/문항별 **추가 지시문**을 정의할 수 있다.
 *  - 학원 설정 토글 OFF(기본): 공통 프롬프트만 — 이 모듈은 빈 설정을 돌려준다.
 *  - ON: 지시문이 채점·과정분석·리포트의 문맥에 병합된다.
 *
 * 📐 불변식: 지시문 **합성은 이 모듈의 함수로만** 한다 — 화면(ReviewPage)과
 * 자동 파이프라인(auto-grade)이 다르게 합성하면 서명이 갈라져 재채점이 부활한다.
 * 지시문이 바뀌면 서명(promptSigExt)이 바뀌어 그 문항만 증분 재처리된다.
 *
 * (순수 합성부는 supabase 에 의존하지 않는다 — scripts/prompt-test.ts 로 검증)
 */

// ── 순수부: 합성·서명 ────────────────────────────────────────────────

export type PdfPromptSet = {
  /** 교재 전체 지시문 */
  paper?: string;
  /** 문항 번호 → 지시문 */
  byNo: Record<number, string>;
};

export type PaperPromptConfig = {
  /** 학원 설정 토글 — OFF 면 아래 데이터가 있어도 쓰지 않는다 */
  enabled: boolean;
  byPdf: Record<number, PdfPromptSet>;
};

export const EMPTY_PROMPT_CONFIG: PaperPromptConfig = { enabled: false, byPdf: {} };

function fnv(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** 이 문항에 적용될 지시문 원문 (교재 전체 + 문항별). 없으면 ''. */
export function promptFor(
  cfg: PaperPromptConfig,
  pdfId: number | null | undefined,
  no: number | null | undefined,
): string {
  if (!cfg.enabled || pdfId == null) return '';
  const set = cfg.byPdf[pdfId];
  if (!set) return '';
  const parts: string[] = [];
  if (set.paper?.trim()) parts.push(set.paper.trim());
  if (no != null && set.byNo[no]?.trim()) parts.push(set.byNo[no].trim());
  return parts.join('\n');
}

/** 채점에 얹는 블록 — 학원 기준을 정오 판정·문제점 서술에 반영시킨다 */
export function gradeDirective(
  cfg: PaperPromptConfig,
  pdfId: number | null | undefined,
  no: number | null | undefined,
): string {
  const p = promptFor(cfg, pdfId, no);
  if (!p) return '';
  return ['[학원 채점·평가 기준 — 반드시 반영하세요]', p].join('\n');
}

/** 과정 분석에 얹는 블록 */
export function analysisDirective(
  cfg: PaperPromptConfig,
  pdfId: number | null | undefined,
  no: number | null | undefined,
): string {
  const p = promptFor(cfg, pdfId, no);
  if (!p) return '';
  return [
    '[학원 분석 기준 — 이 학원의 평가 방식입니다. 분석 서술·문제점·지도 제안에 반영하세요]',
    p,
  ].join('\n');
}

/** 리포트에 얹는 블록 — 여러 교재면 교재 전체 지시문만 합친다 */
export function reportDirective(
  cfg: PaperPromptConfig,
  pdfIds: ReadonlyArray<number>,
): string {
  if (!cfg.enabled) return '';
  const parts: string[] = [];
  for (const id of pdfIds) {
    const p = cfg.byPdf[id]?.paper?.trim();
    if (p) parts.push(p);
  }
  if (parts.length === 0) return '';
  return [
    '## 학원 평가 기준 (이 학원의 방식 — 리포트 총평·지도 제안에 반영하세요)',
    ...parts,
  ].join('\n');
}

/** 지시문 서명 꼬리 — 채점/분석 캐시 서명에 붙여, 지시문이 바뀐 문항만 재처리 */
export function promptSigExt(directive: string): string {
  return directive ? `|d${fnv(directive)}` : '';
}

// ── 학습분석 리포트 섹션별 프롬프트 (학원 공통 — pdf_id=0 센티널) ──

/** 리포트 프롬프트 저장 스코프 — sp_paper_prompts 에 pdf_id=0 으로 저장한다 */
export const REPORT_PDF_ID = 0;

export type ReportPromptValues = {
  /** 문항별 AI 과정 분석 한 줄 평가 (problems[].process·comment) */
  problemLine: string;
  /** 학습자 결과분석 섹션 */
  learner: string;
  /** 우선 학습대상 문제 섹션 */
  priority: string;
  /** 종합분석 · 향후 지도방향 섹션 */
  overall: string;
};

export const EMPTY_REPORT_PROMPTS: ReportPromptValues = {
  problemLine: '',
  learner: '',
  priority: '',
  overall: '',
};

export const REPORT_PROMPT_FIELDS: ReadonlyArray<{
  key: keyof ReportPromptValues;
  scope: string;
  label: string;
  hint: string;
}> = [
  {
    key: 'problemLine',
    scope: 'report_problem_line',
    label: 'AI 과정 분석 — 문항별 한 줄 평가',
    hint: '문제번호마다 붙는 과정 평가(어떻게 풀었는지)와 코멘트의 관점·말투·길이 기준. 예) "칭찬 반, 보완 반으로 1문장씩" / "막힌 지점을 반드시 명시"',
  },
  {
    key: 'learner',
    scope: 'report_learner',
    label: '학습자 결과분석',
    hint: '학생의 강점·약점·습관을 어떤 관점으로 서술할지. 예) "개념/연산/독해 3축으로 나눠 분석"',
  },
  {
    key: 'priority',
    scope: 'report_priority',
    label: '우선 학습대상 문제',
    hint: '어떤 기준으로 우선순위를 매기고 어떻게 표기할지. 예) "틀린 문항 중 배점·유형 빈도 순으로 3개만"',
  },
  {
    key: 'overall',
    scope: 'report_overall',
    label: '종합분석 · 향후 지도방향',
    hint: '총평의 어조와 지도방향의 형식. 예) "학부모 열람 전제, 다음 2주 학습 플랜을 단계로 제시"',
  },
];

/** 리포트 생성 컨텍스트에 붙는 학원 기준 블록 — 값이 전부 비면 '' */
export function composeReportSectionDirective(v: ReportPromptValues): string {
  const parts: string[] = [];
  if (v.problemLine.trim())
    parts.push(
      `[문항별 AI 과정 분석(problems[].process·comment) 기준]\n${v.problemLine.trim()}`,
    );
  if (v.learner.trim())
    parts.push(`[학습자 결과분석(learnerAnalysis) 기준]\n${v.learner.trim()}`);
  if (v.priority.trim())
    parts.push(`[우선 학습대상(priorityProblems) 기준]\n${v.priority.trim()}`);
  if (v.overall.trim())
    parts.push(`[종합분석·향후 지도방향(overall) 기준]\n${v.overall.trim()}`);
  if (parts.length === 0) return '';
  return [
    '## 학원 리포트 작성 기준 (이 학원의 방식 — 해당 항목에 반드시 반영하세요)',
    ...parts,
  ].join('\n');
}

/** 프롬프트 작성 팁 — 편집 화면에서 보여준다 */
export const PROMPT_TIPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'AI가 아는 것 위에 기준을 얹으세요',
    body:
      'AI는 문항 지문·학생 필기·채점 결과(정오/학생 답)·펜 데이터(풀이 시간, 시도 횟수, 재방문, 멈춤)를 이미 알고 있습니다. "무엇을 보라"보다 "어떻게 평가하라"를 적는 것이 효과적입니다.',
  },
  {
    title: '구체적인 판정 규칙이 가장 잘 듣습니다',
    body:
      '예: "풀이 과정 없이 답만 맞으면 절반만 이해한 것으로 평가", "단위를 빠뜨리면 반드시 문제점으로 지적", "3번 유형은 식 세우기를 중점 평가".',
  },
  {
    title: '학원의 말투·관점을 지정할 수 있습니다',
    body:
      '예: "학부모가 읽는다고 생각하고 정중하게", "지도 제안은 반드시 다음 수업에서 할 행동 1가지로", "칭찬 1개 + 보완 1개 구조로".',
  },
  {
    title: '문항별 프롬프트는 그 문항에만 적용됩니다',
    body:
      '교재 전체 프롬프트와 함께(전체 → 문항 순서로) 적용됩니다. 같은 내용을 반복해서 쓸 필요 없습니다.',
  },
  {
    title: '저장하면 그 문항만 다시 분석됩니다',
    body:
      '프롬프트가 바뀐 문항만 다음 열람/수신 때 자동으로 다시 채점·분석됩니다. 이미 완료된 다른 문항은 다시 호출하지 않습니다. 학습분석 리포트는 [다시 생성]을 눌러야 새 기준이 반영됩니다.',
  },
];

// ── 저장/조회 (supabase — 지연 로드라 node 테스트에서 안전) ──────────

type PromptRow = { pdf_id: number; scope: string; prompt: string };

async function client() {
  const { requireSupabase } = await import('@/lib/supabase');
  return requireSupabase();
}

/** 학원 토글 + 지정 교재들의 프롬프트 로드. 마이그레이션(021) 전이면 조용히 OFF. */
export async function loadPaperPromptConfig(
  academyId: string | null | undefined,
  pdfIds: ReadonlyArray<number>,
): Promise<PaperPromptConfig> {
  if (!academyId) return EMPTY_PROMPT_CONFIG;
  try {
    const supabase = await client();
    const { data: acad, error: e1 } = await supabase
      .from('sp_academies')
      .select('custom_prompts_enabled')
      .eq('id', academyId)
      .maybeSingle();
    if (e1 || !acad || !acad.custom_prompts_enabled) return EMPTY_PROMPT_CONFIG;
    if (pdfIds.length === 0) return { enabled: true, byPdf: {} };
    const { data, error } = await supabase
      .from('sp_paper_prompts')
      .select('pdf_id, scope, prompt')
      .eq('academy_id', academyId)
      .in('pdf_id', [...pdfIds]);
    if (error) return { enabled: true, byPdf: {} };
    const byPdf: Record<number, PdfPromptSet> = {};
    for (const r of (data ?? []) as PromptRow[]) {
      const set = (byPdf[r.pdf_id] ??= { byNo: {} });
      if (r.scope === 'paper') set.paper = r.prompt;
      else {
        const m = /^q(\d+)$/.exec(r.scope);
        if (m) set.byNo[parseInt(m[1], 10)] = r.prompt;
      }
    }
    return { enabled: true, byPdf };
  } catch {
    return EMPTY_PROMPT_CONFIG; // 테이블/컬럼 미준비 — 공통 프롬프트로 동작
  }
}

/** 편집 화면용 — 한 교재의 프롬프트 전부 */
export async function listPaperPrompts(
  academyId: string,
  pdfId: number,
): Promise<{ paper: string; byNo: Array<{ no: number; prompt: string }> }> {
  const supabase = await client();
  const { data, error } = await supabase
    .from('sp_paper_prompts')
    .select('scope, prompt')
    .eq('academy_id', academyId)
    .eq('pdf_id', pdfId);
  if (error) throw new Error(error.message);
  let paper = '';
  const byNo: Array<{ no: number; prompt: string }> = [];
  for (const r of (data ?? []) as Array<{ scope: string; prompt: string }>) {
    if (r.scope === 'paper') paper = r.prompt;
    else {
      const m = /^q(\d+)$/.exec(r.scope);
      if (m) byNo.push({ no: parseInt(m[1], 10), prompt: r.prompt });
    }
  }
  byNo.sort((a, b) => a.no - b.no);
  return { paper, byNo };
}

/** 리포트 섹션 프롬프트 로드 (편집 화면용) */
export async function loadReportPrompts(
  academyId: string,
): Promise<ReportPromptValues> {
  const supabase = await client();
  const { data, error } = await supabase
    .from('sp_paper_prompts')
    .select('scope, prompt')
    .eq('academy_id', academyId)
    .eq('pdf_id', REPORT_PDF_ID);
  if (error) throw new Error(error.message);
  const out = { ...EMPTY_REPORT_PROMPTS };
  for (const r of (data ?? []) as Array<{ scope: string; prompt: string }>) {
    const f = REPORT_PROMPT_FIELDS.find((x) => x.scope === r.scope);
    if (f) out[f.key] = r.prompt;
  }
  return out;
}

/** 리포트 섹션 프롬프트 저장 — 빈 값은 삭제 */
export async function saveReportPrompts(
  academyId: string,
  values: ReportPromptValues,
): Promise<void> {
  const supabase = await client();
  const { error: delErr } = await supabase
    .from('sp_paper_prompts')
    .delete()
    .eq('academy_id', academyId)
    .eq('pdf_id', REPORT_PDF_ID);
  if (delErr) throw new Error(delErr.message);
  const rows = REPORT_PROMPT_FIELDS.filter((f) => values[f.key].trim()).map(
    (f) => ({
      academy_id: academyId,
      pdf_id: REPORT_PDF_ID,
      scope: f.scope,
      prompt: values[f.key].trim(),
    }),
  );
  if (rows.length > 0) {
    const { error } = await supabase.from('sp_paper_prompts').insert(rows);
    if (error) throw new Error(error.message);
  }
}

/** 리포트 생성용 — 토글 확인까지 포함해 합성된 지시문을 돌려준다 ('' 가능).
 *  **리포트 생성 경로(learn-report)가 유일한 호출자** — 화면/파이프라인 공통. */
export async function loadReportPromptDirective(
  academyId: string | null | undefined,
): Promise<string> {
  if (!academyId) return '';
  try {
    const supabase = await client();
    const { data: acad } = await supabase
      .from('sp_academies')
      .select('custom_prompts_enabled')
      .eq('id', academyId)
      .maybeSingle();
    if (!acad?.custom_prompts_enabled) return '';
    const values = await loadReportPrompts(academyId);
    return composeReportSectionDirective(values);
  } catch {
    return ''; // 021 미적용 등 — 공통 프롬프트로 동작
  }
}

/** 한 교재의 프롬프트 저장 — 넘긴 내용으로 통째 교체(빈 항목은 삭제) */
export async function savePaperPrompts(
  academyId: string,
  pdfId: number,
  input: { paper: string; byNo: Array<{ no: number; prompt: string }> },
): Promise<void> {
  const supabase = await client();
  const rows: Array<{ academy_id: string; pdf_id: number; scope: string; prompt: string }> = [];
  if (input.paper.trim()) {
    rows.push({ academy_id: academyId, pdf_id: pdfId, scope: 'paper', prompt: input.paper.trim() });
  }
  for (const q of input.byNo) {
    if (!Number.isFinite(q.no) || q.no <= 0 || !q.prompt.trim()) continue;
    rows.push({ academy_id: academyId, pdf_id: pdfId, scope: `q${q.no}`, prompt: q.prompt.trim() });
  }
  // 기존 행 삭제 후 재삽입 — 부분 upsert 보다 "지운 항목" 처리가 명확하다
  const { error: delErr } = await supabase
    .from('sp_paper_prompts')
    .delete()
    .eq('academy_id', academyId)
    .eq('pdf_id', pdfId);
  if (delErr) throw new Error(delErr.message);
  if (rows.length > 0) {
    const { error } = await supabase.from('sp_paper_prompts').insert(rows);
    if (error) throw new Error(error.message);
  }
}
