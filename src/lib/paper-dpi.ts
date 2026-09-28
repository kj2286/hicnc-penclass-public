/**
 * 교재에 입힌 ncode 해상도 읽기 — 순수 함수.
 *
 * 왜 필요한가: 목록만 봐서는 이 교재가 600dpi 로 발급됐는지 1200dpi 인지 알 수 없다
 * (사용자 요구 2026-09-05: "어떤 게 600인지 1200인지 모르겠다"). 해상도는 인쇄물의
 * ncode 크기를 정하므로, 다시 인쇄하거나 프린터를 고를 때 반드시 알아야 한다.
 *
 * 주의: NGS 목록(`/pdfs`)에는 pages 가 없다 — 해상도는 상세(`/pdfs/{id}`)에만 있다.
 * 그래서 화면이 교재마다 상세를 한 번씩 읽고 캐시한다.
 */

/** 페이지에 기록된 발급 형상 중 우리가 쓰는 값 */
type DpiPage = {
  /** 발급 해상도 (BE PR #29 이후). 구발급분에는 없다 */
  imprintDpi?: number | null;
  /** 미리보기 렌더 해상도 — 발급 해상도가 아니다(보통 150) */
  dpi?: number | null;
  /** 발급할 때 지정한 용지 크기 (mm) */
  paperWidthMm?: number | null;
  paperHeightMm?: number | null;
};

/** 교재 한 권의 발급 형상 — 목록 배지가 쓰는 값 */
export type PaperGeometry = {
  dpi: number | null;
  widthMm: number | null;
  heightMm: number | null;
};

/** 우리가 발급에 쓰는 두 해상도 */
export const IMPRINT_DPIS = [600, 1200] as const;
export type ImprintDpiValue = (typeof IMPRINT_DPIS)[number];

/**
 * 교재의 발급 해상도. 페이지마다 다르면(있을 수 없지만 방어) 가장 낮은 값을 쓴다 —
 * 인쇄 품질은 가장 낮은 쪽에 맞춰 판단해야 안전하다.
 *
 * 🚨 `dpi` 필드로 넘어가지 않는다. 그건 미리보기 렌더 해상도(150)라, 그걸 보여주면
 * 모든 교재가 150dpi 로 보인다.
 */
export function readImprintDpi(
  pages: readonly DpiPage[] | null | undefined,
): number | null {
  if (!pages || pages.length === 0) return null;
  const found = pages
    .map((p) => p.imprintDpi)
    .filter((v): v is number => typeof v === 'number' && v > 0);
  if (found.length === 0) return null;
  return Math.min(...found);
}

/** 화면 표기 — "1200dpi". 모르면 null 이라 호출부가 아무것도 안 그린다. */
export function dpiLabel(dpi: number | null | undefined): string | null {
  return typeof dpi === 'number' && dpi > 0 ? `${dpi}dpi` : null;
}

/**
 * 해상도를 고른 이유를 한 줄로 — 목록 배지의 title(툴팁)에 쓴다.
 * 숫자만 보여주면 "그래서 뭐가 다른데" 가 남는다.
 */
export function dpiHint(dpi: number | null | undefined): string | undefined {
  if (dpi === 1200) {
    return '1200dpi — 점이 촘촘해 필기 정밀도가 높습니다. 1200dpi 를 지원하는 프린터로 인쇄해야 합니다.';
  }
  if (dpi === 600) {
    return '600dpi — 일반 사무용 프린터로 인쇄할 수 있습니다.';
  }
  return undefined;
}

/** 캐시 키 — 발급 해상도는 발급 시점에 정해져 바뀌지 않는다(형상 수정은 드물다) */
export const DPI_CACHE_KEY = 'wp_paper_dpi_v1';

export function parseDpiCache(raw: string | null): Map<number, number> {
  if (!raw) return new Map();
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out = new Map<number, number>();
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      const dpi = Number(v);
      if (Number.isFinite(id) && Number.isFinite(dpi) && dpi > 0) out.set(id, dpi);
    }
    return out;
  } catch {
    return new Map();
  }
}

export function serializeDpiCache(map: ReadonlyMap<number, number>): string {
  return JSON.stringify(Object.fromEntries([...map].map(([k, v]) => [String(k), v])));
}

/**
 * 발급 형상(해상도 + 용지)을 함께 읽는다.
 *
 * 용지는 **업로드할 때 고른 값**이 페이지에 그대로 남는다. 목록에서 이걸 안 보여주면
 * "내가 B4 로 뽑았던가 A4 였던가" 를 매번 상세로 들어가 확인해야 한다
 * (사용자 요구 2026-09-07: "지정한 용지 사이즈가 리스트에 같이 보여야 한다").
 */
export function readPaperGeometry(
  pages: readonly DpiPage[] | null | undefined,
): PaperGeometry {
  const dpi = readImprintDpi(pages);
  const first = (pages ?? []).find(
    (p) => typeof p.paperWidthMm === 'number' && typeof p.paperHeightMm === 'number',
  );
  return {
    dpi,
    widthMm: typeof first?.paperWidthMm === 'number' ? first.paperWidthMm : null,
    heightMm: typeof first?.paperHeightMm === 'number' ? first.paperHeightMm : null,
  };
}

/** 캐시 값 — 해상도만 담던 v1 에서 용지까지 담는 v2 로 넓혔다 */
export const GEOMETRY_CACHE_KEY = 'wp_paper_geom_v2';

export function parseGeometryCache(raw: string | null): Map<number, PaperGeometry> {
  if (!raw) return new Map();
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out = new Map<number, PaperGeometry>();
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      if (!Number.isFinite(id) || !v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      const num = (x: unknown) =>
        typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null;
      const geo: PaperGeometry = {
        dpi: num(o.d),
        widthMm: num(o.w),
        heightMm: num(o.h),
      };
      // 아무 값도 없는 항목은 캐시에 둘 이유가 없다
      if (geo.dpi != null || geo.widthMm != null) out.set(id, geo);
    }
    return out;
  } catch {
    return new Map();
  }
}

export function serializeGeometryCache(
  map: ReadonlyMap<number, PaperGeometry>,
): string {
  return JSON.stringify(
    Object.fromEntries(
      [...map].map(([k, v]) => [
        String(k),
        { d: v.dpi, w: v.widthMm, h: v.heightMm },
      ]),
    ),
  );
}
