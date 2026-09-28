/**
 * /s/submissions/:id — 제출 상세: 정보 + 필기 재생 + 피드백.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MessageSquareText } from 'lucide-react';
import { Skeleton } from '@seed-design/react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LatexText } from '@/components/LatexText';
import { EmptyState } from '@/components/EmptyState';
import {
  getFeedback,
  getSubmission,
  type FeedbackRow,
  type SubmissionRow,
} from '@/lib/api';
import { downloadStrokes } from '@/lib/strokes-io';
import type { Stroke } from '@/pen/live/model/stroke';
import { PlaybackView, type PlaybackPage } from './components/PlaybackView';
import {
  SubmissionStatusBadges,
  formatKoreanDate,
} from './components/SubmissionCard';

export function SubmissionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [submission, setSubmission] = useState<SubmissionRow | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [strokes, setStrokes] = useState<Stroke[] | null>(null);
  const [strokesError, setStrokesError] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<FeedbackRow | null>(null);
  const [feedbackChecked, setFeedbackChecked] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    getSubmission(id)
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          setNotFound(true);
          return;
        }
        setSubmission(row);
        // 스트로크 로드
        downloadStrokes(row.strokesPath)
          .then((s) => {
            if (!cancelled) setStrokes(s);
          })
          .catch(() => {
            if (!cancelled)
              setStrokesError('필기 데이터를 불러오지 못했어요.');
          });
      })
      .catch(() => {
        if (!cancelled)
          setSubmissionError('서버 준비 중입니다. 잠시 후 다시 시도해주세요.');
      });

    // 피드백 (선생님이 공개한 경우에만 값이 온다)
    getFeedback(id)
      .then((f) => {
        if (!cancelled) {
          setFeedback(f);
          setFeedbackChecked(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFeedbackChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const pages = useMemo<PlaybackPage[]>(() => {
    if (!strokes) return [];
    const byPage = new Map<number, Stroke[]>();
    for (const s of strokes) {
      const list = byPage.get(s.pageNumber) ?? [];
      list.push(s);
      byPage.set(s.pageNumber, list);
    }
    return [...byPage.keys()]
      .sort((a, b) => a - b)
      .map((p) => ({
        id: String(p),
        label: `${p}쪽`,
        strokes: byPage.get(p) ?? [],
      }));
  }, [strokes]);

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Callout
          tone="neutral"
          title="필기를 찾을 수 없어요"
          description="삭제되었거나 잘못된 주소예요."
        />
        <div>
          <ActionButton
            variant="neutralWeak"
            size="medium"
            onClick={() => navigate('/s/submissions')}
          >
            목록으로 돌아가기
          </ActionButton>
        </div>
      </div>
    );
  }

  if (submissionError) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <Callout tone="neutral" description={submissionError} />
      </div>
    );
  }

  if (!submission) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="h-[420px] w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const ocrContent = feedback?.ocrEdited ?? feedback?.ocrText ?? null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex items-start gap-2">
        <ActionButton
          variant="ghost"
          size="small"
          onClick={() => navigate('/s/submissions')}
          aria-label="목록으로"
          className="aspect-square !px-0 w-9 justify-center"
        >
          <ArrowLeft size={16} />
        </ActionButton>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold text-ink">{submission.title}</h2>
            <SubmissionStatusBadges submission={submission} />
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            {formatKoreanDate(submission.createdAt)}
            {submission.noteLabel ? ` · ${submission.noteLabel}` : ''}
            {submission.pageCount > 0 ? ` · ${submission.pageCount}쪽` : ''}
            {submission.strokeCount > 0
              ? ` · ${submission.strokeCount.toLocaleString()}획`
              : ''}
          </p>
        </div>
      </div>

      {/* 필기 재생 */}
      {strokesError ? (
        <Callout tone="critical" description={strokesError} />
      ) : strokes === null ? (
        <Skeleton className="h-[420px] w-full rounded-xl" />
      ) : pages.length === 0 ? (
        <Callout tone="neutral" description="재생할 필기 데이터가 없어요." />
      ) : (
        <PlaybackView pages={pages} canvasClassName="h-[440px] w-full" />
      )}

      {/* 피드백 섹션 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText size={18} className="text-brand" />
            선생님 피드백
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!feedbackChecked ? (
            <Skeleton className="h-20 w-full rounded-lg" />
          ) : feedback ? (
            <div className="flex flex-col gap-4">
              {feedback.body && (
                <div className="rounded-lg bg-brand-weak p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    <LatexText text={feedback.body} />
                  </p>
                </div>
              )}
              {ocrContent && (
                <div>
                  <h3 className="mb-2 text-base font-bold text-ink">
                    선생님이 정리한 필기 내용
                  </h3>
                  <div className="rounded-lg border border-line-weak p-4 text-sm leading-relaxed text-ink">
                    <LatexText
                      text={ocrContent}
                      className="whitespace-pre-wrap"
                    />
                  </div>
                </div>
              )}
              {!feedback.body && !ocrContent && (
                <p className="text-sm text-ink-muted">
                  피드백 내용이 비어 있어요.
                </p>
              )}
            </div>
          ) : (
            <EmptyState
              illustration="feedback"
              size="sm"
              title="아직 공개된 피드백이 없어요"
              description="선생님이 피드백을 공개하면 여기에서 볼 수 있어요."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
