/**
 * 학생 관리 — 학원 관리 스타일 리스트뷰.
 *
 * - 상단: 정렬 / 학교급(전체·초·중·고) 필터 / 재원·퇴원 탭 / 인원수 / 이름 검색 / 학생 추가
 * - 테이블: 체크박스 다중선택(일괄 퇴원·복귀), 학년·상태·연락처·학교·펜 보유·상세보기
 * - 학생 추가 팝업: 필수(이름·학년) + 선택(연락처 2종·학교·수업 시작일·집주소·특이사항·펜)
 * - 상세보기 팝업: 전체 프로필 편집 + 펜 데이터 / 퇴원·복귀·영구삭제
 * - 퇴원 = deleted_at(소프트 삭제) 재사용. 학생 정보와 필기 데이터는 유지되고 복귀 가능.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStudentAiActivity,
  receiveStateVersion,
  subscribeReceiveState,
} from '@/lib/receive-state';
import { isReportPendingForStudent } from '@/lib/learn-report';
import { loadAiStatus } from '@/lib/auto-grade';
import { Badge, Skeleton } from '@seed-design/react';
import { Bluetooth, BluetoothOff, Search, UserPlus } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import {
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'seed-design/ui/alert-dialog';
import { Callout } from 'seed-design/ui/callout';
import { ChipLabel, RadioChipItem, RadioChipRoot } from 'seed-design/ui/chip';
import {
  SegmentedControl,
  SegmentedControlItem,
} from 'seed-design/ui/segmented-control';
import { Switch } from 'seed-design/ui/switch';
import { EmptyState } from '@/components/EmptyState';
import {
  TextField,
  TextFieldInput,
  TextFieldTextarea,
} from 'seed-design/ui/text-field';
import { Drawer } from '@/components/ui/drawer';
import {
  createStudent,
  summarizeSubmissionsByStudent,
  listMyStudents,
  listStudentSubmissions,
  studentTrashAction,
  updateStudentProfile,
  type SchoolLevel,
  type StudentProfileInput,
  type StudentRow,
  type SubmissionRow,
} from '@/lib/api';
import {
  sortStudents,
  uploadAgoLabel,
  STUDENT_SORT_LABEL,
  type StudentSortKey,
} from '@/lib/student-sort';
import { isDesk } from '@/lib/desk';
import { BlePenDialog } from '../components/BlePenDialog';
import { useToast } from '../components/toast';
import { TokenSelect } from '../components/TokenSelect';
import { useMultipenStore } from '@/store/multipen.store';
import { assignPenUnified } from '@/lib/pen-assign';
import { formatDate } from '../format';

type LevelFilter = 'all' | SchoolLevel;
// 정렬 규칙은 순수 모듈로 뺐다 — scripts/student-sort-test.ts 가 검증한다
type SortKey = StudentSortKey;

const GRADE_MAX: Record<SchoolLevel, number> = { 초: 6, 중: 3, 고: 3 };

function gradeLabel(s: StudentRow): string {
  if (!s.schoolLevel) return '-';
  return `${s.schoolLevel}${s.grade ?? ''}`;
}

/** 추가/상세 공용 프로필 폼 상태 */
type ProfileForm = {
  name: string;
  schoolLevel: '' | SchoolLevel;
  grade: string;
  studentPhone: string;
  parentPhone: string;
  school: string;
  startDate: string;
  address: string;
  notes: string;
  hasPen: boolean;
};

const EMPTY_FORM: ProfileForm = {
  name: '',
  schoolLevel: '',
  grade: '',
  studentPhone: '',
  parentPhone: '',
  school: '',
  startDate: '',
  address: '',
  notes: '',
  hasPen: false,
};

function formFromStudent(s: StudentRow): ProfileForm {
  return {
    name: s.name,
    schoolLevel: s.schoolLevel ?? '',
    grade: s.grade != null ? String(s.grade) : '',
    studentPhone: s.studentPhone ?? '',
    parentPhone: s.parentPhone ?? '',
    school: s.school ?? '',
    startDate: s.startDate ?? '',
    address: s.address ?? '',
    notes: s.notes ?? '',
    hasPen: s.hasPen,
  };
}

function formToProfile(f: ProfileForm): StudentProfileInput {
  return {
    ...(f.schoolLevel ? { schoolLevel: f.schoolLevel } : {}),
    ...(f.grade ? { grade: Number(f.grade) } : {}),
    studentPhone: f.studentPhone,
    parentPhone: f.parentPhone,
    school: f.school,
    startDate: f.startDate,
    address: f.address,
    notes: f.notes,
    hasPen: f.hasPen,
  };
}

