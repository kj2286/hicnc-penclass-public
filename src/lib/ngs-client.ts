/**
 * Client for the NGS (Ncode Generate Service) REST API v1.
 *
 * Auth: none on the wire. NGS is reached SAME-ORIGIN through the relay
 * sidecar, which holds the PMK and injects `Authorization: Basic
 * <base64("PMK-…:")>` server-side. The webapp sends NO Authorization header
 * (so the browser's cached edge auth_basic credential reaches nginx). The
 * client keeps a non-secret sentinel only to satisfy its "enabled" guards.
 *
 * The pen emits `(section, owner, book, page)` per dot. NGS stores those
 * four values on each `PdfPage` row, so we build a client-side inverse
 * index `(section, ownerNo, bookNo, ncodePage) → {pdfId, pageIndex}` from
 * `GET /pdfs` + `GET /pdfs/{id}` and resolve preview PNGs with
 * `GET /pdfs/{id}/pages/{idx}`. Base URL defaults to the same-origin `/ngs`.
 */

export type Pdf = {
  id: number;
  /** NcodePaper UUID — the GCS / CDN URL prefix for this paper. */
  uuid: string;
  memberId: number;
  title?: string;
  pageCount: number;
  pdfSizeBytes: number;
  originalPdfUri: string;
  ncodedPdfUri?: string;
  /**
   * Cookie-authenticated CDN URLs for the paper-level PDFs (added by
   * BE PR #20 / `feat: PDF 다운로드를 Cloud-CDN-Cookie + CDN URL 흐름으로 전환`).
   * Server populates these on `GET /pdfs/{id}`; absent on older deploys
   * — fall back to `paperResourceCdnUrl()`'s page-based derivation.
   */
  originalPdfUrl?: string;
  ncodedPdfUrl?: string;
  originalSha256?: string;
  ncodedSha256?: string;
  extraInfo?: Record<string, unknown>;
  status: string;
  createdAt: string;
  createdBy: number;
  updatedAt?: string;
  updatedBy?: number;
  pages?: PdfPage[];
};

export type PdfPage = {
  id: number;
  /** Page UUID — the GCS / CDN URL prefix segment for this page. */
  uuid: string;
  pdfId: number;
  pageIndex: number;
  section: number;
  ownerNo: number;
  bookNo: number;
  ncodePage: number;
  previewImageUri?: string;
  thumbnailUri?: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  /**
   * Ncode 발급 형상(Imprint args) — BE PR #29 (`feat/ncode-imprint-args`)
   * 이후 페이지 단위로 영속화됩니다. 발급이 멱등이라 (슬롯 4-tuple + 이 형상)
   * 만으로 동일 패턴을 재생성할 수 있습니다. 구버전 배포/PoC 발급분에서는 비어
   * 있을 수 있어 전부 optional 입니다. PATCH /pdfs/{id} 가 이 값을 바꿉니다.
   */
  paperWidthMm?: number;
  paperHeightMm?: number;
  ncodeType?: string;
  imprintDpi?: number;
  dotMode?: string;
  bold?: boolean;
  regionMeta?: unknown;
  status: string;
  createdAt: string;
  createdBy: number;
};

/**
 * Ncode 발급 형상(Imprint args) 입력 — POST(최초 발급)·PATCH(형상 수정) 공용.
 * 모든 필드는 optional: 생략(undefined)하면 POST 는 서버 기본값(A4 자동 / dot /
 * no-bold / 600dpi), PATCH 는 기존값을 유지합니다. `paperWidthMm` 과
 * `paperHeightMm` 은 항상 함께 지정해야 합니다(BE binding 규칙).
 */
export type ImprintArgs = {
  /** 용지 가로(mm) — `paperHeightMm` 과 함께 지정. */
  paperWidthMm?: number;
  /** 용지 세로(mm) — `paperWidthMm` 과 함께 지정. */
  paperHeightMm?: number;
  /** 'dot' | 'line' — 미지정 시 서버 기본('dot'). */
  dotMode?: 'dot' | 'line';
  /** 굵게 — 미지정 시 서버 기본(false). */
  bold?: boolean;
  /** Imprint DPI — 600(기본) | 1200. */
  imprintDpi?: 600 | 1200;
};

/**
 * Serialise an `ImprintArgs` to the wire body, dropping `undefined` fields so
 * the server applies its defaults (POST) / keeps existing values (PATCH).
 * Returns `{}` when nothing is set.
 */
