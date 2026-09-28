/**
 * OCR client — recognises handwriting in a stroke-group PNG by calling
 * the qwen-9b vision model on heavy01.
 *
 * Endpoint shape is OpenAI-compatible (`POST {base}/chat/completions`),
 * with the image inlined as a `data:image/png;base64,…` URL inside a
 * multimodal `image_url` part.
 *
 * ──────────────────────────────────────────────────────────────────────
 * SECURITY MODEL — same-origin relay
 * ──────────────────────────────────────────────────────────────────────
 * This client sends **no Authorization header**. Both recognition legs go to
 * same-origin paths (`/ocr/v1/...` and `/gemini/v1beta/openai/...`) that the
 * relay sidecar (Vite dev proxy / host nginx in prod) forwards to the upstream,
 * injecting the real credential server-side (an OCR bearer for heavy01, a
 * short-lived Vertex OAuth token for Gemini). So **no bearer/key is ever in the
 * JS bundle**. The `authToken` here is only a non-secret sentinel
 * (`PROXY_INJECTED_TOKEN`) that keeps the "recognition ready" guard non-empty;
 * it is never transmitted. See `webapp/docs/security-proxy.md`.
 */

type OcrRuntimeOverride = Partial<{
  baseUrl: string;
  authToken: string;
  model: string;
  enabled: boolean;
}>;

const ENV_BASE_URL = (
  (import.meta.env.VITE_OCR_BASE_URL as string | undefined) ?? ''
).replace(/\/+$/, '');
const ENV_AUTH_TOKEN =
  (import.meta.env.VITE_OCR_AUTH_TOKEN as string | undefined) ?? '';
const ENV_MODEL =
  (import.meta.env.VITE_OCR_MODEL as string | undefined) ?? 'qwen-9b';
const ENV_ENABLED =
  (import.meta.env.VITE_OCR_ENABLED as string | undefined) !== '0';

// ─── Gemini provider ────────────────────────────────────────────────────
// Recognition can route through Gemini's OpenAI-compatible endpoint instead
// of the heavy01 OCR model. The request shape is identical (`/chat/completions`
// with an inline `image_url`), so only the base URL + model + bearer differ.
// The same-origin `/gemini` proxy (Vite in dev, host nginx in prod) injects the
// real API key server-side, so the browser only ever sends a sentinel bearer.
const ENV_GEMINI_BASE_URL = (
  (import.meta.env.VITE_GEMINI_BASE_URL as string | undefined) ?? ''
).replace(/\/+$/, '');
const ENV_GEMINI_MODEL =
  (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ?? 'gemini-3.5-flash';
const ENV_GEMINI_RAW = import.meta.env.VITE_GEMINI_ENABLED as string | undefined;
const ENV_GEMINI_ENABLED = ENV_GEMINI_RAW != null && ENV_GEMINI_RAW !== '0';

/**
 * Bearer sent for a proxy-injected provider (Gemini). The same-origin proxy
 * overwrites `Authorization` with the real key, so this value never
 * authenticates anything — it keeps the secret server-side while still
 * satisfying the non-empty-token guard in `recognizeStrokeImage`.
 */
const PROXY_INJECTED_TOKEN = 'proxy-injected';

/** Which backend a recognition request is routed to. */
export type RecognitionProvider = 'ocr' | 'gemini';

/**
 * Resolve the live recognition config. An explicit `window.__OCR_TEST__`
 * override (Playwright specs, ad-hoc DevTools) always wins and pins the
 * provider to OCR. Otherwise Gemini is preferred when enabled + configured,
 * falling back to the heavy01 OCR endpoint. Reads build-time env values for
 * the rest. Mirrors how `ngs-client` exposes `__NGS_TEST__`.
 */
function readOverride(): OcrRuntimeOverride {
  if (typeof window === 'undefined') return {};
  return (
    (window as unknown as { __OCR_TEST__?: OcrRuntimeOverride }).__OCR_TEST__ ??
    {}
  );
}

function resolveConfig(): {
  provider: RecognitionProvider;
  baseUrl: string;
  authToken: string;
  model: string;
  enabled: boolean;
} {
  const override = readOverride();
  // A runtime override is OCR-shaped and pins the provider to OCR, so a Gemini
  // env flag can't silently re-route a test/DevTools session.
  const hasOverride = Object.keys(override).length > 0;

  if (!hasOverride && ENV_GEMINI_ENABLED && ENV_GEMINI_BASE_URL.length > 0) {
    return {
      provider: 'gemini',
      baseUrl: ENV_GEMINI_BASE_URL,
      authToken: PROXY_INJECTED_TOKEN,
      model: ENV_GEMINI_MODEL,
      enabled: true,
    };
  }

  const baseUrl = (override.baseUrl ?? ENV_BASE_URL).replace(/\/+$/, '');
  // Default to the non-secret sentinel when no real token is configured — the
  // same-origin `/ocr` relay injects the real bearer server-side, so the client
  // never holds one. Keeps the non-empty-token guard in `recognizeStrokeImage`
  // satisfied without shipping a secret in the bundle.
  const authToken = override.authToken ?? (ENV_AUTH_TOKEN || PROXY_INJECTED_TOKEN);
  const model = override.model ?? ENV_MODEL;
  const enabled = override.enabled ?? ENV_ENABLED;
  return { provider: 'ocr', baseUrl, authToken, model, enabled };
}

/**
 * Default vision prompt — tuned for handwritten Korean math problem
 * solutions. Compressed to ~600 chars (~140 tokens) so prefill latency
 * stays close to a bare API call. Earlier 1.6 KB version was more
 * verbose but added ~6× prompt tokens with no measurable accuracy gain
 * on this workload.
 *
 * Prompt-engineering structure preserved on four axes:
 *   1. Role/scope anchor (Korean handwritten math) — first sentence.
 *   2. Output contract — five terse bullets covering LaTeX delimiters,
 *      Hangul preservation, raw-text ban on fences/prefaces, sentinel.
 *   3. Few-shot examples — three lines, one per real output shape.
 *   4. Implicit negatives — the contract phrasing ("RAW TEXT only",
 *      "no fences/quotes/prefix") subsumes the old DO-NOT block.
 */
export const DEFAULT_OCR_PROMPT = [
  'You are a vision OCR engine for Korean handwritten math problem solutions.',
  'Transcribe the handwriting on a plain white background into mixed Korean prose + LaTeX math. Rules:',
  '- Wrap math in `$ … $` (inline) or `$$ … $$` (display). Use standard macros (\\frac, \\sqrt, \\sum, \\int, ^{}, _{}, \\Rightarrow, \\therefore, \\le, \\ge).',
  '- Keep Korean in Hangul (no romanisation, no English translation).',
  '- Output RAW TEXT only: no code fences, no backticks, no quotes, no preface like "Here is…".',
  '- If the cluster is illegible, output exactly: [unreadable]',
  'Examples:',
  '따라서 답은 3입니다.',
  '$x$의 값은 $\\frac{1}{2}$이다.',
  '$$x^2 - 5x + 6 = 0 \\Rightarrow (x-2)(x-3) = 0 \\therefore x=2 \\text{ 또는 } x=3$$',
].join('\n');

/** Max tokens to generate. Long real solutions fit in ~256 tokens; we
 *  pad to 384 for safety. Without a cap, qwen-VL occasionally rambles
 *  past stop and adds ~2-5s of generation latency. */
const DEFAULT_MAX_TOKENS = 384;

export class OcrError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'OcrError';
  }
}