/** 섹션 소제목 — 색 띠 대신 여백과 글자 크기로만 구분한다(장식 최소) */
function SectionBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
      {children}
    </div>
  );
}

/** 필드 행 — 라벨 상단 배치(stacked). 라벨과 컨트롤 사이 6px, 컨트롤은 full-width.
 *  좁은 Drawer 에서도 입력이 찌그러지지 않고 간격이 항상 일정하다. */
function FieldRow({
  label,
  required,
  children,
}: {
  label: React.ReactNode;
  required?: boolean;
  /** @deprecated stacked 레이아웃에서는 무의미 — 호출부 호환용 */
  alignTop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-[14px] font-semibold leading-5 text-ink">
        {label}
        {required && (
          <span className="ml-1 text-[12px] font-normal text-ink-subtle">
            (필수)
          </span>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** 프로필 입력 필드 묶음 — 추가/상세 다이얼로그 공용 (참고 UI 레이아웃) */
function ProfileFields({
  form,
  setForm,
  nameAutoFocus,
  singleColumn,
}: {
  form: ProfileForm;
  setForm: (updater: (f: ProfileForm) => ProfileForm) => void;
  nameAutoFocus?: boolean;
  /** 우측 Drawer 처럼 좁은 곳에서 1열 강제 (뷰포트 기준 2열이 넘치는 것 방지) */
  singleColumn?: boolean;
}) {
  const gradeMax = form.schoolLevel ? GRADE_MAX[form.schoolLevel] : 0;
  const gridCls = singleColumn
    ? 'grid grid-cols-1 gap-y-4 py-5'
    : 'grid gap-x-10 gap-y-4 py-5 lg:grid-cols-2';
  return (
    <div>
      <SectionBand>필수 입력 사항</SectionBand>
      <div className={gridCls}>
        <FieldRow label="학생 이름" required>
          <TextField>
            <TextFieldInput
              aria-label="학생 이름"
              value={form.name}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, name: v }));
              }}
              placeholder="이름을 입력해주세요."
              autoFocus={nameAutoFocus}
            />
          </TextField>
        </FieldRow>
        <FieldRow label="학년" required>
          <div className="flex items-center gap-2">
            {(['초', '중', '고'] as const).map((lv) => (
              <button
                key={lv}
                type="button"
                aria-pressed={form.schoolLevel === lv}
                onClick={() =>
                  // 재클릭해도 해제하지 않는다 — 해제되면 학년 옵션이 비어
                  // "선택이 안 되는" 것처럼 보이는 혼란을 만든다 (필수 항목)
                  setForm((f) => ({
                    ...f,
                    schoolLevel: lv,
                    grade: f.schoolLevel === lv ? f.grade : '',
                  }))
                }
                className={
                  'sp-btn-free h-10 w-12 shrink-0 border text-[14px] font-semibold transition-colors ' +
                  (form.schoolLevel === lv
                    ? 'border-brand bg-brand-solid text-white'
                    : 'border-line-solid bg-layer-default text-ink-muted hover:bg-neutral-weak')
                }
              >
                {lv}
              </button>
            ))}
            <TokenSelect
              aria-label="학년"
              className="h-10 min-w-0 flex-1"
              value={form.grade}
              disabled={!form.schoolLevel}
              onValueChange={(v) => setForm((f) => ({ ...f, grade: v }))}
            >
              <option value="">
                {form.schoolLevel ? '학년 선택' : '초/중/고 먼저 선택'}
              </option>
              {Array.from({ length: gradeMax }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}학년
                </option>
              ))}
            </TokenSelect>
          </div>
        </FieldRow>
      </div>

      <SectionBand>선택 입력 사항</SectionBand>
      <div className={gridCls}>
        <FieldRow label="학생 연락처">
          <TextField>
            <TextFieldInput
              aria-label="학생 연락처"
              value={form.studentPhone}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, studentPhone: v }));
              }}
              placeholder="숫자만 입력해주세요."
              inputMode="tel"
            />
          </TextField>
        </FieldRow>
        <FieldRow label="학부모 연락처">
          <TextField>
            <TextFieldInput
              aria-label="학부모 연락처"
              value={form.parentPhone}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, parentPhone: v }));
              }}
              placeholder="숫자만 입력해주세요."
              inputMode="tel"
            />
          </TextField>
        </FieldRow>
        <FieldRow label="학교">
          <TextField>
            <TextFieldInput
              aria-label="학교"
              value={form.school}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, school: v }));
              }}
              placeholder="학교명을 입력해주세요."
            />
          </TextField>
        </FieldRow>
        <FieldRow label="수업 시작일">
          <TextField>
            <TextFieldInput
              aria-label="수업 시작일"
              type="date"
              value={form.startDate}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, startDate: v }));
              }}
            />
          </TextField>
        </FieldRow>
        <FieldRow label="집 주소">
          <TextField>
            <TextFieldInput
              aria-label="집 주소"
              value={form.address}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, address: v }));
              }}
              placeholder="주소를 입력해주세요."
            />
          </TextField>
        </FieldRow>
        <FieldRow label="스마트펜 보유">
          <div className="flex h-10 items-center">
            <Switch
              checked={form.hasPen}
              onCheckedChange={(v) => setForm((f) => ({ ...f, hasPen: v }))}
              aria-label="스마트펜 보유"
            />
          </div>
        </FieldRow>
        <div className={singleColumn ? '' : 'lg:col-span-2'}>
          <FieldRow label="비고 및 학생 특이사항" alignTop>
            <TextField>
              <TextFieldTextarea
                aria-label="비고 및 학생 특이사항"
                className="min-h-24"
                value={form.notes}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setForm((f) => ({ ...f, notes: v }));
                }}
                placeholder={
                  '내용을 입력해주세요.\n예시) 문제를 빨리 풀어서 실수가 잦음, 분수 계산이 약함, 중간고사-70점 / 기말고사-94점 등'
                }
              />
            </TextField>
          </FieldRow>
        </div>
      </div>
    </div>
  );
}

