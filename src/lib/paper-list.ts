/**
 * 교재 목록의 **순수 규칙** — supabase 를 끌고 오지 않는다.
 *
 * `paper-owners.ts` 는 supabase 클라이언트를 잡으므로 node 테스트에서 못 부른다
 * (`solutions.ts` / `solutions-io.ts` 를 가른 이유와 같다). 목록에 무엇이 보이는지는
 * 회귀가 잦은 규칙이라 여기 따로 둔다.
 */
import type { PaperOwnership } from './paper-owners';

/** 이 서비스가 올린 교재에 남기는 NGS extraInfo 태그 */
export const PAPER_APP_TAG = 'hicnc-penclass';

/**
 * 목록에 보일 교재만 골라낸다 — 순수 함수.
 *
 * NGS 계정은 여러 서비스(펜클래스 등)가 함께 쓴다. 하이씨앤씨 펜클래스 목록에는
 * **이 계정이 여기서 올린 교재만** 보여야 한다(사용자 요구 2026-09-04):
 *  1. 소유 기록(sp_paper_owners)이 있는 교재만. 소유 기록을 못 읽었으면(active=null)
 *     전체를 보여주던 옛 폴백을 버리고 **아무것도 보여주지 않는다** — 그 폴백이
 *     다른 서비스의 교재를 통째로 끌고 오는 구멍이었다.
 *  2. NGS extraInfo.app 이 다른 서비스로 찍힌 교재는 소유 기록이 있어도 뺀다.
 *
 * 화면에서 인라인으로 하던 걸 여기로 뺐다. 폴링 경로가 이 필터를 건너뛰고
 * 원본 목록을 그대로 그려서 **삭제한 교재가 5초 뒤 되살아나는** 사고가 났다.
 * 목록을 만드는 곳이 하나면 그런 우회가 안 생긴다.
 */
export function visiblePapers<
  T extends {
    id: number;
    status?: string | null;
    extraInfo?: Record<string, unknown> | null;
  },
>(list: T[], ownership: PaperOwnership): T[] {
  const active = ownership.active;
  if (active == null) return [];
  return list.filter(
    (p) =>
      p.status !== 'removed' &&
      active.has(p.id) &&
      !ownership.trashed.has(p.id) &&
      isOurPaper(p.extraInfo),
  );
}

/**
 * 이 서비스가 만든 교재인가 — NGS extraInfo 의 앱 태그로 가른다.
 *
 * 태그가 **있어야** 통과한다. NGS 계정을 여러 서비스가 공유하고 DB 도 함께 쓰므로,
 * 지트 계정으로 로그인하면 소유 필터만으로는 그쪽 교재가 딸려 온다
 * (사용자 요구 2026-09-04: "하이씨앤씨 펜클래스에서 만든 교재만 노출"). 이 서비스의
 * 업로드는 전부 태그를 남기고(`claimPaper` 이전 `uploadPdf`), 태그 없는 교재는
 * 다른 서비스가 만든 것이다.
 */
export function isOurPaper(
  extraInfo: Record<string, unknown> | null | undefined,
): boolean {
  return extraInfo?.app === PAPER_APP_TAG;
}