function imprintBody(imprint?: ImprintArgs): Record<string, unknown> {
  if (!imprint) return {};
  const out: Record<string, unknown> = {};
  if (imprint.paperWidthMm != null) out.paperWidthMm = imprint.paperWidthMm;
  if (imprint.paperHeightMm != null) out.paperHeightMm = imprint.paperHeightMm;
  if (imprint.dotMode != null) out.dotMode = imprint.dotMode;
  if (imprint.bold != null) out.bold = imprint.bold;
  if (imprint.imprintDpi != null) out.imprintDpi = imprint.imprintDpi;
  return out;
}

export type CursorResponse<T> = {
  items: T[];
  nextCursor?: string;
};

/**
 * Page-detail response (post `feat/env-config-cdn`). The server returns
 * CDN URLs (no signed query string) and sets a `Cloud-CDN-Cookie` valid
 * for ~6h on `Domain=.mathsecr.com`. Subsequent `<img>` GETs to the
 * `originalImageUrl` / `thumbnailUrl` ride the cookie automatically.
 */
export type PdfPageResponse = {
  pdfId: number;
  /** Parent paper UUID (GCS / CDN prefix segment). */
  paperUuid: string;
  /** Page UUID (GCS / CDN prefix segment). */
  pageUuid: string;
  pageIndex: number;
  ncode: { section: number; ownerNo: number; bookNo: number; page: number };
  /** Full-resolution PNG, served via CDN. Cookie-authenticated. */
  originalImageUrl: string;
  /** WebP thumbnail, served via CDN. Cookie-authenticated. */
  thumbnailUrl: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  /**
   * Physical paper size (mm) the ncode was issued for — the **authoritative**
   * ncode coordinate basis (BE.ngs per-page endpoint, PR #34). Prefer this over
   * the `widthPx/dpi` inference so a future preview-render change can't silently
   * misalign strokes. Absent for legacy / noop-imprinter pages.
   */
  paperWidthMm?: number;
  paperHeightMm?: number;
  regionMeta?: unknown;
};

type RuntimeConfig = {
  baseUrl?: string;
  authToken?: string;
  enabled?: boolean;
};

/**
 * Default base URL when neither env nor runtime config nor localStorage
 * provides one. Same-origin `/ngs` — host nginx (prod) / Vite dev proxy route
 * it to the relay sidecar, which injects the PMK Basic credential server-side.
 */
const DEFAULT_BASE_URL = '/api/ngs';

// 🚨 직접 호출 주소(VITE_NGS_*)는 **개발 서버에서만** 읽는다. 운영 번들에 박히면
// 브라우저가 NGS 를 교차 출처로 직접 부르다 CORS 에 막혀 "Failed to fetch" 가 된다
// (실사고 2026-09-04: 새 Vercel 프로젝트에 .env.local 을 통째로 올렸다가 교재 목록·
// 업로드가 전부 죽었다). 운영은 항상 같은 출처의 /api/ngs 릴레이를 탄다.
const BASE_URL_ENV = import.meta.env.DEV
  ? ((import.meta.env.VITE_NGS_BASE_URL as string | undefined) ?? '')
  : '';
const AUTH_TOKEN_ENV = import.meta.env.DEV
  ? ((import.meta.env.VITE_NGS_AUTH_TOKEN as string | undefined) ?? '')
  : '';

/**
 * Non-secret placeholder. The real PMK now lives ONLY server-side in the relay
 * sidecar (which injects it for both `/ngs` and `/bms`). This sentinel keeps
 * the client-side "enabled" guards satisfied so requests still fire; it is
 * NEVER sent on the wire — we omit Authorization entirely so the browser's
 * cached edge (auth_basic) credential reaches nginx instead of being overridden.
 * Mirrors ocr-client's PROXY_INJECTED_TOKEN.
 */
const PROXY_SENTINEL_TOKEN = 'proxy-injected';

/**
 * NGS API keys always start with `PMK-`. We surface this only as a soft
 * hint in the UI — actual validation is the server's job.
 */
export const NGS_API_KEY_PREFIX = 'PMK-';

const STORAGE_KEY = 'hicnc.ngs.runtimeConfig.v1';

let runtimeConfig: RuntimeConfig = {};

