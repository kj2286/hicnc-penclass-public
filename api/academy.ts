/**
 * 학원 회원체계 API — Vercel 함수 수 제한 때문에 액션 3종을 한 엔드포인트로 묶는다.
 *   · signup         : 학원 자가 가입 (인증 불필요) — 학원 + 대표자 선생님 생성
 *   · create-teacher : 대표자가 사용자 선생님 생성 (임시 비밀번호 자동 생성, 강제 변경)
 *   · delete-teacher : 대표자가 사용자 선생님 삭제 (주담당 학생이 있으면 차단)
 */
import { generatePassword, requireCaller, serviceClient } from './_lib.js';
import { quickStart } from './_quick-start.js';
import { paperExplorer } from './_paper-explorer.js';

type Req = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  query?: Record<string, string | string[] | undefined>;
};
type Res = {
  status: (code: number) => Res;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  send: (body: string | Buffer) => void;
};

const STUDENT_LEVELS = ['초', '중', '고', '재수생', '기타'] as const;

/** 가입·선생님 비밀번호 정책: 8~16자, 대문자·소문자·특수문자 각 1개 이상 */
function validateAcademyPassword(pw: string): string | null {
  if (pw.length < 8 || pw.length > 16) return '비밀번호는 8~16자여야 합니다.';
  if (!/[A-Z]/.test(pw)) return '비밀번호에 대문자를 1개 이상 포함해주세요.';
  if (!/[a-z]/.test(pw)) return '비밀번호에 소문자를 1개 이상 포함해주세요.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return '비밀번호에 특수문자(!@# 등)를 1개 이상 포함해주세요.';
  return null;
}

/** 휴대폰 형식(01x, 10~11자리)만 검증 — 인증번호 발송은 SMS 업체 연동 시 추가 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(digits)) return null;
  return digits;
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function str(body: Record<string, unknown> | undefined, key: string): string {
  const v = body?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 학습분석 리포트 **공유 링크** — 로그인 없이 읽기 전용 JSON 을 준다
 * (사용자 요구 2026-08-26: "누구든 접근할 수 있게").
 *
 * 🔒 주의: 링크를 가진 사람은 **학생 이름·점수·문항별 결과를 전부 본다.**
 *    제출 id(UUID)를 모르면 닿을 수 없는 "비공개 링크" 방식이다 — 목록을
 *    제공하지 않고, 쓰기도 절대 하지 않는다. 링크가 새면 그 리포트는 공개된 것과
 *    같으니, 학부모 공유처럼 필요한 곳에만 건넬 것.
 */
async function servePublicReport(req: Req, res: Res, submissionId: string) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
    res.status(400).json({ error: '잘못된 주소입니다.' });
    return;
  }
  const admin = serviceClient();
  const { data: sub } = await admin
    .from('sp_submissions')
    .select('id, student_id')
    .eq('id', submissionId)
    .maybeSingle();
  if (!sub) {
    res.status(404).json({ error: '리포트를 찾을 수 없습니다.' });
    return;
  }
  const { data: file } = await admin.storage
    .from('sp-strokes')
    .download(`${sub.student_id}/${sub.id}.learn-report.json`);
  if (!file) {
    res.status(404).json({ error: '아직 생성된 리포트가 없습니다.' });
    return;
  }
  let doc: unknown = null;
  try {
    doc = JSON.parse(Buffer.from(await file.arrayBuffer()).toString('utf-8'));
  } catch {
    res.status(500).json({ error: '리포트를 읽지 못했습니다.' });
    return;
  }
  /**
   * 또래 비교(석차·평균·표준편차)는 **서버에서 계산해 함께 내려준다.**
   * 공유 링크에는 로그인이 없어 학생 목록을 못 읽는다 — 화면에서 계산하면
   * 늘 "자료 없음" 이 된다(2026-08-27 QA 에서 잡음).
   *
   * 재료는 **채점 결과(`grade.json`)** 다. 리포트 생성 여부와 무관하게,
   * 같은 시험지를 풀고 채점이 끝난 학생이면 전부 들어간다.
   */
  const setTitle = (t: string) =>
    (t ?? '')
      .replace(/\s*표지\s*/g, '')
      .replace(/\s*문제\s*\d+(?:[-–]\d+)*\s*/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  let classStats: {
    correctCounts: number[];
    students: number;
    byUnit?: Record<string, number>;
  } | null = null;
  try {
    const { data: me } = await admin
      .from('sp_submissions')
      .select('title')
      .eq('id', submissionId)
      .maybeSingle();
    const target = setTitle(me?.title ?? '');
    if (target) {
      const { data: all } = await admin
        .from('sp_submissions')
        .select('id, student_id, title')
        .limit(2000);
      /** 학생 한 명당 한 표 — 같은 세트를 여러 문서로 풀었으면 합쳐 센다 */
      const byStudent = new Map<string, number>();
      /** 단원별 정오 — 레이더의 평균 점선. 단원은 리포트에만 있는 값이다. */
      const unitSum = new Map<string, { correct: number; judged: number }>();
      for (const row of all ?? []) {
        if (setTitle(row.title ?? '') !== target) continue;
        if (row.student_id === sub.student_id) continue; // 본인 제외
        const { data: gf } = await admin.storage
          .from('sp-strokes')
          .download(`${row.student_id}/${row.id}.grade.json`);
        if (!gf) continue;
        try {
          const gc = JSON.parse(
            Buffer.from(await gf.arrayBuffer()).toString('utf-8'),
          ) as { byProblem?: Record<string, { verdict?: string }> };
          const rows = Object.values(gc.byProblem ?? {});
          if (rows.length === 0) continue;
          const ok = rows.filter((g) => g.verdict === 'correct').length;
          byStudent.set(row.student_id, (byStudent.get(row.student_id) ?? 0) + ok);
        } catch {
          /* 깨진 캐시는 건너뛴다 */
        }
        // 단원별 평균 — 다른 학생 리포트가 있으면 모은다
        const { data: rf } = await admin.storage
          .from('sp-strokes')
          .download(`${row.student_id}/${row.id}.learn-report.json`);
        if (!rf) continue;
        try {
          const rep = JSON.parse(
            Buffer.from(await rf.arrayBuffer()).toString('utf-8'),
          ) as { problems?: Array<{ unit?: string; verdict?: string }> };
          for (const pb of rep.problems ?? []) {
            const unit = (pb.unit ?? '').trim();
            if (!unit) continue;
            const cur = unitSum.get(unit) ?? { correct: 0, judged: 0 };
            cur.judged += 1;
            if (pb.verdict === 'correct') cur.correct += 1;
            unitSum.set(unit, cur);
          }
        } catch {
          /* 깨진 리포트는 건너뛴다 */
        }
      }
      if (byStudent.size > 0 || unitSum.size > 0) {
        const byUnit: Record<string, number> = {};
        for (const [unit, v] of unitSum) {
          byUnit[unit] = Math.round((v.correct / v.judged) * 100);
        }
        classStats = {
          correctCounts: [...byStudent.values()],
          students: byStudent.size,
          ...(Object.keys(byUnit).length > 0 ? { byUnit } : {}),
        };
      }
    }
  } catch {
    classStats = null; // 집계 실패는 리포트 자체를 막지 않는다
  }

  res.setHeader('cache-control', 'public, max-age=60, must-revalidate');
  res.status(200).json({ report: doc, classStats });
}

