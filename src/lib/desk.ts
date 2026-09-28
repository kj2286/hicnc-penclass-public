/**
 * 하이씨앤씨 펜클래스 PC 프로그램(Tauri) 브리지.
 *
 * PC 프로그램은 이 웹을 그대로 창에 띄운다(웹 전 기능 동작). 웹이 못 하는
 * 크래들 USB·펜 BLE 는 Rust 커맨드로 노출되고, 여기서 `window.__TAURI__`
 * (withGlobalTauri) 로 호출한다. 브라우저에서는 isDesk() = false.
 */
import type { Stroke } from '@/pen/live/model/stroke';

type TauriGlobal = {
  core: { invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> };
  /** 실시간 교실 모드가 쓰는 이벤트 채널. 구버전 앱에는 없을 수 있다. */
  event?: {
    listen: <T>(
      name: string,
      cb: (e: { payload: T }) => void,
    ) => Promise<() => void>;
  };
};

function tauri(): TauriGlobal | null {
  return (window as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;
}

/** PC 프로그램(하이씨앤씨 펜클래스) 안에서 실행 중인가 */
export function isDesk(): boolean {
  return tauri() != null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) throw new Error('PC 프로그램(하이씨앤씨 펜클래스)에서만 사용할 수 있습니다.');
  try {
    return await t.core.invoke<T>(cmd, args);
  } catch (e) {
    // 🚨 Tauri 는 Rust 의 Err(String) 을 **문자열 그대로** reject 한다. 화면들이
    // `e instanceof Error ? e.message : '기본 문구'` 로 받고 있어서 진짜 사유가
    // 통째로 버려졌다 — 프린터가 왜 연결이 안 되는지 화면엔 "프린터에 연결하지
    // 못했습니다." 만 뜨고 timeout/refused 는 사라졌다(2026-09-04 실사고).
    // 여기서 Error 로 감싸 모든 호출부가 사유를 그대로 받게 한다.
    if (e instanceof Error) throw e;
    const msg = typeof e === 'string' ? e : JSON.stringify(e);
    throw new Error(msg && msg !== '{}' ? msg : `${cmd} 호출에 실패했습니다.`);
  }
}

// ── Rust 커맨드 타입 (src-tauri 의 camelCase 직렬화와 1:1) ──

export type DeskSlot = {
  physicalSlot: number;
  port: string | null;
  model: string | null;
  macSuffix: string | null;
};

export type DeskCradle = {
  model: string;
  slots: DeskSlot[]; // 항상 10칸
  penCount: number;
};

export type DeskProbe = {
  modelName: string;
  /** 펜에 저장된 이름 — BLE 로 바꾼 이름이 여기 들어온다 (v0.2.9+) */
  subName?: string;
  fwVersion: string;
  macFull: string;
  diskTotalKb: number;
  diskFreeKb: number;
  offlineFiles: number;
  listTruncated: boolean;
};

export type DeskPull = {
  /** 웹 Stroke 와 동일 스키마 — 그대로 병합 저장에 넣는다 */
  strokes: Stroke[];
  notePairs: number;
  skippedRecords: number;
  rawDir: string;
};

/** 크래들·슬롯 발견 (포트 안 엶 — 폴링 안전) */
export function deskCradleSnapshot(): Promise<DeskCradle[]> {
  return invoke('cradle_snapshot');
}

/** 슬롯 상세 (모델·FW·전체 MAC·저장소·파일 수) */
export function deskCradleProbe(port: string): Promise<DeskProbe> {
  return invoke('cradle_probe', { port });
}

/** 스캔에 잡힌 블루투스 펜 한 자루. `id` 로 연결한다(이름은 중복될 수 있다). */
export type BlePenAd = { id: string; name: string; rssi: number | null };

/**
 * 주변 블루투스 펜 목록 — **크래들 없이** 펜을 붙이기 위한 첫 단계
 * (사용자 요구 2026-08-17). PC 프로그램에서만 동작한다: 브라우저는
 * Web Bluetooth 가 필요한데 Tauri 웹뷰가 지원하지 않아 네이티브로 갔다.
 */
export function deskBleScanPens(secs?: number): Promise<BlePenAd[]> {
  return invoke('ble_scan_pens', { secs });
}