/** Subscribers notified when the runtime config changes (token saved/cleared). */
type ConfigListener = () => void;
const listeners = new Set<ConfigListener>();
export function subscribeNgsConfig(fn: ConfigListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notifyConfigChange() {
  for (const fn of listeners) fn();
}

/**
 * Apply a runtime override on top of the build-time env vars. Values from
 * `cfg` win over the env; pass empty string / `false` to clear an override
 * and fall back to env (or the default base URL).
 */
export function configureNgs(cfg: RuntimeConfig): void {
  runtimeConfig = { ...runtimeConfig, ...cfg };
  notifyConfigChange();
}

function persistRuntimeConfig() {
  if (typeof window === 'undefined') return;
  try {
    const minimal: RuntimeConfig = {
      baseUrl: runtimeConfig.baseUrl,
      authToken: runtimeConfig.authToken,
      enabled: runtimeConfig.enabled,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(minimal));
  } catch {
    // localStorage may be disabled (private mode, quota) — runtime config
    // still works for the lifetime of the tab; just won't survive reload.
  }
}

/**
 * Save the user-supplied NGS config (token + optional base URL) to
 * localStorage so it survives reloads. Empty `authToken` clears the entry
 * entirely. Saving a non-empty key always sets `enabled: true` so a prior
 * `enabled: false` flag from an init script doesn't shadow the new key.
 * Returns the resulting runtime config.
 */
/**
 * Coerce an absolute `*.mathsecr.com` base (optionally `/ngs`) to the same-origin
 * `/ngs`. BE.mathsecr.com is only reachable through the relay now, so a direct
 * absolute base would bypass the gate + PMK injection and fail. A deliberately
 * foreign base (e.g. a different relay host) is left untouched.
 */
function normalizeNgsBase(url: string | undefined): string | undefined {
  if (url && /^https?:\/\/[^/]+\.mathsecr\.com(?::\d+)?(?:\/ngs)?\/?$/i.test(url)) {
    return '/ngs';
  }
  return url;
}

export function saveNgsConfig(cfg: RuntimeConfig): RuntimeConfig {
  const next = {
    baseUrl: normalizeNgsBase(cfg.baseUrl ?? runtimeConfig.baseUrl),
    authToken: cfg.authToken ?? runtimeConfig.authToken,
    enabled: cfg.enabled ?? runtimeConfig.enabled,
  };
  if (!next.authToken) {
    runtimeConfig = {};
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
    notifyConfigChange();
    return runtimeConfig;
  }
  // Saving a key implies enabling — even when the previous runtime had
  // `enabled: false` from a test override.
  next.enabled = true;
  runtimeConfig = next;
  persistRuntimeConfig();
  notifyConfigChange();
  return runtimeConfig;
}

if (typeof window !== 'undefined') {
  // Hydrate from localStorage first (user-saved settings survive reload).
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RuntimeConfig;
      if (parsed && typeof parsed === 'object') {
        // Migration: a returning user may have a persisted ABSOLUTE
        // `api.*.mathsecr.com/ngs` base from before the same-origin relay.
        // Rewrite it to `/ngs` so requests go through the edge gate + sidecar
        // (which injects the PMK) instead of hitting the BE directly and
        // bypassing the auth_basic gate. A stale persisted token is now inert
        // (never sent on the wire), so we leave user-saved tokens untouched —
        // clearing them would break the save-token-reload flow.
        let migrated = false;
        if (
          typeof parsed.baseUrl === 'string' &&
          /^https?:\/\/api\.[^/]*mathsecr\.com\/ngs\/?$/i.test(parsed.baseUrl)
        ) {
          parsed.baseUrl = '/ngs';
          migrated = true;
        }
        runtimeConfig = { ...runtimeConfig, ...parsed };
        if (migrated) persistRuntimeConfig();
      }
    }
  } catch {
    /* ignore — bad JSON or storage unavailable */
  }
  // Then allow page-level test overrides (Playwright init script) to win.
  const cfg = (
    window as unknown as { __NGS_TEST__?: RuntimeConfig }
  ).__NGS_TEST__;
  if (cfg) configureNgs(cfg);
  (
    window as unknown as { configureNgs?: typeof configureNgs }
  ).configureNgs = configureNgs;
}

/** @deprecated use `configureNgs({ authToken })` or `saveNgsConfig` instead. */
export function setNgsAuthToken(token: string | null): void {
  configureNgs({ authToken: token ?? '' });
}

/**
 * Resolved API key in priority order: runtime override (Settings panel /
 * localStorage) → env var (`VITE_NGS_AUTH_TOKEN` from `.env*`). When
 * neither is set, returns an empty string and the admin UI surfaces the
 * auth-required panel.
 */
export function getNgsAuthToken(): string {
  if (runtimeConfig.authToken && runtimeConfig.authToken.length > 0)
    return runtimeConfig.authToken;
  // Fall back to the env token (legacy; normally empty now) then a non-secret
  // sentinel, so NGS/BMS are "enabled" by default and requests still fire — the
  // relay injects the real PMK server-side. Never sent on the wire.
  return AUTH_TOKEN_ENV || PROXY_SENTINEL_TOKEN;
}

