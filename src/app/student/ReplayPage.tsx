/**
 * /s/notes/replay — 다운로드한 필기 재생 + "선생님께 보내기".
 * offline.store 의 다운로드 결과(download.kind === 'downloaded')를 재생한다.
 */
import { useMemo, useState } from 'react';
import { kstMonthDay } from '@/lib/kst';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { useOfflineStore } from '@/store/offline.store';
import { useSessionStore } from '@/store/session.store';
import { createSubmission } from '@/lib/api';
import {
  strokesPath,
  uploadStrokes,
  uploadThumbnail,
} from '@/lib/strokes-io';
import { computeTimeRange } from '@/pen/offline/model/stroke-playback-filter';
import { strokeBounds, type Stroke } from '@/pen/live/model/stroke';
import { renderStrokeGroupToPng } from '@/pen/live/model/stroke-image';
import { PlaybackView, type PlaybackPage } from './components/PlaybackView';
import { useStudentSnackbar } from './components/snackbar';

function defaultTitle(): string {
  const now = new Date();
  return `${kstMonthDay(now.getTime())} 필기`;
}

function base64ToBlob(base64: string, type: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function ReplayPage() {
  const navigate = useNavigate();
  const snackbar = useStudentSnackbar();
  const profile = useSessionStore((s) => s.profile);
  const download = useOfflineStore((s) => s.download);

  const isDownloaded = download.kind === 'downloaded';
  const note = isDownloaded ? download.note : null;

  const pages = useMemo<PlaybackPage[]>(() => {
    if (download.kind !== 'downloaded') return [];
    return Object.keys(download.strokesByPage)
      .map(Number)
      .sort((a, b) => a - b)
      .map((p) => ({
        id: String(p),
        label: `${p}쪽`,
        strokes: download.strokesByPage[p] ?? [],
      }));
  }, [download]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  if (!isDownloaded || pages.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
            <p className="text-lg font-bold text-ink">재생할 필기가 없어요</p>
            <p className="text-sm text-ink-muted">
              필기 기록에서 노트를 먼저 다운로드해주세요.
            </p>
            <ActionButton
              variant="brandSolid"
              size="medium"
              onClick={() => navigate('/s/notes')}
            >
              필기 기록으로 가기
            </ActionButton>
          </CardContent>
        </Card>
      </div>
    );
  }

  const noteLabel = note ? `노트 ${note.noteId}` : null;

  const handleSend = async () => {
    if (!profile) {
      setSendError('로그인 정보를 확인할 수 없어요. 다시 로그인해주세요.');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      setSendError('제목을 입력해주세요.');
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      const allStrokes: Stroke[] = pages.flatMap((p) => p.strokes);
      const range = computeTimeRange(allStrokes);
      const durationMs = Math.max(0, range.max - range.min);
      const hasValidRange = range.min > 0 && range.max >= range.min;

      const submissionId = crypto.randomUUID();

      // 1) 스트로크 업로드
      const path = await uploadStrokes(profile.id, submissionId, allStrokes);

      // 2) 썸네일 (첫 페이지 기준, 실패해도 제출은 계속)
      let thumbPath: string | null = null;
      try {
        const firstPage = pages[0].strokes;
        const bounds = strokeBounds(firstPage);
        if (bounds) {
          const rendered = await renderStrokeGroupToPng(firstPage, {
            minX: bounds.minX,
            minY: bounds.minY,
            maxX: bounds.maxX,
            maxY: bounds.maxY,
          });
          thumbPath = await uploadThumbnail(
            profile.id,
            submissionId,
            base64ToBlob(rendered.base64, 'image/png'),
          );
        }
      } catch {
        thumbPath = null;
      }

      // 3) 제출 레코드 생성 — 업로드한 파일 경로를 그대로 전달한다.
      await createSubmission({
        title: trimmed,
        noteLabel,
        pageCount: pages.length,
        strokeCount: allStrokes.length,
        durationMs,
        writtenFrom: hasValidRange ? new Date(range.min).toISOString() : null,
        writtenTo: hasValidRange ? new Date(range.max).toISOString() : null,
        strokesPath: path || strokesPath(profile.id, submissionId),
        thumbnailPath: thumbPath,
      });

      snackbar.success('선생님께 필기를 보냈어요.');
      setDialogOpen(false);
      navigate('/s/submissions');
    } catch (err) {
      setSendError(
        err instanceof Error
          ? err.message
          : '보내는 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ActionButton
            variant="ghost"
            size="small"
            onClick={() => navigate('/s/notes')}
            aria-label="필기 기록으로"
            className="aspect-square !px-0 w-9 justify-center"
          >
            <ArrowLeft size={16} />
          </ActionButton>
          <div>
            <h2 className="text-2xl font-bold text-ink">필기 다시 보기</h2>
            <p className="text-sm text-ink-muted">
              {noteLabel} · {pages.length}쪽 ·{' '}
              {download.totalStrokes.toLocaleString()}획
            </p>
          </div>
        </div>
        <ActionButton
          variant="brandSolid"
          size="medium"
          onClick={() => {
            setSendError(null);
            setTitle(defaultTitle());
            setDialogOpen(true);
          }}
        >
          <Send size={15} />
          선생님께 보내기
        </ActionButton>
      </div>

      <PlaybackView pages={pages} canvasClassName="h-[480px] w-full" />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>선생님께 보내기</DialogTitle>
            <DialogDescription>
              {noteLabel ? `${noteLabel}의 ` : ''}
              {pages.length}쪽 필기를 담당 선생님께 보내요.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <TextField label="제목" required>
              <TextFieldInput
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder={defaultTitle()}
                disabled={sending}
              />
            </TextField>
            {sendError && (
              <Callout
                tone="critical"
                title="보내지 못했어요"
                description={sendError}
              />
            )}
          </div>
          <DialogFooter>
            <ActionButton
              variant="neutralWeak"
              size="medium"
              onClick={() => setDialogOpen(false)}
              disabled={sending}
            >
              취소
            </ActionButton>
            <ActionButton
              variant="brandSolid"
              size="medium"
              onClick={() => void handleSend()}
              loading={sending}
              disabled={sending}
            >
              보내기
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
