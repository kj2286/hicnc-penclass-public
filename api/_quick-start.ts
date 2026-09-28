import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

type RemoteError = { code?: string; status?: number };
type Result<T> = { data: T | null; error: RemoteError | null };
type QuickUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};
type QuickSession = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: QuickUser;
};
type Credentials = { email: string; password: string };
type AuthResult = {
  user: QuickUser | null;
  session: QuickSession | null;
  error: RemoteError | null;
};
export type QuickProfile = {
  id: string;
  role: string;
  academy_id: string | null;
  is_academy_owner: boolean;
  teacher_id: string | null;
  deleted_at: string | null;
};
type NewProfile = QuickProfile & {
  name: string;
  username: string;
  phone: null;
  must_change_password: false;
};
type Academy = { id: string };
export type QuickStartDependencies = {
  signIn: (credentials: Credentials) => Promise<AuthResult>;
  createUser: (input: Credentials & {
    email_confirm: true;
    app_metadata: { hicnc_quick_start: 1 };
    user_metadata: { name: string };
  }) => Promise<Result<QuickUser>>;
  findProfile: (id: string) => Promise<Result<QuickProfile>>;
  findAcademy: (id: string) => Promise<Result<Academy>>;
  insertProfile: (profile: NewProfile) => Promise<{ error: RemoteError | null }>;
  insertAcademy: (academy: Academy & { name: string }) => Promise<{ error: RemoteError | null }>;
  allowCreation: () => boolean;
};
type Req = { method?: string; body?: Record<string, unknown> };
type Res = {
  setHeader: (name: string, value: string) => void;
  status: (code: number) => Res;
  json: (body: unknown) => void;
};

const RETRY_MESSAGE = '빠른 시작을 완료하지 못했습니다. 잠시 후 다시 눌러주세요.';
class QuickStartError extends Error {
  status: number;
  constructor(status: number, message: string = RETRY_MESSAGE) {
    super(message);
    this.status = status;
  }
}

/** The device supplies 256 random bits; separate hashes derive its login identifiers. */
export function quickStartCredentials(secret: unknown): Credentials {
  if (typeof secret !== 'string' || !/^[0-9a-f]{64}$/.test(secret)) {
    throw new QuickStartError(400, '빠른 시작 정보가 올바르지 않습니다.');
  }
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  return {
    email: `pc-${digest(secret).slice(0, 48)}@hicnc-penclass.invalid`,
    password: `Hc1!${digest(`hicnc-penclass:quick-start:password:v1:${secret}`)}`,
  };
}