export function isNgsEnabled(): boolean {
  if (runtimeConfig.enabled === false) return false;
  // Any path that supplies a token implicitly enables NGS. With the dev
  // default in place this is effectively always true unless explicitly
  // disabled.
  return getNgsAuthToken().length > 0;
}

export function ngsBaseUrl(): string {
  const raw =
    (runtimeConfig.baseUrl && runtimeConfig.baseUrl.length > 0
      ? runtimeConfig.baseUrl
      : BASE_URL_ENV) || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/** Snapshot of the live runtime config — for UIs that show current state. */
export function getNgsConfig(): {
  baseUrl: string;
  authToken: string;
  enabled: boolean;
  source: 'env' | 'runtime' | 'default';
} {
  const fromRuntime =
    !!runtimeConfig.authToken || !!runtimeConfig.baseUrl;
  const fromEnv = !!AUTH_TOKEN_ENV || !!BASE_URL_ENV;
  return {
    baseUrl: ngsBaseUrl(),
    // Expose ONLY a real user/env-configured token — never the non-secret
    // 'proxy-injected' sentinel, which would otherwise pre-fill the admin API-key
    // field and trigger a spurious "keys usually start with PMK-" warning.
    authToken: runtimeConfig.authToken || AUTH_TOKEN_ENV || '',
    enabled: isNgsEnabled(),
    source: fromRuntime ? 'runtime' : fromEnv ? 'env' : 'default',
  };
}

class NgsAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'NgsAuthError';
  }
}

class NgsHttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'NgsHttpError';
  }
}

export { NgsAuthError, NgsHttpError };

/**
 * Build the `Authorization: Basic <base64(apiKey:)>` header NGS expects.
 * Username slot = the API key (always `PMK-…`), password slot = empty.
 */
export function buildBasicAuthHeader(apiKey: string): string {
  // btoa is fine here — API keys are restricted to ASCII characters.
  return `Basic ${btoa(`${apiKey}:`)}`;
}

function authHeaders(extra: Record<string, string> = {}): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...extra,
  };
  // 외부 NGS API 직접 호출 시 Authorization 헤더 추가
  if (AUTH_TOKEN_ENV && BASE_URL_ENV && !BASE_URL_ENV.startsWith('/')) {
    headers.Authorization = AUTH_TOKEN_ENV;
  }
  return headers;
}

async function jsonRequest<T>(
  path: string,
  init: RequestInit & { acceptNotFound?: boolean } = {},
): Promise<T | null> {
  const url = `${ngsBaseUrl()}${path}`;
  const res = await fetch(url, {
    // `credentials: 'include'` is the global default for every NGS call —
    // mirrors `axios.create({ withCredentials: true })` per the BE-side
    // guidance. Required so the `Set-Cookie: Cloud-CDN-Cookie=…` from
    // /pages/{idx} actually sticks on the dev origin, AND so any future
    // NGS endpoint that expects a session cookie just works.
    credentials: 'include',
    ...init,
    // 발급·소유 기록 직후의 목록/상세를 브라우저 캐시로 확인하지 않는다.
    cache: 'no-store',
    headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
  });
  if (init.acceptNotFound && res.status === 404) {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    throw new NgsAuthError(res.status, `NGS ${res.status} ${res.statusText}`);
  }
  if (!res.ok) {
    throw new NgsHttpError(res.status, `NGS ${res.status} ${res.statusText} on ${path}`);
  }
  const body = (await res.json()) as unknown;
  return unwrapCloudKit<T>(body);
}

/**
 * CloudKit responses are wrapped in `{ data: ... }` (success) or
 * `{ error: ... }` (failure). Older test fixtures and direct payloads pass
 * through unwrapped. This helper accepts both shapes so callers see a
 * consistent payload type regardless of how the route is mocked.
 */
function unwrapCloudKit<T>(body: unknown): T {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    if ('data' in obj && obj.data != null) return obj.data as T;
    if ('result' in obj && obj.result != null) return obj.result as T;
  }
  return body as T;
}

/**
 * List all of the caller-member's PDFs by walking the cursor pagination
 * to completion. We materialise the full list so the client-side ncode
 * index can be built once. For very large tenants this is overkill, but
 * the demo deployment has a handful of papers.
 */
export async function listAllPdfs(
  pageSize: number = 100,
): Promise<Pdf[]> {
  const all: Pdf[] = [];
  let cursor: string | undefined;
  // Cap at 1000 PDFs as a defensive bound for the demo.
  for (let i = 0; i < 10; i++) {
    const params = new URLSearchParams({
      limit: String(pageSize),
      order: 'asc',
    });
    if (cursor) params.set('cursor', cursor);
    const resp = await jsonRequest<CursorResponse<Pdf>>(`/api/v1/pdfs?${params.toString()}`);
    if (!resp) break;
    all.push(...resp.items);
    if (!resp.nextCursor) break;
    cursor = resp.nextCursor;
  }
  return all;
}

