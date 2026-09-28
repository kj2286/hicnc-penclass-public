/**
 * 교육과정 단원 목차·시험지 단원표 정본 검사.
 * 사람이 사진을 보고 옮겨 적은 데이터라, 나중에 누가 "정리"하다 흐트러뜨리는
 * 것을 막는다 — 개수·대표 항목·매핑 결과를 못으로 박아 둔다.
 */
import {
  CURRICULUM_2022,
  allCurriculumUnits,
  curriculumUnits,
  normalizeUnitName,
} from '../src/lib/curriculum.ts';
import {
  lookupPaperUnit,
  lookupPaperUnitEntry,
} from '../src/lib/paper-unit-map.ts';

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`FAIL  ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}
function eq(a: unknown, b: unknown, msg = '') {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg} ${x} !== ${y}`);
}

test('3~6학년 각 학기는 6단원씩이다', () => {
  for (const grade of [3, 4, 5, 6]) {
    for (const sem of [1, 2] as const) {
      eq(curriculumUnits(grade, sem).length, 6, `${grade}-${sem}`);
    }
  }
  eq(Object.keys(CURRICULUM_2022).length, 4);
});

test('6학년 1학기 단원이 인쇄물 그대로다', () => {
  eq(curriculumUnits(6, 1), [
    '분수의 나눗셈',
    '각기둥과 각뿔',
    '소수의 나눗셈',
    '비와 비율',
    '여러 가지 그래프',
    '직육면체의 부피와 겉넓이',
  ]);
});

test('5학년 2학기 첫 단원의 긴 이름이 보존된다', () => {
  eq(curriculumUnits(5, 2)[0], '수의 범위와 올림, 버림, 반올림');
});

test('단원 후보 목록은 중복 없이 모인다', () => {
  const all = allCurriculumUnits();
  eq(all.length, new Set(all).size, '중복 있음');
  if (all.length < 40) throw new Error(`너무 적다: ${all.length}`);
});

test('줄여 쓴 단원명은 정본 표기로 맞춰진다', () => {
  eq(normalizeUnitName('부피와 겉넓이'), '직육면체의 부피와 겉넓이');
  eq(normalizeUnitName('분수의 나눗셈'), '분수의 나눗셈');
  eq(normalizeUnitName(''), '');
});

test('6-1 A형 계산력 매핑 (표지 8문항)', () => {
  const t = '6-1(A형) 표지';
  eq(lookupPaperUnit(t, '', 1), '분수의 나눗셈');
  eq(lookupPaperUnit(t, '', 4), '소수의 나눗셈');
  eq(lookupPaperUnit(t, '', 8), '분수의 나눗셈');
  eq(lookupPaperUnit(t, '', 9), null, '9번은 없다');
});

test('6-1 A형 단계별 매핑', () => {
  const t = '6-1(A형) 문제 26-3';
  eq(lookupPaperUnit(t, '1단계', 1), '각기둥과 각뿔');
  eq(lookupPaperUnit(t, '1단계(기본)', 5), '직육면체의 부피와 겉넓이');
  eq(lookupPaperUnit(t, '2단계(응용)', 8), '여러 가지 그래프');
  eq(lookupPaperUnit(t, '3단계(심화/통합사고력)', 3), '각기둥과 각뿔');
});

test('매핑이 없는 시험지는 null — AI 추론값을 쓰게 둔다', () => {
  eq(lookupPaperUnit('제4회 JMC.K(4학년)_A4사이즈', '1단계', 1), null);
  // 반편성 B형 시트에 3-1·3-2·4-1 도 있지만 아직 옮기지 않았다
  eq(lookupPaperUnit('4-1(B형) 문제', '1단계', 1), null);
});

test('6-1 A형 세부내용 = 핵심개념 — 사용자 표(2026-09-02) 그대로', () => {
  const t = '6-1(A형) 문제 26-3';
  eq(lookupPaperUnitEntry(t, '계산력', 1)?.sub, '(자연수)÷(자연수)');
  eq(lookupPaperUnitEntry(t, '1단계(기본)', 3)?.sub, '바르게 계산한 값 구하기');
  eq(lookupPaperUnitEntry(t, '3단계(심화/통합사고력)', 8)?.sub, '원그래프 활용');
});

