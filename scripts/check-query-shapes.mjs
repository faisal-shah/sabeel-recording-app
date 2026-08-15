/**
 * Run every query shape the app issues against the REAL project, and fail on
 * any that needs a composite index which does not exist.
 *
 *     npm run check:queries
 *
 * WHY THIS CANNOT BE AN EMULATOR TEST: the Firestore emulator builds indexes on
 * demand and never returns FAILED_PRECONDITION. Every query passes locally
 * whether or not `firestore.indexes.json` contains anything at all — which is
 * exactly how this repo shipped with an EMPTY index file and two admin screens
 * that failed the moment a real user opened them (2026-07-22).
 *
 * Rules are irrelevant here — the Admin SDK bypasses them — and so is the data:
 * whether a query needs an index is a property of its SHAPE, so empty
 * collections and made-up ids exercise it perfectly well.
 *
 * Keep this list in step with the app. If you add a `where` + `orderBy` on
 * different fields, add the shape here in the same change.
 */
import { createRequire } from 'node:module';

// Resolved from the functions workspace, which already depends on the Admin SDK.
// Adding it at the root would be a second copy of a large package for one
// script, so knip is told to expect the unlisted import instead.
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT_ID = process.env.CHECK_PROJECT ?? 'sabeel-class-recordings';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

// Placeholders: shape is what matters, not whether anything matches.
const ID = '__shape_probe__';

const shapes = [
  ['students — the directory', () => db.collection('students').orderBy('displayName', 'asc')],
  ['cohorts — newest first', () => db.collection('cohorts').orderBy('createdAt', 'desc')],
  [
    'staffUsers — waiting for approval',
    () => db.collection('staffUsers').where('status', '==', 'pending').orderBy('createdAt', 'asc'),
  ],
  [
    'staffUsers — everyone already decided',
    () =>
      db
        .collection('staffUsers')
        .where('status', 'in', ['active', 'disabled'])
        .orderBy('displayName', 'asc'),
  ],
  [
    'courses — within a cohort',
    () => db.collection('courses').where('cohortId', '==', ID).orderBy('createdAt', 'asc'),
  ],
  [
    "courses — a manager's own",
    () => db.collection('courses').where('managerUids', 'array-contains', ID),
  ],
  [
    'recordings — staff library for a class',
    () => db.collection('recordings').where('courseId', '==', ID).orderBy('createdAt', 'desc'),
  ],
  ['enrollments — a class roster', () => db.collection('enrollments').where('courseId', '==', ID)],
  [
    "enrollments — a student's courses",
    () => db.collection('enrollments').where('studentUid', '==', ID),
  ],
  [
    'staffUsers — does an admin exist (bootstrap)',
    () =>
      db
        .collection('staffUsers')
        .where('role', '==', 'admin')
        .where('status', '==', 'active')
        .limit(1),
  ],
  [
    'courses — cascade over a cohort (server)',
    () => db.collection('courses').where('cohortId', '==', ID),
  ],
  // ---- Phase 4: assignments, completions ----
  [
    "assignments — a student's active obligations (home)",
    () => db.collection('assignments').where('studentUid', '==', ID).where('active', '==', true),
  ],
  [
    'assignments — a class roster (staff/move)',
    () => db.collection('assignments').where('courseId', '==', ID).where('active', '==', true),
  ],
  [
    "assignments — a recording's rows (deactivate fan-out)",
    () => db.collection('assignments').where('recordingId', '==', ID).where('active', '==', true),
  ],
  [
    "assignments — a student's rows in a class (unenrol)",
    () => db.collection('assignments').where('studentUid', '==', ID).where('courseId', '==', ID),
  ],
  [
    'enrollments — active roster (fan-out)',
    () => db.collection('enrollments').where('courseId', '==', ID).where('active', '==', true),
  ],
  // ---- attendanceRecords: the student's own marks ----
  [
    "attendanceRecords — a student's marks in one class",
    () =>
      db.collection('attendanceRecords').where('studentUid', '==', ID).where('courseId', '==', ID),
  ],
  [
    "attendanceRecords — a session's rows (mirror reconcile)",
    () => db.collection('attendanceRecords').where('sessionId', '==', ID),
  ],
  [
    "completions — a student's own (home join)",
    () => db.collection('completions').where('studentUid', '==', ID),
  ],
  // ---- Phase 5: staff ledger reads ----
  [
    'completions — a class ledger (staff)',
    () => db.collection('completions').where('courseId', '==', ID),
  ],
  [
    'listeningProgress — a class ledger (staff)',
    () => db.collection('listeningProgress').where('courseId', '==', ID),
  ],
  [
    'completionEvents — a class ledger (staff)',
    () => db.collection('completionEvents').where('courseId', '==', ID),
  ],
  [
    'completionOverrides — a class ledger (staff)',
    () => db.collection('completionOverrides').where('courseId', '==', ID),
  ],
  [
    "completionOverrides — a student's own",
    () => db.collection('completionOverrides').where('studentUid', '==', ID),
  ],
  [
    "assignments — a student's rows in a class (student ledger, manager)",
    () => db.collection('assignments').where('studentUid', '==', ID).where('courseId', '==', ID),
  ],
  [
    'auditLog — a class, newest first (manager audit view)',
    () => db.collection('auditLog').where('courseId', '==', ID).orderBy('at', 'desc'),
  ],
  [
    'auditLog — global, newest first (admin audit view)',
    () => db.collection('auditLog').orderBy('at', 'desc'),
  ],
  // ---- Phase 5c: recording-ledger reads ----
  [
    "completions — a recording's roster (recording ledger)",
    () => db.collection('completions').where('recordingId', '==', ID),
  ],
  [
    "completionOverrides — a recording's (recording ledger)",
    () => db.collection('completionOverrides').where('recordingId', '==', ID),
  ],
  [
    "listeningProgress — a recording's (recording ledger)",
    () => db.collection('listeningProgress').where('recordingId', '==', ID),
  ],
];

console.log(`Query shapes against ${PROJECT_ID}\n`);

const failures = [];
for (const [name, build] of shapes) {
  try {
    const snap = await build().get();
    console.log(`  ok   ${name} — ${snap.size} doc(s)`);
  } catch (e) {
    // FAILED_PRECONDITION is the missing-index signal; anything else is still a
    // failure worth surfacing rather than swallowing.
    const missingIndex = /FAILED_PRECONDITION|requires an index/i.test(e.message);
    failures.push(name);
    console.log(`  FAIL ${name} — ${missingIndex ? 'MISSING INDEX' : 'error'}: ${e.message.split('\n')[0]}`);
    if (missingIndex && /https:\/\/\S+/.test(e.message)) {
      console.log(`       ${e.message.match(/https:\/\/\S+/)[0]}`);
    }
  }
}

console.log(failures.length ? `\n${failures.length} shape(s) FAILED` : '\nevery query shape is servable');
process.exit(failures.length ? 1 : 0);
