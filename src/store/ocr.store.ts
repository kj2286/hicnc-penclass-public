/**
 * Per-stroke-group OCR state. Keyed by `StrokeGroup.id`, which is stable
 * across stroke appends within the same group (the group id is derived
 * from the first stroke's id, so growing the group does NOT change it).
 *
 * Because growing a group changes its dot count / endedAt without
 * changing its id, we tag each entry with a `version` string and only
 * accept results whose request was made against the same version.
 *
 * The store is intentionally thin — `recognizeGroup` owns the request
 * lifecycle (rendering → fetch → result) so consumers (LiveScreen) just
 * call it and react to state. AbortController support means swapping to
 * a BE proxy later only changes `ocr-client`, not this file.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { recognizeStrokeImage, type OcrTimings } from '@/lib/ocr-client';
import { renderStrokeGroupToPng } from '@/pen/live/model/stroke-image';
import type { StrokeGroup } from '@/pen/live/model/stroke-groups';

export type OcrStatus = 'pending' | 'success' | 'error';

export type OcrEntry = {
  status: OcrStatus;
  text?: string;
  error?: string;
  /** Identity of the group content at request time. */
  version: string;
  startedAt: number;
  finishedAt?: number;
  /** Latency breakdown — populated on success. Lets us spot when the
   *  webapp's overhead diverges from the API's own service time. */
  timings?: OcrTimings & { renderMs: number };
};

type OcrState = {
  byGroupId: Record<string, OcrEntry>;
};

type OcrActions = {
  /**
   * Request OCR for `group`. No-ops if the cached entry already matches
   * the current group version (success or pending). On error, callers
   * can call again to retry — the failed entry is overwritten.
   */
  recognizeGroup: (group: StrokeGroup) => Promise<void>;
  /** Force re-recognition regardless of cache state. */
  retry: (group: StrokeGroup) => Promise<void>;
  clear: () => void;
};

type Store = OcrState & OcrActions;

/** Inflight aborters keyed by groupId. We cancel the previous request
 *  when a new version of the same group arrives. Stored outside the
 *  zustand state because AbortController is not serialisable. */
const inflight = new Map<string, AbortController>();

/**
 * Stable identity of a group's *content*. Two distinct fingerprints
 * mean the OCR input would differ. We use endedAt + dotCount + stroke
 * count which together change whenever new dots arrive within the
 * group's id-stable window.
 */
export function groupVersion(group: StrokeGroup): string {
  return `${group.endedAt}:${group.dotCount}:${group.strokes.length}`;
}

export const useOcrStore = create<Store>()(
  immer<Store>((set, get) => ({
    byGroupId: {},

    recognizeGroup: async (group) => {
      const version = groupVersion(group);
      const existing = get().byGroupId[group.id];

      if (existing && existing.version === version) {
        if (existing.status === 'success' || existing.status === 'pending') {
          return; // already in-flight or already resolved
        }
        // 'error' with same version → fall through and re-attempt
      }

      // Cancel any inflight call for an older version of this group.
      const prev = inflight.get(group.id);
      if (prev) prev.abort();
      const controller = new AbortController();
      inflight.set(group.id, controller);

      set((s) => {
        s.byGroupId[group.id] = {
          status: 'pending',
          version,
          startedAt: Date.now(),
        };
      });

      try {
        const tRenderStart =
          typeof performance !== 'undefined' ? performance.now() : Date.now();
        const { base64 } = await renderStrokeGroupToPng(group.strokes, group.bbox);
        const renderMs =
          (typeof performance !== 'undefined'
            ? performance.now()
            : Date.now()) - tRenderStart;
        let apiTimings: OcrTimings | undefined;
        const text = await recognizeStrokeImage(base64, {
          signal: controller.signal,
          onTimings: (t) => {
            apiTimings = t;
          },
        });

        // If a newer request superseded us between fetch start and now,
        // discard. The newer one will own the result.
        if (controller.signal.aborted) return;
        if (inflight.get(group.id) !== controller) return;
        inflight.delete(group.id);

        if (apiTimings && import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.info(
            '[ocr]',
            `group=${group.id}`,
            `render=${renderMs.toFixed(0)}ms`,
            `fetch=${apiTimings.fetchMs.toFixed(0)}ms`,
            `parse=${apiTimings.parseMs.toFixed(0)}ms`,
            `total=${apiTimings.totalMs.toFixed(0)}ms`,
            `req=${(apiTimings.requestBytes / 1024).toFixed(1)}KB`,
            `resp=${apiTimings.responseChars}c`,
          );
        }

        set((s) => {
          // Only overwrite if our version is still the latest one we saw.
          const cur = s.byGroupId[group.id];
          if (!cur || cur.version !== version) return;
          s.byGroupId[group.id] = {
            status: 'success',
            text,
            version,
            startedAt: cur.startedAt,
            finishedAt: Date.now(),
            timings: apiTimings ? { ...apiTimings, renderMs } : undefined,
          };
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        if (inflight.get(group.id) === controller) inflight.delete(group.id);
        set((s) => {
          const cur = s.byGroupId[group.id];
          if (!cur || cur.version !== version) return;
          s.byGroupId[group.id] = {
            status: 'error',
            error: humanizeError(err),
            version,
            startedAt: cur.startedAt,
            finishedAt: Date.now(),
          };
        });
      }
    },

    retry: async (group) => {
      // Forget the cache for this group so `recognizeGroup` re-issues.
      set((s) => {
        delete s.byGroupId[group.id];
      });
      const prev = inflight.get(group.id);
      if (prev) prev.abort();
      inflight.delete(group.id);
      await get().recognizeGroup(group);
    },

    clear: () => {
      for (const c of inflight.values()) c.abort();
      inflight.clear();
      set((s) => {
        s.byGroupId = {};
      });
    },
  })),
);

function humanizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  return String(err);
}
