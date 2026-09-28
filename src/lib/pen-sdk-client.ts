import { PenHelper, PenMessageType } from 'web_pen_sdk';
import type { PenController, PenDotEvent, SettingInfo, VersionInfo } from '@/types/sdk';
import {
  buildPageKey,
  penBus,
  type OfflineNoteListEntry,
  type RawOfflineStroke,
} from './pen-event-bus';
import {
  applyCurrentNoiseFilterToController,
  applyNoiseFilterToController,
} from './noise-filter';

let initialized = false;

const ourDotHandler = (mac: string, dot: PenDotEvent) => emitDot(mac, dot);

export function bootstrapPenSdk() {
  if (initialized) return;
  initialized = true;

  // `web_pen_sdk` 0.8.0's PenHelper.handleDot contains a bug: on the first PEN_DOWN
  // it unconditionally runs `this.dotCallback = null`, diverting all subsequent dots
  // into an internal dotStorage and silently breaking live drawing.
  // Install dotCallback as an accessor property so the SDK's null assignment is
  // swallowed and our handler persists for the session.
  Object.defineProperty(PenHelper, 'dotCallback', {
    configurable: true,
    enumerable: true,
    get: () => ourDotHandler,
    set: () => {
      /* swallow — SDK 0.8.0 bug (PenHelper.js:95) */
    },
  });

  PenHelper.messageCallback = (mac: string, type: number, args: unknown) => {
    penBus.emit('raw', { mac, type, args });
    switch (type) {
      case PenMessageType.PEN_AUTHORIZED: {
        penBus.emit('authorized', { mac });
        // Post-authorization setup: mirror Flutter/sample behaviour so the pen
        // actually begins streaming pen-down / pen-move events.
        //  - RequestAvailableNotes(): tell the pen to send data for all notes.
        //    PenHelper.handleMessage already calls this with no-args right before us,
        //    but we call explicitly with all-undefined (= all notes) to be safe in
        //    case the SDK's internal call is reordered in future versions.
        //  - SetHoverEnable(false): disable hover mode so PEN_MOVE (not PEN_HOVER)
        //    is emitted when pen touches paper. Official sample enables hover to
        //    preview before pen-down; we prefer the Flutter app's default.
        const controller = findController(mac);
        if (controller) {
          try {
            controller.RequestAvailableNotes(
              undefined as unknown as number[],
              undefined as unknown as number[],
              null,
            );
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[pen-sdk-client] RequestAvailableNotes failed', err);
          }
          try {
            controller.SetHoverEnable(false);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[pen-sdk-client] SetHoverEnable failed', err);
          }
          // Apply the user's noise-filter choice to this pen's fresh SDK
          // DotFilter (created with the parser on connect, so only reachable now).
          applyCurrentNoiseFilterToController(controller);
        }
        break;
      }
      case PenMessageType.PEN_PASSWORD_REQUEST: {
        const a = (args ?? {}) as { RetryCount?: number; ResetCount?: number };
        penBus.emit('passwordRequest', {
          mac,
          retryCount: a.RetryCount ?? 0,
          resetCount: a.ResetCount ?? 0,
        });
        break;
      }
      case PenMessageType.PASSWORD_SETUP_SUCCESS: {
        const a = (args ?? {}) as { UsingPassword?: boolean };
        penBus.emit('passwordSetupSuccess', {
          mac,
          isUsingPassword: !!a.UsingPassword,
        });
        break;
      }
      case PenMessageType.PASSWORD_SETUP_FAILURE: {
        penBus.emit('passwordSetupFailure', { mac });
        break;
      }
      case PenMessageType.PEN_ILLEGAL_PASSWORD_0000: {
        penBus.emit('illegalPassword0000', { mac });
        break;
      }
      case PenMessageType.PEN_SETTING_INFO: {
        const controller = findController(mac);
        if (controller) {
          const versionInfo = safeRequestVersion(controller);
          penBus.emit('settingInfo', {
            mac,
            settings: (args ?? null) as SettingInfo | null,
            versionInfo,
            controller,
          });
        }
        break;
      }
      case PenMessageType.PEN_SETUP_SUCCESS: {
        // args shape per SDK: { SettingType: number } for a successful setting write.
        // Some SDK versions pass just the settingType number. Handle both.
        const settingType =
          typeof args === 'number'
            ? args
            : (args as { SettingType?: number } | null)?.SettingType ?? 0;
        penBus.emit('settingSetupSuccess', { mac, settingType });
        break;
      }
      case PenMessageType.PEN_SETUP_FAILURE: {
        const errorCode =
          typeof args === 'number'
            ? args
            : (args as { ErrorCode?: number } | null)?.ErrorCode ?? 0;
        penBus.emit('settingSetupFailure', { mac, errorCode });
        break;
      }
      case PenMessageType.EVENT_LOW_BATTERY: {
        const batteryLevel =
          typeof args === 'number'
            ? args
            : (args as { Battery?: number } | null)?.Battery ?? 0;
        penBus.emit('lowBattery', { mac, batteryLevel });
        break;
      }
      case PenMessageType.EVENT_POWER_OFF: {
        const reason =
          typeof args === 'number'
            ? args
            : (args as { Reason?: number } | null)?.Reason ?? 0;
        penBus.emit('powerOff', { mac, reason });
        break;
      }
      case PenMessageType.OFFLINE_DATA_NOTE_LIST: {
        const notes = (Array.isArray(args) ? args : []) as OfflineNoteListEntry[];
        penBus.emit('offlineNoteList', { mac, notes });
        break;
      }
      case PenMessageType.OFFLINE_DATA_PAGE_LIST: {
        const a = (args ?? {}) as {
          Section?: number;
          Owner?: number;
          Note?: number;
          Pages?: number[];
        };
        penBus.emit('offlinePageList', {
          mac,
          section: a.Section ?? 0,
          owner: a.Owner ?? 0,
          note: a.Note ?? 0,
          pages: Array.isArray(a.Pages) ? a.Pages : [],
        });
        break;
      }
      case PenMessageType.OFFLINE_DATA_SEND_START: {
        penBus.emit('offlineSendStart', { mac });
        break;
      }
      case PenMessageType.OFFLINE_DATA_SEND_STATUS: {
        const percent =
          typeof args === 'number'
            ? args
            : (args as { Percent?: number } | null)?.Percent ?? 0;
        penBus.emit('offlineSendProgress', { mac, percent });
        break;
      }
      case PenMessageType.OFFLINE_DATA_SEND_SUCCESS: {
        const strokes = (Array.isArray(args) ? args : []) as RawOfflineStroke[];
        penBus.emit('offlineSendSuccess', { mac, strokes });
        break;
      }
      case PenMessageType.OFFLINE_DATA_SEND_FAILURE: {
        penBus.emit('offlineSendFailure', { mac });
        break;
      }
      case PenMessageType.OFFLINE_DATA_DELETE_RESPONSE: {
        const a = (args ?? {}) as { Result?: boolean };
        penBus.emit('offlineDeleteResponse', { mac, result: !!a.Result });
        break;
      }
      case PenMessageType.PEN_FW_UPGRADE_STATUS: {
        const percent =
          typeof args === 'number'
            ? args
            : (args as { Progress?: number; Percent?: number } | null)?.Progress ??
              (args as { Percent?: number } | null)?.Percent ??
              0;
        penBus.emit('firmwareProgress', { mac, percent });
        break;
      }
      case PenMessageType.PEN_FW_UPGRADE_SUCCESS: {
        penBus.emit('firmwareSuccess', { mac });
        break;
      }
      case PenMessageType.PEN_FW_UPGRADE_FAILURE: {
        penBus.emit('firmwareFailure', { mac });
        break;
      }
      case PenMessageType.PEN_FW_UPGRADE_SUSPEND: {
        penBus.emit('firmwareSuspend', { mac });
        break;
      }
      case PenMessageType.PEN_PROFILE: {
        const a = (args ?? {}) as { Type?: number };
        penBus.emit('profileResponse', {
          mac,
          profileType: a.Type ?? 0,
          args,
        });
        break;
      }
      case PenMessageType.PEN_DISCONNECTED: {
        penBus.emit('penDisconnected', { mac });
        break;
      }
      default:
        break;
    }
  };
}

