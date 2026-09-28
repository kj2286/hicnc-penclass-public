/**
 * 노트(권)·페이지 브라우저 — 학생/선생님 라이브 화면 공용.
 *
 * - 노트 단위로 묶어 "몇 쪽까지 썼는지"를 요약해 보여준다.
 * - 노트를 바꿔 썼다면 이전 노트도 칩으로 남아 언제든 다시 볼 수 있다.
 * - 페이지 칩으로 특정 쪽을 열람하고, "지금 쓰는 쪽"으로 바로 돌아올 수 있다.
 * - 등록 교재(ncode 문제지)와 매칭되는 노트에는 "수업 교재" 배지가 붙는다
 *   (선생님이 나눠준 교재 = 선생님과 연결된 노트).
 */
import { useEffect, useMemo } from 'react';
import { BookOpen, PenLine } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePaperStore } from '@/store/paper.store';

export type BrowserPage = {
  key: string;
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
  strokeCount: number;
  updatedAt: number;
};

type Notebook = {
  id: string;
  section: number;
  owner: number;
  noteId: number;
  pages: BrowserPage[];
  lastUpdatedAt: number;
  maxPage: number;
};

function notebookId(p: { section: number; owner: number; noteId: number }): string {
  return `${p.section}_${p.owner}_${p.noteId}`;
}

export function NotebookBrowser({
  pages,
  currentPageKey,
  selectedPageKey,
  onSelectPage,
  compact = false,
}: {
  pages: BrowserPage[];
  /** 펜이 지금 쓰고 있는(마지막으로 쓴) 페이지 */
  currentPageKey: string | null;
  /** 화면에 열람 중인 페이지 */
  selectedPageKey: string | null;
  onSelectPage: (key: string) => void;
  /** 선생님 타일처럼 좁은 자리용 축약 모드 */
  compact?: boolean;
}) {
  // 등록 교재(ncode) 인덱스 — 준비되면 교재 노트에 배지를 붙인다.
  const index = usePaperStore((s) => s.index);
  const refreshIndex = usePaperStore((s) => s.refreshIndex);
  useEffect(() => {
    if (index.kind === 'idle') void refreshIndex();
  }, [index.kind, refreshIndex]);
  const paperMap = index.kind === 'ready' ? index.map : null;

  const notebooks = useMemo<Notebook[]>(() => {
    const map = new Map<string, Notebook>();
    for (const p of pages) {
      const id = notebookId(p);
      let nb = map.get(id);
      if (!nb) {
        nb = {
          id,
          section: p.section,
          owner: p.owner,
          noteId: p.noteId,
          pages: [],
          lastUpdatedAt: 0,
          maxPage: 0,
        };
        map.set(id, nb);
      }
      nb.pages.push(p);
      nb.lastUpdatedAt = Math.max(nb.lastUpdatedAt, p.updatedAt);
      nb.maxPage = Math.max(nb.maxPage, p.pageNumber);
    }
    const list = [...map.values()];
    for (const nb of list) nb.pages.sort((a, b) => a.pageNumber - b.pageNumber);
    list.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
    return list;
  }, [pages]);

  const effectiveKey = selectedPageKey ?? currentPageKey;
  const selectedNb =
    notebooks.find((nb) => nb.pages.some((p) => p.key === effectiveKey)) ??
    notebooks[0] ??
    null;

  if (!selectedNb) return null;

  const isPaperNotebook = (nb: Notebook): boolean =>
    paperMap != null && nb.pages.some((p) => paperMap.has(p.key));

  const activeNbId = currentPageKey
    ? notebooks.find((nb) => nb.pages.some((p) => p.key === currentPageKey))?.id
    : undefined;

  return (
    <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2.5')}>
      {/* 노트(권) 칩 — 이전에 쓰던 노트도 그대로 남는다 */}
      {notebooks.length > 1 && (
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          {notebooks.map((nb) => {
            const isSelected = nb.id === selectedNb.id;
            const isActive = nb.id === activeNbId;
            return (
              <button
                key={nb.id}
                type="button"
                onClick={() => {
                  // 노트 칩 클릭 → 그 노트에서 마지막으로 쓴 쪽을 연다
                  const last = nb.pages.reduce((a, b) =>
                    a.updatedAt >= b.updatedAt ? a : b,
                  );
                  onSelectPage(last.key);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-lg border font-medium transition-colors',
                  compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
                  isSelected
                    ? 'border-brand bg-brand-weak font-bold text-brand'
                    : 'border-line-weak bg-layer-default text-ink-muted hover:bg-neutral-weak hover:text-ink',
                )}
              >
                <BookOpen size={compact ? 12 : 14} />
                노트 {nb.noteId}
                {isPaperNotebook(nb) && (
                  <span
                    className={cn(
                      'rounded bg-brand-solid font-bold text-ink-inverted',
                      compact ? 'px-1 text-[9px]' : 'px-1.5 py-px text-[10px]',
                    )}
                  >
                    {compact ? '교재' : '수업 교재'}
                  </span>
                )}
                <span className={cn(isSelected ? 'text-brand' : 'text-ink-subtle')}>
                  {nb.pages.length}쪽
                </span>
                {isActive && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-brand-solid"
                    aria-label="지금 쓰는 노트"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 선택한 노트 요약 + 페이지 칩 */}
      <div
        className={cn(
          'flex flex-wrap items-center',
          compact ? 'gap-x-2 gap-y-1' : 'gap-x-3 gap-y-1.5',
        )}
      >
        <span
          className={cn(
            'flex items-center gap-1 font-semibold text-ink',
            compact ? 'text-[11px]' : 'text-xs',
          )}
        >
          노트 {selectedNb.noteId}
          {notebooks.length === 1 && isPaperNotebook(selectedNb) && (
            <span className="rounded bg-brand-solid px-1.5 py-px text-[10px] font-bold text-ink-inverted">
              수업 교재
            </span>
          )}
          <span className="font-normal text-ink-subtle">
            · {selectedNb.maxPage}쪽까지 씀 · 기록 {selectedNb.pages.length}쪽
          </span>
        </span>
        {currentPageKey && effectiveKey !== currentPageKey && (
          <button
            type="button"
            onClick={() => onSelectPage(currentPageKey)}
            className={cn(
              'flex items-center gap-1 rounded-md bg-brand-weak font-bold text-brand transition-colors hover:bg-brand-weak/70',
              compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]',
            )}
          >
            <PenLine size={compact ? 10 : 12} />
            지금 쓰는 쪽 보기
          </button>
        )}
      </div>

      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
        {selectedNb.pages.map((p) => {
          const isViewing = p.key === effectiveKey;
          const isCurrent = p.key === currentPageKey;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onSelectPage(p.key)}
              title={`${p.pageNumber}쪽 · 획 ${p.strokeCount}개`}
              className={cn(
                'relative shrink-0 rounded-md border text-center font-semibold tabular-nums transition-colors',
                compact
                  ? 'min-w-7 px-1.5 py-0.5 text-[11px]'
                  : 'min-w-8 px-2 py-1 text-xs',
                isViewing
                  ? 'border-brand bg-brand-solid text-ink-inverted'
                  : 'border-line-weak bg-layer-default text-ink-muted hover:bg-neutral-weak hover:text-ink',
              )}
            >
              {p.pageNumber}
              {isCurrent && (
                <span
                  className={cn(
                    'absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full',
                    isViewing ? 'bg-ink-inverted' : 'bg-brand-solid',
                  )}
                  aria-label="지금 쓰는 쪽"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
