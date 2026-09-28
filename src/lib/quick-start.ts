/** A per-browser bearer secret. Keep it out of URLs, logs, and shared configuration. */
export const QUICK_START_STORAGE_KEY = 'hicnc-penclass.quick-start.v1.device-secret';
const STORAGE_PROBE_KEY = `${QUICK_START_STORAGE_KEY}.probe`;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

export type QuickStartTokens = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
};

type QuickStartStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type QuickStartDependencies = {
  storage: QuickStartStorage;
  crypto: { getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> } | null;
  locks: { request: <T>(name: string, callback: () => T | Promise<T>) => Promise<T> } | null;
  fetch: (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;
};

export class QuickStartError extends Error {
  readonly code: 'storage' | 'crypto' | 'network' | 'server' | 'session';
  constructor(code: QuickStartError['code'], message: string) {
    super(message);
    this.name = 'QuickStartError';
    this.code = code;
  }
}

function storageError(): QuickStartError {
  return new QuickStartError('storage', '이 기기에 접속 정보를 저장할 수 없습니다. 저장 공간 설정을 확인하거나 계정으로 로그인해 주세요.');
}

function browserDependencies(): QuickStartDependencies {
  let storage: Storage;
  try {
    storage = globalThis.localStorage;
    if (!storage) throw storageError();
  } catch {
    throw storageError();
  }
  return {
    storage,
    crypto: typeof globalThis.crypto?.getRandomValues === 'function'
      ? { getRandomValues: (bytes) => globalThis.crypto.getRandomValues(bytes) }
      : null,
    locks: globalThis.navigator?.locks
      ? { request: (name, callback) => globalThis.navigator.locks.request(name, { mode: 'exclusive' }, callback) }
      : null,
    fetch: (url, init) => globalThis.fetch(url, init),
  };
}

function storedSecret({ storage, crypto }: QuickStartDependencies, allowCreate: boolean): string {
  let existing: string | null;
  try {
    // A successful read alone does not prove that the browser can retain a new secret.
    storage.setItem(STORAGE_PROBE_KEY, 'storage-check');
    if (storage.getItem(STORAGE_PROBE_KEY) !== 'storage-check') throw storageError();
    storage.removeItem(STORAGE_PROBE_KEY);
    existing = storage.getItem(QUICK_START_STORAGE_KEY);
  } catch {
    try { storage.removeItem(STORAGE_PROBE_KEY); } catch { /* storage is unavailable */ }
    throw storageError();
  }
  if (existing !== null) {
    if (!SECRET_PATTERN.test(existing)) {
      throw new QuickStartError('storage', '저장된 접속 정보를 읽을 수 없습니다. 계정으로 로그인해 주세요.');
    }
    return existing;
  }
  if (!allowCreate) {
    throw new QuickStartError('storage', '이 환경에서는 새 접속 정보를 저장할 수 없습니다. 최신 브라우저나 PC 앱에서 시작해 주세요.');
  }
  if (!crypto) {
    throw new QuickStartError('crypto', '안전한 접속 정보를 만들 수 없습니다. 최신 브라우저나 PC 앱에서 다시 시작해 주세요.');
  }
  const bytes = new Uint8Array(32);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    throw new QuickStartError('crypto', '접속 정보를 만들지 못했습니다. 다시 시작하거나 계정으로 로그인해 주세요.');
  }
  const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  try {
    storage.setItem(QUICK_START_STORAGE_KEY, secret);
    if (storage.getItem(QUICK_START_STORAGE_KEY) !== secret) throw storageError();
  } catch {
    throw storageError();
  }
  return secret;
}

/** Requests real credentials only after the device secret has been saved and read back. */
export async function requestQuickStartSession(
  dependencies?: QuickStartDependencies,
): Promise<QuickStartTokens> {
  const runtime = dependencies ?? browserDependencies();
  let deviceSecret: string;
  try {
    deviceSecret = runtime.locks
      ? await runtime.locks.request(QUICK_START_STORAGE_KEY, () => storedSecret(runtime, true))
      : storedSecret(runtime, false);
  } catch (error) {
    if (error instanceof QuickStartError) throw error;
    throw storageError();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    let response: Awaited<ReturnType<QuickStartDependencies['fetch']>>;
    try {
      response = await runtime.fetch('/api/academy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        body: JSON.stringify({ action: 'quick-start', deviceSecret }),
      });
    } catch {
      throw new QuickStartError('network', '서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 다시 눌러 주세요. 저장한 접속 정보는 유지됩니다.');
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw new QuickStartError('server', '요청이 많아 잠시 기다려야 합니다. 조금 뒤 다시 눌러 주세요.');
      }
      if (response.status === 403 || response.status === 409) {
        throw new QuickStartError('server', '이 기기의 교실 정보를 확인하지 못했습니다. 다시 시도하거나 계정으로 로그인해 주세요.');
      }
      // Do not echo server errors: a proxy may reflect request credentials in its body.
      throw new QuickStartError('server', '교실을 열지 못했습니다. 잠시 뒤 다시 눌러 주세요. 저장한 접속 정보는 유지됩니다.');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new QuickStartError('session', '서버의 접속 정보를 읽지 못했습니다. 다시 눌러 주세요.');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new QuickStartError('session', '서버의 접속 정보가 올바르지 않습니다. 다시 눌러 주세요.');
    }
    const values = payload as Record<string, unknown>;
    if (typeof values.access_token !== 'string' || !values.access_token.trim()
      || typeof values.refresh_token !== 'string' || !values.refresh_token.trim()
      || (values.expires_at !== undefined && (typeof values.expires_at !== 'number' || !Number.isFinite(values.expires_at)))) {
      throw new QuickStartError('session', '서버의 접속 정보가 올바르지 않습니다. 다시 눌러 주세요.');
    }
    try {
      if (runtime.storage.getItem(QUICK_START_STORAGE_KEY) !== deviceSecret) {
        throw storageError();
      }
    } catch {
      throw new QuickStartError('storage', '저장된 접속 정보가 바뀌었거나 사라졌습니다. 빠른 시작을 다시 눌러 주세요.');
    }
    return {
      access_token: values.access_token,
      refresh_token: values.refresh_token,
      ...(typeof values.expires_at === 'number' ? { expires_at: values.expires_at } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}