/**
 * 블루투스로 붙은 펜에서 필기를 가져온다. **펜의 데이터는 지우지 않는다** —
 * BLE 는 도중에 끊기기 쉬워서, 받고 지우다 끊기면 학생 필기가 영구히 사라진다.
 * 반환 형태는 크래들 경로와 같으므로 업로드·병합 로직을 그대로 쓴다.
 */
export function deskBlePullPen(id: string, label: string): Promise<DeskPull> {
  return invoke('ble_pull_pen', { id, label });
}

/** 슬롯 필기 수신 — 원본은 PC 문서 폴더에 덤프되고 웹 스트로크가 온다 */
export function deskCradlePull(
  port: string,
  slot: number,
  label: string,
): Promise<DeskPull> {
  return invoke('cradle_pull', { port, slot, label });
}

export type DeskErase = {
  deletedFiles: number;
  /** 0 이 아니면 일부가 남은 것 — 재시도 안내 필요 */
  remainingFiles: number;
};

/** 슬롯 펜의 오프라인 필기 파일 전체 삭제 — 되돌릴 수 없다. 확인은 호출 전 화면 책임. */
export function deskCradleErase(port: string): Promise<DeskErase> {
  return invoke('cradle_erase', { port });
}

/** BLE 펜 BT 이름 변경 (비밀번호 "0000"→"" 각 1회 제한) */
export function deskBleRename(macSuffix: string, newName: string): Promise<string> {
  return invoke('ble_rename', { macSuffix, newName });
}

/** 네이티브 인쇄 다이얼로그 — WKWebView 는 window.print() 미지원 (종이 인쇄용) */
export function deskPrint(): Promise<void> {
  return invoke('print_page');
}

/** PDF(base64)를 다운로드 폴더에 저장하고 파인더/탐색기에서 보여준다.
 *  웹뷰는 <a download> 를 처리하지 않아 파일 저장 경로가 이것뿐이다. */
export function deskSavePdf(fileName: string, base64: string): Promise<string> {
  return invoke('save_pdf', { fileName, base64 });
}

/** 오늘 수신 폴더 열기 */
export function deskOpenReceiveDir(): Promise<string> {
  return invoke('open_receive_dir');
}

// ── ncode PDF 바로 출력 (0.2.27, 2026-09-03) ──────────────────
// 프린터 IPP 엔드포인트에 직접 Print-Job — NGS 팀 실측(ipp-print.sh)대로
// printer-resolution 을 잡 속성으로 명시하고, 프린터가 기록한 해상도를 검증한다.

export type DeskPrinter = {
  name: string;
  host: string;
  address: string;
  port: number;
  /** ipp://<ip>:<port>/<rp> */
  uri: string;
  pdl: string;
};

export type DeskPrinterInfo = {
  uri: string;
  name: string;
  makeAndModel: string;
  state: number | null;
  stateText: string;
  resolutionsDpi: number[];
  documentFormats: string[];
  supportsPdf: boolean;
  supports1200: boolean;
};

export type DeskPrintResult = {
  jobId: number;
  requestedDpi: number;
  recordedDpi: number | null;
  /** 요청 해상도가 프린터 잡 레코드에 그대로 기록됐는가 */
  verified: boolean;
  jobState: number | null;
  jobStateText: string;
  note: string;
};

/** 네트워크(mDNS `_ipp._tcp`)에서 프린터 찾기 — secs 초 동안 */
export function deskPrintDiscover(secs = 5): Promise<DeskPrinter[]> {
  return invoke('print_discover', { secs });
}

/** OS 에 등록된 프린터 하나 (데스크 0.2.29+) */
export type DeskSystemPrinter = {
  name: string;
  /** OS 가 알려준 장치 주소 원문 (`ipp://…`, `usb://…`, `WSD-…`) */
  device: string;
  /** 직접 Print-Job 에 쓸 수 있는 주소. 빈 문자열이면 직접 출력 불가 */
  uri: string;
  /** dnssd 로 등록된 IPP 큐의 mDNS 서비스 이름. uri 가 비어 있어도 이 값이
   *  있으면 [네트워크 검색] 으로 IP 를 찾을 수 있다는 뜻(같은 서브넷일 때). */
  mdnsName: string;
  default: boolean;
};

/**
 * **이 PC 에 등록된 프린터** 목록. mDNS 가 막힌 망에서 두 번째 길이다.
 * 데스크 0.2.29 미만에서는 커맨드가 없어 거부되므로 호출부가 빈 목록으로 받는다.
 */
export function deskPrintSystemPrinters(): Promise<DeskSystemPrinter[]> {
  return invoke('print_system_printers', {});
}