function safeRequestVersion(controller: PenController): VersionInfo | null {
  try {
    return controller.RequestVersionInfo() as VersionInfo;
  } catch {
    return null;
  }
}

function findController(mac: string): PenController | undefined {
  const pens = (PenHelper.pens ?? []) as unknown as PenController[];
  return pens.find((p) => p?.info?.MacAddress === mac);
}

/**
 * Diagnostic hook for verifying what section/owner/book/page values the pen
 * is actually emitting. Activate in DevTools Console:
 *   - `window.__penDebug = true`  — logs every incoming dot to console
 *   - `window.__penLastDot`       — always mirrors the most recent parsed dot
 *   - `window.__penLastPageInfo`  — always mirrors the most recent paper-info (DotType=4)
 * Production-safe: no-op until the flag is flipped, one object allocation per dot.
 */
declare global {
  interface Window {
    __penDebug?: boolean;
    __penLastDot?: unknown;
    __penLastPageInfo?: unknown;
  }
}

function emitDot(mac: string, dot: PenDotEvent) {
  const rawInfo = dot?.pageInfo ?? {};
  const section = rawInfo.section ?? dot?.section ?? 0;
  const owner = rawInfo.owner ?? dot?.owner ?? 0;
  const noteId = rawInfo.book ?? rawInfo.note ?? dot?.book ?? dot?.note ?? 0;
  const pageNumber = rawInfo.page ?? dot?.page ?? 0;

  // Drop dots whose pageInfo is not yet populated. SDK's this.current starts
  // at {-1,-1,-1,-1} before the first paper-info packet, so early pen-down
  // and hover dots can leak through with negative values. Also drop all-zero.
  if (section <= 0 && owner <= 0 && noteId <= 0 && pageNumber <= 0) return;

  const angle = dot?.angle ?? {};
  const dotType = (dot?.dotType ?? dot?.DotType ?? 0) as number;

  // Diagnostic capture — latest-only to avoid memory growth.
  if (typeof window !== 'undefined') {
    const snapshot = {
      section,
      owner,
      book: noteId,
      page: pageNumber,
      dotType,
      paperId: `${section}_${owner}_${noteId}`,
      rawPageInfo: rawInfo,
    };
    window.__penLastDot = snapshot;
    if (dotType === 4) window.__penLastPageInfo = snapshot;
    if (window.__penDebug) {
      // eslint-disable-next-line no-console
      console.debug('[penDebug]', snapshot);
    }
  }

  penBus.emit('dot', {
    mac,
    pageKey: buildPageKey(section, owner, noteId, pageNumber),
    section,
    owner,
    noteId,
    pageNumber,
    x: typeof dot.x === 'number' ? dot.x : 0,
    y: typeof dot.y === 'number' ? dot.y : 0,
    pressure: typeof dot.f === 'number' ? dot.f : 0,
    maxPressure: 852,
    tiltX: angle.tx ?? 0,
    tiltY: angle.ty ?? 0,
    twist: angle.twist ?? 0,
    dotType,
    timeStamp: dot?.timeStamp ?? 0,
    timeDiff: dot?.timeDiff ?? 0,
  });
}

