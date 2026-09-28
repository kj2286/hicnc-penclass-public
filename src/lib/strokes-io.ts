/**
 * 필기(Stroke) 데이터 직렬화/업로드/다운로드.
 * 저장 형식: { version: 1, strokes: Stroke[] } JSON → gzip → Storage(sp-strokes).
 * 경로 규칙: {student_id}/{submission_id}.json.gz (썸네일은 .png)
 */
import { gzip, ungzip } from 'pako';
import type { Stroke } from '@/pen/live/model/stroke';
import { requireSupabase } from '@/lib/supabase';

export const STROKES_BUCKET = 'sp-strokes';

export type StrokesPayload = {
  version: 1;
  strokes: Stroke[];
};

export function serializeStrokes(strokes: Stroke[]): Uint8Array {
  const payload: StrokesPayload = { version: 1, strokes };
  return gzip(JSON.stringify(payload));
}

export function deserializeStrokes(data: ArrayBuffer | Uint8Array): Stroke[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const raw = new TextDecoder().decode(ungzip(bytes));
  const parsed = JSON.parse(raw) as StrokesPayload;
  return parsed.strokes ?? [];
}

export function strokesPath(studentId: string, submissionId: string): string {
  return `${studentId}/${submissionId}.json.gz`;
}

export function thumbnailPath(studentId: string, submissionId: string): string {
  return `${studentId}/${submissionId}.png`;
}

export async function uploadStrokes(
  studentId: string,
  submissionId: string,
  strokes: Stroke[],
): Promise<string> {
  const supabase = requireSupabase();
  const path = strokesPath(studentId, submissionId);
  const body = serializeStrokes(strokes);
  const { error } = await supabase.storage
    .from(STROKES_BUCKET)
    .upload(path, new Blob([body.buffer as ArrayBuffer]), {
      contentType: 'application/gzip',
      upsert: true,
      // 🚨 CDN 이 같은 경로의 옛 버전을 최대 1시간 물고 있는다(기본 3600초) —
      // 목록 숫자는 갱신되는데 문서를 열면 옛 필기만 재생되던 실사고(2026-08-17).
      // 병합마다 같은 경로에 덮어쓰는 파일이므로 캐시를 꺼야 한다.
      cacheControl: '0',
    });
  if (error) throw new Error(`필기 데이터 업로드 실패: ${error.message}`);
  return path;
}

export async function uploadThumbnail(
  studentId: string,
  submissionId: string,
  png: Blob,
): Promise<string> {
  const supabase = requireSupabase();
  const path = thumbnailPath(studentId, submissionId);
  const { error } = await supabase.storage
    .from(STROKES_BUCKET)
    .upload(path, png, { contentType: 'image/png', upsert: true, cacheControl: '0' });
  if (error) throw new Error(`썸네일 업로드 실패: ${error.message}`);
  return path;
}

/**
 * 서버리스 경유 다운로드 — 스토리지 RLS 가 선생님 계정을 거부하는 케이스의 폴백.
 * (권한 검증은 /api/strokes 가 제출 소유관계로 수행)
 */
async function downloadViaApi(path: string): Promise<ArrayBuffer> {
  const supabase = requireSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? '';
  const res = await fetch(`/api/strokes?path=${encodeURIComponent(path)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `필기 데이터 다운로드 실패 (${res.status})`);
  }
  return res.arrayBuffer();
}

export async function downloadStrokes(path: string): Promise<Stroke[]> {
  const supabase = requireSupabase();
  // 🚨 **CDN 캐시 우회가 필수다.** 필기 파일은 같은 경로에 계속 덮어써지는데
  // CDN 이 옛 버전을 최대 1시간 물고 있어서, 방금 병합한 필기를 열어도 옛
  // 필기만 재생되던 실사고(2026-08-17). 더 위험한 건 병합의 읽기-수정-쓰기가
  // 묵은 읽기 위에서 돌면 **최신 획을 잃을 수 있다**는 것. 서명 URL 은 호출마다
  // 토큰이 달라 캐시 키가 갈리므로 항상 원본을 읽는다.
  const { data: signed } = await supabase.storage
    .from(STROKES_BUCKET)
    .createSignedUrl(path, 60);
  if (signed?.signedUrl) {
    const res = await fetch(signed.signedUrl, { cache: 'no-store' });
    if (res.ok) return deserializeStrokes(await res.arrayBuffer());
  }
  const { data, error } = await supabase.storage
    .from(STROKES_BUCKET)
    .download(path);
  if (error || !data) {
    return deserializeStrokes(await downloadViaApi(path));
  }
  return deserializeStrokes(await data.arrayBuffer());
}

/** 부속 JSON 업로드(upsert) — 분석 수정본 등. 실패 시 throw. */
export async function uploadJsonObject(
  path: string,
  obj: unknown,
): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.storage
    .from(STROKES_BUCKET)
    .upload(path, new Blob([JSON.stringify(obj)], { type: 'application/json' }), {
      upsert: true,
      // 🚨 CDN 이 같은 경로의 옛 버전을 최대 1시간 물고 있는다(기본 3600초) —
      // 목록 숫자는 갱신되는데 문서를 열면 옛 필기만 재생되던 실사고(2026-08-17).
      // 병합마다 같은 경로에 덮어쓰는 파일이므로 캐시를 꺼야 한다.
      cacheControl: '0',
      contentType: 'application/json',
    });
  if (error) throw new Error(error.message);
}

/** 부속 JSON 다운로드 — 없거나 파싱 실패면 null. */
export async function downloadJsonObject<T>(path: string): Promise<T | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.storage
    .from(STROKES_BUCKET)
    .download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

export async function signedThumbnailUrl(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const supabase = requireSupabase();
  const { data } = await supabase.storage
    .from(STROKES_BUCKET)
    .createSignedUrl(path, 60 * 10);
  if (data?.signedUrl) return data.signedUrl;
  // 폴백: 서버리스 경유로 받아 blob URL 생성
  try {
    const buf = await downloadViaApi(path);
    return URL.createObjectURL(new Blob([buf], { type: 'image/png' }));
  } catch {
    return null;
  }
}