export default async function handler(req: Req, res: Res) {
  // 학원 전용 홈페이지 서빙 — /h/{slug}/* 가 여기로 rewrite 된다 (vercel.json).
  // POST 액션들보다 먼저 본다: 이건 GET 이고 로그인도 필요 없다.
  const site = queryOne(req, 'site');
  if (site) return serveSite(req, res, site);

  // 리포트 공유 링크 — 로그인 없이 읽기만 (위 주석의 주의사항 참고)
  const report = queryOne(req, 'report');
  if (report) return servePublicReport(req, res, report);

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const action = str(req.body, 'action');

  if (action === 'quick-start') return quickStart(req, res);
  if (action === 'paper-explorer') return paperExplorer(req, res);
  if (action === 'signup') return signup(req, res);
  if (action === 'create-teacher') return createTeacher(req, res);
  if (action === 'delete-teacher') return deleteTeacher(req, res);
  if (action === 'upload-logo') return uploadLogo(req, res);
  res.status(400).json({ error: `알 수 없는 action: ${action}` });
}

// ---------- 학원 로고 업로드 (서비스 롤 — 스토리지 RLS 비의존) ----------
const LOGO_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

async function uploadLogo(req: Req, res: Res) {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const { admin, academyId } = owner;

  const contentType = str(req.body, 'contentType');
  const dataBase64 = str(req.body, 'dataBase64');
  const ext = LOGO_MIME[contentType];
  if (!ext) {
    res.status(400).json({ error: '로고는 PNG·JPG·WebP·SVG 만 올릴 수 있습니다.' });
    return;
  }
  if (!dataBase64) {
    res.status(400).json({ error: '파일 데이터가 없습니다.' });
    return;
  }
  const buf = Buffer.from(dataBase64, 'base64');
  if (buf.length === 0 || buf.length > 2 * 1024 * 1024) {
    res.status(400).json({ error: '로고 이미지는 2MB 이하여야 합니다.' });
    return;
  }
  const path = `${academyId}/logo-${Date.now()}.${ext}`;
  const { error } = await admin.storage
    .from('sp-brand')
    .upload(path, buf, { upsert: true, contentType });
  if (error) {
    res.status(500).json({ error: `업로드 실패: ${error.message}` });
    return;
  }
  const { data } = admin.storage.from('sp-brand').getPublicUrl(path);
  res.status(200).json({ url: data.publicUrl });
}

