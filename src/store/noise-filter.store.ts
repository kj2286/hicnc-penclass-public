import { create } from 'zustand';
import { readNoiseFilterEnabled, persistNoiseFilterEnabled } from '@/lib/noise-filter';
import { applyNoiseFilterToConnectedPens } from '@/lib/pen-sdk-client';

/**
 * On/off state for the SDK dot noise filter (see `@/lib/noise-filter`).
 * Initialised from localStorage; `setEnabled` persists the choice and pushes it
 * to every connected pen immediately. Newly connected pens pick it up in the
 * PEN_AUTHORIZED handler.
 */
type State = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
};

export const useNoiseFilterStore = create<State>((set, get) => ({
  enabled: readNoiseFilterEnabled(),
  setEnabled: (enabled) => {
    persistNoiseFilterEnabled(enabled);
    applyNoiseFilterToConnectedPens(enabled);
    set({ enabled });
  },
  toggle: () => get().setEnabled(!get().enabled),
}));
