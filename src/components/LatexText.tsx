import { useMemo } from 'react';
import katex from 'katex';
import { cn } from '@/lib/utils';
import { normalizePlainMath, parseLatexSegments } from '@/lib/math-parse';
import { humanizeSeconds } from '@/lib/duration';

export { hasMath } from '@/lib/math-parse';

type Props = {
  text: string;
  className?: string;
};

/**
 * Render OCR output that mixes Korean prose with LaTeX math. Each math
 * segment is rendered through KaTeX; KaTeX errors are degraded into
 * the original `$…$` text so a malformed expression never blanks the
 * card.
 */
export function LatexText({ text, className }: Props) {
  // 평문 수식(모델이 LaTeX 지시를 무시한 경우)도 수식으로 보이게 정규화
  const segments = useMemo(
    () => parseLatexSegments(normalizePlainMath(text)),
    [text],
  );

  return (
    <span data-testid="latex-text" className={cn('latex-text', className)}>
      {segments.map((seg, idx) => {
        if (seg.kind === 'text') {
          // ⏱️ **마지막 방어선** — 글 속의 "180초" 를 시·분·초로 바꾼다.
          // 시간을 만드는 코드는 이미 formatDuration 을 쓰지만, AI 가 쓴 문장과
          // 예전에 캐시된 글에는 raw 초가 남아 있다(사용자 요구 2026-08-27).
          // 수식 세그먼트는 여기 오지 않으므로 수식이 깨질 일이 없다.
          return <span key={idx}>{humanizeSeconds(seg.value)}</span>;
        }
        let html: string;
        try {
          html = katex.renderToString(seg.value, {
            displayMode: seg.display,
            throwOnError: false,
            strict: 'ignore',
            output: 'html',
          });
        } catch {
          const delim = seg.display ? '$$' : '$';
          return (
            <span key={idx} className="text-rose-700">
              {`${delim}${seg.value}${delim}`}
            </span>
          );
        }
        if (seg.display) {
          return (
            <span
              key={idx}
              data-testid="latex-math"
              data-display="true"
              className="my-1 block"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          );
        }
        return (
          <span
            key={idx}
            data-testid="latex-math"
            data-display="false"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </span>
  );
}
