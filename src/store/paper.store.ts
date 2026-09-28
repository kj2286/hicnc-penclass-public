import { create } from 'zustand';
import {
  getPdfPage,
  getPdfWithPages,
  isNgsEnabled,
  listAllPdfs,
  type Pdf,
  type PdfPage,
  type PdfPageResponse,
} from '@/lib/ngs-client';
import { resolvePaperSizeBasis, preloadImage } from '@/lib/image-loader';
import { shouldAdoptIndex } from '@/lib/index-adopt';

/**
 * Identifies a single ncode-bearing page in NGS. The pen emits this
 * 4-tuple per dot and we use it as the cache key for paper entries.
 *
 * Format: `${section}_${ownerNo}_${bookNo}_${ncodePage}`.
 */
export type PaperKey = string;

export function paperKeyFor(
  section: number,
  ownerNo: number,
  bookNo: number,
  ncodePage: number,
): PaperKey {
  return `${section}_${ownerNo}_${bookNo}_${ncodePage}`;
}

/** Index entry from a `(section, ownerNo, bookNo, ncodePage)` lookup. */
export type NcodeIndexEntry = {
  pdfId: number;
  pageIndex: number;
  /** Width / height / dpi from the page metadata; signed URL fetched on demand. */
  widthPx: number;
  heightPx: number;
  dpi: number;
  /**
   * Authoritative imprint paper size (mm) the ncode was issued for, when the
   * BE persists it (BE.ngs PR #29). Drives the overlay coordinate basis in
   * preference to the preview-px/dpi inference; absent on legacy/PoC pages.
   */
  paperWidthMm?: number;
  paperHeightMm?: number;
  /** 원본 PDF(교재) 제목 — 어떤 파일에 쓰는지 UI 에 표시 */
  pdfTitle?: string;
};

export type PaperEntry = {
  key: PaperKey;
  /** Resolved page metadata + signed preview URL. null on miss. */
  page: PdfPageResponse | null;
  /** Preloaded preview <img>. null on miss / before load. */
  image: HTMLImageElement | null;
  /** Derived ncode-coord paperSize. null on miss. */
  paperSize: { Xmin: 0; Xmax: number; Ymin: 0; Ymax: number } | null;
  /** 원본 PDF(교재) 제목. miss 면 null. */
  pdfTitle?: string | null;
  /** PDF 내 실제 페이지 번호(1-based) — ncode 페이지 번호와 다르다. */
  pdfPageNumber?: number | null;
  error: string | null;
};

type IndexState =
  | { kind: 'idle' }
  | { kind: 'loading'; promise: Promise<void> }
  | { kind: 'ready'; map: Map<PaperKey, NcodeIndexEntry> }
  | { kind: 'error'; reason: string };

/** 배경 교재 수동 교정 — 이 ncode 페이지를 특정 PDF 페이지로 강제 매핑.
 *  (NGS PoC 가 삭제된 교재의 ncode 범위를 재사용해, 예전 인쇄물이 엉뚱한
 *   교재로 매칭되는 사례의 유일한 복구 수단 — 리뷰 화면에서 선생님이 지정) */
export type PaperOverride = {
  pdfId: number;
  pageIndex: number;
  pdfTitle?: string;
};

/** 배경 이미지보다 먼저 알 수 있는 페이지 기하 — 로딩 중 필기를 제자리에
 *  그리기 위한 선공개 메타 (이미지 도착 시 지오메트리 점프 방지). */
export type PaperMeta = {
  paperSize: { Xmin: 0; Xmax: number; Ymin: 0; Ymax: number };
  widthPx: number;
  heightPx: number;
};

type State = {
  cache: Record<PaperKey, PaperEntry>;
  pending: Record<PaperKey, Promise<PaperEntry>>;
  index: IndexState;
  overrides: Record<PaperKey, PaperOverride>;
  metaCache: Record<PaperKey, PaperMeta>;
};

type Actions = {
  /**
   * Resolve `(section, owner, book, page)` to a `PaperEntry` with a
   * preloaded preview image. Returns an unavailable entry (error or
   * null page) when NGS is disabled, the lookup misses, or the fetch
   * fails. Caches successful + 404 results; transient errors retry.
   */
  ensurePaper: (
    section: number,
    owner: number,
    book: number,
    page: number,
  ) => Promise<PaperEntry>;
  /** Drop a cached entry so the next ensurePaper hits the network. */
  invalidatePaper: (
    section: number,
    owner: number,
    book: number,
    page: number,
  ) => void;
  /** Force-rebuild the ncode index (e.g. after upload). */
  refreshIndex: () => Promise<void>;
  /** 배경 교재 교정 병합 적용 — 해당 키의 캐시를 비워 즉시 재해석되게 한다. */
  setPaperOverrides: (next: Record<PaperKey, PaperOverride>) => void;
};

