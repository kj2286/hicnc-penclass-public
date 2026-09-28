/**
 * /s — 학생 홈. 큰 제목 + 보조문 + 펜 연결 CTA, 그 아래 지표 칩.
 * 장식은 두지 않는다 — 위계는 크기·굵기·여백으로만 만든다.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bluetooth,
  KeyRound,
  MessageSquareText,
  PenLine,
} from 'lucide-react';
import { Skeleton } from '@seed-design/react';
import { ActionableCallout, Callout } from 'seed-design/ui/callout';
import { useSessionStore } from '@/store/session.store';
import { useConnectionStore } from '@/store/connection.store';
import { isConnected } from '@/pen/connection/model/pen-connection-state';
import { listSubmissions, type SubmissionRow } from '@/lib/api';
import {
  SubmissionStatusBadges,
  SubmissionThumbnail,
  formatKoreanDate,
} from './components/SubmissionCard';

export function HomePage() {
  const navigate = useNavigate();
  const profile = useSessionStore((s) => s.profile);
  const connState = useConnectionStore((s) => s.state);

  const [submissions, setSubmissions] = useState<SubmissionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSubmissions({ role: 'student' })
      .then((rows) => {
        if (!cancelled) setSubmissions(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('서버 준비 중입니다. 잠시 후 다시 시도해주세요.');
          setSubmissions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = submissions === null && !loadError;
  const recent = (submissions ?? []).slice(0, 3);
  const feedbacks = (submissions ?? []).filter((s) => s.feedbackVisible);
  const connected = isConnected(connState);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      {/* ── 헤더 ─────────────────────────────────────────────────── */}
      <header>
        <p className="rt-eyebrow">SMART PEN · 하이씨앤씨 펜클래스</p>
        <h1 className="mt-2 max-w-[20ch] text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink sm:text-[40px]">
          {profile?.name ?? '학생'}님, 오늘의 필기를
          <br />
          기록하고 되돌아봐요
        </h1>
        <p className="mt-4 max-w-[46ch] text-[15px] leading-[1.47] text-ink-muted">
          스마트펜으로 쓴 손글씨를 영상처럼 다시 보고, 선생님께 보내 피드백까지 —
          손끝의 과정을 그대로 담아냅니다.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            className="rt-btn rt-btn-primary"
            onClick={() => navigate('/s/pen')}
          >
            {connected ? '펜 관리하기' : '펜 연결하기'}
            <ArrowRight size={16} />
          </button>
          <button
            type="button"
            className="rt-btn rt-btn-outline"
            onClick={() => navigate('/s/notes')}
          >
            필기 기록 보기
          </button>
        </div>
        <div className="mt-7 flex flex-wrap items-center gap-2.5">
          <MetricChip label="필기 페이지" value="+128" />
          <MetricChip label="다시 보기" value="영상" />
          <MetricChip label="선생님 피드백" value={`${feedbacks.length}건`} />
        </div>
      </header>

      {profile?.mustChangePassword && (
        <ActionableCallout
          tone="warning"
          prefixIcon={<KeyRound />}
          title="임시 비밀번호를 사용 중이에요"
          description="설정에서 새 비밀번호로 바꿔주세요."
          onClick={() => navigate('/s/settings')}
        />
      )}

      {loadError && <Callout tone="neutral" description={loadError} />}

      {/* ── 바로가기 카드 2열 ───────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ActionCard
          icon={<Bluetooth size={18} />}
          eyebrow="CONNECT"
          title="스마트펜 연결"
          body={
            connected
              ? `${connState.info.DeviceName || '스마트펜'} 연결됨`
              : '아직 연결된 펜이 없어요. 펜을 연결하면 필기를 불러올 수 있어요.'
          }
          cta={connected ? '펜 관리' : '펜 연결하기'}
          onClick={() => navigate('/s/pen')}
        />
        <div className="rt-card flex flex-col p-6">
          <p className="rt-eyebrow">FEEDBACK</p>
          <h3 className="mt-2 flex items-center gap-2 text-[17px] font-semibold text-ink">
            <MessageSquareText size={18} className="text-brand" />
            도착한 피드백
          </h3>
          <div className="mt-4 flex-1">
            {loading ? (
              <Skeleton className="h-12 w-full rounded-lg" />
            ) : feedbacks.length === 0 ? (
              <p className="text-sm text-ink-muted">
                아직 도착한 피드백이 없어요. 선생님이 피드백을 공개하면 여기에
                표시돼요.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {feedbacks.slice(0, 3).map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/s/submissions/${s.id}`)}
                      className="flex w-full items-center justify-between gap-3 rounded-lg bg-brand-weak px-3 py-2.5 text-left transition-opacity hover:opacity-80"
                    >
                      <span className="min-w-0 truncate text-sm font-semibold text-brand">
                        {s.title}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {formatKoreanDate(s.createdAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ── 최근 보낸 필기 (에디토리얼 섹션) ─────────────────────── */}
      <section>
        <div className="mb-4 flex items-end justify-between">
          <div>
            <p className="rt-eyebrow">RECENT</p>
            <h2 className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">
              최근 보낸 필기
            </h2>
          </div>
          <button
            type="button"
            className="text-sm font-medium text-brand hover:underline"
            onClick={() => navigate('/s/submissions')}
          >
            전체 보기
          </button>
        </div>
        <div className="rt-rule mb-4" />
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : recent.length === 0 ? (
          <div className="rt-panel px-6 py-10 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-weak text-brand">
              <PenLine size={20} />
            </div>
            <p className="text-sm text-ink-muted">
              아직 보낸 필기가 없어요. 필기 기록에서 노트를 다운로드해 선생님께
              보내보세요.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {recent.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/s/submissions/${s.id}`)}
                  className="rt-card hover-raise flex w-full items-center gap-3 p-3 text-left"
                >
                  <SubmissionThumbnail
                    path={s.thumbnailPath}
                    className="h-12 w-12"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {s.title}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {formatKoreanDate(s.createdAt)}
                    </span>
                  </span>
                  <SubmissionStatusBadges submission={s} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rt-chip">
      <span className="rt-chip-dot" />
      {label}
      <span className="rt-chip-val">{value}</span>
    </div>
  );
}

function ActionCard({
  icon,
  eyebrow,
  title,
  body,
  cta,
  onClick,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div className="rt-card flex flex-col p-6">
      <p className="rt-eyebrow">{eyebrow}</p>
      <h3 className="mt-2 flex items-center gap-2 text-[17px] font-semibold text-ink">
        <span className="text-brand">{icon}</span>
        {title}
      </h3>
      <p className="mt-3 flex-1 text-sm text-ink-muted">{body}</p>
      <button
        type="button"
        className="rt-btn rt-btn-outline-dark mt-5 self-start"
        onClick={onClick}
      >
        {cta}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
