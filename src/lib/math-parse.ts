/**
 * LaTeX 구간 파서 — 순수 함수 (React·KaTeX 의존 없음, node 에서 테스트 가능).
 *
 * 렌더는 `components/LatexText` 하나만 담당한다. 파서를 여기로 뺀 이유는
 * ① 회귀 테스트(scripts/math-test.ts) ② 렌더러 중복 방지 —
 * 2026-08-13 에 같은 일을 하는 컴포넌트를 하나 더 만들 뻔했다.
 *
 * 구분자: `$…$`(인라인) · `$$…$$`(블록) · `\(…\)` · `\[…\]`.
 * 짝이 없는 `$` 는 그냥 글자로 흘려보낸다 — 모델 출력이 반쯤 어긋나도
 * 문장이 통째로 깨지지 않게. `\$` 는 달러 기호 그대로.
 */

export type MathSegment =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string; display: boolean };

export function parseLatexSegments(input: string): MathSegment[] {
  const out: MathSegment[] = [];
  let i = 0;
  let buf = '';
  const flushText = () => {
    if (buf.length > 0) {
      out.push({ kind: 'text', value: buf });
      buf = '';
    }
  };
  while (i < input.length) {
    const ch = input[i];
    // `\$` = 달러 문자 그대로
    if (ch === '\\' && input[i + 1] === '$') {
      buf += '$';
      i += 2;
      continue;
    }
    // `\(…\)` · `\[…\]`
    if (ch === '\\' && (input[i + 1] === '(' || input[i + 1] === '[')) {
      const display = input[i + 1] === '[';
      const close = display ? '\\]' : '\\)';
      const start = i + 2;
      const end = input.indexOf(close, start);
      if (end !== -1) {
        flushText();
        out.push({ kind: 'math', value: input.slice(start, end), display });
        i = end + 2;
        continue;
      }
    }
    if (ch === '$') {
      const isDisplay = input[i + 1] === '$';
      const open = isDisplay ? '$$' : '$';
      const start = i + open.length;
      const end = input.indexOf(open, start);
      // 짝 없음 → 글자로 취급
      if (end === -1) {
        buf += ch;
        i += 1;
        continue;
      }
      // 인라인은 한 줄 안에서만 (문장 속 "$5 … $3" 오검출 방지)
      const body = input.slice(start, end);
      if (!isDisplay && body.includes('\n')) {
        buf += ch;
        i += 1;
        continue;
      }
      flushText();
      out.push({ kind: 'math', value: body, display: isDisplay });
      i = end + open.length;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flushText();
  return out;
}

/** 렌더할 수식이 하나라도 있는가 — 미리보기 노출 여부 판단에 쓴다 */
export function hasMath(text: string): boolean {
  if (!text) return false;
  return parseLatexSegments(text).some((s) => s.kind === 'math');
}

/**
 * **평문 수식 → LaTeX 정규화** (사용자 요구 2026-08-19: "이런 케이스는 없애야").
 *
 * 모델이 지시를 무시하고 "7 2/9 × 8 ÷ 24" 처럼 평문으로 옮기는 일이 실제로
 * 있다 — 렌더러가 아무리 좋아도 원문에 LaTeX 가 없으면 수식으로 못 보여준다.
 * $ 나 백슬래시가 이미 있으면(저자가 LaTeX 를 씀) 절대 손대지 않고,
 * **완전 평문일 때만** 대분수·분수·근호를 보수적으로 감싼다.
 */
export function normalizePlainMath(text: string): string {
  if (/[$\\]/.test(text)) return text;
  let t = text;
  // 대분수: "7 2/9" → $7\frac{2}{9}$ (먼저 — 아래 분수 규칙과 겹치지 않게)
  t = t.replace(/(\d+)\s+(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/g, '$$$1\\frac{$2}{$3}$$');
  // 분수: "40/11" → $\frac{40}{11}$
  t = t.replace(/(?<![\d}])(\d{1,3})\s*\/\s*(\d{1,3})(?!\d)/g, '$$\\frac{$1}{$2}$$');
  // 근호: "√2" → $\sqrt{2}$
  t = t.replace(/√\s*(\d+)/g, '$$\\sqrt{$1}$$');
  return t;
}
