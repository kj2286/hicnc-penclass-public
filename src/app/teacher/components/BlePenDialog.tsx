/**
 * **크래들 없이 블루투스로 펜을 직접 붙여 필기를 가져오는 다이얼로그.**
 *
 * 사용자 요구(2026-08-17): "크래들 연결 없이도 학생관리에서 직접 펜 연결하기 버튼 →
 * 거기서 펜 연결해서 데이터 들고올 수 있게."
 *
 * 크래들 경로와 **같은 저장 로직**(`mergeStrokesIntoStudentDay`)을 쓴다 — 어느 경로로
 * 받았든 학생의 (날짜, 교재) 묶음은 하나여야 한다. 워터마크도 공유해서 같은 필기를
 * 두 번 저장하지 않는다.
 *
 * 🚨 펜의 데이터는 지우지 않는다(네이티브가 읽기 전용으로 연다). BLE 는 도중에
 * 끊기기 쉬워서, 받고 지우다 끊기면 학생 필기가 영구히 사라진다.
 */
import { useState } from 'react';
import { Bluetooth, RefreshCcw } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { Skeleton } from '@seed-design/react';
import { type StudentRow } from '@/lib/api';
import { mergeStrokesIntoStudentDay } from '@/lib/classroom-save';
import {
  deskBleLiveStart,
  deskBlePullPen,
  deskBleScanPens,
  isDesk,
  type BlePenAd,
} from '@/lib/desk';
import { useMultipenStore } from '@/store/multipen.store';
import { penBus } from '@/lib/pen-event-bus';
import { hasSeenRecord, recordSeen, splitNewStrokes } from '@/lib/pen-seen';
import { TokenSelect } from './TokenSelect';
import { useToast } from './toast';

/** 펜별 수집 워터마크 — 크래들 화면과 **같은 키**를 써야 중복 저장이 막힌다. */
const WM_KEY = 'pc_desk_pen_watermarks_v1';
const loadWatermarks = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(WM_KEY) || '{}');
  } catch {
    return {};
  }
};
const saveWatermark = (key: string, ms: number) => {
  const m = loadWatermarks();
  if ((m[key] ?? 0) >= ms) return;
  m[key] = ms;
  localStorage.setItem(WM_KEY, JSON.stringify(m));
};