/**
 * 학생 행의 AI 상태 미니 표시 (작게, 사용자 지정 2026-08-19).
 * - 진행 중: 스피너 + "AI 진행 중" (상세는 툴팁)
 * - 서버 처리 요약(ai-status) 기준: 전부 완료 → 연한 "✓ AI 완료",
 *   미처리·새 필기 대기 문서가 있으면 → "AI 대기" (앱 시작 시 자동 이어짐)
 * - 기록이 없으면 아무것도 표시하지 않는다.
 * "표시가 없으면 완료인지 시작 전인지 알 수 없다" 는 지적(같은 날)로 완료도
 * 아주 연하게 상시 표시한다.
 */
function StudentAiMini({
  studentId,
  summary,
}: {
  studentId: string;
  summary?: 'done' | 'pending';
}) {
  useSyncExternalStore(subscribeReceiveState, receiveStateVersion);
  const act = getStudentAiActivity(studentId);
  const reportPending = isReportPendingForStudent(studentId);
  if (act || reportPending) {
    const tip = act
      ? `${act.title} · ${act.stage} ${act.done}/${act.total}`
      : '학습분석 리포트 생성 중';
    return (
      <span
        title={tip}
        className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-ink-subtle"
      >
        <span className="inline-block size-2.5 animate-spin rounded-full border-[1.5px] border-line-brand border-t-transparent" />
        AI 진행 중
      </span>
    );
  }
  if (summary === 'pending') {
    return (
      <span
        title="채점·분석이 안 끝난 기록이 있습니다 — 앱을 켜 두면 자동으로 이어서 처리됩니다"
        className="shrink-0 text-[10px] font-medium text-[#b45309]"
      >
        AI 대기
      </span>
    );
  }
  if (summary === 'done') {
    return (
      <span
        title="모든 필기 기록의 AI 채점·문항분석 완료"
        className="shrink-0 text-[10px] font-medium text-ink-subtle"
      >
        ✓ AI 완료
      </span>
    );
  }
  return null;
}

