/** 제출물 목록에서 공용으로 쓰는 조각들 — 상태 배지, 썸네일. */
import { useEffect, useState } from 'react';
import { Badge } from '@seed-design/react';
import { FileText } from 'lucide-react';
import { signedThumbnailUrl } from '@/lib/strokes-io';
import type { SubmissionRow } from '@/lib/api';

export function SubmissionStatusBadge({
  status,
}: {
  status: SubmissionRow['status'];
}) {
  return status === 'reviewed' ? (
    <Badge size="medium" variant="weak" tone="positive">
      검토완료
    </Badge>
  ) : (
    <Badge size="medium" variant="weak" tone="informative">
      제출됨
    </Badge>
  );
}

/** Storage 서명 URL 을 받아 그리는 제출 썸네일. 실패/없음이면 아이콘 자리표시. */
export function SubmissionThumb({ path }: { path: string | null }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!path) return;
    signedThumbnailUrl(path)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        /* 썸네일 실패는 치명적이지 않음 — 자리표시 유지 */
      });
    return () => {
      alive = false;
    };
  }, [path]);

  if (url) {
    return (
      <img
        src={url}
        alt=""
        className="h-14 w-14 shrink-0 rounded-lg border border-line-weak bg-layer-default object-cover"
      />
    );
  }
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-line-weak bg-neutral-weak text-ink-subtle">
      <FileText size={18} />
    </div>
  );
}
