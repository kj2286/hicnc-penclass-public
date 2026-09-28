import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { PenController } from '@/types/sdk';
import type { Stroke } from '@/pen/live/model/stroke';
import { penBus } from '@/lib/pen-event-bus';
import type {
  OfflineNoteListEntry,
  OfflinePageListPayload,
} from '@/lib/pen-event-bus';
import type { OfflineNote } from '@/pen/offline/model/offline-note';
import { groupStrokesByPage } from '@/pen/offline/model/offline-stroke-mapper';

export type DownloadState =
  | { kind: 'idle' }
  | { kind: 'loadingPages'; note: OfflineNote }
  | { kind: 'downloading'; note: OfflineNote; percent: number }
  | {
      kind: 'downloaded';
      note: OfflineNote;
      strokesByPage: Record<number, Stroke[]>;
      totalStrokes: number;
      totalDots: number;
    }
  | { kind: 'error'; note: OfflineNote | null; reason: string };

type PageListCallback = {
  resolve: (pages: number[]) => void;
  reject: (err: Error) => void;
};

type PendingPageList = {
  section: number;
  owner: number;
  note: number;
  callbacks: PageListCallback[];
  timeoutId: number;
};

type PendingDelete = {
  resolve: (ok: boolean) => void;
  reject: (err: Error) => void;
  timeoutId: number;
};

type State = {
  notes: OfflineNote[];
  notesLoading: boolean;
  notesError: string | null;
  download: DownloadState;
};

type Actions = {
  refreshNotes: (controller: PenController) => void;
  fetchPages: (controller: PenController, note: OfflineNote) => Promise<number[]>;
  startDownload: (
    controller: PenController,
    note: OfflineNote,
    pageIds?: number[],
  ) => void;
  deleteNote: (controller: PenController, note: OfflineNote) => Promise<boolean>;
  resetDownload: () => void;
  reset: () => void;
};

type Store = State & Actions;

// In-memory registry of in-flight requests (kept outside the immutable state).
const pendingPageLists: Map<string, PendingPageList> = new Map();
let pendingDelete: PendingDelete | null = null;

function pageListKey(section: number, owner: number, note: number): string {
  return `${section}_${owner}_${note}`;
}

const DOWNLOAD_TIMEOUT_MS = 60_000;

