import { parseExplorer, type ExplorerState } from '../src/lib/paper-explorer-model.js';
import { requireCaller } from './_lib.js';

type Req = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};
type Res = {
  status: (code: number) => Res;
  setHeader: (name: string, value: string) => void;
  json: (body: unknown) => void;
};

export const PAPER_EXPLORER_SETTINGS_PREFIX = 'hicnc:paper-explorer:';
const MAX_STATE_BYTES = 200_000;
const CONFLICT = '다른 창에서 폴더를 수정했습니다. 다시 불러온 뒤 변경해 주세요.';

/** Existing sp_settings only. Folder references grant no access to a PDF. */
export function createPaperExplorerHandler(authorize: typeof requireCaller = requireCaller) {
  return async function paperExplorer(req: Req, res: Res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return void res.status(405).json({ error: 'POST only' });
    try {
      const gate = await authorize(req, ['teacher', 'admin']);
      if ('error' in gate) return void res.status(gate.status).json({ error: gate.error });
      const { admin, caller } = gate;
      const operation = req.body?.operation;
      if (operation !== 'load' && operation !== 'save') {
        return void res.status(400).json({ error: '잘못된 폴더 작업입니다.' });
      }

      let next: ExplorerState | undefined;
      const expected = req.body?.expectedRevision;
      if (operation === 'save') {
        try {
          if (req.body?.state == null || Buffer.byteLength(JSON.stringify(req.body.state), 'utf8') > MAX_STATE_BYTES) {
            return void res.status(400).json({ error: '폴더 정보가 없거나 너무 큽니다. 저장할 항목을 확인해 주세요.' });
          }
          next = parseExplorer(req.body.state);
        } catch {
          return void res.status(400).json({ error: '폴더 정보 형식이 올바르지 않습니다.' });
        }
        if (!Number.isSafeInteger(expected) || (expected as number) < 0 || expected !== next.revision) {
          return void res.status(409).json({ error: CONFLICT });
        }
      }

      // The authenticated caller fixes this key. Ignore all client owner/key fields.
      const key = `${PAPER_EXPLORER_SETTINGS_PREFIX}${caller.id}`;
      const { data: row, error } = await admin.from('sp_settings').select('value').eq('key', key).maybeSingle();
      if (error || (row && row.value == null)) throw new Error('Unable to read explorer');
      const current = parseExplorer(row?.value);
      if (operation === 'load') return void res.status(200).json({ userId: caller.id, state: current });
      if (!next || expected !== current.revision || current.revision >= Number.MAX_SAFE_INTEGER) {
        return void res.status(409).json({ error: CONFLICT });
      }

      const saved = { ...next, revision: current.revision + 1 };
      // Compare the entire value read, not only revision. A concurrent edit fails closed.
      const result = row
        ? await admin.from('sp_settings').update({ value: saved, updated_at: new Date().toISOString() })
          .eq('key', key).eq('value', JSON.stringify(row.value)).select('key')
        : await admin.from('sp_settings').insert({ key, value: saved }).select('key');
      if (result.error?.code === '23505' || (!result.error && !result.data?.length)) {
        return void res.status(409).json({ error: CONFLICT });
      }
      if (result.error) throw result.error;
      res.status(200).json({ userId: caller.id, state: saved });
    } catch {
      res.status(500).json({ error: '폴더 정보를 저장하거나 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

export const paperExplorer = createPaperExplorerHandler();
