import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { seedDesignPlugin } from '@seed-design/vite-plugin';
import tsconfigPaths from 'vite-tsconfig-paths';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

/**
 * Dev mirror of the Vercel function `api/download-pdf.ts` so the same
 * `/api/download-pdf?id=…&kind=…` URL works on localhost. The private CDN
 * only accepts the Cloud-CDN-Cookie NGS issues, so we fetch the NGS detail
 * (Basic auth from .env.local), capture the cookie, and relay the PDF.
 */
function downloadPdfDevProxy(env: Record<string, string>): Plugin {
  return {
    name: 'download-pdf-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/download-pdf', (req, res) => {
        void (async () => {
          const base = env.NGS_BASE_URL;
          const auth = env.NGS_AUTH;
          const fail = (code: number, msg: string) => {
            res.statusCode = code;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: msg }));
          };
          if (!base || !auth) return fail(503, 'NGS env 미설정 (.env.local)');
          const url = new URL(req.url ?? '/', 'http://local');
          const id = Number(url.searchParams.get('id'));
          const kindParam = url.searchParams.get('kind');
          const kind =
            kindParam === 'original' || kindParam === 'page' ? kindParam : 'ncoded';
          if (!Number.isInteger(id) || id <= 0) return fail(400, 'id 필요');
          if (kind === 'page') {
            const pageIndex = Number(url.searchParams.get('page'));
            if (!Number.isInteger(pageIndex) || pageIndex < 0)
              return fail(400, 'page 필요');
            const pr = await fetch(
              `${base.replace(/\/$/, '')}/api/v1/pdfs/${id}/pages/${pageIndex}`,
              { headers: { authorization: auth, accept: 'application/json' } },
            );
            if (!pr.ok) return fail(pr.status, 'NGS 페이지 조회 실패');
            const ck = (pr.headers.get('set-cookie') ?? '').match(
              /Cloud-CDN-Cookie=[^;,\s]+/,
            );
            const pb = (await pr.json()) as {
              data?: { originalImageUrl?: string };
            };
            if (!pb.data?.originalImageUrl) return fail(404, '이미지 주소 없음');
            const img = await fetch(pb.data.originalImageUrl, {
              headers: ck ? { cookie: ck[0] } : {},
            });
            if (!img.ok) return fail(img.status, 'CDN 이미지 오류');
            res.statusCode = 200;
            res.setHeader(
              'content-type',
              img.headers.get('content-type') ?? 'image/png',
            );
            res.end(Buffer.from(await img.arrayBuffer()));
            return;
          }
          const detail = await fetch(
            `${base.replace(/\/$/, '')}/api/v1/pdfs/${id}`,
            { headers: { authorization: auth, accept: 'application/json' } },
          );
          if (!detail.ok) return fail(detail.status, 'NGS 상세 조회 실패');
          const cookie = (detail.headers.get('set-cookie') ?? '').match(
            /Cloud-CDN-Cookie=[^;,\s]+/,
          );
          const body = (await detail.json()) as {
            data?: { title?: string; ncodedPdfUrl?: string; originalPdfUrl?: string };
          };
          const pdfUrl =
            kind === 'ncoded' ? body.data?.ncodedPdfUrl : body.data?.originalPdfUrl;
          if (!pdfUrl) return fail(409, 'ncode 합성이 아직 완료되지 않았습니다.');
          const cdn = await fetch(pdfUrl, {
            headers: cookie ? { cookie: cookie[0] } : {},
          });
          if (!cdn.ok) return fail(cdn.status, `CDN 응답 오류 (${cdn.status})`);
          const buf = Buffer.from(await cdn.arrayBuffer());
          const encoded = encodeURIComponent(
            `${(body.data?.title ?? `paper-${id}`).replace(/[/\\]/g, '_')}${kind === 'ncoded' ? '-ncode' : ''}.pdf`,
          );
          res.statusCode = 200;
          res.setHeader('content-type', 'application/pdf');
          res.setHeader(
            'content-disposition',
            `attachment; filename="paper-${id}.pdf"; filename*=UTF-8''${encoded}`,
          );
          res.end(buf);
        })().catch((err) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        });
      });

      // 그 외 /api/* 는 Vercel 함수 전용(dev 미러 없음). 스텁 없이 두면 vite 가
      // api/*.ts 소스를 모듈로 변환하려다 실패해 에러 오버레이가 뜬다.
      // dev 에선 404 JSON 으로 응답한다 (/api/ai·/api/strokes 등 — 해당 기능은
      // dev 미표시, 운영에서 검증). 등록 순서상 위의 /api/download-pdf 가 우선.
      server.middlewares.use('/api', (_req, res) => {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not available in dev' }));
      });
    },
  };
}

/**
 * web_pen_sdk bundles `.nproj` XML files and requires them at runtime.
 * Rollup/esbuild cannot parse XML; expose them as raw strings instead.
 */
function nprojRawLoader(): Plugin {
  return {
    name: 'neo-smartpen-nproj-raw',
    enforce: 'pre',
    load(id) {
      if (id.endsWith('.nproj')) {
        const clean = id.split('?')[0];
        const xml = readFileSync(clean, 'utf-8');
        return `export default ${JSON.stringify(xml)};`;
      }
      return null;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    nprojRawLoader(),
    react(),
    // 다크모드 미지원 — 플러그인 기본값(system)은 head 에 주입되는 스크립트가
    // OS 다크 설정을 따라 html 속성을 덮어쓰므로 light-only 로 잠근다.
    seedDesignPlugin({ colorMode: 'light-only' }),
    tsconfigPaths(),
    downloadPdfDevProxy(loadEnv(mode, process.cwd(), '')),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Replace Node's zlib with a pako-backed browser-safe shim so the SDK
      // can decompress offline stroke data (`zlib.unzip`).
      zlib: fileURLToPath(new URL('./src/lib/zlib-pako.ts', import.meta.url)),
    },
  },
  assetsInclude: ['**/*.nproj'],
  // web_pen_sdk's NoteServer reads Firebase config from `process.env.*` at
  // module load. `process` is Node-only; stub it so the SDK loads in browsers.
  define: {
    'process.env': '{}',
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.nproj': 'text',
      },
      define: {
        'process.env': '{}',
      },
    },
  },
  server: {
    // Web Bluetooth treats http://localhost as a secure context.
    host: 'localhost',
    port: 5193,
    strictPort: true,
  },
}));
