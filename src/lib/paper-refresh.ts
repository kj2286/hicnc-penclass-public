/** 새 교재가 소유·휴지통 필터를 거친 목록에 나타나는지 짧게 재확인한다. */
export async function refreshUntilListed<T extends { id: number }>(args: {
  id: number;
  /** 매번 서버의 소유 정보를 다시 읽어야 한다. 실패하면 null 또는 throw. */
  load: () => Promise<T[] | null>;
  attempts?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T[] | null> {
  const attempts = Math.max(1, Math.min(6, Math.floor(args.attempts ?? 6) || 1));
  const delayMs = args.delayMs ?? 1500;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    let shown: T[] | null = null;
    try {
      shown = await args.load();
    } catch {
      // 일시적인 조회 실패는 재시도하되 이전 목록을 성공 근거로 삼지 않는다.
    }
    if (shown?.some((paper) => paper.id === args.id)) return shown;
    if (attempt + 1 < attempts) await sleep(delayMs);
  }
  return null;
}

/** 이전 조회가 늦게 끝나도 새 목록이나 오류 상태를 덮지 못하게 한다. */
export function createLatestRequestGate() {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (request: number) => request === latest,
    invalidate: () => { latest += 1; },
  };
}

/** 발급 요청의 응답이 불명확하면 같은 요청을 조회하며, 다시 발급하지 않는다. */
export function shouldKeepUploadAttempt(args: {
  phase: string | null;
  httpStatus?: number;
  authRejected?: boolean;
}): boolean {
  if (args.phase !== 'ncode' || args.authRejected) return false;
  const status = args.httpStatus;
  return !(status !== undefined && status >= 400 && status < 500 && status !== 408);
}
