/**
 * 선생님 대시보드 — 담당 학생 수 / 학원 보유 펜(볼펜·샤프 구분) / 최근 만든 교재.
 * 교재는 PDF 다운로드 + [업로드](교재 만들기 페이지 이동)를 제공한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@seed-design/react';
import { BookOpen, Download, PenTool, Upload, Users } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Callout } from 'seed-design/ui/callout';
import {
  listAcademyPens,
  listMyStudents,
  PEN_KIND_LABEL,
  type PenRow,
} from '@/lib/api';
import { downloadNcodedPdf, listAllPdfs, type Pdf } from '@/lib/ngs-client';
import { listMyPaperOwnership, visiblePapers } from '@/lib/paper-owners';
import { useToast } from '../components/toast';
import { formatDate } from '../format';
import { PortalHero } from '@/components/PortalHero';
import { useSessionStore } from '@/store/session.store';

type Summary = {
  studentCount: number;
  pens: PenRow[];
};

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rt-card p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-ink-muted">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-weak text-brand">
          {icon}
        </span>
        {label}
      </div>
      <div className="ap-num mt-3 text-[28px] font-semibold leading-none text-ink">
        {value.toLocaleString('ko-KR')}
      </div>
      {hint && <div className="mt-2 text-[12px] text-ink-subtle">{hint}</div>}
    </div>
  );
}

/** 보유 펜 힌트 — 종류별 개수. 미지정은 있을 때만 표기한다. */
function penKindHint(pens: PenRow[]): string {
  const n = (k: PenRow['kind']) => pens.filter((p) => p.kind === k).length;
  const parts = [
    `${PEN_KIND_LABEL.ballpen} ${n('ballpen')}`,
    `${PEN_KIND_LABEL.sharp} ${n('sharp')}`,
  ];
  if (n('') > 0) parts.push(`미지정 ${n('')}`);
  return parts.join(' · ');
}

export function DashboardPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const profile = useSessionStore((s) => s.profile);
  const [data, setData] = useState<Summary | null>(null);
  const [papers, setPapers] = useState<Pdf[] | null>(null);
  const [papersError, setPapersError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [students, pens] = await Promise.all([
        listMyStudents(),
        listAcademyPens().catch(() => [] as PenRow[]),
      ]);
      setData({
        studentCount: students.filter((s) => !s.deletedAt).length,
        pens,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : '데이터를 불러오지 못했습니다.',
      );
    } finally {
      setLoading(false);
    }
    // 교재 목록은 NGS 릴레이 — 느리거나 실패해도 대시보드는 막지 않는다
    try {
      const [pdfs, ownership] = await Promise.all([
        listAllPdfs(),
        listMyPaperOwnership().catch(() => ({
          active: null,
          trashed: new Map<number, string>(),
        })),
      ]);
      // 교재 만들기 목록과 **같은 규칙**을 쓴다 — 여기만 따로 필터를 쓰다가
      // 휴지통 교재가 대시보드에 남는 식으로 어긋난다.
      const mine = visiblePapers(pdfs, ownership);
      mine.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      setPapers(mine.slice(0, 5));
      setPapersError(false);
    } catch {
      setPapers([]);
      setPapersError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="max-w-2xl space-y-4">
        <Callout
          tone="warning"
          title="서버 준비 중"
          description={`데이터를 불러오지 못했습니다. 서버가 아직 준비 중이거나 네트워크 문제가 있을 수 있어요. (${error})`}
        />
        <ActionButton variant="neutralWeak" size="small" onClick={() => void load()}>
          다시 시도
        </ActionButton>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PortalHero
        title={<>{profile?.name ?? '선생님'}, 오늘의 교실</>}
        subtitle="담당 학생·학원 펜·교재를 한눈에 보고, 크래들로 필기를 수신합니다."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {loading || !data ? (
          <>
            <Skeleton className="h-[122px] rounded-2xl" />
            <Skeleton className="h-[122px] rounded-2xl" />
          </>
        ) : (
          <>
            <StatCard
              icon={<Users size={16} />}
              label="학생"
              value={data.studentCount}
              hint="내가 담당하는 재원 학생 수"
            />
            <StatCard
              icon={<PenTool size={16} />}
              label="보유 펜"
              value={data.pens.length}
              hint={
                data.pens.length > 0
                  ? penKindHint(data.pens)
                  : '크래들 (PC)에서 펜을 등록하세요'
              }
            />
          </>
        )}
      </div>

      <section className="rt-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line-weak px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">최근 만든 교재</h2>
          <div className="flex items-center gap-2">
            <ActionButton
              variant="ghost"
              size="xsmall"
              onClick={() => navigate('/t/papers')}
            >
              교재 관리로
            </ActionButton>
            <ActionButton
              variant="brandSolid"
              size="xsmall"
              onClick={() => navigate('/t/papers')}
            >
              <span className="inline-flex items-center gap-1">
                <Upload size={13} /> 업로드
              </span>
            </ActionButton>
          </div>
        </div>

        {papers == null ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
            <Skeleton className="h-14 rounded-lg" />
          </div>
        ) : papers.length > 0 ? (
          <ul>
            {papers.map((p) => (
              <li key={p.id} className="ap-row">
                <div className="flex min-h-[56px] w-full items-center gap-4 px-5 py-2.5">
                  <img
                    alt=""
                    src={`/api/download-pdf?id=${p.id}&kind=page&page=1`}
                    className="h-12 w-9 shrink-0 rounded border border-line-weak bg-layer-fill object-cover"
                    loading="lazy"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">
                      {p.title || `교재 ${p.id}`}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-subtle">
                      {p.pageCount}쪽 · {formatDate(String(p.createdAt))}
                    </div>
                  </div>
                  <ActionButton
                    variant="neutralOutline"
                    size="xsmall"
                    onClick={() => {
                      const ok = downloadNcodedPdf(p);
                      if (!ok)
                        toast(
                          'NCode PDF 발급이 아직 진행 중입니다. 잠시 후 다시 시도해주세요.',
                          'critical',
                        );
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Download size={13} /> PDF
                    </span>
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <BookOpen size={28} className="text-ink-subtle" />
            <p className="text-sm font-medium text-ink">
              {papersError
                ? '교재 목록을 불러오지 못했습니다'
                : '아직 만든 교재가 없습니다'}
            </p>
            <p className="text-xs text-ink-subtle">
              {papersError
                ? '네트워크 문제일 수 있어요. 잠시 후 새로고침해 주세요.'
                : 'PDF를 업로드하면 NCode 교재가 만들어지고 여기에서 바로 내려받을 수 있어요.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
