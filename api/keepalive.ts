import { serviceClient } from './_lib.js';

/**
 * Supabase 무료 티어 절전 방지 핑 — vercel.json 의 crons 가 매일 1회 호출.
 * 무료 프로젝트는 7일간 활동이 없으면 자동 일시정지되므로, 가벼운 카운트
 * 쿼리로 "활동"을 남긴다. (사용자가 1~2주에 한 번만 접속해도 서버 유지)
 */
type Req = { method?: string };
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

export default async function handler(_req: Req, res: Res) {
  try {
    const admin = serviceClient();
    const { count, error } = await admin
      .from('sp_profiles')
      .select('id', { count: 'exact', head: true });
    if (error) throw new Error(error.message);
    res.status(200).json({ ok: true, profiles: count ?? 0, at: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