export function StudentsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [students, setStudents] = useState<StudentRow[]>([]);

  // ── 학생별 AI 처리 요약 (ai-status 파일 기준) — 완료/대기 상시 표시용 ──
  useSyncExternalStore(subscribeReceiveState, receiveStateVersion);
  const [aiSummary, setAiSummary] = useState<Record<string, 'done' | 'pending'>>(
    {},
  );
  // 파이프라인이 도는 학생 집합 — 멤버가 바뀌면(시작/완료) 요약을 다시 읽는다
  const aiActiveIds = students
    .filter((s) => getStudentAiActivity(s.id) !== null)
    .map((s) => s.id)
    .join(',');
  useEffect(() => {
    if (students.length === 0) return;
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        students.map(async (st) => {
          try {
            const subs = await listStudentSubmissions(st.id);
            const withInk = subs.filter((x) => x.strokeCount > 0);
            if (withInk.length === 0) return [st.id, undefined] as const;
            const states = await Promise.all(
              withInk.map(async (sub) => {
                const doc = await loadAiStatus(st.id, sub.id);
                return (
                  !!doc &&
                  doc.strokeCount === sub.strokeCount &&
                  doc.failed === 0
                );
              }),
            );
            return [
              st.id,
              states.every(Boolean) ? ('done' as const) : ('pending' as const),
            ] as const;
          } catch {
            return [st.id, undefined] as const;
          }
        }),
      );
      if (!alive) return;
      const next: Record<string, 'done' | 'pending'> = {};
      for (const [sid, v] of entries) if (v) next[sid] = v;
      setAiSummary(next);
    })();
    return () => {
      alive = false;
    };
  }, [students, aiActiveIds]);
  /** 크래들 없이 블루투스로 펜을 붙여 필기를 받는 창 (사용자 요구 2026-08-17) */
  const [blePenOpen, setBlePenOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 사용 중 펜 열은 제거됨 — 펜 배정·이관은 [크래들 (PC)]의 펜 레지스트리가 담당.
  // 라이브 스토어는 [전체 펜 회수](교실 모드 잔여 연결 정리)에만 쓴다.
  const pens = useMultipenStore((s) => s.pens);
  /** 학생별 필기 기록 일수 (일자 기준) */
  const [recordDays, setRecordDays] = useState<Record<string, number>>({});
  /** 학생별 마지막 필기 업로드 시각 (ISO) — 최근 업로드순 정렬·행 표시 */
  const [lastUploadAt, setLastUploadAt] = useState<Record<string, string>>({});

  // ── 전체 펜 회수 — 배정된 모든 펜을 한 번에 학생에게서 해제 ──
  const assignedPens = useMemo(
    () =>
      Object.values(pens)
        .filter((p) => p.assignment && p.penNumber)
        .sort(
          (a, b) => parseInt(a.penNumber ?? '0', 10) - parseInt(b.penNumber ?? '0', 10),
        ),
    [pens],
  );
  const [bulkReleaseOpen, setBulkReleaseOpen] = useState(false);
  const [bulkReleasing, setBulkReleasing] = useState(false);
  const submitBulkRelease = async () => {
    if (bulkReleasing) return;
    setBulkReleasing(true);
    try {
      let ok = 0;
      for (const pen of assignedPens) {
        try {
          // 통합 헬퍼가 각 펜의 미저장 세그먼트를 flush 한 뒤 회수한다
          await assignPenUnified({
            mac: pen.mac,
            penNumber: pen.penNumber ?? '',
            student: null,
          });
          ok += 1;
        } catch {
          /* 개별 실패는 결과 토스트로 안내 */
        }
      }
      toast(
        ok === assignedPens.length || assignedPens.length === 0
          ? `펜 ${ok}개를 전부 회수했습니다.`
          : `펜 ${ok}개 회수, ${assignedPens.length - ok}개 실패`,
        ok > 0 ? 'positive' : 'critical',
      );
      setBulkReleaseOpen(false);
    } finally {
      setBulkReleasing(false);
    }
  };

  // 필터/정렬/검색/탭
  const [tab, setTab] = useState<'active' | 'withdrawn'>('active');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('upload');
  const [query, setQuery] = useState('');

  // 다중 선택
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<'trash' | 'restore' | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  // 학생 추가
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<ProfileForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  /** 계속 등록 모드 — 등록 후 다이얼로그를 닫지 않고 폼만 초기화 */
  const [keepAdding, setKeepAdding] = useState(false);

  // 상세보기
  const [detail, setDetail] = useState<StudentRow | null>(null);
  const [detailForm, setDetailForm] = useState<ProfileForm>(EMPTY_FORM);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailSubs, setDetailSubs] = useState<SubmissionRow[] | null>(null);
  const [showSubs, setShowSubs] = useState(false);

  // 단건 확인 다이얼로그
  const [purgeTarget, setPurgeTarget] = useState<StudentRow | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStudents(await listMyStudents());
      setSelectedIds(new Set());
      // 기록 일수는 표시용 — 실패해도 학생 목록은 막지 않는다
      summarizeSubmissionsByStudent()
        .then((sum) => {
          setRecordDays(sum.days);
          setLastUploadAt(sum.lastAt);
        })
        .catch(() => {});
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '학생 목록을 불러오지 못했습니다.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 탭 → 필터 → 검색 → 정렬
  const visible = useMemo(() => {
    let list = students.filter((s) =>
      tab === 'active' ? !s.deletedAt : Boolean(s.deletedAt),
    );
    if (levelFilter !== 'all') {
      list = list.filter((s) => s.schoolLevel === levelFilter);
    }
    const q = query.trim();
    if (q) list = list.filter((s) => s.name.includes(q));
    return sortStudents(list, sortKey, lastUploadAt);
  }, [students, tab, levelFilter, query, sortKey, lastUploadAt]);

  const activeCount = students.filter((s) => !s.deletedAt).length;
  const withdrawnCount = students.length - activeCount;

  const allChecked =
    visible.length > 0 && visible.every((s) => selectedIds.has(s.id));
  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (allChecked) return new Set();
      const next = new Set(prev);
      for (const s of visible) next.add(s.id);
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submitCreate = async () => {
    const name = addForm.name.trim();
    if (!name || !addForm.schoolLevel || !addForm.grade) {
      setAddError('이름과 학년(학교급·학년)은 필수입니다.');
      return;
    }
    if (creating) return;
    setCreating(true);
    setAddError(null);
    try {
      await createStudent(name, formToProfile(addForm));
      setAddForm(EMPTY_FORM);
      if (keepAdding) {
        toast('학생을 추가했습니다. 이어서 등록하세요.', 'positive');
      } else {
        setAddOpen(false);
        toast('학생을 추가했습니다.', 'positive');
      }
      void load();
    } catch (err) {
      setAddError(
        err instanceof Error ? err.message : '학생을 추가하지 못했습니다.',
      );
    } finally {
      setCreating(false);
    }
  };

  const openDetail = (s: StudentRow) => {
    setDetail(s);
    setDetailForm(formFromStudent(s));
    setShowSubs(false);
    setDetailSubs(null);
  };

  const saveDetail = async () => {
    if (!detail || detailSaving) return;
    if (!detailForm.name.trim()) {
      toast('이름은 비울 수 없습니다.', 'critical');
      return;
    }
    setDetailSaving(true);
    try {
      await updateStudentProfile(detail.id, {
        name: detailForm.name,
        ...formToProfile(detailForm),
        // 학년을 비운 경우 명시적으로 초기화
        ...(detailForm.schoolLevel ? {} : { schoolLevel: null as never }),
        ...(detailForm.grade ? {} : { grade: null as never }),
      });
      toast('학생 정보를 저장했습니다.', 'positive');
      setDetail(null);
      void load();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '저장에 실패했습니다.',
        'critical',
      );
    } finally {
      setDetailSaving(false);
    }
  };

  const loadDetailSubs = async () => {
    if (!detail) return;
    setShowSubs(true);
    if (detailSubs) return;
    try {
      setDetailSubs(await listStudentSubmissions(detail.id));
    } catch {
      setDetailSubs([]);
    }
  };

  const runSingle = async (
    action: 'trash' | 'restore' | 'purge',
    student: StudentRow,
  ) => {
    if (acting) return;
    setActing(true);
    try {
      await studentTrashAction(action, student.id);
      toast(
        action === 'trash'
          ? `${student.name} 학생을 퇴원 처리했습니다.`
          : action === 'restore'
            ? `${student.name} 학생을 재원으로 복귀했습니다.`
            : `${student.name} 학생을 영구 삭제했습니다.`,
        'positive',
      );
      setDetail(null);
      setPurgeTarget(null);
      void load();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : '처리에 실패했습니다.',
        'critical',
      );
    } finally {
      setActing(false);
    }
  };

  const runBulk = async () => {
    if (!bulkConfirm || bulkRunning) return;
    setBulkRunning(true);
    const ids = [...selectedIds];
    let ok = 0;
    for (const id of ids) {
      try {
        await studentTrashAction(bulkConfirm, id);
        ok += 1;
      } catch {
        /* 개별 실패는 결과 요약에서 안내 */
      }
    }
    toast(
      bulkConfirm === 'trash'
        ? `${ok}명 퇴원 처리했습니다.`
        : `${ok}명 재원으로 복귀했습니다.`,
      ok === ids.length ? 'positive' : 'critical',
    );
    setBulkConfirm(null);
    setBulkRunning(false);
    void load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">학생 관리</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            학생 정보와 재원 상태를 관리하세요.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {assignedPens.length > 0 && (
            <ActionButton
              variant="neutralOutline"
              onClick={() => setBulkReleaseOpen(true)}
            >
              <span className="inline-flex items-center gap-1.5">
                <BluetoothOff size={15} /> 전체 펜 회수 ({assignedPens.length})
              </span>
            </ActionButton>
          )}
          {isDesk() && (
            <ActionButton
              variant="neutralOutline"
              onClick={() => setBlePenOpen(true)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Bluetooth size={15} /> 펜 연결하기
              </span>
            </ActionButton>
          )}
          <ActionButton variant="brandSolid" onClick={() => setAddOpen(true)}>
            <span className="inline-flex items-center gap-1.5">
              <UserPlus size={16} /> 학생 추가
            </span>
          </ActionButton>
        </div>
      </div>

      {blePenOpen && (
        <BlePenDialog students={students} onClose={() => setBlePenOpen(false)} />
      )}

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3">
        <TokenSelect
          aria-label="정렬"
          value={sortKey}
          onValueChange={(v) => setSortKey(v as SortKey)}
        >
          <option value="upload">{STUDENT_SORT_LABEL.upload}</option>
          <option value="recent">{STUDENT_SORT_LABEL.recent}</option>
          <option value="name">{STUDENT_SORT_LABEL.name}</option>
        </TokenSelect>

        <RadioChipRoot
          aria-label="학교급 필터"
          className="flex items-center gap-1.5"
          value={levelFilter}
          onValueChange={(v) => setLevelFilter(v as LevelFilter)}
        >
          <RadioChipItem value="all">
            <ChipLabel>전체</ChipLabel>
          </RadioChipItem>
          <RadioChipItem value="초">
            <ChipLabel>초</ChipLabel>
          </RadioChipItem>
          <RadioChipItem value="중">
            <ChipLabel>중</ChipLabel>
          </RadioChipItem>
          <RadioChipItem value="고">
            <ChipLabel>고</ChipLabel>
          </RadioChipItem>
        </RadioChipRoot>

        <SegmentedControl
          value={tab}
          onValueChange={(v) => {
            setTab((v as 'active' | 'withdrawn') ?? 'active');
            setSelectedIds(new Set());
          }}
          className="w-fit"
        >
          <SegmentedControlItem value="active">
            재원생 ({activeCount})
          </SegmentedControlItem>
          <SegmentedControlItem value="withdrawn">
            퇴원생 ({withdrawnCount})
          </SegmentedControlItem>
        </SegmentedControl>

        <span className="text-sm text-ink-muted">{visible.length}명</span>

        <div className="ml-auto flex items-center gap-2 rounded-lg border border-line-solid bg-layer-default px-3 py-2">
          <Search size={14} className="text-ink-subtle" />
          <input
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="학생 이름 검색"
            className="w-36 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
          />
        </div>
      </div>

      {/* 선택 액션 바 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-brand bg-brand-weak/40 px-4 py-2.5">
          <span className="text-sm font-semibold text-ink">
            {selectedIds.size}명 선택됨
          </span>
          {tab === 'active' ? (
            <ActionButton
              variant="neutralOutline"
              size="small"
              onClick={() => setBulkConfirm('trash')}
            >
              선택 학생 퇴원 처리
            </ActionButton>
          ) : (
            <ActionButton
              variant="neutralOutline"
              size="small"
              onClick={() => setBulkConfirm('restore')}
            >
              선택 학생 재원 복귀
            </ActionButton>
          )}
          <button
            type="button"
            className="ml-auto text-xs text-ink-subtle hover:text-ink"
            onClick={() => setSelectedIds(new Set())}
          >
            선택 해제
          </button>
        </div>
      )}

      {error ? (
        <div className="max-w-2xl space-y-3">
          <Callout tone="warning" title="서버 준비 중" description={error} />
          <ActionButton variant="neutralWeak" size="small" onClick={() => void load()}>
            다시 시도
          </ActionButton>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-line-weak bg-layer-default">
          <EmptyState
            illustration="inbox"
            size="sm"
            title={
              students.length === 0
                ? '아직 등록된 학생이 없습니다'
                : '조건에 맞는 학생이 없습니다'
            }
            description={
              students.length === 0
                ? '학생 추가 버튼으로 첫 학생을 등록해보세요.'
                : '검색어나 필터를 바꿔보세요.'
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line-weak bg-layer-default">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-line-weak text-xs text-ink-subtle">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="전체 선택"
                    checked={allChecked}
                    onChange={toggleAll}
                    className="h-4 w-4 accent-[var(--seed-color-bg-brand-solid,#F84A28)]"
                  />
                </th>
                <th className="px-3 py-3 font-medium">학년</th>
                <th className="px-3 py-3 font-medium">상태</th>
                <th className="px-3 py-3 font-medium">학생 이름</th>
                <th className="px-3 py-3 font-medium">학생 연락처</th>
                <th className="px-3 py-3 font-medium">학부모 연락처</th>
                <th className="px-3 py-3 font-medium">학교</th>
                <th className="px-3 py-3 font-medium">펜</th>
                <th className="px-3 py-3 text-right font-medium">상세</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-line-weak last:border-b-0 hover:bg-neutral-weak/50"
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={`${s.name} 선택`}
                      checked={selectedIds.has(s.id)}
                      onChange={() => toggleOne(s.id)}
                      className="h-4 w-4 accent-[var(--seed-color-bg-brand-solid,#F84A28)]"
                    />
                  </td>
                  <td className="px-3 py-3 font-medium text-ink">{gradeLabel(s)}</td>
                  <td className="px-3 py-3">
                    <Badge
                      size="medium"
                      variant="weak"
                      tone={s.deletedAt ? 'critical' : 'positive'}
                    >
                      {s.deletedAt ? '퇴원' : '재원'}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <div className="font-semibold text-ink">{s.name}</div>
                  </td>
                  <td className="px-3 py-3 text-ink-muted">
                    {s.studentPhone || '-'}
                  </td>
                  <td className="px-3 py-3 text-ink-muted">
                    {s.parentPhone || '-'}
                  </td>
                  <td className="px-3 py-3 text-ink-muted">{s.school || '-'}</td>
                  <td className="px-3 py-3">
                    {s.hasPen ? (
                      <Badge size="medium" variant="weak" tone="informative">
                        보유
                      </Badge>
                    ) : (
                      <span className="text-ink-subtle">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <StudentAiMini studentId={s.id} summary={aiSummary[s.id]} />
                      <ActionButton
                        variant="neutralWeak"
                        size="xsmall"
                        onClick={() => navigate(`/t/students/${s.id}/notes`)}
                      >
                        필기 기록
                        {(recordDays[s.id] ?? 0) > 0 && (
                          <span className="ml-1 font-bold text-brand">
                            {recordDays[s.id]}일
                          </span>
                        )}
                        {/* 마지막 업로드가 언제인지 — 방금 받은 학생을 눈으로 찾게 */}
                        {uploadAgoLabel(lastUploadAt[s.id]) && (
                          <span
                            data-testid="last-upload"
                            className="ml-1 font-normal text-ink-subtle"
                          >
                            · {uploadAgoLabel(lastUploadAt[s.id])}
                          </span>
                        )}
                      </ActionButton>
                      <ActionButton
                        variant="neutralOutline"
                        size="xsmall"
                        onClick={() => openDetail(s)}
                      >
                        상세보기
                      </ActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 학생 추가 — 우측 슬라이드 (화면 고정) */}
      <Drawer
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) {
            setAddForm(EMPTY_FORM);
            setAddError(null);
            setKeepAdding(false);
          }
        }}
        title="학생 개별 등록"
        description="학생 이름과 학년을 입력해 등록하세요."
        footer={
          <>
            <ActionButton
              type="button"
              variant="ghost"
              onClick={() => setAddOpen(false)}
            >
              취소
            </ActionButton>
            <div className="flex-1" />
            <label className="flex cursor-pointer items-center gap-2 text-ink-muted">
              <input
                type="checkbox"
                checked={keepAdding}
                onChange={(e) => setKeepAdding(e.currentTarget.checked)}
                className="h-4 w-4 accent-[var(--seed-color-bg-brand-solid,#0071e3)]"
              />
              계속 학생 등록하기
            </label>
            <ActionButton
              type="button"
              variant="brandSolid"
              loading={creating}
              disabled={!addForm.name.trim() || !addForm.schoolLevel || !addForm.grade}
              onClick={() => void submitCreate()}
            >
              등록하기
            </ActionButton>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCreate();
          }}
        >
          <ProfileFields
            form={addForm}
            setForm={(u) => setAddForm(u)}
            nameAutoFocus
            singleColumn
          />
          {addError && (
            <div className="mt-2">
              <Callout tone="critical" description={addError} />
            </div>
          )}
        </form>
      </Drawer>

      {/* 상세보기 — 우측 슬라이드 (화면 고정) */}
      <Drawer
        open={detail !== null}
        onOpenChange={(o) => !o && setDetail(null)}
        title={
          detail && (
            <span className="flex items-center gap-2">
              {detail.name}
              <Badge
                size="medium"
                variant="weak"
                tone={detail.deletedAt ? 'critical' : 'positive'}
              >
                {detail.deletedAt ? '퇴원' : '재원'}
              </Badge>
            </span>
          )
        }
        description={detail && `등록 ${formatDate(detail.createdAt)}`}
        footer={
          detail && (
            <>
              {detail.deletedAt ? (
                <>
                  <ActionButton
                    type="button"
                    variant="neutralOutline"
                    size="small"
                    loading={acting}
                    onClick={() => void runSingle('restore', detail)}
                  >
                    재원 복귀
                  </ActionButton>
                  <ActionButton
                    type="button"
                    variant="neutralOutline"
                    size="small"
                    onClick={() => setPurgeTarget(detail)}
                  >
                    영구 삭제
                  </ActionButton>
                </>
              ) : (
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  size="small"
                  loading={acting}
                  onClick={() => void runSingle('trash', detail)}
                >
                  퇴원 처리
                </ActionButton>
              )}
              <div className="flex-1" />
              <ActionButton
                type="button"
                variant="brandSolid"
                loading={detailSaving}
                onClick={() => void saveDetail()}
              >
                저장
              </ActionButton>
            </>
          )
        }
      >
        {detail && (
          <div className="space-y-4">
            <ProfileFields
              form={detailForm}
              setForm={(u) => setDetailForm(u)}
              singleColumn
            />

            {/* 펜 데이터 (제출 목록) */}
            <div className="border border-line-weak">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-ink hover:bg-neutral-weak"
                onClick={() => (showSubs ? setShowSubs(false) : void loadDetailSubs())}
              >
                펜 데이터 (제출 기록)
                <span className="text-xs text-ink-subtle">
                  {showSubs ? '접기' : '펼치기'}
                </span>
              </button>
              {showSubs && (
                <div className="max-h-56 overflow-y-auto border-t border-line-weak">
                  {detailSubs === null ? (
                    <div className="p-4 text-sm text-ink-subtle">불러오는 중…</div>
                  ) : detailSubs.length === 0 ? (
                    <div className="p-4 text-sm text-ink-subtle">
                      아직 제출된 필기가 없습니다.
                    </div>
                  ) : (
                    detailSubs.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => {
                          setDetail(null);
                          navigate(`/t/submissions/${sub.id}`);
                        }}
                        className="flex w-full items-center justify-between border-b border-line-weak px-4 py-2.5 text-left last:border-b-0 hover:bg-neutral-weak"
                      >
                        <span className="truncate text-sm text-ink">{sub.title}</span>
                        <span className="ml-3 shrink-0 text-xs text-ink-subtle">
                          {formatDate(sub.createdAt)}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* 전체 펜 회수 확인 — 해제될 목록을 보여주고 확인받는다 */}
      <AlertDialogRoot
        open={bulkReleaseOpen}
        onOpenChange={(o) => !o && setBulkReleaseOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              정말 전체 펜을 회수할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              배정된 펜 {assignedPens.length}개가 모두 학생에게서 해제됩니다.
              해제 전 미저장 필기는 자동으로 저장 마감돼요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-56 space-y-1 overflow-y-auto py-2">
            {assignedPens.map((pen) => (
              <div
                key={pen.mac}
                className="flex items-center justify-between border border-line-weak bg-layer-fill px-3 py-2 text-sm"
              >
                <span className="font-semibold text-ink">펜 {pen.penNumber}</span>
                <span className="text-ink-muted">
                  {pen.assignment?.studentName} 사용 중 → 회수
                </span>
              </div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="neutralWeak"
              onClick={() => setBulkReleaseOpen(false)}
            >
              취소
            </AlertDialogAction>
            <AlertDialogAction
              variant="criticalSolid"
              loading={bulkReleasing}
              onClick={() => void submitBulkRelease()}
            >
              전체 회수
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      {/* 일괄 퇴원/복귀 확인 */}
      <AlertDialogRoot
        open={bulkConfirm !== null}
        onOpenChange={(o) => !o && setBulkConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkConfirm === 'trash'
                ? `${selectedIds.size}명을 퇴원 처리할까요?`
                : `${selectedIds.size}명을 재원으로 복귀할까요?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkConfirm === 'trash'
                ? '퇴원 학생은 재원생 목록에서 빠지지만 필기 데이터는 유지되며, 퇴원생 탭에서 언제든 복귀할 수 있습니다.'
                : '선택한 학생들이 재원생 목록으로 돌아옵니다.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="neutralWeak"
              onClick={() => setBulkConfirm(null)}
            >
              취소
            </AlertDialogAction>
            <AlertDialogAction
              variant={bulkConfirm === 'trash' ? 'criticalSolid' : 'brandSolid'}
              loading={bulkRunning}
              onClick={() => void runBulk()}
            >
              {bulkConfirm === 'trash' ? '퇴원 처리' : '재원 복귀'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      {/* 영구 삭제 확인 */}
      <AlertDialogRoot
        open={purgeTarget !== null}
        onOpenChange={(o) => !o && setPurgeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>정말 영구 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {purgeTarget?.name} 학생 정보와 모든 필기 데이터(제출·피드백·
              스토리지)가 완전히 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              variant="neutralWeak"
              onClick={() => setPurgeTarget(null)}
            >
              취소
            </AlertDialogAction>
            <AlertDialogAction
              variant="criticalSolid"
              loading={acting}
              onClick={() => purgeTarget && void runSingle('purge', purgeTarget)}
            >
              영구 삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </div>
  );
}
