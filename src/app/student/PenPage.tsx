/**
 * /s/pen — 스마트펜 연결.
 * 미연결: 안내 일러스트 + 펜 연결하기 버튼.
 * 연결됨: 펜 정보 카드 + 연결 해제 + 실시간 미리보기(현재 페이지 라이브 스트로크).
 */
import { useEffect, useRef, useState } from 'react';
import {
  Battery,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Info,
  PenLine,
  Radio,
} from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import { Switch } from 'seed-design/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/EmptyState';
import { PaperCanvas } from '@/pen/paper/PaperCanvas';
import { PasswordDialog } from '@/pen/password/PasswordDialog';
import { detectBrowserSupport } from '@/lib/browser-support';
import { startLiveShare } from '@/lib/live-stream';
import { recognizeImage } from '@/lib/api';
import { strokeBounds } from '@/pen/live/model/stroke';
import { renderStrokeGroupToPng } from '@/pen/live/model/stroke-image';
import { useConnectionStore } from '@/store/connection.store';
import { useSessionStore } from '@/store/session.store';
import { useSettingsStore } from '@/store/settings.store';
import { useStrokeStore, wireStrokePersistence } from '@/store/stroke.store';
import { NotebookBrowser, type BrowserPage } from '@/pen/live/NotebookBrowser';
import { isConnected } from '@/pen/connection/model/pen-connection-state';


