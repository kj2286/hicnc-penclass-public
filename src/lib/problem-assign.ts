/**
 * 문항 배정·영역 기하 — **순수 함수만** 모은 모듈 (브라우저·네트워크 의존 없음).
 *
 * problem-detect 는 여기에 의존하고, 이 파일은 아무것도 의존하지 않는다.
 * 그래서 node 에서 그대로 import 해 회귀 테스트할 수 있다
 * (`scripts/detect-test.ts` — npm test 에 편입).
 *
 * 배정 우선순위 (2026-08-13 실사고 3건이 만든 규칙):
 *  1. 겹침 면적 최대 — 풀이가 옆 문제에 조금 걸쳐도 주로 쓴 문항으로
 *  2. 중심점 포함
 *  3. **같은 단에서 바로 위 문제** — 문제 아래 공백(풀이·"답:" 줄)은 그 문제의 것
 *  4. 필기 흐름(직전/직후) 스냅 — 단, **같은 단 안에서만**
 *  5. 최근접
 */
import type { ProblemBBox, ProblemCluster } from './problem-detect';

/** 좌표를 가진 최소 스트로크 — 테스트에서 가벼운 객체로도 쓸 수 있게 */
export type StrokeLike = {
  id: string;
  startedAt: number;
  dots: ReadonlyArray<{ x: number; y: number }>;
};

export type PaperBounds = {
  Xmin: number;
  Xmax: number;
  Ymin: number;
  Ymax: number;
};

export function strokeBBox(s: StrokeLike): ProblemBBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of s.dots) {
    if (d.x < minX) minX = d.x;
    if (d.y < minY) minY = d.y;
    if (d.x > maxX) maxX = d.x;
    if (d.y > maxY) maxY = d.y;
  }
  return { minX, minY, maxX, maxY };
}
export function unionBox(a: ProblemBBox, b: ProblemBBox): ProblemBBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
/** 시간 연속성 스냅 허용 간격 — 이 안에 이어진 필기는 같은 문항을 푸는 중.
 *  생각하는 멈춤(수십 초)을 견디도록 넉넉히 둔다 — 스냅 대상은 어차피
 *  공간 단서가 전혀 없는 획뿐이라 넓게 잡아도 위험이 작다. */