export async function startScan(): Promise<void> {
  await PenHelper.scanPen();
}

/**
 * 새로고침 후 자동 재연결.
 *
 * Web Bluetooth 는 페이지를 떠나는 순간 GATT 연결을 강제로 끊는다(브라우저
 * 보안 정책 — 앱이 막을 수 없음). 대신 이전에 권한을 허용한 기기는
 * `navigator.bluetooth.getDevices()` 로 다시 얻을 수 있고, 사용자 제스처
 * 없이 연결을 시도할 수 있다 (Chrome 데스크톱/안드로이드).
 *
 * 성공 시 SDK 의 settingInfo 이벤트가 Connected 상태 전환을 트리거한다.
 * 기기가 꺼져 있거나 범위 밖이면 8초 타임아웃 후 false.
 */
export async function tryReconnectSaved(
  preferredName: string | null,
): Promise<boolean> {
  const bt = (
    navigator as {
      bluetooth?: { getDevices?: () => Promise<Array<{ name?: string }>> };
    }
  ).bluetooth;
  if (!bt?.getDevices) return false;
  try {
    const devices = await bt.getDevices();
    if (!devices || devices.length === 0) return false;
    const target =
      (preferredName && devices.find((d) => d.name === preferredName)) ??
      devices[0];
    if (!target) return false;
    const helper = PenHelper as unknown as {
      connectDevice: (d: unknown) => Promise<void>;
    };
    await Promise.race([
      helper.connectDevice(target),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('reconnect timeout')), 8000),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function disconnect(controller: PenController) {
  PenHelper.disconnect(controller);
}

/**
 * MAC 으로 원격 연결 해제 — 표기 차이(콜론·대소문자)를 무시하고 매칭.
 * @returns 해제 요청을 보냈으면 true, 연결된 컨트롤러가 없으면 false
 */
export function disconnectPenByMac(mac: string): boolean {
  const target = mac.toLowerCase().replace(/[^0-9a-f]/g, '');
  const pens = (PenHelper.pens ?? []) as unknown as PenController[];
  const controller = pens.find(
    (p) =>
      (p?.info?.MacAddress ?? '')
        .toLowerCase()
        .replace(/[^0-9a-f]/g, '') === target,
  );
  if (!controller) return false;
  PenHelper.disconnect(controller);
  return true;
}

export function getPenByMac(mac: string): PenController | undefined {
  return findController(mac);
}

export function isPenConnected(): boolean {
  return PenHelper.isConnected();
}

/** Apply the noise-filter on/off choice to every currently connected pen. */
export function applyNoiseFilterToConnectedPens(enabled: boolean): void {
  const pens = (PenHelper.pens ?? []) as unknown as PenController[];
  for (const p of pens) applyNoiseFilterToController(p, enabled);
}