export class OcrDisabledError extends OcrError {
  constructor() {
    super(
      0,
      'Recognition disabled — set VITE_GEMINI_ENABLED=1 with VITE_GEMINI_BASE_URL, or VITE_OCR_ENABLED=1 with VITE_OCR_BASE_URL. Credentials are injected by the relay; no token is set in the webapp.',
    );
    this.name = 'OcrDisabledError';
  }
}

export type OcrConfigSnapshot = {
  provider: RecognitionProvider;
  baseUrl: string;
  model: string;
  enabled: boolean;
  /** Whether a token is configured. We never expose the token itself. */
  hasToken: boolean;
};

export function getOcrConfig(): OcrConfigSnapshot {
  const { provider, baseUrl, model, authToken, enabled } = resolveConfig();
  return {
    provider,
    baseUrl,
    model,
    enabled: enabled && baseUrl.length > 0 && authToken.length > 0,
    hasToken: authToken.length > 0,
  };
}

/**
 * 펜클래스 배선: 인식은 항상 같은 오리진 `/api/ai`(action:'ocr')로 간다 —
 * 관리자가 고른 엔진(OpenRouter 기본)을 서버가 키와 함께 실행하므로
 * 클라이언트 env 구성 없이 로그인만 돼 있으면 사용 가능하다.
 * (POC 의 /ocr·/gemini 릴레이 env 는 __OCR_TEST__ 오버라이드로만 남겨둔다)
 */
export function isOcrEnabled(): boolean {
  const override = readOverride();
  if (Object.keys(override).length > 0) return getOcrConfig().enabled;
  return true;
}

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: { content?: string | Array<{ type: string; text?: string }> };
    text?: string;
  }>;
  error?: { message?: string };
};

/** Wall-clock breakdown for one OCR request. All times are ms. */
export type OcrTimings = {
  /** Time spent in fetch() until response headers arrive (TTFB-ish,
   *  but for a JSON endpoint this also bounds generation). */
  fetchMs: number;
  /** Time to parse the JSON body once the response is complete. */
  parseMs: number;
  /** Total `recognizeStrokeImage` duration. */
  totalMs: number;
  /** Outgoing request size in bytes (prompt + image base64). */
  requestBytes: number;
  /** Recognised text length, for tokens-per-second sanity checks. */
  responseChars: number;
};

export type RecognizeOptions = {
  prompt?: string;
  signal?: AbortSignal;
  /** Cap on generated tokens. Defaults to `DEFAULT_MAX_TOKENS`. */
  maxTokens?: number;
  /** Receives timing telemetry for the call. Always invoked on success. */
  onTimings?: (t: OcrTimings) => void;
};

