/**
 * **모범 풀이·답안 (교사 제공, 사용자 요구 2026-09-02).**
 *
 * 단계형 테스트지에는 손풀이 해설 PDF 가 따로 있다(예: "6-2 B형 풀이+답안").
 * 그 내용을 문항별로 구조화해 스토리지에 둔다:
 *   - `solutions/{pdfId}.json` — 문항별 { stage, no, answer, solution, page }
 *   - `solutions/{pdfId}/p{n}.png` — 해설 PDF 페이지 이미지 (150dpi)
 *
 * 쓰임 두 가지:
 *   1) 문항별 AI 과정 분석 — 모범 풀이를 프롬프트에 얹어 학생 풀이와 비교
 *      (좋은 점 / 부족한 점 / 보완 방법). `solutionDirective` 참조.
 *   2) 리뷰 화면 [풀이·답안] 버튼 — 해당 문항의 모범 풀이 이미지·텍스트를
 *      학생 풀이 옆에서 열람.
 *
 * 📐 단계 이름은 표기가 흔들리므로(계산력/계산식/1단계(기본)) 매칭 전에
 * `normalizeStage` 로 접는다.
 */
// 📐 이 모듈은 **순수부**다 — supabase 에 의존하지 않아 scripts/ 테스트가
// 그대로 돈다. 로딩·이미지 URL 은 solutions-io.ts 에 있다.

/**
 * 인식된 단계 제목을 표준 이름으로 접는다 — 매칭 전에 한 번 통과시킨다.
 * - 「1단계」 「1 단계」 「1단계(기본)」 「[2단계]」 → `1단계` / `2단계`
 * - 「계산력」 「계산식」 「계산 식」 → `계산력` (인쇄물 정본은 「계산력」)
 * - 아는 표기가 아니면 null (모르는 단계로 따로 센다)
 */
export function normalizeStage(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const m = /([123])\s*단계/.exec(s);
  if (m) return `${m[1]}단계`;
  if (/계산\s*(식|력)/.test(s)) return '계산력';
  return null;
}

export type SolutionEntry = {
  /** 단계 제목 — 계산력·1단계… (없으면 null) */
  stage: string | null;
  no: number;
  answer: string;
  /** 손풀이 전사 텍스트 — 답만 있는 문항(계산력)은 null */
  solution?: string | null;
  /** 지문 시작 부분(±40자) — 테스트지 대조용. 옛 문서에는 없다 */
  question?: string | null;
  /** 해설 PDF 의 페이지 번호(1-base) — 이미지 열람용 */
  page?: number | null;
  /** 그 쪽 안에서 이 문항이 차지하는 영역(0~1 비율) — 있으면 잘라서 보여준다 */
  box?: { x0: number; y0: number; x1: number; y1: number } | null;
};

export type SolutionsDoc = {
  v: 1;
  source?: string;
  problems: SolutionEntry[];
};

/** 이 문항의 모범 풀이 — 단계(정규화)+번호로 찾는다. */
export function solutionFor(
  doc: SolutionsDoc | null | undefined,
  group: string | null | undefined,
  no: number | null | undefined,
): SolutionEntry | null {
  if (!doc || no == null) return null;
  const g = normalizeStage(group);
  return (
    doc.problems.find(
      (p) => p.no === no && normalizeStage(p.stage) === g,
    ) ??
    // 단계를 못 읽은 문항 — 번호가 유일하면 그 문항으로 본다
    (g == null
      ? (() => {
          const hits = doc.problems.filter((p) => p.no === no);
          return hits.length === 1 ? hits[0] : null;
        })()
      : null)
  );
}

/**
 * 문항 분석 프롬프트에 얹는 모범 풀이 블록.
 * 🚨 분석 캐시 서명에 이 문자열이 들어간다 — 문구를 바꾸면 해당 문항들이
 * 한 번씩 재분석된다(의도된 동작이지만 LLM 비용이 든다).
 */
