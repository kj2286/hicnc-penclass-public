/**
 * 우선학습대상 분류 회귀 테스트.
 * 여기가 틀리면 선생님이 "무엇부터 손볼지" 를 잘못 안내받는다.
 */
import {
  groupByPriority,
  priorityOf,
  type PriorityInput,
} from '../src/lib/report-priority';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${extra === undefined ? '' : ` — ${String(extra)}`}`);
  }
}

const P = (o: Partial<PriorityInput>): PriorityInput => ({
  label: '1번',
  verdict: 'wrong',
  guessed: false,
  mistake: false,
  difficulty: '보통',
  attempts: 2,
  ...o,
});

ok('맞은 문제는 복습 대상이 아니다', priorityOf(P({ verdict: 'correct' })) === null);
ok(
  '찍어서 맞은 건 4순위 (재풀이 후 평가)',
  priorityOf(P({ verdict: 'correct', guessed: true })) === 4,
);
ok('판정 불가는 제외', priorityOf(P({ verdict: 'unknown' })) === null);

ok('아는데 틀린 것(실수)은 1순위', priorityOf(P({ mistake: true })) === 1);
ok(
  '실수는 난이도보다 우선한다',
  priorityOf(P({ mistake: true, difficulty: '매우 어려움' })) === 1,
);

ok(
  '한 번에 끝낸 오답은 2순위 (원포인트)',
  priorityOf(P({ attempts: 1 })) === 2,
);
ok('여러 번 시도한 오답은 3순위 (단기)', priorityOf(P({ attempts: 3 })) === 3);

ok(
  '어려운 문제 오답은 5순위 (중장기)',
  priorityOf(P({ difficulty: '어려움' })) === 5,
);
ok(
  '매우 어려움 오답도 5순위',
  priorityOf(P({ difficulty: '매우 어려움', attempts: 1 })) === 5,
);

{
  const g = groupByPriority([
    P({ label: '1번', mistake: true }),
    P({ label: '2번', difficulty: '매우 어려움' }),
    P({ label: '3번', attempts: 1 }),
    P({ label: '4번', verdict: 'correct' }),
  ]);
  ok('순위별로 묶인다', g[1].join() === '1번' && g[5].join() === '2번' && g[2].join() === '3번');
  ok('빈 순위도 자리를 지킨다 (양식이 5칸 고정)', Array.isArray(g[4]) && g[4].length === 0);
  ok(
    '맞은 문제는 어느 순위에도 안 들어간다',
    !Object.values(g).flat().includes('4번'),
  );
}

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
