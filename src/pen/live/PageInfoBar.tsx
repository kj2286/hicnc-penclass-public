import { FileText } from 'lucide-react';
import { useStrokeStore } from '@/store/stroke.store';

export function PageInfoBar() {
  const selectedKey = useStrokeStore((s) => s.selectedPageKey ?? s.currentPageKey);
  const pages = useStrokeStore((s) => s.livePages);

  const page = selectedKey ? pages.find((p) => p.key === selectedKey) : null;
  if (!page) return null;

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        Section {page.section} · Owner {page.owner} · Note {page.noteId} · Page {page.pageNumber}
      </span>
    </div>
  );
}
