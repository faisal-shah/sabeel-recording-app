/**
 * One-shot migration to the excused-only access policy.
 *
 *   node scripts/migrate-excused-only.mjs --dry-run   # report, change nothing
 *   node scripts/migrate-excused-only.mjs             # apply
 *
 * Two things changed under every existing session at once:
 *
 *  1. A session's `dueDate` became REQUIRED — it is now the day an excused
 *     student's access closes, and a blank one would mean access that never
 *     closes. Sessions written before the change may hold null.
 *  2. Being marked ABSENT stopped granting anything. Only `excused` does.
 *
 * So this backfills the missing due dates and then TOUCHES every session, which
 * is all that is needed to re-derive the rest: `onSessionWritten` reconciles the
 * grants against the new rule and writes each student's `attendanceRecords`
 * projection for the first time. Nothing here computes an assignment itself —
 * the deployed trigger is the only writer, and a second implementation here
 * would be free to disagree with it.
 *
 * CONSEQUENCE, accepted deliberately: a student who was accountable only because
 * they were marked absent loses that obligation and its access. The row survives
 * with `active: false`, so the ledger still records what happened. Sessions whose
 * backfilled due date is already in the past produce Missed rows, which is the
 * honest result — that deadline really has gone.
 *
 * ORDER MATTERS. Deploy the functions FIRST. The whole design here is that the
 * deployed trigger does the deriving, so running this against the old one would
 * faithfully re-create exactly the absent-derived grants it is meant to remove,
 * and report success while doing it. Run order: rules → indexes → functions →
 * THIS → hosting.
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT = process.env.MIGRATE_PROJECT ?? 'sabeel-class-recordings';
const DRY = process.argv.includes('--dry-run');

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

/** Matches DEFAULT_DUE_DAYS in @sabeel/shared; inlined so this script has no build step. */
const DEFAULT_DUE_DAYS = 7;
const addDays = (date, days) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const count = async (q) => (await q.count().get()).data().count;

console.log(`Excused-only migration against ${PROJECT}${DRY ? '  (DRY RUN)' : ''}\n`);

// ---------------------------------------------------------------- before --
const sessions = await db.collection('sessions').get();
const beforeActive = await count(db.collection('assignments').where('active', '==', true));
const beforeMirrors = await count(db.collection('attendanceRecords'));
const missingDue = sessions.docs.filter((d) => !d.data().dueDate);

let excusedMarks = 0;
let absentMarks = 0;
let submitted = 0;
for (const d of sessions.docs) {
  const s = d.data();
  if (!s.attendanceSubmittedAt) continue;
  submitted++;
  for (const status of Object.values(s.attendance ?? {})) {
    if (status === 'excused') excusedMarks++;
    if (status === 'absent') absentMarks++;
  }
}

console.log(`  sessions                    ${sessions.size} (${submitted} with attendance submitted)`);
console.log(`  sessions with no due date   ${missingDue.length}`);
console.log(`  excused marks (keep access) ${excusedMarks}`);
console.log(`  absent marks (lose access)  ${absentMarks}`);
console.log(`  active assignments BEFORE   ${beforeActive}`);
console.log(`  attendanceRecords BEFORE    ${beforeMirrors}\n`);

if (DRY) {
  console.log('Dry run — nothing written.');
  process.exit(0);
}

// ----------------------------------------------------------------- apply --
// Backfill first, so the touch that follows reconciles against a due date that
// exists. Batched at 400; a Firestore batch caps at 500.
let backfilled = 0;
for (let i = 0; i < missingDue.length; i += 400) {
  const batch = db.batch();
  for (const d of missingDue.slice(i, i + 400)) {
    batch.update(d.ref, { dueDate: addDays(d.data().date, DEFAULT_DUE_DAYS) });
    backfilled++;
  }
  await batch.commit();
}
console.log(`  backfilled ${backfilled} due date(s)`);

// Touch every session. `updatedAt` is the least meaningful field to move, and
// moving it is enough: onSessionWritten fires on any write and re-derives from
// stored truth, not from the payload.
const now = Date.now();
for (let i = 0; i < sessions.docs.length; i += 400) {
  const batch = db.batch();
  for (const d of sessions.docs.slice(i, i + 400)) batch.update(d.ref, { updatedAt: now });
  await batch.commit();
}
console.log(`  touched ${sessions.size} session(s) — waiting for the triggers`);

// ------------------------------------------------------------------ after --
// Poll rather than sleep a fixed amount: the fan-out is one invocation per
// session and finishes in seconds, but "finished" is a count settling, not a
// timer expiring.
let afterActive = -1;
let afterMirrors = -1;
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const a = await count(db.collection('assignments').where('active', '==', true));
  const m = await count(db.collection('attendanceRecords'));
  if (a === afterActive && m === afterMirrors && m > 0) break;
  afterActive = a;
  afterMirrors = m;
  process.stdout.write(`\r  settling… active=${a} mirrors=${m}   `);
}
console.log('\n');
console.log(`  active assignments AFTER    ${afterActive}  (was ${beforeActive})`);
console.log(`  attendanceRecords AFTER     ${afterMirrors}  (was ${beforeMirrors})`);

// The migration is only right if the numbers agree with the rule. Report rather
// than assert: a mismatch is worth a human look, not a half-applied rollback.
const marked = sessions.docs
  .filter((d) => d.data().attendanceSubmittedAt)
  .reduce((n, d) => n + Object.keys(d.data().attendance ?? {}).length, 0);
console.log('');
console.log(
  afterMirrors === marked
    ? `  ✓ every submitted mark has a projection (${marked})`
    : `  ! ${marked} submitted marks but ${afterMirrors} projections — investigate`,
);
console.log(
  afterActive <= excusedMarks
    ? `  ✓ no more active grants than excused marks (${afterActive} ≤ ${excusedMarks})`
    : `  ! ${afterActive} active grants but only ${excusedMarks} excused marks — investigate`,
);
process.exit(0);
