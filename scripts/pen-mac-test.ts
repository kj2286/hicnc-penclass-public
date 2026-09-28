/** 펜 MAC 매칭 회귀 테스트 — 잘못 붙으면 남의 필기가 그 학생 기록에 저장된다. */
import { ambiguousPens, findPenByMac } from '../src/lib/pen-mac';
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e?: unknown) => {
  if (c) { pass++; console.log(`PASS  ${n}`); }
  else { fail++; console.log(`FAIL  ${n}${e === undefined ? '' : ` — ${String(e)}`}`); }
};
const P = (mac: string, id: string) => ({ mac, id });
const pens = [P('02:00:00:A1:B2:C3', 'p1'), P('02:00:00:D4:E5:F6', 'p2')];

ok('전체 MAC 정확히 일치', findPenByMac(pens, '02:00:00:A1:B2:C3')?.id === 'p1');
ok('대소문자·구분자 무시', findPenByMac(pens, '020000a1b2c3')?.id === 'p1');
ok('뒷자리 6자리로 유일하게 찾힌다', findPenByMac(pens, 'A1B2C3')?.id === 'p1');
ok('없는 MAC 은 undefined', findPenByMac(pens, '000000') === undefined);
ok('빈 값은 undefined', findPenByMac(pens, '') === undefined);
ok('6자리 미만은 아예 안 쓴다 (우연히 겹친다)', findPenByMac(pens, '34') === undefined);
{
  // 실사고 재현: 뒷자리가 여러 펜에 걸치면 **아무거나 고르지 않는다**
  const dup = [P('02:00:01:11:22:33', 'a'), P('02:00:02:11:22:33', 'b')];
  ok('뒷자리가 겹치면 undefined (엉뚱한 학생 배정 방지)',
    findPenByMac(dup, '112233') === undefined);
}
{
  const same = [P('02:00:00:44:55:66', 'x'), P('020000445566', 'y')];
  ok('같은 MAC 이 둘이면 undefined (사람이 정리해야 한다)',
    findPenByMac(same, '02:00:00:44:55:66') === undefined);
}
{
  // 2026-08-17 실사고: 같은 펜이 세 계정에 등록돼 크래들 업로드가 학생을 못 정하고
  // 조용히 PC 폴더에만 저장했다. 사용자에게는 "업로드했는데 안 보인다" 로 보였다.
  const T = (mac: string, id: string, teacherId: string) => ({ mac, id, teacherId });
  const three = [
    T('02:00:00:44:55:66', 'old1', 't1'),
    T('02:00:00:44:55:66', 'old2', 't2'),
    T('02:00:00:44:55:66', 'mine', 't3'),
  ];
  ok('여러 계정에 등록돼도 **내 등록**을 고른다',
    findPenByMac(three, '02:00:00:44:55:66', 't3')?.id === 'mine');
  ok('내 등록이 없으면 여전히 undefined (엉뚱한 학생 배정 방지)',
    findPenByMac(three, '02:00:00:44:55:66', 't9') === undefined);
  ok('내 등록이 둘이면 undefined (사람이 정리해야 한다)',
    findPenByMac([T('02:00:00:44:55:66','a','t3'), T('020000445566','b','t3')],
      '02:00:00:44:55:66', 't3') === undefined);
  ok('중복 등록을 값으로 알려준다 (경고를 띄우려면 필요하다)',
    ambiguousPens(three, '02:00:00:44:55:66').length === 3);
  ok('중복이 없으면 빈 배열',
    ambiguousPens(pens, '02:00:00:A1:B2:C3').length === 0);
}
console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
