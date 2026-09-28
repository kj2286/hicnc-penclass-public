/**
 * 실시간 라이브 — 보기 전용.
 * 학생 관리에서 학생에게 배정한(그리고 지금 연결된) 펜만 자동으로 나타난다.
 * 연결·등록은 펜 관리에서, 배정·해제는 학생 관리에서 처리한다.
 * 두 가지 모드:
 *  - 교실 모드: 선생님 PC 에 펜을 직접 연결 (학생 관리/크래들에서 배정)
 *  - 원격 모드: 학생이 자기 기기에서 "선생님께 실시간 공유"를 켜면 스트리밍 수신
 *    (전송 계층 src/lib/live-stream.ts — Supabase Realtime 브로드캐스트)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BatteryLow, BatteryMedium, Bluetooth } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import {
  SegmentedControl,
  SegmentedControlItem,
} from 'seed-design/ui/segmented-control';
import { EmptyState } from '@/components/EmptyState';
import {
  isDesk,
  deskBleLiveActive,
  deskBleLiveStartMac,
  deskBleLiveStop,
  deskCradleSnapshot,
  onPenLiveStroke,
} from '@/lib/desk';
import { penBus } from '@/lib/pen-event-bus';
import { listMyStudents, type PenRow, type StudentRow } from '@/lib/api';
import { BlePenDialog } from '../components/BlePenDialog';
import { RemoteLiveView } from '../components/RemoteLiveView';
import { PaperCanvas } from '@/pen/paper/PaperCanvas';
import { NotebookBrowser, type BrowserPage } from '@/pen/live/NotebookBrowser';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '@/store/session.store';
import {
  useClassroomSaveStatus,
  type SaveStatus,
} from '@/lib/classroom-save';
import {
  useMultipenStore,
  wireMultipenBus,
  wireMultipenPersistence,
  type LivePen,
} from '@/store/multipen.store';
import { listMyPens } from '@/lib/api';
import { looseMac } from '@/lib/pen-assign';
import { localPenNumberOf } from '@/lib/pen-number-local';
import { formatRelative } from '../format';
import { capacityNotice, splitByCapacity } from '@/lib/live-capacity';
import { LiveOverflowList } from '../components/LiveOverflowList';

function formatSince(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const ampm = h < 12 ? '오전' : '오후';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hh}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function PenCard({
  pen,
  saveStatus,
}: {
  pen: LivePen;
  saveStatus?: SaveStatus;
}) {
  // 페이지 열람 — null 이면 펜의 실시간 위치를 따라간다.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const viewKey = pinnedKey ?? pen.currentPageKey;
  const strokes = viewKey ? pen.strokesByPage[viewKey] ?? [] : [];
  const page = pen.pages.find((p) => p.key === viewKey) ?? null;
  const battery = pen.batteryLevel;
  const browserPages: BrowserPage[] = pen.pages.map((p) => ({
    ...p,
    strokeCount: pen.strokesByPage[p.key]?.length ?? 0,
  }));

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line-weak bg-layer-default">
      <div className="flex items-center gap-2 border-b border-line-weak px-4 py-3">
        <span className="h-2 w-2 shrink-0 rounded-full bg-brand-solid" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink">
            {pen.penNumber ? `펜 ${pen.penNumber}` : pen.mac}
          </div>
          <div className="truncate text-xs text-ink-subtle">
            {pen.assignment
              ? `사용 학생: ${pen.assignment.studentName} · ${formatSince(pen.assignment.sinceMs)}부터`
              : '미배정 — 학생 관리에서 배정하세요'}
          </div>
        </div>
        {battery != null && (
          <span
            className={
              'inline-flex items-center gap-1 text-xs tabular-nums ' +
              (battery <= 20 ? 'text-critical' : 'text-ink-muted')
            }
          >
            {battery <= 20 ? <BatteryLow size={15} /> : <BatteryMedium size={15} />}
            {battery}%
          </span>
        )}
      </div>

      {browserPages.length > 0 && (
        <div className="border-b border-line-weak px-4 py-2.5">
          <NotebookBrowser
            compact
            pages={browserPages}
            currentPageKey={pen.currentPageKey}
            selectedPageKey={viewKey}
            onSelectPage={(k) =>
              setPinnedKey(k === pen.currentPageKey ? null : k)
            }
          />
        </div>
      )}

      <div className="h-72 bg-layer-fill">
        {strokes.length > 0 ? (
          // 등록 교재(시험지)면 실제 문제지 배경, 그 외에는 흰 배경(줄노트 폴백 없음)
          <PaperCanvas
            section={page?.section}
            owner={page?.owner}
            noteId={page?.noteId}
            pageNumber={page?.pageNumber}
            strokes={strokes}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-ink-subtle">
            펜으로 종이에 쓰면 여기 실시간으로 표시됩니다.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line-weak px-4 py-2.5 text-xs text-ink-subtle">
        <span>
          {page
            ? `노트 ${page.noteId} · ${page.pageNumber}쪽 보는 중`
            : '아직 필기한 페이지 없음'}
        </span>
        <span className="flex items-center gap-2">
          {saveStatus?.state === 'saving' && (
            <span className="text-ink-muted">저장 중…</span>
          )}
          {saveStatus?.state === 'saved' && (
            <span className="text-success">
              자동 저장됨 {formatSince(saveStatus.at)}
            </span>
          )}
          {saveStatus?.state === 'error' && (
            <span className="text-critical" title={saveStatus.message}>
              저장 실패
            </span>
          )}
          <span>
            {pen.lastSeenAt ? `마지막 활동 ${formatRelative(pen.lastSeenAt)}` : ''}
          </span>
        </span>
      </div>
    </div>
  );
}

/** 이 초를 넘기면 "오래 걸린다" 고 **크게** 알린다 — 펜 한 자루 대기(25초)보다 짧게. */
const SLOW_SYNC_SECS = 12;

