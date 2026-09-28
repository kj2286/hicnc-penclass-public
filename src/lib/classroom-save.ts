/**
 * 교실 모드(직접 연결) 자동 저장.
 *
 * 저장 단위: **(학생, 날짜) 당 제출 1건** — 하루에 어떤 펜(들)으로 쓰든
 * 그 학생의 그날 필기는 한 문서로 합쳐진다(필기 기록에 날짜별 1개).
 * - 제목 "M월 D일 교실 필기", note_label "교실 필기".
 * - 병합: 업로드 전 기존 gz 를 내려받아 스트로크 id 로 유니온 —
 *   펜 로테이션으로 이전 펜의 스트로크가 세션에서 사라져도 유실되지 않는다.
 * - 시간대별 교체: 배정 sinceMs 이후 필기만 그 학생 몫(수신 시각 기준).
 * - RLS: supabase/010_classroom_save.sql (선생님 insert + 스토리지 쓰기) 필요.
 */
import { create } from 'zustand';
import { examSetTitle } from './exam-set';
import { kstDateKey, kstMonthDay } from './kst';
import { requireSupabase } from '@/lib/supabase';
import {
  downloadStrokes,
  uploadStrokes,
  uploadThumbnail,
  strokesPath,
} from '@/lib/strokes-io';
import { strokeBounds } from '@/pen/live/model/stroke';
import { renderStrokeGroupToPng } from '@/pen/live/model/stroke-image';
import type { Stroke } from '@/pen/live/model/stroke';
import { useMultipenStore, type LivePen } from '@/store/multipen.store';
import { lookupNcodeEntry } from '@/store/paper.store';
import { listMyPaperIds } from '@/lib/paper-owners';
import { pageKeyOf, splitForeignStrokes } from '@/lib/foreign-paper';

export type SaveStatus =
  | { state: 'saving' }
  | { state: 'saved'; at: number; strokeCount: number }
  | { state: 'error'; message: string };

type SessionRec = { submissionId: string; savedStrokeCount: number };

// v2: (학생|날짜) 키 — 구버전(pen 포함 키)과 충돌하지 않도록 키를 올린다
const SESSIONS_KEY = 'pc_classroom_sessions_v2';

const NOTE_LABEL = '교실 필기';

function loadSessions(): Record<string, SessionRec> {
  try {
    return JSON.parse(window.localStorage.getItem(SESSIONS_KEY) ?? '{}');
  } catch {
    return {};
  }
}
function saveSessions(map: Record<string, SessionRec>) {
  try {
    window.localStorage.setItem(SESSIONS_KEY, JSON.stringify(map));
  } catch {
    /* 프라이빗 모드 등 — 세션 내 메모리로만 동작 */
  }
}

/**
 * 문서의 하루 키 — **한국 시간 고정**.
 *
 * 로컬 시간을 쓰면 보는 사람의 PC 시간대에 따라 같은 필기가 다른 날짜로 잡힌다.
 * 학원 기준(KST)으로 고정해야 모든 계정에서 같은 문서에 모인다
 * (사용자 요구 2026-08-17).
 */
const dateKey = kstDateKey;

/** 벽시계 기준 스트로크 시각 — 펜 기기 시계(startedAt)가 어긋나도 안전하게
 *  PC 수신 시각(receivedAt)을 우선한다. (구버전 스냅샷 스트로크는 startedAt 폴백) */
function wallClockOf(s: Stroke): number {
  return s.receivedAt ?? s.startedAt;
}

/** 배정 시각 이후 + **오늘** 쓴(=이 학생의 오늘 몫) 스트로크만 추출.
 *  당일 필터가 없으면 배정이 자정을 넘길 때 어제 필기가 다음 날 문서로
 *  중복 저장된다 (교실 필기는 날짜 단위 문서). */
export function strokesForAssignment(pen: LivePen): Stroke[] {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const since = Math.max(pen.assignment?.sinceMs ?? 0, todayStart.getTime());
  const out: Stroke[] = [];
  for (const list of Object.values(pen.strokesByPage)) {
    for (const s of list) {
      if (wallClockOf(s) >= since && s.dots.length > 0) out.push(s);
    }
  }
  out.sort((a, b) => wallClockOf(a) - wallClockOf(b));
  return out;
}

/** 이 학생에게 배정된 모든 펜의 세그먼트 스트로크 합집합 (+ 관련 펜 mac 목록) */
function strokesForStudent(studentId: string): {
  strokes: Stroke[];
  macs: string[];
} {
  const pens = Object.values(useMultipenStore.getState().pens).filter(
    (p) => p.assignment?.studentId === studentId,
  );
  const strokes = pens.flatMap((p) => strokesForAssignment(p));
  strokes.sort((a, b) => wallClockOf(a) - wallClockOf(b));
  return { strokes, macs: pens.map((p) => p.mac) };
}

