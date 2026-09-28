/**
 * /s/submissions — 보낸 필기 목록.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@seed-design/react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import { listSubmissions, type SubmissionRow } from '@/lib/api';
import { SubmissionCard } from './components/SubmissionCard';

export function SubmissionsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SubmissionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSubmissions({ role: 'student' })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch(() => {
        if (!cancelled)
          setError('서버 준비 중입니다. 잠시 후 다시 시도해주세요.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header>
        <p className="rt-eyebrow mb-1.5">INBOX</p>
        <h2 className="text-2xl font-bold text-ink">보낸 필기 · 피드백</h2>
        <p className="mt-1 text-sm text-ink-muted">
          선생님께 보낸 필기와 도착한 피드백을 확인할 수 있어요.
        </p>
      </header>

      {error && <Callout tone="neutral" description={error} />}

      {rows === null && !error ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : (rows ?? []).length === 0 && !error ? (
        <Card>
          <EmptyState
            illustration="inbox"
            title="아직 보낸 필기가 없어요"
            description="필기 기록에서 노트를 다운로드한 뒤 선생님께 보내보세요."
            action={
              <ActionButton
                variant="brandSolid"
                size="medium"
                onClick={() => navigate('/s/notes')}
              >
                필기 기록으로 가기
              </ActionButton>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {(rows ?? []).map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              onClick={() => navigate(`/s/submissions/${s.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
