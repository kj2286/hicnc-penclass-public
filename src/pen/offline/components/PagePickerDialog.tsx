import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fetchPages: () => Promise<number[]>;
  onConfirm: (pageIds: number[]) => void;
};

export function PagePickerDialog({ open, onOpenChange, fetchPages, onConfirm }: Props) {
  const [loading, setLoading] = useState(false);
  const [pages, setPages] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [customInput, setCustomInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPages(null);
      setSelected(new Set());
      setCustomInput('');
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPages()
      .then((list) => {
        if (cancelled) return;
        setPages(list);
        setSelected(new Set(list));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchPages]);

  const togglePage = (p: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const parseCustom = (): number[] => {
    if (!customInput.trim()) return [];
    return customInput
      .split(/[,\s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
  };

  const submit = () => {
    const custom = parseCustom();
    const finalPages = custom.length > 0 ? custom : [...selected];
    if (finalPages.length === 0) {
      setError('하나 이상의 페이지를 선택하세요.');
      return;
    }
    onConfirm(finalPages);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            페이지 선택 다운로드
          </DialogTitle>
          <DialogDescription>
            아래 체크박스에서 받을 페이지를 선택하거나, 직접 입력할 수 있습니다 (쉼표 구분).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              페이지 목록 조회 중...
            </div>
          )}
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          {pages && pages.length === 0 && (
            <p className="text-sm text-muted-foreground">이 노트에는 저장된 페이지가 없습니다.</p>
          )}
          {pages && pages.length > 0 && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                총 {pages.length}개 페이지 · 선택 {selected.size}개
              </p>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                {pages.map((p) => {
                  const on = selected.has(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePage(p)}
                      className={
                        'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                        (on
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-muted-foreground hover:text-foreground')
                      }
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="custom-pages">
              직접 입력 <Badge variant="outline" className="ml-1 text-[10px]">선택 사항</Badge>
            </Label>
            <Input
              id="custom-pages"
              placeholder="예: 1, 3, 5-7 은 아직 미지원 (쉼표 구분만)"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              직접 입력한 값이 있으면 체크박스 선택을 덮어씁니다.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={submit} disabled={loading}>
            <Download className="h-4 w-4" />
            다운로드
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