async function makeThumbnail(strokes: Stroke[]): Promise<Blob | null> {
  try {
    const bounds = strokeBounds(strokes);
    if (!bounds) return null;
    const { base64 } = await renderStrokeGroupToPng(strokes, bounds);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  } catch {
    return null; // 썸네일 실패는 저장을 막지 않는다
  }
}

/** 기존 저장분과 유니온(스트로크 id 기준) — 로테이션으로 세션에서 사라진
 *  이전 펜 스트로크를 덮어써서 잃지 않기 위한 핵심 안전장치. */
async function unionWithSaved(
  studentId: string,
  submissionId: string,
  current: Stroke[],
): Promise<Stroke[]> {
  let saved: Stroke[] = [];
  try {
    saved = await downloadStrokes(strokesPath(studentId, submissionId));
  } catch {
    /* 최초 저장 등 — 기존분 없음 */
  }
  const byId = new Map<string, Stroke>();
  for (const s of saved) byId.set(s.id, s);
  for (const s of current) byId.set(s.id, s);
  const merged = [...byId.values()];
  merged.sort((a, b) => wallClockOf(a) - wallClockOf(b));
  return merged;
}

function statsOf(strokes: Stroke[]) {
  const first = strokes[0];
  const last = strokes[strokes.length - 1];
  const pageKeys = new Set(
    strokes.map((s) => `${s.section}_${s.owner}_${s.noteId}_${s.pageNumber}`),
  );
  return {
    stroke_count: strokes.length,
    page_count: pageKeys.size,
    duration_ms: Math.max(0, wallClockOf(last) - wallClockOf(first)),
    written_from: new Date(wallClockOf(first)).toISOString(),
    written_to: new Date(wallClockOf(last)).toISOString(),
  };
}

/**
 * 학생 하나의 오늘 필기를 저장(생성 또는 병합 갱신).
 * 새 필기가 없으면 no-op. 결과를 SaveStatus 로 반환한다.
 */
export async function flushStudentSave(
  studentId: string,
): Promise<SaveStatus | null> {
  const { strokes: current, macs } = strokesForStudent(studentId);
  if (current.length === 0) return null;

  // 저장량 게이트 — 획 수가 그대로면 아무것도 안 한다 (10초 폴링 비용 방어)
  const key = `${studentId}|${dateKey(Date.now())}`;
  const sessions = loadSessions();
  const rec = sessions[key];
  if (rec && rec.savedStrokeCount === current.length) return null;

  const status = await (async (): Promise<SaveStatus> => {
    try {
      // **크래들 병합과 같은 경로** — ncode 페이지→PDF 매칭으로 (날짜×교재)
      // 문서에 넣는다. 예전에는 무조건 "M월 D일 교실 필기" 한 문서에 넣어서
      // **시험지 문서를 열면 라이브로 쓴 필기가 없었다**(2026-08-17 실사고:
      // "라이브까지는 잘 보이는데 해당 시험지에서 불러와지지 않는다").
      // 획 id 유니온이라 10초마다 다시 불러도, 나중에 크래들로 또 받아도
      // 중복되지 않는다.
      await mergeStrokesIntoStudentDay(studentId, current, {
        receivedAtMs: Date.now(),
      });
      sessions[key] = {
        submissionId: rec?.submissionId ?? 'paper-routed',
        savedStrokeCount: current.length,
      };
      saveSessions(sessions);
      return { state: 'saved', at: Date.now(), strokeCount: current.length };
    } catch (err) {
      return {
        state: 'error',
        message:
          err instanceof Error ? err.message : '자동 저장에 실패했습니다.',
      };
    }
  })();

  for (const mac of macs) useClassroomSaveStatus.getState().set(mac, status);
  return status;
}

/** 펜 기준 진입점 — 배정 학생의 (학생,날짜) 문서로 위임 (호출부 호환용) */
export async function flushPenSave(pen: LivePen): Promise<SaveStatus | null> {
  const studentId = pen.assignment?.studentId;
  if (!studentId) return null;
  return flushStudentSave(studentId);
}

// ── 외부 소스(크래들 수거 등) 필기 병합 저장 ────────────────────────────

