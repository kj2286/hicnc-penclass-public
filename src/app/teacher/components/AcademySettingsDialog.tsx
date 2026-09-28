/**
 * 학원 설정 — GNB 이름 옆 톱니(원장 전용)로 여는 다이얼로그.
 *
 * ① 나의 정보: 가입 시 입력한 정보(이름·이메일·전화번호·학원명·위치·가입일) 열람
 *    — 원장(가입자)만. 사용자 선생님은 원장이 계정을 만들어줘서 이 화면이 없다.
 * ② 학원 로고·테마: 로고 텍스트/이미지·사이드바 색 — 소속 선생님 전원 적용.
 *
 * (기존 선생님 관리 페이지의 [학원 로고·테마]에서 이동해 왔다 —
 *  당시 TextFieldInput 을 TextField 밖에서 단독 사용해 열자마자 에러가 났던
 *  버그도 이 컴포넌트로 옮기며 수정.)
 */
import { Fragment, useRef, useState } from 'react';
import { kstShortDate } from '@/lib/kst';
import { Image } from 'lucide-react';
import { ActionButton } from 'seed-design/ui/action-button';
import { Switch } from 'seed-design/ui/switch';
import { Callout } from 'seed-design/ui/callout';
import { TextField, TextFieldInput } from 'seed-design/ui/text-field';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { updateMyAcademy, uploadAcademyLogo } from '@/lib/api';
import { siteUrl } from '@/lib/academy-site';
import { useSessionStore } from '@/store/session.store';

// 학원 대표색 견본 — 애플 시스템 색 계열. 첫 칸이 기본값(애플 블루)이다.
const PRESET_COLORS = [
  '#0071e3', // 블루 (기본)
  '#5856d6', // 인디고
  '#af52de', // 퍼플
  '#ff2d55', // 핑크
  '#ff3b30', // 레드
  '#ff9500', // 오렌지
  '#34c759', // 그린
  '#00a2b3', // 틸
  '#1d1d1f', // 잉크
];