// ---------- 학원 자가 가입 ----------
async function signup(req: Req, res: Res) {
  const name = str(req.body, 'name');
  const email = str(req.body, 'email').toLowerCase();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const academyName = str(req.body, 'academyName');
  const academyLocation = str(req.body, 'academyLocation');
  const phone = normalizePhone(str(req.body, 'phone'));

  if (!name) return void res.status(400).json({ error: '이름을 입력해주세요.' });
  if (!phone)
    return void res.status(400).json({ error: '휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)' });
  if (!academyName) return void res.status(400).json({ error: '학원명을 입력해주세요.' });
  if (!academyLocation) return void res.status(400).json({ error: '학원 위치를 입력해주세요.' });
  if (!isEmail(email)) return void res.status(400).json({ error: '이메일 주소가 올바르지 않습니다.' });
  const pwErr = validateAcademyPassword(password);
  if (pwErr) return void res.status(400).json({ error: pwErr });

  const admin = serviceClient();

  // 같은 번호 중복 가입 안내 (인증 대신의 최소 방어)
  const { data: dupPhone } = await admin
    .from('sp_profiles')
    .select('id')
    .eq('phone', phone)
    .eq('is_academy_owner', true)
    .maybeSingle();
  if (dupPhone) {
    res.status(409).json({ error: '이미 이 휴대폰 번호로 가입된 학원이 있습니다.' });
    return;
  }

  const { data: academy, error: academyError } = await admin
    .from('sp_academies')
    .insert({ name: academyName, location: academyLocation })
    .select('id')
    .single();
  if (academyError || !academy) {
    res.status(500).json({ error: `학원 생성 실패: ${academyError?.message ?? '알 수 없음'}` });
    return;
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role: 'teacher' },
  });
  if (authError || !created?.user) {
    await admin.from('sp_academies').delete().eq('id', academy.id);
    const friendly = /already|registered|exists/i.test(authError?.message ?? '')
      ? '이미 가입된 이메일입니다. 로그인해주세요.'
      : `계정 생성 실패: ${authError?.message ?? '알 수 없음'}`;
    res.status(409).json({ error: friendly });
    return;
  }

  const { error: profileError } = await admin.from('sp_profiles').insert({
    id: created.user.id,
    role: 'teacher',
    name,
    username: email,
    phone,
    academy_id: academy.id,
    is_academy_owner: true,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from('sp_academies').delete().eq('id', academy.id);
    res.status(500).json({ error: `프로필 생성 실패: ${profileError.message}` });
    return;
  }

  res.status(200).json({ id: created.user.id, academyId: academy.id });
}

