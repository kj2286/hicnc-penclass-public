/** Personal organization only: copies link to existing PDF IDs; never issue ncode.
 * Root originals are derived from availablePdfIds, not persisted. Pure operations
 * return new models. Await saveExplorer() before adopting its returned state.
 */
export type FolderId = string | null;
export type ExplorerFolder = { id: string; parentId: FolderId; name: string };
export type ExplorerCopy = { id: string; folderId: FolderId; pdfId: number };
export type PaperExplorerModel = {
  version: 1;
  folders: ExplorerFolder[];
  copies: ExplorerCopy[];
  originalLocations: Record<string, string>;
};
export type ExplorerEntry = ExplorerCopy & { original: boolean };
export type ExplorerBreadcrumb = { id: FolderId; name: string };
export type ExplorerSearchResult =
  | { kind: 'folder'; folder: ExplorerFolder; breadcrumbs: ExplorerBreadcrumb[] }
  | { kind: 'entry'; entry: ExplorerEntry; name: string; breadcrumbs: ExplorerBreadcrumb[] };
export type ExplorerIdFactory = () => string;
const newId: ExplorerIdFactory = () => crypto.randomUUID();
const validPdfId = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function emptyPaperExplorer(): PaperExplorerModel {
  return { version: 1, folders: [], copies: [], originalLocations: {} };
}

/** Returns the normalized name or throws; sibling names must also be unique. */
export function validateFolderName(name: string): string {
  if (typeof name !== 'string') throw new Error('폴더 이름을 입력해 주세요.');
  const clean = name.trim().normalize('NFC');
  if (!clean || clean === '.' || clean === '..' || clean.length > 100 || (/[/\\]/u.test(clean) || Array.from(clean).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))) {
    throw new Error('폴더 이름은 1~100자로 입력하고, 슬래시와 제어 문자는 빼 주세요.');
  }
  return clean;
}

