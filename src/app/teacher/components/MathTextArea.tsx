/**
 * 수식이 섞인 긴 텍스트 입력 — **기본은 수식으로 렌더**, 클릭하면 원문 편집.
 *
 * OCR 결과·피드백에는 `$\frac{3}{4}$` 같은 LaTeX 가 들어온다. 늘 textarea 로
 * 두면 선생님에게 코드가 보이고, 늘 렌더만 하면 고칠 수 없다. 그래서
 * 보기(렌더) ↔ 편집(원문)을 클릭으로 오간다. (사용자 요구, 2026-08-13)
 */
import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { TextField, TextFieldTextarea } from 'seed-design/ui/text-field';
import { LatexText } from '@/components/LatexText';

export function MathTextArea({
  label,
  description,
  value,
  onChange,
  onCommit,
  placeholder,
  className = 'min-h-32',
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (next: string) => void;
  /** 편집을 마칠 때(블러) 1회 호출 — 저장 훅 */
  onCommit?: (next: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <TextField label={label} description="수정 후 바깥을 클릭하면 저장됩니다.">
        <TextFieldTextarea
          ref={ref as never}
          className={className}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          onBlur={(e) => {
            setEditing(false);
            onCommit?.(e.currentTarget.value);
          }}
          placeholder={placeholder}
        />
      </TextField>
    );
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{label}</span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1 text-[11px] text-ink-subtle hover:text-ink hover:underline"
        >
          <Pencil size={11} /> 편집
        </button>
      </div>
      {description && (
        <p className="mb-1.5 text-xs text-ink-subtle">{description}</p>
      )}
      <div
        role="button"
        tabIndex={0}
        title="클릭해서 편집"
        onClick={() => setEditing(true)}
        onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}
        className={
          'cursor-text whitespace-pre-wrap rounded-lg border border-line-weak bg-layer-default p-3 text-sm leading-relaxed text-ink hover:border-line-solid ' +
          className
        }
      >
        {value ? (
          <LatexText text={value} />
        ) : (
          <span className="text-ink-subtle">{placeholder}</span>
        )}
      </div>
    </div>
  );
}