type Store = State & Actions;

function unavailable(key: PaperKey, reason: string): PaperEntry {
  return { key, page: null, image: null, paperSize: null, error: reason };
}

/**
 * ncode 인덱스만 보장하고 (section, owner, book, page) 항목을 조회한다.
 * 배경 렌더 없이 pdfTitle/pdfId 등 메타 매칭용 (예: 리뷰 화면 PDF별 그룹).
 * NGS 비활성/인덱스 실패/미등록이면 null.
 */
export async function lookupNcodeEntry(
  section: number,
  owner: number,
  book: number,
  page: number,
): Promise<NcodeIndexEntry | null> {
  if (!isNgsEnabled()) return null;
  // 수동 교정이 있으면 그것이 정답 (제목·페이지 라벨도 교정본 기준)
  const ov = usePaperStore.getState().overrides[paperKeyFor(section, owner, book, page)];
  if (ov) {
    return {
      pdfId: ov.pdfId,
      pageIndex: ov.pageIndex,
      widthPx: 0,
      heightPx: 0,
      dpi: 0,
      pdfTitle: ov.pdfTitle,
    };
  }
  let idx = usePaperStore.getState().index;
  if (idx.kind === 'idle' || idx.kind === 'error') {
    const promise = loadIndex()
      .then((m) => {
        usePaperStore.setState({ index: { kind: 'ready', map: m } });
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        usePaperStore.setState({ index: { kind: 'error', reason } });
      });
    usePaperStore.setState({ index: { kind: 'loading', promise } });
    await promise;
  } else if (idx.kind === 'loading') {
    await idx.promise;
  }
  idx = usePaperStore.getState().index;
  if (idx.kind !== 'ready') return null;
  return idx.map.get(paperKeyFor(section, owner, book, page)) ?? null;
}

/** 인덱스가 준비될 때까지 보장하고 map 을 반환한다 (실패 시 null). */
async function ensureIndexReady(): Promise<Map<PaperKey, NcodeIndexEntry> | null> {
  if (!isNgsEnabled()) return null;
  let idx = usePaperStore.getState().index;
  if (idx.kind === 'idle' || idx.kind === 'error') {
    const promise = loadIndex()
      .then((m) => {
        usePaperStore.setState({ index: { kind: 'ready', map: m } });
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        usePaperStore.setState({ index: { kind: 'error', reason } });
      });
    usePaperStore.setState({ index: { kind: 'loading', promise } });
    await promise;
  } else if (idx.kind === 'loading') {
    await idx.promise;
  }
  idx = usePaperStore.getState().index;
  return idx.kind === 'ready' ? idx.map : null;
}

/** pdfId 하나의 페이지 한 장 — ncode 좌표 포함 (리뷰 화면 전체 페이지 표시용). */
export type PdfIndexPage = {
  key: PaperKey;
  pageIndex: number;
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
};

/**
 * 한 PDF(교재)의 **전체 페이지 목록** — 필기 유무와 무관하게 pageIndex 오름차순.
 * 수동 교정(overrides)이 이 pdfId 를 가리키면 그 pageIndex 는 교정된 ncode
 * 키로 대체된다 (학생 필기가 실제로 그 키에 쓰여 있으므로).
 */
export async function listPdfPagesFromIndex(
  pdfId: number,
): Promise<PdfIndexPage[]> {
  const map = await ensureIndexReady();
  if (!map) return [];
  const byPageIndex = new Map<number, PdfIndexPage>();
  const parse = (key: PaperKey, pageIndex: number): PdfIndexPage | null => {
    const parts = key.split('_').map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    return {
      key,
      pageIndex,
      section: parts[0],
      owner: parts[1],
      noteId: parts[2],
      pageNumber: parts[3],
    };
  };
  for (const [key, entry] of map) {
    if (entry.pdfId !== pdfId) continue;
    const p = parse(key, entry.pageIndex);
    if (p) byPageIndex.set(entry.pageIndex, p);
  }
  const overrides = usePaperStore.getState().overrides;
  for (const [key, ov] of Object.entries(overrides)) {
    if (ov.pdfId !== pdfId) continue;
    const p = parse(key, ov.pageIndex);
    if (p) byPageIndex.set(ov.pageIndex, p);
  }
  return [...byPageIndex.values()].sort((a, b) => a.pageIndex - b.pageIndex);
}

