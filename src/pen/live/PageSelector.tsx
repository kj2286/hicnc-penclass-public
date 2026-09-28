import { cn } from '@/lib/utils';
import { useStrokeStore } from '@/store/stroke.store';

export function PageSelector() {
  const pages = useStrokeStore((s) => s.livePages);
  const selected = useStrokeStore((s) => s.selectedPageKey);
  const current = useStrokeStore((s) => s.currentPageKey);
  const selectPage = useStrokeStore((s) => s.selectPage);

  if (pages.length <= 1) return null;

  return (
    <div className="no-scrollbar flex items-center gap-2 overflow-x-auto px-4 py-2">
      {pages.map((p) => {
        const isActive = (selected ?? current) === p.key;
        return (
          <button
            key={p.key}
            onClick={() => selectPage(p.key)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            Page {p.pageNumber}
          </button>
        );
      })}
    </div>
  );
}
