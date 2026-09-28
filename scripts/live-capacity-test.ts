/**
 * 실시간 라이브 용량 규칙 회귀 테스트.
 *
 * 핵심 불변식: **접속한 사람이 사라지지 않는다.** shown + overflow 는 언제나
 * 입력 전체와 같아야 한다 — 제한이 "숨김"이 되면 선생님이 학생을 놓친다.
 */
import {
  LIVE_RECOMMENDED_MAX,
  capacityNotice,
  splitByCapacity,
} from '../src/lib/live-capacity';

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

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
const key = (x: { id: string }) => x.id;

{
  const r = splitByCapacity(mk(5), key, new Set(), 8);
  ok('정원 이하면 전부 그린다', r.shown.length === 5 && r.overflow.length === 0);
}

{
  const items = mk(12);
  const r = splitByCapacity(items, key, new Set(), 8);
  ok('정원 초과 시 8명만 그린다', r.shown.length === 8, r.shown.length);
  ok('나머지는 목록으로 남는다', r.overflow.length === 4, r.overflow.length);
  ok(
    '아무도 사라지지 않는다 (shown + overflow = 전체)',
    [...r.shown, ...r.overflow].length === items.length &&
      new Set([...r.shown, ...r.overflow].map(key)).size === items.length,
  );
}

{
  // 고정한 사람은 접속 순서에 밀리지 않는다
  const items = mk(12);
  const r = splitByCapacity(items, key, new Set(['p11']), 8);
  ok('고정한 항목은 반드시 화면에 있다', r.shown.some((x) => x.id === 'p11'));
  ok('고정해도 정원은 지킨다', r.shown.length === 8, r.shown.length);
  ok(
    '고정 항목이 맨 앞자리를 차지한다',
    r.shown[0]?.id === 'p11',
    r.shown[0]?.id,
  );
}

{
  // 정원보다 많이 고정하면 앞에서부터 정원까지만
  const items = mk(12);
  const pinned = new Set(items.slice(0, 10).map(key));
  const r = splitByCapacity(items, key, pinned, 8);
  ok('고정이 정원을 넘어도 정원을 지킨다', r.shown.length === 8, r.shown.length);
  ok('그래도 전원이 어딘가엔 있다', r.shown.length + r.overflow.length === 12);
}

{
  const r = splitByCapacity(mk(3), key, new Set(), 0);
  ok('정원 0이면 아무도 안 그리지만 목록엔 남는다', r.shown.length === 0 && r.overflow.length === 3);
}

{
  ok('정원 이하면 경고를 띄우지 않는다', capacityNotice(8, 8) === null);
  const n = capacityNotice(12, 8);
  ok('초과 인원수를 문구에 담는다', !!n && n.description.includes('4명'), n?.description);
  ok('필기 저장은 정상임을 알린다', !!n && n.description.includes('저장'));
}

ok('권장 정원 기본값은 8', LIVE_RECOMMENDED_MAX === 8);

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