export function PenPage() {
  const connState = useConnectionStore((s) => s.state);
  const scan = useConnectionStore((s) => s.scan);
  const autoReconnect = useConnectionStore((s) => s.autoReconnect);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const lastDeviceName = useConnectionStore((s) => s.lastDeviceName);

  // 새로고침 시 브라우저가 BLE 연결을 강제로 끊으므로, 진입 시 이전 펜에
  // 자동 재연결을 1회 시도한다 (권한 유지 기기 대상 — 실패해도 조용히 수동 버튼).
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    const st = useConnectionStore.getState();
    if (st.state.kind === 'Disconnected' && st.lastDeviceName) {
      void autoReconnect();
    }
  }, [autoReconnect]);

  const settingValues = useSettingsStore((s) => s.values);

  const selectedPageKey = useStrokeStore((s) => s.selectedPageKey);
  const currentPageKey = useStrokeStore((s) => s.currentPageKey);
  const livePages = useStrokeStore((s) => s.livePages);
  const byPage = useStrokeStore((s) => s.byPage);
  const selectPage = useStrokeStore((s) => s.selectPage);

  // 연결 미리보기용 OCR — 획이 멈추고 1.5초 뒤 현재 페이지 전체를 인식
  const [previewText, setPreviewText] = useState('');
  const [previewOcrBusy, setPreviewOcrBusy] = useState(false);
  const ocrTimerRef = useRef<number | null>(null);

  const [supportReason, setSupportReason] = useState<string | null>(null);
  const [btUsable, setBtUsable] = useState(true);

  // 선생님께 실시간 공유 (Mode A 원격 스트리밍)
  const profile = useSessionStore((s) => s.profile);

  // 노트 기록 영속화 — 연결 해제/새로고침 후에도 이전 노트를 볼 수 있다.
  useEffect(() => {
    if (profile?.id) wireStrokePersistence(profile.id);
  }, [profile?.id]);
  const [sharing, setSharing] = useState(false);
  const stopShareRef = useRef<(() => void) | null>(null);

  const toggleShare = (next: boolean) => {
    if (next) {
      if (!profile?.teacherId || !profile.id) return;
      stopShareRef.current = startLiveShare({
        teacherId: profile.teacherId,
        studentId: profile.id,
        studentName: profile.name || '학생',
      });
      setSharing(true);
    } else {
      stopShareRef.current?.();
      stopShareRef.current = null;
      setSharing(false);
    }
  };

  // 페이지 이탈 시 스트리밍 정리
  useEffect(
    () => () => {
      stopShareRef.current?.();
      stopShareRef.current = null;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    detectBrowserSupport()
      .then((s) => {
        if (cancelled) return;
        setSupportReason(s.reason ?? null);
        setBtUsable(s.hasBluetooth && s.isSecureContext);
      })
      .catch(() => {
        /* 감지 실패 시 버튼은 그대로 두고 브라우저에 맡긴다 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const connected = isConnected(connState);
  const busy =
    connState.kind === 'Scanning' ||
    connState.kind === 'Connecting' ||
    connState.kind === 'Handshaking';

  const activeKey = selectedPageKey ?? currentPageKey;
  const viewedPage = livePages.find((p) => p.key === activeKey) ?? null;
  const liveStrokes = activeKey ? (byPage[activeKey] ?? []) : [];
  const liveStrokeCount = liveStrokes.length;

  const browserPages: BrowserPage[] = livePages.map((p) => ({
    key: p.key,
    section: p.section,
    owner: p.owner,
    noteId: p.noteId,
    pageNumber: p.pageNumber,
    strokeCount: byPage[p.key]?.length ?? 0,
    updatedAt: p.updatedAt,
  }));

  // 획 변화 → 1.5초 디바운스 후 자동 인식 (연결 확인용 미리보기).
  // 미연결 상태에서 지난 노트를 열람할 때는 호출하지 않는다.
  useEffect(() => {
    if (ocrTimerRef.current) window.clearTimeout(ocrTimerRef.current);
    if (liveStrokeCount === 0 || !isConnected(useConnectionStore.getState().state)) {
      setPreviewText('');
      return;
    }
    ocrTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          setPreviewOcrBusy(true);
          const strokes = useStrokeStore.getState().byPage[activeKey ?? ''] ?? [];
          const bounds = strokeBounds(strokes);
          if (!bounds || strokes.length === 0) return;
          const { base64 } = await renderStrokeGroupToPng(strokes, bounds);
          const { text } = await recognizeImage(`data:image/png;base64,${base64}`);
          setPreviewText(text);
        } catch {
          /* 미리보기 인식 실패는 조용히 넘어간다 */
        } finally {
          setPreviewOcrBusy(false);
        }
      })();
    }, 1500);
    return () => {
      if (ocrTimerRef.current) window.clearTimeout(ocrTimerRef.current);
    };
  }, [liveStrokeCount, activeKey]);

  const battery =
    typeof settingValues.Battery === 'number' ? settingValues.Battery : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="rt-eyebrow mb-1.5">CONNECT</p>
          <h2 className="text-2xl font-bold text-ink">스마트펜 연결</h2>
          <p className="mt-1 text-sm text-ink-muted">
            펜의 전원을 켠 뒤 연결하면 실시간 필기와 저장된 노트를 불러올 수 있어요.
          </p>
        </div>
        {/* 선생님께 실시간 공유 — 타이틀 우측 끝 (담당 선생님이 있을 때만) */}
        {connected && profile?.teacherId && (
          <div className="flex shrink-0 items-center gap-2 rounded-lg border border-line-weak bg-layer-default px-3 py-2">
            <Radio
              size={15}
              className={sharing ? 'text-brand' : 'text-ink-subtle'}
            />
            <span className="text-sm font-semibold text-ink">
              선생님께 실시간 공유
            </span>
            {sharing && <Badge variant="success">공유 중</Badge>}
            <Switch
              checked={sharing}
              onCheckedChange={toggleShare}
              aria-label="선생님께 실시간 공유"
            />
          </div>
        )}
      </header>

      {supportReason && (
        <Callout
          tone="warning"
          title="이 브라우저에서는 펜을 연결할 수 없어요"
          description={supportReason}
        />
      )}

      {connState.kind === 'ConnectionError' && (
        <Callout
          tone="critical"
          title="연결에 실패했어요"
          description={connState.reason}
        />
      )}

      {!connected ? (
        <Card>
          <EmptyState
            illustration="pen"
            title="펜을 연결해주세요"
            description={
              <>
                <p>
                  버튼을 누르면 브라우저의 블루투스 장치 선택 창이 열려요. 펜
                  전원을 먼저 켜주세요.
                </p>
                {lastDeviceName && (
                  <p className="mt-2 text-xs text-ink-subtle">
                    최근 연결한 펜: {lastDeviceName}
                  </p>
                )}
              </>
            }
            action={
              <ActionButton
                variant="brandSolid"
                size="large"
                onClick={() => void scan()}
                loading={busy}
                disabled={!btUsable || busy}
              >
                {busy ? '연결 중이에요' : '펜 연결하기'}
              </ActionButton>
            }
          />
        </Card>
      ) : (
        <>
          {/* 펜 정보 카드 — 모델명 옆 배터리, 상세(펌웨어·MAC)는 정보 아이콘 hover */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
                <PenLine size={18} className="shrink-0 text-brand" />
                <span className="truncate">
                  {connState.info.DeviceName || '스마트펜'}
                </span>
                <BatteryIndicator level={battery} />
                <Badge variant="success">연결됨</Badge>
              </CardTitle>
              <div className="flex shrink-0 items-center gap-1">
                <PenDetailsHover
                  firmware={connState.info.FirmwareVersion || '알 수 없음'}
                  mac={connState.mac}
                />
                <ActionButton
                  variant="neutralOutline"
                  size="small"
                  onClick={() => disconnect()}
                >
                  연결 해제
                </ActionButton>
              </div>
            </CardHeader>
          </Card>
        </>
      )}

      {/* 필기 노트 — 노트(권)별로 몇 쪽까지 썼는지 보여주고 페이지별로
          열람한다. 노트를 바꿔 써도, 연결이 끊겨도 기록이 남는다. */}
      {(connected || livePages.length > 0) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>필기 노트</CardTitle>
              <p className="mt-0.5 text-xs text-ink-subtle">
                {connected
                  ? '연습장에 글을 써보세요 — 노트를 바꿔 써도 기록이 남아 언제든 다시 볼 수 있어요.'
                  : '최근에 쓴 노트 기록이에요. 펜을 연결하면 이어서 쓸 수 있어요.'}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {browserPages.length > 0 && (
              <NotebookBrowser
                pages={browserPages}
                currentPageKey={currentPageKey}
                selectedPageKey={activeKey}
                onSelectPage={selectPage}
              />
            )}
            {liveStrokes.length === 0 ? (
              <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-lg border border-line-weak bg-neutral-weak">
                <PenLine size={22} className="text-ink-subtle" />
                <p className="text-sm text-ink-muted">
                  펜으로 종이에 쓰면 여기에 바로 표시돼요.
                </p>
              </div>
            ) : (
              <div className="h-[480px] w-full">
                {/* 등록 교재(시험지)면 실제 문제지 배경 위에, 일반 연습장이면
                    줄노트 폴백 배경 위에 필기가 정위치로 얹힌다. */}
                <PaperCanvas
                  section={viewedPage?.section}
                  owner={viewedPage?.owner}
                  noteId={viewedPage?.noteId}
                  pageNumber={viewedPage?.pageNumber}
                  strokes={liveStrokes}
                  ruledFallback
                />
              </div>
            )}
            <div className="rounded-lg border border-line-weak bg-layer-fill px-4 py-3">
              <div className="mb-1 text-xs font-medium text-ink-subtle">
                인식된 글씨 {previewOcrBusy && '· 인식 중…'}
              </div>
              <div className="min-h-6 whitespace-pre-wrap text-sm text-ink">
                {previewText ||
                  (liveStrokes.length > 0
                    ? previewOcrBusy
                      ? ''
                      : '잠시 후 인식 결과가 표시됩니다.'
                    : '글씨를 쓰면 자동으로 인식해 보여드려요.')}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 펜 비밀번호가 설정된 경우 입력 다이얼로그 */}
      <PasswordDialog />
    </div>
  );
}

