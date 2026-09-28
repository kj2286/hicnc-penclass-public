import mitt from 'mitt';
import type { PenController, SettingInfo, VersionInfo } from '@/types/sdk';

export type DotPayload = {
  mac: string;
  pageKey: string;
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
  x: number;
  y: number;
  pressure: number;
  maxPressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  dotType: number;
  timeStamp: number;
  timeDiff: number;
};

export type PasswordRequestPayload = {
  mac: string;
  retryCount: number;
  resetCount: number;
};

export type SettingInfoPayload = {
  mac: string;
  settings: SettingInfo | null;
  versionInfo: VersionInfo | null;
  controller: PenController;
};

export type SettingSetupSuccessPayload = {
  mac: string;
  settingType: number;
};

export type SettingSetupFailurePayload = {
  mac: string;
  errorCode: number;
};

export type LowBatteryPayload = {
  mac: string;
  batteryLevel: number;
};

export type PowerOffPayload = {
  mac: string;
  reason: number;
};

/**
 * Raw offline stroke delivered by `web_pen_sdk` on OFFLINE_DATA_SEND_SUCCESS.
 * Each stroke is `{ Dots: Dot[] }` where every Dot carries its own pageInfo
 * (section/owner/book/page), x/y (with fractional fx/fy), pressure (`f`),
 * timestamps, and dotType (0=DOWN, 1=MOVE, 2=UP).
 */
export type RawOfflineDot = {
  pageInfo?: {
    section?: number;
    owner?: number;
    book?: number;
    note?: number;
    page?: number;
  };
  x?: number;
  y?: number;
  f?: number;
  dotType?: number;
  DotType?: number;
  timeStamp?: number;
  timeDiff?: number;
  color?: number;
  penTipType?: number;
  angle?: { tx?: number; ty?: number; twist?: number };
};

export type RawOfflineStroke = {
  Dots?: RawOfflineDot[];
  // some SDK versions may use lower-case
  dots?: RawOfflineDot[];
};

export type OfflineNoteListEntry = {
  Section: number;
  Owner: number;
  Note: number;
};

export type OfflineNoteListPayload = {
  mac: string;
  notes: OfflineNoteListEntry[];
};

export type OfflinePageListPayload = {
  mac: string;
  section: number;
  owner: number;
  note: number;
  pages: number[];
};

export type OfflineSendProgressPayload = {
  mac: string;
  percent: number;
};

export type OfflineSendSuccessPayload = {
  mac: string;
  strokes: RawOfflineStroke[];
};

export type OfflineDeleteResponsePayload = {
  mac: string;
  result: boolean;
};

export type FirmwareProgressPayload = {
  mac: string;
  percent: number;
};

export type ProfileResponsePayload = {
  mac: string;
  profileType: number;
  args: unknown;
};

export type PenDisconnectedPayload = {
  mac: string;
};

export type RawMessagePayload = {
  mac: string;
  type: number;
  args: unknown;
};

export type Events = {
  dot: DotPayload;
  passwordRequest: PasswordRequestPayload;
  passwordSetupSuccess: { mac: string; isUsingPassword: boolean };
  passwordSetupFailure: { mac: string };
  illegalPassword0000: { mac: string };
  authorized: { mac: string };
  settingInfo: SettingInfoPayload;
  settingSetupSuccess: SettingSetupSuccessPayload;
  settingSetupFailure: SettingSetupFailurePayload;
  lowBattery: LowBatteryPayload;
  powerOff: PowerOffPayload;
  offlineNoteList: OfflineNoteListPayload;
  offlinePageList: OfflinePageListPayload;
  offlineSendStart: { mac: string };
  offlineSendProgress: OfflineSendProgressPayload;
  offlineSendSuccess: OfflineSendSuccessPayload;
  offlineSendFailure: { mac: string };
  offlineDeleteResponse: OfflineDeleteResponsePayload;
  firmwareProgress: FirmwareProgressPayload;
  firmwareSuccess: { mac: string };
  firmwareFailure: { mac: string };
  firmwareSuspend: { mac: string };
  profileResponse: ProfileResponsePayload;
  penDisconnected: PenDisconnectedPayload;
  raw: RawMessagePayload;
};

export const penBus = mitt<Events>();

// QA/디버그 훅 — 실펜 없이 dot 이벤트를 주입해 라이브 화면을 검증할 수 있다.
// (Playwright E2E 가 window.__penBus.emit('dot', …) 로 사용. 시크릿 아님)
if (typeof window !== 'undefined') {
  (window as unknown as { __penBus?: typeof penBus }).__penBus = penBus;
}

export function buildPageKey(
  section: number,
  owner: number,
  noteId: number,
  pageNumber: number,
): string {
  return `${section}_${owner}_${noteId}_${pageNumber}`;
}
