import { create } from 'zustand';
import { supabase, usernameToEmail } from '@/lib/supabase';
import { QuickStartError, requestQuickStartSession } from '@/lib/quick-start';

let quickStartInProgress = false;
let quickStartGeneration = 0;

export type Role = 'student' | 'teacher' | 'admin';

export type Profile = {
  id: string;
  role: Role;
  name: string;
  username: string | null;
  teacherId: string | null;
  mustChangePassword: boolean;
  /** 학원 대표자 선생님 여부 — 선생님관리·브랜딩 권한 */
  isAcademyOwner: boolean;
  academyId: string | null;
  /** 가입 시 입력한 전화번호 (원장 '나의 정보' 표시용) */
  phone: string | null;
  createdAt: string | null;
};

/** 소속 학원 (GNB 브랜딩용) — 마이그레이션 전이거나 미소속이면 null */
export type Academy = {
  id: string;
  name: string;
  location: string | null;
  logoText: string | null;
  logoImageUrl: string | null;
  themeColor: string | null;
  /** 학원 전용 홈페이지 주소 — /h/{slug} (017). 없으면 아직 안 정해진 것 */
  slug: string | null;
  /** 홈페이지가 실제로 게시됐는지. null 이면 주소만 있고 아직 안 올라감 */
  sitePublishedAt: string | null;
  /** 교재·문항별 AI 프롬프트 별도 설정 (021) — 마이그레이션 전이면 false */
  customPromptsEnabled: boolean;
};

type SessionState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  profile: Profile | null;
  academy: Academy | null;
  /** Supabase 미설정 등 환경 문제 메시지 (있으면 로그인 화면에 노출) */
  envError: string | null;
  init: () => Promise<void>;
  signIn: (
    usernameOrEmail: string,
    password: string,
  ) => Promise<{ error?: string }>;
  signInQuickStart: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

function mapProfileRow(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    role: row.role as Role,
    name: String(row.name ?? ''),
    username: (row.username as string | null) ?? null,
    teacherId: (row.teacher_id as string | null) ?? null,
    mustChangePassword: Boolean(row.must_change_password),
    // 014 마이그레이션 전에는 컬럼이 없어 undefined → false/null 로 안전
    isAcademyOwner: Boolean(row.is_academy_owner),
    academyId: (row.academy_id as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
  };
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('sp_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return mapProfileRow(data);
}

/** 소속 학원 로드 — 실패(마이그레이션 전 컬럼 부재 등)해도 조용히 null */
async function fetchAcademy(academyId: string | null): Promise<Academy | null> {
  if (!supabase || !academyId) return null;
  const { data, error } = await supabase
    .from('sp_academies')
    .select('*')
    .eq('id', academyId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    location: (row.location as string | null) ?? null,
    logoText: (row.logo_text as string | null) ?? null,
    logoImageUrl: (row.logo_image_url as string | null) ?? null,
    themeColor: (row.theme_color as string | null) ?? null,
    slug: (row.slug as string | null) ?? null,
    sitePublishedAt: (row.site_published_at as string | null) ?? null,
    customPromptsEnabled: Boolean(row.custom_prompts_enabled),
  };
}

export const useSessionStore = create<SessionState>((set, get) => ({
  status: 'loading',
  profile: null,
  academy: null,
  envError: supabase
    ? null
    : 'Supabase 환경변수가 설정되지 않아 로그인할 수 없습니다.',

  init: async () => {
    if (!supabase) {
      set({ status: 'signedOut' });
      return;
    }
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) {
      set({ status: 'signedOut', profile: null, academy: null });
    } else {
      const profile = await fetchProfile(user.id);
      set({
        status: profile ? 'signedIn' : 'signedOut',
        profile,
        academy: await fetchAcademy(profile?.academyId ?? null),
      });
    }
    supabase.auth.onAuthStateChange(async (_event, session) => {
      if (quickStartInProgress) return;
      const generation = quickStartGeneration;
      const u = session?.user;
      if (!u) {
        set({ status: 'signedOut', profile: null, academy: null });
        return;
      }
      const profile = await fetchProfile(u.id);
      const academy = await fetchAcademy(profile?.academyId ?? null);
      // A callback that began before quick start must not replace its verified session.
      if (quickStartInProgress || generation !== quickStartGeneration) return;
      set({
        status: profile ? 'signedIn' : 'signedOut',
        profile,
        academy,
      });
    });
  },

  signIn: async (usernameOrEmail, password) => {
    if (!supabase) return { error: 'Supabase 환경변수가 설정되지 않았습니다.' };
    const email = usernameToEmail(usernameOrEmail);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return {
        error:
          error.message === 'Invalid login credentials'
            ? '아이디 또는 비밀번호가 올바르지 않습니다.'
            : error.message,
      };
    }
    const profile = await fetchProfile(data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      return { error: '프로필 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.' };
    }
    set({
      status: 'signedIn',
      profile,
      academy: await fetchAcademy(profile.academyId),
    });
    return {};
  },

  signInQuickStart: async () => {
    if (!supabase) return { error: '서버 연결을 확인한 뒤 다시 시작해 주세요.' };
    if (quickStartInProgress) return { error: '교실을 여는 중입니다. 잠시 기다려 주세요.' };
    quickStartInProgress = true;
    quickStartGeneration++;
    let sessionAttempted = false;
    try {
      const tokens = await requestQuickStartSession();
      sessionAttempted = true;
      const { data, error } = await supabase.auth.setSession({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      });
      const userId = data.session?.user.id;
      if (error || !userId || data.user?.id !== userId) {
        throw new QuickStartError('session', '접속 정보를 확인하지 못했습니다. 다시 눌러 주세요.');
      }
      const profile = await fetchProfile(userId);
      if (!profile || profile.id !== userId || profile.role !== 'teacher'
        || profile.academyId !== userId || !profile.isAcademyOwner) {
        throw new QuickStartError('session', '교사 정보를 확인하지 못했습니다. 다시 시도하거나 계정으로 로그인해 주세요.');
      }
      const academy = await fetchAcademy(profile.academyId);
      if (!academy || academy.id !== userId) {
        throw new QuickStartError('session', '교실 정보를 불러오지 못했습니다. 다시 눌러 주세요.');
      }
      set({ status: 'signedIn', profile, academy });
      return {};
    } catch (error) {
      if (sessionAttempted) {
        try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* show the original failure */ }
        set({ status: 'signedOut', profile: null, academy: null });
      }
      return {
        error: error instanceof QuickStartError
          ? error.message
          : '빠른 시작을 완료하지 못했습니다. 다시 눌러 주세요.',
      };
    } finally {
      quickStartInProgress = false;
    }
  },

  signOut: async () => {
    await supabase?.auth.signOut();
    set({ status: 'signedOut', profile: null, academy: null });
  },

  refreshProfile: async () => {
    const current = get().profile;
    if (!current) return;
    const profile = await fetchProfile(current.id);
    if (profile)
      set({ profile, academy: await fetchAcademy(profile.academyId) });
  },
}));