/** 프린터 능력 조회 (1200dpi·PDF 지원 여부) */
export function deskPrintProbe(uri: string): Promise<DeskPrinterInfo> {
  return invoke('print_probe', { uri });
}

/** 프린터의 실제 작업 상태. 기록 소실은 출력 완료를 뜻하지 않는다. */
export type DeskJobStatus = {
  jobId: number;
  jobState: number | null;
  jobStateText: string;
  done: boolean;
  gone: boolean;
  impressionsCompleted: number | null;
  reasons: string[];
};

export function deskPrintJobStatus(uri: string, jobId: number): Promise<DeskJobStatus> {
  return invoke('print_job_status', { uri, jobId });
}

/** ncode PDF(url)를 내려받아 IPP 로 직접 출력 */
export function deskPrintNcode(args: {
  url: string;
  uri: string;
  dpi: 600 | 1200;
  copies?: number;
  jobName?: string;
}): Promise<DeskPrintResult> {
  return invoke('print_ncode', args);
}

// ── 학원 브랜딩(앱 아이콘) — B2B 화이트라벨 ──────────────────

/**
 * 학원 로고를 PC 앱 아이콘으로 적용한다.
 *
 * 원장님이 학원 설정에서 올린 로고를 그대로 쓴다. 창·작업표시줄 아이콘이 바뀌고,
 * 윈도우에서는 바탕화면·시작메뉴 **바로가기 아이콘**까지 다시 지정된다.
 * 적용 결과는 앱에 저장돼 다음 실행에도 유지된다.
 *
 * ⚠️ 설치파일 자체와 (맥) 응용프로그램 폴더 아이콘은 못 바꾼다 — 빌드 시점에
 *    구워지는 값이고, 맥은 번들을 고치면 코드 서명이 깨져 실행이 차단된다.
 *
 * 브라우저에서 부르면 조용히 넘어간다(앱이 아니면 할 일이 없다).
 */
export async function applyBrandIcon(logoUrl: string): Promise<void> {
  if (!isDesk() || !logoUrl) return;
  const res = await fetch(logoUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`로고를 내려받지 못했습니다 (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Tauri 는 Vec<u8> 를 숫자 배열로 받는다
  await invoke<void>('apply_brand_icon', { png: Array.from(buf) });
}

/** 브랜딩 해제 — 기본 하이씨앤씨 펜클래스 아이콘으로 되돌린다 */
export async function clearBrandIcon(): Promise<void> {
  if (!isDesk()) return;
  await invoke<void>('clear_brand_icon');
}

/**
 * **실시간 교실 모드** — 펜을 PC 에 붙여 두면 학생이 쓰는 대로 획이 올라온다.
 * 획이 완성될 때(펜을 뗄 때)마다 하나씩 오므로 체감 지연은 획 하나다.
 */
export function deskBleLiveStart(id: string): Promise<void> {
  return invoke('ble_live_start', { id });
}

/**
 * **배정된 MAC 으로** 실시간 연결. 선생님이 학생 관리에서 이미 배정했으므로
 * 라이브에서 다시 고를 필요가 없다. 스토어 키도 MAC 이라 배정이 그대로 붙는다.
 */
export function deskBleLiveStartMac(mac: string): Promise<void> {
  return invoke('ble_live_start_mac', { mac });
}

/** id 를 비우면 전부 중단 — 화면을 벗어날 때 쓴다. */
export function deskBleLiveStop(id?: string): Promise<void> {
  return invoke('ble_live_stop', { id });
}

/** 지금 붙어 있는 펜 목록 — 화면에 돌아왔을 때 상태를 복원한다. */
export function deskBleLiveActive(): Promise<string[]> {
  return invoke('ble_live_active');
}

/**
 * 실시간 획 구독. 해제 함수를 돌려준다.
 *
 * 이벤트 채널이 없는 **구버전 앱에서는 조용히 무동작**이다 — 여기서 던지면
 * 화면 전체가 죽는다. 기능이 안 보이는 편이 낫다.
 */
export async function onPenLiveStroke(
  cb: (penId: string, stroke: Stroke) => void,
): Promise<() => void> {
  const t = tauri();
  if (!t?.event) return () => {};
  return t.event.listen<{ penId: string; stroke: Stroke }>(
    'pen-live-stroke',
    (e) => cb(e.payload.penId, e.payload.stroke),
  );
}
