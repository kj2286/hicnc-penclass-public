/** In-memory upload receipts survive menu changes; nothing is written to device storage. */
export type PaperUploadPhase = 'upload' | 'ncode' | 'register' | 'verify' | 'solutions' | null;

export type PaperUploadSession<T> = {
  receipt: T | null;
  busy: boolean;
  phase: PaperUploadPhase;
  progress: number | null;
  error: string | null;
  acceptedIds: readonly number[];
};

/** Each teacher has an independent receipt and synchronous duplicate-request lock. */
export function createPaperUploadSessions<T>() {
  const empty: PaperUploadSession<T> = {
    receipt: null, busy: false, phase: null, progress: null, error: null,
    acceptedIds: Object.freeze([] as number[]),
  };
  const sessions = new Map<string, PaperUploadSession<T>>();
  const listeners = new Set<() => void>();
  const get = (ownerId: string): PaperUploadSession<T> => sessions.get(ownerId) ?? empty;
  const patch = (ownerId: string, change: Partial<PaperUploadSession<T>>) => {
    if (!ownerId) return;
    sessions.set(ownerId, { ...get(ownerId), ...change });
    listeners.forEach((listener) => listener());
  };
  return {
    get,
    patch,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    begin(ownerId: string): boolean {
      if (!ownerId || get(ownerId).busy) return false;
      patch(ownerId, { busy: true, error: null });
      return true;
    },
    finish(ownerId: string) {
      patch(ownerId, { busy: false, progress: null });
    },
    accept(ownerId: string, id: number) {
      if (!Number.isSafeInteger(id) || id <= 0) return;
      const ids = get(ownerId).acceptedIds;
      if (!ids.includes(id)) patch(ownerId, { acceptedIds: [...ids, id] });
    },
  };
}
