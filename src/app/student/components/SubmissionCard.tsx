/**
 * 보낸 필기 1건 카드 — 썸네일 + 제목 + 날짜 + 상태 배지.
 */
import { useEffect, useState } from 'react';
import { kstLongDate } from '@/lib/kst';
import { NotebookPen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { signedThumbnailUrl } from '@/lib/strokes-io';
import type { SubmissionRow } from '@/lib/api';

export function formatKoreanDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return kstLongDate(d.getTime()); // 한국 시간 고정
}

export function SubmissionStatusBadges({
  submission,
}: {
  submission: SubmissionRow;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {submission.status === 'reviewed' ? (
        <Badge variant="success">검토완료</Badge>
      ) : (
        <Badge variant="secondary">제출됨</Badge>
      )}
      {submission.feedbackVisible && <Badge variant="default">피드백 도착</Badge>}
    </span>
  );
}

/** 썸네일 이미지 — signed URL 발급 실패 시 아이콘 플레이스홀더로 대체 */
export function SubmissionThumbnail({
  path,
  className,
}: {
  path: string | null;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!path) {
      setUrl(null);
      return;
    }
    signedThumbnailUrl(path)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div
      className={
        'flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line-weak bg-neutral-weak ' +
        (className ?? 'h-16 w-16')
      }
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setUrl(null)}
        />
      ) : (
        <NotebookPen size={20} className="text-ink-subtle" />
      )}
    </div>
  );
}

export function SubmissionCard({
  submission,
  onClick,
}: {
  submission: SubmissionRow;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover-raise flex w-full items-center gap-4 rounded-xl border border-line-weak bg-layer-default p-4 text-left"
    >
      <SubmissionThumbnail path={submission.thumbnailPath} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-ink">
          {submission.title}
        </div>
        <div className="mt-0.5 text-sm text-ink-muted">
          {formatKoreanDate(submission.createdAt)}
          {submission.noteLabel ? ` · ${submission.noteLabel}` : ''}
          {submission.pageCount > 0 ? ` · ${submission.pageCount}쪽` : ''}
        </div>
      </div>
      <SubmissionStatusBadges submission={submission} />
    </button>
  );
}
