import { create } from 'zustand';
import type { VersionInfo } from '@/types/sdk';
import { penBus } from '@/lib/pen-event-bus';

type PenStore = {
  versionInfo: VersionInfo | null;
  settings: unknown | null;
  lastError: string | null;
  setVersionInfo: (info: VersionInfo | null) => void;
  setSettings: (s: unknown | null) => void;
  setError: (msg: string | null) => void;
  reset: () => void;
};

export const usePenStore = create<PenStore>((set) => ({
  versionInfo: null,
  settings: null,
  lastError: null,
  setVersionInfo: (info) => set({ versionInfo: info }),
  setSettings: (s) => set({ settings: s }),
  setError: (msg) => set({ lastError: msg }),
  reset: () => set({ versionInfo: null, settings: null, lastError: null }),
}));

let wired = false;

export function wirePenBus() {
  if (wired) return;
  wired = true;

  penBus.on('settingInfo', ({ settings, versionInfo }) => {
    usePenStore.getState().setSettings(settings);
    if (versionInfo && versionInfo.MacAddress) {
      usePenStore.getState().setVersionInfo(versionInfo);
    }
  });

  penBus.on('illegalPassword0000', () => {
    usePenStore.getState().setError('비밀번호를 "0000"으로 설정할 수 없습니다.');
  });

  penBus.on('penDisconnected', () => {
    usePenStore.getState().reset();
  });
}
