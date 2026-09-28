/**
 * 학생 목록 정렬 규칙 — 순수 함수(supabase·React 없음, node 테스트가 그대로 부른다).
 *
 * 왜 생겼나: 크래들로 펜 데이터를 받은 직후 그 학생을 찾아야 하는데, 목록이
 * 등록순·이름순뿐이라 방금 올린 학생이 어디 있는지 훑어야 했다
 * (사용자 요구 2026-09-05: "학생의 펜 데이터를 넣었으면 이걸 찾기 쉬워야 한다").
 * 그래서 **최근 업로드순**을 넣고, 규칙을 화면 밖으로 빼 회귀를 막는다.
 */
import { kstDateKey, kstShortDate } from './kst';

export type StudentSortKey = 'upload' | 'recent' | 'name';

export const STUDENT_SORT_LABEL: Record<StudentSortKey, string> = {
  upload: '최근 업로드순',
  recent: '최신 등록순',
  name: '이름순',
};

type Sortable = { id: string; name: string; createdAt: string };

/**
 * 정렬. `lastUploadAt` 은 학생 id → 마지막 필기 업로드 시각(ISO).
 *
 * 'upload' 규칙: 업로드가 **있는 학생이 항상 위**에 오고 최근 순으로 줄을 선다.
 * 한 번도 안 올린 학생은 아래에 이름순으로 붙는다 — 목록에서 사라지면 안 되고,
 * 그렇다고 위에 섞이면 "방금 받은 학생" 을 찾는 목적이 무너진다.
 */
export function sortStudents<T extends Sortable>(
  list: readonly T[],
  key: StudentSortKey,
  lastUploadAt: Readonly<Record<string, string | undefined>> = {},
): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name, 'ko');
  const out = [...list];
  if (key === 'name') return out.sort(byName);
  if (key === 'recent') {
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b));
  }
  return out.sort((a, b) => {
    const av = lastUploadAt[a.id];
    const bv = lastUploadAt[b.id];
    if (av && bv) return bv.localeCompare(av) || byName(a, b);
    if (av) return -1;
    if (bv) return 1;
    return byName(a, b);
  });
}

/**
 * 마지막 업로드 시각을 짧게 — 목록 행에 그대로 박는다.
 * 오늘·어제는 말로, 그 안쪽 일주일은 "n일 전", 그보다 오래면 날짜.
 * 기준은 **한국 날짜**다(ISO 를 그냥 자르면 자정 이후 하루 어긋난다).
 */
export function uploadAgoLabel(
  iso: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const dayOf = (ms: number) => kstDateKey(ms);
  const today = dayOf(now);
  const that = dayOf(t);
  if (that === today) return '오늘';
  const DAY = 86400000;
  for (let i = 1; i <= 7; i += 1) {
    if (that === dayOf(now - i * DAY)) return i === 1 ? '어제' : `${i}일 전`;
  }
  return kstShortDate(iso);
}
