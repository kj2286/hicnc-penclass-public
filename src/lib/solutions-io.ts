/**
 * 모범 풀이·답안 — 스토리지 IO. 순수 매칭·지시문은 solutions.ts 에 있다
 * (분리 이유: scripts/solutions-test.ts 가 supabase 없이 순수부를 검증한다).
 */
import { requireSupabase } from './supabase';
import { downloadJsonObject, STROKES_BUCKET } from './strokes-io';
import type { SolutionsDoc } from './solutions';

/** 서버 경유 다운로드 — 직접 다운로드가 막히는 브라우저를 위한 폴백
 *  (api/strokes 가 교사·관리자 확인 후 서비스키로 읽어 내려준다) */
async function fetchViaApi(path: string): Promise<Response | null> {
  try {
    const supabase = requireSupabase();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    const res = await fetch(`/api/strokes?path=${encodeURIComponent(path)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

const cache = new Map<number, SolutionsDoc | null>();

/** 교재의 모범 풀이 문서 — 없으면 null. 성공한 문서만 세션 캐시한다.
 *  🚨 null 을 캐시하면 안 된다: 권한이 나중에 열리거나(024 실사고 —
 *  SQL 실행 전에 열어둔 탭이 '없음'을 물고 있다가 catch-up 이 빈손으로 돌며
 *  새 solSig 를 도장 찍어 영영 비교가 안 붙는다) 해설이 나중에 올라올 수 있다. */
export async function loadSolutionsDoc(
  pdfId: number,
): Promise<SolutionsDoc | null> {
  const hit = cache.get(pdfId);
  if (hit) return hit;
  let doc = await downloadJsonObject<SolutionsDoc>(
    `solutions/${pdfId}.json`,
  ).catch(() => null);
  if (!doc) {
    // 직접 다운로드가 비면 서버 경유로 한 번 더 — RLS·브라우저별 편차 대비
    const res = await fetchViaApi(`solutions/${pdfId}.json`);
    if (res) doc = (await res.json().catch(() => null)) as SolutionsDoc | null;
  }
  const valid = doc && doc.v === 1 && Array.isArray(doc.problems) ? doc : null;
  if (valid) cache.set(pdfId, valid);
  return valid;
}

/** 해설 페이지 이미지의 서명 URL (10분) — 없으면 null */
export async function solutionImageUrl(
  pdfId: number,
  page: number,
): Promise<string | null> {
  const supabase = requireSupabase();
  const path = `solutions/${pdfId}/p${page}.png`;
  const { data } = await supabase.storage
    .from(STROKES_BUCKET)
    .createSignedUrl(path, 600);
  if (data?.signedUrl) return data.signedUrl;
  // 서명 URL 이 막히면 서버 경유로 받아 blob URL 로 보여준다
  const res = await fetchViaApi(path);
  if (!res) return null;
  return URL.createObjectURL(await res.blob());
}

// promptSigExt 의 fnv 와 같은 계열 — 여기 복사해 두는 이유는 paper-prompts 의
// fnv 가 모듈 내부용이라서다 (special-pages 도 같은 방식).
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * 지금 읽을 수 있는 해설 문서 전체의 서명 — catch-up 게이트용.
 * 해설이 새로 올라오거나 바뀌면(또는 024 정책 적용으로 처음 읽히게 되면)
 * 값이 달라져, 완료로 기록된 제출도 한 번 다시 훑는다. 그 안에서는 문항별
 * akey 가 갈라 주므로 실제 재분석은 해설이 걸린 문항만 돈다.
 */
export async function solutionsSignature(): Promise<string> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.storage
    .from(STROKES_BUCKET)
    .list('solutions', { limit: 1000 });
  if (error || !data) return 'none';
  const names = data
    .filter((f) => f.name.endsWith('.json'))
    .map((f) => `${f.name}:${f.updated_at ?? ''}`)
    .sort()
    .join('|');
  return names ? `sol-${fnv(names)}` : 'none';
}

/** 업로드 직후 세션 캐시를 비워 새 해설이 바로 읽히게 한다 */
export function invalidateSolutionsCache(pdfId: number): void {
  cache.delete(pdfId);
}

/** 해설이 등록된 교재 id 목록 — 교재 목록 화면의 배지용 (스토리지 목록 1회) */
export async function listSolutionPdfIds(): Promise<Set<number>> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.storage
    .from(STROKES_BUCKET)
    .list('solutions', { limit: 1000 });
  if (error || !data) return new Set();
  const out = new Set<number>();
  for (const f of data) {
    const m = /^(\d+)\.json$/.exec(f.name);
    if (m) out.add(Number(m[1]));
  }
  return out;
}
