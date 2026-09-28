import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { detectBrowserSupport, type BrowserSupport } from '@/lib/browser-support';

export function BrowserSupportBanner() {
  const [support, setSupport] = useState<BrowserSupport | null>(null);

  useEffect(() => {
    let cancelled = false;
    detectBrowserSupport().then((s) => {
      if (!cancelled) setSupport(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!support || !support.reason) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-foreground">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
      <div className="space-y-1">
        <p className="font-semibold">브라우저 지원 경고</p>
        <p className="text-muted-foreground">{support.reason}</p>
      </div>
    </div>
  );
}
