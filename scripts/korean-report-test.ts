/**
 * 국어 리포트 요약(koreanSummary) 회귀 테스트.
 *
 * 리포트 화면의 세 구역(5-Depth 성취 · 행동 트렌드 · 산점도)이 전부 이 요약에
 * 기댄다. 공유 링크는 원본을 못 읽고 **문서에 박힌 이 값만** 본다 — 여기가
 * 어긋나면 학부모 화면이 통째로 틀린다. 생성(LLM)은 부르지 않는다.
 */
import {
  buildKoreanSummary,
  toRevisionKind,
  type KoreanSummaryInput,
} from '../src/lib/korean-report';
import type { KoreanDepthScore } from '../src/lib/korean-analysis';

let fail = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}
function eq(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${a} !== ${b}`);
}
function ok(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const D = (
  depth: 1 | 2 | 3 | 4 | 5,
  verdict: KoreanDepthScore['verdict'],
): KoreanDepthScore => ({ depth, verdict, note: `${depth} 근거` });

/** 문항 5개 — 서술형(Depth 판정 있음) 셋, 객관식(판정 없음) 하나, 국어 값 없는 하나 */
const PROBLEMS: KoreanSummaryInput[] = [
  {
    label: '1번',
    verdict: 'correct',
    activeMs: 10_000,
    spanMs: 12_000,
    attempts: 1,
    revisits: 0,
    korean: {
      area: '독서',
      depths: [D(1, 'met'), D(2, 'met'), D(3, 'na'), D(4, 'met'), D(5, 'met')],
      confidence: 'high',
      revision: 'none',
    },
  },
  {
    label: '2번',
    verdict: 'wrong',
    activeMs: 20_000,
    spanMs: 30_000,
    attempts: 2,
    revisits: 1,
    korean: {
      area: '문학',
      depths: [
        D(1, 'met'),
        D(2, 'missed'),
        D(3, 'partial'),
        D(4, 'missed'),
        D(5, 'missed'),
      ],
      confidence: 'low',
      revision: 'right_to_wrong',
    },
  },
  {
    // 맞혔지만 85초를 멈칫한 문항 — 숨은 킬러
    label: '3번',
    verdict: 'correct',
    activeMs: 15_000,
    spanMs: 100_000,
    attempts: 3,
    revisits: 2,
    korean: {
      area: '독서',
      depths: [
        D(1, 'met'),
        D(2, 'partial'),
        D(3, 'met'),
        D(4, 'met'),
        D(5, 'partial'),
      ],
      confidence: 'medium',
      revision: 'wrong_to_right',
    },
  },
  {
    // 객관식 — Depth 판정이 없다. 영역 성취는 정오로 대신한다.
    label: '4번',
    verdict: 'correct',
    activeMs: 8_000,
    spanMs: 9_000,
    attempts: 1,
    revisits: 0,
    korean: { area: '문법', depths: [], confidence: 'high', revision: 'none' },
  },
  {
    // 국어 분석이 아직 없는 문항
    label: '5번',
    verdict: 'wrong',
    activeMs: 5_000,
    spanMs: 6_000,
    attempts: 1,
    revisits: 0,
  },
];

const S = buildKoreanSummary(PROBLEMS);

test('Depth 충족률 — 해당 없음(na)은 분모에서 뺀다', () => {
  // D3 는 1번이 na 라 2번(부분 50)·3번(충족 100)만 센다 → 75
  eq(
    [S.depthRates[1], S.depthRates[2], S.depthRates[3], S.depthRates[4], S.depthRates[5]],
    [100, 50, 75, 67, 50],
  );
});

test('Depth 판정이 하나도 없으면 자료 없음(null)', () => {
  const empty = buildKoreanSummary([PROBLEMS[4]]);
  eq(
    [1, 2, 3, 4, 5].map((d) => empty.depthRates[d]),
    [null, null, null, null, null],
  );
});

test('영역 성취 — 5-Depth 득점률 평균, 없으면 정오로 대신', () => {
  eq(S.areaRates['독서'], 90); // 1번 100 · 3번 80
  eq(S.areaRates['문학'], 30);
  eq(S.areaRates['문법'], 100); // Depth 판정 없음 → 맞았으니 100
  eq(S.areaRates['화법'], null);
  eq(S.areaRates['작문'], null);
});

test('숨은 킬러 — 맞혔는데 유난히 오래 멈칫한 문항만', () => {
  eq(S.killers, ['3번']);
});

test('수정 궤적 집계 — 국어 값이 없는 문항은 판단 보류', () => {
  eq(
    [
      S.revision.none,
      S.revision.right_to_wrong,
      S.revision.wrong_to_right,
      S.revision.reworked,
      S.revision.unknown,
    ],
    [2, 1, 1, 0, 1],
  );
});

test('산점도 — X 정답률, Y 멈칫(초), Z 불안정도', () => {
  eq(S.scatter.length, 5);
  eq(S.scatter[0], { label: '1번', x: 100, y: 2, z: 7 });
  eq(S.scatter[2].y, 85); // 100초 중 85초를 멈칫
  eq(S.scatter[4].x, 0); // 틀린 문항 (반 평균이 없으면 본인 정오로)
  ok(S.scatter[2].z > S.scatter[0].z, '오래 멈칫한 문항이 더 불안정해야 한다');
});

test('모르는 수정 값은 판단 보류로 접는다', () => {
  eq(toRevisionKind('right_to_wrong'), 'right_to_wrong');
  eq(toRevisionKind('무언가'), 'unknown');
  eq(toRevisionKind(undefined), 'unknown');
});

console.log(fail === 0 ? '\n=== 7/7 ===' : `\n=== 실패 ${fail} ===`);
if (fail > 0) process.exit(1);
