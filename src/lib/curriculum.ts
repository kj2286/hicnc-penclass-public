/**
 * **2022 개정 교육과정 단원 목차 (초등 3~6학년)** — 정본 데이터.
 *
 * 출처: 사용자가 제공한 인쇄물 「22개정 교육과정 단원 목차」 사진 (2026-08-25).
 * 여기 없는 단원명은 **지어내지 않는다** — AI 가 단원을 태깅할 때 이 목록을
 * 후보로 주고, 목록에 없으면 비워 두게 한다(사용자 지시: 할루시네이션 금지).
 *
 * ⚠️ 사람이 옮겨 적은 표다. 고칠 일이 생기면 원본 인쇄물을 기준으로 고치고,
 *    추측으로 항목을 추가하지 말 것.
 */

export type Semester = 1 | 2;

/** 학년 → 학기 → 단원명 (교과서 차례 순서 그대로) */
export const CURRICULUM_2022: Record<number, Record<Semester, string[]>> = {
  3: {
    1: ['덧셈과 뺄셈', '평면도형', '나눗셈', '곱셈', '길이와 시간', '분수와 소수'],
    2: ['곱셈', '나눗셈', '원', '분수', '들이와 무게', '그림그래프'],
  },
  4: {
    1: ['큰 수', '각도', '곱셈과 나눗셈', '평면도형의 이동', '막대그래프', '규칙 찾기'],
    2: [
      '분수의 덧셈과 뺄셈',
      '삼각형',
      '소수의 덧셈과 뺄셈',
      '사각형',
      '꺾은선그래프',
      '다각형',
    ],
  },
  5: {
    1: [
      '자연수의 혼합계산',
      '약수와 배수',
      '대응 관계',
      '약분과 통분',
      '분수의 덧셈과 뺄셈',
      '다각형의 둘레와 넓이',
    ],
    2: [
      '수의 범위와 올림, 버림, 반올림',
      '분수의 곱셈',
      '합동과 대칭',
      '소수의 곱셈',
      '직육면체',
      '평균과 가능성',
    ],
  },
  6: {
    1: [
      '분수의 나눗셈',
      '각기둥과 각뿔',
      '소수의 나눗셈',
      '비와 비율',
      '여러 가지 그래프',
      '직육면체의 부피와 겉넓이',
    ],
    2: [
      '분수의 나눗셈',
      '소수의 나눗셈',
      '공간과 입체',
      '비례식과 비례배분',
      '원의 둘레와 넓이',
      '원기둥, 원뿔, 구',
    ],
  },
};

/** 3~6학년 전체 단원명 (중복 제거) — AI 태깅의 후보 목록 */
export function allCurriculumUnits(): string[] {
  const out = new Set<string>();
  for (const bySemester of Object.values(CURRICULUM_2022)) {
    for (const list of Object.values(bySemester)) {
      for (const u of list) out.add(u);
    }
  }
  return [...out];
}

/** 한 학년·학기의 단원 목록 */
export function curriculumUnits(grade: number, semester: Semester): string[] {
  return CURRICULUM_2022[grade]?.[semester] ?? [];
}

const squash = (s: string) => s.replace(/\s+/g, '');

/**
 * 임의의 단원 표기를 **교육과정 정본 표기로 맞춘다**.
 * 시험지 매핑표는 "부피와 겉넓이" 처럼 줄여 쓰기도 한다 —
 * 정본에 그 말이 들어 있으면 정본 이름으로 통일한다. 못 찾으면 원문 그대로.
 */
export function normalizeUnitName(name: string): string {
  const n = squash(name);
  if (!n) return '';
  const all = allCurriculumUnits();
  const exact = all.find((u) => squash(u) === n);
  if (exact) return exact;
  const partial = all.find((u) => squash(u).includes(n) || n.includes(squash(u)));
  return partial ?? name.trim();
}
