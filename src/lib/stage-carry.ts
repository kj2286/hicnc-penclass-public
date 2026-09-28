/**
 * **단계(1단계·2단계…) 이어받기.**
 *
 * 단계형 테스트지는 한 단계가 **두 쪽에 걸쳐 8문항**이다. 단계 제목은 첫 쪽에만
 * 인쇄돼 있어서, 둘째 쪽 문항은 인식 결과에 group 이 비고 라벨이 "5번" 이 된다.
 * 그 결과 단계마다 "5번"·"6번"… 이 겹쳐 리포트에서 같은 번호가 여러 번 나오고
 * (AI 코멘트까지 복제), 한 단계가 4문항으로 보였다 — 박다민A 실데이터로 확인
 * (314=1단계 1~4번, 315=5~8번, 316=2단계 1~4번, 317=5~8번 …, 2026-08-25).
 *
 * 그래서 **페이지 순서대로 훑으며 마지막으로 본 단계를 물려준다.**
 * 새 단계 제목이 나오면 그때 갈아탄다. 단계 표기가 아예 없는 교재(표지의
 * 계산력 등)는 물려줄 것이 없어 종전 그대로다.
 */
import type { ProblemCluster } from './problem-detect';

/** pageKey(`section_owner_noteId_pageNumber`) 에서 쪽 번호를 뽑는다.
 *  ncode 주소 자체에 순서가 들어 있으므로 **인덱스 로딩과 무관하게** 정렬된다 —
 *  실사고(2026-08-25): 페이지 인덱스가 아직 안 실려 정렬이 무력화되자
 *  객체 키 순서(319,318,317,314…)대로 이어받아 317 의 5~8번이 3단계로 붙었다. */
export function pageNoOfKey(pageKey: string): number {
  const parts = pageKey.split('_');
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/** 노트 id (`section_owner_noteId`) — 쪽 순서 비교의 기준 단위 */
export function noteOfKey(pageKey: string): string {
  return pageKey.split('_').slice(0, 3).join('_');
}

/** 문항 라벨 — 단계가 있으면 "1단계(기본)-3번" */
export function labelFor(group: string | undefined, no: number): string {
  const g = group?.trim();
  return g ? `${g}-${no}번` : `${no}번`;
}

/**
 * 페이지를 **순서대로** 넘기며 단계를 이어붙인다.
 * @param pages 페이지 순서(교재 안에서의 쪽 순서)대로 정렬된 [pageKey, clusters]
 * @returns 같은 형태 — group 과 label 이 보정된 클러스터
 */
export function carryStages(
  pages: ReadonlyArray<readonly [string, ProblemCluster[]]>,
  /** pageKey → 그 쪽에 **인쇄된 묶음 제목**(OCR). 문항에 group 이 없어도
   *  이 값이 있으면 그 쪽부터 그 제목으로 갈아탄다 — "계산력" 같은 표지 제목이
   *  문항 인식에 안 잡히는 경우를 메운다 (사용자 요구 2026-08-26). */
  headings?: Readonly<Record<string, string>>,
): Array<[string, ProblemCluster[]]> {
  // ⚠️ 호출부는 **한 교재(PDF) 안의 페이지만** 쪽 순서대로 넘겨야 한다.
  //    교재를 섞으면 표지(계산력)가 앞 교재의 마지막 단계를 물려받는다.
  //    (표지 쪽번호 321 > 문제지 319 라 그냥 붙이면 실제로 그렇게 된다.)
  let current = '';
  const out: Array<[string, ProblemCluster[]]> = [];
  for (const [key, clusters] of pages) {
    // 이 페이지에 **새 단계 제목**이 인쇄돼 있으면 거기서부터 갈아탄다
    const printed =
      clusters.find((c) => c.meta?.group?.trim())?.meta?.group?.trim() ||
      headings?.[key]?.trim();
    if (printed) current = printed;
    const fixed = clusters.map((c) => {
      if (c.meta?.no == null) return c;
      if (c.meta.group?.trim()) return c; // 제목이 붙은 문항은 그대로
      if (!current) return c; // 물려받을 단계가 없다 (표지의 계산력 등)
      return {
        ...c,
        label: labelFor(current, c.meta.no),
        meta: { ...c.meta, group: current },
      };
    });
    out.push([key, fixed]);
  }
  return out;
}