export function solutionDirective(entry: SolutionEntry | null): string {
  if (!entry) return '';
  const lines = [
    '## 모범 풀이·답안 (교사 제공 — 이 문항의 기준 풀이)',
    `[정답] ${entry.answer}`,
    ...(entry.solution ? [`[모범 풀이] ${entry.solution}`] : []),
    '- 학생의 풀이를 위 모범 풀이와 **비교**해 서술하세요:',
    '  ① 잘한 점 — 모범 풀이와 같은/더 나은 접근이면 그대로 인정',
    '  ② 부족한 점 — 모범 풀이에 있는데 학생 풀이에 빠진 단계·개념',
    '  ③ 보완 방법 — 부족한 부분을 어떻게 연습하면 좋은지 구체적으로',
    '- 모범과 다른 접근이라도 논리가 맞으면 낮게 평가하지 마세요.',
    '- 정오 판정은 [정답] 을 기준으로 하되, 채점 결과가 이미 있으면 그것이 정본입니다.',
    // 2026-09-02 v2: 비교 결과를 구조화 필드로 받는다. (이 줄이 서명을 바꿔
    // 8000자 컷 사고로 비교 없이 "완료" 처리된 문항들을 한 번 더 분석시킨다)
    '- 비교 결과는 modelComparison 필드(같음/비슷함/다름, 학생 풀이, 모범 풀이, 차이, 의도, 엇갈림, 지도 포인트)에 채우세요.',
  ];
  return lines.join('\n');
}

// ── 풀이+답안 PDF 인제스트의 순수부 — 페이지별 OCR 결과 병합 ──────────

/** 해설 PDF 한 쪽을 비전 OCR 이 읽어낸 결과 (solutions-ingest 의 프롬프트 참조) */
export type SolutionPageParse = {
  /** 페이지에 크게 인쇄된 묶음 제목 — "1단계"·"계산력" 등. 없으면 생략 */
  stageTitle?: string | null;
  /** 손풀이가 있는 문항들 (페이지 순서대로) */
  problems?: Array<{
    no?: number;
    answer?: string | null;
    solution?: string | null;
    question?: string | null;
    box?: { x0?: number; y0?: number; x1?: number; y1?: number } | null;
  }>;
  /** 정답표 페이지에서 표가 차지하는 영역 — 답만 있는 문항의 열람용 */
  tableBox?: { x0?: number; y0?: number; x1?: number; y1?: number } | null;
  /** 정답표 페이지의 칸들 — {단계, 번호, 답} */
  answerTable?: Array<{
    stage?: string | null;
    no?: number;
    answer?: string | null;
  }>;
};

/**
 * 페이지별 OCR 결과 → SolutionsDoc.
 *
 * - 단계 제목은 첫 쪽에만 인쇄되므로 **이어받는다** (필기 파이프라인의
 *   carryStages 와 같은 이유).
 * - 정답표(마지막 쪽 등)는 **정답의 정본**이다 — 손풀이 쪽에서 읽은 답과
 *   다르면 표의 값으로 덮고, 손풀이가 없는 문항(계산력)은 답만으로 만든다.
 * - page 는 손풀이가 실린 쪽 번호(1-base) — 이미지 열람용.
 */
/** 0~1 비율 상자로 정리 — 값이 없거나 뒤집혔으면 null */
export function normalizeBox(
  b: { x0?: number; y0?: number; x1?: number; y1?: number } | null | undefined,
): SolutionEntry['box'] {
  if (!b) return null;
  const c = (v: unknown) => Math.min(1, Math.max(0, Number(v)));
  const box = { x0: c(b.x0), y0: c(b.y0), x1: c(b.x1), y1: c(b.y1) };
  if ([box.x0, box.y0, box.x1, box.y1].some((v) => !Number.isFinite(v))) return null;
  if (box.x1 - box.x0 < 0.05 || box.y1 - box.y0 < 0.03) return null;
  return box;
}

export function mergeSolutionPages(
  pages: SolutionPageParse[],
  source?: string,
): SolutionsDoc {
  const byKey = new Map<string, SolutionEntry>();
  const keyOf = (stage: string | null, no: number) =>
    `${normalizeStage(stage) ?? '?'}|${no}`;
  let curStage: string | null = null;
  const tables: NonNullable<SolutionPageParse['answerTable']> = [];
  // 객체로 감싼 이유: 콜백 안에서 대입하면 TS 가 바깥에서 null 로만 좁힌다
  const table: { cur: { page: number; box: SolutionEntry['box'] } | null } = { cur: null };
  pages.forEach((pg, i) => {
    if (normalizeStage(pg.stageTitle)) curStage = normalizeStage(pg.stageTitle);
    for (const p of pg.problems ?? []) {
      if (p.no == null || !Number.isFinite(p.no)) continue;
      const stage = curStage;
      const k = keyOf(stage, p.no);
      // 같은 문항이 두 쪽에 걸치면 첫 쪽을 남긴다 (풀이 시작 쪽)
      if (byKey.has(k)) continue;
      byKey.set(k, {
        stage,
        no: p.no,
        answer: (p.answer ?? '').trim(),
        solution: p.solution?.trim() || null,
        question: p.question?.trim() || null,
        page: i + 1,
        box: normalizeBox(p.box),
      });
    }
    if (pg.answerTable) {
      tables.push(...pg.answerTable);
      // 답만 있는 문항은 정답표 쪽(+표 영역)을 열람 이미지로 쓴다
      table.cur = table.cur ?? { page: i + 1, box: normalizeBox(pg.tableBox) };
    }
  });
  for (const t of tables) {
    if (t.no == null || !Number.isFinite(t.no)) continue;
    const answer = (t.answer ?? '').trim();
    if (!answer) continue;
    const k = keyOf(t.stage ?? null, t.no);
    const hit = byKey.get(k);
    if (hit) {
      hit.answer = answer; // 인쇄된 정답표가 정본
    } else {
      byKey.set(k, {
        stage: normalizeStage(t.stage),
        no: t.no,
        answer,
        solution: null,
        page: table.cur?.page ?? null,
        box: table.cur?.box ?? null,
      });
    }
  }
  return {
    v: 1,
    ...(source ? { source } : {}),
    problems: [...byKey.values()],
  };
}


