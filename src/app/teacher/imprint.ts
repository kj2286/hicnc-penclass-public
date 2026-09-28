/**
 * Ncode 발급 형상(Imprint args) 중 UI 가 노출하는 부분 — **용지 크기 + DPI** —
 * 의 프레젠테이션 모델과 직렬화 헬퍼. (POC admin/imprint.ts 에서 이식)
 *
 * UI 는 프리셋 드롭다운(A4 / B4 / Letter / 직접입력 / 자동)과 DPI 토글(600 /
 * 1200)을 다루고, 제출 시 `buildImprintArgs` 로 `ImprintArgs`(ngs-client 의
 * 와이어 타입)를 만들어 업로드(최초 등록)에 사용합니다. dotMode/bold 는
 * 노출하지 않고 서버 기본값에 위임합니다.
 */

import type { ImprintArgs, PdfPage } from '@/lib/ngs-client';

export type PaperPresetId =
  | 'auto'
  | 'a4'
  | 'b4'
  | 'letter'
  | 'note272x394'
  | 'custom';

export type PaperPreset = {
  id: PaperPresetId;
  label: string;
  /** mm 단위 고정 치수 — `auto`/`custom` 은 없음. */
  widthMm?: number;
  heightMm?: number;
};

/**
 * 선택 가능한 용지 프리셋. `auto` 는 용지 인자를 보내지 않아 서버 기본(A4 자동)에
 * 위임하고, `custom` 은 사용자가 W×H(mm)를 직접 입력합니다.
 */
export const PAPER_PRESETS: PaperPreset[] = [
  { id: 'auto', label: '자동 (서버 기본 · A4)' },
  { id: 'a4', label: 'A4 (210 × 297)', widthMm: 210, heightMm: 297 },
  { id: 'b4', label: 'B4 (257 × 364)', widthMm: 257, heightMm: 364 },
  { id: 'letter', label: 'Letter (216 × 279)', widthMm: 215.9, heightMm: 279.4 },
  { id: 'note272x394', label: '노트 (272 × 394)', widthMm: 272, heightMm: 394 },
  { id: 'custom', label: '직접 입력 (W × H mm)' },
];

export const DPI_OPTIONS = [600, 1200] as const;
export type ImprintDpi = (typeof DPI_OPTIONS)[number];

/** UI 입력 상태 — 컨트롤은 모두 문자열/선택값으로 보관합니다. */
export type ImprintFormValue = {
  paper: PaperPresetId;
  /** custom 선택 시의 가로(mm) 원시 입력. */
  customWidthMm: string;
  /** custom 선택 시의 세로(mm) 원시 입력. */
  customHeightMm: string;
  dpi: ImprintDpi;
};

/** 신규 등록 다이얼로그의 기본값 — 자동 용지 + 600dpi. */
export const DEFAULT_IMPRINT_FORM: ImprintFormValue = {
  paper: 'auto',
  customWidthMm: '',
  customHeightMm: '',
  dpi: 600,
};

export function paperPreset(id: PaperPresetId): PaperPreset {
  return PAPER_PRESETS.find((p) => p.id === id) ?? PAPER_PRESETS[0];
}

/** 두 mm 치수가 같은 용지인지(부동소수 허용오차) 판정. */
function sameMm(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5;
}

export type BuildImprintResult =
  | { ok: true; args: ImprintArgs }
  | { ok: false; error: string };

/**
 * UI 상태를 `ImprintArgs` 로 변환합니다. custom 치수가 비었거나 0 이하/숫자가
 * 아니면 실패를 돌려줘 호출자가 인라인 에러를 표시할 수 있게 합니다. `auto` 는
 * 용지 인자를 생략(서버 기본)하지만 DPI 는 항상 포함합니다.
 */
export function buildImprintArgs(value: ImprintFormValue): BuildImprintResult {
  const args: ImprintArgs = { imprintDpi: value.dpi };

  if (value.paper === 'custom') {
    const w = Number(value.customWidthMm);
    const h = Number(value.customHeightMm);
    if (
      !value.customWidthMm.trim() ||
      !value.customHeightMm.trim() ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      w <= 0 ||
      h <= 0
    ) {
      return {
        ok: false,
        error: '용지 크기(가로·세로 mm)를 0보다 큰 숫자로 입력해주세요.',
      };
    }
    args.paperWidthMm = w;
    args.paperHeightMm = h;
    return { ok: true, args };
  }

  if (value.paper !== 'auto') {
    const preset = paperPreset(value.paper);
    // 프리셋은 항상 치수를 갖지만 타입 안전을 위해 가드합니다.
    if (preset.widthMm != null && preset.heightMm != null) {
      args.paperWidthMm = preset.widthMm;
      args.paperHeightMm = preset.heightMm;
    }
  }
  return { ok: true, args };
}

/**
 * 사람이 읽는 용지 크기 요약("272 × 394 mm" / "자동").
 */
export function describePaper(value: ImprintFormValue): string {
  if (value.paper === 'auto') return '자동 (A4)';
  if (value.paper === 'custom') {
    const w = value.customWidthMm.trim() || '?';
    const h = value.customHeightMm.trim() || '?';
    return `${w} × ${h} mm`;
  }
  const preset = paperPreset(value.paper);
  return `${preset.widthMm} × ${preset.heightMm} mm`;
}

/**
 * 기존 페이지의 imprint args 로부터 편집 폼 초기값을 복원합니다. 알려진 프리셋과
 * 치수가 일치하면 그 프리셋을, 아니면 custom(해당 치수)을, 치수 정보가 없으면
 * auto 를 선택합니다. DPI 는 저장값(600/1200)을 따르되 없으면 600.
 */
export function imprintFormFromPage(
  page: Pick<
    PdfPage,
    'paperWidthMm' | 'paperHeightMm' | 'imprintDpi'
  > | null | undefined,
): ImprintFormValue {
  const dpi: ImprintDpi = page?.imprintDpi === 1200 ? 1200 : 600;
  const w = page?.paperWidthMm;
  const h = page?.paperHeightMm;
  if (w == null || h == null) {
    return { ...DEFAULT_IMPRINT_FORM, dpi };
  }
  const match = PAPER_PRESETS.find(
    (p) =>
      p.widthMm != null &&
      p.heightMm != null &&
      sameMm(p.widthMm, w) &&
      sameMm(p.heightMm, h),
  );
  if (match) {
    return { paper: match.id, customWidthMm: '', customHeightMm: '', dpi };
  }
  return {
    paper: 'custom',
    customWidthMm: String(w),
    customHeightMm: String(h),
    dpi,
  };
}
