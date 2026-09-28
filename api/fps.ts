/**
 * FPS(FileProcessService) 프록시 — ncode 교재 업로드 1단계(PDF 해시 발급).
 * vercel.json 이 /api/fps/<경로> → /api/fps?suffix=<경로> 로 rewrite.
 *
 * BMS → FPS 전환 (원본 POC PR #28): 같은 POST /api/v1/files 경로의 소유가
 * DOT 정본상 FPS 이며, BMS 의 중복 등록은 제거 예정. FPS 는 BE.fps#78 이후
 * NGS 와 동일한 PMK Basic(NGS_AUTH)을 받는다.
 *
 * FPS_BASE_URL / NGS_AUTH 미설정이면 503 (fail-closed — 자격증명 없이
 * 업스트림에 붙지 않는다).
 */

// 1200dpi 등 고해상도 NCode 발급·대용량 업로드는 오래 걸린다 —
// 기본 함수 시간 제한(10초) 초과로 502 가 나던 문제. Hobby 최대치로 연장.
export const maxDuration = 60;
export const config = { api: { bodyParser: false } };

type Req = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on: (ev: string, cb: (chunk?: unknown) => void) => void;
};
type Res = {
  status: (code: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
};

function readRawBody(req: Req): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c as Buffer)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (e) => reject(e));
  });
}

export default async function handler(req: Req, res: Res) {
  const base = process.env.FPS_BASE_URL;
  const auth = process.env.NGS_AUTH; // NGS 와 동일한 PMK Basic 자격증명 공유
  if (!base || !auth) {
    res.status(503).json({
      error: 'FPS(파일 업로드 서버) 연동이 아직 설정되지 않았습니다.',
      hint: 'Vercel 환경변수 FPS_BASE_URL / NGS_AUTH 를 설정하면 활성화됩니다.',
    });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://local');
  const suffix = url.searchParams.get('suffix') ?? '';
  const target = `${base.replace(/\/$/, '')}/${suffix}`;

  const headers: Record<string, string> = {};
  const ct = req.headers['content-type'];
  if (typeof ct === 'string') headers['content-type'] = ct;
  headers.authorization = auth;

  const body =
    req.method && !['GET', 'HEAD'].includes(req.method)
      ? await readRawBody(req)
      : undefined;

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: req.method, headers, body });
  } catch (err) {
    // 업스트림 연결 실패(인증서 만료·DNS·타임아웃)를 크래시로 두지 않는다 —
    // 크래시하면 FUNCTION_INVOCATION_FAILED 만 보이고 원인을 알 수 없다
    // (2026-08-13 실사고: NGS 인증서 만료 → 전 기능 'PDF 로드 실패').
    // Node fetch 는 실제 원인을 err.cause 에 숨긴다 —
    // 이걸 안 펼치면 'fetch failed' 만 보여 인증서 만료를 구분할 수 없다
    const cause = (err as { cause?: unknown })?.cause;
    const detail =
      cause instanceof Error ? cause.message : cause ? String(cause) : '';
    const reason =
      (err instanceof Error ? err.message : String(err)) +
      (detail ? `: ${detail}` : '');
    const cert = /certificate|CERT_|SSL|TLS/i.test(reason);
    res.status(502).json({
      error: cert
        ? 'FPS(파일 서버)의 보안 인증서(HTTPS)가 만료되어 연결할 수 없습니다. 서버 담당자에게 인증서 갱신을 요청해주세요.'
        : 'FPS(파일 서버)에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
      reason,
    });
    return;
  }
  res.status(upstream.status);
  const respType = upstream.headers.get('content-type') ?? 'application/json';
  res.setHeader('content-type', respType);
  if (respType.includes('json')) {
    res.json(await upstream.json().catch(() => ({})));
  } else {
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}
