import { useEffect, useState } from 'react';
import { Bluetooth, History, Loader2, ScrollText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BrowserSupportBanner } from '@/components/BrowserSupportBanner';
import { useConnectionStore } from '@/store/connection.store';
import { detectBrowserSupport } from '@/lib/browser-support';

export function ScanScreen() {
  const state = useConnectionStore((s) => s.state);
  const lastMac = useConnectionStore((s) => s.lastMac);
  const lastDeviceName = useConnectionStore((s) => s.lastDeviceName);
  const scan = useConnectionStore((s) => s.scan);

  const [btAvailable, setBtAvailable] = useState<boolean>(true);

  useEffect(() => {
    detectBrowserSupport().then((s) => setBtAvailable(s.hasBluetooth && s.isSecureContext));
  }, []);

  const isBusy =
    state.kind === 'Scanning' ||
    state.kind === 'Connecting' ||
    state.kind === 'Handshaking';

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10 sm:py-16">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-3">
          <Badge variant="default" className="inline-flex font-mono text-[10px] uppercase tracking-[0.18em]">
            <Bluetooth className="h-3 w-3" />
            Web Bluetooth
          </Badge>
          <h1 className="text-[36px] font-semibold leading-[1.05] tracking-tight">
            Neo Smartpen
            <span className="ml-2 inline-flex items-center align-middle font-mono text-[12px] uppercase tracking-[0.18em] text-primary">
              <span aria-hidden className="mr-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              Demo
            </span>
          </h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Neo Smartpen 을 BLE 로 브라우저에 연결하여 실시간 필기, 펜 설정, 오프라인 데이터를 데모합니다.
          </p>
        </div>
        <Button asChild variant="outline" size="sm" data-testid="open-admin-from-scan">
          <Link to="/admin/pdfs" className="shrink-0 gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em]">
            <ScrollText className="h-4 w-4" />
            Catalog
          </Link>
        </Button>
      </header>

      <BrowserSupportBanner />

      <Card>
        <CardHeader>
          <CardTitle>펜 연결</CardTitle>
          <CardDescription>
            아래 버튼을 누르면 브라우저의 블루투스 장치 선택창이 열립니다. 펜의 전원을 먼저 켜주세요.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            size="lg"
            className="w-full"
            onClick={() => void scan()}
            disabled={!btAvailable || isBusy}
          >
            {isBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {state.kind === 'Scanning' && '스캔 중...'}
                {state.kind === 'Connecting' && '연결 중...'}
                {state.kind === 'Handshaking' && '핸드셰이크 중...'}
              </>
            ) : (
              <>
                <Bluetooth className="h-4 w-4" />
                펜 검색 및 연결
              </>
            )}
          </Button>

          {lastMac && (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 space-y-0.5">
                <p className="font-medium">최근 연결한 펜</p>
                <p className="font-mono text-xs text-muted-foreground">
                  {lastDeviceName ?? '이름 없음'} · {lastMac}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void scan()} disabled={isBusy}>
                다시 연결
              </Button>
            </div>
          )}

          {state.kind === 'ConnectionError' && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {state.reason}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        Web Bluetooth는 Chromium 기반 브라우저(Chrome · Edge)와 Android Chrome에서만 동작하며,
        HTTPS 또는 localhost 환경이 필요합니다.
      </div>
    </div>
  );
}
