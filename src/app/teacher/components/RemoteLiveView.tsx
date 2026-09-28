/**
 * 원격 모드(Mode A) 라이브 뷰 — 학생 기기에서 스트리밍되는 필기를
 * 학생별 타일로 실시간 렌더링한다. (전송 계층: src/lib/live-stream.ts)
 *
 * 스트로크 조립은 multipen.store 의 dot 처리와 동일한 규칙:
 * DOWN(0)=새 스트로크, MOVE(1)=이어쓰기(다운 누락 시 자동 시작), UP(2)=종료.
 *
 * 학생별 노트/페이지 기록은 선생님 브라우저에 영속화되어, 새로고침 후에도
 * 이전에 쓰던 노트를 노트·페이지 칩으로 다시 볼 수 있다.
 */
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@seed-design/react';
import { Wifi } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PaperCanvas } from '@/pen/paper/PaperCanvas';
import { NotebookBrowser, type BrowserPage } from '@/pen/live/NotebookBrowser';
import { buildPageKey } from '@/lib/pen-event-bus';
import {
  debouncedSave,
  loadSnapshot,
  saveSnapshot,
} from '@/pen/live/notebook-history';
import {
  subscribeLiveClass,
  type RemoteDotsPayload,
  type RemotePresence,
} from '@/lib/live-stream';
import type { Stroke } from '@/pen/live/model/stroke';
import { formatRelative } from '../format';
import { Callout } from 'seed-design/ui/callout';
import { capacityNotice, splitByCapacity } from '@/lib/live-capacity';
import { LiveOverflowList } from './LiveOverflowList';

const DOT_DOWN = 0;
const DOT_MOVE = 1;
const DOT_UP = 2;

type RemotePage = {
  key: string;
  section: number;
  owner: number;
  noteId: number;
  pageNumber: number;
  /** 마지막 필기 시각 (epoch ms) */
  updatedAt: number;
};

type RemoteStudent = {
  studentId: string;
  name: string;
  online: boolean;
  lastSeenAt: number | null;
  currentPageKey: string | null;
  pages: RemotePage[];
  strokesByPage: Record<string, Stroke[]>;
  totalDots: number;
};

type RemoteSnapshot = {
  v: 1;
  students: RemoteStudent[];
};

let remoteStrokeSeq = 0;

function applyDots(student: RemoteStudent, payload: RemoteDotsPayload): void {
  for (const dot of payload.dots) {
    const pageKey = buildPageKey(
      dot.section,
      dot.owner,
      dot.noteId,
      dot.pageNumber,
    );
    if (!student.strokesByPage[pageKey]) student.strokesByPage[pageKey] = [];
    const existing = student.pages.find((p) => p.key === pageKey);
    if (existing) {
      existing.updatedAt = Date.now();
    } else {
      student.pages.push({
        key: pageKey,
        section: dot.section,
        owner: dot.owner,
        noteId: dot.noteId,
        pageNumber: dot.pageNumber,
        updatedAt: Date.now(),
      });
    }
    student.currentPageKey = pageKey;
    const list = student.strokesByPage[pageKey];

    if (dot.dotType === DOT_DOWN) {
      remoteStrokeSeq += 1;
      list.push({
        id: `remote_${payload.studentId}_${dot.timeStamp || Date.now()}_${remoteStrokeSeq}`,
        section: dot.section,
        owner: dot.owner,
        noteId: dot.noteId,
        pageNumber: dot.pageNumber,
        dots: [],
        startedAt: dot.timeStamp || Date.now(),
        endedAt: null,
      });
      continue;
    }

    const strokeDot = {
      x: dot.x,
      y: dot.y,
      pressure: dot.pressure,
      maxPressure: dot.maxPressure || 852,
      timeStamp: dot.timeStamp || 0,
    };

    if (dot.dotType === DOT_MOVE) {
      let target = list[list.length - 1];
      if (!target || target.endedAt != null) {
        remoteStrokeSeq += 1;
        target = {
          id: `remote_${payload.studentId}_${dot.timeStamp || Date.now()}_${remoteStrokeSeq}`,
          section: dot.section,
          owner: dot.owner,
          noteId: dot.noteId,
          pageNumber: dot.pageNumber,
          dots: [],
          startedAt: dot.timeStamp || Date.now(),
          endedAt: null,
        };
        list.push(target);
      }
      target.dots.push(strokeDot);
      student.totalDots += 1;
      continue;
    }

    if (dot.dotType === DOT_UP) {
      const target = list[list.length - 1];
      if (target && target.endedAt == null) {
        target.dots.push(strokeDot);
        student.totalDots += 1;
        target.endedAt = dot.timeStamp || Date.now();
      }
    }
  }
  student.lastSeenAt = Date.now();
}