// ---------- 대표자의 호출 권한 확인 ----------
async function requireOwner(req: Req, res: Res) {
  const gate = await requireCaller(req, ['teacher']);
  if ('error' in gate) {
    res.status(gate.status).json({ error: gate.error });
    return null;
  }
  const { data: me } = await gate.admin
    .from('sp_profiles')
    .select('id, academy_id, is_academy_owner')
    .eq('id', gate.caller.id)
    .maybeSingle();
  if (!me?.is_academy_owner || !me.academy_id) {
    res.status(403).json({ error: '학원 대표자만 사용할 수 있습니다.' });
    return null;
  }
  return { admin: gate.admin, ownerId: me.id as string, academyId: me.academy_id as string };
}

// ---------- 사용자 선생님 생성 ----------
async function createTeacher(req: Req, res: Res) {
  const owner = await requireOwner(req, res);
  if (!owner) return;

  const name = str(req.body, 'name');
  const email = str(req.body, 'email').toLowerCase();
  const phone = normalizePhone(str(req.body, 'phone'));
  const levelsRaw = Array.isArray(req.body?.studentLevels) ? req.body?.studentLevels : [];
  const levels = (levelsRaw as unknown[])
    .filter((v): v is string => typeof v === 'string')
    .filter((v) => (STUDENT_LEVELS as readonly string[]).includes(v));

  if (!name) return void res.status(400).json({ error: '선생님 이름을 입력해주세요.' });
  if (!phone)
    return void res.status(400).json({ error: '휴대폰 번호 형식이 올바르지 않습니다. (예: 010-1234-5678)' });
  if (!isEmail(email)) return void res.status(400).json({ error: '이메일 주소가 올바르지 않습니다.' });
  if (levels.length === 0)
    return void res.status(400).json({ error: '대상 학생(초·중·고·재수생·기타)을 1개 이상 선택해주세요.' });

  const { admin, academyId } = owner;
  const password = generatePassword();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: password,
    email_confirm: true,
    user_metadata: { name, role: 'teacher' },
  });
  if (authError || !created?.user) {
    const friendly = /already|registered|exists/i.test(authError?.message ?? '')
      ? '이미 가입된 이메일입니다. 다른 이메일을 사용해주세요.'
      : `계정 생성 실패: ${authError?.message ?? '알 수 없음'}`;
    res.status(409).json({ error: friendly });
    return;
  }

  const { error: profileError } = await admin.from('sp_profiles').insert({
    id: created.user.id,
    role: 'teacher',
    name,
    username: email,
    phone,
    student_levels: levels,
    academy_id: academyId,
    is_academy_owner: false,
    must_change_password: true,
    temp_password: password,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    res.status(500).json({ error: `프로필 생성 실패: ${profileError.message}` });
    return;
  }

  res.status(200).json({ id: created.user.id, email, tempPassword: password });
}