/** Best effort per process only; this is not a distributed abuse-prevention limit. */
export function createCreationLimiter(now: () => number = Date.now) {
  const capacity = 5;
  const refillMs = 60_000;
  let tokens = capacity;
  let updatedAt = now();
  return () => {
    const current = now();
    tokens = Math.min(capacity, tokens + Math.max(0, current - updatedAt) * capacity / refillMs);
    updatedAt = current;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
const allowCreation = createCreationLimiter();

function authFailure(error: RemoteError | null): never {
  const limited = error?.status === 429 || error?.code === 'over_request_rate_limit';
  throw new QuickStartError(limited ? 429 : 503);
}

function verifyIdentity(user: QuickUser | null, email: string): asserts user is QuickUser {
  if (!user || user.email !== email || user.app_metadata?.hicnc_quick_start !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id)) {
    throw new QuickStartError(409, '빠른 시작 계정을 확인할 수 없습니다. 로그인 화면을 이용해주세요.');
  }
}

function verifyProfile(profile: QuickProfile | null, id: string) {
  if (!profile || profile.id !== id || profile.role !== 'teacher' ||
      profile.academy_id !== id || profile.is_academy_owner !== true ||
      profile.teacher_id !== null || profile.deleted_at !== null) {
    throw new QuickStartError(409, '빠른 시작 교실을 확인할 수 없습니다. 로그인 화면을 이용해주세요.');
  }
}

function verifyAcademy(academy: Academy | null, id: string) {
  if (!academy || academy.id !== id) throw new QuickStartError(409);
}

function requiredRead<T>(result: Result<T>): T | null {
  if (result.error) throw new QuickStartError(503);
  return result.data;
}

function allowInsertConflict(error: RemoteError | null) {
  if (error && error.code !== '23505') throw new QuickStartError(503);
}

export async function startQuickClassroom(secret: unknown, deps: QuickStartDependencies) {
  const credentials = quickStartCredentials(secret);
  let signedIn = await deps.signIn(credentials);
  if (signedIn.error) {
    // Network/server/rate-limit errors must never create an additional identity.
    if (signedIn.error.status === 429 || signedIn.error.code !== 'invalid_credentials') authFailure(signedIn.error);
    if (!deps.allowCreation()) throw new QuickStartError(429);
    const created = await deps.createUser({
      ...credentials,
      email_confirm: true,
      app_metadata: { hicnc_quick_start: 1 },
      user_metadata: { name: '선생님' },
    });
    if (created.error) {
      if (created.error.status === 429 || !['email_exists', 'user_already_exists'].includes(created.error.code ?? '')) {
        authFailure(created.error);
      }
    } else {
      verifyIdentity(created.data, credentials.email);
    }
    // One sign-in retry handles either successful creation or a duplicate race.
    signedIn = await deps.signIn(credentials);
    if (signedIn.error) authFailure(signedIn.error);
  }

  verifyIdentity(signedIn.user, credentials.email);
  const session = signedIn.session;
  if (!session || !session.access_token || !session.refresh_token) throw new QuickStartError(503);
  verifyIdentity(session.user, credentials.email);
  if (session.user.id !== signedIn.user.id) throw new QuickStartError(409);
  if (session.expires_at != null && (!Number.isFinite(session.expires_at) || session.expires_at <= Date.now() / 1000)) {
    throw new QuickStartError(503);
  }
  const id = signedIn.user.id;

  // Check an existing profile before any academy/profile write. Never rewrite it.
  const before = requiredRead(await deps.findProfile(id));
  if (before) verifyProfile(before, id);
  let academy = requiredRead(await deps.findAcademy(id));
  if (academy) verifyAcademy(academy, id);
  else {
    allowInsertConflict((await deps.insertAcademy({ id, name: '하이씨앤씨 교실' })).error);
    academy = requiredRead(await deps.findAcademy(id));
    verifyAcademy(academy, id);
  }
  if (!before) {
    allowInsertConflict((await deps.insertProfile({
      id, role: 'teacher', name: '선생님', username: credentials.email,
      academy_id: id, is_academy_owner: true, teacher_id: null,
      deleted_at: null, phone: null, must_change_password: false,
    })).error);
  }
  // Re-read after inserts/conflicts. Partial failure is recoverable on the next call;
  // no rollback deletes an Auth user, academy, profile, or another request's work.
  const [profileResult, academyResult] = await Promise.all([
    deps.findProfile(id), deps.findAcademy(id),
  ]);
  verifyProfile(requiredRead(profileResult), id);
  verifyAcademy(requiredRead(academyResult), id);

  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    ...(session.expires_at == null ? {} : { expires_at: session.expires_at }),
  };
}

export function quickStartDependencies(create: typeof createClient = createClient): QuickStartDependencies {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) throw new QuickStartError(503);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  // Keep password login off the service client: sign-in changes its Authorization.
  const auth = create(url, anonKey, options);
  const admin = create(url, serviceKey, options);
  return {
    allowCreation,
    async signIn(credentials) {
      const { data, error } = await auth.auth.signInWithPassword(credentials);
      return { user: data.user, session: data.session, error };
    },
    async createUser(input) {
      const { data, error } = await admin.auth.admin.createUser(input);
      return { data: data.user, error };
    },
    async findProfile(id) {
      return admin.from('sp_profiles')
        .select('id,role,academy_id,is_academy_owner,teacher_id,deleted_at')
        .eq('id', id).maybeSingle();
    },
    async findAcademy(id) {
      return admin.from('sp_academies').select('id').eq('id', id).maybeSingle();
    },
    async insertProfile(profile) {
      return admin.from('sp_profiles').insert(profile);
    },
    async insertAcademy(academy) {
      return admin.from('sp_academies').insert(academy);
    },
  };
}

export async function quickStart(req: Req, res: Res, dependencies = quickStartDependencies) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return void res.status(405).json({ error: 'POST only' });
  try {
    // Validate before creating clients, including for malformed non-object input.
    quickStartCredentials(req.body?.deviceSecret);
    const tokens = await startQuickClassroom(req.body?.deviceSecret, dependencies());
    res.status(200).json(tokens);
  } catch (error) {
    const known = error instanceof QuickStartError;
    res.status(known ? error.status : 503).json({ error: known ? error.message : RETRY_MESSAGE });
  }
}
