import {
  loadExplorer, saveExplorer, placeUploadedPaper, projectEntries,
  type ExplorerState,
} from '../../lib/paper-explorer';

/** Confirm a real placement separately from ncode issuance, so retries cannot issue another PDF. */
export async function confirmUploadedPaperFolder(args: {
  ownerId: string;
  pdfId: number;
  folderId: string | null;
  isCurrentOwner: () => boolean;
  load?: () => Promise<{ userId: string; state: ExplorerState }>;
  save?: (ownerId: string, state: ExplorerState, expectedRevision: number) => Promise<ExplorerState>;
}): Promise<void> {
  const load = args.load ?? loadExplorer;
  const save = args.save ?? saveExplorer;
  const assertOwner = (userId: string) => {
    if (!args.isCurrentOwner() || userId !== args.ownerId) {
      throw new Error('폴더 계정이 바뀌었습니다. 원래 계정으로 다시 확인해 주세요.');
    }
  };
  const matches = (state: ExplorerState) => projectEntries(state, [args.pdfId])
    .some((entry) => entry.id === `pdf:${args.pdfId}` && entry.parentId === args.folderId);
  const loaded = await load();
  assertOwner(loaded.userId);
  // A previous save may have succeeded while its response was lost.
  if (matches(loaded.state)) return;
  const next = placeUploadedPaper(loaded.state, args.pdfId, args.folderId);
  await save(args.ownerId, next, loaded.state.revision);
  const confirmed = await load();
  assertOwner(confirmed.userId);
  if (!matches(confirmed.state)) throw new Error('저장 위치를 다시 확인했을 때 일치하지 않습니다.');
}
