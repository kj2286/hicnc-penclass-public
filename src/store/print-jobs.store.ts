import { create } from 'zustand';
import { deskPrintJobStatus } from '@/lib/desk';
import { applyStatus, isActive, loadJobs, saveJobs, upsertJob, type PrintJob } from '@/lib/print-jobs';
import { useSessionStore } from './session.store';

const storage = (): Storage | null => {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; }
  catch { return null; }
};

type State = {
  ownerId: string | null;
  jobs: PrintJob[];
  open: boolean;
  setOpen: (open: boolean) => void;
  setOwner: (ownerId: string | null) => void;
  upsert: (job: PrintJob, ownerId: string) => void;
  remove: (id: string) => void;
  clearDone: () => void;
  activeCount: () => number;
  pollOnce: () => Promise<void>;
};

let polling = false;
export const usePrintJobsStore = create<State>()((set, get) => ({
  ownerId: null,
  jobs: [],
  open: false,
  setOpen: open => set({ open }),
  setOwner: ownerId => {
    if (ownerId === get().ownerId) return;
    set({ ownerId, jobs: ownerId ? loadJobs(storage(), ownerId) : [], open: false });
  },
  upsert: (job, ownerId) => {
    // 출력 중 로그인이 바뀌어도 작업은 원래 교사의 기록에만 남긴다.
    const jobs = upsertJob(ownerId === get().ownerId ? get().jobs : loadJobs(storage(), ownerId), job);
    saveJobs(storage(), jobs, ownerId);
    if (ownerId === get().ownerId) set({ jobs });
  },
  remove: id => {
    const { ownerId, jobs: previous } = get();
    if (!ownerId) return;
    const jobs = previous.filter(j => j.id !== id || isActive(j.state));
    saveJobs(storage(), jobs, ownerId);
    set({ jobs });
  },
  clearDone: () => {
    const { ownerId, jobs: previous } = get();
    if (!ownerId) return;
    const jobs = previous.filter(j => isActive(j.state));
    saveJobs(storage(), jobs, ownerId);
    set({ jobs });
  },
  activeCount: () => get().jobs.filter(j => isActive(j.state)).length,
  pollOnce: async () => {
    const { ownerId, jobs } = get();
    if (!ownerId || polling) return;
    polling = true;
    try {
      for (const job of jobs.filter(j => isActive(j.state) && j.jobId != null)) {
        if (get().ownerId !== ownerId) break;
        try {
          const result = await deskPrintJobStatus(job.uri, job.jobId!);
          if (get().ownerId !== ownerId) break;
          const current = get().jobs.find(j => j.id === job.id);
          if (current) get().upsert(applyStatus(current, result), ownerId);
        } catch (error) {
          if (get().ownerId !== ownerId) break;
          const message = error instanceof Error ? error.message : String(error);
          if (/print_job_status/i.test(message) && /not allowed|not found|unknown command|permission/i.test(message)) {
            get().upsert({ ...job, state: 'unknown', updatedAt: Date.now(), note: '출력 접수 후 상태를 확인하려면 하이씨앤씨 펜클래스 0.1.2 이상으로 업데이트해 주세요.' }, ownerId);
          }
          // 프린터 절전·네트워크 오류는 다음 조회에서 다시 확인한다.
        }
      }
    } finally { polling = false; }
  },
}));

/** 메뉴 이동·계정 전환에 맞춰 하나의 조회 루프만 유지한다. */
export function startPrintJobPolling(): () => void {
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const syncOwner = () => usePrintJobsStore.getState().setOwner(useSessionStore.getState().profile?.id ?? null);
  syncOwner();
  const unsubscribe = useSessionStore.subscribe(syncOwner);
  const poll = async () => {
    if (!active) return;
    await usePrintJobsStore.getState().pollOnce();
    if (active) timer = setTimeout(() => void poll(), 3000);
  };
  void poll();
  return () => { active = false; if (timer) clearTimeout(timer); unsubscribe(); };
}
