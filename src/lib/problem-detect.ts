/**
 * 문항(문제) 단위 인식.
 *
 * 1순위 — **인쇄 문제 레이아웃 인식**: 교재(PDF) 배경 페이지 전체를 비전 LLM 에
 *   보여 "문제 번호 + 영역(bbox)"을 JSON 으로 받는다. 학생이 풀지 않은 문제까지
 *   전부 디텍션되고, 각 문제 bbox 안의 스트로크가 그 문제의 "풀이"로 귀속된다.
 * 폴백 — 배경이 없으면(미등록 연습장) 스트로크 공간 클러스터링 + 조각 라벨링.
 *
 * 결과는 storage(`{studentId}/{submissionId}.problems.json`)에 캐시된다.
 */
import type { Stroke } from '@/pen/live/model/stroke';
import { allCurriculumUnits } from './curriculum';
import { listMyPaperMeta } from './paper-owners';
import {
  effectiveSubject,
  subjectDetectionRules,
  type PaperSubject,
} from './paper-subject';
import { repairModelJson } from './json-repair';
import { lookupNcodeEntry, usePaperStore } from '@/store/paper.store';
import { clampRectToPaper, sanitizeStrokes } from '@/lib/stroke-sanitize';
import {
  assignStrokesToClusters,
  buildClustersFromStructure,
  strokeBBox,
  unionBox,
} from './problem-assign';

export { assignStrokesToClusters } from './problem-assign';
import { recognizeImage } from '@/lib/api';
import { downloadJsonObject, uploadJsonObject } from '@/lib/strokes-io';

/**
 * 페이지 문항들에 현재 획을 **결정적으로** 배정한다.
 *
 * 화면(ReviewPage)·자동 채점 파이프라인·채점 루프가 **전부 이 한 함수**를 써야
 * 한다. 배정이 조금만 달라도 채점 서명(sig)이 어긋나 이미 채점한 문항을 또
 * 채점한다 — "완료된 걸 또 채점, 토큰 낭비" 실사고(2026-08-19).
 * 용지(= 문항 박스 합집합) 밖 노이즈 dot 을 걸러 배정한다.
 */
/**
 * 문항 화면·채점·문항분석이 함께 쓰는 **문항 범위 획** — 배정된 획 ∪ 영역 안
 * 실물(중간점 포함) 합집합. 배정이 어긋나도 눈에 보이는 필기는 문항에 나와야
 * 하고("전체에선 보이는데 문항에선 풀이 없음" 실사고 2026-08-19), 화면과
 * 파이프라인이 같은 집합을 써야 분석 범위가 일치한다.
 */
export function problemScopeStrokes<S extends Stroke>(
  cluster: Pick<ProblemCluster, 'strokeIds' | 'bbox'>,
  pageStrokes: readonly S[],
): S[] {
  const ids = new Set(cluster.strokeIds);
  const b = cluster.bbox;
  return pageStrokes.filter((s) => {
    if (ids.has(s.id)) return true;
    const d = s.dots[Math.floor(s.dots.length / 2)];
    return (
      !!d && d.x >= b.minX && d.x <= b.maxX && d.y >= b.minY && d.y <= b.maxY
    );
  });
}

export function reassignClusters(
  clusters: ProblemCluster[],
  strokes: readonly Stroke[],
): ProblemCluster[] {
  if (clusters.length === 0) return clusters;
  const paper = {
    Xmin: Math.min(...clusters.map((c) => c.bbox.minX)),
    Xmax: Math.max(...clusters.map((c) => c.bbox.maxX)),
    Ymin: Math.min(...clusters.map((c) => c.bbox.minY)),
    Ymax: Math.max(...clusters.map((c) => c.bbox.maxY)),
  };
  return assignStrokesToClusters(clusters, sanitizeStrokes(strokes, paper));
}

export type ProblemBBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type ProblemCluster = {
  /** `${pageKey}#${index}` */
  id: string;
  /** '3번' 또는 '영역 2'(번호 인식 실패 시) */
  label: string;
  strokeIds: string[];
  /** ncode 좌표 bbox */
  bbox: ProblemBBox;
  /** 인쇄 지문에서 읽어낸 문제 정보 (채점·분석 근거). v3 부터 */
  meta?: ProblemMeta;
};