test('6-2 B형 정리표 — 제목 표기가 흔들려도 잡히고 세부내용이 붙는다', () => {
  const t = '6-2b형_표지_문제지_합친버전';
  eq(lookupPaperUnit(t, '계산력', 1), '분수의 나눗셈');
  eq(lookupPaperUnitEntry(t, '계산력', 8)?.sub, '비례식에서 값 구하기');
  eq(lookupPaperUnitEntry(t, '1단계', 2)?.unit, '공간과 입체');
  eq(lookupPaperUnitEntry(t, '2단계(응용)', 2)?.sub, '쌓기나무의 개수 구하기');
  eq(lookupPaperUnitEntry(t, '3단계(심화/통합사고력)', 7)?.sub, '원의 일부분의 넓이');
  eq(lookupPaperUnit('6-2 B형 풀이+답안', '1단계', 8), lookupPaperUnit(t, '1단계', 8), '해설 제목도 같은 표');
  eq(lookupPaperUnit(t, '1단계', 9), null);
});

test('반편성 B형 4종 정리표 — 「반편성 단원별 세부 내용 B형」 PDF(2026-09-04) 그대로', () => {
  // 4-2
  eq(lookupPaperUnitEntry('4-2 B형 풀이+답안', '계산력', 7), { unit: '사각형', sub: '사각형의 네 변의 길이' });
  eq(lookupPaperUnitEntry('4-2(B형) 문제', '1단계(기본)', 4)?.sub, '예각, 둔각, 직각삼각형');
  eq(lookupPaperUnitEntry('4-2(B형) 문제', '3단계(심화/통합사고력)', 8)?.sub, '정다각형의 이름');
  // 5-1
  eq(lookupPaperUnitEntry('5-1 B형 풀이+답안', '계산력', 1)?.sub, '( )가 있는 혼합 계산');
  eq(lookupPaperUnit('5-1(B형) 문제', '1단계', 3), '대응 관계');
  eq(lookupPaperUnitEntry('5-1(B형) 문제', '3단계', 8)?.sub, '가장 작은 결과, 가장 큰 결과 구하기');
  // 5-2 — 5-2 A형에는 표가 없다(위 테스트), B형만 잡혀야 한다
  eq(lookupPaperUnitEntry('5-2 B형 풀이+답안', '2단계(응용)', 5)?.sub, '점대칭도형, 선대칭도형');
  eq(lookupPaperUnit('5-2(B형) 문제', '1단계', 5), '직육면체');
  eq(lookupPaperUnit('5-2(A형) 문제', '1단계', 5), null, 'A형은 여전히 표가 없다');
  // 6-1 — A형과 B형이 서로 다른 표를 봐야 한다
  eq(lookupPaperUnitEntry('6-1 B형 풀이+답안', '1단계', 1)?.sub, '각기둥의 이름 구하기');
  eq(lookupPaperUnitEntry('6-1(A형) 문제 26-3', '1단계', 1)?.sub, '입체도형의 이름');
  eq(lookupPaperUnitEntry('6-1(B형) 문제', '3단계(심화/통합사고력)', 4)?.sub, '농도');
  // 9번은 어느 시험지에도 없다
  eq(lookupPaperUnit('4-2 B형 풀이+답안', '1단계', 9), null);
});

test('표지 제목만으로도 계산력 섹션이 잡히고 세부내용이 붙는다', () => {
  const e = lookupPaperUnitEntry('6-1(A형) 표지', '', 1);
  eq(e, { unit: '분수의 나눗셈', sub: '(자연수)÷(자연수)' });
});

test('정리표가 없는 시험지는 null — AI 가 읽은 값을 쓰게 둔다', () => {
  eq(lookupPaperUnitEntry('5-2(A형) 문제', '1단계', 1), null);
  eq(lookupPaperUnit('중1-1 A형 문제(24-3)', '', 1), null);
});

test('라벨 형식이 바뀌어도 단계·번호를 읽어낸다', () => {
  // 새 형식 "1단계(기본)-1번" / 옛 형식 "1단계 1번" 둘 다 매핑이 잡혀야 한다
  const t = '6-1(A형) 문제 26-3';
  eq(lookupPaperUnit(t, '1단계(기본)', 1), '각기둥과 각뿔');
  eq(lookupPaperUnit(t, '1단계', 1), '각기둥과 각뿔');
  eq(lookupPaperUnit(t, '3단계(심화/통합사고력)', 8), '여러 가지 그래프');
});

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
