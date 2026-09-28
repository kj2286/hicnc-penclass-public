import type { PenController, VersionInfo } from '@/types/sdk';

export type PenConnectionState =
  | { kind: 'Disconnected' }
  | { kind: 'Scanning' }
  | { kind: 'Connecting'; deviceName?: string }
  | { kind: 'Handshaking'; mac: string; deviceName?: string }
  | {
      kind: 'NeedsPassword';
      mac: string;
      controller: PenController;
      retryCount: number;
      resetCount: number;
    }
  | {
      kind: 'Connected';
      mac: string;
      controller: PenController;
      info: VersionInfo;
    }
  | { kind: 'ConnectionError'; reason: string };

export const isConnected = (
  s: PenConnectionState,
): s is Extract<PenConnectionState, { kind: 'Connected' }> => s.kind === 'Connected';

export const needsPassword = (
  s: PenConnectionState,
): s is Extract<PenConnectionState, { kind: 'NeedsPassword' }> =>
  s.kind === 'NeedsPassword';