/** 페이지 구조 인식으로 얻은 문제 정보 — 채점(정답 판정)의 입력이 된다 */
export type ProblemMeta = {
  no: number;
  /** '객관식' | '주관식' */
  type: string;
  /** 배점 (지문에 명시가 없으면 페이지에서 균등 배분) */
  points: number;
  /** 문제 지문 (정답을 도출하기에 충분하게) */
  question: string;
  /** 객관식 보기 — 주관식이면 빈 배열 */
  choices: string[];
  /** 답란("답:" 줄)이 이 문제 영역 안에 있었는가 */
  hasAnswerLine: boolean;
  /** 이 문제가 속한 묶음 제목 — 단계형 테스트지의 "1단계" 처럼 번호 위에 인쇄된
   *  단계·유형 소제목 (사용자 요구 2026-08-25). 없으면 undefined. */
  group?: string;
  /** 국어·영어에서 이 문항이 딸린 **지문의 첫 40자** (026). 같은 지문에 매달린
   *  문항끼리 같은 값을 갖는다 — 분석이 "이 지문의 3번" 을 알 수 있게. */
  passage?: string;
  /** 이 문제가 다루는 단원 — 리포트의 정오 분석표에 쓴다 */
  unit?: string;
  /** 단원의 **세부내용** — 시험지에 단원명과 함께 인쇄돼 있으면 그것 그대로
   *  (예: 단원 "비와 비율" / 세부 "비율을 백분율로 나타내기"). 2026-08-25 */
  subUnit?: string;
  /** 핵심 개념 한 줄 (예: "지수법칙을 이용한 수의 대소 비교") — 취약 유형 분석용 */
  concept?: string;
  /** 평가 영역 — '개념 이해 및 접근력' | '종합 응용 및 추론력' (리포트 축) */
  evalArea?: string;
  /** 행동 영역 — '계산력' | '추론력' | '문제해결력' | '이해력' (리포트 축) */
  behaviorArea?: string;
  /** 인쇄된 **문제 번호의 위치**(ncode 좌표) — 채점 ○/✗ 를 여기에 찍는다.
   *  영역 좌상단이 아니다: 영역은 용지를 빈틈없이 덮으므로 좌상단은 여백이다. */
  numberX: number;
  numberY: number;
  /** 시험지 3구역의 세로 경계 (ncode 좌표).
   *  문제 = numberY~workTopY / 풀이 공간 = workTopY~answerTopY / 답란 = answerTopY 아래.
   *  학생이 **어느 공간에 썼는지**를 판단하는 근거다. */
  workTopY: number;
  answerTopY: number | null;
};

/** v3 (2026-08-13): 구조 인식(문제줄 y·답란 y·지문·보기·배점)으로 재설계.
 *  v11 (2026-08-18): 성공-빈결과([])와 실패(null) 구분 — 표지가 획 폴백으로
 *  "영역 1" 이 되던 사고. 빈 배열도 캐시로 존중한다.
 *  v10 (2026-08-18): v9 의 LaTeX 강제가 JSON 을 깨 감지가 획 폴백("영역 N")
 *  으로 떨어진 사고 — repairModelJson 으로 수리하고 오염 캐시를 무효화한다.
 *  v9 (2026-08-18): 지문·보기 수식을 LaTeX($…$)로 강제 — "7 2/9" 처럼
 *  평문으로 옮겨져 미리보기가 수식으로 렌더링되지 않던 문제.
 *  v8 (2026-08-18): 수학 문제 없는 페이지(표지·정보 기입란) 판별 — 표지의
 *  이름 칸을 문항으로 오인한 실사고("6-1(A형) 표지" 1페이지).
 *  v7 (2026-08-17): 페이지 이미지에 **좌표 눈금자**를 얹어 y 오차를 잡음.
 *  v6 까지는 모델이 눈대중한 y 가 아래로 갈수록 위로 밀려(3번 −15%p, 6번 −18%p)
 *  문항 경계가 앞 문제 답란 위에서 시작했다. 실측 A/B: 평균 오차 9.2%p → 0.8%p.
 *  옛 캐시는 틀어진 좌표를 그대로 들고 있어 폐기한다.
 *  v6 (2026-08-17): 배정 상한을 자기 번호 줄로 자름 — v5 캐시에는 앞 문제의
 *  필기를 가져간 배정(strokeIds)이 그대로 저장돼 있어 폐기한다.
 *  v5 (2026-08-17): 문제 번호 위치(numberX/Y)와 3구역 경계(workTopY/answerTopY)
 *  추가 — 채점 표시를 번호 옆에 찍고, 학생이 문제·풀이·답란 중 어디에 썼는지
 *  구분한다. 옛 캐시에는 이 값이 없어 폐기하고 재인식한다.
 *  v4 (2026-08-14): 문항 영역이 **용지를 빈틈없이 덮도록** 규칙 변경 —
 *  예전 규칙은 "답:" 줄에서 자르고 좌우도 1% 물려서, 그 바깥 여백에 쓴 풀이가
 *  어느 문항에도 안 잡혔다(5번 오른쪽 여백 실사고). 옛 캐시는 그 잘린 영역을
 *  그대로 들고 있으므로 폐기하고 자동 재인식한다. */
