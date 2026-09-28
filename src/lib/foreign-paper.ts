/**
 * 다른 서비스의 교재로 쓴 필기 걸러내기 — 순수 함수.
 *
 * 왜 필요한가: ncode 발급 서버(NGS)와 펜은 지트 펜클래스와 함께 쓴다. 그래서
 * **펜 메모리에 남아 있던 지트 교재 필기**가 크래들 수신 때 하이씨앤씨 펜클래스로 딸려
 * 들어온다(실사고 2026-09-07: 교재 2개만 만들었는데 학생 필기 기록에 8월 지트
 * 교재 4건이 떴다). 사용자 표현대로 "하이씨앤씨 펜클래스 데이터는 하이씨앤씨 펜클래스로 만든
 * 교재만" 나와야 한다.
 *
 * 판정 규칙:
 *  - 등록된 교재인데 **내 소유가 아니면** 버린다 → 다른 서비스 교재.
 *  - 교재를 못 찾은 페이지(연습장·미등록 노트)는 **남긴다** → 학생이 그냥 쓴 필기다.
 *  - 소유 목록을 못 읽었으면 **전부 남긴다**(fail-open). 조회 한 번 실패했다고
 *    학생 필기를 버리는 쪽이 훨씬 나쁘다 — 섞여 들어온 건 나중에 지울 수 있다.
 */

/** 획 하나에서 페이지를 가리키는 값만 */
export type PageAddressed = {
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
};

export function pageKeyOf(s: PageAddressed): string {
  return `${s.section}_${s.owner}_${s.noteId}_${s.pageNumber}`;
}

/** 페이지 키 → 그 페이지가 속한 교재 id (못 찾았으면 null) */
export type PaperIdByPage = ReadonlyMap<string, number | null>;

export type SplitResult<T> = {
  /** 저장할 획 */
  keep: T[];
  /** 다른 서비스 교재라 버린 획 */
  dropped: T[];
  /** 버려진 교재 id 들 — 로그·안내용 */
  foreignPdfIds: number[];
};

/**
 * 내 교재가 아닌 페이지의 획을 갈라낸다.
 *
 * @param myPdfIds 내가 만든 교재 id 집합. **null 이면 판단 불가** → 전부 남긴다.
 */
export function splitForeignStrokes<T extends PageAddressed>(
  strokes: readonly T[],
  paperIdByPage: PaperIdByPage,
  myPdfIds: ReadonlySet<number> | null,
): SplitResult<T> {
  if (myPdfIds == null) {
    return { keep: [...strokes], dropped: [], foreignPdfIds: [] };
  }
  const keep: T[] = [];
  const dropped: T[] = [];
  const foreign = new Set<number>();
  for (const s of strokes) {
    const pdfId = paperIdByPage.get(pageKeyOf(s)) ?? null;
    // 교재를 못 찾은 페이지는 연습장으로 보고 남긴다
    if (pdfId == null || myPdfIds.has(pdfId)) {
      keep.push(s);
      continue;
    }
    dropped.push(s);
    foreign.add(pdfId);
  }
  return { keep, dropped, foreignPdfIds: [...foreign].sort((a, b) => a - b) };
}
