import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { PenController, SettingInfo } from '@/types/sdk';
import { penBus } from '@/lib/pen-event-bus';

export type SettingKey =
  | 'pressure'
  | 'autoPowerOff'
  | 'penCapPower'
  | 'autoPowerOn'
  | 'beep'
  | 'hover'
  | 'offlineSave'
  | 'ledColor'
  | 'diskReset';

export type SettingStatus = 'idle' | 'sending' | 'success' | 'failed';

export const KEY_TO_SETTING_TYPE: Record<SettingKey, number> = {
  autoPowerOff: 0x02,
  penCapPower: 0x03,
  autoPowerOn: 0x04,
  beep: 0x05,
  hover: 0x06,
  offlineSave: 0x07,
  ledColor: 0x08,
  pressure: 0x09,
  diskReset: 0x11,
};

const SETTING_TYPE_TO_KEY: Record<number, SettingKey> = {};
for (const [k, v] of Object.entries(KEY_TO_SETTING_TYPE)) {
  SETTING_TYPE_TO_KEY[v] = k as SettingKey;
}

const AUTO_CLEAR_MS = 2000;
const REQUEST_TIMEOUT_MS = 3000;

type SettingsValues = Partial<SettingInfo> & { LedColor?: number };

type SnapshotEntry = {
  prev: unknown;
  ackTimer: number | null;
  timeoutTimer: number | null;
};

type State = {
  values: SettingsValues;
  statuses: Record<SettingKey, SettingStatus>;
  pending: Partial<Record<SettingKey, SnapshotEntry>>;
  lastReadAt: number | null;
};

type Actions = {
  setValue: (
    controller: PenController,
    key: SettingKey,
    newValue: unknown,
  ) => void;
  triggerAction: (controller: PenController, key: SettingKey) => void;
  acknowledge: (settingType: number, success: boolean) => void;
  loadFromSettingInfo: (info: SettingInfo | null) => void;
  refresh: (controller: PenController) => void;
  reset: () => void;
};

type Store = State & Actions;

const initialStatuses = (): Record<SettingKey, SettingStatus> => ({
  pressure: 'idle',
  autoPowerOff: 'idle',
  penCapPower: 'idle',
  autoPowerOn: 'idle',
  beep: 'idle',
  hover: 'idle',
  offlineSave: 'idle',
  ledColor: 'idle',
  diskReset: 'idle',
});

export const useSettingsStore = create<Store>()(
  subscribeWithSelector(
    immer<Store>((set, get) => ({
      values: {},
      statuses: initialStatuses(),
      pending: {},
      lastReadAt: null,

      setValue: (controller, key, newValue) => {
        const field = valueFieldFor(key);
        const prev = field ? (get().values as Record<string, unknown>)[field] : undefined;
        // Optimistic update
        set((s) => {
          if (field) {
            (s.values as Record<string, unknown>)[field] = newValue;
          }
          s.statuses[key] = 'sending';
          // Clear any prior pending snapshot for this key
          const prior = s.pending[key];
          if (prior?.ackTimer != null) window.clearTimeout(prior.ackTimer);
          if (prior?.timeoutTimer != null) window.clearTimeout(prior.timeoutTimer);
          const timeoutTimer = window.setTimeout(() => {
            // Treat missing ack as failure
            get().acknowledge(KEY_TO_SETTING_TYPE[key], false);
          }, REQUEST_TIMEOUT_MS);
          s.pending[key] = { prev, ackTimer: null, timeoutTimer };
        });
        // Issue SDK call
        try {
          invokeSetter(controller, key, newValue);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[settings.store] invoke failed', key, err);
          get().acknowledge(KEY_TO_SETTING_TYPE[key], false);
        }
      },

      triggerAction: (controller, key) => {
        set((s) => {
          s.statuses[key] = 'sending';
          const prior = s.pending[key];
          if (prior?.ackTimer != null) window.clearTimeout(prior.ackTimer);
          if (prior?.timeoutTimer != null) window.clearTimeout(prior.timeoutTimer);
          const timeoutTimer = window.setTimeout(() => {
            get().acknowledge(KEY_TO_SETTING_TYPE[key], false);
          }, REQUEST_TIMEOUT_MS);
          s.pending[key] = { prev: undefined, ackTimer: null, timeoutTimer };
        });
        try {
          invokeAction(controller, key);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[settings.store] action failed', key, err);
          get().acknowledge(KEY_TO_SETTING_TYPE[key], false);
        }
      },

      acknowledge: (settingType, success) => {
        const key = SETTING_TYPE_TO_KEY[settingType];
        if (!key) return;
        set((s) => {
          const entry = s.pending[key];
          if (entry?.timeoutTimer != null) {
            window.clearTimeout(entry.timeoutTimer);
          }
          if (!success && entry) {
            // Rollback optimistic value
            const field = valueFieldFor(key);
            if (field) {
              (s.values as Record<string, unknown>)[field] = entry.prev;
            }
          }
          s.statuses[key] = success ? 'success' : 'failed';
          // Schedule auto-clear to idle
          const ackTimer = window.setTimeout(() => {
            useSettingsStore.setState((ss) => {
              if (ss.statuses[key] === 'success' || ss.statuses[key] === 'failed') {
                ss.statuses[key] = 'idle';
              }
              delete ss.pending[key];
            });
          }, AUTO_CLEAR_MS);
          s.pending[key] = { prev: entry?.prev, ackTimer, timeoutTimer: null };
        });
      },

      loadFromSettingInfo: (info) => {
        set((s) => {
          if (!info) return;
          // Mirror confirmed values from SDK
          s.values = { ...info } as SettingsValues;
          s.lastReadAt = Date.now();
        });
      },

      refresh: (controller) => {
        try {
          controller.RequestPenStatus();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[settings.store] RequestPenStatus failed', err);
        }
      },

      reset: () => {
        set((s) => {
          // Clear any pending timers
          for (const key of Object.keys(s.pending) as SettingKey[]) {
            const e = s.pending[key];
            if (e?.ackTimer != null) window.clearTimeout(e.ackTimer);
            if (e?.timeoutTimer != null) window.clearTimeout(e.timeoutTimer);
          }
          s.values = {};
          s.statuses = initialStatuses();
          s.pending = {};
          s.lastReadAt = null;
        });
      },
    })),
  ),
);