/**
 * **PC 직결 라이브(BLE) 임시 중단** — 사용자 지시 2026-08-17.
 *
 * 자동 연결이 배정된 펜 전부를 순차로 붙잡는데, 그중에는 **크래들에 꽂혀 있는 펜**
 * 도 있다. BLE 가 물고 있으면 크래들 쪽에서 경고음이 났다. 연결 실패도 잦아
 * (전원 꺼진 펜마다 25초) 화면이 오류로 덮였다.
 *
 * 네이티브·브리지 코드는 그대로 두고 **입구만 닫는다** — 다시 열 때 이 상수만
 * true 로 되돌리면 된다. 재검토 항목: (1) 크래들에 꽂힌 펜은 건너뛰기,
 * (2) 자동이 아니라 선생님이 고른 펜만 붙이기, (3) 대기 시간 단축.
 */
const LIVE_BLE_ENABLED = false;

const formatElapsed = (sec: number): string =>
  sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초`;

export function LivePage() {
  const profile = useSessionStore((s) => s.profile);
  const pens = useMultipenStore((s) => s.pens);
  const setPenNumber = useMultipenStore((s) => s.setPenNumber);
  const setAssignment = useMultipenStore((s) => s.setAssignment);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [mode, setMode] = useState<'local' | 'remote'>('local');
  const [liveConnectOpen, setLiveConnectOpen] = useState(false);
  const [liveStudents, setLiveStudents] = useState<StudentRow[]>([]);

  /**
   * PC 직결 라이브 구독 — 네이티브가 올린 획을 **기존 도트 버스**로 흘린다.
   * 화면·스토어는 원격 모드와 같은 경로를 타므로 결과가 동일하다
   * (사용자 요구 2026-08-17: "라이브에서도 같은 결과가 나와야 한다").
   */
  useEffect(() => {
    if (!isDesk() || !LIVE_BLE_ENABLED) return;
    let off: (() => void) | null = null;
    let dead = false;
    // 원본 id 를 보존해 스토어에 직접 넣는다 — 도트 재조립(emitLiveStroke)은
    // id 를 새로 만들어 크래들 수거분과 중복됐다.
    void onPenLiveStroke((penId, stroke) =>
      useMultipenStore.getState().ingestStroke(penId, stroke),
    ).then(
      (u) => {
        if (dead) u();
        else off = u;
      },
    );
    return () => {
      dead = true;
      // **구독만 끊고 세션은 살려 둔다.** 예전에는 여기서 전부 중단했는데, 그러면
      // 크래들에 갔다 돌아올 때마다 처음부터 다시 붙어야 했다(사용자 지적
      // 2026-08-17: "이미 한번 됐으면 된거 아닌가"). 펜은 붙은 채로 두고
      // 돌아왔을 때 이어서 쓴다 — 중복 연결은 네이티브가 막는다.
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!isDesk() || !liveConnectOpen || liveStudents.length > 0) return;
    void listMyStudents()
      .then(setLiveStudents)
      .catch(() => {});
  }, [liveConnectOpen, liveStudents.length]);
  const navigate = useNavigate();

  // 저장 상태는 전역(TeacherShell 자동 저장 루프)에서 갱신 — 여기서는 구독만
  const saveStatus = useClassroomSaveStatus((s) => s.byMac);

  // 전역 와이어링은 TeacherShell 이 담당 — 직접 진입 대비 이중 안전망 (중복 안전)
  useEffect(() => {
    wireMultipenBus();
  }, []);
  useEffect(() => {
    if (profile?.id) wireMultipenPersistence(profile.id);
  }, [profile?.id]);

  // 등록된 영구 번호를 세션 스토어로 하이드레이션 — 라이브 직접 진입 시에도 "펜 N"
  const hydrateNumbers = useCallback(async () => {
    try {
      const registered = await listMyPens();
      const state = useMultipenStore.getState().pens;
      for (const reg of registered) {
        const n = reg.penNumber ?? localPenNumberOf(reg.mac);
        if (n == null) continue;
        const live = Object.values(state).find(
          (p) => looseMac(p.mac) === looseMac(reg.mac),
        );
        if (live && live.penNumber !== String(n)) {
          setPenNumber(live.mac, String(n));
        }
      }
      setMetaError(null);
    } catch (err) {
      setMetaError(
        err instanceof Error ? err.message : '펜 정보를 불러오지 못했습니다.',
      );
    }
  }, [setPenNumber]);

  useEffect(() => {
    void hydrateNumbers();
  }, [hydrateNumbers]);

  /**
   * **배정된 펜에 자동으로 붙는다.**
   *
   * 선생님은 학생 관리에서 펜을 배정하고 학생에게 건네준다 — 라이브에서 펜을
   * 다시 고르게 하는 건 같은 일을 두 번 시키는 것이다(사용자 지적 2026-08-17).
   * 배정된 MAC 으로 바로 연결하고, 배정도 같은 MAC 키로 스토어에 넣는다.
   * 그래야 `penList` 의 (assignment && connected) 조건을 통과해 카드가 뜬다.
   */
  const [autoState, setAutoState] = useState<{
    tried: number;
    ok: number;
    errors: string[];
  }>({ tried: 0, ok: 0, errors: [] });

  /**
   * 연결 진행 상황. **끝날 때만 알려주면 안 된다** — 펜 한 자루당 최대 25초가
   * 걸리고 순차로 붙이므로, 여러 자루면 몇 분간 화면이 아무 말도 안 하게 된다
   * (사용자 지적 2026-08-17: "동기화가 왜 이렇게 오래 걸리는지 모르겠다").
   * `startedAt` 으로 경과 시간을 재서 오래 걸리면 그 사실 자체를 크게 알린다.
   */
  const [connecting, setConnecting] = useState<{
    done: number;
    total: number;
    current: string;
    startedAt: number;
  } | null>(null);
  /** 경과 초 — 1초마다 갱신해 "멈춘 것처럼" 보이지 않게 한다. */
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!connecting) {
      setElapsed(0);
      return;
    }
    const t = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - connecting.startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(t);
  }, [connecting]);

  const autoConnect = useCallback(async () => {
    if (!isDesk()) return;
    let registered: PenRow[] = [];
    let students: StudentRow[] = [];
    try {
      [registered, students] = await Promise.all([listMyPens(), listMyStudents()]);
    } catch (err) {
      setAutoState({
        tried: 0,
        ok: 0,
        errors: [err instanceof Error ? err.message : '펜 목록을 불러오지 못했습니다.'],
      });
      return;
    }
    const nameOf = (id: string) => students.find((s) => s.id === id)?.name ?? '학생';

    // 이미 붙어 있는 펜은 다시 붙지 않는다 — 화면을 오갈 때마다 재연결하면
    // 자루당 수십 초가 통째로 낭비된다.
    const live = await deskBleLiveActive().catch(() => [] as string[]);
    const liveKeys = new Set(live.map((k) => looseMac(k)));

    // 🚨 **크래들에 꽂힌 펜은 건너뛴다.** BLE 가 물고 있으면 크래들에서 경고음이
    // 난다(사용자 신고 2026-08-17). 꽂혀 있는 동안은 크래들 경로가 정본이다.
    const docked = new Set<string>();
    try {
      for (const c of await deskCradleSnapshot()) {
        for (const slot of c.slots) {
          if (slot.macSuffix) docked.add(looseMac(slot.macSuffix));
        }
      }
    } catch {
      // 크래들 조회 실패는 치명적이지 않다 — 그냥 전부 후보로 둔다
    }
    const isDocked = (mac: string) => {
      const k = looseMac(mac);
      for (const d of docked) {
        if (d.length >= 6 && (k.endsWith(d) || d.endsWith(k))) return true;
      }
      return false;
    };

    const targets = registered.filter(
      (r) =>
        r.assignedStudentId &&
        !liveKeys.has(looseMac(r.mac)) &&
        !isDocked(r.mac),
    );
    if (targets.length === 0) {
      setAutoState({ tried: 0, ok: 0, errors: [] });
      return;
    }

    const errors: string[] = [];
    let ok = 0;
    const startedAt = Date.now();
    // 한 자루씩 — BLE 는 동시에 여러 개를 붙이면 스캔이 서로를 방해한다.
    // 그래서 느리다. 진행률을 **매 자루마다** 갱신해 사용자가 기다릴 수 있게 한다.
    for (let i = 0; i < targets.length; i += 1) {
      const reg = targets[i];
      const who = nameOf(reg.assignedStudentId!);
      setConnecting({ done: i, total: targets.length, current: who, startedAt });
      setAssignment(reg.mac, String(reg.penNumber ?? ''), {
        studentId: reg.assignedStudentId!,
        studentName: who,
      });
      try {
        await deskBleLiveStartMac(reg.mac);
        // 카드는 `assignment && connected` 를 요구하는데 connected 는 **도트가
        // 도착해야** 켜진다 — 그러면 학생이 쓰기 전까지 "표시할 펜이 없습니다" 로
        // 보인다(사용자 지적 2026-08-17). 붙은 즉시 연결됨으로 표시해
        // '필기 대기 중' 카드가 뜨게 한다.
        penBus.emit('authorized', { mac: reg.mac });
        ok += 1;
      } catch (err) {
        errors.push(`${who}: ${err instanceof Error ? err.message : String(err)}`);
      }
      // 한 자루라도 붙으면 바로 반영 — 전부 끝날 때까지 기다리게 하지 않는다.
      setAutoState({ tried: targets.length, ok, errors: [...errors] });
    }
    setConnecting(null);
    setAutoState({ tried: targets.length, ok, errors });
  }, [setAssignment]);

  // 교실 모드로 들어오면 바로 붙는다 — 선생님이 버튼을 찾을 필요가 없다.
  useEffect(() => {
    if (!isDesk()) return;
    if (!LIVE_BLE_ENABLED) {
      // 이전 세션이 붙잡고 있던 펜을 놓아준다 — 크래들 경고음의 원인이었다.
      void deskBleLiveStop().catch(() => {});
      return;
    }
    if (mode !== 'local') return;
    void autoConnect();
  }, [autoConnect, mode]);

  // 배정된(학생 관리) + 지금 연결된 펜만 자동 표시 — 해제되면 사라진다.
  const penList = useMemo(
    () =>
      Object.values(pens)
        .filter((p) => p.assignment && p.connected)
        .sort((a, b) => a.connectedAt - b.connectedAt),
    [pens],
  );

  // 라이브는 소규모용 — 캔버스는 정원까지만 그리고 나머지는 목록으로 둔다.
  // [보기] 로 고정한 펜은 접속 순서에 밀리지 않는다.
  const [pinnedMacs, setPinnedMacs] = useState<ReadonlySet<string>>(new Set());
  const { shown, overflow } = useMemo(
    () => splitByCapacity(penList, (p) => p.mac, pinnedMacs),
    [penList, pinnedMacs],
  );
  const notice = capacityNotice(penList.length);

  return (
    <div className="relative">
      {/* 사용자 지시(2026-08-17): 라이브는 안정화까지 개발 중으로 가린다.
          검은색 30% dim + 안내 카드. 아래 내용은 보이되 조작은 막는다. */}
      <div className="absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-black/30">
        <div className="mx-4 max-w-md rounded-xl bg-layer-default px-8 py-6 text-center shadow-xl">
          <h3 className="text-lg font-bold text-ink">실시간 라이브는 개발 중입니다</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            안정화 작업 중이라 잠시 닫아 두었습니다. 필기 수집은{' '}
            <strong className="font-semibold text-ink">[크래들 (PC)]</strong> 의 일괄
            수신을 이용해 주세요 — 학생별·시험지별 필기 기록에 동일하게 저장됩니다.
          </p>
        </div>
      </div>

    <div className="pointer-events-none select-none space-y-5" aria-hidden>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">실시간 라이브</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            {mode === 'local'
              ? '학생 관리·크래들에서 펜을 배정하면, 배정된 학생의 펜이 여기에 자동으로 나타납니다.'
              : '학생이 자기 기기에서 [선생님께 실시간 공유]를 켜면 여기에 실시간 필기가 나타납니다.'}
          </p>
        </div>
        {mode === 'local' && (
          <ActionButton
            variant="neutralOutline"
            onClick={() => navigate('/t/students')}
          >
            펜 배정은 학생 관리에서
          </ActionButton>
        )}
      </div>

      {isDesk() && mode === 'local' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-weak bg-layer-default px-4 py-3">
          <div className="min-w-0 flex-1 text-sm text-ink-muted">
            {autoState.tried === 0
              ? '학생 관리에서 펜을 배정하면 그 펜에 자동으로 연결합니다.'
              : `배정된 펜 ${autoState.tried}자루 중 ${autoState.ok}자루 연결됨 — 학생이 쓰는 대로 나타납니다.`}
          </div>
          <ActionButton
            variant="neutralOutline"
            size="small"
            onClick={() => void autoConnect()}
          >
            <span className="inline-flex items-center gap-1.5">
              <Bluetooth size={15} /> 배정 펜 다시 연결
            </span>
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            size="small"
            onClick={() => setLiveConnectOpen(true)}
          >
            직접 고르기
          </ActionButton>
        </div>
      )}

      {LIVE_BLE_ENABLED && connecting && (
        <div className="rounded-xl border-2 border-line-brand bg-layer-default px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-line-brand border-t-transparent" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-ink">
                펜 연결 중 {connecting.done + 1}/{connecting.total} —{' '}
                {connecting.current}
              </div>
              <div className="mt-0.5 text-xs text-ink-subtle">
                {formatElapsed(elapsed)} 경과 · 블루투스는 펜을 한 자루씩 붙이므로
                자루당 최대 25초가 걸립니다.
              </div>
            </div>
            <div className="text-sm font-bold text-brand">
              {autoState.ok}자루 연결됨
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-neutral-weak">
            <div
              className="h-full rounded-full bg-[var(--rt-point,#0071e3)] transition-all"
              style={{
                width: `${Math.round(((connecting.done + 1) / connecting.total) * 100)}%`,
              }}
            />
          </div>
          {elapsed >= SLOW_SYNC_SECS && (
            <p className="mt-2 text-xs font-semibold text-[#b45309]">
              ⚠ 예상보다 오래 걸리고 있습니다. 남은 {connecting.total - connecting.done - 1}
              자루까지 최대 {Math.ceil(((connecting.total - connecting.done) * 25) / 60)}분 더
              걸릴 수 있습니다 — 꺼져 있거나 다른 기기에 연결된 펜은 25초를 기다린 뒤
              넘어갑니다. 지금 안 쓰는 펜은 학생 관리에서 배정을 해제하면 빨라집니다.
            </p>
          )}
        </div>
      )}

      {LIVE_BLE_ENABLED && mode === 'local' && autoState.errors.length > 0 && (
        <Callout
          tone="warning"
          title={`펜 ${autoState.errors.length}자루에 연결하지 못했습니다 — 대개 전원이 꺼져 있거나 다른 앱이 붙잡고 있습니다`}
          description={
            // 자루마다 같은 긴 문구를 늘어놓으면 화면을 덮는다 — 이름만 먼저.
            autoState.errors.map((e) => e.split(':')[0]).join(', ') +
            ' — 해당 펜의 전원을 켜고 [배정 펜 다시 연결]을 누르세요.'
          }
        />
      )}

      {LIVE_BLE_ENABLED && liveConnectOpen && (
        <BlePenDialog
          mode="live"
          students={liveStudents}
          onClose={() => setLiveConnectOpen(false)}
        />
      )}

      <SegmentedControl
        value={mode}
        onValueChange={(v) => setMode((v as 'local' | 'remote') ?? 'local')}
        className="w-fit"
      >
        <SegmentedControlItem value="local">
          교실 모드 · PC 직접 연결
        </SegmentedControlItem>
        <SegmentedControlItem value="remote">
          원격 모드 · 학생 기기 스트리밍
        </SegmentedControlItem>
      </SegmentedControl>

      {mode === 'remote' ? (
        profile?.id ? (
          <RemoteLiveView teacherId={profile.id} />
        ) : (
          <div className="rounded-xl border border-line-weak bg-layer-default px-5 py-12 text-center text-sm text-ink-subtle">
            로그인 정보를 불러오는 중입니다…
          </div>
        )
      ) : (
        <>
        {metaError && (
          <Callout
            tone="neutral"
            description={`펜 등록 정보를 불러오지 못해 일부 펜이 MAC 주소로 표시될 수 있습니다. (${metaError})`}
          />
        )}

        {penList.length === 0 ? (
          <div className="rounded-xl border border-line-weak bg-layer-default">
            <EmptyState
              illustration="live"
              title="표시할 펜이 없습니다"
              description="학생 관리에서 학생에게 펜을 배정하면 배정된 학생의 펜이 자동으로 나타납니다."
              action={
                <ActionButton
                  variant="brandOutline"
                  size="small"
                  onClick={() => navigate('/t/students')}
                >
                  학생 관리로 이동
                </ActionButton>
              }
            />
          </div>
        ) : (
          <>
            {notice && (
              <Callout
                tone="warning"
                title={notice.title}
                description={notice.description}
              />
            )}
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {shown.map((p) => (
                <PenCard key={p.mac} pen={p} saveStatus={saveStatus[p.mac]} />
              ))}
            </div>
            <LiveOverflowList
              items={overflow.map((p) => ({
                key: p.mac,
                name: p.assignment
                  ? p.assignment.studentName
                  : p.penNumber
                    ? `펜 ${p.penNumber}`
                    : p.mac,
                detail: p.lastSeenAt
                  ? `마지막 활동 ${formatRelative(p.lastSeenAt)}`
                  : undefined,
              }))}
              onShow={(mac) =>
                // 고정하면 정원 안으로 들어온다 — 대신 안 고른 펜 하나가 목록으로 내려간다
                setPinnedMacs((prev) => new Set(prev).add(mac))
              }
            />
          </>
        )}
        </>
      )}
    </div>
    </div>
  );
}