/**
 * Returns the PDF metadata along with all of its pages (ncode tuples
 * included). Returns null on 404.
 */
export async function getPdfWithPages(pdfId: number): Promise<Pdf | null> {
  return jsonRequest<Pdf>(`/api/v1/pdfs/${pdfId}`, { acceptNotFound: true });
}

/**
 * Returns a single page's full response, including the CDN URLs
 * (`originalImageUrl` / `thumbnailUrl`). The server *also* sets a
 * `Cloud-CDN-Cookie` valid for ~6h on `Domain=.mathsecr.com`; the
 * cookie sticks because `jsonRequest` defaults to
 * `credentials: 'include'`. Subsequent `<img>` GETs to the CDN ride
 * that cookie automatically.
 *
 * Returns null on 404.
 */
export async function getPdfPage(
  pdfId: number,
  pageIndex: number,
): Promise<PdfPageResponse | null> {
  return jsonRequest<PdfPageResponse>(
    `/api/v1/pdfs/${pdfId}/pages/${pageIndex}`,
    { acceptNotFound: true },
  );
}

/**
 * Cheap connectivity / readiness probe — no auth required.
 */
export async function ngsLivez(): Promise<boolean> {
  try {
    const res = await fetch(`${ngsBaseUrl()}/livez`);
    return res.ok;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Admin operations (PoC: no permission check on the webapp side)
// ─────────────────────────────────────────────────────────────────────────

export type UploadProgress = {
  loaded: number;
  total: number;
  /** 0..1 — undefined when total is unknown. */
  fraction?: number;
};

/**
 * Two-stage PDF registration (per `feat/env-config-cdn` spec):
 *   1. Upload bytes to BMS (`POST /bms/api/v1/files`) → returns hash.
 *   2. Register with NGS (`POST /ngs/api/v1/pdfs`, JSON body) → returns Pdf.
 *
 * The upload-progress callback is forwarded to step 1 (the only stage
 * that streams bytes); step 2 is a small JSON request and reports a
 * single 100% tick when it finishes.
 */
export async function uploadPdf(args: {
  file: File;
  title?: string;
  extraInfo?: Record<string, unknown>;
  /**
   * Ncode 발급 형상(용지 크기 / DPI 등). 생략 시 서버 기본값(A4 자동 · 600dpi).
   */
  imprint?: ImprintArgs;
  onProgress?: (p: UploadProgress) => void;
  /** 단계 알림 — 'upload' = 파일 업로드(진행률 있음), 'ncode' = NCode 발급 대기 */
  onPhase?: (phase: 'upload' | 'ncode') => void;
  signal?: AbortSignal;
}): Promise<Pdf> {
  const { file, title, extraInfo, imprint, onProgress, onPhase, signal } = args;
  onPhase?.('upload');
  // Step 1 — FPS upload (BMS → FPS 전환, POC PR #28).
  // Use a dynamic import so this module doesn't pull in FPS at parse time
  // when consumers only need read paths.
  const { uploadFileToFps } = await import('./fps-client');
  const fileHash = await uploadFileToFps({
    file,
    onProgress,
    signal,
  });
  // Step 2 — NGS register. No Authorization on the wire: the same-origin `/ngs`
  // relay injects the PMK Basic credential server-side.
  onPhase?.('ncode');
  const res = await fetch(`${ngsBaseUrl()}/api/v1/pdfs`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileHash,
      // 맥 파일명은 자소 분해(NFD) — 서버에 NFC 로 정규화해 저장한다
      ...(title ? { title: title.normalize('NFC') } : {}),
      ...(extraInfo ? { extraInfo } : {}),
      ...imprintBody(imprint),
    }),
    signal,
  });
  if (res.status === 401 || res.status === 403) {
    throw new NgsAuthError(res.status, await readErrorMessage(res));
  }
  if (res.status === 502 || res.status === 504) {
    // 발급이 함수 시간 제한을 넘긴 경우 — 서버에서는 계속 진행 중일 수 있다
    throw new NgsHttpError(
      res.status,
      'NCode 발급 응답이 지연되고 있습니다 (고해상도일수록 오래 걸려요). ' +
        '발급은 서버에서 계속 진행 중일 수 있으니 잠시 후 교재 목록을 ' +
        '새로고침해 확인해주세요. ⚠️ 확인 없이 다시 업로드하면 일일 발급 ' +
        '한도(하루 200페이지, 실패도 소비)만 깎입니다.',
    );
  }
  if (!res.ok) {
    throw new NgsHttpError(res.status, await readErrorMessage(res));
  }
  const body = (await res.json()) as unknown;
  const pdf = unwrapCloudKit<Pdf>(body);
  if (!pdf || typeof pdf !== 'object' || typeof (pdf as Pdf).id !== 'number') {
    throw new NgsHttpError(res.status, 'NGS register response missing pdf');
  }
  return pdf;
}

