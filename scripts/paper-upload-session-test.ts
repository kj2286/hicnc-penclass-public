import assert from 'node:assert/strict';
import { createPaperUploadSessions } from '../src/lib/paper-upload-session.ts';
import { shouldKeepUploadAttempt } from '../src/lib/paper-refresh.ts';

type Receipt = { id: number | null; attemptId: string; file: File; subject: string };
const sessions = createPaperUploadSessions<Receipt>();
const file = new File(['fixture'], 'english.pdf', { type: 'application/pdf' });
const receipt: Receipt = { id: 157, attemptId: 'attempt-a', file, subject: '영어' };
let notices = 0;
const unsubscribe = sessions.subscribe(() => { notices++; });
assert.equal(sessions.begin('teacher-a'), true);
sessions.patch('teacher-a', { receipt, phase: 'verify', progress: 100 });
assert.equal(sessions.begin('teacher-a'), false, 'another mounted page cannot start a second request');
assert.equal(sessions.get('teacher-b').receipt, null, 'another teacher cannot inherit a receipt');
assert.equal(sessions.begin('teacher-b'), true, 'teachers have independent locks');
sessions.finish('teacher-a');
assert.equal(sessions.get('teacher-a').receipt, receipt, 'finishing an attempt retains its ID for a menu revisit');
assert.equal(sessions.get('teacher-a').receipt?.file, file, 'the in-memory PDF survives menu changes');
assert.equal(sessions.get('teacher-a').busy, false);
assert.equal(sessions.get('teacher-b').busy, true, 'one teacher finishing cannot release another lock');
assert.equal(sessions.begin('teacher-a'), true, 'failed registration can resume');
sessions.accept('teacher-a', 157);
sessions.accept('teacher-a', 157);
sessions.accept('teacher-a', -1);
assert.deepEqual(sessions.get('teacher-a').acceptedIds, [157], 'real IDs stay deduplicated across visits');
sessions.patch('teacher-a', { receipt: null, error: null });
sessions.finish('teacher-a');
assert.deepEqual(sessions.get('teacher-a').acceptedIds, [157], 'confirmed IDs remain available for delayed NGS lists');
assert.equal(sessions.get('teacher-a').receipt, null, 'completed receipt can release the original file');
assert.equal(sessions.begin(''), false, 'no anonymous request lock');
unsubscribe();
const afterUnsubscribe = notices;
sessions.finish('teacher-b');
assert.equal(notices, afterUnsubscribe, 'unmounted views are unsubscribed');

// A route revisit after a lost 2xx response must retain the attempt and issue GET recovery only.
let posts = 0;
let recoveries = 0;
const recoverSessions = createPaperUploadSessions<Receipt>();
const attempt = { ...receipt, id: null };
assert.equal(recoverSessions.begin('teacher-a'), true);
posts++;
recoverSessions.patch('teacher-a', { receipt: attempt, phase: 'ncode' });
assert.equal(shouldKeepUploadAttempt({ phase: 'ncode', httpStatus: 200 }), true);
recoverSessions.finish('teacher-a');
// A new view reads the same registry without preserving component refs or state.
const reopened = recoverSessions.get('teacher-a').receipt;
assert.equal(reopened?.attemptId, 'attempt-a');
if (reopened) recoveries++;
else posts++;
assert.equal(posts, 1, 'malformed 2xx cannot authorize a second ncode POST after menu revisit');
assert.equal(recoveries, 1);
console.log('paper-upload-session: passed (no network or storage writes)');

// A view mounted before completion receives the shared completion transition and
// refreshes its own list, even though the original view has already unsubscribed.
const remountSessions = createPaperUploadSessions<Receipt>();
remountSessions.begin('teacher-a');
remountSessions.patch('teacher-a', { receipt });
let oldNotifications = 0;
const leaveOldView = remountSessions.subscribe(() => { oldNotifications++; });
leaveOldView();
let lastBusy = remountSessions.get('teacher-a').busy;
let newViewRows: number[] = []; // Its first server read happened before claim.
let refreshes = 0;
const leaveNewView = remountSessions.subscribe(() => {
  const busy = remountSessions.get('teacher-a').busy;
  if (lastBusy && !busy) {
    refreshes++;
    newViewRows = [157]; // Response of the newly mounted view's fresh GET.
  }
  lastBusy = busy;
});
remountSessions.accept('teacher-a', 157);
remountSessions.patch('teacher-a', { receipt: null });
assert.deepEqual(newViewRows, [], 'clearing the receipt alone is not list confirmation');
remountSessions.finish('teacher-a');
assert.equal(oldNotifications, 0);
assert.equal(refreshes, 1, 'the current view can observe completion exactly once');
assert.deepEqual(newViewRows, [157]);
leaveNewView();
console.log('paper-upload-session: remount-before-completion fixture passed');