export function AcademySettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const profile = useSessionStore((s) => s.profile);
  const academy = useSessionStore((s) => s.academy);
  const refreshProfile = useSessionStore((s) => s.refreshProfile);
  // 빠른 시작의 내부 로그인 주소는 계정 안내에 표시하지 않는다.
  const quickStartAccount = profile?.username?.endsWith('@hicnc-penclass.invalid') ?? false;

  const [acadName, setAcadName] = useState<string | null>(null);
  const [logoText, setLogoText] = useState<string | null>(null);
  const [themeColor, setThemeColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [siteCopied, setSiteCopied] = useState(false);
  const [promptToggleBusy, setPromptToggleBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 열 때마다 저장값에서 시작 (null = 아직 편집 안 함)
  const acadNameValue = acadName ?? academy?.name ?? '';
  const logoTextValue = logoText ?? academy?.logoText ?? '';
  const themeColorValue = themeColor ?? academy?.themeColor ?? '';

  const close = (next: boolean) => {
    if (!next) {
      setAcadName(null);
      setLogoText(null);
      setThemeColor(null);
      setError(null);
      setSavedNote(false);
      if (fileRef.current) fileRef.current.value = '';
    }
    onOpenChange(next);
  };

  const save = async () => {
    if (saving) return;
    const color = themeColorValue.trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
      setError('색상은 #RRGGBB 형식이어야 합니다. (예: #0071e3)');
      return;
    }
    if (!acadNameValue.trim()) {
      setError('학원명을 입력해주세요.');
      return;
    }
    setSaving(true);
    setError(null);
    setSavedNote(false);
    try {
      let logoImageUrl: string | null | undefined;
      const file = fileRef.current?.files?.[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024) {
          throw new Error('로고 이미지는 2MB 이하로 올려주세요.');
        }
        logoImageUrl = await uploadAcademyLogo(file);
      }
      await updateMyAcademy({
        name: acadNameValue.trim(),
        logoText: logoTextValue.trim() || null,
        themeColor: color || null,
        ...(logoImageUrl !== undefined ? { logoImageUrl } : {}),
      });
      await refreshProfile(); // academy 재로드 → GNB 즉시 반영
      if (fileRef.current) fileRef.current.value = '';
      setSavedNote(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const removeLogoImage = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateMyAcademy({ logoImageUrl: null });
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : '삭제에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>학원 설정</DialogTitle>
          <DialogDescription>
            {academy?.name ?? '우리 학원'} · 원장님 전용
          </DialogDescription>
        </DialogHeader>

        {/* ── 나의 정보 (가입 정보 열람) ── */}
        <section>
          <h3 className="mb-2 text-sm font-bold text-ink">나의 정보</h3>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 border border-line-weak bg-layer-basement p-3 text-sm">
            {(
              [
                ['이름', profile?.name ?? '—'],
                quickStartAccount
                  ? ['접속 방식', '빠른 시작']
                  : ['이메일(아이디)', profile?.username ?? '—'],
                ['전화번호', profile?.phone ?? '—'],
                ['학원명', academy?.name ?? '—'],
                ['학원 위치', academy?.location ?? '—'],
                [
                  '가입일',
                  profile?.createdAt ? kstShortDate(profile.createdAt) : '—',
                ],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-ink-subtle">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </Fragment>
            ))}
          </dl>
        </section>

        {/* ── 학원 전용 홈페이지 (017) — 주소는 우리가 정해 드린다(읽기 전용) ── */}
        <section className="mt-4 space-y-2 border-t border-line-weak pt-4">
          <h3 className="text-sm font-bold text-ink">학원 전용 홈페이지</h3>
          {academy?.slug && academy.sitePublishedAt ? (
            <>
              <p className="text-xs text-ink-muted">
                선생님들께 이 주소를 안내해주세요. 여기서 로그인하고 프로그램도
                내려받을 수 있습니다.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate border border-line-weak bg-layer-basement px-3 py-2 text-xs text-ink">
                  {siteUrl(window.location.origin, academy.slug)}
                </code>
                <ActionButton
                  variant="neutralOutline"
                  size="small"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      siteUrl(window.location.origin, academy.slug!),
                    );
                    setSiteCopied(true);
                    window.setTimeout(() => setSiteCopied(false), 2000);
                  }}
                >
                  {siteCopied ? '복사됨' : '복사'}
                </ActionButton>
              </div>
            </>
          ) : (
            <p className="text-xs text-ink-muted">
              홈페이지를 준비 중입니다. 완성되면 이 자리에 주소가 표시됩니다.
            </p>
          )}
        </section>

        {/* ── 교재·문항별 AI 프롬프트 (021) ── */}
        <section className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-ink">
              교재·문항별 AI 프롬프트 별도 설정
            </h3>
            <Switch
              checked={Boolean(academy?.customPromptsEnabled)}
              disabled={promptToggleBusy}
              aria-label="교재·문항별 AI 프롬프트 별도 설정"
              onCheckedChange={(v) => {
                setPromptToggleBusy(true);
                setError(null);
                void updateMyAcademy({ customPromptsEnabled: v })
                  .then(() => {
                    // 세션의 학원 정보도 즉시 갱신 — 교재 만들기 버튼이 바로 나타난다
                    useSessionStore.setState((st) =>
                      st.academy
                        ? { academy: { ...st.academy, customPromptsEnabled: v } }
                        : {},
                    );
                  })
                  .catch((e: unknown) => {
                    const msg = e instanceof Error ? e.message : String(e);
                    setError(
                      /custom_prompts_enabled|column|schema/i.test(msg)
                        ? '이 기능은 021 마이그레이션(supabase/021_paper_prompts.sql) 적용 후 사용할 수 있습니다.'
                        : msg,
                    );
                  })
                  .finally(() => setPromptToggleBusy(false));
              }}
            />
          </div>
          <p className="text-xs leading-relaxed text-ink-muted">
            켜면 <b className="text-ink">교재 만들기</b>의 각 교재에서 교재
            전체/문항별 AI 프롬프트를 직접 정의할 수 있어요 — 우리 학원만의 평가
            기준이 채점·과정 분석·리포트에 반영됩니다. 끄면 수학비서가 제공하는
            공통 프롬프트로 동작합니다.
          </p>
        </section>

        {/* ── 학원 로고·테마 ── */}
        <section className="mt-4 space-y-4">
          <h3 className="text-sm font-bold text-ink">학원 로고·테마</h3>
          <TextField
            label="학원명"
            description="관리자 화면·가입 안내 등 모든 곳에 표시되는 공식 학원명입니다."
          >
            <TextFieldInput
              value={acadNameValue}
              onChange={(e) => setAcadName(e.currentTarget.value)}
              placeholder="학원명"
            />
          </TextField>
          <TextField
            label="로고 텍스트"
            description="이미지가 있으면 이미지 아래에 함께 표시돼요. 비우면 이미지만 표시되고, 이미지도 없으면 학원명이 표시됩니다."
          >
            <TextFieldInput
              value={logoTextValue}
              onChange={(e) => setLogoText(e.currentTarget.value)}
              placeholder={academy?.name ?? '학원명'}
            />
          </TextField>
          <div>
            <p className="mb-2 text-sm font-medium text-ink">
              <Image size={14} className="mr-1 inline" />
              로고 이미지 (PNG·JPG·SVG · 2MB 이하)
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="block w-full text-sm text-ink-muted"
            />
            {academy?.logoImageUrl && (
              <div className="mt-2 flex items-center gap-3">
                <img
                  src={academy.logoImageUrl}
                  alt="현재 로고"
                  className="max-h-10 border border-line-weak bg-layer-basement p-1"
                />
                <button
                  type="button"
                  className="text-xs text-critical underline"
                  onClick={() => void removeLogoImage()}
                >
                  이미지 제거 (텍스트로 표시)
                </button>
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-medium text-ink">포인트 컬러</p>
            <p className="mb-2 mt-0.5 text-xs leading-relaxed text-ink-muted">
              학원 대표색입니다. <b className="text-ink">선택된 메뉴</b>와{' '}
              <b className="text-ink">확정 버튼</b>(학생 추가·저장 등)이 이 색으로
              바뀝니다.
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`색상 ${c}`}
                  className="h-8 w-8 border"
                  style={{
                    background: c,
                    borderColor:
                      themeColorValue.toLowerCase() === c ? '#111' : '#d8d8d0',
                    outline:
                      themeColorValue.toLowerCase() === c
                        ? '2px solid #111'
                        : 'none',
                  }}
                  onClick={() => setThemeColor(c)}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <TextField label="직접 입력" className="flex-1">
                <TextFieldInput
                  value={themeColorValue}
                  onChange={(e) => setThemeColor(e.currentTarget.value)}
                  placeholder="#0071e3"
                />
              </TextField>
              <button
                type="button"
                className="mt-5 shrink-0 text-xs text-ink-subtle underline"
                onClick={() => setThemeColor('')}
              >
                기본색
              </button>
            </div>
          </div>
          {error && <Callout tone="critical" description={error} />}
          {savedNote && (
            <Callout tone="positive" description="저장했습니다 — 사이드바에 바로 적용됩니다." />
          )}
          <div className="flex justify-end gap-2">
            <ActionButton variant="neutralWeak" onClick={() => close(false)}>
              닫기
            </ActionButton>
            <ActionButton
              variant="brandSolid"
              loading={saving}
              onClick={() => void save()}
            >
              저장
            </ActionButton>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
