/**
 * ncode 발급 해상도 읽기 회귀 테스트.
 * 미리보기 렌더 해상도(dpi=150)를 발급 해상도로 오인하지 않는 것이 핵심이다.
 */
import {
  dpiHint,
  dpiLabel,
  parseDpiCache,
  parseGeometryCache,
  readImprintDpi,
  readPaperGeometry,
  serializeDpiCache,
  serializeGeometryCache,
} from '../src/lib/paper-dpi';

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

test('발급 해상도를 읽는다', () => {
  eq(readImprintDpi([{ imprintDpi: 1200, dpi: 150 }]), 1200);
  eq(readImprintDpi([{ imprintDpi: 600, dpi: 150 }]), 600);
});

test('미리보기 렌더 해상도(dpi)로 넘어가지 않는다', () => {
  // 이걸 놓치면 모든 교재가 150dpi 로 보인다
  eq(readImprintDpi([{ dpi: 150 }]), null);
});

test('페이지마다 다르면 낮은 쪽 — 인쇄 품질은 최저값에 맞춘다', () => {
  eq(readImprintDpi([{ imprintDpi: 1200 }, { imprintDpi: 600 }]), 600);
});

test('구발급분·빈 입력은 null', () => {
  eq(readImprintDpi([]), null);
  eq(readImprintDpi(null), null);
  eq(readImprintDpi([{}]), null);
});

test('표기·설명', () => {
  eq(dpiLabel(1200), '1200dpi');
  eq(dpiLabel(null), null);
  eq(dpiLabel(0), null);
  if (!dpiHint(1200)?.includes('1200dpi 를 지원하는')) throw new Error('1200 설명 없음');
  if (!dpiHint(600)?.includes('일반 사무용')) throw new Error('600 설명 없음');
  eq(dpiHint(null), undefined);
});

test('캐시 직렬화 — 깨진 값은 버리고 산다', () => {
  const m = new Map([
    [126, 1200],
    [125, 600],
  ]);
  eq(parseDpiCache(serializeDpiCache(m)), m);
  eq(parseDpiCache('깨진 JSON'), new Map());
  eq(parseDpiCache(null), new Map());
  eq(parseDpiCache('{"a":"b","7":0}'), new Map());
});

test('발급 형상 — 해상도와 용지를 함께 읽는다', () => {
  eq(
    readPaperGeometry([{ imprintDpi: 1200, paperWidthMm: 257, paperHeightMm: 364 }]),
    { dpi: 1200, widthMm: 257, heightMm: 364 },
  );
});

test('용지만 있거나 해상도만 있어도 읽는다', () => {
  eq(readPaperGeometry([{ paperWidthMm: 210, paperHeightMm: 297 }]), {
    dpi: null,
    widthMm: 210,
    heightMm: 297,
  });
  eq(readPaperGeometry([{ imprintDpi: 600 }]), {
    dpi: 600,
    widthMm: null,
    heightMm: null,
  });
  eq(readPaperGeometry([]), { dpi: null, widthMm: null, heightMm: null });
});

test('용지가 비어 있는 페이지는 건너뛰고 값이 있는 페이지를 쓴다', () => {
  eq(
    readPaperGeometry([{ imprintDpi: 600 }, { paperWidthMm: 257, paperHeightMm: 364 }]),
    { dpi: 600, widthMm: 257, heightMm: 364 },
  );
});

test('형상 캐시 — 왕복과 깨진 값 방어', () => {
  const m = new Map([
    [126, { dpi: 1200, widthMm: 257, heightMm: 364 }],
    [125, { dpi: 1200, widthMm: 215.9, heightMm: 279.4 }],
  ]);
  eq(parseGeometryCache(serializeGeometryCache(m)), m);
  eq(parseGeometryCache('깨짐'), new Map());
  eq(parseGeometryCache(null), new Map());
  // 값이 하나도 없는 항목은 버린다
  eq(parseGeometryCache('{"7":{"d":null,"w":null,"h":null}}'), new Map());
});

console.log(fail === 0 ? '\n=== 10/10 ===' : `\n=== 실패 ${fail} ===`);
if (fail > 0) process.exit(1);