function storageKeyFor(teacherId: string): string {
  return `pc_live_v1.teacher_remote.${teacherId}`;
}

function persistStore(teacherId: string, store: Map<string, RemoteStudent>) {
  const key = storageKeyFor(teacherId);
  debouncedSave(key, () => {
    const snap: RemoteSnapshot = {
      v: 1,
      students: [...store.values()].map((s) => ({
        ...s,
        pages: [...s.pages],
        strokesByPage: { ...s.strokesByPage },
      })),
    };
    saveSnapshot(key, snap, () => {
      let si = -1;
      let pi = -1;
      let best = Infinity;
      for (let i = 0; i < snap.students.length; i++) {
        const pages = snap.students[i].pages;
        for (let j = 0; j < pages.length; j++) {
          const t = pages[j].updatedAt ?? 0;
          if (t < best) {
            best = t;
            si = i;
            pi = j;
          }
        }
      }
      if (si < 0 || pi < 0) return false;
      const st = snap.students[si];
      const [removed] = st.pages.splice(pi, 1);
      delete st.strokesByPage[removed.key];
      if (st.currentPageKey === removed.key) st.currentPageKey = null;
      if (st.pages.length === 0) snap.students.splice(si, 1);
      return true;
    });
  });
}

function RemoteStudentTile({ student: s }: { student: RemoteStudent }) {
  // 페이지 열람 — null 이면 학생의 실시간 위치를 따라간다.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  const viewKey = pinnedKey ?? s.currentPageKey;
  const strokes = viewKey ? (s.strokesByPage[viewKey] ?? []) : [];
  const page = s.pages.find((p) => p.key === viewKey) ?? null;
  const browserPages: BrowserPage[] = s.pages.map((p) => ({
    ...p,
    strokeCount: s.strokesByPage[p.key]?.length ?? 0,
  }));

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line-weak bg-layer-default">
      <div className="flex items-center gap-2 border-b border-line-weak px-4 py-3">
        <span
          className={
            'h-2 w-2 shrink-0 rounded-full ' +
            (s.online ? 'bg-brand-solid' : 'bg-neutral-weak')
          }
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-ink">{s.name}</div>
          <div className="truncate text-xs text-ink-subtle">
            <span className="inline-flex items-center gap-1">
              <Wifi size={11} /> 원격 스트리밍
            </span>
          </div>
        </div>
        {!s.online && (
          <Badge size="medium" variant="weak" tone="critical">
            연결 끊김
          </Badge>
        )}
      </div>

      {browserPages.length > 0 && (
        <div className="border-b border-line-weak px-4 py-2.5">
          <NotebookBrowser
            compact
            pages={browserPages}
            currentPageKey={s.currentPageKey}
            selectedPageKey={viewKey}
            onSelectPage={(k) => setPinnedKey(k === s.currentPageKey ? null : k)}
          />
        </div>
      )}

      <div className="h-72 bg-layer-fill">
        {strokes.length > 0 ? (
          // 등록 교재(시험지)면 실제 문제지 배경, 일반 연습장이면 줄노트 폴백
          <PaperCanvas
            section={page?.section}
            owner={page?.owner}
            noteId={page?.noteId}
            pageNumber={page?.pageNumber}
            strokes={strokes}
            ruledFallback
          />
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-ink-subtle">
            {s.online
              ? '학생이 펜으로 쓰면 여기 실시간으로 표시됩니다.'
              : '학생 기기와의 연결이 끊겼습니다. 이전 필기는 위 노트에서 볼 수 있어요.'}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line-weak px-4 py-2.5 text-xs text-ink-subtle">
        <span>
          {page
            ? `노트 ${page.noteId} · ${page.pageNumber}쪽 보는 중 · ${s.totalDots}점`
            : '아직 필기한 페이지 없음'}
        </span>
        <span>
          {s.lastSeenAt ? `마지막 활동 ${formatRelative(s.lastSeenAt)}` : ''}
        </span>
      </div>
    </div>
  );
}

export function RemoteLiveView({ teacherId }: { teacherId: string }) {
  // 고빈도 갱신이라 mutable ref + version bump 로 렌더 트리거
  const storeRef = useRef<Map<string, RemoteStudent>>(new Map());
  const [, setVersion] = useState(0);
  /** [보기] 로 화면에 고정한 학생 — 정원 경쟁에서 우선권을 갖는다 */
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(new Set());

  // 이전 세션 기록 복원 (오프라인 상태로 표시)
  useEffect(() => {
    if (storeRef.current.size > 0) return;
    const snap = loadSnapshot<RemoteSnapshot>(storageKeyFor(teacherId));
    if (snap?.v !== 1) return;
    for (const s of snap.students) {
      storeRef.current.set(s.studentId, { ...s, online: false });
    }
    if (snap.students.length > 0) setVersion((v) => v + 1);
  }, [teacherId]);

  useEffect(() => {
    const store = storeRef.current;
    const ensure = (studentId: string, name: string): RemoteStudent => {
      let s = store.get(studentId);
      if (!s) {
        s = {
          studentId,
          name,
          online: true,
          lastSeenAt: null,
          currentPageKey: null,
          pages: [],
          strokesByPage: {},
          totalDots: 0,
        };
        store.set(studentId, s);
      }
      return s;
    };

    const stop = subscribeLiveClass(teacherId, {
      onDots: (payload) => {
        const s = ensure(payload.studentId, payload.studentName);
        s.name = payload.studentName || s.name;
        s.online = true;
        applyDots(s, payload);
        persistStore(teacherId, store);
        setVersion((v) => v + 1);
      },
      onPresence: (list: RemotePresence[]) => {
        const onlineIds = new Set(list.map((p) => p.studentId));
        for (const p of list) {
          const s = ensure(p.studentId, p.studentName);
          s.online = true;
          s.name = p.studentName || s.name;
        }
        for (const s of store.values()) {
          s.online = onlineIds.has(s.studentId);
        }
        setVersion((v) => v + 1);
      },
    });
    return stop;
  }, [teacherId]);

  const students = [...storeRef.current.values()];

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-line-weak bg-layer-default">
        <EmptyState
          illustration="live"
          title="아직 공유 중인 학생이 없습니다"
          description={
            '학생이 자기 기기(폰·태블릿)에서 학생 포털 → 스마트펜 연결 화면의 ' +
            '"선생님께 실시간 공유"를 켜면 여기에 실시간 필기가 나타납니다.'
          }
        />
      </div>
    );
  }

  // 라이브는 소규모용 — 캔버스는 정원까지만. 나머지는 목록으로 계속 보인다.
  // 온라인인 학생을 먼저 그린다(오프라인은 어차피 갱신이 없다).
  const ordered = [...students].sort(
    (a, b) => Number(b.online) - Number(a.online),
  );
  const { shown, overflow } = splitByCapacity(
    ordered,
    (s) => s.studentId,
    pinnedIds,
  );
  const notice = capacityNotice(students.length);

  return (
    <div className="space-y-4">
      {notice && (
        <Callout
          tone="warning"
          title={notice.title}
          description={notice.description}
        />
      )}
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {shown.map((s) => (
          <RemoteStudentTile key={s.studentId} student={s} />
        ))}
      </div>
      <LiveOverflowList
        items={overflow.map((s) => ({
          key: s.studentId,
          name: s.name || s.studentId,
          detail: s.online ? '공유 중' : '연결 끊김',
        }))}
        onShow={(id) => setPinnedIds((prev) => new Set(prev).add(id))}
      />
    </div>
  );
}