/** 그 날짜의 (학생, 날짜) 교실 필기 문서 id — 없으면 새로 발급만 하고 알린다 */
async function resolveDaySubmissionId(
  studentId: string,
  dayMs: number,
  /** 교재 구분 태그(`pdf70` 등) + 문서 제목 — (날짜×교재) 당 문서 1건 */
  paperTag: string,
  title: string,
): Promise<{ submissionId: string; isNew: boolean }> {
  const key = `${studentId}|${dateKey(dayMs)}|${paperTag}`;
  const sessions = loadSessions();
  const rec = sessions[key];
  const supabase = requireSupabase();
  if (rec) {
    // 낡은 로컬 매핑 방어 — 선생님이 필기기록을 삭제했으면 행이 없다.
    // 그대로 update 하면 0행 갱신(무오류)으로 필기가 허공에 저장된다.
    const { data: alive } = await supabase
      .from('sp_submissions')
      .select('id')
      .eq('id', rec.submissionId)
      .maybeSingle();
    if (alive?.id) return { submissionId: rec.submissionId, isNew: false };
    delete sessions[key];
    saveSessions(sessions);
  }

  // 로컬 세션 맵에 없어도 DB 에 그 날·그 교재 문서가 있으면 재사용
  // ((날짜×교재) 당 1건 유지 — 제목이 교재명 역할을 한다)
  const dayStart = new Date(dayMs);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
  const { data: existing } = await supabase
    .from('sp_submissions')
    .select('id')
    .eq('student_id', studentId)
    .eq('note_label', NOTE_LABEL)
    .eq('title', title)
    .gte('created_at', dayStart.toISOString())
    .lt('created_at', dayEnd.toISOString())
    .limit(1)
    .maybeSingle();
  if (existing?.id) return { submissionId: existing.id, isNew: false };
  return { submissionId: crypto.randomUUID(), isNew: true };
}

export type MergeResult = {
  /** 필기가 쓰인 날짜 (YYYY-MM-DD) */
  date: string;
  /** 문서 제목 — 교재(PDF) 파일명, 미등록 페이지면 날짜 기반 폴백 */
  title: string;
  submissionId: string;
  /** 병합 후 문서의 전체 스트로크 수 */
  strokeCount: number;
  pageCount: number;
};

/**
 * 외부에서 확보한 필기(크래들 수거분 등)를 그 **필기가 쓰인 날짜**의
 * (학생, 날짜) 교실 필기 문서에 병합 저장한다.
 *
 * - 스트로크 id 로 유니온하므로 같은 필기를 두 번 수거해도 중복되지 않는다.
 * - 하루를 넘겨 수거해도 날짜별로 갈라서 각자의 문서에 들어간다.
 * - 라이브 자동 저장(flushStudentSave)과 같은 문서를 공유한다.
 * - **펜 RTC 방어**: `collectedUntilMs`(수집 워터마크) 이후의 새 획은 펜
 *   시계가 며칠 뒤처져 있어도 **수신일** 문서로 저장한다. 펜 시계를 그대로
 *   믿으면 방금 쓴 필기가 과거 날짜 문서에 묻힌다(2026-08-12 김경수 실사고
 *   — RTC 가 약 1.2일 뒤라 8/12 필기가 "8월 11일" 문서로 들어감).
 *   워터마크 0(첫 수거·미등록 펜)이면 기존 규칙(필기 시각) 유지 — 과거
 *   기록 전체가 오늘로 쏠리는 것을 막는다.
 */
/**
 * 내 교재 id 집합 — 저장할 때마다 조회하면 부담이라 60초 캐시.
 * 조회에 실패하면 null 을 돌려 **필터를 건너뛴다**(fail-open): 소유 목록을 못
 * 읽었다고 학생 필기를 버리면 복구가 어렵다.
 */
let myPaperCache: { at: number; ids: Set<number> | null } | null = null;

async function myPaperIdsCached(): Promise<Set<number> | null> {
  const now = Date.now();
  if (myPaperCache && now - myPaperCache.at < 60_000) return myPaperCache.ids;
  const ids = await listMyPaperIds().catch(() => null);
  myPaperCache = { at: now, ids };
  return ids;
}

/** 테스트·재로그인용 — 캐시를 비운다 */
export function resetMyPaperCache(): void {
  myPaperCache = null;
}