const TEMPORAL_SNAP_MS = 45_000;
export function assignStrokesToClusters(
  clusters: ProblemCluster[],
  strokes: readonly StrokeLike[],
): ProblemCluster[] {
  const out = clusters.map((c) => ({ ...c, strokeIds: [] as string[] }));
  if (out.length === 0) return out;

  /**
   * 배정에 쓰는 문항 영역 — **자기 문제 번호 줄 위로는 올라가지 않는다.**
   *
   * 영역은 용지를 빈틈없이 덮으려고 위아래로 넓게 잡혀 있지만(첫 문제는 용지
   * 맨 위까지), 배정까지 그 범위를 쓰면 **위 문제의 풀이를 자기 것으로 가져간다**
   * (2026-08-17 실사고: 3번을 고르면 2번 풀이·답까지 딸려왔다).
   * 학생이 자기 문제 번호보다 위에 그 문제 풀이를 쓰는 일은 없다 — 거기는
   * 앞 문제의 자리다. 그래서 배정 상한을 번호 줄로 자른다.
   */
  const zone = (c: ProblemCluster) => {
    const top = c.meta && Number.isFinite(c.meta.numberY)
      ? Math.max(c.bbox.minY, c.meta.numberY)
      : c.bbox.minY;
    return { ...c.bbox, minY: top };
  };
  const zones = out.map(zone);

  // 1차: 공간 배정 — 겹침 면적 최대 → 중심점 포함 → 최근접.
  // 'nearest' 는 어떤 박스와도 안 겹친 획(박스 사이 빈 띠 — 답란 줄 등)이다.
  type Entry = { s: StrokeLike; idx: number; certain: boolean };
  const entries: Entry[] = strokes.map((s) => {
    const b = strokeBBox(s);
    let idx = -1;
    let bestArea = 0;
    zones.forEach((z, i) => {
      const w = Math.min(b.maxX, z.maxX) - Math.max(b.minX, z.minX);
      const h = Math.min(b.maxY, z.maxY) - Math.max(b.minY, z.minY);
      const area = w > 0 && h > 0 ? w * h : 0;
      if (area > bestArea) {
        bestArea = area;
        idx = i;
      }
    });
    if (idx >= 0) return { s, idx, certain: true };
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const ci = zones.findIndex(
      (z) => cx >= z.minX && cx <= z.maxX && cy >= z.minY && cy <= z.maxY,
    );
    if (ci >= 0) return { s, idx: ci, certain: true };
    // 같은 단(column)에서 **바로 위에 있는 문제** — 이 시험지 구조에서 문제
    // 지문 아래 공백(풀이·"답:" 줄)은 항상 그 문제의 것이다. 3번 답란에 쓴
    // 답이 '더 가깝다'는 이유로 4번에 붙던 실사고의 구조적 해법.
    let aboveIdx = -1;
    let aboveMaxY = -Infinity;
    zones.forEach((z, i) => {
      const xOverlap = Math.min(b.maxX, z.maxX) - Math.max(b.minX, z.minX);
      if (xOverlap <= 0) return;
      if (z.maxY <= cy && z.maxY > aboveMaxY) {
        aboveMaxY = z.maxY;
        aboveIdx = i;
      }
    });
    if (aboveIdx >= 0) return { s, idx: aboveIdx, certain: true };
    let best = Infinity;
    let ni = 0;
    zones.forEach((z, i) => {
      const dx = Math.max(z.minX - cx, 0, cx - z.maxX);
      const dy = Math.max(z.minY - cy, 0, cy - z.maxY);
      const d = dx * dx + dy * dy;
      if (d < best) {
        best = d;
        ni = i;
      }
    });
    return { s, idx: ni, certain: false };
  });

  // 2차: 시간 연속성 보정 — 박스 밖 획은 공간 정보가 못 미덥다. 직전(우선)/
  // 직후 짧은 시간 안에 확실히 배정된 필기가 있으면 그 문항으로 스냅한다.
  // (실사고: 3번 답란 줄에 쓴 "그러면 …=⅓" 이 최근접 규칙으로 4번에 붙어
  //  3번 문항 뷰·OCR 에서 사라짐 — 3번을 풀던 흐름이므로 3번이 정답)
  //
  // **같은 단(column) 안에서만 스냅한다.** 안 그러면 왼쪽 단 여백에 쓴 획이
  // 직전에 풀던 오른쪽 단 문항으로 끌려가 그 문항 영역이 페이지 폭 전체로
  // 부풀어 오른다 (2026-08-13 박시원 p.1 5·6번: 영역 폭 92%·84%).
  const sameColumn = (s: StrokeLike, ci: number) => {
    const b = strokeBBox(s);
    const z = zones[ci];
    return Math.min(b.maxX, z.maxX) - Math.max(b.minX, z.minX) > 0;
  };
  const order = entries
    .map((_, i) => i)
    .sort((a, b) => entries[a].s.startedAt - entries[b].s.startedAt);
  // 앞→뒤: 직전 필기에서 전파 (스냅된 획도 다음 획의 근거가 된다)
  for (let k = 1; k < order.length; k++) {
    const e = entries[order[k]];
    const prev = entries[order[k - 1]];
    if (e.certain) continue;
    if (
      e.s.startedAt - prev.s.startedAt <= TEMPORAL_SNAP_MS &&
      sameColumn(e.s, prev.idx)
    ) {
      e.idx = prev.idx;
      e.certain = true;
    }
  }
  // 뒤→앞: 세션 첫 획 등 직전이 없던 획은 직후에서 전파
  for (let k = order.length - 2; k >= 0; k--) {
    const e = entries[order[k]];
    const next = entries[order[k + 1]];
    if (e.certain) continue;
    if (
      next.s.startedAt - e.s.startedAt <= TEMPORAL_SNAP_MS &&
      sameColumn(e.s, next.idx)
    ) {
      e.idx = next.idx;
      e.certain = true;
    }
  }

  for (const e of entries) out[e.idx].strokeIds.push(e.s.id);
  return out;
}