// ---------- 사용자 선생님 삭제 ----------
async function deleteTeacher(req: Req, res: Res) {
  const owner = await requireOwner(req, res);
  if (!owner) return;
  const { admin, academyId, ownerId } = owner;

  const teacherId = str(req.body, 'teacherId');
  if (!teacherId) return void res.status(400).json({ error: 'teacherId 가 필요합니다.' });
  if (teacherId === ownerId)
    return void res.status(400).json({ error: '대표자 본인 계정은 삭제할 수 없습니다.' });

  const { data: target } = await admin
    .from('sp_profiles')
    .select('id, role, academy_id, is_academy_owner')
    .eq('id', teacherId)
    .maybeSingle();
  if (!target || target.role !== 'teacher' || target.academy_id !== academyId) {
    res.status(404).json({ error: '우리 학원 소속 선생님이 아닙니다.' });
    return;
  }
  if (target.is_academy_owner) {
    res.status(400).json({ error: '대표자 계정은 삭제할 수 없습니다.' });
    return;
  }

  // 주담당 학생이 남아 있으면 삭제 차단 (학생 데이터 고아 방지)
  const { count } = await admin
    .from('sp_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('teacher_id', teacherId)
    .eq('role', 'student');
  if ((count ?? 0) > 0) {
    res.status(409).json({
      error: `이 선생님이 등록한 학생이 ${count}명 있습니다. 학생을 먼저 다른 선생님께 이관하거나 삭제해주세요.`,
    });
    return;
  }

  // 배정(공동 담당) 행은 FK cascade 로 함께 삭제된다
  const { error: delError } = await admin.auth.admin.deleteUser(teacherId);
  if (delError) {
    res.status(500).json({ error: `삭제 실패: ${delError.message}` });
    return;
  }
  res.status(200).json({ ok: true });
}

// ─── 학원 전용 홈페이지 서빙 (017) ───────────────────────────
//
// 왜 우리 함수를 거치는가: Supabase Storage 의 공개 URL 은 HTML 을
// `text/plain` + `Content-Security-Policy: default-src 'none'; sandbox` 로 준다.
// (임의 사이트 호스팅을 막으려는 Supabase 의 정책이다.) 그래서 공개 URL 을
// 그대로 iframe 에 걸면 **아무것도 렌더되지 않는다.** 우리가 읽어서 올바른
// Content-Type 으로 다시 내보내야 홈페이지가 열린다.
//
// 격리: 응답에 `Content-Security-Policy: sandbox ...` 를 실어 문서를 고유
// 출처로 만든다. 업로드된 홈페이지의 JS 가 우리 도메인의 localStorage(로그인
// 세션)를 읽지 못한다. 대신 사용자가 누르는 링크는 최상위로 나갈 수 있다.

/** 확장자 → Content-Type. 틀리면 브라우저가 CSS·JS 를 해석하지 않는다. */
const SITE_MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  txt: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
};

function queryOne(req: Req, key: string): string {
  const direct = req.query?.[key];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct[0] ?? '';
  // query 를 안 채워주는 런타임 대비 — URL 에서 직접 읽는다
  try {
    const u = new URL(req.url ?? '', 'http://x');
    return u.searchParams.get(key) ?? '';
  } catch {
    return '';
  }
}

/** 요청 경로를 스토리지 키로 안전하게 바꾼다. 상위 경로 탈출을 막는다. */
function safeSitePath(raw: string): string {
  const cleaned = decodeURIComponent(raw || '').replace(/^\/+/, '');
  if (!cleaned || cleaned.endsWith('/')) return 'index.html';
  if (cleaned.split('/').some((seg) => seg === '..' || seg === '.')) return '';
  return cleaned;
}

