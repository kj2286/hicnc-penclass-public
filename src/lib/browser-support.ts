export type BrowserSupport = {
  hasBluetooth: boolean;
  isSecureContext: boolean;
  isLikelyIos: boolean;
  reason?: string;
};

export async function detectBrowserSupport(): Promise<BrowserSupport> {
  const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  const isSecureContext = typeof window !== 'undefined' ? window.isSecureContext : false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isLikelyIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);

  let reason: string | undefined;
  if (!hasBluetooth) {
    reason = isLikelyIos
      ? 'iOS Safari는 Web Bluetooth를 지원하지 않습니다. Android Chrome 또는 데스크톱 Chrome/Edge를 사용하세요.'
      : '이 브라우저는 Web Bluetooth API를 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.';
  } else if (!isSecureContext) {
    reason = 'Web Bluetooth는 HTTPS(또는 localhost)에서만 동작합니다.';
  } else {
    try {
      const available = await navigator.bluetooth.getAvailability();
      if (!available) {
        reason = '블루투스 어댑터를 사용할 수 없습니다. 시스템 블루투스가 켜져 있는지 확인하세요.';
      }
    } catch {
      // getAvailability may throw in some contexts; ignore
    }
  }

  return { hasBluetooth, isSecureContext, isLikelyIos, reason };
}
