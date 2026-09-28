/**
 * 업로드 전에 PDF 를 훑어보는 헬퍼 — 크기·쪽수·용지 규격.
 *
 * 왜 필요한가: ncode 발급은 **쪽 단위로 한도를 먹는다**(하루 200쪽, 실패도 소비).
 * 고른 파일이 몇 쪽인지 모르고 올리면 한도를 통째로 날리고서야 안다. 용지 규격도
 * 마찬가지다 — A4 가 아닌 원고를 A4 로 발급하면 인쇄물의 ncode 좌표가 어긋난다.
 * 그래서 고르는 순간 화면에 보여준다 (사용자 요구 2026-09-04).
 *
 * 쪽수·크기 읽기는 pdfjs 를 **지연 로딩**한다(번들 2MB). 순수 계산(용지 판별·
 * 바이트 표기)은 이 파일 위쪽에 두어 node 테스트가 그대로 부른다.
 */

/** 1pt = 1/72 inch */
const MM_PER_PT = 25.4 / 72;

export function ptToMm(pt: number): number {
  return pt * MM_PER_PT;
}

/** 바이트를 사람이 읽는 크기로 — 1024 기준, 소수 한 자리(1KB 미만은 정수) */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10}${units[i]}`;
}

type PaperSpec = { label: string; w: number; h: number };

/** 자주 쓰는 용지 (mm, 세로 기준) */
const PAPERS: PaperSpec[] = [
  { label: 'A3', w: 297, h: 420 },
  { label: 'A4', w: 210, h: 297 },
  { label: 'A5', w: 148, h: 210 },
  { label: 'B4', w: 257, h: 364 },
  { label: 'B5', w: 182, h: 257 },
  { label: 'Letter', w: 216, h: 279 },
  { label: 'Legal', w: 216, h: 356 },
];

/**
 * mm 크기를 용지 이름으로. 가로/세로 어느 쪽이든 맞으면 같은 규격으로 본다.
 * 스캔본은 몇 mm 씩 어긋나므로 ±3mm 까지 봐준다. 못 맞추면 null.
 */
export function paperLabel(widthMm: number, heightMm: number): string | null {
  const w = Math.min(widthMm, heightMm);
  const h = Math.max(widthMm, heightMm);
  for (const p of PAPERS) {
    if (Math.abs(w - p.w) <= 3 && Math.abs(h - p.h) <= 3) {
      return widthMm > heightMm ? `${p.label} 가로` : p.label;
    }
  }
  return null;
}

/** 사람이 읽는 한 줄 요약 — "12쪽 · A4 · 3.2MB" */
export function describePdf(meta: {
  pages: number;
  widthMm: number;
  heightMm: number;
  bytes: number;
}): string {
  const label = paperLabel(meta.widthMm, meta.heightMm);
  const size = `${Math.round(meta.widthMm)}×${Math.round(meta.heightMm)}mm`;
  return [`${meta.pages}쪽`, label ? `${label} (${size})` : size, formatBytes(meta.bytes)].join(' · ');
}

export type PdfMeta = {
  pages: number;
  /** 1쪽 기준 (회전 반영) */
  widthMm: number;
  heightMm: number;
  bytes: number;
  /** 쪽마다 크기가 다르면 true — 발급 용지를 하나로 고르기 어렵다 */
  mixedSizes: boolean;
};

/**
 * PDF 파일을 열어 쪽수와 1쪽 크기를 읽는다. 최대 40쪽까지만 크기를 대조해
 * (그 이상은 느리기만 하다) 쪽마다 규격이 다른지 본다.
 *
 * 읽기 전용이다 — 파일을 바꾸지 않는다. 암호가 걸렸거나 깨진 파일이면 던진다.
 */
export async function readPdfMeta(file: File): Promise<PdfMeta> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const first = await doc.getPage(1);
  // getViewport(scale 1) 는 회전을 반영한 실제 표시 크기를 준다
  const v = first.getViewport({ scale: 1 });
  const widthMm = ptToMm(v.width);
  const heightMm = ptToMm(v.height);

  let mixedSizes = false;
  const check = Math.min(doc.numPages, 40);
  for (let i = 2; i <= check; i += 1) {
    const pv = (await doc.getPage(i)).getViewport({ scale: 1 });
    if (Math.abs(pv.width - v.width) > 2 || Math.abs(pv.height - v.height) > 2) {
      mixedSizes = true;
      break;
    }
  }
  return {
    pages: doc.numPages,
    widthMm,
    heightMm,
    bytes: file.size,
    mixedSizes,
  };
}

/** 드롭·선택된 파일이 PDF 인가 — 확장자와 MIME 둘 다 본다(브라우저마다 다르다) */
export function isPdfFile(file: File): boolean {
  return /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
}
