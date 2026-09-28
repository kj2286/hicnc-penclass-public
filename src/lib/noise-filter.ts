/**
 * Client-side control of the `web_pen_sdk` built-in dot noise filter.
 *
 * The SDK routes every non-hover dot through `PenClientParserV2.dotFilter`
 * (a `DotFilter` instance). That filter runs a 3-point directional/delta jitter
 * check (`delta = 10`) and DROPS any dot it judges to be noise. On fast
 * handwriting, sharp corners, and very short strokes it discards legitimate
 * dots, so strokes break up ("끊김") or disappear entirely ("획 사라짐").
 *
 * The SDK's own `DotFilter.useFilter` flag is vestigial — `filterProcess` never
 * reads it — so there is no supported off switch. We toggle the filter by
 * swapping the instance's `put` entry point per connected pen:
 *
 *   - OFF: `put` forwards every dot straight to the listener (raw, lossless).
 *   - ON : restore the SDK's original filtering `put`.
 *
 * This module is intentionally free of any `web_pen_sdk` import so it stays
 * unit-testable without the browser BLE stack; the caller passes controllers in.
 * The "apply to all connected pens" fan-out lives in `pen-sdk-client.ts`, which
 * already owns the SDK handle.
 */

const STORAGE_KEY = 'neopen.noiseFilterEnabled';

/**
 * Default OFF. The SDK filter's dropped dots are the reported regression
 * (strokes vanishing), so shipping with it disabled restores lossless drawing
 * out of the box; users opt back into smoothing via the UX toggle.
 */
const DEFAULT_ENABLED = false;

type DotFn = (dot: unknown) => void;

/** Shape of the SDK `DotFilter` we reach into (only the parts we touch). */
type PatchableDotFilter = {
  put: DotFn;
  sendDot: DotFn;
  /** Our stash of the SDK's original filtering `put`, captured on first patch. */
  __origPut?: DotFn;
};

type ParserCarrier = { mParserV2?: { dotFilter?: PatchableDotFilter } };

export function readNoiseFilterEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return DEFAULT_ENABLED;
    return v === '1' || v === 'true';
  } catch {
    return DEFAULT_ENABLED;
  }
}

export function persistNoiseFilterEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    /* private-mode / storage-disabled: setting simply won't persist */
  }
}

function dotFilterOf(controller: unknown): PatchableDotFilter | undefined {
  return (controller as ParserCarrier | null | undefined)?.mParserV2?.dotFilter;
}

/**
 * Apply `enabled` to one controller's SDK dot filter. No-op if the controller
 * has no reachable parser/filter yet. Idempotent and reversible.
 */
export function applyNoiseFilterToController(
  controller: unknown,
  enabled: boolean,
): void {
  const filter = dotFilterOf(controller);
  if (!filter) return;
  // Capture the SDK's original filtering entry point exactly once.
  if (!filter.__origPut) filter.__origPut = filter.put;
  filter.put = enabled
    ? filter.__origPut
    : (dot: unknown) => filter.sendDot(dot); // pass-through: nothing dropped
}

/** Apply the persisted setting to a freshly connected controller. */
export function applyCurrentNoiseFilterToController(controller: unknown): void {
  applyNoiseFilterToController(controller, readNoiseFilterEnabled());
}
