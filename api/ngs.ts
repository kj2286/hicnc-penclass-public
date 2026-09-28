/**
 * NGS(Ncode Generate Service) 프록시 — PDF 에 ncode 를 입히는 사내 서비스.
 * vercel.json 이 /api/ngs/<경로> 를 /api/ngs?suffix=<경로> 로 rewrite 한다.
 * NGS_BASE_URL / NGS_AUTH 가 설정되면 그대로 중계(자격증명 서버측 주입),
 * 없으면 503 을 돌려 프런트가 "연동 대기" 상태를 표시한다.
 */

// 1200dpi 등 고해상도 NCode 발급·대용량 업로드는 오래 걸린다 —
// 기본 함수 시간 제한(10초) 초과로 502 가 나던 문제. Hobby 최대치로 연장.
export const maxDuration = 60;
type Req = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};
type Res = {
  status: (code: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
};

export default async function handler(req: Req, res: Res) {
  // 발급 상태와 목록은 매번 서버에서 읽는다. 오류 응답도 캐시에 남기지 않는다.
  res.setHeader('Cache-Control', 'no-store');
  const base = process.env.NGS_BASE_URL;
  const auth = process.env.NGS_AUTH; // 예: "Basic xxx" 또는 "Bearer xxx"
  if (!base) {
    res.status(503).json({
      error: 'NGS(ncode 발급 서버) 연동이 아직 설정되지 않았습니다.',
      hint: 'Vercel 환경변수 NGS_BASE_URL / NGS_AUTH 를 설정하면 활성화됩니다.',
    });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://local');
  const suffix = url.searchParams.get('suffix') ?? '';
  url.searchParams.delete('suffix');
  const qs = url.searchParams.toString();
  const target = `${base.replace(/\/$/, '')}/${suffix}${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = {};
  const contentType = req.headers['content-type'];
  if (typeof contentType === 'string') headers['content-type'] = contentType;
  if (auth) headers.authorization = auth;

  let upstream: Response;
  try {
  upstream = await fetch(target, {
    method: req.method,
    ...(!req.method || ['GET', 'HEAD'].includes(req.method) ? { cache: 'no-store' as const } : {}),
    headers,
    body:
      req.method && !['GET', 'HEAD'].includes(req.method)
        ? typeof req.body === 'string'
          ? req.body
          : JSON.stringify(req.body)
        : undefined,
  });
  } catch (err) {
    // 업스트림 연결 실패(인증서 만료·DNS·타임아웃)는 함수 크래시로 두지 않는다.
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
        ? 'NGS(교재 발급 서버)의 보안 인증서(HTTPS)가 만료되어 연결할 수 없습니다. 서버 담당자에게 인증서 갱신을 요청해주세요.'
        : 'NGS(교재 발급 서버)에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.',
      reason,
      upstream: target,
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
