/**
 * 클릭해서 바로 고치는 인라인 편집 텍스트 — 블러 시 변경분만 커밋.
 *
 * 보기 모드에서는 LaTeX 를 **수식으로 렌더**하고(LatexText), 클릭하면 원문
 * (`$…$` 그대로)으로 바뀌어 편집한다. 편집 중에 렌더된 수식을 보여주면
 * contentEditable 이 KaTeX DOM 을 먹어 원문이 깨진다.
 */
import { useEffect, useRef, useState } from 'react';
import { LatexText } from '@/components/LatexText';

export function Editable({
  value,
  onCommit,
  className = '',
  multiline = false,
  as: Tag = 'span',
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  multiline?: boolean;
  as?: 'span' | 'p' | 'div';
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  // 편집 진입 시 커서를 끝에 두고 포커스
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const base =
    'cursor-text rounded-sm outline-none transition-colors hover:bg-brand-weak/20 focus:bg-brand-weak/30 focus:ring-1 focus:ring-brand ';

  if (!editing) {
    return (
      <Tag
        title="클릭해서 바로 수정"
        className={base + className}
        onClick={() => setEditing(true)}
      >
        <LatexText text={value} />
      </Tag>
    );
  }

  return (
    <Tag
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      title="수정 후 바깥을 클릭하면 저장됩니다"
      className={base + className}
      onKeyDown={(e) => {
        if (!multiline && e.key === 'Enter') {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
      onBlur={(e) => {
        const next = (e.currentTarget.textContent ?? '').trim();
        if (next && next !== value) onCommit(next);
        setEditing(false);
      }}
    >
      {value}
    </Tag>
  );
}