function folderAt(model: PaperExplorerModel, id: string): ExplorerFolder {
  const folder = model.folders.find(f => f.id === id);
  if (!folder) throw new Error('폴더를 찾을 수 없습니다.');
  return folder;
}
function destination(model: PaperExplorerModel, id: FolderId): void {
  if (id !== null) folderAt(model, id);
}
function uniqueName(model: PaperExplorerModel, parentId: FolderId, name: string, except?: string): string {
  const clean = validateFolderName(name);
  if (model.folders.some(f => f.id !== except && f.parentId === parentId && f.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) {
    throw new Error('같은 위치에 같은 이름의 폴더가 있습니다.');
  }
  return clean;
}
function allocateId(model: PaperExplorerModel, factory: ExplorerIdFactory): string {
  const id = factory();
  if (typeof id !== 'string' || !id.trim() || id.startsWith('pdf:') || model.folders.some(f => f.id === id) || model.copies.some(e => e.id === id)) {
    throw new Error('새 항목 ID가 올바르지 않거나 이미 사용 중입니다.');
  }
  return id;
}

/** Missing metadata is empty. Corruption/unknown versions throw rather than
 * silently overwriting a user's saved organization. No visibility-based pruning.
 */
export function parsePaperExplorer(value: unknown): PaperExplorerModel {
  if (value === undefined || value === null) return emptyPaperExplorer();
  if (!record(value) || value.version !== 1 || !Array.isArray(value.folders) || !Array.isArray(value.copies) || !record(value.originalLocations)) {
    throw new Error('저장된 폴더 정보를 읽을 수 없습니다.');
  }
  const model = emptyPaperExplorer();
  for (const raw of value.folders) {
    if (!record(raw) || typeof raw.id !== 'string' || !(raw.parentId === null || typeof raw.parentId === 'string') || typeof raw.name !== 'string') throw new Error('폴더 정보가 올바르지 않습니다.');
    const id = allocateId(model, () => raw.id as string);
    model.folders.push({ id, parentId: raw.parentId as FolderId, name: uniqueName(model, raw.parentId as FolderId, raw.name) });
  }
  for (const folder of model.folders) getBreadcrumbs(model, folder.id);
  for (const raw of value.copies) {
    if (!record(raw) || typeof raw.id !== 'string' || !validPdfId(raw.pdfId) || !(raw.folderId === null || typeof raw.folderId === 'string')) throw new Error('PDF 참조 정보가 올바르지 않습니다.');
    destination(model, raw.folderId as FolderId);
    model.copies.push({ id: allocateId(model, () => raw.id as string), pdfId: raw.pdfId, folderId: raw.folderId as FolderId });
  }
  for (const [pdfId, folderId] of Object.entries(value.originalLocations)) {
    if (!validPdfId(Number(pdfId)) || String(Number(pdfId)) !== pdfId || typeof folderId !== 'string') throw new Error('원본 위치 정보가 올바르지 않습니다.');
    destination(model, folderId);
    model.originalLocations[pdfId] = folderId;
  }
  return model;
}

export function originalEntryId(pdfId: number): string {
  if (!validPdfId(pdfId)) throw new Error('PDF ID가 올바르지 않습니다.');
  return `pdf:${pdfId}`;
}

/** All visible entries; pass a folder ID (including null) to scope the list. */
export function listEntries(model: PaperExplorerModel, availablePdfIds: readonly number[], folderId?: FolderId): ExplorerEntry[] {
  if (folderId !== undefined) destination(model, folderId);
  const available = new Set(availablePdfIds.filter(validPdfId));
  const entries: ExplorerEntry[] = [...available].map(pdfId => ({ id: originalEntryId(pdfId), pdfId, folderId: model.originalLocations[String(pdfId)] ?? null, original: true }));
  entries.push(...model.copies.filter(e => available.has(e.pdfId)).map(e => ({ ...e, original: false })));
  return folderId === undefined ? entries : entries.filter(e => e.folderId === folderId);
}
export function listFolders(model: PaperExplorerModel, parentId: FolderId): ExplorerFolder[] {
  destination(model, parentId);
  return model.folders.filter(f => f.parentId === parentId).map(f => ({ ...f }));
}
export function getBreadcrumbs(model: PaperExplorerModel, folderId: FolderId): ExplorerBreadcrumb[] {
  const path: ExplorerBreadcrumb[] = [];
  const seen = new Set<string>();
  let id = folderId;
  while (id !== null) {
    if (seen.has(id)) throw new Error('폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.');
    seen.add(id);
    const folder = folderAt(model, id);
    path.unshift({ id, name: folder.name });
    id = folder.parentId;
  }
  return [{ id: null, name: '전체 교재' }, ...path];
}
export function canMoveFolder(model: PaperExplorerModel, folderId: string, parentId: FolderId): boolean {
  folderAt(model, folderId);
  return !getBreadcrumbs(model, parentId).some(f => f.id === folderId);
}
export function createFolder(model: PaperExplorerModel, parentId: FolderId, name: string, idFactory: ExplorerIdFactory = newId): PaperExplorerModel {
  destination(model, parentId);
  const folder = { id: allocateId(model, idFactory), parentId, name: uniqueName(model, parentId, name) };
  return { ...model, folders: [...model.folders, folder] };
}
function renameLegacyFolder(model: PaperExplorerModel, folderId: string, name: string): PaperExplorerModel {
  const folder = folderAt(model, folderId);
  const clean = uniqueName(model, folder.parentId, name, folderId);
  return { ...model, folders: model.folders.map(f => f.id === folderId ? { ...f, name: clean } : f) };
}
function moveLegacyFolder(model: PaperExplorerModel, folderId: string, parentId: FolderId): PaperExplorerModel {
  if (!canMoveFolder(model, folderId, parentId)) throw new Error('폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.');
  uniqueName(model, parentId, folderAt(model, folderId).name, folderId);
  return { ...model, folders: model.folders.map(f => f.id === folderId ? { ...f, parentId } : f) };
}
/** Unavailable references count as contents too; never orphan hidden entries. */
export function deleteFolder(model: PaperExplorerModel, folderId: string): PaperExplorerModel {
  folderAt(model, folderId);
  if (model.folders.some(f => f.parentId === folderId) || model.copies.some(e => e.folderId === folderId) || Object.values(model.originalLocations).includes(folderId)) throw new Error('빈 폴더만 삭제할 수 있습니다.');
  return { ...model, folders: model.folders.filter(f => f.id !== folderId) };
}
function entryAt(model: PaperExplorerModel, entryId: string, availablePdfIds: readonly number[]): ExplorerEntry {
  const entry = listEntries(model, availablePdfIds).find(e => e.id === entryId);
  if (!entry) throw new Error('사용할 수 있는 PDF 항목을 찾을 수 없습니다.');
  return entry;
}
export function moveEntry(model: PaperExplorerModel, entryId: string, folderId: FolderId, availablePdfIds: readonly number[]): PaperExplorerModel {
  destination(model, folderId);
  const entry = entryAt(model, entryId, availablePdfIds);
  if (!entry.original) return { ...model, copies: model.copies.map(e => e.id === entryId ? { ...e, folderId } : e) };
  const originalLocations = { ...model.originalLocations };
  if (folderId === null) delete originalLocations[String(entry.pdfId)];
  else originalLocations[String(entry.pdfId)] = folderId;
  return { ...model, originalLocations };
}
export function copyEntry(model: PaperExplorerModel, entryId: string, folderId: FolderId, availablePdfIds: readonly number[], idFactory: ExplorerIdFactory = newId): PaperExplorerModel {
  destination(model, folderId);
  const entry = entryAt(model, entryId, availablePdfIds);
  return { ...model, copies: [...model.copies, { id: allocateId(model, idFactory), pdfId: entry.pdfId, folderId }] };
}
export function removeCopy(model: PaperExplorerModel, entryId: string): PaperExplorerModel {
  if (!model.copies.some(e => e.id === entryId)) throw new Error('복사한 PDF 항목만 지울 수 있습니다.');
  return { ...model, copies: model.copies.filter(e => e.id !== entryId) };
}
/** Copies a snapshot of the subtree, including currently unavailable references.
 * The copied top folder needs an explicit unique name at its destination.
 * Originals inside it become linked copies; original locations never change.
 */
export function copyFolder(model: PaperExplorerModel, folderId: string, parentId: FolderId, name: string, idFactory: ExplorerIdFactory = newId): PaperExplorerModel {
  folderAt(model, folderId);
  let next = createFolder(model, parentId, name, idFactory);
  const pairs: Array<[string, string]> = [[folderId, next.folders[next.folders.length - 1].id]];
  const seen = new Set<string>();
  for (let i = 0; i < pairs.length; i++) {
    const [source, target] = pairs[i];
    if (seen.has(source)) throw new Error('폴더 구조가 올바르지 않습니다.');
    seen.add(source);
    for (const child of model.folders.filter(f => f.parentId === source)) {
      next = createFolder(next, target, child.name, idFactory);
      pairs.push([child.id, next.folders[next.folders.length - 1].id]);
    }
    const pdfIds = [
      ...Object.entries(model.originalLocations).filter(([, loc]) => loc === source).map(([id]) => Number(id)),
      ...model.copies.filter(e => e.folderId === source).map(e => e.pdfId),
    ];
    for (const pdfId of pdfIds) next = { ...next, copies: [...next.copies, { id: allocateId(next, idFactory), pdfId, folderId: target }] };
  }
  return next;
}
/** Searches names and ancestor paths. Folder results include their own path;
 * entry breadcrumbs point at the containing folder. Empty query returns all.
 */
export function searchExplorer(model: PaperExplorerModel, papers: readonly { id: number; title: string }[], query: string): ExplorerSearchResult[] {
  const normalize = (s: string) => s.normalize('NFC').toLocaleLowerCase();
  const needle = normalize(query.trim());
  const matches = (name: string, breadcrumbs: ExplorerBreadcrumb[]) => normalize([name, ...breadcrumbs.map(b => b.name)].join(' / ')).includes(needle);
  const results: ExplorerSearchResult[] = [];
  for (const folder of model.folders) {
    const breadcrumbs = getBreadcrumbs(model, folder.id);
    if (matches(folder.name, breadcrumbs)) results.push({ kind: 'folder', folder: { ...folder }, breadcrumbs });
  }
  const titles = new Map(papers.map(p => [p.id, p.title]));
  for (const entry of listEntries(model, papers.map(p => p.id))) {
    const name = titles.get(entry.pdfId)!;
    const breadcrumbs = getBreadcrumbs(model, entry.folderId);
    if (matches(name, breadcrumbs)) results.push({ kind: 'entry', entry, name, breadcrumbs });
  }
  return results;
}

/** UI/persistence contract. Only moved originals and copies are stored. */
export type ExplorerState = {
  version: 1;
  revision: number;
  schoolSortedIds?: number[];
  folders: ExplorerFolder[];
  entries: Array<{ id: string; pdfId: number; parentId: FolderId; name?: string }>;
};
export function emptyExplorer(): ExplorerState {
  return { version: 1, revision: 0, folders: [], entries: [] };
}
function toModel(state: ExplorerState): PaperExplorerModel {
  const model: PaperExplorerModel = { version: 1, folders: state.folders, copies: [], originalLocations: {} };
  for (const entry of state.entries) {
    if (entry.id === originalEntryId(entry.pdfId)) {
      if (entry.parentId !== null) model.originalLocations[String(entry.pdfId)] = entry.parentId;
    } else model.copies.push({ id: entry.id, pdfId: entry.pdfId, folderId: entry.parentId });
  }
  return parsePaperExplorer(model);
}
function fromModel(model: PaperExplorerModel, source: ExplorerState): ExplorerState {
  const names = new Map(source.entries.map(e => [e.id, e.name]));
  const entries: ExplorerState['entries'] = [
    ...Object.entries(model.originalLocations).map(([id, parentId]) => ({ id: originalEntryId(Number(id)), pdfId: Number(id), parentId })),
    ...model.copies.map(e => ({ id: e.id, pdfId: e.pdfId, parentId: e.folderId })),
  ];
  for (const entry of entries) {
    const name = names.get(entry.id);
    if (name !== undefined) entry.name = name;
  }
  return { version: 1, revision: source.revision, ...(source.schoolSortedIds ? { schoolSortedIds: [...source.schoolSortedIds] } : {}), folders: model.folders, entries };
}
export function parseExplorer(value: unknown): ExplorerState {
  if (value === undefined || value === null) return emptyExplorer();
  if (!record(value) || value.version !== 1 || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !Array.isArray(value.folders) || !Array.isArray(value.entries)) throw new Error('저장된 폴더 정보를 읽을 수 없습니다.');
  if (value.schoolSortedIds !== undefined && (!Array.isArray(value.schoolSortedIds) || value.schoolSortedIds.some(id => !validPdfId(id)))) throw new Error('학교급 분류 기록이 올바르지 않습니다.');
  const ids = new Set<string>();
  const entries: ExplorerState['entries'] = [];
  for (const e of value.entries) {
    if (!record(e) || typeof e.id !== 'string' || !e.id.trim() || ids.has(e.id) || !validPdfId(e.pdfId) || !(e.parentId === null || typeof e.parentId === 'string') || (e.name !== undefined && typeof e.name !== 'string') || (e.id.startsWith('pdf:') && e.id !== originalEntryId(e.pdfId))) throw new Error('PDF 참조 정보가 올바르지 않습니다.');
    ids.add(e.id);
    entries.push({ id: e.id, pdfId: e.pdfId, parentId: e.parentId as FolderId, ...(e.name === undefined ? {} : { name: e.name as string }) });
  }
  const state: ExplorerState = { version: 1, revision: value.revision as number, ...(Array.isArray(value.schoolSortedIds) ? { schoolSortedIds: [...new Set(value.schoolSortedIds as number[])] } : {}), folders: value.folders as ExplorerFolder[], entries };
  const model = toModel(state);
  for (const e of entries) destination(model, e.parentId);
  // Persisted originals at root are harmless, though ordinary moves omit them.
  return { ...state, folders: model.folders };
}
export function projectEntries(state: ExplorerState, pdfIds: readonly number[]): ExplorerState['entries'] {
  const names = new Map(state.entries.map(e => [e.id, e.name]));
  return listEntries(toModel(state), pdfIds).map(e => ({ id: e.id, pdfId: e.pdfId, parentId: e.folderId, ...(names.get(e.id) === undefined ? {} : { name: names.get(e.id) }) }));
}
/** Pin a newly issued PDF to the folder where its upload was started. */
export function placeUploadedPaper(state: ExplorerState, pdfId: number, folderId: FolderId): ExplorerState {
  if (!validPdfId(pdfId)) throw new Error('교재 번호가 올바르지 않습니다.');
  const next = transferEntries(state, [originalEntryId(pdfId)], folderId, 'cut', [pdfId]);
  return next;
}
/** Root excluded; returns ancestors followed by the selected folder. */
export function folderPath(state: ExplorerState, id: FolderId): ExplorerFolder[] {
  const model = toModel(state);
  return getBreadcrumbs(model, id).slice(1).map(b => ({ ...folderAt(model, b.id!) }));
}
export function addFolder(state: ExplorerState, parentId: FolderId, name: string, idFactory: ExplorerIdFactory = newId): ExplorerState {
  return fromModel(createFolder(toModel(state), parentId, name, idFactory), state);
}
export function renameFolder(state: ExplorerState, id: string, name: string): ExplorerState {
  return fromModel(renameLegacyFolder(toModel(state), id, name), state);
}
export function moveExplorerFolder(state: ExplorerState, id: string, parentId: FolderId): ExplorerState {
  return fromModel(moveLegacyFolder(toModel(state), id, parentId), state);
}
export function copyExplorerFolder(state: ExplorerState, id: string, parentId: FolderId, name: string, idFactory: ExplorerIdFactory = newId): ExplorerState {
  return fromModel(copyFolder(toModel(state), id, parentId, name, idFactory), state);
}
/** Call only after the authoritative PDF list has loaded. Prunes unavailable
 * references inside this folder only; child folders always prevent deletion. */
export function deleteEmptyFolder(state: ExplorerState, id: string, pdfIds: readonly number[]): ExplorerState {
  const available = new Set(pdfIds);
  const scoped = { ...state, entries: state.entries.filter(e => e.parentId !== id || available.has(e.pdfId)) };
  return fromModel(deleteFolder(toModel(scoped), id), scoped);
}
/** Remove folder structure while preserving original PDFs and pen records. */
export function deleteFolderTree(state: ExplorerState, id: string): ExplorerState {
  const folder = state.folders.find(f => f.id === id);
  if (!folder) throw new Error('폴더를 찾을 수 없습니다.');
  const removed = new Set([id]);
  const pending = [id];
  for (let i = 0; i < pending.length; i++) {
    for (const child of state.folders.filter(f => f.parentId === pending[i])) { removed.add(child.id); pending.push(child.id); }
  }
  const originals = state.entries.filter(e => e.id.startsWith('pdf:') && e.parentId !== null && removed.has(e.parentId));
  const entries = state.entries.flatMap(e => {
    if (e.parentId === null || !removed.has(e.parentId)) return [e];
    if (!e.id.startsWith('pdf:') || folder.parentId === null) return [];
    return [{ ...e, parentId: folder.parentId }];
  });
  return parseExplorer({ ...state, folders: state.folders.filter(f => !removed.has(f.id)), entries,
    schoolSortedIds: [...new Set([...(state.schoolSortedIds ?? []), ...originals.map(e => e.pdfId)])] });
}
/** Atomic pure selection operation: any invalid ID rejects the entire result. */
export function transferEntries(state: ExplorerState, entryIds: readonly string[], targetParentId: FolderId, mode: 'copy' | 'cut', pdfIds: readonly number[], idFactory: ExplorerIdFactory = newId): ExplorerState {
  if (mode !== 'copy' && mode !== 'cut') throw new Error('복사 또는 이동을 선택해 주세요.');
  let model = toModel(state);
  destination(model, targetParentId);
  const names = new Map(state.entries.map(e => [e.id, e.name]));
  const copiedNames = new Map<string, string>();
  for (const id of new Set(entryIds)) {
    model = mode === 'copy' ? copyEntry(model, id, targetParentId, pdfIds, idFactory) : moveEntry(model, id, targetParentId, pdfIds);
    const name = names.get(id);
    if (mode === 'copy' && name !== undefined) copiedNames.set(model.copies[model.copies.length - 1].id, name);
  }
  const next = fromModel(model, state);
  for (const e of next.entries) if (copiedNames.has(e.id)) e.name = copiedNames.get(e.id);
  if (mode === 'cut') next.schoolSortedIds = [...new Set([...(next.schoolSortedIds ?? []), ...entryIds.filter(id => id.startsWith('pdf:')).map(id => Number(id.slice(4)))])];
  return next;
}
export function removeCopies(state: ExplorerState, ids: readonly string[]): ExplorerState {
  let model = toModel(state);
  for (const id of new Set(ids)) model = removeCopy(model, id);
  return fromModel(model, state);
}
export function searchEntries(state: ExplorerState, papers: readonly { id: number; title: string }[], query: string) {
  const titles = new Map(papers.map(p => [p.id, p.title]));
  const normalize = (s: string) => s.normalize('NFC').toLocaleLowerCase();
  const needle = normalize(query.trim());
  return projectEntries(state, papers.map(p => p.id)).map(entry => ({
    entry, name: entry.name ?? titles.get(entry.pdfId)!, breadcrumbs: folderPath(state, entry.parentId),
  })).filter(result => normalize([result.name, ...result.breadcrumbs.map(f => f.name)].join(' / ')).includes(needle));
}