// ── 풀이+답안 ↔ 테스트지 대조 (사용자 요구 2026-09-02) ──────────────────
// "반드시 풀이답안의 문제수·문제풀이수·문제 내용이 테스트지와 같은지 비교해서
//  같은지 안같은지도 분석해서 안내해야 돼" — 다르면 '그래도 괜찮아?' 팝업.

/** 테스트지(문제 PDF)에서 인식한 문항 요약 — 대조 전용 */
export type PaperProblemBrief = {
  stage: string | null;
  no: number;
  question?: string | null;
};

export type SolutionsMatchReport = {
  /** 구성·내용이 어긋난 데가 하나도 없는가 */
  same: boolean;
  /** 어긋난 점들 — 화면 팝업에 그대로 나열한다 */
  issues: string[];
  paperCount: number;
  solutionCount: number;
};

/** 지문 속 숫자들 — 수학 문제의 정체성은 숫자다 (1.28, 2/5, 820.8 …) */
function numberTokens(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const m of (text ?? '').matchAll(/\d+(?:[.,/]\d+)*/g)) out.add(m[0]);
  return out;
}

export function compareSolutionsToPaper(
  paper: ReadonlyArray<PaperProblemBrief>,
  doc: SolutionsDoc,
): SolutionsMatchReport {
  const keyOf = (stage: string | null | undefined, no: number) =>
    `${normalizeStage(stage) ?? '?'}|${no}`;
  const nameOf = (k: string) => {
    const [st, no] = k.split('|');
    return `${st === '?' ? '' : st + ' '}${no}번`;
  };
  const paperBy = new Map(paper.map((p) => [keyOf(p.stage, p.no), p]));
  const solBy = new Map(doc.problems.map((p) => [keyOf(p.stage, p.no), p]));
  const issues: string[] = [];
  if (paperBy.size !== solBy.size) {
    issues.push(
      `문항 수가 다릅니다 — 테스트지 ${paperBy.size}문항 / 풀이+답안 ${solBy.size}문항`,
    );
  }
  const missing = [...paperBy.keys()].filter((k) => !solBy.has(k));
  if (missing.length > 0) {
    issues.push(
      `풀이+답안에 없는 문항: ${missing.slice(0, 8).map(nameOf).join(', ')}${missing.length > 8 ? ` 외 ${missing.length - 8}개` : ''}`,
    );
  }
  const extra = [...solBy.keys()].filter((k) => !paperBy.has(k));
  if (extra.length > 0) {
    issues.push(
      `테스트지에 없는 문항: ${extra.slice(0, 8).map(nameOf).join(', ')}${extra.length > 8 ? ` 외 ${extra.length - 8}개` : ''}`,
    );
  }
  // 내용 대조 — 두 쪽 다 지문이 읽힌 문항만. 숫자 구성이 크게 다르면 다른 문제다.
  const suspect: string[] = [];
  for (const [k, pp] of paperBy) {
    const sp = solBy.get(k);
    if (!sp?.question || !pp.question) continue;
    const a = numberTokens(pp.question);
    const b = numberTokens(sp.question);
    if (a.size < 2 || b.size < 2) continue; // 숫자가 적은 지문은 판정 보류
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    if (inter / Math.min(a.size, b.size) < 1 / 3) suspect.push(nameOf(k));
  }
  if (suspect.length > 0) {
    issues.push(
      `문제 내용이 달라 보이는 문항: ${suspect.slice(0, 8).join(', ')}${suspect.length > 8 ? ` 외 ${suspect.length - 8}개` : ''}`,
    );
  }
  return {
    same: issues.length === 0,
    issues,
    paperCount: paperBy.size,
    solutionCount: solBy.size,
  };
}
