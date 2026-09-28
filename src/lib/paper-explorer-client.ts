import { parseExplorer, type ExplorerState } from './paper-explorer-model';

type Session = { user: { id: string }; access_token: string };
type Dependencies = {
  getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  fetch: typeof globalThis.fetch;
};

/** Session-bound API client; tests supply local sessions and HTTP responses. */
export function createPaperExplorerClient(deps: Dependencies) {
  async function sessionFor(expectedUserId?: string): Promise<Session> {
    const { data, error } = await deps.getSession();
    const session = data.session;
    if (error || !session || (expectedUserId !== undefined && session.user.id !== expectedUserId)) {
      throw new Error('로그인이 바뀌었습니다. 교재 목록을 다시 열어 주세요.');
    }
    return session;
  }

  async function request(payload: Record<string, unknown>, expectedUserId?: string) {
    const session = await sessionFor(expectedUserId);
    const response = await deps.fetch('/api/academy', {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'paper-explorer', ...payload }),
    });
    if (!response.ok) {
      if (response.status === 409) throw new Error('다른 창에서 폴더를 수정했습니다. 다시 불러온 뒤 변경해 주세요.');
      if (response.status === 401 || response.status === 403) throw new Error('폴더를 불러오거나 저장할 권한이 없습니다. 다시 로그인해 주세요.');
      throw new Error('폴더를 저장하거나 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    const result: unknown = await response.json();
    await sessionFor(session.user.id);
    if (!result || typeof result !== 'object' || !('userId' in result) || result.userId !== session.user.id || !('state' in result) || result.state == null) {
      throw new Error('저장한 폴더 정보를 확인하지 못했습니다. 목록을 다시 불러와 주세요.');
    }
    return { userId: session.user.id, state: parseExplorer(result.state) };
  }

  return {
    load: () => request({ operation: 'load' }),
    async save(userId: string, state: ExplorerState, expectedRevision: number): Promise<ExplorerState> {
      if (!userId) throw new Error('로그인이 필요합니다.');
      const snapshot = parseExplorer(state);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER || snapshot.revision !== expectedRevision) {
        throw new Error('폴더 버전이 일치하지 않습니다. 다시 불러와 주세요.');
      }
      const result = await request({ operation: 'save', state: snapshot, expectedRevision }, userId);
      if (JSON.stringify(result.state) !== JSON.stringify({ ...snapshot, revision: expectedRevision + 1 })) {
        throw new Error('저장한 폴더 정보가 일치하지 않습니다. 다시 불러와 주세요.');
      }
      return result.state;
    },
  };
}

const remote = createPaperExplorerClient({
  getSession: async () => (await import('./supabase')).requireSupabase().auth.getSession(),
  fetch: (...args) => globalThis.fetch(...args),
});

export const loadExplorerRemote = remote.load;
export const saveExplorerRemote = remote.save;
