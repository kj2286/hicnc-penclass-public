/**
 * Rewrite CDN URLs returned by NGS so they're routable from the dev
 * server.
 *
 * In dev (`pnpm dev`) the page lives at `http://127.0.0.1:5173`. The
 * server returns absolute CDN URLs like
 *   `https://cdn.example.test/data/private/NcodePapers/<uuid>/...`
 * with a `Cloud-CDN-Cookie` scoped to `Domain=.mathsecr.com`. The
 * browser refuses to send that cookie cross-site to a non-mathsecr.com
 * origin, so we pivot the URL through Vite's `/cdn` proxy (configured
 * in `vite.config.ts`) — same-origin from the browser's view, and the
 * proxy injects the necessary auth headers server-side.
 *
 * Configurable via `VITE_CDN_BASE_URL` (defaults to the prod CDN host).
 * For dev, `.env.development` sets it to `/cdn` so this rewrite kicks
 * in. Production deployments served from `*.mathsecr.com` leave the
 * URLs untouched.
 */

const CDN_BASE_URL_ENV =
  (import.meta.env.VITE_CDN_BASE_URL as string | undefined) ?? '';

let runtimeCdnBaseUrl = '';

export function configureCdn(cfg: { baseUrl?: string }): void {
  if (cfg.baseUrl != null) runtimeCdnBaseUrl = cfg.baseUrl;
}

if (typeof window !== 'undefined') {
  const cfg = (
    window as unknown as { __NGS_TEST__?: { cdnBaseUrl?: string } }
  ).__NGS_TEST__;
  if (cfg?.cdnBaseUrl) runtimeCdnBaseUrl = cfg.cdnBaseUrl;
}

export function cdnBaseUrl(): string {
  const raw =
    runtimeCdnBaseUrl && runtimeCdnBaseUrl.length > 0
      ? runtimeCdnBaseUrl
      : CDN_BASE_URL_ENV;
  return raw.replace(/\/+$/, '');
}

/**
 * Replace the absolute CDN host of a URL with the configured base. Pass
 * through unchanged when no base is set (production).
 *
 * Example:
 *   in:   https://cdn.example.test/data/private/NcodePapers/abc/Pages/xyz/original.png
 *   base: /cdn
 *   out:  /cdn/data/private/NcodePapers/abc/Pages/xyz/original.png
 *
 * PDF 다운로드는 이 함수를 쓰지 않는다 — `/api/download-pdf?id=…` 서버
 * 프록시가 Cloud-CDN-Cookie 를 대신 발급받아 중계한다.
 */
export function rewriteCdnUrl(absoluteUrl: string): string {
  const base = cdnBaseUrl();
  if (!base) return absoluteUrl;
  try {
    const u = new URL(absoluteUrl, window.location.href);
    if (base.startsWith('/')) {
      // Same-origin proxy path — keep query + path, swap host.
      return `${base}${u.pathname}${u.search}${u.hash}`;
    }
    // Absolute base — splice in the new origin.
    const baseUrl = new URL(base);
    return `${baseUrl.origin}${baseUrl.pathname.replace(/\/+$/, '')}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return absoluteUrl;
  }
}