/**
 * 인식 박스를 시험지 구조로 확정한다 — **AI 에게서는 문제 시작 위치(minY)와
 * 번호만 신뢰**하고 나머지는 기하로 다시 세운다.
 *
 * 모델 박스는 노이즈가 크다(페이지 전체 높이 띠, 답란 누락, 반쪽 폭 등).
 * 2단 고정 레이아웃이므로:
 *  - 폭 = 소속 단(column) 전체
 *  - 아래끝 = 같은 단 다음 문제 시작 직전 (= "답:" 줄 반드시 포함),
 *    마지막 문제는 페이지 하단 여백까지
 * 결과는 항상 용지 안이며, 같은 단 문항끼리 세로로 빈틈없이 이어진다.
 */
export function normalizeClusterColumns(
  clusters: ProblemCluster[],
  paper: PaperBounds,
): ProblemCluster[] {
  const pw = paper.Xmax - paper.Xmin;
  const ph = paper.Ymax - paper.Ymin;
  const midX = paper.Xmin + pw / 2;
  const cols: [ProblemCluster[], ProblemCluster[]] = [[], []];
  for (const c of clusters) {
    const cx = (c.bbox.minX + c.bbox.maxX) / 2;
    cols[cx < midX ? 0 : 1].push(c);
  }
  cols.forEach((col, ci) => {
    // 용지 끝까지 — 안쪽으로 물리면 바깥 여백이 죽은 구역이 된다
    const x0 = ci === 0 ? paper.Xmin : midX;
    const x1 = ci === 0 ? midX : paper.Xmax;
    col.sort((a, b) => a.bbox.minY - b.bbox.minY);
    col.forEach((c, i) => {
      c.bbox.minX = x0;
      c.bbox.maxX = x1;
      c.bbox.minY = Math.max(c.bbox.minY, paper.Ymin);
      const bottom =
        i + 1 < col.length
          ? col[i + 1].bbox.minY - ph * 0.004
          : paper.Ymax;
      c.bbox.maxY = Math.max(c.bbox.minY + ph * 0.02, bottom);
    });
  });
  return clusters;
}

/** 모델이 읽어 준 페이지 구조 (문제 줄·답란 줄 y 와 지문 정보) */
export type RawProblemStructure = {
  no?: number;
  column?: string;
  questionY?: number;
  /** 문제 번호가 인쇄된 x (0~1) — 채점 표시를 찍을 자리 */
  numberX?: number;
  /** 지문·보기가 끝나는 y (0~1) — 이 아래가 학생의 풀이 공간 */
  questionBottomY?: number;
  answerY?: number | null;
  points?: number | null;
  type?: string;
  question?: string;
  choices?: string[];
  /** 묶음 제목 — "1단계" 처럼 번호 위에 인쇄된 단계·유형 소제목 */
  group?: string;
  /** 단원명 — 리포트 정오 분석표용 */
  unit?: string;
  subUnit?: string;
  concept?: string;
  evalArea?: string;
  behaviorArea?: string;
  /** 국어·영어에서 이 문항이 딸린 지문의 첫 40자 (026) */
  passage?: string;
};

/**
 * 페이지 구조 → 문항 영역. **모델에게는 "줄의 y" 만 받고 사각형은 여기서 만든다.**
 *
 * 사각형을 통째로 물으면 답란을 빠뜨리거나(7번) 페이지 전체 높이 띠를 주는(8번)
 * 노이즈가 반복됐다. 시험지는 2단 고정 레이아웃이므로 다음 규칙이 훨씬 견고하다:
 *   - 가로: 소속 단 전체 폭 (용지 끝까지 — 바깥 여백도 포함)
 *   - 세로: 문제 번호 줄 ~ **같은 단 다음 문제 직전** (마지막 문제는 용지 맨 아래)
 *
 * 즉 **용지 전체가 문항들로 빈틈없이 덮인다.** 학생은 문제 옆·아래 빈 곳이면
 * 어디든 풀이를 쓰므로, 죽은 구역이 있으면 그 필기가 문항 그룹에서 빠진다.
 * (답란 줄 위치는 채점에 쓰이므로 meta.hasAnswerLine 으로만 남긴다.)
 */