/**
 * Replace a PDF's body (artwork) while keeping the same Ncode code slots
 * and imprint form — BE PR #29 `PUT /api/v1/pdfs/{id}`. Two stages, like
 * upload:
 *   1. Upload the new bytes to BMS (`POST /bms/api/v1/files`) → hash.
 *   2. `PUT /ngs/api/v1/pdfs/{id}` with `{ fileHash, title? }`.
 *
 * The server re-synthesises the *same* Ncode pattern (issuance is
 * idempotent) onto the new artwork — this is NOT a code re-issue. The new
 * PDF MUST have the same page count as the original; a mismatch returns
 * `409 ERR-NGS-008` (slots are fixed) which surfaces as an NgsHttpError.
 */
export async function replacePdf(args: {
  pdfId: number;
  file: File;
  title?: string;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<Pdf> {
  const { pdfId, file, title, onProgress, signal } = args;
  // Step 1 — FPS upload (dynamic import, same as uploadPdf).
  const { uploadFileToFps } = await import('./fps-client');
  const fileHash = await uploadFileToFps({ file, onProgress, signal });
  // Step 2 — NGS replace. No Authorization: the `/ngs` relay injects the PMK.
  const res = await fetch(`${ngsBaseUrl()}/api/v1/pdfs/${pdfId}`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fileHash,
      // 맥 파일명은 자소 분해(NFD) — 서버에 NFC 로 정규화해 저장한다
      ...(title ? { title: title.normalize('NFC') } : {}),
    }),
    signal,
  });
  if (res.status === 401 || res.status === 403) {
    throw new NgsAuthError(res.status, await readErrorMessage(res));
  }
  if (!res.ok) {
    throw new NgsHttpError(res.status, await readErrorMessage(res));
  }
  const body = (await res.json()) as unknown;
  const pdf = unwrapCloudKit<Pdf>(body);
  if (!pdf || typeof pdf !== 'object' || typeof (pdf as Pdf).id !== 'number') {
    throw new NgsHttpError(res.status, 'NGS replace response missing pdf');
  }
  return pdf;
}

/** PATCH 응답 — 갱신된 Pdf 에 실제 재발급 여부(`reissued`)가 더해집니다. */
export type PatchNcodeResult = Pdf & { reissued: boolean };

/**
 * Modify the Ncode issuance form (paper size / DPI / dotMode / bold) of an
 * existing PDF — BE PR #29 `PATCH /api/v1/pdfs/{id}`. The PDF body is left
 * untouched. Omitted fields keep their current value. The server only
 * re-issues (and returns `reissued: true`) when the form actually changes;
 * an identical request is a no-op (`reissued: false`). When the synthesis
 * engine (ncode-cli) is absent and a real change is requested, the server
 * returns `503 WARN-NGS-009` which surfaces as an NgsHttpError.
 */
