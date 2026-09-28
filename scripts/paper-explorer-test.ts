/** Offline only: no environment/client import and no live auth or DB requests. */
import assert from 'node:assert/strict';
import {
  emptyExplorer, parseExplorer, addFolder, renameFolder, moveExplorerFolder,
  copyExplorerFolder, deleteEmptyFolder, deleteFolderTree, transferEntries, removeCopies,
  projectEntries, folderPath, searchEntries, validateFolderName,
  placeUploadedPaper,
} from '../src/lib/paper-explorer-model';

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn();
  console.log(`PASS ${name}`);
  passed++;
}
let serial = 0;
const id = () => `test-${++serial}`;
const pdfs = [11, 22, 33];
const base = addFolder(emptyExplorer(), null, '수학', () => 'math');
const tree = addFolder(base, 'math', '중등', () => 'middle');
const organized = transferEntries(tree, ['pdf:11'], 'middle', 'cut', pdfs);

await test('upload from a nested folder pins the new original there across school sorting', () => {
  const placed = placeUploadedPaper(tree, 44, 'middle');
  assert.equal(projectEntries(placed, [44]).find(e => e.id === 'pdf:44')?.parentId, 'middle');
  assert.ok(placed.schoolSortedIds?.includes(44));
  assert.equal(projectEntries(placeUploadedPaper(tree, 44, null), [44])[0].parentId, null);
  assert.throws(() => placeUploadedPaper(tree, 44, 'missing'));
});

