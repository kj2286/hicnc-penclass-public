/**
 * ncode PDF **바로 출력** 다이얼로그 (PC 앱 전용, 2026-09-03).
 *
 * 흐름: 프린터 찾기(mDNS, 5초) 또는 주소 직접 입력 → 능력 조회(1200dpi·PDF 지원)
 * → 해상도(교재 발급 DPI 기본)·매수 → [출력] → 결과(잡 번호·프린터가 기록한 해상도 검증).
 *
 * 왜 IPP 직접인가: NGS 팀 실측(2026-09-02) — CUPS/드라이버 큐를 거치면 1200dpi ncode 가
 * 600 으로 RIP 돼 펜이 못 읽는다. 프린터 IPP 엔드포인트에 해상도를 명시해 보내고,
 * 기록된 값이 다르면 그 출력물을 믿지 말라고 알려준다.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import {
  SegmentedControl,
  SegmentedControlItem,
} from 'seed-design/ui/segmented-control';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getPdfWithPages } from '@/lib/ngs-client';
import { markSendUnknown, markSubmitted, newJob } from '@/lib/print-jobs';
import { usePrintJobsStore } from '@/store/print-jobs.store';
import { useSessionStore } from '@/store/session.store';
import {
  deskPrintDiscover,
  deskPrintNcode,
  deskPrintProbe,
  deskPrintSystemPrinters,
  type DeskPrinter,
  type DeskSystemPrinter,
  type DeskPrinterInfo,
  type DeskPrintResult,
} from '@/lib/desk';

const LAST_PRINTER_KEY = 'penclass.desk.printer';

export type PrintTarget = { id: number; title: string; dpi: number | null };

export function NcodePrintDialog({
  target,
  onClose,
}: {
  target: PrintTarget | null;
  onClose: () => void;
}) {
  const open = target != null;
  const account = useSessionStore(s => s.profile?.id);
  const accountRef = useRef(account);
  useEffect(() => {
    if (accountRef.current !== account) {
      accountRef.current = account;
      setPhase('idle'); setResult(null); setError(null); onClose();
    }
  }, [account, onClose]);
  const [printers, setPrinters] = useState<DeskPrinter[]>([]);
  const [searching, setSearching] = useState(false);
  /** 이 PC 에 등록된 프린터 (0.2.29+) — mDNS 가 막힌 망의 두 번째 길 */
  const [osPrinters, setOsPrinters] = useState<DeskSystemPrinter[]>([]);
  const [osLoading, setOsLoading] = useState(false);
  const [osError, setOsError] = useState<string | null>(null);
  const [osOpen, setOsOpen] = useState(false);

  const findOsPrinters = async () => {
    setOsLoading(true);
    setOsError(null);
    setOsOpen(true);
    try {
      setOsPrinters(await deskPrintSystemPrinters());
    } catch (e) {
      setOsPrinters([]);
      // 0.2.29 미만이면 커맨드 자체가 없다 — 버전을 짚어 준다
      const msg = e instanceof Error ? e.message : String(e);
      setOsError(
        /not allowed|not found|unknown command/i.test(msg)
          ? '이 PC 프로그램에서는 프린터 목록을 읽을 수 없습니다. 최신 하이씨앤씨 펜클래스로 업데이트해 주세요.'
          : msg,
      );
    } finally {
      setOsLoading(false);
    }
  };
  const [uri, setUri] = useState('');
  const [info, setInfo] = useState<DeskPrinterInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [dpi, setDpi] = useState<600 | 1200>(1200);
  /** 교재가 발급된 DPI (상세에서 읽음) — 안내 문구용 */
  const [paperDpi, setPaperDpi] = useState<number | null>(null);
  const [copies, setCopies] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'printing'>('idle');
  const [result, setResult] = useState<DeskPrintResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** OS 큐가 직접 출력 안 되는 방식(dnssd 등)이어도, [네트워크 검색] 이 같은
   *  이름의 프린터를 이미 찾았다면 그 IP 로 대신 쓸 수 있다. */
  const matchedNetworkUri = (p: DeskSystemPrinter): string | null => {
    if (!p.mdnsName) return null;
    return printers.find((n) => n.name === p.mdnsName)?.uri ?? null;
  };

  const search = async () => {
    setSearching(true);
    try {
      const list = await deskPrintDiscover(5);
      setPrinters(list);
      // 지난번 프린터가 목록에 있으면 그대로, 없으면 첫 프린터
      setUri((cur) => {
        if (cur && list.some((p) => p.uri === cur)) return cur;
        return list[0]?.uri ?? cur;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '프린터를 찾지 못했습니다.');
    } finally {
      setSearching(false);
    }
  };

  // 열 때: 기본 해상도(교재 발급 DPI) + 지난 프린터 + 자동 탐색
  useEffect(() => {
    if (!target) return;
    setResult(null);
    setError(null);
    setInfo(null);
    setInfoError(null);
    setCopies(1);
    setDpi(target.dpi === 600 ? 600 : 1200);
    // 목록에는 발급 DPI 가 없다 — 상세를 읽어 교재가 발급된 해상도를 기본값으로 맞춘다
    if (target.dpi == null) {
      void getPdfWithPages(target.id)
        .then((d) => {
          const pg = d?.pages?.[0];
          const v = pg?.imprintDpi ?? pg?.dpi;
          if (v === 600 || v === 1200) {
            setDpi(v);
            setPaperDpi(v);
          }
        })
        .catch(() => {});
    } else {
      setPaperDpi(target.dpi);
    }
    let last = '';
    try {
      last = localStorage.getItem(LAST_PRINTER_KEY) ?? '';
    } catch {
      /* 저장소 차단 환경 */
    }
    setUri(last);
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  // 프린터가 정해지면 능력 조회
  useEffect(() => {
    if (!open || !uri.trim().startsWith('ipp')) {
      setInfo(null);
      return;
    }
    let alive = true;
    setProbing(true);
    setInfoError(null);
    deskPrintProbe(uri.trim())
      .then((i) => alive && setInfo(i))
      .catch((e) => {
        if (!alive) return;
        setInfo(null);
        setInfoError(e instanceof Error ? e.message : '프린터에 연결하지 못했습니다.');
      })
      .finally(() => alive && setProbing(false));
    return () => {
      alive = false;
    };
  }, [open, uri]);

  const print = async () => {
    if (!target || phase === 'printing') return;
    const ownerId = useSessionStore.getState().profile?.id;
    if (!ownerId) { setError('로그인 후 다시 출력해 주세요.'); return; }
    const u = uri.trim();
    if (!u.startsWith('ipp')) {
      setError('프린터를 고르거나 ipp://<IP>/ipp/print 주소를 넣어주세요.');
      return;
    }
    setError(null);
    setResult(null);
    setPhase('printing');
    const job = newJob({ pdfId: target.id, title: target.title || `교재 #${target.id}`, uri: u,
      printerName: printers.find(p => p.uri === u)?.name || osPrinters.find(p => p.uri === u)?.name || info?.name || '', dpi, copies });
    const jobs = usePrintJobsStore.getState();
    jobs.setOwner(ownerId);
    jobs.upsert(job, ownerId);
    try {
      const r = await deskPrintNcode({
        url: `${window.location.origin}/api/download-pdf?id=${target.id}&kind=ncoded`,
        uri: u,
        dpi,
        copies,
        jobName: `${target.title || `교재 #${target.id}`} ${dpi}dpi`,
      });
      if (useSessionStore.getState().profile?.id === ownerId) setResult(r);
      jobs.upsert(markSubmitted(job, r), ownerId);
      try {
        localStorage.setItem(LAST_PRINTER_KEY, u);
      } catch {
        /* 무시 */
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '출력에 실패했습니다.';
      const uncertain = markSendUnknown(job, message);
      if (useSessionStore.getState().profile?.id === ownerId) setError(uncertain.note);
      jobs.upsert(uncertain, ownerId);
    } finally {
      if (useSessionStore.getState().profile?.id === ownerId) setPhase('idle');
    }
  };

  const dpiWarn =
    info && dpi === 1200 && info.resolutionsDpi.length > 0 && !info.supports1200;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && phase !== 'printing' && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ncode 바로 출력</DialogTitle>
          <DialogDescription>
            {target?.title || (target ? `교재 #${target.id}` : '')} — 프린터에 직접
            보냅니다. ncode 는 실제 크기·지정 해상도로 인쇄돼야 펜이 읽습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {/* 프린터 */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-medium text-ink">프린터</span>
              <div className="flex items-center gap-1.5">
                <ActionButton
                  variant="neutralWeak"
                  size="small"
                  loading={osLoading}
                  onClick={() => void findOsPrinters()}
                >
                  {osLoading ? '읽는 중' : '이 PC 프린터'}
                </ActionButton>
                <ActionButton
                  variant="neutralWeak"
                  size="small"
                  loading={searching}
                  onClick={() => void search()}
                >
                  {searching ? '찾는 중 (5초)' : '네트워크 검색'}
                </ActionButton>
              </div>
            </div>
            {printers.length === 0 && !searching && (
              <p className="mb-1.5 text-xs text-ink-muted">
                네트워크 검색으로 IPP 프린터를 찾지 못했습니다. [이 PC 프린터] 로 이미
                설치된 프린터를 고르거나, 아래에 주소를 직접 넣어주세요(프린터 설정 화면의 IP).
              </p>
            )}
            <div className="space-y-1">
              {printers.map((p) => {
                const selected = p.uri === uri;
                return (
                  <button
                    key={p.uri}
                    type="button"
                    onClick={() => setUri(p.uri)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left ${
                      selected
                        ? 'border-brand bg-[#FFF3EF] text-ink'
                        : 'border-line-weak text-ink-muted hover:bg-neutral-weak'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                    <span className="shrink-0 text-xs text-ink-subtle">{p.address}</span>
                  </button>
                );
              })}
            </div>
            {osOpen && (
              <div className="mt-2 rounded-lg border border-line-weak p-2">
                <div className="mb-1.5 text-xs font-medium text-ink-muted">
                  이 PC 에 등록된 프린터
                </div>
                {osLoading ? (
                  <p className="text-xs text-ink-subtle">읽는 중…</p>
                ) : osError ? (
                  <p className="text-xs text-[#C0392B]">{osError}</p>
                ) : osPrinters.length === 0 ? (
                  <p className="text-xs text-ink-subtle">
                    이 PC 에 등록된 프린터가 없습니다. 운영체제 설정에서 먼저 프린터를
                    추가해주세요.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {osPrinters.map((p) => {
                      const usable = p.uri !== '';
                      const selected = usable && p.uri === uri;
                      return (
                        <button
                          key={`${p.name}|${p.device}`}
                          type="button"
                          disabled={!usable}
                          title={
                            usable
                              ? p.device
                              : matchedNetworkUri(p)
                                ? `${p.device} — [네트워크 검색] 에서 이 프린터를 찾았습니다. 눌러서 그 주소를 씁니다.`
                                : `${p.device} — 이 연결 방식은 바로 출력에 쓸 수 없습니다(네트워크 IPP 프린터만 가능). [네트워크 검색] 으로 다시 찾아보세요.`
                          }
                          onClick={() => {
                            if (usable) return setUri(p.uri);
                            const found = matchedNetworkUri(p);
                            if (found) setUri(found);
                          }}
                          className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs ${
                            selected
                              ? 'border-brand bg-[#FFF3EF] text-ink'
                              : usable
                                ? 'border-line-weak text-ink-muted hover:bg-neutral-weak'
                                : 'cursor-not-allowed border-line-weak text-ink-subtle opacity-60'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {p.name}
                            {p.default && (
                              <span className="ml-1 text-[10px] text-ink-subtle">기본</span>
                            )}
                          </span>
                          <span className="shrink-0 truncate text-[11px] text-ink-subtle">
                            {usable
                              ? p.uri.replace(/^ipp:\/\//, '')
                              : matchedNetworkUri(p)
                                ? '네트워크에서 찾음 · 눌러서 적용'
                                : '바로 출력 불가'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            <TextField label="프린터 주소 (직접 입력)" className="mt-2">
              <TextFieldInput
                value={uri}
                placeholder="ipp://192.168.0.10/ipp/print"
                onChange={(e) => setUri(e.currentTarget.value)}
              />
            </TextField>
            {/* 연결 상태 — 사용자 요구 2026-09-04: "프린터가 연결되면 연결됨 표시".
                예전엔 실패 사유만 회색 글씨로 흘려 연결됐는지 알 수 없었다. */}
            <div className="mt-1.5 min-h-6">
              {uri.trim().startsWith('ipp') ? (
                probing ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-weak px-2.5 py-1 text-xs text-ink-muted">
                    <span
                      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line-weak"
                      style={{ borderTopColor: 'var(--seed-color-bg-brand-solid, #F84A28)' }}
                    />
                    연결 확인 중…
                  </span>
                ) : info ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#E7F5EC] px-2.5 py-1 font-bold text-[#0F7B3F]">
                      <Check size={12} strokeWidth={3} /> 연결됨
                    </span>
                    <span className="text-ink-muted">
                      {[
                        info.name || info.makeAndModel || '프린터',
                        info.stateText,
                        info.resolutionsDpi.length
                          ? `지원 해상도 ${info.resolutionsDpi.join('/')}dpi`
                          : null,
                        info.supportsPdf ? 'PDF 지원' : 'PDF 미지원(드라이버 필요할 수 있음)',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#FDECEC] px-2.5 py-1 font-bold text-[#C0392B]">
                      <AlertCircle size={12} /> 연결 안 됨
                    </span>
                    <span className="text-ink-muted">
                      {infoError ?? '프린터에 연결하지 못했습니다.'} 같은 네트워크인지,
                      주소가 맞는지 확인해주세요.
                    </span>
                  </span>
                )
              ) : (
                <span className="text-xs text-ink-subtle">
                  프린터를 고르거나 주소를 넣으면 연결을 확인합니다.
                </span>
              )}
            </div>
          </div>

          {/* 해상도·매수 */}
          <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-end gap-3">
            <div>
              <div className="mb-1.5 font-medium text-ink">인쇄 해상도</div>
              <SegmentedControl
                value={String(dpi)}
                onValueChange={(v) => setDpi(v === '600' ? 600 : 1200)}
              >
                <SegmentedControlItem value="600">600 dpi</SegmentedControlItem>
                <SegmentedControlItem value="1200">1200 dpi</SegmentedControlItem>
              </SegmentedControl>
              <p className="mt-1 text-xs text-ink-subtle">
                교재를 발급한 DPI 와 같게 두세요{paperDpi ? ` (이 교재: ${paperDpi}dpi)` : ''}.
              </p>
            </div>
            {/* 매수 — grid 의 auto 열에서 폭이 눌려 숫자가 스피너에 가려졌다
                (사용자 신고 2026-09-04). 열 자체에 폭을 주고 입력은 채운다. */}
            <div className="w-24 shrink-0">
              <TextField label="매수">
                <TextFieldInput
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={50}
                  value={String(copies)}
                  onChange={(e) => {
                    const raw = e.currentTarget.value;
                    // 지우는 중(빈 문자열)에 1 로 튕기면 숫자를 못 바꾼다
                    if (raw === '') return setCopies(1);
                    const n = parseInt(raw, 10);
                    setCopies(Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 1);
                  }}
                  className="w-full"
                />
              </TextField>
            </div>
          </div>
          {dpiWarn && (
            <Callout
              tone="warning"
              description="이 프린터는 1200dpi 를 지원 목록에 올리지 않았습니다. 그래도 보낼 수는 있지만, 출력 뒤 확인 결과가 600 이면 펜이 못 읽을 수 있습니다."
            />
          )}

          {/* 결과 */}
          {phase === 'printing' && (
            <div className="flex items-center gap-2 text-ink-muted">
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-weak"
                style={{ borderTopColor: 'var(--seed-color-bg-brand-solid, #F84A28)' }}
              />
              PDF 를 내려받아 프린터로 보내는 중… (1200dpi 는 파일이 커서 1분쯤 걸릴 수 있어요)
            </div>
          )}
          {result && (
            <Callout
              tone={result.verified ? 'positive' : 'warning'}
              title={
                result.verified
                  ? `출력 접수 완료 — 잡 #${result.jobId} (${result.jobStateText})`
                  : `접수됐지만 해상도 확인 필요 — 잡 #${result.jobId}`
              }
              description={result.note}
            />
          )}
          {error && <Callout tone="critical" description={error} />}
        </div>
        <DialogFooter>
          <ActionButton variant="neutralWeak" disabled={phase === 'printing'} onClick={onClose}>
            닫기
          </ActionButton>
          <ActionButton
            variant="brandSolid"
            loading={phase === 'printing'}
            disabled={!uri.trim() || phase === 'printing'}
            onClick={() => void print()}
            data-testid="ncode-print-submit"
          >
            {result ? '한 번 더 출력' : '출력'}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