export type ProblemsCache = {
  v: 11;
  byPage: Record<string, ProblemCluster[]>;
};

export function problemsCachePath(
  studentId: string,
  submissionId: string,
): string {
  return `${studentId}/${submissionId}.problems.json`;
}

export async function loadProblemsCache(
  studentId: string,
  submissionId: string,
): Promise<ProblemsCache | null> {
  const doc = await downloadJsonObject<ProblemsCache | null>(
    problemsCachePath(studentId, submissionId),
  ).catch(() => null);
  return doc && doc.v === 11 ? doc : null;
}

/** 수동 편집(영역 추가·삭제·라벨 변경) 결과 저장 — AI 재인식 시에도 이 캐시가 기준 */
export async function saveProblems(
  studentId: string,
  submissionId: string,
  byPage: Record<string, ProblemCluster[]>,
): Promise<void> {
  await uploadJsonObject(problemsCachePath(studentId, submissionId), {
    v: 11,
    byPage,
  } satisfies ProblemsCache);
}



/**
 * 공간 클러스터링 — 시험지 2단(좌/우 열) 구성을 가정하고, 열 안에서
 * 세로 간격이 벌어지면 다른 문항으로 나눈다. 좌표계는 ncode.
 * pageBounds 가 있으면(등록 교재) 그 기준으로, 없으면 스트로크 범위 기준.
 */
