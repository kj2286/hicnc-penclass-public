import { useMemo } from 'react';
import {
  BadgeCheck,
  BatteryMedium,
  Bluetooth,
  Cpu,
  FileKey2,
  HardDrive,
  Lock,
  Package2,
  RefreshCcw,
  Thermometer,
  Unlock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/store/connection.store';
import { useSettingsStore } from '@/store/settings.store';
import { isConnected } from '@/pen/connection/model/pen-connection-state';

export function PenInfoScreen() {
  const connState = useConnectionStore((s) => s.state);
  const values = useSettingsStore((s) => s.values);
  const lastReadAt = useSettingsStore((s) => s.lastReadAt);
  const refresh = useSettingsStore((s) => s.refresh);

  if (!isConnected(connState)) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6 text-sm text-muted-foreground">
        연결된 펜이 없습니다.
      </div>
    );
  }

  const info = connState.info;
  const controller = connState.controller;

  const sensorTypeLabel = useMemo(
    () => (info.PressureSensorType === 1 ? 'FSC' : 'FSR'),
    [info.PressureSensorType],
  );
  const lastReadText = useMemo(() => {
    if (!lastReadAt) return '아직 읽지 않음';
    return formatRelative(lastReadAt);
  }, [lastReadAt]);

  const locked = !!values.Locked;
  const batteryPct = typeof values.Battery === 'number' ? values.Battery : null;
  const memPct = typeof values.UsedMem === 'number' ? values.UsedMem : null;
  const maxForce = typeof values.MaxForce === 'number' ? values.MaxForce : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:p-6">
      {/* Device Header */}
      <Card>
        <CardHeader className="gap-2">
          <div className="flex items-center gap-2">
            <Badge variant="success">
              <BadgeCheck className="h-3 w-3" />
              Connected
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">
              {info.FirmwareVersion || '-'} / proto {info.ProtocolVersion || '-'}
            </Badge>
          </div>
          <CardTitle className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span>{info.DeviceName || 'Neo Smartpen'}</span>
            {info.SubName && (
              <span className="text-sm font-normal text-muted-foreground">
                {info.SubName}
              </span>
            )}
          </CardTitle>
          <p className="font-mono text-xs text-muted-foreground">{info.MacAddress}</p>
        </CardHeader>
      </Card>

      {/* Status Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatusCard
          icon={<BatteryMedium className="h-4 w-4" />}
          label="Battery"
          value={batteryPct != null ? `${batteryPct}%` : '—'}
          accent={batteryAccent(batteryPct)}
        />
        <StatusCard
          icon={<HardDrive className="h-4 w-4" />}
          label="Memory"
          value={memPct != null ? `${memPct}%` : '—'}
          accent={memoryAccent(memPct)}
        />
        <StatusCard
          icon={<Thermometer className="h-4 w-4" />}
          label="Max Force"
          value={maxForce != null ? String(maxForce) : '—'}
        />
        <StatusCard
          icon={<Cpu className="h-4 w-4" />}
          label="Sensor"
          value={sensorTypeLabel}
        />
      </div>

      {/* Detail Grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Device details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <DetailItem
            icon={<Package2 className="h-4 w-4" />}
            label="Device type"
            value={String(info.DeviceType ?? '—')}
          />
          <DetailItem
            icon={<Bluetooth className="h-4 w-4" />}
            label="Company code"
            value={String(info.CompanyCode ?? '—')}
          />
          <DetailItem
            icon={<Package2 className="h-4 w-4" />}
            label="Product code"
            value={String(info.ProductCode ?? '—')}
          />
          <DetailItem
            icon={<FileKey2 className="h-4 w-4" />}
            label="Color code"
            value={String(info.ColorCode ?? '—')}
          />
          <DetailItem
            icon={<BadgeCheck className="h-4 w-4" />}
            label="Compression"
            value={info.IsSupportCompress ? 'Supported' : 'Not supported'}
          />
          <DetailItem
            icon={locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            label="Password lock"
            value={locked ? 'Locked' : 'Not set'}
            accent={locked ? 'text-warning' : 'text-muted-foreground'}
          />
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <span>마지막 읽기: {lastReadText}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refresh(controller)}
          className="gap-1.5"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
          새로고침
        </Button>
      </div>
    </div>
  );
}

function StatusCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn('mt-1 text-lg font-semibold', accent)}>{value}</div>
    </div>
  );
}

function DetailItem({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn('font-mono text-sm', accent ?? 'text-foreground')}>{value}</div>
    </div>
  );
}

function batteryAccent(pct: number | null): string | undefined {
  if (pct == null) return undefined;
  if (pct <= 15) return 'text-destructive';
  if (pct <= 35) return 'text-warning';
  return 'text-success';
}
function memoryAccent(pct: number | null): string | undefined {
  if (pct == null) return undefined;
  if (pct >= 90) return 'text-destructive';
  if (pct >= 70) return 'text-warning';
  return undefined;
}
function formatRelative(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 5_000) return '방금 전';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