export async function patchNcodeArgs(args: {
  pdfId: number;
  imprint: ImprintArgs;
  signal?: AbortSignal;
}): Promise<PatchNcodeResult> {
  const { pdfId, imprint, signal } = args;
  // No Authorization: the same-origin `/ngs` relay injects the PMK.
  const res = await fetch(`${ngsBaseUrl()}/api/v1/pdfs/${pdfId}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(imprintBody(imprint)),
    signal,
  });
  if (res.status === 401 || res.status === 403) {
    throw new NgsAuthError(res.status, await readErrorMessage(res));
  }
  if (!res.ok) {
    throw new NgsHttpError(res.status, await readErrorMessage(res));
  }
  const body = (await res.json()) as unknown;
  const result = unwrapCloudKit<PatchNcodeResult>(body);
  if (
    !result ||
    typeof result !== 'object' ||
    typeof (result as Pdf).id !== 'number'
  ) {
    throw new NgsHttpError(res.status, 'NGS patch response missing pdf');
  }
  return result;
}

/**
 * Map known server error codes to a more actionable hint for the admin
 * UI. Returns null when no special-case message applies.
 */
function actionableHintFor(errorCode: string): string | null {
  switch (errorCode) {
    case 'FATAL-SYS-999':
      return (
        'NGS 서버 내부 설정 오류 — 캐시 버킷/Memorystore 환경 변수가 누락되었거나 ' +
        '서비스 의존성 연결에 실패했습니다. 운영팀에 NGS dev pod 의 CACHE_BUCKET / ' +
        'MEMORYSTORE_ENDPOINT 점검을 요청해주세요.'
      );
    case 'ERR-NGS-001':
      return 'PDF 형식이 아니거나 BMS hash 가 만료되었습니다 — 파일 재업로드 필요.';
    case 'ERR-NGS-002':
      return 'Ncode 슬롯 풀이 고갈되었습니다 — 운영팀 문의 (사용자 재시도는 의미 없음).';
    case 'ERR-NGS-003':
      return (
        'Ncode 슬롯 발급 실패 — 서버 측 DB 상태 점검 필요 ' +
        '(pdf_pages 테이블 마이그레이션, pg_advisory_xact_lock 권한, ' +
        '또는 generate_series 쿼리). 운영팀 문의.'
      );
    case 'ERR-NGS-004':
      return 'GCS 업로드/이동 실패 — 잠시 후 재시도해주세요.';
    case 'ERR-NGS-008':
      return (
        '교체할 PDF 의 페이지 수가 기존과 다릅니다 — Ncode 코드 슬롯이 고정이라 ' +
        '페이지 수가 같은 PDF 로만 본문을 교체할 수 있습니다.'
      );
    case 'WARN-NGS-009':
      return (
        'Ncode 합성기(ncode-cli)가 구성되지 않은 환경이라 발급 형상 변경(재발급)을 ' +
        '수행할 수 없습니다 — 합성기가 연결된 환경에서 시도하거나 운영팀에 문의해주세요.'
      );
    case 'WARN-NGS-012':
      return '분당 등록 요청 한도(5건)를 넘었습니다 — 1분 뒤 다시 시도해주세요.';
    case 'WARN-NGS-013':
      return (
        '계정당 하루 200페이지 발급 한도를 다 썼습니다. 한도는 한국시간 오전 9시에 ' +
        '초기화됩니다. ⚠️ 실패한 시도도 페이지를 소비하므로 반복 재시도는 한도만 깎습니다 — ' +
        '급하면 운영팀에 한도 상향(NGS_UPLOAD_PAGES_PER_DAY) 또는 카운터 초기화를 요청하세요.'
      );
    case 'WARN-SYS-004':
      return '인증 누락 또는 만료 — 토큰을 재설정 후 다시 시도해주세요.';
    default:
      return null;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    /* ignore */
  }
  if (text) {
    try {
      const obj = JSON.parse(text) as {
        error?: unknown;
        message?: unknown;
        reason?: unknown;
      };
      const error = typeof obj.error === 'string' ? obj.error : '';
      const message = typeof obj.message === 'string' ? obj.message : '';
      const reason = typeof obj.reason === 'string' ? obj.reason : '';
      const hint = error ? actionableHintFor(error) : null;
      const status = `(${res.status} ${res.statusText})`;
      const head =
        error && message
          ? `${error} · ${message}`
          : message || error || res.statusText;
      const parts = [head, reason, hint].filter(Boolean);
      return `${parts.join(' — ')} ${status}`;
    } catch {
      /* not JSON */
    }
    return `${text.slice(0, 200)} (${res.status} ${res.statusText})`;
  }
  return `${res.status} ${res.statusText}`;
}

/**
 * **프록시 타임아웃 뒤 발급 완료 확인.**
 * 발급은 600dpi 기준 페이지당 ~11초(NGS 실측)인데 서버리스 프록시의 함수 예산은
 * 60초(Hobby 상한)라, 6페이지쯤부터 프록시가 먼저 끊는다. 그때 서버는 계속
 * 발급 중이므로 **재업로드가 아니라 목록 폴링**으로 결과를 확인해야 한다 —
 * 재업로드는 일일 페이지 쿼터(WARN-NGS-013)만 깎는다(실패도 소비, 환불 없음).
 * @returns 등록된 Pdf, 제한 시간 안에 안 나타나면 null.
 */
export async function waitForRegisteredPdf(args: {
  title: string;
  /** 업로드를 시작한 시각 — 그 이후 생성된 교재만 인정 */
  notBefore: Date;
  timeoutMs?: number;
  intervalMs?: number;
  onTick?: (elapsedMs: number) => void;
  /** 호출자가 남긴 업로드 식별자로 같은 제목의 다른 교재를 제외한다. */
  matches?: (pdf: Pdf) => boolean;
}): Promise<Pdf | null> {
  const { title, notBefore, onTick } = args;
  const timeoutMs = args.timeoutMs ?? 5 * 60_000;
  const intervalMs = args.intervalMs ?? 10_000;
  const want = title.normalize('NFC');
  const started = Date.now();
  for (;;) {
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
    onTick?.(Date.now() - started);
    try {
      const all = await listAllPdfs();
      const hit = all.find(
        (p) =>
          Number.isSafeInteger(p.id) && p.id > 0 &&
          p.status !== 'removed' &&
          (p.title ?? '').normalize('NFC') === want &&
          p.createdAt != null &&
          new Date(p.createdAt).getTime() >= notBefore.getTime() - 60_000 &&
          (!args.matches || args.matches(p)),
      );
      if (hit) return hit;
    } catch {
      // 목록 조회 일시 실패 — 다음 틱에 다시
    }
  }
}

/**
 * Soft-delete a PDF. The server flips status to "removed".
 */
export async function deletePdf(pdfId: number): Promise<void> {
  const url = `${ngsBaseUrl()}/api/v1/pdfs/${pdfId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (res.status === 204 || res.ok) return;
  // Use the same {error · message — hint} formatter that upload uses so
  // the user sees the actual server-side reason ('WARN-NGS-006 · PDF
  // 소유자가 아닙니다' etc.) instead of a bare status code.
  const detail = await readErrorMessage(res);
  if (res.status === 401 || res.status === 403) {
    throw new NgsAuthError(res.status, detail);
  }
  throw new NgsHttpError(res.status, detail);
}

/**
 * The legacy `GET /api/v1/pdfs/{id}/download?kind=…` endpoint exists for
 * server-to-server callers that can carry an Authorization header — it
 * 302-redirects to a short-lived GCS signed URL. Browser anchor clicks
 * cannot carry that header, so the admin UI uses the CDN-direct
 * `paperResourceCdnUrl` path below instead.
 */
export function pdfDownloadEndpoint(
  pdfId: number,
  kind: 'ncoded' | 'original' = 'ncoded',
): string {
  return `${ngsBaseUrl()}/api/v1/pdfs/${pdfId}/download?kind=${kind}`;
}

/**
 * Resolve a CDN URL for a paper-level resource (`ncoded.pdf` or
 * `original.pdf`). Auth is via the `Cloud-CDN-Cookie` set by any prior
 * `GET /pdfs/{id}/pages/{idx}` call — its `URLPrefix` covers the entire
 * paper UUID so a single page fetch unlocks every resource under that
 * paper.
 *
 * Resolution order:
 *   1. `pdf.{ncoded|original}PdfUrl` (BE PR #20 onwards — authoritative)
 *   2. Derive from `pages[0].previewImageUri` (works on older deploys
 *      too; the page URL contains the same paper-UUID prefix).
 */
export function paperResourceCdnUrl(
  pdf: Pdf,
  kind: 'ncoded' | 'original' = 'ncoded',
): string | null {
  // 1) Server-supplied CDN URL — preferred when present.
  const supplied =
    kind === 'ncoded' ? pdf.ncodedPdfUrl : pdf.originalPdfUrl;
  if (supplied && /^https?:\/\//.test(supplied)) return supplied;

  // 2) Fallback — derive paper-root from any page's CDN URL.
  const sample =
    pdf.pages?.[0]?.previewImageUri ?? pdf.pages?.[0]?.thumbnailUri ?? '';
  if (!sample || !pdf.uuid) return null;
  const marker = `/NcodePapers/${pdf.uuid}/`;
  const idx = sample.indexOf(marker);
  if (idx === -1) return null;
  const paperRoot = sample.slice(0, idx + marker.length);
  return `${paperRoot}${kind}.pdf`;
}

/**
 * Trigger a native browser download of the Ncode PDF via the same-origin
 * `/api/download-pdf` proxy. The private CDN only accepts the
 * Cloud-CDN-Cookie NGS issues (direct access 403s, Basic auth 401s), and
 * a vercel.app / localhost origin can never hold that cookie — so the
 * proxy fetches the NGS detail server-side, captures the cookie, and
 * relays the PDF bytes with a proper Content-Disposition.
 *
 * Returns false when the paper has no ncoded PDF yet (synthesis still
 * running server-side); caller can surface a "발급 진행 중" message.
 */
export function downloadNcodedPdf(
  pdf: Pdf,
  kind: 'ncoded' | 'original' = 'ncoded',
): boolean {
  const ready =
    kind === 'ncoded'
      ? Boolean(pdf.ncodedPdfUrl || pdf.ncodedPdfUri)
      : Boolean(pdf.originalPdfUrl || pdf.originalPdfUri);
  if (!ready) return false;
  const a = document.createElement('a');
  a.href = `/api/download-pdf?id=${pdf.id}&kind=${kind}`;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}
