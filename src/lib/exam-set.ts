/**
 * **시험지 세트** — 한 시험은 PDF 가 여러 개로 나뉘어 있다.
 * 6-1 A형은 "표지"(계산력 8문항)와 "문제 26-3"(1·2·3단계)이 별도 PDF 인데
 * 실제로는 **한 시험지**다. 지금까지는 (날짜 × 교재) 로 문서를 갈라
 * 필기 기록에 두 줄로 보였다 — 사용자 지적 2026-08-25.
 *
 * 제목에서 "표지" / "문제 26-3" 같은 **부분 표기만** 걷어내 세트 이름을 만든다.
 * 두 표기가 모두 없는 제목은 그대로 → 기존 동작 그대로다(잘못 묶을 위험 없음).
 */

/** "6-1(A형) 표지_테스트01_b4" · "6-1(A형) 문제 26-3_테스트01_b4" → "6-1(A형)_테스트01_b4" */
export function examSetTitle(title: string): string {
  const t = (title ?? '').trim();
  if (!t) return t;
  const stripped = t
    .replace(/\s*표지\s*/g, '')
    .replace(/\s*문제\s*\d+(?:[-–]\d+)*\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // 다 지워졌으면(제목이 "표지" 뿐이었다면) 원래 제목을 지킨다
  return stripped || t;
}

/** 이 교재가 세트의 **표지**(첫 번째 문제지)인가 */
export function isCoverPaper(title: string): boolean {
  return /표지/.test(title ?? '');
}

/** 세트로 묶이는 제목인가 — 두 제목이 같은 시험지인지 */
export function sameExamSet(a: string, b: string): boolean {
  const x = examSetTitle(a);
  const y = examSetTitle(b);
  return !!x && x === y && a !== b;
}
