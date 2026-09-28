import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudDownload, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useConnectionStore } from '@/store/connection.store';
import { useOfflineStore } from '@/store/offline.store';
import { isConnected } from '@/pen/connection/model/pen-connection-state';
import { NoteCard } from './components/NoteCard';
import { DownloadProgressBanner } from './components/DownloadProgressBanner';
import type { OfflineNote } from './model/offline-note';

export function OfflineNotesScreen() {
  const navigate = useNavigate();
  const connState = useConnectionStore((s) => s.state);
  const notes = useOfflineStore((s) => s.notes);
  const notesLoading = useOfflineStore((s) => s.notesLoading);
  const notesError = useOfflineStore((s) => s.notesError);
  const download = useOfflineStore((s) => s.download);

  const refreshNotes = useOfflineStore((s) => s.refreshNotes);
  const fetchPages = useOfflineStore((s) => s.fetchPages);
  const startDownload = useOfflineStore((s) => s.startDownload);
  const deleteNote = useOfflineStore((s) => s.deleteNote);
  const resetDownload = useOfflineStore((s) => s.resetDownload);

  const connected = isConnected(connState);
  const controller = connected ? connState.controller : null;

  // Initial load
  useEffect(() => {
    if (!connected || !controller) return;
    if (notes.length === 0 && !notesLoading) {
      refreshNotes(controller);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  if (!connected) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-sm text-muted-foreground">
        펜이 연결되어 있지 않습니다.
      </div>
    );
  }

  const handleDownloadAll = (note: OfflineNote) => {
    if (!controller) return;
    resetDownload();
    startDownload(controller, note);
  };

  const handleDownloadPages = (note: OfflineNote, pages: number[]) => {
    if (!controller) return;
    resetDownload();
    startDownload(controller, note, pages);
  };

  const handleFetchPages = async (note: OfflineNote) => {
    if (!controller) return [];
    return fetchPages(controller, note);
  };

  const handleDelete = async (note: OfflineNote) => {
    if (!controller) return;
    try {
      await deleteNote(controller, note);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[offline] deleteNote failed', err);
    } finally {
      refreshNotes(controller);
    }
  };

  const busyForDownload = download.kind === 'downloading' || download.kind === 'loadingPages';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CloudDownload className="h-5 w-5 text-primary" />
            오프라인 데이터
          </h2>
          <p className="text-xs text-muted-foreground">
            펜에 저장된 과거 필기 노트를 다운로드하고 재생합니다.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => controller && refreshNotes(controller)}
          disabled={notesLoading}
          className="gap-1.5"
        >
          {notesLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          새로고침
        </Button>
      </header>

      <DownloadProgressBanner
        state={download}
        onView={() => navigate('/home/offline/view')}
        onDismiss={resetDownload}
      />

      {notesError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{notesError}</CardContent>
        </Card>
      )}

      {notesLoading && notes.length === 0 && (
        <Card>
          <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            노트 목록 조회 중...
          </CardContent>
        </Card>
      )}

      {!notesLoading && notes.length === 0 && !notesError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Inbox className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold">저장된 노트가 없습니다</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                오프라인 저장 설정을 켠 뒤 펜으로 필기하면 여기에 목록이 나타납니다.
              </p>
            </div>
            <Badge variant="outline">Offline Save · On 필요</Badge>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {notes.map((note) => (
          <NoteCard
            key={`${note.section}_${note.owner}_${note.noteId}`}
            note={note}
            busy={busyForDownload}
            onDownloadAll={handleDownloadAll}
            onDownloadPages={handleDownloadPages}
            onFetchPages={handleFetchPages}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
