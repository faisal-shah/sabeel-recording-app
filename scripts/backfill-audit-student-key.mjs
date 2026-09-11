/**
 * Give every `createStudent` and `setStudentAccess` row in the LIVE audit log
 * the key a student's history is read by.
 *
 *   node scripts/backfill-audit-student-key.mjs          # DRY RUN: prints the plan, writes nothing
 *   node scripts/backfill-audit-student-key.mjs --yes    # write
 *
 * The student page reads `auditLog where targets.studentUid == <uid>`, and the
 * two callables have written that key since v0.6.0. Before it, `createStudent`
 * named the student under `targets.uid` — and before THAT under nothing at all,
 * because the wrapper derives targets from the payload and a new account has no
 * uid in the payload. Left alone, a student created before v0.6.0 has an
 * "Account created" line and no "Enrolled in …" line on their page, although
 * the log holds the row; the manual promises the whole story, so this is what
 * makes it true for the accounts that already exist.
 *
 * ADDS ONE KEY AND CHANGES NOTHING ELSE. `targets.uid` stays where it is; no
 * row is rewritten, removed or re-dated. The uid comes from, in order:
 *
 *   1. `targets.uid` — the row says who;
 *   2. `detail.email` — the row says which address, and the students collection
 *      says whose it is;
 *   3. the student document the same actor created in the five seconds before
 *      the row was written — the wrapper writes the row after the account, and
 *      in practice within two seconds — who, if the row names a course, is
 *      enrolled in that course. Taken ONLY when exactly one student fits; a row
 *      with none or several is reported and left alone rather than guessed at.
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT = 'sabeel-class-recordings';
const EXECUTE = process.argv.includes('--yes');
if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is set — this script targets production.');
}
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const { FieldPath } = admin.firestore;

const ACTIONS = ['createStudent', 'setStudentAccess'];
/** How long after the account the wrapper may write its row. Generous: the
 *  seven rows this was written for were all under two seconds. */
const WINDOW_MS = 5000;

const students = (await db.collection('students').get()).docs.map((d) => ({ uid: d.id, ...d.data() }));
const byEmail = new Map(students.map((s) => [String(s.email).toLowerCase(), s]));
const enrolled = new Set((await db.collection('enrollments').get()).docs.map((d) => d.id)); // `${uid}_${courseId}`

const rows = (await db.collection('auditLog').where('action', 'in', ACTIONS).get()).docs;
const missing = rows.filter((d) => !d.data().targets?.studentUid);

const plan = [];     // { ref, uid, how, when, email }
const unmatched = [];
for (const d of missing) {
  const x = d.data();
  const when = new Date(x.at).toISOString();
  let uid = null;
  let how = '';
  if (typeof x.targets?.uid === 'string' && x.targets.uid) {
    uid = x.targets.uid;
    how = 'targets.uid';
  } else if (byEmail.has(String(x.detail?.email ?? '').toLowerCase())) {
    uid = byEmail.get(String(x.detail.email).toLowerCase()).uid;
    how = 'detail.email';
  } else if (x.action === 'createStudent') {
    const fits = students.filter(
      (s) =>
        s.createdBy === x.actorUid &&
        x.at - s.createdAt >= 0 &&
        x.at - s.createdAt <= WINDOW_MS &&
        (!x.courseId || enrolled.has(`${s.uid}_${x.courseId}`)),
    );
    if (fits.length === 1) {
      uid = fits[0].uid;
      how = `created by the same actor ${x.at - fits[0].createdAt} ms earlier`;
    }
  }
  const email = students.find((s) => s.uid === uid)?.email ?? '(no student document)';
  if (uid) plan.push({ ref: d.ref, uid, how, when, email, action: x.action });
  else unmatched.push({ id: d.id, when, action: x.action, courseId: x.courseId ?? null });
}

console.log(EXECUTE ? 'WRITING to the PRODUCTION audit log' : 'DRY RUN — nothing will be written');
console.log(`\n   ${rows.length} ${ACTIONS.join('/')} rows, ${rows.length - missing.length} already keyed, ${missing.length} without targets.studentUid\n`);
for (const p of plan) console.log(`   ${p.when}  ${p.action.padEnd(16)} -> ${p.email.padEnd(34)} via ${p.how}`);
if (unmatched.length) {
  console.log('\n   LEFT ALONE — no single student fits:');
  for (const u of unmatched) console.log(`      ${u.when}  ${u.action}  auditLog/${u.id}  course ${u.courseId}`);
}

if (!EXECUTE) {
  console.log(`\n${plan.length} row(s) would be keyed. Re-run with --yes to write.`);
  process.exit(0);
}

for (const p of plan) {
  await p.ref.update(new FieldPath('targets', 'studentUid'), p.uid);
}
console.log(`\n   keyed ${plan.length} row(s)`);

// The promise is that every one of these rows can be found by the page's query,
// so ask the database that, not the plan.
const after = (await db.collection('auditLog').where('action', 'in', ACTIONS).get()).docs;
const still = after.filter((d) => !d.data().targets?.studentUid).length;
console.log(`   ${after.length - still} of ${after.length} rows now carry targets.studentUid` + (still ? ` — ${still} still without (listed above as left alone)` : ''));
process.exit(still === unmatched.length ? 0 : 1);