export function clusterStrokes(
  pageKey: string,
  strokes: Stroke[],
  pageBounds?: { Xmin: number; Xmax: number; Ymin: number; Ymax: number } | null,
): ProblemCluster[] {
  if (strokes.length === 0) return [];
  const boxes = strokes.map((s) => ({ s, b: strokeBBox(s) }));
  const ext = pageBounds
    ? { minX: pageBounds.Xmin, maxX: pageBounds.Xmax, minY: pageBounds.Ymin, maxY: pageBounds.Ymax }
    : boxes.reduce((acc, x) => unionBox(acc, x.b), boxes[0].b);
  const pageW = Math.max(1e-6, ext.maxX - ext.minX);
  const pageH = Math.max(1e-6, ext.maxY - ext.minY);
  const midX = ext.minX + pageW / 2;
  // 세로 간격 임계 — 문항 사이 여백(페이지 높이의 ~4.5%)
  const gapY = pageH * 0.045;

  type Work = { boxes: ProblemBBox; strokes: Stroke[] };
  const columns: Record<'L' | 'R', Array<{ s: Stroke; b: ProblemBBox }>> = {
    L: [],
    R: [],
  };
  for (const x of boxes) {
    const cx = (x.b.minX + x.b.maxX) / 2;
    columns[cx < midX ? 'L' : 'R'].push(x);
  }

  const out: ProblemCluster[] = [];
  for (const col of ['L', 'R'] as const) {
    const list = columns[col].sort((a, b) => a.b.minY - b.b.minY);
    let cur: Work | null = null;
    const flush = () => {
      if (cur) {
        out.push({
          id: '',
          label: '',
          strokeIds: cur.strokes.map((s) => s.id),
          bbox: cur.boxes,
        });
        cur = null;
      }
    };
    for (const x of list) {
      if (cur && x.b.minY - cur.boxes.maxY <= gapY) {
        cur.boxes = unionBox(cur.boxes, x.b);
        cur.strokes.push(x.s);
      } else {
        flush();
        cur = { boxes: x.b, strokes: [x.s] };
      }
    }
    flush();
  }
  // (열, y) 순 정렬 후 id 부여
  out.sort((a, b) => {
    const ca = (a.bbox.minX + a.bbox.maxX) / 2 < midX ? 0 : 1;
    const cb = (b.bbox.minX + b.bbox.maxX) / 2 < midX ? 0 : 1;
    if (ca !== cb) return ca - cb;
    return a.bbox.minY - b.bbox.minY;
  });
  return out.map((c, i) => ({ ...c, id: `${pageKey}#${i}`, label: `영역 ${i + 1}` }));
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 문항 영역의 배경(교재)+필기 합성 조각 이미지(dataURL)를 만든다.
 * 번호 라벨링과 문항 단위 OCR(지문+풀이 인식)이 공유한다.
 * 배경이 없으면 null — 호출부가 스트로크 전용 렌더로 폴백한다.
 */
export async function renderProblemRegionImage(args: {
  page: { section: number; owner: number; noteId: number; pageNumber: number };
  bbox: ProblemBBox;
  /** 페이지 전체 스트로크 — includeStrokeIds 에 든 것만 오버레이 */
  strokes: Stroke[];
  includeStrokeIds: readonly string[];
  /** 영역 확장 비율 (왼쪽에 인쇄된 문제 번호·지문 포함용) */
  expand?: { left: number; top: number; right: number; bottom: number };
  /** 이 문항의 문제 번호 줄 y — 합집합·확장이 이 위로 못 올라가게 막는다.
   *  없으면 제한 없음(옛 캐시 호환). */
  topLimit?: number;
  maxWidth?: number;
}): Promise<string | null> {
  const { page, strokes: rawStrokes, includeStrokeIds } = args;
  const expand = args.expand ?? { left: 0.14, top: 0.05, right: 0.03, bottom: 0.02 };
  /** 이 문항의 윗변 한계 — 자기 문제 번호 줄. 위로 넘으면 앞 문제를 읽는다. */
  const topLimit = args.topLimit;
  try {
    const entry = await usePaperStore
      .getState()
      .ensurePaper(page.section, page.owner, page.noteId, page.pageNumber);
    if (!entry.image || !entry.paperSize) return null;
    const { image, paperSize } = entry;
    // 용지 밖 노이즈 dot 제거 — 이걸 안 하면 아래 합집합이 폭발한다
    const strokes = sanitizeStrokes(rawStrokes, paperSize);
    // 문항 영역 = 인식된 사각형 ∪ 이 문항에 배정된 모든 필기의 범위(용지 안).
    // 풀이가 영역 밖(멀리 떨어진 답란·여백)으로 나가도 이미지에 전부 담긴다 —
    // 안 담으면 화면·OCR·분석이 학생 필기 일부를 못 본다 (2026-08-13 p.5 3번 실사고).
    let bbox = args.bbox;
    if (includeStrokeIds && includeStrokeIds.length > 0) {
      const ids = new Set(includeStrokeIds);
      for (const s of strokes) {
        if (ids.has(s.id)) bbox = unionBox(bbox, strokeBBox(s));
      }
      bbox = clampRectToPaper(bbox, paperSize);
      // 위로는 자기 번호 줄까지만 — 넘으면 앞 문제 지문·풀이가 이미지에 들어와
      // OCR·분석이 남의 문제를 읽는다 (2026-08-17)
      if (topLimit != null && Number.isFinite(topLimit)) {
        bbox = { ...bbox, minY: Math.max(bbox.minY, topLimit) };
      }
    }
    const pw = paperSize.Xmax - paperSize.Xmin;
    const ph = paperSize.Ymax - paperSize.Ymin;
    const sx = image.naturalWidth / pw;
    const sy = image.naturalHeight / ph;
    const ex: ProblemBBox = {
      minX: clamp(bbox.minX - pw * expand.left, paperSize.Xmin, paperSize.Xmax),
      minY: clamp(bbox.minY - ph * expand.top, paperSize.Ymin, paperSize.Ymax),
      maxX: clamp(bbox.maxX + pw * expand.right, paperSize.Xmin, paperSize.Xmax),
      maxY: clamp(bbox.maxY + ph * expand.bottom, paperSize.Ymin, paperSize.Ymax),
    };
    const px = (ex.minX - paperSize.Xmin) * sx;
    const py = (ex.minY - paperSize.Ymin) * sy;
    const cw = Math.max(8, (ex.maxX - ex.minX) * sx);
    const chh = Math.max(8, (ex.maxY - ex.minY) * sy);
    const canvas = document.createElement('canvas');
    // LLM 입력 크기 제한
    const scale = Math.min(1, (args.maxWidth ?? 900) / cw);
    canvas.width = Math.round(cw * scale);
    canvas.height = Math.round(chh * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, px, py, cw, chh, 0, 0, canvas.width, canvas.height);
    // 필기 오버레이(파란 얇은 선) — 인쇄 지문과 학생 필기를 구분
    ctx.strokeStyle = 'rgba(35,80,220,0.85)';
    ctx.lineWidth = Math.max(1, 1.2 * scale);
    ctx.lineCap = 'round';
    const include = new Set(includeStrokeIds);
    for (const s of strokes) {
      if (!include.has(s.id)) continue;
      ctx.beginPath();
      s.dots.forEach((d, i) => {
        const x = ((d.x - paperSize.Xmin) * sx - px) * scale;
        const y = ((d.y - paperSize.Ymin) * sy - py) * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * 좌표 눈금자를 이미지에 그린다 — **비전 모델의 y 좌표 오차를 잡는 핵심 장치.**
 *
 * 실측(2026-08-17, 중1-1 A형 p.1): 모델이 준 questionY 가 페이지 아래로 갈수록
 * 위로 밀렸다 — 2번 −6%p, 3번 −8%p, 6번 −12%p. 그 결과 3번 영역이 2번 답란보다
 * 위에서 시작해 **2번의 답이 3번 것으로 잡혔다**(사용자 지적).
 *
 * 모델은 "이미지의 몇 % 지점"을 눈대중하는 데 약하지만, **그려진 눈금을 읽는
 * 것은 잘한다.** 그래서 좌우 가장자리에 0.00~1.00 눈금선과 숫자를 얹고,
 * 프롬프트에서 "눈금을 읽어서 답하라"고 지시한다.
 */
function drawRuler(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const band = Math.max(34, Math.round(w * 0.035));
  ctx.save();
  // 눈금 띠 — 지문을 가리지 않게 좌우 바깥쪽에만 얹는다
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 0, band, h);
  ctx.fillRect(w - band, 0, band, h);
  ctx.font = `${Math.max(11, Math.round(band * 0.34))}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  // 2.5% 간격으로 긋고 5% 마다 숫자 — 모델은 **숫자가 붙은 선**에 스냅하므로
  // 숫자 간격이 곧 해상도다. 5%(=1.3%p 오차)면 문항 경계로 충분하다.
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const y = Math.round(t * h) + 0.5;
    const major = i % 2 === 0;
    ctx.strokeStyle = major ? 'rgba(220,0,0,0.55)' : 'rgba(220,0,0,0.22)';
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    if (major) {
      const label = t.toFixed(2);
      ctx.fillStyle = '#c00000';
      ctx.textAlign = 'left';
      ctx.fillText(label, 3, Math.min(h - 8, Math.max(8, y)));
      ctx.textAlign = 'right';
      ctx.fillText(label, w - 3, Math.min(h - 8, Math.max(8, y)));
    }
  }
  ctx.restore();
}

/** 페이지 배경 전체 이미지(dataURL) — 인쇄 문제 레이아웃 인식용 */
async function renderFullPageImage(page: {
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
}): Promise<{
  dataUrl: string;
  paperSize: { Xmin: number; Xmax: number; Ymin: number; Ymax: number };
} | null> {
  try {
    const entry = await usePaperStore
      .getState()
      .ensurePaper(page.section, page.owner, page.noteId, page.pageNumber);
    if (!entry.image || !entry.paperSize) return null;
    const { image, paperSize } = entry;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1200 / image.naturalWidth);
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawRuler(ctx, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), paperSize };
  } catch {
    return null;
  }
}

/**
 * 인쇄 문제 레이아웃 인식 — 배경 페이지에서 "문제 번호 + 영역"을 직접 찾는다.
 * 성공 시 각 문제 bbox 안의 스트로크를 그 문제의 풀이로 귀속해 클러스터를 만든다.
 * (학생이 손대지 않은 문제도 strokeIds=[] 로 디텍션된다)
 */
/**
 * 이 ncode 페이지가 속한 교재의 **과목**. 못 찾으면 수학(옛 교재 전부 수학).
 *
 * 인식은 페이지(ncode) 단위인데 과목은 교재(pdfId) 속성이라 한 번 건너뛴다.
 * 메타는 페이지마다 다시 읽지 않고 프로세스 수명 동안 캐시한다 — 한 제출을
 * 훑는 동안 수십 번 불린다.
 */
let subjectCache: { at: number; map: Map<number, PaperSubject | null> } | null = null;
const SUBJECT_TTL_MS = 60_000;

export function clearPaperSubjectCache() {
  subjectCache = null;
}

export async function subjectForNcodePage(page: {
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
}): Promise<PaperSubject> {
  try {
    const entry = await lookupNcodeEntry(
      page.section,
      page.owner,
      page.noteId,
      page.pageNumber,
    );
    if (!entry) return '수학';
    if (!subjectCache || Date.now() - subjectCache.at > SUBJECT_TTL_MS) {
      const meta = await listMyPaperMeta();
      subjectCache = {
        at: Date.now(),
        map: new Map([...meta.entries()].map(([id, m]) => [id, m.subject])),
      };
    }
    return effectiveSubject(subjectCache.map.get(entry.pdfId));
  } catch {
    return '수학';
  }
}

export async function detectPrintedProblems(
  pageKey: string,
  page: { section: number; owner: number; noteId: number; pageNumber: number },
  strokes: Stroke[],
  /** 교재 과목 (026). 안 주면 ncode 로 교재를 찾아 읽고, 그래도 없으면 수학. */
  subjectHint?: PaperSubject | null,
): Promise<ProblemCluster[] | null> {
  const rendered = await renderFullPageImage(page);
  if (!rendered) return null;
  const { dataUrl, paperSize } = rendered;
  // 과목을 모르고 수학용 프롬프트로 물으면 국어·영어·과학 시험지는 모델이 지시대로
  // 빈 목록을 돌려준다 — 문항 0개로 채점·분석이 통째로 죽던 원인(2026-09-04).
  const subject = subjectHint ?? (await subjectForNcodePage(page));
  const rules = subjectDetectionRules(subject);

  /** 모델이 주는 페이지 구조 — 좌표는 "줄의 y" 하나씩만 받는다(사각형 X) */
  type RawProblem = {
    no?: number;
    column?: string;
    questionY?: number;
    answerY?: number | null;
    points?: number | null;
    type?: string;
    question?: string;
    choices?: string[];
    group?: string;
    unit?: string;
    subUnit?: string;
    concept?: string;
    evalArea?: string;
    behaviorArea?: string;
    passage?: string;
  };
  let items: RawProblem[];
  try {
    const { text } = await recognizeImage(
      dataUrl,
      [
        rules.intro,
        '',
        `⚠️ **먼저 이 페이지에 실제 ${rules.noun}가 있는지 판단하세요.**`,
        '표지, 학생 정보 기입란(이름/날짜/점수 쓰는 칸), 목차, 안내문, 채점 기준표처럼',
        `**풀어야 할 ${rules.noun}가 없는 페이지면 {"problems":[]} 만 답하세요.**`,
        ...rules.shape,
        '',
        `${rules.noun}가 있으면, 페이지 구조를 분석해 각 문제의`,
        '**① 번호 ② 번호가 인쇄된 위치 ③ 지문이 끝나는 줄 ④ 답을 쓰는 줄',
        '⑤ 배점 ⑥ 지문 ⑦ 보기**를 찾아주세요.',
        '',
        '아래 JSON 형식으로만 답하세요 (설명·마크다운 금지):',
        '{"problems":[{"no":8,"column":"left","questionY":0.42,"numberX":0.08,' +
          '"questionBottomY":0.52,"answerY":0.66,' +
          '"points":10,"type":"객관식","question":"정비례 관계 y=-3x 의 그래프에 대한 설명으로 옳지 않은 것을 고르시오",' +
          '"choices":["원점을 지난다","제2사분면과 제4사분면을 지난다"]}]}',
        '',
        '규칙:',
        '⚠️ 이미지에는 **빨간 가로 눈금선과 0.00~1.00 숫자**가 그려져 있습니다.',
        '   y 값을 눈대중하지 말고 **반드시 그 눈금을 읽어서** 답하세요.',
        '   (예: "3." 이 0.60 선과 0.65 선 사이 중간이면 0.62 로 답합니다.)',
        '   눈금을 무시하고 어림하면 아래쪽 문제일수록 값이 위로 밀립니다.',
        '- questionY = **문제 번호("8.")가 인쇄된 줄의 맨 위** y (이미지 높이 대비 0~1).',
        '  풀이 공백이나 위 문제의 답란을 포함하지 마세요 — 오직 그 문제 지문이 시작하는 줄입니다.',
        '- numberX = **문제 번호("8.")가 인쇄된 x** (이미지 폭 대비 0~1). 번호 글자의 왼쪽 끝입니다.',
        '- questionBottomY = **지문·보기가 끝나는 줄** y. 이 아래부터 학생이 푸는 빈 공간입니다.',
        '  (보기 상자가 있으면 상자 아래끝. 지문만 있으면 지문 마지막 줄 아래.)',
        '- answerY = 그 문제의 **"답:" 밑줄이 인쇄된 줄** y. 답란이 없으면 null.',
        '  답란은 풀이 공간 아래에 멀리 떨어져 있을 수 있습니다. 반드시 그 문제의 것을 찾으세요',
        '  (아래에 있는 다음 문제 번호보다 위에 있는 "답:" 줄이 그 문제의 답란입니다).',
        '- column = 2단 구성이면 "left"/"right", 1단이면 모두 "left".',
        '- points = 배점. 페이지에 "각 문항 10점" 같은 표기가 있으면 그 값, 없으면 null.',
        '- question = 정답을 도출할 수 있을 만큼 지문을 그대로 옮기세요(300자 이내).',
        '  ⚠️ **수식은 반드시 LaTeX 로 쓰고 $…$ 로 감싸세요** — 화면에 수식으로',
        '  렌더링됩니다. 대분수 $7\\frac{2}{9}$, 나눗셈 $\\div$, 곱셈 $\\times$,',
        '  분수 $\\frac{a}{b}$, 제곱근 $\\sqrt{2}$ 처럼요. "7 2/9" 같은 평문 금지.',
        '- choices = 객관식 보기 텍스트 배열(①②③④⑤ 순서). 주관식이면 [].',
        '  보기 안의 수식도 같은 규칙으로 $…$ LaTeX 로 쓰세요.',
        '  JSON 문자열 안의 백슬래시는 이중으로 쓰세요: "$7\\\\frac{2}{9}$".',
        '- type = "객관식" 또는 "주관식".',
        '- group = 이 문제 위에 인쇄된 **묶음 제목**이 있으면 그 텍스트 그대로',
        '  (예: "1단계", "2단계", "STEP 1", "유형 3"). 페이지가 그런 단계로 나뉘어',
        '  있으면 각 문제가 어느 단계에 속하는지 반드시 채우세요. 없으면 생략.',
        '  ⚠️ 단계가 나뉜 시험지는 **번호가 단계마다 1번부터 다시 시작**합니다 —',
        '  번호만으로는 구분이 안 되므로 group 이 중요합니다.',
        '- unit = 이 문제가 다루는 **단원명**. 아래 목록에 있는 이름을 **그대로** 쓰세요.',
        `  [단원 목록] ${allCurriculumUnits().join(' / ')}`,
        '  목록에 맞는 단원이 없거나 판단이 어려우면 **빈 문자열**로 두세요.',
        '  ⚠️ 목록에 없는 이름을 지어내지 마세요.',
        '- subUnit = 시험지에 단원명과 함께 **인쇄된 세부내용**이 있으면 그대로 옮기세요',
        '  (예: 단원 "비와 비율" 아래 "비율을 백분율로 나타내기"). 인쇄돼 있지 않으면',
        '  **빈 문자열**로 두세요 — 추측해서 만들지 마세요.',
        '- concept = 이 문제의 **핵심 개념** 한 줄 (예: "지수법칙을 이용한 수의 대소 비교",',
        '  "연립방정식의 해와 계수의 관계"). 단원보다 좁고 구체적으로 씁니다.',
        '- evalArea = **"개념 이해 및 접근력"** 또는 **"종합 응용 및 추론력"** 둘 중 하나.',
        '  한 개념을 알면 바로 풀리는 문제는 앞쪽, 여러 개념을 엮거나 조건을 해석해야',
        '  하는 문제는 뒤쪽입니다.',
        '- behaviorArea = **"계산력" / "추론력" / "문제해결력" / "이해력"** 중 하나.',
        '  계산 수행이 핵심이면 계산력, 논리 전개면 추론력, 상황을 식으로 옮겨 해결하면',
        '  문제해결력, 개념 뜻을 아는지 묻는 문제면 이해력입니다.',
        ...rules.extra,
        '- 페이지에 있는 **모든 문제**를 왼쪽 단 → 오른쪽 단, 위에서 아래 순서로 빠짐없이.',
      ].join('\n'),
    );
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();
    // LaTeX 백슬래시는 JSON 을 조용히/시끄럽게 깨뜨린다 — 항상 수리 후 파싱
    const parsed = JSON.parse(repairModelJson(cleaned)) as { problems?: RawProblem[] };
    items = (parsed.problems ?? []).filter(
      (p) =>
        p &&
        Number.isFinite(p.no) &&
        typeof p.questionY === 'number' &&
        p.questionY >= 0 &&
        p.questionY <= 1,
    );
  } catch {
    return null;
  }
  if (items.length === 0) return null;

  const clusters = buildClustersFromStructure(pageKey, items, paperSize);

  // 용지 밖 노이즈 dot 제거 후 배정 — 노이즈 한 점이 획 bbox 를 페이지 밖까지
  // 늘려 겹침 면적 판정을 통째로 뒤집는다 (2026-08-13 실사고)
  return assignStrokesToClusters(clusters, sanitizeStrokes(strokes, paperSize));
}

/**
 * 스트로크 → 가장 잘 겹치는 문제로 귀속 (중심점 포함 우선, 없으면 최근접).
 * 낙서·흔적도 전부 어느 문항엔가 붙는다 — 거리 컷오프 없음(낙서도 분석 대상).
 *
 * **캐시 복원 시에도 반드시 다시 호출할 것**: 문항 bbox 캐시는 디텍션 시점의
 * 획 배정을 담고 있어, 이후 재수신으로 늘어난 획(낙서 포함)이 "풀이 없음"으로
 * 잘못 남는 실사고가 있었다 (2026-08-13 중1-1 1·2·4·5번).
 */


/**
 * 클러스터 영역의 배경+필기 합성 조각을 만들어 비전 LLM 에게
 * 문제 번호를 물어본다. 배경이 없으면 null(라벨 실패).
 */
async function labelCluster(
  page: { section: number; owner: number; noteId: number; pageNumber: number },
  cluster: ProblemCluster,
  strokes: Stroke[],
): Promise<string | null> {
  try {
    const dataUrl = await renderProblemRegionImage({
      page,
      bbox: cluster.bbox,
      strokes,
      includeStrokeIds: cluster.strokeIds,
      topLimit: cluster.meta?.numberY,
    });
    if (!dataUrl) return null;
    const { text } = await recognizeImage(
      dataUrl,
      '이 이미지는 시험지의 일부이고, 파란 선은 학생의 필기 위치입니다. 학생이 풀고 있는 문제의 번호를 찾아 숫자 하나만 답하세요 (예: 3). 알 수 없으면 ? 만 답하세요.',
    );
    const m = text.match(/\d{1,2}/);
    return m ? `${m[0]}번` : null;
  } catch {
    return null;
  }
}

/**
 * 페이지의 문항 인식(캐시 우선). force=true 면 다시 인식.
 */
export async function detectProblemsForPage(args: {
  studentId: string;
  submissionId: string;
  pageKey: string;
  page: { section: number; owner: number; noteId: number; pageNumber: number };
  strokes: Stroke[];
  force?: boolean;
}): Promise<ProblemCluster[]> {
  const { studentId, submissionId, pageKey, page, strokes, force } = args;
  const cache = await loadProblemsCache(studentId, submissionId);
  // 빈 배열도 유효한 캐시다 — "이 페이지엔 수학 문제 없음"(표지 등).
  // length 로 걸면 표지를 열 때마다 재인식 + 획 폴백이 돌았다.
  if (!force && cache && pageKey in cache.byPage) return cache.byPage[pageKey];

  // 1순위: 인쇄 문제 레이아웃 인식 (문제 번호·영역을 배경에서 직접)
  let clusters = await detectPrintedProblems(pageKey, page, strokes).catch(
    () => null,
  );

  // 🚨 **성공-빈결과와 실패를 구분한다** (2026-08-18 실사고: 표지가 "영역 1").
  // [] = 모델이 페이지를 보고 "수학 문제 없음" 이라 답한 것 — 그대로 믿는다.
  // 문항 개수는 **PDF 에 문제번호+문제가 있는 경우만** 세는 것이 정의다.
  // null = 배경 없음·호출 실패 — 그때만 획 폴백(미등록 연습장용)으로 간다.
  if (clusters === null) {
    let bounds: { Xmin: number; Xmax: number; Ymin: number; Ymax: number } | null =
      null;
    try {
      const entry = await usePaperStore
        .getState()
        .ensurePaper(page.section, page.owner, page.noteId, page.pageNumber);
      bounds = entry.paperSize ?? null;
    } catch {
      /* 미등록 노트 — 스트로크 범위 기준 */
    }
    // 폴백 경로도 정제된 좌표로 — 노이즈 dot 이 클러스터 범위를 늘리지 않게
    const clean = sanitizeStrokes(strokes, bounds);
    clusters = clusterStrokes(pageKey, clean, bounds);
    for (const c of clusters) {
      const label = await labelCluster(page, c, clean);
      if (label) c.label = label;
    }
  }

  const next: ProblemsCache = {
    v: 11,
    byPage: { ...(cache?.byPage ?? {}), [pageKey]: clusters },
  };
  await uploadJsonObject(problemsCachePath(studentId, submissionId), next).catch(
    () => {},
  );
  return clusters;
}
