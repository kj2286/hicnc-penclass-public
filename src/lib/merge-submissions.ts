/**
 * **시험지 세트 합치기** — 표지(계산력)와 문제지가 별도 PDF 라 필기 기록이 두
 * 줄로 갈려 있던 것을 한 문서로 합친다 (사용자 요구 2026-08-25).
 *
 * 🚨 되돌릴 수 없다. 획을 한쪽으로 모으고 나머지 제출을 **삭제**한다.
 *    호출부에서 반드시 확인을 받은 뒤 부를 것.
 *
 * 앞으로 수신되는 필기는 `classroom-save` 가 세트 단위로 저장하므로 갈리지
 * 않는다 — 이 함수는 **그 전에 저장된 기록**을 정리하기 위한 것이다.
 */
import { deleteSubmission, type SubmissionRow } from '@/lib/api';
import { requireSupabase } from '@/lib/supabase';
import { downloadStrokes, strokesPath, uploadStrokes } from '@/lib/strokes-io';
import { examSetTitle } from '@/lib/exam-set';
import type { Stroke } from '@/pen/live/model/stroke';

/** 페이지 수 — 획이 놓인 서로 다른 ncode 페이지 개수 */
function countPages(strokes: readonly Stroke[]): number {
  const keys = new Set<string>();
  for (const s of strokes) {
    keys.add(`${s.section}_${s.owner}_${s.noteId}_${s.pageNumber}`);
  }
  return keys.size;
}

export type MergeSetResult = {
  order: string[];
  keptId: string;
  title: string;
  strokeCount: number;
  pageCount: number;
  removed: number;
};

/**
 * 같은 세트의 제출들을 하나로 합친다.
 * - 남길 문서 = **가장 먼저 만들어진 것**(원래 순서를 지킨다).
 * - 획은 id 기준 합집합 — 같은 획이 양쪽에 있어도 중복되지 않는다.
 * - AI 결과(채점·분석·리포트)는 합치지 않는다. 문항 구성이 달라지므로
 *   합친 뒤 **다시 채점·리포트 생성**해야 한다(호출부에서 안내).
 */
export async function mergeExamSet(
  studentId: string,
  subs: readonly SubmissionRow[],
  opts?: {
    /** 선생님이 정한 **순서 그대로** 합친다 — 앞에 둔 문제지가 앞 페이지가 된다.
     *  (사용자 요구 2026-08-25: "어떤 걸 먼저 줄지 순서를 바꿀 수 있게") */
    keepGivenOrder?: boolean;
    /** 합친 문서의 제목 — 없으면 세트 이름을 쓴다 */
    title?: string;
  },
): Promise<MergeSetResult> {
  if (subs.length < 2) throw new Error('합칠 기록이 2건 이상이어야 합니다.');
  const ordered = opts?.keepGivenOrder
    ? [...subs]
    : [...subs].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const keep = ordered[0];
  const rest = ordered.slice(1);

  // 1) 획 합집합
  const byId = new Map<string, Stroke>();
  for (const sub of ordered) {
    const list = await downloadStrokes(strokesPath(studentId, sub.id));
    for (const s of list) if (!byId.has(s.id)) byId.set(s.id, s);
  }
  const merged = [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);

  // 2) 남길 문서에 저장 — **DB 갱신 전에** 올린다(올리기 실패 시 원상 유지)
  await uploadStrokes(studentId, keep.id, merged);

  const title = (opts?.title?.trim() || examSetTitle(keep.title)).normalize('NFC');
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('sp_submissions')
    .update({
      title,
      stroke_count: merged.length,
      page_count: countPages(merged),
    })
    .eq('id', keep.id);
  if (error) throw new Error(`문서 갱신 실패: ${error.message}`);

  // 3) 나머지 제출 삭제 — 여기서 실패해도 남긴 문서는 이미 온전하다
  let removed = 0;
  for (const sub of rest) {
    await deleteSubmission(sub);
    removed += 1;
  }

  return {
    /** 합친 순서 — 화면이 페이지를 이 순서로 이어붙인다 */
    order: ordered.map((x) => x.title),
    keptId: keep.id,
    title,
    strokeCount: merged.length,
    pageCount: countPages(merged),
    removed,
  };
}
