/**
 * pdf-meta 순수 함수 회귀 테스트 — 바이트 표기·용지 판별·한 줄 요약.
 * (readPdfMeta 는 pdfjs·브라우저가 필요해 여기서 부르지 않는다.)
 */
import {
  describePdf,
  formatBytes,
  paperLabel,
  ptToMm,
} from '../src/lib/pdf-meta';

let fail = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`FAIL  ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}
function eq(actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${a} !== ${b}`);
}

test('바이트 표기 — 단위가 올라가고 자릿수는 짧게', () => {
  eq(formatBytes(0), '0B');
  eq(formatBytes(512), '512B');
  eq(formatBytes(1024), '1KB');
  eq(formatBytes(1536), '1.5KB');
  eq(formatBytes(3.2 * 1024 * 1024), '3.2MB');
  eq(formatBytes(120 * 1024 * 1024), '120MB');
  eq(formatBytes(2 * 1024 ** 3), '2GB');
});

test('바이트 표기 — 이상한 값은 하이픈', () => {
  eq(formatBytes(Number.NaN), '-');
  eq(formatBytes(-1), '-');
});

test('pt → mm', () => {
  eq(Math.round(ptToMm(595)), 210); // A4 폭
  eq(Math.round(ptToMm(842)), 297); // A4 높이
});

test('용지 판별 — A4·A3·B5·Letter', () => {
  eq(paperLabel(210, 297), 'A4');
  eq(paperLabel(297, 420), 'A3');
  eq(paperLabel(182, 257), 'B5');
  eq(paperLabel(216, 279), 'Letter');
});

test('용지 판별 — 가로 방향은 "가로" 를 붙인다', () => {
  eq(paperLabel(297, 210), 'A4 가로');
});

test('용지 판별 — 스캔 오차 ±3mm 는 봐주고, 그 밖은 null', () => {
  eq(paperLabel(212, 295), 'A4');
  eq(paperLabel(200, 280), null);
});

test('한 줄 요약 — 쪽수·용지·크기', () => {
  eq(
    describePdf({ pages: 12, widthMm: 210, heightMm: 297, bytes: 3.2 * 1024 * 1024 }),
    '12쪽 · A4 (210×297mm) · 3.2MB',
  );
});

test('한 줄 요약 — 규격 밖이면 치수만', () => {
  eq(
    describePdf({ pages: 1, widthMm: 200, heightMm: 280, bytes: 1024 }),
    '1쪽 · 200×280mm · 1KB',
  );
});

console.log(fail === 0 ? '\n=== 9/9 ===' : `\n=== 실패 ${fail} ===`);
if (fail > 0) process.exit(1);