await test('originals are implicit, stable and deduplicated; unavailable PDFs disappear', () => {
  assert.deepEqual(emptyExplorer().entries, []);
  assert.deepEqual(projectEntries(emptyExplorer(), [11, 11, 22]).map(e => e.id), ['pdf:11', 'pdf:22']);
  assert.deepEqual(projectEntries(organized, [22]).map(e => e.pdfId), [22]);
  assert.equal(projectEntries(organized, pdfs).find(e => e.id === 'pdf:11')!.parentId, 'middle');
});
await test('cut originals stores one override and root cut removes it', () => {
  assert.equal(tree.entries.length, 0);
  assert.deepEqual(organized.entries, [{ id: 'pdf:11', pdfId: 11, parentId: 'middle' }]);
  assert.equal(organized.revision, 0);
  assert.deepEqual(transferEntries(organized, ['pdf:11'], null, 'cut', pdfs).entries, []);
});
await test('copies link the same PDF and moving/removing copies leaves original untouched', () => {
  const copy = transferEntries(organized, ['pdf:11', 'pdf:11'], null, 'copy', pdfs, () => 'copy');
  assert.equal(copy.entries.length, 2);
  assert.equal(copy.entries.find(e => e.id === 'copy')!.pdfId, 11);
  const moved = transferEntries(copy, ['copy'], 'math', 'cut', pdfs);
  assert.equal(moved.entries.find(e => e.id === 'copy')!.parentId, 'math');
  assert.deepEqual(removeCopies(moved, ['copy']), organized);
  assert.throws(() => removeCopies(copy, ['pdf:11']));
});
await test('names trim/NFC; invalid/duplicate sibling names reject', () => {
  assert.equal(validateFolderName('  중등  '), '중등');
  for (const name of ['', ' ', '.', '..', 'a/b', 'a\\b', 'a\n', 'a\u0000b', 'a'.repeat(101)]) {
    if (name === 'a\n') continue; // surrounding whitespace is trimmed
    assert.throws(() => addFolder(tree, null, name, id));
  }
  assert.throws(() => addFolder(tree, null, '수학', id));
  assert.throws(() => addFolder(addFolder(tree, null, 'ABC', id), null, 'abc', id));
  assert.equal(renameFolder(tree, 'middle', '  고등  ').folders[1].name, '고등');
});
await test('self/descendant moves and invalid targets reject; siblings can move', () => {
  assert.throws(() => moveExplorerFolder(tree, 'math', 'math'));
  assert.throws(() => moveExplorerFolder(tree, 'math', 'middle'));
  assert.throws(() => moveExplorerFolder(tree, 'math', 'missing'));
  assert.equal(moveExplorerFolder(tree, 'middle', null).folders[1].parentId, null);
});
await test('delete rejects available contents and child folders; cleans only scoped stale refs', () => {
  assert.throws(() => deleteEmptyFolder(tree, 'math', []));
  assert.throws(() => deleteEmptyFolder(organized, 'middle', pdfs));
  assert.deepEqual(deleteEmptyFolder(organized, 'middle', []), { ...base, schoolSortedIds: [11] });
  const copied = transferEntries(tree, ['pdf:11'], 'middle', 'copy', pdfs, id);
  assert.throws(() => deleteEmptyFolder(copied, 'middle', pdfs));
  const elsewhere = transferEntries(copied, ['pdf:22'], 'math', 'copy', pdfs, () => 'elsewhere');
  const cleaned = deleteEmptyFolder(elsewhere, 'middle', []);
  assert.deepEqual(cleaned.entries, [{ id: 'elsewhere', pdfId: 22, parentId: 'math' }]);
  assert.equal(deleteEmptyFolder(tree, 'middle', pdfs).folders.length, 1);
});
await test('deleting a folder tree preserves original PDFs and removes linked copies', () => {
  const withCopy = transferEntries(organized, ['pdf:22'], 'middle', 'copy', pdfs, () => 'linked');
  const removed = deleteFolderTree(withCopy, 'math');
  assert.deepEqual(removed.folders, []);
  assert.equal(projectEntries(removed, pdfs).find(e => e.id === 'pdf:11')?.parentId, null);
  assert.equal(projectEntries(removed, pdfs).some(e => e.id === 'linked'), false);
  assert.ok(removed.schoolSortedIds?.includes(11));
  assert.throws(() => deleteFolderTree(tree, 'missing'));
});
await test('recursive folder copy creates fresh folder and entry IDs without moving originals', () => {
  const withCopy = transferEntries(organized, ['pdf:22'], 'math', 'copy', pdfs, id);
  const cloned = copyExplorerFolder(withCopy, 'math', null, '수학 사본', id);
  const top = cloned.folders.find(f => f.name === '수학 사본')!;
  const child = cloned.folders.find(f => f.parentId === top.id)!;
  assert.equal(child.name, '중등');
  assert.equal(cloned.entries.find(e => e.parentId === child.id)!.pdfId, 11);
  assert.equal(cloned.entries.find(e => e.parentId === top.id)!.pdfId, 22);
  assert.equal(cloned.entries.find(e => e.id === 'pdf:11')!.parentId, 'middle');
  assert.equal(new Set([...cloned.folders, ...cloned.entries].map(e => e.id)).size, cloned.folders.length + cloned.entries.length);
  // Copying into a descendant uses the original snapshot and terminates.
  assert.equal(copyExplorerFolder(organized, 'math', 'middle', '복사', id).folders.length, 4);
});
await test('breadcrumbs and path search locate linked copies', () => {
  assert.deepEqual(folderPath(organized, null), []);
  assert.deepEqual(folderPath(organized, 'middle').map(f => f.name), ['수학', '중등']);
  const papers = [{ id: 11, title: 'JMC 시험지' }, { id: 22, title: '다른 교재' }];
  assert.equal(searchEntries(organized, papers, '중등').length, 1);
  assert.equal(searchEntries(organized, papers, 'jmc')[0].entry.id, 'pdf:11');
  assert.deepEqual(searchEntries(organized, [], ''), []);
});
await test('failed selections, collisions and unavailable entries preserve input', () => {
  const before = JSON.stringify(organized);
  assert.throws(() => transferEntries(organized, ['pdf:11', 'missing'], null, 'copy', pdfs, id));
  assert.throws(() => transferEntries(organized, ['pdf:11'], null, 'copy', [], id));
  assert.throws(() => transferEntries(organized, ['pdf:11'], null, 'copy', pdfs, () => 'math'));
  assert.equal(JSON.stringify(organized), before);
});
await test('metadata roundtrip and corruption rejection', () => {
  assert.deepEqual(parseExplorer(JSON.parse(JSON.stringify(organized))), organized);
  assert.deepEqual(parseExplorer(undefined), emptyExplorer());
  for (const broken of [[], { ...tree, version: 2 }, { ...tree, revision: -1 },
    { ...tree, folders: [{ id: 'cycle', parentId: 'cycle', name: 'X' }] },
    { ...tree, folders: [{ id: 'orphan', parentId: 'missing', name: 'X' }] },
    { ...tree, entries: [{ id: 'pdf:22', pdfId: 11, parentId: null }] },
    { ...tree, entries: [{ id: 'c', pdfId: 11, parentId: 'missing' }] },
    { ...organized, entries: [...organized.entries, ...organized.entries] },
  ]) assert.throws(() => parseExplorer(broken));
});

await test('placing a new upload preserves every existing original and linked copy', () => {
  const withCopy = transferEntries(organized, ['pdf:22'], 'math', 'copy', pdfs, () => 'linked');
  const before = structuredClone(withCopy);
  const placed = placeUploadedPaper(withCopy, 44, 'middle');
  for (const entry of before.entries) assert.deepEqual(placed.entries.find(e => e.id === entry.id), entry);
  assert.deepEqual(withCopy, before);
  assert.equal(projectEntries(placed, [44])[0].parentId, 'middle');
  const returned = placeUploadedPaper(placed, 44, null);
  assert.equal(projectEntries(returned, [44])[0].parentId, null);
  for (const entry of before.entries) assert.deepEqual(returned.entries.find(e => e.id === entry.id), entry);
});

await test('upload placement rejects a removed folder instead of silently using root', () => {
  const deleted = deleteFolderTree(tree, 'math');
  assert.throws(() => placeUploadedPaper(deleted, 44, 'middle'));
  assert.equal(projectEntries(placeUploadedPaper(deleted, 44, null), [44])[0].parentId, null);
});

console.log(`\n${passed} paper explorer model tests passed (offline).`);
