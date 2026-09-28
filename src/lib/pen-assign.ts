/**
 * 펜 배정 통합 헬퍼 — "배정"은 한 개념만 존재한다.
 *
 * 어디서 바꾸든(펜 관리·학생 관리·실시간 라이브) 동일하게:
 *  1) 이전 사용 학생의 필기 세그먼트를 flush 저장(시간대 핸드오프)
 *  2) 교실 세션 배정(multipen store — 자동 저장 기준) 갱신
 *  3) sp_pens 영구 등록의 배정 학생(assigned_student_id)도 동기화 (best-effort)
 *
 * MAC 매칭: BLE/수동등록 표기가 달라도(콜론 유무·대소문자) 느슨하게 비교.
 */
import { requireSupabase } from '@/lib/supabase';
import { flushPenSave } from '@/lib/classroom-save';
import { useMultipenStore, normalizeMac } from '@/store/multipen.store';

/** 콜론·공백 제거 + 소문자 — 표기 차이를 무시한 MAC 비교 키 */
export { ambiguousPens, findPenByMac, looseMac } from './pen-mac';
import { looseMac } from './pen-mac';

async function syncPenRow(
  mac: string,
  studentId: string | null,
): Promise<void> {
  try {
    const supabase = requireSupabase();
    const { data: session } = await supabase.auth.getSession();
    const uid = session.session?.user.id;
    if (!uid) return;
    const { data } = await supabase
      .from('sp_pens')
      .select('id, mac')
      .eq('teacher_id', uid);
    const row = (data ?? []).find(
      (r) => looseMac(String(r.mac)) === looseMac(mac),
    );
    if (row) {
      await supabase
        .from('sp_pens')
        .update({ assigned_student_id: studentId })
        .eq('id', row.id);
    }
  } catch {
    // 영구 등록 동기화 실패는 세션 배정을 막지 않는다
  }
}

/**
 * 통합 배정/회수. student=null 이면 회수.
 * 이 학생이 다른 펜을 쓰고 있었으면 그 펜도 저장 마감 후 회수한다.
 */
export async function assignPenUnified(opts: {
  mac: string;
  penNumber: string;
  student: { studentId: string; studentName: string } | null;
}): Promise<void> {
  const { mac, penNumber, student } = opts;
  const store = useMultipenStore.getState();
  const key = normalizeMac(mac);
  const pen = store.pens[key];

  // 1) 이 펜의 이전 사용 학생 세그먼트 마감
  if (pen?.assignment && pen.assignment.studentId !== student?.studentId) {
    await flushPenSave(pen);
  }
  // 2) 새 학생이 이미 다른 펜을 쓰고 있었다면 그 펜 마감·회수(+영구 동기화)
  if (student) {
    const other = Object.values(store.pens).find(
      (p) =>
        normalizeMac(p.mac) !== key &&
        p.assignment?.studentId === student.studentId,
    );
    if (other) {
      await flushPenSave(other);
      useMultipenStore
        .getState()
        .setAssignment(other.mac, other.penNumber ?? '', null);
      await syncPenRow(other.mac, null);
    }
  }
  // 3) 세션 배정 갱신 (자동 저장 기준 시각 포함)
  useMultipenStore.getState().setAssignment(mac, penNumber, student);
  // 4) 영구 등록(sp_pens) 동기화
  await syncPenRow(mac, student?.studentId ?? null);
}

/**
 * 순차 연결 시 자동 등록 — sp_pens 에 같은 MAC 이 없으면 "펜 N" 으로 등록.
 * (펜 관리 목록·구독 관리와 즉시 연동되도록)
 */
export async function ensurePenRegistered(
  mac: string,
  penNumber: string,
): Promise<void> {
  try {
    const supabase = requireSupabase();
    const { data: session } = await supabase.auth.getSession();
    const uid = session.session?.user.id;
    if (!uid) return;
    const { data } = await supabase
      .from('sp_pens')
      .select('id, mac')
      .eq('teacher_id', uid);
    const exists = (data ?? []).some(
      (r) => looseMac(String(r.mac)) === looseMac(mac),
    );
    if (!exists) {
      await supabase
        .from('sp_pens')
        .insert({ teacher_id: uid, mac, name: `펜 ${penNumber}` });
    }
  } catch {
    // 자동 등록 실패는 연결 흐름을 막지 않는다 (수동 등록 가능)
  }
}
