/**
 * 수식 파서 회귀 테스트 (npm test) — AI 분석·OCR 텍스트의 LaTeX 구간 분해.
 * 화면 렌더(KaTeX)는 이 조각들을 그대로 그리므로, 여기서 경계가 어긋나면
 * 원시 문자열(`$P(A|B) = \frac{...}{...}$`)이 그대로 노출된다.
 */
import { hasMath, parseLatexSegments , normalizePlainMath } from '../src/lib/math-parse';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}${detail ? '  — ' + detail : ''}`);
  } else {
    fail += 1;
    console.error(`FAIL  ${name}${detail ? '  — ' + detail : ''}`);
  }
}

// 실제 분석문 (2026-08-13 화면 캡처에서 그대로 가져옴)
const REAL =
  '이어서 조건부 확률 공식 $P(A|B) = \\frac{P(A \\cap B)}{P(A)}$를 작성했으나, ' +
  '분모가 $P(A)$가 아닌 $P(B)$임을 인지하고 고쳤습니다.';

{
  const parts = parseLatexSegments(REAL);
  const math = parts.filter((p) => p.kind === 'math');
  ok('실제 분석문에서 수식 3개 추출', math.length === 3, `${math.length}개`);
  ok(
    '첫 수식 본문에 구분자($)가 남지 않음',
    math[0].value === 'P(A|B) = \\frac{P(A \\cap B)}{P(A)}',
    math[0].value,
  );
  ok(
    '수식 사이 한글 텍스트 보존',
    parts.some((p) => p.kind === 'text' && p.value.includes('분모가')),
  );
  ok(
    '원문 복원 가능(누락 없음)',
    parts
      .map((p) => (p.kind === 'math' ? `$${p.value}$` : p.value))
      .join('') === REAL,
  );
}

{
  ok('수식 없는 문장은 통째로 텍스트', parseLatexSegments('안녕하세요 3개입니다').length === 1);
  ok('hasMath — 수식 있음', hasMath('값은 $x^2$ 입니다'));
  ok('hasMath — 없음', !hasMath('값은 3000원 입니다'));
  ok('hasMath — 달러 하나만 있으면 수식 아님', !hasMath('가격은 $5 입니다'));
}

{
  const parts = parseLatexSegments('블록: $$\\frac{a}{b}$$ 끝');
  const m = parts.find((p) => p.kind === 'math');
  ok('$$…$$ 는 블록 수식', !!m && m.kind === 'math' && m.display === true);
  ok('$$ 본문에서 구분자 제거', (m as { value: string }).value === '\\frac{a}{b}', (m as { value: string }).value);
}

{
  const parts = parseLatexSegments('괄호형 \\(x+1\\) 과 \\[y=2\\] 혼용');
  const math = parts.filter((p) => p.kind === 'math');
  ok('\\(…\\) · \\[…\\] 도 인식', math.length === 2);
  ok(
    '\\( 는 인라인, \\[ 는 블록',
    !(math[0] as { display: boolean }).display && (math[1] as { display: boolean }).display,
  );
}

{
  // 줄바꿈이 낀 $ 는 수식이 아니다 (문장 안 달러 오검출 방지)
  ok('여러 줄에 걸친 $ 는 무시', !hasMath('가격 $5\n원가 $3'));
}

// ── 평문 수식 정규화 (2026-08-19: 모델이 LaTeX 지시를 무시한 케이스 제거) ──
ok('대분수 평문 → LaTeX', normalizePlainMath('7 2/9 × 8') === '$7\\frac{2}{9}$ × 8');
ok('분수 평문 → LaTeX', normalizePlainMath('40/11 ÷ 16') === '$\\frac{40}{11}$ ÷ 16');
ok('근호 평문 → LaTeX', normalizePlainMath('√2 더하기') === '$\\sqrt{2}$ 더하기');
ok('이미 LaTeX 면 불변', normalizePlainMath('답 $\\frac{1}{2}$') === '답 $\\frac{1}{2}$');

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
