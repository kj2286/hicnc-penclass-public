import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PenController, VersionInfo } from '@/types/sdk';
import type { PenConnectionState } from '@/pen/connection/model/pen-connection-state';
import { penBus } from '@/lib/pen-event-bus';
import {
  disconnect as sdkDisconnect,
  getPenByMac,
  startScan,
  tryReconnectSaved,
} from '@/lib/pen-sdk-client';

type ConnectionActions = {
  scan: () => Promise<void>;
  /** 새로고침 후 이전 펜 자동 재연결 시도 (권한 유지 기기 대상, 제스처 불필요) */
  autoReconnect: () => Promise<boolean>;
  setConnecting: (deviceName?: string) => void;
  setHandshaking: (mac: string, deviceName?: string) => void;
  setNeedsPassword: (
    mac: string,
    controller: PenController,
    retry: number,
    reset: number,
  ) => void;
  setConnected: (mac: string, controller: PenController, info: VersionInfo) => void;
  setError: (reason: string) => void;
  reset: () => void;
  disconnect: () => void;
};

type ConnectionStore = {
  state: PenConnectionState;
  lastMac: string | null;
  lastDeviceName: string | null;
} & ConnectionActions;

const LAST_MAC_KEY = 'neo-smartpen.last-mac';
const LAST_NAME_KEY = 'neo-smartpen.last-device-name';

function loadLastMac(): { mac: string | null; name: string | null } {
  try {
    return {
      mac: window.localStorage.getItem(LAST_MAC_KEY),
      name: window.localStorage.getItem(LAST_NAME_KEY),
    };
  } catch {
    return { mac: null, name: null };
  }
}

function saveLastMac(mac: string, name: string | null) {
  try {
    window.localStorage.setItem(LAST_MAC_KEY, mac);
    if (name) window.localStorage.setItem(LAST_NAME_KEY, name);
  } catch {
    // ignore
  }
}

const initial = loadLastMac();

export const useConnectionStore = create<ConnectionStore>()(
  subscribeWithSelector((set, get) => ({
    state: { kind: 'Disconnected' },
    lastMac: initial.mac,
    lastDeviceName: initial.name,

    scan: async () => {
      set({ state: { kind: 'Scanning' } });
      try {
        await startScan();
      } catch (err) {
        set({
          state: {
            kind: 'ConnectionError',
            reason:
              err instanceof Error ? err.message : '스캔 중 오류가 발생했습니다.',
          },
        });
        return;
      }
      // startScan swallows user-cancel errors and resolves regardless.
      // If the state didn't transition (user cancelled picker), revert to Disconnected
      // after a short grace period to let async handshake events land first.
      setTimeout(() => {
        const s = get().state;
        if (s.kind === 'Scanning') {
          set({ state: { kind: 'Disconnected' } });
        }
      }, 500);
    },

    autoReconnect: async () => {
      const s = get();
      if (s.state.kind !== 'Disconnected') return false;
      set({
        state: { kind: 'Connecting', deviceName: s.lastDeviceName ?? undefined },
      });
      const ok = await tryReconnectSaved(s.lastDeviceName);
      if (!ok) {
        // 그 사이 settingInfo 로 Connected 가 됐을 수 있으니 확인 후 원복
        const cur = get().state;
        if (cur.kind === 'Connecting') set({ state: { kind: 'Disconnected' } });
      }
      return ok;
    },

    setConnecting: (deviceName) => set({ state: { kind: 'Connecting', deviceName } }),
    setHandshaking: (mac, deviceName) =>
      set({ state: { kind: 'Handshaking', mac, deviceName } }),

    setNeedsPassword: (mac, controller, retryCount, resetCount) =>
      set({
        state: { kind: 'NeedsPassword', mac, controller, retryCount, resetCount },
      }),

    setConnected: (mac, controller, info) => {
      saveLastMac(mac, info?.DeviceName ?? null);
      set({
        state: { kind: 'Connected', mac, controller, info },
        lastMac: mac,
        lastDeviceName: info?.DeviceName ?? null,
      });
    },

    setError: (reason) => set({ state: { kind: 'ConnectionError', reason } }),
    reset: () => set({ state: { kind: 'Disconnected' } }),

    disconnect: () => {
      const s = get().state;
      let controller: PenController | undefined;
      if (s.kind === 'Connected' || s.kind === 'NeedsPassword') {
        controller = s.controller;
      } else if (s.kind === 'Handshaking') {
        // Handshaking has mac but no controller reference yet. If we skip the
        // SDK disconnect, the pen will complete its handshake on its own and
        // flip the store back to Connected after the user already navigated
        // away (SDK's settingInfo event arrives post-cancel).
        controller = getPenByMac(s.mac);
      }
      if (controller) {
        try {
          sdkDisconnect(controller);
        } catch {
          // ignore
        }
      }
      set({ state: { kind: 'Disconnected' } });
    },
  })),
);

let wired = false;

export function wireConnectionBus() {
  if (wired) return;
  wired = true;

  penBus.on('passwordRequest', ({ mac, retryCount, resetCount }) => {
    const ctrl = getPenByMac(mac);
    if (!ctrl) return;
    useConnectionStore.getState().setNeedsPassword(mac, ctrl, retryCount, resetCount);
  });

  penBus.on('settingInfo', ({ mac, controller, versionInfo }) => {
    if (!versionInfo || !versionInfo.MacAddress) return;
    const current = useConnectionStore.getState().state;
    if (current.kind === 'Connected' && current.mac === mac) return;
    useConnectionStore.getState().setConnected(mac, controller, versionInfo);
  });

  penBus.on('penDisconnected', () => {
    useConnectionStore.getState().reset();
  });
}
