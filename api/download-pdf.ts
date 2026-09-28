/**
 * ncode PDF 다운로드 프록시 — GET /api/download-pdf?id=<pdfId>&kind=ncoded|original
 *
 * CDN(cdn.dev.mathsecr.com)의 프라이빗 PDF 는 Basic 인증이 아니라
 * NGS 가 발급하는 `Cloud-CDN-Cookie` 로만 열린다 (직접 접근 403, Basic 401).
 * 브라우저는 vercel.app 오리진에서 그 쿠키를 가질 수 없으므로 서버가 대신:
 *   1. NGS `GET /pdfs/{id}` (NGS_AUTH 주입) → 응답의 Set-Cookie 에서
 *      Cloud-CDN-Cookie 추출 + 최신 ncodedPdfUrl 확보
 *   2. 그 쿠키로 CDN fetch → PDF 바이너리를 그대로 스트림
 */
type Req = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  setHeader: (k: string, v: string) => void;
  json: (body: unknown) => void;
  send: (body: unknown) => void;
  end: (body?: unknown) => void;
};

export default async function handler(req: Req, res: Res) {
  const base = process.env.NGS_BASE_URL;
  const auth = process.env.NGS_AUTH;
  if (!base || !auth) {
    res.status(503).json({ error: 'NGS 연동이 설정되지 않았습니다.' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://local');
  const id = Number(url.searchParams.get('id'));
  const kindParam = url.searchParams.get('kind');
  const kind =
    kindParam === 'original' || kindParam === 'page' ? kindParam : 'ncoded';
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'id 파라미터가 필요합니다.' });
    return;
  }

  try {
    // kind=page — 페이지 미리보기 PNG 릴레이 (라이브 문제지 배경용).
    // vercel.app 오리진은 CDN 의 Cloud-CDN-Cookie(서드파티)를 보낼 수 없어
    // 서버가 쿠키를 받아 대신 가져온다.
    if (kind === 'page') {
      const pageIndex = Number(url.searchParams.get('page'));
      if (!Number.isInteger(pageIndex) || pageIndex < 0) {
        res.status(400).json({ error: 'page 파라미터가 필요합니다.' });
        return;
      }
      const pageResp = await fetch(
        `${base.replace(/\/$/, '')}/api/v1/pdfs/${id}/pages/${pageIndex}`,
        { headers: { authorization: auth, accept: 'application/json' } },
      );
      if (!pageResp.ok) {
        res
          .status(pageResp.status)
          .json({ error: `NGS 페이지 조회 실패 (${pageResp.status})` });
        return;
      }
      const cookieM = (pageResp.headers.get('set-cookie') ?? '').match(
        /Cloud-CDN-Cookie=[^;,\s]+/,
      );
      const pageBody = (await pageResp.json()) as {
        data?: { originalImageUrl?: string };
      };
      const imgUrl = pageBody.data?.originalImageUrl;
      if (!imgUrl) {
        res.status(404).json({ error: '페이지 이미지 주소가 없습니다.' });
        return;
      }
      const img = await fetch(imgUrl, {
        headers: cookieM ? { cookie: cookieM[0] } : {},
      });
      if (!img.ok) {
        res.status(img.status).json({ error: `CDN 이미지 오류 (${img.status})` });
        return;
      }
      const imgBuf = Buffer.from(await img.arrayBuffer());
      res.setHeader(
        'Content-Type',
        img.headers.get('content-type') ?? 'image/png',
      );
      // 페이지 PNG·PDF 는 pdfId 기준 불변 — 브라우저가 하루 재사용하게 해
      // 리뷰 재방문 시 "PDF 로딩중"을 없앤다 (재발급 시 pdfId 가 바뀐다).
      res.setHeader(
        'Cache-Control',
        'private, max-age=86400, stale-while-revalidate=604800',
      );
      res.status(200).end(imgBuf);
      return;
    }
    // 1) NGS 상세 — CDN URL + Cloud-CDN-Cookie 확보
    const detail = await fetch(
      `${base.replace(/\/$/, '')}/api/v1/pdfs/${id}`,
      { headers: { authorization: auth, accept: 'application/json' } },
    );
    if (!detail.ok) {
      res
        .status(detail.status)
        .json({ error: `NGS 상세 조회 실패 (${detail.status})` });
      return;
    }
    const setCookie = detail.headers.get('set-cookie') ?? '';
    const cookieMatch = setCookie.match(/Cloud-CDN-Cookie=[^;,\s]+/);
    const body = (await detail.json()) as {
      data?: {
        title?: string;
        ncodedPdfUrl?: string;
        originalPdfUrl?: string;
      };
    };
    const pdfUrl =
      kind === 'ncoded' ? body.data?.ncodedPdfUrl : body.data?.originalPdfUrl;
    if (!pdfUrl) {
      res.status(409).json({
        error:
          kind === 'ncoded'
            ? 'ncode 합성이 아직 완료되지 않았습니다. 잠시 후 다시 시도해주세요.'
            : '원본 PDF 주소를 찾지 못했습니다.',
      });
      return;
    }

    // 2) CDN fetch — 쿠키 인증
    const cdn = await fetch(pdfUrl, {
      headers: cookieMatch ? { cookie: cookieMatch[0] } : {},
    });
    if (!cdn.ok) {
      res.status(cdn.status).json({ error: `CDN 응답 오류 (${cdn.status})` });
      return;
    }
    const buf = Buffer.from(await cdn.arrayBuffer());

    // 한글 제목 파일명 — RFC 5987 filename* + ASCII fallback
    const title = (body.data?.title ?? `paper-${id}`).replace(/[/\\]/g, '_');
    const suffix = kind === 'ncoded' ? '-ncode' : '';
    const encoded = encodeURIComponent(`${title}${suffix}.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="paper-${id}${suffix}.pdf"; filename*=UTF-8''${encoded}`,
    );
    res.setHeader('Content-Length', String(buf.byteLength));
    res.status(200).end(buf);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'PDF 다운로드 실패',
    });
  }
}