/** 모델명 옆 배터리 표시 — 잔량에 따라 아이콘·색이 달라진다. */
function BatteryIndicator({ level }: { level: number | null }) {
  if (level == null) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-ink-subtle">
        <Battery size={15} />
        확인 중
      </span>
    );
  }
  const Icon = level <= 20 ? BatteryLow : level <= 60 ? BatteryMedium : BatteryFull;
  const tone =
    level <= 20 ? 'text-critical' : level <= 60 ? 'text-ink-muted' : 'text-success';
  return (
    <span className={`flex items-center gap-1 text-xs font-semibold ${tone}`}>
      <Icon size={15} />
      {level}%
    </span>
  );
}

/** 연결 해제 왼쪽 정보 아이콘 — hover 시 펌웨어·MAC 주소만 보여준다. */
function PenDetailsHover({ firmware, mac }: { firmware: string; mac: string }) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-label="펜 상세 정보"
        className="rounded-md p-2 text-ink-subtle transition-colors hover:bg-neutral-weak hover:text-ink"
      >
        <Info size={16} />
      </button>
      <div className="pointer-events-none absolute right-0 top-full z-20 mt-1 w-60 rounded-lg border border-line-weak bg-layer-floating p-3 opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <dl className="space-y-2 text-xs">
          <div>
            <dt className="text-ink-subtle">펌웨어</dt>
            <dd className="mt-0.5 font-semibold text-ink">{firmware}</dd>
          </div>
          <div>
            <dt className="text-ink-subtle">MAC 주소</dt>
            <dd className="mt-0.5 font-mono font-semibold text-ink">{mac}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