export async function mergeStrokesIntoStudentDay(
  studentId: string,
  incoming: Stroke[],
  opts?: { collectedUntilMs?: number; receivedAtMs?: number },
): Promise<MergeResult[]> {
  if (incoming.length === 0) return [];

  const receivedAt = opts?.receivedAtMs ?? Date.now();
  const watermark = opts?.collectedUntilMs ?? 0;

  // 교재 식별 — 획의 ncode 페이지가 어느 PDF 인지 조회(인덱스 localStorage
  // 캐시라 가볍다). 미등록 페이지(연습장 등)는 note 단위로 묶는다.
  const paperOf = new Map<string, { tag: string; title: string | null }>();
  for (const s of incoming) {
    const pk = `${s.section}_${s.owner}_${s.noteId}_${s.pageNumber}`;
    if (paperOf.has(pk)) continue;
    let val: { tag: string; title: string | null } = {
      tag: `note_${s.section}_${s.owner}_${s.noteId}`,
      title: null,
    };
    try {
      const e = await lookupNcodeEntry(s.section, s.owner, s.noteId, s.pageNumber);
      if (e?.pdfId != null) {
        val = { tag: `pdf${e.pdfId}`, title: e.pdfTitle ?? null };
      }
    } catch {
      /* 인덱스 실패 — note 폴백 */
    }
    paperOf.set(pk, val);
  }

  // 🚨 **다른 서비스 교재로 쓴 필기는 저장하지 않는다.** 펜과 ncode 서버를 지트
  // 펜클래스와 함께 쓰므로, 펜에 남아 있던 지트 교재 필기가 크래들 수신 때 그대로
  // 딸려 들어온다(실사고 2026-09-07). 교재를 못 찾은 페이지(연습장)는 남긴다.
  const pdfIdByPage = new Map<string, number | null>();
  for (const s of incoming) {
    const pk = pageKeyOf(s);
    if (pdfIdByPage.has(pk)) continue;
    const tag = paperOf.get(pk)?.tag ?? '';
    const m = /^pdf(\d+)$/.exec(tag);
    pdfIdByPage.set(pk, m ? Number(m[1]) : null);
  }
  const split = splitForeignStrokes(incoming, pdfIdByPage, await myPaperIdsCached());
  if (split.dropped.length > 0) {
    console.info(
      `[classroom-save] 다른 서비스 교재 필기 ${split.dropped.length}획을 건너뜁니다 ` +
        `(교재 ${split.foreignPdfIds.join(', ')}).`,
    );
  }
  incoming = split.keep;
  if (incoming.length === 0) return [];

  // (날짜 × 교재)별로 가른다 — 같은 날 여러 교재를 풀면 문서도 여러 개.
  // 날짜는 필기 시각(벽시계) 기준, 워터마크 이후 새 획은 수신일(RTC 방어).
  const byGroup = new Map<
    string,
    { dayMs: number; strokes: Stroke[]; title: string | null; tag: string }
  >();
  for (const s of incoming) {
    const ts = wallClockOf(s);
    const isNew = watermark > 0 && ts > watermark;
    const dayMs = isNew ? receivedAt : ts;
    const pk = `${s.section}_${s.owner}_${s.noteId}_${s.pageNumber}`;
    const paper = paperOf.get(pk) ?? { tag: 'note', title: null };
    // 🔑 **시험지 세트**로 묶는다 — 표지(계산력)와 문제지는 PDF 가 갈려 있어도
    // 한 시험이다(사용자 2026-08-25). 세트 표기가 없는 교재는 제목 그대로라
    // 종전과 같이 교재별 문서가 된다.
    const setTitle = paper.title ? examSetTitle(paper.title) : null;
    const groupTag = setTitle && setTitle !== paper.title ? `set:${setTitle}` : paper.tag;
    const k = `${dateKey(dayMs)}|${groupTag}`;
    const g =
      byGroup.get(k) ??
      { dayMs, strokes: [], title: setTitle ?? paper.title, tag: groupTag };
    g.strokes.push(s);
    byGroup.set(k, g);
  }

  // **노이즈 문서 방어** (2026-08-19 실사고: "8월 19일 교실 필기" 가 1획짜리
  // 점 하나로 생성돼 사용자가 "펜엔 없는데 왜 있냐" 고 혼란). 미등록 페이지
  // (교재 매핑 없음) 그룹이 **획 1개 + dot 몇 개**뿐이면 펜 끝이 스친 노이즈다
  // — 문서를 만들지 않는다. 진짜 필기는 같은 수거에서 획이 더 따라온다.
  // (라이브 10초 저장도 다음 flush 에 누적분이 오므로 잃지 않는다.)
  for (const [k, group] of [...byGroup]) {
    if (group.title != null) continue; // 교재 매핑된 그룹은 손대지 않는다
    const dots = group.strokes.reduce((a, s) => a + s.dots.length, 0);
    if (group.strokes.length === 1 && dots < 8) byGroup.delete(k);
  }

  const supabase = requireSupabase();
  const { data: session } = await supabase.auth.getSession();
  const teacherId = session.session?.user.id;
  if (!teacherId) throw new Error('로그인이 필요합니다.');

  const out: MergeResult[] = [];
  for (const [, group] of byGroup) {
    const { dayMs, strokes, tag } = group;
    const date = dateKey(dayMs);
    const d = new Date(dayMs);
    // NFC 정규화 — 맥 파일명(NFD)이 제목에 그대로 들어가 자소가 분해되어
    // 보이는 것 방지 (문서 재사용 조회의 title 비교에도 필수)
    const title = (
      group.title ?? `${kstMonthDay(d.getTime())} 교실 필기`
    ).normalize('NFC');
    const { submissionId, isNew } = await resolveDaySubmissionId(
      studentId,
      dayMs,
      tag,
      title,
    );
    const merged = await unionWithSaved(studentId, submissionId, strokes);

    await uploadStrokes(studentId, submissionId, merged);

    // **DB 행을 썸네일보다 먼저** 쓴다. 예전 순서(필기 → 썸네일 렌더 → DB)는
    // 획이 수백 개면 썸네일 그리는 몇 초~수십 초 동안 DB 에 기록이 없어서,
    // 그 사이 필기 기록을 열면 "업로드했는데 안 보인다" 가 된다
    // (2026-08-17 사용자 신고: 한참 후에야 나타남). 기록이 먼저 보이고
    // 썸네일은 뒤따라 채워지는 쪽이 맞다.
    const stats = statsOf(merged);
    if (isNew) {
      const { error } = await supabase.from('sp_submissions').insert({
        id: submissionId,
        student_id: studentId,
        teacher_id: teacherId,
        title,
        note_label: NOTE_LABEL,
        strokes_path: strokesPath(studentId, submissionId),
        thumbnail_path: null,
        created_at: new Date(dayMs).toISOString(),
        ...stats,
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from('sp_submissions')
        .update(stats)
        .eq('id', submissionId);
      if (error) throw new Error(error.message);
    }

    const thumb = await makeThumbnail(merged);
    if (thumb) {
      const thumbnail_path = await uploadThumbnail(studentId, submissionId, thumb);
      // 썸네일 갱신 실패는 치명적이지 않다 — 기록 자체는 이미 저장됐다
      await supabase
        .from('sp_submissions')
        .update({ thumbnail_path })
        .eq('id', submissionId);
    }

    // 다음 수거가 같은 (날짜×교재) 문서를 재사용하도록 세션 맵에 등록.
    const sessions = loadSessions();
    const key = `${studentId}|${date}|${tag}`;
    sessions[key] = {
      submissionId,
      savedStrokeCount: sessions[key]?.savedStrokeCount ?? 0,
    };
    saveSessions(sessions);

    out.push({
      date,
      title,
      submissionId,
      strokeCount: stats.stroke_count,
      pageCount: stats.page_count,
    });
  }
  return out;
}

// ── 저장 상태 스토어 + 전역 자동 저장 루프 ──────────────────────────────
// 선생님이 어느 페이지(학생 관리 등)에 있어도 배정된 펜의 필기가 저장되도록
// TeacherShell 에서 1회 wire 한다. LivePage 카드가 상태를 구독해 표시.

type SaveStatusStore = {
  byMac: Record<string, SaveStatus>;
  set: (mac: string, s: SaveStatus) => void;
};

export const useClassroomSaveStatus = create<SaveStatusStore>((set) => ({
  byMac: {},
  set: (mac, s) => set((st) => ({ byMac: { ...st.byMac, [mac]: s } })),
}));

let autoSaveTimer: number | null = null;
let flushing = false;

/** 배정된 모든 학생의 새 필기를 저장 (동시 실행 방지) */
export async function flushAllPens(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const pens = useMultipenStore.getState().pens;
    const studentIds = new Set<string>();
    for (const pen of Object.values(pens)) {
      // 학생 배정만 있으면 저장한다. 예전에는 penNumber 까지 요구했는데, BLE
      // 자동 연결 펜은 펜 번호가 없을 수 있어 **필기가 통째로 저장에서 빠졌다**
      // (2026-08-17 실사고: "라이브에서 쓴 게 학생 데이터에 저장이 안 된다").
      // 누구 필기인지는 assignment 가 정한다 — 펜 번호는 표시용일 뿐이다.
      if (pen.assignment) studentIds.add(pen.assignment.studentId);
    }
    for (const sid of studentIds) {
      await flushStudentSave(sid);
    }
  } finally {
    flushing = false;
  }
}

/** 교실 자동 저장 시작 (10초 주기, 중복 wire 안전) — TeacherShell 에서 호출 */
export function wireClassroomAutoSave(): void {
  if (autoSaveTimer != null) return;
  autoSaveTimer = window.setInterval(() => void flushAllPens(), 10_000);
}
