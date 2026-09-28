import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmUploadedPaperFolder } from '../src/app/teacher/paper-upload-folder.ts';
import { addFolder, placeUploadedPaper, projectEntries, type ExplorerState } from '../src/lib/paper-explorer.ts';

const root: ExplorerState = { version: 1, revision: 0, folders: [], entries: [] };
const ownerId = 'teacher-a';
function stateWithFolder() {
  return addFolder(root, null, '영어 독해', () => 'folder-a');
}

test('선택한 폴더에 실제 저장한 뒤 다시 읽어 확인하며 기존 배치를 보존한다', async () => {
  let state = placeUploadedPaper(stateWithFolder(), 42, 'folder-a');
  const previous = projectEntries(state, [42]).find((e) => e.pdfId === 42);
  let writes = 0;
  await confirmUploadedPaperFolder({ ownerId, pdfId: 157, folderId: 'folder-a', isCurrentOwner: () => true,
    load: async () => ({ userId: ownerId, state }),
    save: async (userId, next, revision) => {
      assert.equal(userId, ownerId);
      assert.equal(revision, state.revision);
      writes++;
      state = { ...next, revision: revision + 1 };
      return state;
    },
  });
  assert.equal(writes, 1);
  assert.equal(projectEntries(state, [157]).find((e) => e.pdfId === 157)?.parentId, 'folder-a');
  assert.deepEqual(projectEntries(state, [42]).find((e) => e.pdfId === 42), previous);
});

test('저장 응답이 유실돼도 다음 확인은 이미 저장된 같은 교재를 읽고 추가 쓰기를 하지 않는다', async () => {
  let state = stateWithFolder();
  let writes = 0;
  const options = { ownerId, pdfId: 157, folderId: 'folder-a', isCurrentOwner: () => true,
    load: async () => ({ userId: ownerId, state }),
    save: async (_: string, next: ExplorerState, revision: number): Promise<ExplorerState> => {
      writes++;
      state = { ...next, revision: revision + 1 };
      throw new TypeError('response lost');
    },
  };
  await assert.rejects(confirmUploadedPaperFolder(options), /response lost/);
  await confirmUploadedPaperFolder(options);
  assert.equal(writes, 1);
});

test('폴더가 삭제됐으면 자동 루트 이동 없이 실패하고 명시적 루트 선택은 같은 ID를 옮긴다', async () => {
  await assert.rejects(confirmUploadedPaperFolder({ ownerId, pdfId: 157, folderId: 'gone', isCurrentOwner: () => true,
    load: async () => ({ userId: ownerId, state: root }),
    save: async () => { throw new Error('unexpected write'); },
  }));
  let state = placeUploadedPaper(stateWithFolder(), 157, 'folder-a');
  await confirmUploadedPaperFolder({ ownerId, pdfId: 157, folderId: null, isCurrentOwner: () => true,
    load: async () => ({ userId: ownerId, state }),
    save: async (_, next, revision) => state = { ...next, revision: revision + 1 },
  });
  assert.equal(projectEntries(state, [157])[0].parentId, null);
});

test('실제 계정이 바뀌거나 서버 소유자가 다르면 폴더 쓰기 전에 멈춘다', async () => {
  let writes = 0;
  for (const [current, actualOwner] of [[false, ownerId], [true, 'teacher-b']] as const) {
    await assert.rejects(confirmUploadedPaperFolder({ ownerId, pdfId: 157, folderId: 'folder-a', isCurrentOwner: () => current,
      load: async () => ({ userId: actualOwner, state: stateWithFolder() }),
      save: async (_, state) => { writes++; return state; },
    }), /계정/);
  }
  assert.equal(writes, 0);
});

test('서버가 성공을 응답해도 재조회한 위치가 다르면 완료로 판단하지 않는다', async () => {
  const state = stateWithFolder();
  await assert.rejects(confirmUploadedPaperFolder({ ownerId, pdfId: 157, folderId: 'folder-a', isCurrentOwner: () => true,
    load: async () => ({ userId: ownerId, state }),
    save: async (_, next) => next,
  }), /일치하지/);
});