export function BlePenDialog({
  students,
  onClose,
  onSaved,
  mode = 'pull',
}: {
  students: StudentRow[];
  onClose: () => void;
  onSaved?: () => void;
  /**
   * `pull` = 펜에 쌓인 필기를 한 번 가져온다.
   * `live` = 붙여 둔 채로 쓰는 대로 화면에 띄운다(교실 모드).
   * 연결·선택 UI 가 완전히 같아서 한 컴포넌트로 둔다.
   */
  mode?: 'pull' | 'live';
}) {
  const setAssignment = useMultipenStore((s) => s.setAssignment);
  const toast = useToast();
  const [pens, setPens] = useState<BlePenAd[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pulling, setPulling] = useState<string | null>(null);
  const [studentId, setStudentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      setPens(await deskBleScanPens(6));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPens([]);
    } finally {
      setScanning(false);
    }
  };

  const pull = async (pen: BlePenAd) => {
    const student = students.find((s) => s.id === studentId);
    if (!student) {
      setError('먼저 학생을 고르세요 — 받은 필기를 누구 것으로 저장할지 정해야 합니다.');
      return;
    }
    setPulling(pen.id);
    setError(null);
    try {
      if (mode === 'live') {
        await deskBleLiveStart(pen.id);
        // 붙은 즉시 '연결됨' 으로 — 카드는 도트가 와야 뜨는데, 그러면 학생이
        // 쓰기 전까지 목록이 비어 보인다.
        penBus.emit('authorized', { mac: pen.id });
        // 배정 키는 **획을 올리는 키와 같아야** 카드에 학생 이름이 뜬다.
        setAssignment(pen.id, pen.name || '펜', {
          studentId: student.id,
          studentName: student.name,
        });
        toast(`${student.name} 펜을 실시간으로 연결했습니다`);
        onSaved?.();
        onClose();
        return;
      }
      const r = await deskBlePullPen(pen.id, student.name);
      const dots = r.strokes.reduce((a, s) => a + s.dots.length, 0);
      const lines = [
        `${pen.name}: 노트 ${r.notePairs}묶음 · 획 ${r.strokes.length} · dot ${dots}` +
          (r.skippedRecords > 0 ? ` · ⚠ 실패 ${r.skippedRecords}` : ''),
      ];
      if (r.strokes.length === 0) {
        lines.push('  └ 새 필기 없음');
      } else {
        // 새 필기 판별은 **획 id 우선** — 펜 시계가 늦어도 맞다(크래들과 동일).
        // 펜 개체 id 를 키로 쓴다: BLE 는 macOS 가 MAC 을 광고에서 숨긴다.
        let merged;
        if (hasSeenRecord(pen.id)) {
          const fresh = splitNewStrokes(pen.id, r.strokes);
          const now = Date.now();
          merged = fresh.length
            ? await mergeStrokesIntoStudentDay(
                student.id,
                fresh.map((st) => ({ ...st, receivedAt: now })),
                { collectedUntilMs: 0, receivedAtMs: now },
              )
            : [];
        } else {
          // 첫 수거 — 펜 시계가 12시간 이상 과거면 불신하고 수거일로 (크래들과 동일)
          const now2 = Date.now();
          const newest = r.strokes.reduce(
            (a, st) => Math.max(a, st.receivedAt ?? st.startedAt),
            0,
          );
          const rtcBroken = now2 - newest > 12 * 3600 * 1000;
          const wm = loadWatermarks()[pen.id] ?? 0;
          merged = await mergeStrokesIntoStudentDay(
            student.id,
            rtcBroken
              ? r.strokes.map((st) => ({ ...st, receivedAt: now2 }))
              : r.strokes,
            { collectedUntilMs: rtcBroken ? 0 : wm, receivedAtMs: now2 },
          );
        }
        recordSeen(pen.id, r.strokes);
        for (const m of merged) {
          lines.push(`  └ ${m.date} · ${m.title} 저장 (${m.pageCount}페이지)`);
        }
        const maxTs = r.strokes.reduce(
          (a, s) => Math.max(a, s.receivedAt ?? s.startedAt),
          0,
        );
        if (maxTs > 0) saveWatermark(pen.id, maxTs);
        toast(`${student.name} 필기를 저장했습니다`);
        onSaved?.();
      }
      setLog((l) => [...l, ...lines]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPulling(null);
    }
  };

  return (
    // 딤 없음 — 전 팝업 규칙(2026-08-18): 그림자만으로 구분, 뷰포트 중앙 고정
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="max-h-[86vh] w-full max-w-lg overflow-auto rounded-xl border border-line-weak bg-layer-default p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-ink">
              {mode === 'live' ? '펜 실시간 연결 (블루투스)' : '펜 직접 연결 (블루투스)'}
            </h3>
            <p className="mt-0.5 text-xs text-ink-subtle">
              {mode === 'live'
                ? '펜을 붙여 두면 학생이 쓰는 대로 화면에 나타납니다. 획이 끝날 때마다 올라옵니다.'
                : '크래들 없이 펜을 붙여 필기를 가져옵니다. 펜의 데이터는 지우지 않습니다.'}
            </p>
          </div>
          <ActionButton variant="neutralWeak" size="xsmall" onClick={onClose}>
            닫기
          </ActionButton>
        </div>

        {!isDesk() ? (
          <Callout
            tone="warning"
            description="블루투스 연결은 PC 프로그램에서만 됩니다. 브라우저는 펜에 직접 붙을 수 없어요."
          />
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-ink-muted">
                {mode === 'live' ? '이 펜을 쓰는 학생' : '받은 필기를 저장할 학생'}
              </label>
              <TokenSelect
                className="w-full"
                value={studentId}
                onValueChange={setStudentId}
              >
                <option value="">학생 선택</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </TokenSelect>
            </div>

            <ActionButton
              variant="brandSolid"
              size="medium"
              loading={scanning}
              onClick={() => void scan()}
            >
              <span className="inline-flex items-center gap-1.5">
                {pens ? <RefreshCcw size={15} /> : <Bluetooth size={15} />}
                {pens ? '다시 검색' : '펜 검색'}
              </span>
            </ActionButton>

            {error && <Callout tone="critical" description={error} />}

            {scanning && !pens && (
              <div className="space-y-2">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
                <p className="text-xs text-ink-subtle">
                  펜을 찾는 중… 펜 전원을 켜고 가까이 두세요.
                </p>
              </div>
            )}

            {pens?.length === 0 && !scanning && (
              <Callout
                tone="informative"
                description="펜을 찾지 못했습니다. 펜 전원이 켜져 있는지, 다른 기기(휴대폰 등)에 연결돼 있지 않은지 확인하세요."
              />
            )}

            {pens && pens.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-line-weak">
                {pens.map((p, i) => (
                  <div
                    key={p.id}
                    className={
                      'flex items-center gap-3 px-3 py-2.5' +
                      (i > 0 ? ' border-t border-line-weak' : '')
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {p.name || '(이름 없음)'}
                      </div>
                      <div className="text-xs text-ink-subtle">
                        {p.rssi === null ? '신호 세기 불명' : `신호 ${p.rssi}dBm`}
                      </div>
                    </div>
                    <ActionButton
                      variant="brandOutline"
                      size="xsmall"
                      loading={pulling === p.id}
                      disabled={!!pulling}
                      onClick={() => void pull(p)}
                    >
                      {mode === 'live' ? '실시간 연결' : '필기 가져오기'}
                    </ActionButton>
                  </div>
                ))}
              </div>
            )}

            {log.length > 0 && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-neutral-weak p-3 text-xs text-ink-muted">
                {log.join('\n')}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
