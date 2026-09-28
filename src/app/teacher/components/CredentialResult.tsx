/** 학생 계정 발급/재발급 결과 — 아이디·비밀번호를 크게 보여주고 복사 버튼 제공. */
import { Copy } from 'lucide-react';
import { Callout } from 'seed-design/ui/callout';
import { useToast } from './toast';
import { copyText } from '../format';

export type Credential = { username: string; password: string };

function CredentialLine({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="rounded-xl border border-line-weak bg-layer-fill p-4">
      <div className="mb-1 text-xs text-ink-subtle">{label}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="break-all font-mono text-xl font-bold text-ink">
          {value}
        </span>
        <button
          type="button"
          onClick={onCopy}
          aria-label={`${label} 복사`}
          className="shrink-0 rounded-lg border border-line-weak bg-layer-default p-2 text-ink-muted hover:bg-neutral-weak hover:text-ink"
        >
          <Copy size={16} />
        </button>
      </div>
    </div>
  );
}

export function CredentialResult({
  studentName,
  credential,
}: {
  studentName: string;
  credential: Credential;
}) {
  const toast = useToast();

  const copy = async (label: string, value: string) => {
    const ok = await copyText(value);
    toast(
      ok ? `${label}를 복사했습니다.` : '복사에 실패했습니다. 직접 선택해 복사해주세요.',
      ok ? 'positive' : 'critical',
    );
  };

  return (
    <div className="space-y-3">
      <CredentialLine
        label="아이디"
        value={credential.username}
        onCopy={() => void copy('아이디', credential.username)}
      />
      <CredentialLine
        label="임시 비밀번호"
        value={credential.password}
        onCopy={() => void copy('비밀번호', credential.password)}
      />
      <button
        type="button"
        onClick={() =>
          void copy(
            '계정 정보',
            `하이씨앤씨 펜클래스 계정 안내\n이름: ${studentName}\n아이디: ${credential.username}\n비밀번호: ${credential.password}`,
          )
        }
        className="w-full rounded-lg border border-line-weak bg-layer-default py-2 text-sm font-medium text-ink-muted hover:bg-neutral-weak hover:text-ink"
      >
        아이디·비밀번호 한 번에 복사
      </button>
      <Callout
        tone="informative"
        title="학생에게 전달하세요"
        description="이 임시 비밀번호는 학생이 로그인한 뒤 직접 변경할 수 있습니다. 창을 닫아도 학생 목록에서 다시 확인할 수 있어요."
      />
    </div>
  );
}
