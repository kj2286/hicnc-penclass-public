/**
 * FPS(FileProcessService) REST API v1 클라이언트 — PDF 업로드 해시 발급.
 *
 * `POST /api/v1/files` 는 multipart `files` 파트(정확히 이 이름 — 다른 이름은
 * 400 ERR-SYS-001)를 받아 `{data: ["<fileHash>"]}` 를 돌려준다. NGS 는 등록 시
 * 이 해시로 FPS 에서 파일을 가져간다.
 *
 * BMS → FPS 전환 (원본 POC PR #28, DOT 정본 services/fps/api-design/files-upload.md):
 * BMS 의 같은 경로는 legacy 중복 등록이라 곧 제거된다. FPS 인증은
 * BE.fps#78 이후 NGS 와 동일한 PMK Basic 을 받는다 (JWTOrAPIKeyVerify).
 *
 * 주의: fileHash 는 콘텐츠 해시가 아니라 timestamp+random 이며 **TTL 24시간** —
 * 만료된 해시로 NGS 등록 시 ERR-NGS-001. (업로드 직후 바로 등록하므로 안전)
 *
 * 운영은 서버리스 프록시(/api/fps)가 PMK 를 서버측 주입, 로컬 dev 는
 * VITE_FPS_BASE_URL 직접 호출 시에만 Authorization 을 붙인다.
 */

import { NgsAuthError, NgsHttpError } from './ngs-client';

const DEFAULT_FPS_BASE_URL = '/fps';

// 운영 번들은 직접 호출 주소를 읽지 않는다 — ngs-client.ts 와 같은 이유(CORS 실사고)
const FPS_BASE_URL_ENV = import.meta.env.DEV
  ? ((import.meta.env.VITE_FPS_BASE_URL as string | undefined) ?? '')
  : '';

const FPS_AUTH_TOKEN_ENV = import.meta.env.DEV
  ? ((import.meta.env.VITE_FPS_AUTH_TOKEN as string | undefined) ?? '')
  : '';

let runtimeFpsBaseUrl = '';

/**
 * FPS base URL 런타임 오버라이드 (NGS 패턴 미러링). 테스트와 설정 패널이
 * 호출할 수 있고, localStorage 영속화는 호출자 몫.
 */
export function configureFps(cfg: { baseUrl?: string }): void {
  if (cfg.baseUrl != null) runtimeFpsBaseUrl = cfg.baseUrl;
}

if (typeof window !== 'undefined') {
  const cfg = (
    window as unknown as { __NGS_TEST__?: { fpsBaseUrl?: string } }
  ).__NGS_TEST__;
  if (cfg?.fpsBaseUrl) runtimeFpsBaseUrl = cfg.fpsBaseUrl;
}

export function fpsBaseUrl(): string {
  const raw =
    (runtimeFpsBaseUrl && runtimeFpsBaseUrl.length > 0
      ? runtimeFpsBaseUrl
      : FPS_BASE_URL_ENV) || DEFAULT_FPS_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * PDF 1개를 FPS 에 업로드하고 fileHash 를 반환한다.
 * XHR 사용 — 업로드 진행률을 다이얼로그에 스트리밍하기 위함.
 */
export type UploadProgress = {
  loaded: number;
  total: number;
  fraction?: number;
};

export function uploadFileToFps(args: {
  file: File;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { file, onProgress, signal } = args;
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    // 파트 이름은 정확히 `files` — BE.fps files_handler 가 다른 이름은 skip 후
    // 400 ERR-SYS-001 을 돌려준다.
    fd.append('files', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${fpsBaseUrl()}/api/v1/files`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Accept', 'application/json');
    // 외부 FPS 직접 호출(로컬 dev)일 때만 PMK Basic 을 클라이언트가 붙인다.
    // 운영은 /api/fps 프록시가 서버측 주입 — 브라우저에 키를 두지 않는다.
    if (FPS_AUTH_TOKEN_ENV && FPS_BASE_URL_ENV && !FPS_BASE_URL_ENV.startsWith('/')) {
      xhr.setRequestHeader('Authorization', FPS_AUTH_TOKEN_ENV);
    }
    xhr.responseType = 'json';

    if (onProgress) {
      xhr.upload.addEventListener('progress', (ev) => {
        onProgress({
          loaded: ev.loaded,
          total: ev.total,
          fraction: ev.lengthComputable ? ev.loaded / ev.total : undefined,
        });
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = xhr.response as
          | { data?: unknown }
          | string[]
          | null;
        const hash = extractFirstHash(body);
        if (!hash) {
          reject(
            new NgsHttpError(
              xhr.status,
              `FPS 업로드 응답에 해시가 없습니다: ${xhr.responseText.slice(0, 200)}`,
            ),
          );
          return;
        }
        resolve(hash);
      } else if (xhr.status === 401 || xhr.status === 403) {
        reject(
          new NgsAuthError(
            xhr.status,
            `FPS 업로드 인증 실패 (${xhr.status}) — FPS 의 PMK 인증(BE.fps#78) 배포 여부를 확인하세요.`,
          ),
        );
      } else if (xhr.status === 502 || xhr.status === 503) {
        // 업스트림 nginx "no available server" 등 — 대부분 개발 서버 재배포 순단
        reject(
          new NgsHttpError(
            xhr.status,
            `업로드 서버가 일시적으로 응답하지 않습니다 (${xhr.status}). 서버 재시작 중일 수 있어요 — 잠시 후 다시 시도해주세요.`,
          ),
        );
      } else {
        reject(new NgsHttpError(xhr.status, `FPS 업로드 실패 (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new NgsHttpError(0, 'FPS 업로드 네트워크 오류'));
    xhr.onabort = () => reject(new NgsHttpError(0, 'FPS 업로드가 중단되었습니다'));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        reject(new NgsHttpError(0, 'FPS 업로드가 중단되었습니다'));
        return;
      }
      signal.addEventListener('abort', () => xhr.abort());
    }

    xhr.send(fd);
  });
}

/**
 * 확인된 응답 형태:
 *   - `{ data: ["<hash>", …] }` (BE.fps fileResponse — 현행)
 *   - `{ data: [{ hash: "<hash>" }, …] }` (스펙 예시)
 *   - bare `["<hash>"]` (legacy)
 */
function extractFirstHash(body: unknown): string | null {
  const arr =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data?: unknown }).data
      : body;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'hash' in first) {
    const h = (first as { hash?: unknown }).hash;
    return typeof h === 'string' ? h : null;
  }
  return null;
}
