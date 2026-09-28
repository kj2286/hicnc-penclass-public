/**
 * 학원 홈페이지 주소·업로드 규칙 회귀 테스트.
 *
 * 여기서 틀리면 학원 홈페이지 주소가 깨지거나(=원장님께 준 링크가 죽음),
 * 로그인·다운로드 버튼이 안 생긴다.
 */
import {
  hasSlot,
  injectSlots,
  pickEntryFile,
  siteUrl,
  stripCommonRoot,
  suggestSlug,
  validateSlug,
} from '../src/lib/academy-site';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    pass += 1;
    console.log(`PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${extra === undefined ? '' : ` — ${String(extra)}`}`);
  }
}

// ─── slug ───
ok('영문 학원명은 그대로 slug', suggestSlug('Hangang Math') === 'hangang-math');
ok('기호는 하이픈으로', suggestSlug('A+ 수학!!') === 'a');
ok('한글만 있으면 빈 값 (관리자가 직접 정하게)', suggestSlug('한강수학') === '');

ok('빈 주소 거부', validateSlug('') !== null);
ok('한 글자 거부', validateSlug('a') !== null);
ok('대문자 거부', validateSlug('Hangang') !== null);
ok('한글 거부', validateSlug('한강') !== null);
ok('하이픈으로 시작 거부', validateSlug('-abc') !== null);
ok('하이픈으로 끝 거부', validateSlug('abc-') !== null);
ok('정상 주소 통과', validateSlug('hangang-math-1') === null);
ok('앱 경로와 겹치는 주소 거부 (login)', validateSlug('login') !== null);
ok('앱 경로와 겹치는 주소 거부 (t)', validateSlug('t') !== null);

ok(
  '홈페이지 주소 조립',
  siteUrl('https://academy.example.test/', 'hangang') ===
    'https://academy.example.test/h/hangang',
);

// ─── ZIP 구조 ───
ok(
  '폴더째 압축하면 공통 최상위를 벗긴다',
  stripCommonRoot(['site/index.html', 'site/css/a.css']) === 'site/',
);
ok(
  '파일이 흩어져 있으면 손대지 않는다',
  stripCommonRoot(['index.html', 'css/a.css']) === '',
);
ok('빈 목록은 빈 문자열', stripCommonRoot([]) === '');

ok(
  '가장 얕은 index.html 을 첫 화면으로',
  pickEntryFile(['about/index.html', 'index.html']) === 'index.html',
);
ok(
  'index 가 없으면 html 중 가장 얕은 것',
  pickEntryFile(['pages/main.html']) === 'pages/main.html',
);
ok('html 이 없으면 null', pickEntryFile(['style.css', 'logo.png']) === null);

// ─── 자리 표시자 채우기 ───
{
  const html =
    '<html><body><nav id="penclass-login">여기에 로그인</nav>' +
    '<div id="penclass-download"></div></body></html>';
  const s = hasSlot(html);
  ok('자리 표시자 탐지', s.login && s.download);

  const out = injectSlots(html, '/login?academy=hangang');
  ok('로그인 링크 삽입', out.includes('href="/login?academy=hangang"'), out);
  ok('최상위 창으로 이동 (iframe 안에 갇히지 않게)', out.includes('target="_top"'));
  ok('미배포 설치본 안내', out.includes('하이씨앤씨 PC 설치 파일 준비 중'));
  ok('원본 설치본 링크 없음', !out.includes('WorldPenclass-latest'));
  ok('원래 자리 안의 내용은 대체된다', !out.includes('여기에 로그인'));
  ok('감싼 태그는 유지된다', out.includes('<nav id="penclass-login">'));
}

{
  // 자리 표시자가 없으면 홈페이지를 건드리지 않는다
  const html = '<html><body><h1>우리 학원</h1></body></html>';
  const s = hasSlot(html);
  ok('자리 표시자 없음을 알린다', !s.login && !s.download);
  ok('없으면 원본 그대로', injectSlots(html, '/login') === html);
}

{
  // 주소에 따옴표가 섞여도 속성이 깨지지 않아야 한다
  const html = '<div id="penclass-login"></div>';
  const out = injectSlots(html, '/login?a="x"');
  ok('링크 주소를 이스케이프한다', out.includes('&quot;'), out);
}

console.log(`\n=== ${pass}/${pass + fail} ===`);
if (fail > 0) process.exit(1);
