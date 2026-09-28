import { Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PaperPageState } from './usePaperPage';

type Variant = 'hidden' | 'loading' | 'absent' | 'error';

function resolveVariant(state: PaperPageState): { variant: Variant; reason?: string } {
  switch (state.kind) {
    case 'idle':
      return { variant: 'hidden' };
    case 'ready':
      return { variant: 'hidden' };
    case 'loading':
      return { variant: 'loading' };
    case 'unavailable': {
      const r = state.reason;
      // Env-level "NGS turned off" is not a fault — render nothing.
      if (r === 'NGS disabled' || r === 'NoteServer disabled') {
        return { variant: 'hidden' };
      }
      // The page legitimately doesn't exist on the server.
      if (
        r === 'paper not registered with NGS' ||
        r === 'PDF not found' ||
        r === 'preview URL missing' ||
        r.startsWith('page ')
      ) {
        return { variant: 'absent', reason: r };
      }
      return { variant: 'error', reason: r };
    }
  }
}

type Props = {
  state: PaperPageState;
  onRetry?: () => void;
};

export function PaperStatusBadge({ state, onRetry }: Props) {
  const { variant, reason } = resolveVariant(state);
  if (variant === 'hidden') return null;

  if (variant === 'loading') {
    return (
      <Badge variant="outline" className="pointer-events-none gap-1.5">
        <Loader2 className="h-3 w-3 animate-spin" />
        PDF 로딩 중
      </Badge>
    );
  }
  if (variant === 'absent') {
    return (
      <Badge variant="secondary" title={reason}>
        PDF 없음
      </Badge>
    );
  }
  return (
    <Badge
      variant="destructive"
      className="pointer-events-auto gap-1"
      // 원인을 툴팁에 그대로 — 인증서 만료·네트워크 장애를 구분할 수 있게
      title={reason}
    >
      {/certificate|SSL|TLS|인증서|fetch failed|502/i.test(reason ?? '')
        ? '교재 서버 연결 실패'
        : 'PDF 로드 실패'}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          aria-label="PDF 재시도"
          className="-mr-1 ml-0.5 rounded-full p-0.5 hover:bg-destructive/20"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