async function serveSite(req: Req, res: Res, slug: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'GET only' });
    return;
  }
  const path = safeSitePath(queryOne(req, 'path'));
  if (!path) {
    res.status(400).json({ error: '잘못된 경로입니다.' });
    return;
  }

  const admin = serviceClient();
  // 게시된 학원만 연다 — 주소만 잡아두고 아직 안 올린 학원은 열리면 안 된다
  const { data: academy } = await admin
    .from('sp_academies')
    .select('id, name')
    .eq('slug', slug)
    .not('site_published_at', 'is', null)
    .maybeSingle();
  if (!academy) {
    res.status(404);
    res.setHeader('Content-Type', SITE_MIME.html);
    res.send(notFoundHtml());
    return;
  }

  const { data: file, error } = await admin.storage
    .from('academy-sites')
    .download(`${slug}/${path}`);
  if (error || !file) {
    // 첫 화면을 못 찾으면 안내, 그 외 파일은 평범한 404
    if (path === 'index.html') {
      res.status(404);
      res.setHeader('Content-Type', SITE_MIME.html);
      res.send(notFoundHtml());
      return;
    }
    res.status(404).json({ error: 'not found' });
    return;
  }

  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  let buf = Buffer.from(await file.arrayBuffer());

  // HTML 이면 **기준 경로(<base>)를 심는다.**
  //
  // 홈페이지는 보통 자산을 상대경로로 참조한다(assets/css/mk.css). 그런데 주소가
  // /h/{slug} 라 끝에 슬래시가 없어서, 브라우저는 이를 /h/ 기준으로 풀어
  // **/h/assets/css/mk.css** 를 찾는다 → CSS·이미지가 통째로 안 붙는다
  // (2026-08-17 MK아카데미 실사고: 스타일 없는 맨 HTML 이 떴다).
  // <base> 를 넣으면 슬래시 유무와 무관하게 항상 이 홈페이지 폴더 기준이 된다.
  if (ext === 'html' || ext === 'htm') {
    buf = Buffer.from(injectBase(buf.toString('utf8'), `/h/${slug}/`), 'utf8');
  }

  res.status(200);
  res.setHeader('Content-Type', SITE_MIME[ext] ?? 'application/octet-stream');
  // 홈페이지를 새로 올렸는데 옛 화면이 보이면 안 된다 — 짧게만 캐시
  res.setHeader('Cache-Control', 'public, max-age=60');
  // 업로드된 문서를 고유 출처로 가둔다(로그인 세션 접근 차단).
  // 링크 클릭으로 최상위 이동은 허용해야 [로그인]·[다운로드] 가 동작한다.
  res.setHeader(
    'Content-Security-Policy',
    'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation',
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // 웹폰트는 CORS 를 반드시 탄다. 위 sandbox 로 문서가 **고유 출처**가 되어
  // Origin: null 로 요청되므로, 허용해 주지 않으면 @font-face 가 차단된다
  // (2026-08-17 MK아카데미: 본문은 떴는데 Pretendard 만 안 붙었다).
  // 이 파일들은 어차피 공개 홈페이지 자산이라 전체 허용해도 위험이 없다.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(buf);
}

/**
 * `<base href>` 를 head 맨 앞에 넣는다. 이미 base 가 있으면 손대지 않는다
 * (홈페이지가 스스로 기준을 정했다면 그 의도를 존중한다).
 */
function injectBase(html: string, href: string): string {
  if (/<base\s/i.test(html)) return html;
  const tag = `<base href="${href}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  }
  // head 가 없는 문서(조각 HTML)도 있다 — 맨 앞에 붙인다
  return tag + html;
}

function notFoundHtml(): string {
  return `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>홈페이지를 찾을 수 없습니다</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;
       background:#f7f7f5;color:#19191c;padding:24px}
  .box{max-width:420px;text-align:center}
  h1{font-size:18px;margin:0 0 8px}
  p{font-size:14px;line-height:1.6;color:#797988;margin:0 0 20px}
  a{display:inline-block;padding:10px 20px;background:#1f4733;color:#fff;text-decoration:none}
</style>
<div class="box">
  <h1>아직 홈페이지가 없습니다</h1>
  <p>주소가 맞는지 확인해주세요.<br>학원 홈페이지는 준비되는 대로 열립니다.</p>
  <a href="/login">하이씨앤씨 펜클래스 로그인</a>
</div></html>`;
}
