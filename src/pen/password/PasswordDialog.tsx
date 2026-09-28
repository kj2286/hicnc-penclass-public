import { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useConnectionStore } from '@/store/connection.store';
import { needsPassword } from '@/pen/connection/model/pen-connection-state';

export function PasswordDialog() {
  const state = useConnectionStore((s) => s.state);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastChanceAck, setLastChanceAck] = useState(false);

  const open = needsPassword(state);
  const retryCount = open ? state.retryCount : 0;
  const resetCount = open ? state.resetCount : 0;
  const atLastChance = open && retryCount === 0;

  useEffect(() => {
    if (!open) {
      setPassword('');
      setSubmitting(false);
      setLastChanceAck(false);
    }
  }, [open]);

  const canSubmit =
    password.length === 4 && !submitting && (!atLastChance || lastChanceAck);

  const submit = () => {
    if (!open) return;
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      state.controller.InputPassword(password);
    } catch {
      // SDK surfaces errors via messageCallback
    } finally {
      setPassword('');
      setTimeout(() => setSubmitting(false), 600);
    }
  };

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            펜 비밀번호 입력
          </DialogTitle>
          <DialogDescription>
            Neo Smartpen이 비밀번호를 요구합니다. 4자리 숫자를 입력하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoFocus
            placeholder="••••"
            value={password}
            onChange={(e) => setPassword(e.target.value.replace(/\D/g, '').slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            className="text-center font-mono text-2xl tracking-[0.5em]"
          />
          {atLastChance ? (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <div className="flex items-start gap-2 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong className="font-semibold">마지막 시도입니다.</strong>{' '}
                  이번에도 틀리면 펜의 필기 데이터가 초기화됩니다
                  (잔여 리셋 {resetCount}회).
                </span>
              </div>
              <label className="flex items-center gap-2 text-xs text-destructive">
                <input
                  type="checkbox"
                  checked={lastChanceAck}
                  onChange={(e) => setLastChanceAck(e.target.checked)}
                  aria-label="초기화 위험 확인"
                />
                <span>위 내용을 이해했으며 마지막 시도를 진행합니다.</span>
              </label>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              남은 시도 {retryCount}회 · {resetCount}회 실패 시 필기 데이터가 초기화됩니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => useConnectionStore.getState().disconnect()}
          >
            연결 취소
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> 확인 중...
              </>
            ) : (
              '확인'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