export const useOfflineStore = create<Store>()(
  subscribeWithSelector(
    immer<Store>((set, get) => ({
      notes: [],
      notesLoading: false,
      notesError: null,
      download: { kind: 'idle' },

      refreshNotes: (controller) => {
        set((s) => {
          s.notesLoading = true;
          s.notesError = null;
        });
        try {
          controller.RequestOfflineNoteList(0, 0);
        } catch (err) {
          set((s) => {
            s.notesLoading = false;
            s.notesError = err instanceof Error ? err.message : String(err);
          });
        }
      },

      fetchPages: (controller, note) => {
        const k = pageListKey(note.section, note.owner, note.noteId);
        return new Promise<number[]>((resolve, reject) => {
          const existing = pendingPageLists.get(k);
          if (existing) {
            existing.callbacks.push({ resolve, reject });
            return;
          }
          const timeoutId = window.setTimeout(() => {
            const p = pendingPageLists.get(k);
            pendingPageLists.delete(k);
            const err = new Error('fetchPages timeout');
            p?.callbacks.forEach((cb) => cb.reject(err));
          }, DOWNLOAD_TIMEOUT_MS);
          pendingPageLists.set(k, {
            section: note.section,
            owner: note.owner,
            note: note.noteId,
            callbacks: [{ resolve, reject }],
            timeoutId,
          });
          try {
            controller.RequestOfflinePageList(note.section, note.owner, note.noteId);
          } catch (err) {
            window.clearTimeout(timeoutId);
            pendingPageLists.delete(k);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },

      startDownload: (controller, note, pageIds) => {
        set((s) => {
          s.download = { kind: 'downloading', note, percent: 0 };
        });
        try {
          controller.RequestOfflineData(
            note.section,
            note.owner,
            note.noteId,
            false,
            pageIds ?? [],
          );
        } catch (err) {
          set((s) => {
            s.download = {
              kind: 'error',
              note,
              reason: err instanceof Error ? err.message : String(err),
            };
          });
        }
      },

      deleteNote: (controller, note) => {
        return new Promise<boolean>((resolve, reject) => {
          if (pendingDelete) {
            reject(new Error('Another delete is already in progress'));
            return;
          }
          const timeoutId = window.setTimeout(() => {
            pendingDelete = null;
            reject(new Error('deleteNote timeout'));
          }, DOWNLOAD_TIMEOUT_MS);
          pendingDelete = {
            resolve,
            reject,
            timeoutId,
          };
          try {
            controller.RequestOfflineDelete(note.section, note.owner, [note.noteId]);
          } catch (err) {
            window.clearTimeout(timeoutId);
            pendingDelete = null;
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },

      resetDownload: () => {
        set((s) => {
          s.download = { kind: 'idle' };
        });
      },

      reset: () => {
        // Reject any in-flight requests so callers don't hang.
        const resetErr = new Error('offline store reset');
        for (const p of pendingPageLists.values()) {
          window.clearTimeout(p.timeoutId);
          p.callbacks.forEach((cb) => cb.reject(resetErr));
        }
        pendingPageLists.clear();
        if (pendingDelete) {
          window.clearTimeout(pendingDelete.timeoutId);
          pendingDelete.reject(resetErr);
          pendingDelete = null;
        }
        set((s) => {
          s.notes = [];
          s.notesLoading = false;
          s.notesError = null;
          s.download = { kind: 'idle' };
        });
        // Silence unused `get` for future use
        void get;
      },
    })),
  ),
);

let wired = false;

export function wireOfflineBus() {
  if (wired) return;
  wired = true;

  penBus.on('offlineNoteList', ({ notes }) => {
    const mapped: OfflineNote[] = notes.map((n: OfflineNoteListEntry) => ({
      section: n.Section,
      owner: n.Owner,
      noteId: n.Note,
    }));
    useOfflineStore.setState((s) => {
      s.notes = mapped;
      s.notesLoading = false;
      s.notesError = null;
    });
  });

  penBus.on('offlinePageList', (payload: OfflinePageListPayload) => {
    const k = pageListKey(payload.section, payload.owner, payload.note);
    const pending = pendingPageLists.get(k);
    if (pending) {
      window.clearTimeout(pending.timeoutId);
      pendingPageLists.delete(k);
      pending.callbacks.forEach((cb) => cb.resolve(payload.pages));
    }
    // Also keep the pages cached on the matching note (if already listed)
    useOfflineStore.setState((s) => {
      const idx = s.notes.findIndex(
        (n) =>
          n.section === payload.section &&
          n.owner === payload.owner &&
          n.noteId === payload.note,
      );
      if (idx >= 0) {
        s.notes[idx].pages = payload.pages;
      }
    });
  });

  penBus.on('offlineSendStart', () => {
    useOfflineStore.setState((s) => {
      if (s.download.kind === 'downloading') {
        s.download = { ...s.download, percent: 0 };
      }
    });
  });

  penBus.on('offlineSendProgress', ({ percent }) => {
    useOfflineStore.setState((s) => {
      if (s.download.kind === 'downloading') {
        s.download = { ...s.download, percent };
      }
    });
  });

  penBus.on('offlineSendSuccess', ({ strokes: raw }) => {
    useOfflineStore.setState((s) => {
      if (s.download.kind !== 'downloading') return;
      const { strokesByPage, totalStrokes, totalDots } = groupStrokesByPage(raw);
      s.download = {
        kind: 'downloaded',
        note: s.download.note,
        strokesByPage,
        totalStrokes,
        totalDots,
      };
    });
  });

  penBus.on('offlineSendFailure', () => {
    useOfflineStore.setState((s) => {
      const note = s.download.kind === 'downloading' ? s.download.note : null;
      s.download = {
        kind: 'error',
        note,
        reason: '펜에서 오프라인 데이터 전송 실패를 보고했습니다.',
      };
    });
  });

  penBus.on('offlineDeleteResponse', ({ result }) => {
    if (pendingDelete) {
      window.clearTimeout(pendingDelete.timeoutId);
      const p = pendingDelete;
      pendingDelete = null;
      p.resolve(result);
    }
  });

  penBus.on('penDisconnected', () => {
    useOfflineStore.getState().reset();
  });
}