function valueFieldFor(key: SettingKey): keyof SettingsValues | null {
  switch (key) {
    case 'pressure': return 'PenSensitivity';
    case 'autoPowerOff': return 'AutoShutdownTime';
    case 'penCapPower': return 'PenCapPower';
    case 'autoPowerOn': return 'AutoPowerOn';
    case 'beep': return 'Beep';
    case 'hover': return 'HoverMode';
    case 'offlineSave': return 'UseOfflineData';
    case 'ledColor': return 'LedColor';
    case 'diskReset': return null;
  }
}

function invokeSetter(controller: PenController, key: SettingKey, value: unknown): void {
  switch (key) {
    case 'pressure':
      controller.SetSensitivity(value as number);
      return;
    case 'autoPowerOff':
      controller.SetAutoPowerOffTime(value as number);
      return;
    case 'penCapPower':
      controller.SetPenCapPowerOnOffEnable(value as boolean);
      return;
    case 'autoPowerOn':
      controller.SetAutoPowerOnEnable(value as boolean);
      return;
    case 'beep':
      controller.SetBeepSoundEnable(value as boolean);
      return;
    case 'hover':
      controller.SetHoverEnable(value as boolean);
      return;
    case 'offlineSave':
      controller.SetOfflineDataEnable(value as boolean);
      return;
    case 'ledColor':
      controller.SetColor(value as number);
      return;
    case 'diskReset':
      throw new Error('diskReset is an action; call triggerAction');
  }
}

function invokeAction(controller: PenController, key: SettingKey): void {
  switch (key) {
    case 'diskReset':
      controller.RequestInitPenDisk();
      return;
    default:
      throw new Error(`${key} is not an action`);
  }
}

let wired = false;

export function wireSettingsBus() {
  if (wired) return;
  wired = true;

  penBus.on('settingInfo', ({ settings }) => {
    useSettingsStore.getState().loadFromSettingInfo(settings);
  });

  penBus.on('settingSetupSuccess', ({ settingType }) => {
    useSettingsStore.getState().acknowledge(settingType, true);
  });

  penBus.on('settingSetupFailure', ({ errorCode }) => {
    // errorCode here is the SettingType (SDK convention) — SDK uses the same
    // subtype as the identifier in failure responses too.
    useSettingsStore.getState().acknowledge(errorCode, false);
  });

  penBus.on('penDisconnected', () => {
    useSettingsStore.getState().reset();
  });
}
