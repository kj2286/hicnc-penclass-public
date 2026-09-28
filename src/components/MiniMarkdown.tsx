/**
 * 리포트 본문용 **최소 마크다운** 렌더러 — `##` 헤더, `-` 리스트, `**굵게**` 만.
 * 리포트 세 섹션(학습자 결과분석·우선 학습대상·종합분석)이 마크다운으로 오기
 * 때문에 필요하다(사용자 지정 프롬프트, 2026-08-26). 외부 라이브러리를 들이지
 * 않는다 — 인쇄·PDF 캡처까지 같은 마크업으로 나가야 한다.
 */
import { LatexText } from './LatexText';

function Inline({ text }: { text: string }) {
  // **굵게** 만 처리하고 나머지는 수식 렌더러에 맡긴다
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((x) => x !== '');
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <b key={i} className="text-ink">
            <LatexText text={p.slice(2, -2)} />
          </b>
        ) : (
          <LatexText key={i} text={p} />
        ),
      )}
    </>
  );
}

export function MiniMarkdown({ text }: { text: string }) {
  const lines = (text ?? '').split('\n');
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length === 0) return;
    out.push(
      <ul key={key} className="ml-4 list-disc space-y-0.5">
        {list.map((li, i) => (
          <li key={i}>
            <Inline text={li} />
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      flush(`l${i}`);
      out.push(
        <p key={i} className="mt-2.5 text-[13.5px] font-bold text-ink first:mt-0">
          <Inline text={h[2]} />
        </p>,
      );
      return;
    }
    if (li) {
      list.push(li[1]);
      return;
    }
    flush(`l${i}`);
    if (line.trim() === '') return;
    out.push(
      <p key={i} className="mt-1 leading-relaxed">
        <Inline text={line} />
      </p>,
    );
  });
  flush('last');
  return <div className="text-sm text-ink">{out}</div>;
}
