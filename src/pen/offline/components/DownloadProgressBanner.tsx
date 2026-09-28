import { AlertCircle, CheckCircle2, Download, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { DownloadState } from '@/store/offline.store';
import { noteDisplayName } from '../model/offline-note';

type Props = {
  state: DownloadState;
  onView: () => void;
  onDismiss: () => void;
};

export function DownloadProgressBanner({ state, onView, onDismiss }: Props) {
  if (state.kind === 'idle') return null;

  if (state.kind === 'loadingPages') {
    return (
      <BannerShell tone="neutral">
        <Download className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{noteDisplayName(state.note)} 페이지 목록 조회 중...</p>
        </div>
      </BannerShell>
    );
  }

  if (state.kind === 'downloading') {
    const percent = Math.max(0, Math.min(100, Math.round(state.percent)));
    return (
      <BannerShell tone="neutral">
        <Download className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {noteDisplayName(state.note)} 다운로드 중... {percent}%
          </p>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>
      </BannerShell>
    );
  }

  if (state.kind === 'downloaded') {
    return (
      <BannerShell tone="success">
        <CheckCircle2 className="h-5 w-5 text-success" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {noteDisplayName(state.note)} 다운로드 완료
          </p>
          <p className="text-xs text-muted-foreground">
            {state.totalStrokes} strokes · {state.totalDots} dots ·{' '}
            {Object.keys(state.strokesByPage).length} pages
          </p>
        </div>
        <Button size="sm" onClick={onView}>
          <Play className="h-4 w-4" />
          재생 보기
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          닫기
        </Button>
      </BannerShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <BannerShell tone="error">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">다운로드 실패</p>
          <p className="truncate text-xs text-muted-foreground">{state.reason}</p>
        </div>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          닫기
        </Button>
      </BannerShell>
    );
  }

  return null;
}

function BannerShell({
  tone,
  children,
}: {
  tone: 'neutral' | 'success' | 'error';
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        'flex items-center gap-3 px-4 py-3',
        tone === 'success' && 'border-success/40 bg-success/5',
        tone === 'error' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      {children}
    </Card>
  );
}
