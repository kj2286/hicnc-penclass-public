/**
 * /s/notes — 펜에 저장된 오프라인 필기.
 * 노트별: 노트 카드 → 다운로드(진행률) → 완료 시 재생 화면으로 이동.
 * 날짜별: 다운로드한 스트로크를 날짜로 그룹핑해 보여준다.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { kstDateKey, kstLongDate } from '@/lib/kst';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, NotebookPen, RefreshCw } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { ProgressCircle } from 'seed-design/ui/progress-circle';
import {
  SegmentedControl,
  SegmentedControlItem,
} from 'seed-design/ui/segmented-control';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/EmptyState';
import { useConnectionStore } from '@/store/connection.store';
import { useOfflineStore } from '@/store/offline.store';
import { isConnected } from '@/pen/connection/model/pen-connection-state';
import { useStrokeStore } from '@/store/stroke.store';
import { noteKey, type OfflineNote } from '@/pen/offline/model/offline-note';
import type { Stroke } from '@/pen/live/model/stroke';

export function NotesPage() {
  const navigate = useNavigate();
  const connState = useConnectionStore((s) => s.state);

  const notes = useOfflineStore((s) => s.notes);
  const notesLoading = useOfflineStore((s) => s.notesLoading);
  const notesError = useOfflineStore((s) => s.notesError);
  const download = useOfflineStore((s) => s.download);
  const refreshNotes = useOfflineStore((s) => s.refreshNotes);
  const fetchPages = useOfflineStore((s) => s.fetchPages);
  const startDownload = useOfflineStore((s) => s.startDownload);
  const resetDownload = useOfflineStore((s) => s.resetDownload);

  const [tab, setTab] = useState<'note' | 'date'>('note');
  /** 이 화면에서 사용자가 직접 다운로드를 시작했는지 (완료 시 자동 이동용) */
  const startedHereRef = useRef(false);
  /** 페이지 수 조회를 이미 시도한 노트 키 (중복 요청 방지) */
  const pagesTriedRef = useRef<Set<string>>(new Set());

  const connected = isConnected(connState);
  const controller = connected ? connState.controller : null;

  // 진입 시 항상 노트 목록 새로고침 — 방금 쓴 필기가 목록에 반영되도록
  useEffect(() => {
    if (!connected || !controller) return;
    if (!notesLoading) {
      refreshNotes(controller);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  // "마지막에 쓴 노트" — 라이브로 필기 중인(또는 방금 쓴) 노트를 목록 맨 위로
  const lastLivePage = useStrokeStore((s) => {
    const key = s.currentPageKey;
    return key ? (s.livePages.find((p) => p.key === key) ?? null) : null;
  });
  const sortedNotes = useMemo(() => {
    if (!lastLivePage) return notes;
    return [...notes].sort((a, b) => {
      const isLast = (n: OfflineNote) =>
        n.section === lastLivePage.section &&
        n.owner === lastLivePage.owner &&
        n.noteId === lastLivePage.noteId;
      return Number(isLast(b)) - Number(isLast(a));
    });
  }, [notes, lastLivePage]);

  // 노트 목록이 잡히면 페이지 수를 순차 조회해 카드에 표시
  useEffect(() => {
    if (!controller || notes.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const note of notes) {
        if (cancelled) return;
        const k = noteKey(note);
        if (note.pages || pagesTriedRef.current.has(k)) continue;
        pagesTriedRef.current.add(k);
        try {
          await fetchPages(controller, note);
        } catch {
          // 페이지 수 조회 실패는 치명적이지 않음 — 카드에 "확인 중"으로 남는다.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, controller]);

  // 다운로드 완료 시 재생 화면으로 이동
  useEffect(() => {
    if (download.kind === 'downloaded' && startedHereRef.current) {
      startedHereRef.current = false;
      navigate('/s/notes/replay');
    }
  }, [download.kind, navigate]);

  const handleDownload = (note: OfflineNote) => {
    if (!controller) return;
    resetDownload();
    startedHereRef.current = true;
    startDownload(controller, note);
  };

  if (!connected) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <PageHeader />
        <Card>
          <EmptyState
            illustration="pen"
            title="펜이 연결되어 있지 않아요"
            description="펜을 연결하면 펜에 저장된 필기 목록을 불러올 수 있어요."
            action={
              <ActionButton
                variant="brandSolid"
                size="medium"
                onClick={() => navigate('/s/pen')}
              >
                펜 연결하러 가기
              </ActionButton>
            }
          />
        </Card>
      </div>
    );
  }

  const downloading = download.kind === 'downloading';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader />
        <ActionButton
          variant="neutralOutline"
          size="small"
          onClick={() => controller && refreshNotes(controller)}
          loading={notesLoading}
          disabled={notesLoading}
        >
          <RefreshCw size={14} />
          새로고침
        </ActionButton>
      </div>

      <SegmentedControl
        aria-label="필기 보기 방식"
        value={tab}
        onValueChange={(v) => setTab(v as 'note' | 'date')}
        className="w-64"
      >
        <SegmentedControlItem value="note">노트별</SegmentedControlItem>
        <SegmentedControlItem value="date">날짜별</SegmentedControlItem>
      </SegmentedControl>

      {notesError && (
        <Callout
          tone="critical"
          title="노트 목록을 불러오지 못했어요"
          description={notesError}
        />
      )}

      {download.kind === 'error' && (
        <Callout
          tone="critical"
          title="다운로드에 실패했어요"
          description={download.reason}
        />
      )}

      <Callout
        tone="informative"
        description="펜이 연결된 동안 쓴 필기는 화면으로 실시간 전송돼요. 펜 단독으로(연결 없이) 쓴 필기는 펜 메모리에 저장되며, 여기서 다운로드해 다시 볼 수 있어요."
      />

      {tab === 'note' ? (
        <NoteListView
          notes={sortedNotes}
          notesLoading={notesLoading}
          downloadingNote={downloading ? download.note : null}
          downloadPercent={downloading ? download.percent : 0}
          hasDownloaded={download.kind === 'downloaded'}
          onDownload={handleDownload}
          onOpenReplay={() => navigate('/s/notes/replay')}
        />
      ) : (
        <DateGroupView />
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <header>
      <p className="rt-eyebrow mb-1.5">NOTES</p>
      <h2 className="text-2xl font-bold text-ink">필기 기록</h2>
      <p className="mt-1 text-sm text-ink-muted">
        펜에 저장된 필기를 다운로드해서 영상처럼 다시 볼 수 있어요.
      </p>
    </header>
  );
}

function NoteListView({
  notes,
  notesLoading,
  downloadingNote,
  downloadPercent,
  hasDownloaded,
  onDownload,
  onOpenReplay,
}: {
  notes: OfflineNote[];
  notesLoading: boolean;
  downloadingNote: OfflineNote | null;
  downloadPercent: number;
  hasDownloaded: boolean;
  onDownload: (note: OfflineNote) => void;
  onOpenReplay: () => void;
}) {
  if (notesLoading && notes.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-3 py-12">
          <ProgressCircle size="24" />
          <span className="text-sm text-ink-muted">펜에서 노트 목록을 불러오는 중이에요</span>
        </CardContent>
      </Card>
    );
  }

  if (notes.length === 0) {
    return (
      <Card>
        <EmptyState
          illustration="pen"
          title="저장된 필기가 없어요"
          description="펜의 오프라인 저장이 켜진 상태로 종이에 필기하면 여기에 목록이 나타나요."
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {hasDownloaded && (
        <Callout
          tone="informative"
          title="다운로드한 필기가 있어요"
          description="바로 재생 화면에서 다시 볼 수 있어요."
          linkProps={{ children: '재생 화면 열기', onClick: onOpenReplay }}
        />
      )}
      {notes.map((note) => {
        const k = noteKey(note);
        const isDownloading =
          downloadingNote != null && noteKey(downloadingNote) === k;
        return (
          <Card key={k}>
            <CardContent className="flex items-center gap-4 py-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-weak">
                <NotebookPen size={20} className="text-brand" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold text-ink">
                  노트 {note.noteId}
                </div>
                <div className="text-sm text-ink-muted">
                  섹션 {note.section} · 오너 {note.owner} ·{' '}
                  {note.pages ? `${note.pages.length}쪽` : '페이지 확인 중'}
                </div>
              </div>
              {isDownloading ? (
                <div className="flex items-center gap-2">
                  <ProgressCircle
                    size="24"
                    value={downloadPercent}
                    minValue={0}
                    maxValue={100}
                  />
                  <span className="text-sm tabular-nums text-ink-muted">
                    {Math.round(downloadPercent)}%
                  </span>
                </div>
              ) : (
                <ActionButton
                  variant="brandOutline"
                  size="small"
                  onClick={() => onDownload(note)}
                  disabled={downloadingNote != null}
                >
                  다운로드
                </ActionButton>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** 다운로드된 스트로크를 날짜별로 묶어 보여주는 보기 */
function DateGroupView() {
  const download = useOfflineStore((s) => s.download);

  const groups = useMemo(() => {
    if (download.kind !== 'downloaded') return [];
    const all: Array<{ stroke: Stroke; page: number }> = [];
    for (const [page, strokes] of Object.entries(download.strokesByPage)) {
      for (const s of strokes) all.push({ stroke: s, page: Number(page) });
    }
    const byDate = new Map<
      string,
      { label: string; ts: number; strokeCount: number; pages: Set<number> }
    >();
    for (const { stroke, page } of all) {
      const d = new Date(stroke.startedAt);
      if (Number.isNaN(d.getTime()) || stroke.startedAt <= 0) continue;
      const key = kstDateKey(d.getTime()); // 한국 시간 고정
      const entry = byDate.get(key) ?? {
        label: kstLongDate(d.getTime()),
        ts: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
        strokeCount: 0,
        pages: new Set<number>(),
      };
      entry.strokeCount += 1;
      entry.pages.add(page);
      byDate.set(key, entry);
    }
    return [...byDate.values()].sort((a, b) => b.ts - a.ts);
  }, [download]);

  if (download.kind !== 'downloaded') {
    return (
      <Card>
        <EmptyState
          illustration="pen"
          title="아직 다운로드한 필기가 없어요"
          description="노트별 탭에서 노트를 다운로드하면 필기한 날짜별로 모아서 볼 수 있어요."
        />
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-ink-muted">
          날짜 정보가 있는 필기가 없어요.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <Card key={g.ts}>
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-neutral-weak">
              <CalendarDays size={20} className="text-ink-muted" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-ink">{g.label}</div>
              <div className="text-sm text-ink-muted">
                획 {g.strokeCount.toLocaleString()}개 ·{' '}
                {[...g.pages].sort((a, b) => a - b).map((p) => `${p}쪽`).join(', ')}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