// ── ncode 인덱스 localStorage 캐시 ──
// buildIndex 는 NGS 릴레이로 모든 PDF 를 순회해 수 초가 걸린다("PDF 로딩중"
// 체감의 주범). 10분 TTL 캐시를 먼저 쓰고 백그라운드로 갱신한다(SWR).
const INDEX_CACHE_KEY = 'ngs_index_cache_v1';
const INDEX_CACHE_TTL_MS = 10 * 60_000;

function readIndexCache(): {
  map: Map<PaperKey, NcodeIndexEntry>;
  stale: boolean;
} | null {
  try {
    const raw = window.localStorage.getItem(INDEX_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      at: number;
      entries: Array<[PaperKey, NcodeIndexEntry]>;
    };
    if (!parsed?.at) return null;
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) return null;
    return {
      map: new Map(parsed.entries),
      stale: Date.now() - parsed.at > INDEX_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function writeIndexCache(map: Map<PaperKey, NcodeIndexEntry>): void {
  try {
    window.localStorage.setItem(
      INDEX_CACHE_KEY,
      JSON.stringify({ at: Date.now(), entries: [...map.entries()] }),
    );
  } catch {
    /* 저장 실패는 무시 — 다음에 다시 빌드하면 된다 */
  }
}

/**
 * 캐시 우선 인덱스 로드.
 *  - 신선한 캐시가 있으면 즉시 반환 + 백그라운드 갱신(SWR)
 *  - 빌드가 실패하면(교재 서버 장애·인증서 만료) **만료된 캐시라도 사용**한다.
 *    2026-08-13 NGS 인증서 만료 때, 캐시가 있는데도 전부 "PDF 로드 실패"로
 *    떨어져 이미 보던 교재까지 못 봤다 — stale 이라도 있는 편이 낫다.
 */
async function loadIndex(): Promise<Map<PaperKey, NcodeIndexEntry>> {
  const cached = readIndexCache();
  if (cached && !cached.stale) {
    void buildIndex()
      .then((r) => {
        if (!adoptable(r, cached.map)) return;
        writeIndexCache(r.map);
        usePaperStore.setState({ index: { kind: 'ready', map: r.map } });
      })
      .catch(() => {});
    return cached.map;
  }
  try {
    const r = await buildIndex();
    if (cached && !adoptable(r, cached.map)) return cached.map;
    writeIndexCache(r.map);
    return r.map;
  } catch (err) {
    if (cached) return cached.map;
    throw err;
  }
}

function adoptable(
  result: { map: Map<PaperKey, NcodeIndexEntry>; failed: number },
  cachedMap: Map<PaperKey, NcodeIndexEntry>,
): boolean {
  return shouldAdoptIndex(
    { size: result.map.size, failed: result.failed },
    cachedMap.size,
  );
}

async function buildIndex(): Promise<{
  map: Map<PaperKey, NcodeIndexEntry>;
  /** 인덱싱에 실패한 교재 수 — 0 이 아니면 인덱스가 불완전하다 */
  failed: number;
}> {
  const map = new Map<PaperKey, NcodeIndexEntry>();
  const pdfs: Pdf[] = await listAllPdfs();
  // Walk PDFs in parallel — small cardinality at the demo.
  // 한 교재가 실패해도 나머지는 인덱싱한다 — allSettled 가 아니면 PDF 하나의
  // 오류가 전체 인덱스를 날려 모든 배경이 사라진다 (2026-08-13 장애 교훈)
  const settled = await Promise.allSettled(
    pdfs.map(async (p) => {
      const detail = await getPdfWithPages(p.id);
      if (!detail || !detail.pages) return;
      for (const pg of detail.pages as PdfPage[]) {
        if (pg.status && pg.status !== 'active') continue;
        const k = paperKeyFor(pg.section, pg.ownerNo, pg.bookNo, pg.ncodePage);
        // 같은 ncode 페이지를 두 PDF 가 주장하면(서버 범위 재사용 사고)
        // 병렬 완료 순서에 따라 배경이 뒤바뀌지 않게 **최신(pdfId 큰) 쪽**으로 고정
        const prev = map.get(k);
        if (prev && prev.pdfId >= pg.pdfId) continue;
        map.set(k, {
          pdfId: pg.pdfId,
          pageIndex: pg.pageIndex,
          widthPx: pg.widthPx,
          heightPx: pg.heightPx,
          dpi: pg.dpi,
          paperWidthMm: pg.paperWidthMm,
          paperHeightMm: pg.paperHeightMm,
          // 맥 파일명은 자소 분해(NFD)로 올라온다 — 표시·비교 전 NFC 정규화
          pdfTitle: (detail.title || p.title || undefined)?.normalize('NFC'),
        });
      }
    }),
  );
  return {
    map,
    failed: settled.filter((s) => s.status === 'rejected').length,
  };
}

export const usePaperStore = create<Store>()((set, get) => ({
  cache: {},
  pending: {},
  index: { kind: 'idle' },
  overrides: {},
  metaCache: {},

  setPaperOverrides: (next) => {
    set((s) => {
      const cache = { ...s.cache };
      for (const k of Object.keys(next)) delete cache[k];
      return { overrides: { ...s.overrides, ...next }, cache };
    });
  },

  ensurePaper: async (section, owner, book, page) => {
    const key = paperKeyFor(section, owner, book, page);
    if (!isNgsEnabled()) {
      return unavailable(key, 'NGS disabled');
    }

    // Reuse a cached or in-flight resolution for this key.
    const cached = get().cache[key];
    if (cached) return cached;
    const inFlight = get().pending[key];
    if (inFlight) return inFlight;

    const task: Promise<PaperEntry> = (async (): Promise<PaperEntry> => {
      // 0. 수동 교정(override)이 있으면 인덱스를 거치지 않고 지정 PDF 페이지로.
      const ov = get().overrides[key];
      let lookup: NcodeIndexEntry;
      if (ov) {
        lookup = {
          pdfId: ov.pdfId,
          pageIndex: ov.pageIndex,
          widthPx: 0,
          heightPx: 0,
          dpi: 0,
          pdfTitle: ov.pdfTitle,
        };
      } else {
        // 1. Ensure ncode index is loaded (single-flight).
        let map: Map<PaperKey, NcodeIndexEntry>;
        const idx = get().index;
        if (idx.kind === 'ready') {
          map = idx.map;
        } else if (idx.kind === 'loading') {
          await idx.promise;
          const refreshed = get().index;
          if (refreshed.kind === 'ready') {
            map = refreshed.map;
          } else {
            return unavailable(key, 'ncode index unavailable');
          }
        } else {
          const promise = loadIndex()
            .then((m) => {
              set({ index: { kind: 'ready', map: m } });
            })
            .catch((err: unknown) => {
              const reason = err instanceof Error ? err.message : String(err);
              set({ index: { kind: 'error', reason } });
            });
          set({ index: { kind: 'loading', promise } });
          await promise;
          const finalIdx = get().index;
          if (finalIdx.kind !== 'ready') {
            const reason =
              finalIdx.kind === 'error' ? finalIdx.reason : 'index build failed';
            return unavailable(key, reason);
          }
          map = finalIdx.map;
        }

        // 2. Look up by ncode tuple.
        const found = map.get(key);
        if (!found) {
          // Genuine miss — cache as null page so we don't re-walk indices for
          // a page the user hasn't uploaded.
          return { key, page: null, image: null, paperSize: null, error: null };
        }
        lookup = found;
      }

      // 인덱스 치수만으로도 대략적 기하를 선공개한다 — 배경 이미지를 기다리는
      // 동안 필기를 제자리에 그리기 위함 (아래 pageResp 기반 값으로 정밀화).
      if (lookup.widthPx > 0 && lookup.heightPx > 0) {
        const early = resolvePaperSizeBasis({
          widthPx: lookup.widthPx,
          heightPx: lookup.heightPx,
          dpi: lookup.dpi,
          paperWidthMm: lookup.paperWidthMm,
          paperHeightMm: lookup.paperHeightMm,
        });
        set((s) => ({
          metaCache: {
            ...s.metaCache,
            [key]: {
              paperSize: early.paperSize,
              widthPx: lookup.widthPx,
              heightPx: lookup.heightPx,
            },
          },
        }));
      }

      // 3. Fetch the page detail (also primes the Cloud-CDN-Cookie),
      //    then preload the full-resolution image via the CDN.
      let pageResp: PdfPageResponse | null;
      try {
        pageResp = await getPdfPage(lookup.pdfId, lookup.pageIndex);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return unavailable(key, reason);
      }
      if (!pageResp || !pageResp.originalImageUrl) {
        return unavailable(key, 'preview URL missing');
      }

      // Coordinate basis: prefer the authoritative imprint paper size (the
      // size the ncode was issued for) over the preview-px/dpi inference, so a
      // future change to how the server renders previews can't silently
      // misalign strokes. `drift` flags any divergence between the two.
      //
      // Source of the mm size: the per-page response is the single source of
      // truth (BE.ngs PR #34) — use it when present, falling back to the
      // index-derived value (from GET /pdfs/{id}) for servers that don't yet
      // carry mm on the per-page endpoint.
      const paperWidthMm = pageResp.paperWidthMm ?? lookup.paperWidthMm;
      const paperHeightMm = pageResp.paperHeightMm ?? lookup.paperHeightMm;
      const basis = resolvePaperSizeBasis({
        widthPx: pageResp.widthPx,
        heightPx: pageResp.heightPx,
        dpi: pageResp.dpi,
        paperWidthMm,
        paperHeightMm,
      });
      if (basis.source === 'a4-fallback') {
        // No per-page imprint size — we assume A4 (the NGS default imprint).
        // If the preview is materially non-A4 the assumption may mis-position
        // strokes; surface it so the page gets its `paperWidthMm` back-filled.
        const drift = basis.drift ?? 0;
        if (drift > 0.02) {
          // eslint-disable-next-line no-console
          console.warn(
            `[paper.store] ${key}: no imprint paperWidthMm — assuming A4, but the ` +
              `preview (${pageResp.widthPx}×${pageResp.heightPx}px @${pageResp.dpi}dpi) ` +
              `is ${(drift * 100).toFixed(1)}% off A4. Strokes may misalign; ` +
              `back-fill this page's imprint paper size in NGS.`,
          );
        }
      } else if (basis.drift != null && basis.drift > 0.01) {
        // eslint-disable-next-line no-console
        console.warn(
          `[paper.store] ${key}: imprint paperSize differs from preview-derived ` +
            `by ${(basis.drift * 100).toFixed(1)}% — preview render no longer ` +
            `matches the imprint paper (${paperWidthMm}×${paperHeightMm}mm ` +
            `vs ${pageResp.widthPx}×${pageResp.heightPx}px @${pageResp.dpi}dpi). ` +
            `Using imprint size; check the NGS preview renderer.`,
        );
      }

      // 페이지 응답 기반의 정밀 기하 선공개 — 이미지 다운로드보다 먼저.
      set((s) => ({
        metaCache: {
          ...s.metaCache,
          [key]: {
            paperSize: basis.paperSize,
            widthPx: pageResp.widthPx,
            heightPx: pageResp.heightPx,
          },
        },
      }));

      let image: HTMLImageElement;
      try {
        // CDN 직접 로드는 vercel.app 오리진에서 Cloud-CDN-Cookie(서드파티)를
        // 못 보내 403 — 항상 같은 오리진 프록시로 페이지 PNG 를 받는다.
        image = await preloadImage(
          `/api/download-pdf?id=${lookup.pdfId}&kind=page&page=${lookup.pageIndex}`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return unavailable(key, reason);
      }

      return {
        key,
        page: pageResp,
        image,
        paperSize: basis.paperSize,
        pdfTitle: lookup.pdfTitle ?? null,
        pdfPageNumber: lookup.pageIndex ?? null,
        error: null,
      };
    })();

    set((s) => ({ pending: { ...s.pending, [key]: task } }));
    const entry = await task;
    set((s) => {
      const { [key]: _removed, ...pendingRest } = s.pending;
      void _removed;
      // Cache successful resolutions and confirmed 404s; skip transient errors.
      const shouldCache = entry.error == null;
      const nextCache = shouldCache ? { ...s.cache, [key]: entry } : s.cache;
      return { cache: nextCache, pending: pendingRest };
    });
    return entry;
  },

  invalidatePaper: (section, owner, book, page) => {
    const key = paperKeyFor(section, owner, book, page);
    set((s) => {
      const { [key]: _cacheRemoved, ...cacheRest } = s.cache;
      void _cacheRemoved;
      const { [key]: _pendingRemoved, ...pendingRest } = s.pending;
      void _pendingRemoved;
      return { cache: cacheRest, pending: pendingRest };
    });
  },

  refreshIndex: async () => {
    // 강제 갱신 — 캐시를 거치지 않고 새로 빌드해 캐시도 덮어쓴다.
    // 다만 교재 서버가 반쯤 죽어 반쪽 인덱스가 나온 경우는 덮어쓰지 않고
    // 실패로 알린다 — 손으로 새로고침했다고 멀쩡한 캐시를 잃을 이유는 없다.
    const prev = readIndexCache()?.map;
    const promise = buildIndex()
      .then((r) => {
        if (prev && !adoptable(r, prev)) {
          set({
            index: {
              kind: 'error',
              reason: `교재 ${r.failed}건을 불러오지 못해 갱신을 취소했습니다. 잠시 후 다시 시도해주세요.`,
            },
          });
          return;
        }
        writeIndexCache(r.map);
        set({ index: { kind: 'ready', map: r.map } });
      })
      .catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        set({ index: { kind: 'error', reason } });
      });
    set({ index: { kind: 'loading', promise } });
    await promise;
  },
}));