export function buildClustersFromStructure(
  pageKey: string,
  items: RawProblemStructure[],
  paper: PaperBounds,
): ProblemCluster[] {
  const pw = paper.Xmax - paper.Xmin;
  const ph = paper.Ymax - paper.Ymin;
  const midX = paper.Xmin + pw / 2;

  const cols: Record<'left' | 'right', RawProblemStructure[]> = {
    left: [],
    right: [],
  };
  /**
   * 단(column) 판정 — **모델의 column 문자열보다 numberX 를 믿는다.**
   * 모델이 단을 잘못 말하면 왼쪽 문제가 오른쪽 단 아래로 가 엉뚱한 자리를
   * 차지한다(2026-08-25 사용자 신고: 2번이 4번 자리에). numberX 는 번호가
   * 인쇄된 x 좌표라 훨씬 객관적이다.
   */
  const sideOf = (p: RawProblemStructure): 'left' | 'right' => {
    if (typeof p.numberX === 'number' && p.numberX >= 0 && p.numberX <= 1) {
      return p.numberX >= 0.5 ? 'right' : 'left';
    }
    return (p.column ?? 'left').startsWith('r') ? 'right' : 'left';
  };
  const twoCol = items.some((p) => sideOf(p) === 'right');
  for (const p of items) {
    cols[twoCol ? sideOf(p) : 'left'].push(p);
  }

  const out: ProblemCluster[] = [];
  (['left', 'right'] as const).forEach((side) => {
    const list = cols[side]
      .slice()
      .sort((a, b) => (a.questionY ?? 0) - (b.questionY ?? 0));
    // 가로는 **용지 끝까지** 쓴다. 안쪽으로 물리면 그만큼 바깥 여백이 죽은
    // 구역이 되고, 거기 쓴 풀이가 문항에서 빠진다. 2단일 때 단 경계만 나눈다.
    const x0 = !twoCol ? paper.Xmin : side === 'left' ? paper.Xmin : midX;
    const x1 = !twoCol ? paper.Xmax : side === 'left' ? midX : paper.Xmax;

    list.forEach((p, i) => {
      const isFirst = i === 0;
      const isLast = i + 1 >= list.length;
      // 마지막 문제는 **용지 맨 아래까지** — 하단 여백에 쓴 풀이도 담기게.
      const nextY = isLast
        ? paper.Ymax
        : paper.Ymin + (list[i + 1].questionY ?? 1) * ph;
      const minY = paper.Ymin + (p.questionY ?? 0) * ph;
      // 답란이 있고, 문제 시작보다 아래이고, 다음 문제보다 위일 때만 신뢰한다
      const rawAnswer =
        typeof p.answerY === 'number' && p.answerY > 0 && p.answerY <= 1
          ? paper.Ymin + p.answerY * ph
          : null;
      const answerOk = rawAnswer != null && rawAnswer > minY && rawAnswer <= nextY;
      // 아래끝은 **항상 다음 문제 직전까지** — 답란 줄에서 자르지 않는다.
      //
      // 예전에는 답란이 있으면 그 줄 + 여유에서 끊었는데, 그러면 답란 아래·옆
      // 여백이 **어느 문항에도 속하지 않는 죽은 구역**이 된다. 학생은 문제 옆
      // 빈 곳이면 어디든 풀이를 쓰기 때문에(2026-08-14 5번 문항 오른쪽 여백에
      // 쓴 전개), 그 필기가 문항 그룹에서 통째로 빠졌다.
      // 같은 단에서 문항끼리 세로로 빈틈없이 이어지게 두면, 문제와 다음 문제
      // 사이의 모든 여백은 위 문제의 것이 된다 — 시험지에서 늘 참인 규칙이다.
      // (답란 위치는 채점에 여전히 쓰이므로 meta.hasAnswerLine 으로 남긴다.)
      //
      // 문항끼리 **딱 맞닿게** 둔다. 사이에 틈을 두면 그 얇은 띠가 죽은 구역이
      // 되어 하필 거기 걸친 획이 엉뚱한 문항으로 간다. 경계가 겹쳐도 배정은
      // 겹침 면적이 가장 큰 쪽을 고르므로 문제되지 않는다.
      const maxY = nextY;
      out.push({
        id: '',
        // 단계가 있는 시험지(단계형 테스트지)는 번호가 단계마다 1번부터 다시
        // 시작한다 — "1단계 1번" 처럼 묶어야 서로 구분된다 (사용자 2026-08-25).
        // 형식은 "1단계(기본)-1번" (사용자 지정 2026-08-25) — 단계가 없으면 "1번"
        label: p.group?.trim() ? `${p.group.trim()}-${p.no}번` : `${p.no}번`,
        strokeIds: [],
        bbox: {
          minX: x0,
          maxX: x1,
          // 단의 첫 문제는 용지 맨 위까지 늘려 위쪽 여백을 죽은 구역으로 두지
          // 않는다. **단, 그 문제가 실제로 페이지 위쪽에 있을 때만.**
          // 모델이 위 문제들을 놓치면 아래쪽 문제가 '첫 문제'가 되는데, 그때
          // 위로 늘리면 못 찾은 문제들의 자리를 통째로 삼킨다
          // (2026-08-17 실사고: 3번이 1·2번 영역까지 차지).
          minY:
            isFirst && (p.questionY ?? 1) < 0.25
              ? paper.Ymin
              : Math.max(minY, paper.Ymin),
          maxY: Math.max(minY + ph * 0.02, Math.min(maxY, paper.Ymax)),
        },
        meta: {
          no: Number(p.no),
          type: p.type === '주관식' ? '주관식' : '객관식',
          points: typeof p.points === 'number' && p.points > 0 ? p.points : 0,
          question: (p.question ?? '').slice(0, 400),
          choices: Array.isArray(p.choices) ? p.choices.slice(0, 8) : [],
          hasAnswerLine: answerOk,
          ...(p.group?.trim() ? { group: p.group.trim() } : {}),
          ...(p.unit?.trim() ? { unit: p.unit.trim() } : {}),
          ...(p.subUnit?.trim() ? { subUnit: p.subUnit.trim() } : {}),
          ...(p.concept?.trim() ? { concept: p.concept.trim() } : {}),
          ...(p.evalArea?.trim() ? { evalArea: p.evalArea.trim() } : {}),
          ...(p.behaviorArea?.trim() ? { behaviorArea: p.behaviorArea.trim() } : {}),
          ...(p.passage?.trim() ? { passage: p.passage.trim().slice(0, 80) } : {}),
          // 채점 표시 자리 — 모델이 준 번호 x 를 쓰되, 못 주면 단 왼쪽에서 살짝 안쪽
          numberX:
            typeof p.numberX === 'number' && p.numberX >= 0 && p.numberX <= 1
              ? paper.Xmin + p.numberX * pw
              : x0 + (x1 - x0) * 0.06,
          numberY: minY,
          // 풀이 공간 시작 — 지문이 끝나는 줄. 못 주면 문제 시작 아래 12% 지점으로
          // 어림한다(지문 두세 줄 분량). 답란보다 아래로는 못 간다.
          workTopY: (() => {
            const raw =
              typeof p.questionBottomY === 'number' &&
              p.questionBottomY > (p.questionY ?? 0) &&
              p.questionBottomY <= 1
                ? paper.Ymin + p.questionBottomY * ph
                : minY + ph * 0.12;
            const ceiling = answerOk ? rawAnswer! : maxY;
            return Math.min(Math.max(raw, minY), ceiling);
          })(),
          answerTopY: answerOk ? rawAnswer : null,
        },
      });
    });
  });

  // 번호 오름차순(같으면 왼쪽 단 먼저) → id 부여
  out.sort((a, b) => {
    const na = a.meta?.no ?? 0;
    const nb = b.meta?.no ?? 0;
    if (na !== nb) return na - nb;
    return a.bbox.minY - b.bbox.minY;
  });
  return out.map((c, i) => ({ ...c, id: `${pageKey}#${i}` }));
}
