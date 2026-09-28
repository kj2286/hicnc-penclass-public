import { useState } from 'react';
import { Download, FileText, Loader2, MoreVertical, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { OfflineNote } from '../model/offline-note';
import { noteDisplayName, noteSubtitle } from '../model/offline-note';
import { PagePickerDialog } from './PagePickerDialog';

type Props = {
  note: OfflineNote;
  busy?: boolean;
  onDownloadAll: (note: OfflineNote) => void;
  onDownloadPages: (note: OfflineNote, pageIds: number[]) => void;
  onFetchPages: (note: OfflineNote) => Promise<number[]>;
  onDelete: (note: OfflineNote) => Promise<void>;
};

export function NoteCard({
  note,
  busy,
  onDownloadAll,
  onDownloadPages,
  onFetchPages,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pagePickerOpen, setPagePickerOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(note);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <Card className="relative">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{noteDisplayName(note)}</p>
            {note.pages && (
              <Badge variant="outline" className="text-[10px]">
                {note.pages.length} pages
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{noteSubtitle(note)}</p>
        </div>
        <Button
          size="sm"
          onClick={() => onDownloadAll(note)}
          disabled={busy}
          className="gap-1.5"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          전체 다운로드
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="더보기"
          className="shrink-0"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
        {menuOpen && (
          <div
            className="absolute right-3 top-14 z-10 w-48 overflow-hidden rounded-md border border-border bg-card shadow-lg"
            onMouseLeave={() => setMenuOpen(false)}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary"
              onClick={() => {
                setMenuOpen(false);
                setPagePickerOpen(true);
              }}
            >
              <Download className="h-4 w-4" />
              페이지 선택 다운로드
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm text-destructive hover:bg-secondary"
              onClick={() => {
                setMenuOpen(false);
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              노트 삭제
            </button>
          </div>
        )}
      </CardContent>

      <PagePickerDialog
        open={pagePickerOpen}
        onOpenChange={setPagePickerOpen}
        fetchPages={() => onFetchPages(note)}
        onConfirm={(pageIds) => {
          setPagePickerOpen(false);
          onDownloadPages(note, pageIds);
        }}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              노트 삭제
            </DialogTitle>
            <DialogDescription>
              펜에서 <strong>{noteDisplayName(note)}</strong> (Section {note.section} · Owner{' '}
              {note.owner}) 를 삭제합니다. 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              취소
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  삭제 중...
                </>
              ) : (
                '삭제'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