/**
 * Recognise the handwriting contained in `pngBase64`.
 *
 * `pngBase64` must be the **bare base64** body (no `data:` prefix) — we
 * add the prefix when assembling the data URL. `signal` lets callers
 * cancel an inflight request when the group is replaced or cleared.
 *
 * Returns the recognised text trimmed of surrounding whitespace.
 */
export async function recognizeStrokeImage(
  pngBase64: string,
  opts: RecognizeOptions = {},
): Promise<string> {
  const override = readOverride();
  // 기본 경로: 같은 오리진 /api/ai (서버가 엔진·키 보유). __OCR_TEST__ 가
  // 있으면 아래 POC 경로(chat/completions 직접 호출)로 우회한다.
  if (Object.keys(override).length === 0) {
    return recognizeViaApi(pngBase64, opts);
  }

  const { baseUrl, authToken, model, enabled } = resolveConfig();
  if (!enabled) throw new OcrDisabledError();
  if (!baseUrl || !authToken) throw new OcrDisabledError();

  const prompt = opts.prompt ?? DEFAULT_OCR_PROMPT;
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model,
    // Greedy decoding — OCR has one correct answer, sampling only adds
    // latency and variance.
    temperature: 0,
    top_p: 1,
    // Bound generation so a misbehaving model can't drag the response
    // out indefinitely. Caller can override via `opts.maxTokens`.
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${pngBase64}` },
          },
        ],
      },
    ],
  };
  const requestPayload = JSON.stringify(body);
  const requestBytes = requestPayload.length;
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      // No Authorization header on purpose: the same-origin relay injects the
      // real Gemini/OCR credential server-side. Sending one here would override
      // the browser's cached edge (auth_basic) credential and 401 at nginx.
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: requestPayload,
    });
  } catch (err) {
    // fetch() throws on network failure / CORS / abort — surface as OCR
    // error so the UI can show a retry affordance.
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new OcrError(0, `OCR network error: ${(err as Error)?.message ?? err}`);
  }
  const tFetch =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (res.status === 401 || res.status === 403) {
    throw new OcrError(
      res.status,
      `OCR auth failed (${res.status}) — token may be invalid or expired.`,
    );
  }
  if (!res.ok) {
    const detail = await safeReadText(res);
    throw new OcrError(
      res.status,
      `OCR ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }

  const json = (await res.json()) as ChatCompletionsResponse;
  const tParse =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (json.error?.message) {
    throw new OcrError(res.status, `OCR server error: ${json.error.message}`);
  }
  const text = extractText(json);
  if (text == null) {
    throw new OcrError(res.status, 'OCR response missing message content.');
  }
  const out = normaliseOcrOutput(text);
  if (opts.onTimings) {
    opts.onTimings({
      fetchMs: tFetch - t0,
      parseMs: tParse - tFetch,
      totalMs: tParse - t0,
      requestBytes,
      responseChars: out.length,
    });
  }
  return out;
}

/** 같은 오리진 /api/ai(action:'ocr') 경유 인식 — 세션 Bearer 필요. */
async function recognizeViaApi(
  pngBase64: string,
  opts: RecognizeOptions,
): Promise<string> {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { requireSupabase } = await import('./supabase');
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new OcrError(401, '로그인이 필요합니다.');

  const payload = JSON.stringify({
    action: 'ocr',
    image: `data:image/png;base64,${pngBase64}`,
    prompt: opts.prompt ?? DEFAULT_OCR_PROMPT,
  });
  let res: Response;
  try {
    res = await fetch('/api/ai', {
      method: 'POST',
      signal: opts.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: payload,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new OcrError(0, `OCR network error: ${(err as Error)?.message ?? err}`);
  }
  const json = (await res.json().catch(() => ({}))) as {
    text?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new OcrError(res.status, json.error ?? `OCR ${res.status}`);
  }
  const out = normaliseOcrOutput(json.text ?? '');
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  opts.onTimings?.({
    fetchMs: t1 - t0,
    parseMs: 0,
    totalMs: t1 - t0,
    requestBytes: payload.length,
    responseChars: out.length,
  });
  return out;
}

/**
 * Strip the most common prompt-violation envelopes (Markdown code
 * fences, surrounding quotes, "Here is the transcription:" prefaces).
 * The prompt already forbids these, but a defensive parse keeps the UI
 * clean even when the model misbehaves on a hard image.
 */
export function normaliseOcrOutput(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/^```(?:latex|tex|math)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1].trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith('“') && s.endsWith('”')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(
    /^(?:here(?:'s| is)\s+(?:the\s+)?(?:transcription|text|answer|recognised\s+text)\s*:?\s*)/i,
    '',
  );
  return s.trim();
}

function extractText(json: ChatCompletionsResponse): string | null {
  const first = json.choices?.[0];
  if (!first) return null;
  // OpenAI-style multimodal: content can be string OR an array of parts.
  const content = first.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p?.type === 'text' && typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim();
  }
  // Fallback for `text-completion`-shaped responses some servers return.
  if (typeof first.text === 'string') return first.text;
  return null;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  } catch {
    return '';
  }
}
