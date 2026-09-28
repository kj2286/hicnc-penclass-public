/**
 * ncode 인덱스 캐시 채택 규칙 회귀 테스트.
 *
 * 2026-08-13 NGS 인증서 만료 장애의 재발 경로를 막는다: 서버가 반쯤 죽어
 * 일부 교재만 인덱싱된 결과가 멀쩡한 캐시를 덮어쓰면, 이미 보던 배경 교재까지
 * "PDF 로드 실패" 로 사라진다.
 */
import { shouldAdoptIndex } from '../src/lib/index-adopt';

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

ok(
  '실패 0건이면 항상 채택 (서버 상태가 곧 정답)',
  shouldAdoptIndex({ size: 120, failed: 0 }, 120),
);

ok(
  '실패 0건이면 줄어들어도 채택 (교재를 실제로 지운 경우)',
  shouldAdoptIndex({ size: 90, failed: 0 }, 120),
);

ok(
  '실패가 있고 캐시보다 빈약하면 버린다 (장애 중 반쪽 인덱스)',
  !shouldAdoptIndex({ size: 12, failed: 17 }, 120),
);

ok(
  '실패가 있어도 캐시보다 크면 채택 (신규 교재가 더 많이 잡힌 경우)',
  shouldAdoptIndex({ size: 130, failed: 1 }, 120),
);

ok(
  '전부 실패해 빈 인덱스면 캐시 유지',
  !shouldAdoptIndex({ size: 0, failed: 20 }, 120),
);

ok(
  '캐시가 비어 있으면 빈 결과라도 채택 (최초 로드 — 막을 캐시가 없다)',
  shouldAdoptIndex({ size: 0, failed: 20 }, 0),
);

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
