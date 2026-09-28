/**
 * 학원 도입 신청 검증 회귀 테스트.
 *
 * 접수는 한 번뿐이고 되물을 수단이 연락처뿐이다 — 연락처가 틀리면 그 신청은
 * 통째로 죽는다. 그래서 연락처 규칙을 특히 촘촘히 본다.
 */
import {
  EMPTY_APPLICATION,
  formatPhone,
  hasErrors,
  toRow,
  validateApplication,
  type AcademyApplication,
} from '../src/lib/academy-apply';

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

const V = (o: Partial<AcademyApplication>): AcademyApplication => ({
  ...EMPTY_APPLICATION,
  academyName: '예시학원',
  location: '예시 지역',
  contactPhone: '010-1234-5678',
  contactEmail: 'owner@example.test',
  ...o,
});

ok('정상 입력은 통과', !hasErrors(validateApplication(V({}))));
ok('학원명 없으면 거부', !!validateApplication(V({ academyName: '' })).academyName);
ok('위치 없으면 거부', !!validateApplication(V({ location: '' })).location);
ok('연락처 없으면 거부', !!validateApplication(V({ contactPhone: '' })).contactPhone);

ok(
  '휴대폰 통과',
  !validateApplication(V({ contactPhone: '01012345678' })).contactPhone,
);
ok(
  '학원 대표번호(유선)도 통과 — 유선이 흔하다',
  !validateApplication(V({ contactPhone: '02-000-0000' })).contactPhone,
);
ok(
  '자릿수 모자라면 거부',
  !!validateApplication(V({ contactPhone: '010-123' })).contactPhone,
);
ok(
  '엉뚱한 번호는 거부',
  !!validateApplication(V({ contactPhone: '99999999999' })).contactPhone,
);

ok('이메일 없으면 거부 — 전화가 틀릴 때의 유일한 대안',
  !!validateApplication(V({ contactEmail: '' })).contactEmail);
ok('이메일 형식 거부', !!validateApplication(V({ contactEmail: 'abc' })).contactEmail);
ok('정상 이메일 통과', !validateApplication(V({ contactEmail: 'a@b.co' })).contactEmail);

ok('인원은 선택 — 비워도 통과', !hasErrors(validateApplication(V({ studentCount: '' }))));
ok(
  '인원에 글자를 쓰면 거부',
  !!validateApplication(V({ studentCount: '스무명' })).studentCount,
);
ok('음수 거부', !!validateApplication(V({ teacherCount: '-3' })).teacherCount);

// 입력 중 자동 하이픈
ok('전화 포맷 010-1234-5678', formatPhone('01012345678') === '010-1234-5678');
ok('전화 포맷 짧은 입력', formatPhone('0101') === '010-1');
ok('숫자 아닌 문자는 버린다', formatPhone('010abc1234') === '010-1234');

{
  const row = toRow(V({ studentCount: '120', teacherCount: '', contactName: '김원장' }));
  ok('숫자는 정수로', row.student_count === 120);
  ok('빈 인원은 null (0 이 아니다 — 모른다는 뜻)', row.teacher_count === null);
  ok('연락처는 숫자만 저장', row.contact_phone === '01012345678');
  ok('빈 선택 항목은 null', row.memo === null);
  ok('이름은 그대로', row.contact_name === '김원장');
  ok('이메일은 소문자로 저장', row.contact_email === 'owner@example.test');
}

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
