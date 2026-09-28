/**
 * 학원 전용 홈페이지 — 주소(slug) 규칙과 업로드 HTML 후처리. 순수 함수.
 *
 * 흐름:
 *   1. 학원이 하이씨앤씨 펜클래스에 가입 → slug 를 정한다
 *   2. 클로드로 만든 홈페이지 프로젝트 폴더를 ZIP 으로 압축해 업로드
 *   3. 업로드 시 index.html 을 후처리 — [로그인]·[프로그램 다운로드] 자리를 채운다
 *   4. 방문자는 /h/{slug} 로 본다 (iframe 안에서 Storage 공개 URL 을 띄운다)
 *
 * 홈페이지는 우리가 만들지 않은 파일이라 **다른 출처(Supabase Storage)에서 띄운다.**
 * 그래서 홈페이지의 JS 가 우리 로그인 세션을 건드릴 수 없다. 로그인·다운로드 링크만
 * `target="_top"` 으로 최상위 창을 옮긴다.
 */

/** 홈페이지 HTML 이 심어두는 자리 표시자 — 업로드할 때 우리가 내용을 채운다. */
export const SLOT_LOGIN = 'penclass-login';
export const SLOT_DOWNLOAD = 'penclass-download';

/** 데스크 앱 최신 설치파일 (버전이 올라가도 주소는 그대로) */
export const DESK_DOWNLOAD = {
  mac: '',
  windows: '',
} as const;

/**
 * 학원 이름에서 주소로 쓸 slug 후보를 만든다.
 *
 * 한글 학원명이 대부분이라 음역까지는 하지 않는다 — 한글을 그대로 두면 주소가
 * 퍼센트 인코딩되어 흉해지므로, **영문·숫자만 남기고 없으면 빈 문자열**을 준다.
 * (빈 문자열이면 관리자가 직접 정하도록 UI 가 유도한다.)
 */
export function suggestSlug(academyName: string): string {
  return academyName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** slug 로 쓸 수 있는 값인지. 주소에 그대로 들어가므로 보수적으로 본다. */
export function validateSlug(slug: string): string | null {
  if (!slug) return '주소를 입력해주세요.';
  if (slug.length < 2) return '주소는 2글자 이상이어야 합니다.';
  if (slug.length > 40) return '주소는 40글자 이하여야 합니다.';
  if (!/^[a-z0-9-]+$/.test(slug))
    return '영문 소문자·숫자·하이픈(-)만 쓸 수 있습니다.';
  if (/^-|-$/.test(slug)) return '하이픈으로 시작하거나 끝날 수 없습니다.';
  // 우리 앱의 최상위 경로와 겹치면 홈페이지가 앱을 가린다
  const reserved = new Set([
    'login', 'signup', 'admin', 'api', 'a', 't', 's', 'h', 'auth',
    'static', 'assets', 'www',
  ]);
  if (reserved.has(slug)) return '이미 쓰이는 주소입니다. 다른 주소를 써주세요.';
  return null;
}

/** 방문자에게 알려줄 홈페이지 전체 주소 */
export function siteUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/h/${slug}`;
}

/** ZIP 안에서 첫 화면으로 쓸 파일을 고른다. 없으면 null. */
export function pickEntryFile(paths: readonly string[]): string | null {
  const html = paths.filter((p) => /\.html?$/i.test(p));
  if (html.length === 0) return null;
  // 가장 얕은 곳의 index.html 을 우선 — ZIP 이 폴더째 압축된 경우가 많다
  const depth = (p: string) => p.split('/').length;
  const indexes = html.filter((p) => /(^|\/)index\.html?$/i.test(p));
  const pool = indexes.length > 0 ? indexes : html;
  return [...pool].sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
}

/**
 * ZIP 경로에서 공통 최상위 폴더를 벗겨낸다.
 *
 * 폴더를 통째로 압축하면 `내학원홈페이지/index.html` 처럼 한 겹이 더 생긴다.
 * 그대로 올리면 주소에 그 폴더명이 남아 지저분하므로, **모든 파일이 같은 폴더
 * 아래 있을 때만** 그 겹을 벗긴다. (파일이 흩어져 있으면 손대지 않는다.)
 */
export function stripCommonRoot(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  const first = paths[0].split('/');
  if (first.length < 2) return '';
  const root = first[0] + '/';
  return paths.every((p) => p.startsWith(root)) ? root : '';
}

/**
 * 업로드한 index.html 에 로그인·다운로드 버튼을 채워 넣는다.
 *
 * 자리 표시자(`<div id="penclass-login">`)가 있으면 그 안을 채우고, 없으면
 * 아무것도 하지 않는다 — 홈페이지 디자인을 우리가 멋대로 바꾸지 않는다.
 * 대신 자리 표시자가 하나도 없으면 호출부가 경고를 띄운다(hasSlot 참고).
 *
 * @param loginHref 로그인 화면 주소 (학원 컨텍스트 포함)
 */
export function injectSlots(html: string, loginHref: string): string {
  let out = html;
  out = fillSlot(
    out,
    SLOT_LOGIN,
    `<a href="${escapeAttr(loginHref)}" target="_top" rel="noopener">로그인</a>`,
  );
  out = fillSlot(
    out,
    SLOT_DOWNLOAD,
    '<span>하이씨앤씨 PC 설치 파일 준비 중</span>',
  );
  return out;
}

/** 자리 표시자가 하나라도 있는지 — 없으면 로그인·다운로드가 안 생긴다 */
export function hasSlot(html: string): { login: boolean; download: boolean } {
  return {
    login: slotRe(SLOT_LOGIN).test(html),
    download: slotRe(SLOT_DOWNLOAD).test(html),
  };
}

// `<div id="penclass-login"> ... </div>` 의 안쪽을 바꾼다.
// 태그 이름은 무엇이든(div·section·nav) 허용하되, 같은 태그로 닫히는 것만 본다.
function slotRe(id: string): RegExp {
  return new RegExp(
    `(<([a-z0-9-]+)([^>]*\\bid=["']${id}["'][^>]*)>)([\\s\\S]*?)(</\\2>)`,
    'i',
  );
}

function fillSlot(html: string, id: string, inner: string): string {
  return html.replace(slotRe(id), (_m, open: string, _tag, _attrs, _old, close: string) =>
    `${open}${inner}${close}`,
  );
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
