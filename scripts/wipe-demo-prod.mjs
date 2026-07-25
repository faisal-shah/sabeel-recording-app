/**
 * Remove everything `seed-demo-prod.mjs` put into the LIVE project — and nothing
 * else.
 *
 *   node scripts/wipe-demo-prod.mjs           # DRY RUN: prints the plan, deletes nothing
 *   node scripts/wipe-demo-prod.mjs --yes     # actually delete
 *
 * Dry run is the DEFAULT on purpose. This deletes hundreds of documents from
 * production, including — see below — a few things you may have made yourself,
 * and it may be run months later by someone (or some session) with no memory of
 * how the data got there. Making the destructive path opt-in means the worst a
 * mistaken invocation can do is print a list.
 *
 * WHAT COUNTS AS DEMO DATA
 *
 * The seed marks everything it writes with `demoSeed: true` and a `demo-` id
 * prefix. But the flag alone is not enough, and assuming it was left orphans:
 * plenty of demo-related documents are written by the app and by the triggers,
 * so they never carry it —
 *
 *   - assignments        — created by the publish/attendance fan-out
 *   - listeningProgress / completions / completionEvents — written by anyone who
 *     opens a demo recording and presses play, including while demoing it
 *   - auditLog           — `getPlaybackUrl` and every staff callable audits itself
 *   - sessions / recordings — anything YOU add inside a demo course while
 *     exploring. These are listed by name in the plan, because they are the one
 *     category this removes that you created rather than the seed. They go with
 *     the course: leaving them would orphan them (a session pointing at a course
 *     that no longer exists) and strand their audio in the bucket, billable.
 *
 * So the sweep is by REFERENCE as well as by flag: anything pointing at a
 * `demo-rec-`, `demo-stu-`, `demo-crs-` or `demo-ses-` id. Those prefixes exist
 * only on seeded data, so this cannot reach anything unrelated to the demo.
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT = 'sabeel-class-recordings';
const BUCKET = 'sabeel-class-recordings.firebasestorage.app';
const EXECUTE = process.argv.includes('--yes');
if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is set — this script targets production.');
}
admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
const db = admin.firestore();
const auth = admin.auth();
const bucket = admin.storage().bucket();

const FLAGGED = ['cohorts','courses','sessions','recordings','students','enrollments',
  'completions','listeningProgress','completionOverrides','completionEvents','auditLog','staffUsers'];
const BY_REFERENCE = ['sessions','recordings','assignments','completions','completionEvents',
  'listeningProgress','completionOverrides','auditLog'];

const isDemoRef = (d) => {
  const v = d.data();
  return (
    String(v.recordingId ?? '').startsWith('demo-rec-') ||
    String(v.studentUid ?? '').startsWith('demo-stu-') ||
    String(v.courseId ?? '').startsWith('demo-crs-') ||
    String(v.sessionId ?? '').startsWith('demo-ses-') ||
    Object.values(v.targets ?? {}).some((t) => String(t).startsWith('demo-'))
  );
};

// ---------------------------------------------------------------- the plan --
const plan = [];      // { label, docs }
const yoursInDemo = [];
const seen = new Set();

for (const coll of FLAGGED) {
  const snap = await db.collection(coll).where('demoSeed', '==', true).get();
  snap.docs.forEach((d) => seen.add(d.ref.path));
  if (snap.size) plan.push({ label: `${coll} (seeded)`, docs: snap.docs });
}
for (const coll of BY_REFERENCE) {
  const snap = await db.collection(coll).get();
  const docs = snap.docs.filter(
    (d) => !seen.has(d.ref.path) && d.data().demoSeed !== true && isDemoRef(d),
  );
  docs.forEach((d) => seen.add(d.ref.path));
  if (coll === 'sessions' || coll === 'recordings') {
    for (const d of docs) yoursInDemo.push(`${coll}/${d.id} — “${d.data().title ?? ''}”`);
  }
  if (docs.length) plan.push({ label: `${coll} (app/trigger-written)`, docs });
}

const removedRecordingIds = new Set(
  plan.filter((p) => p.label.startsWith('recordings')).flatMap((p) => p.docs.map((d) => d.id)),
);
const [allFiles] = await bucket.getFiles({ prefix: 'recordings/' });
const orphanFiles = allFiles.filter((f) => removedRecordingIds.has(f.name.split('/')[1]));
const [seedTmp] = await bucket.getFiles({ prefix: 'demo-seed/' });

const demoUsers = [];
let page;
do {
  const r = await auth.listUsers(1000, page);
  demoUsers.push(...r.users.filter((u) => u.uid.startsWith('demo-')));
  page = r.pageToken;
} while (page);

const totalDocs = plan.reduce((n, p) => n + p.docs.length, 0);

console.log(EXECUTE ? 'DELETING demo data from PRODUCTION' : 'DRY RUN — nothing will be deleted');
console.log('');
for (const p of plan) console.log(`   ${String(p.docs.length).padStart(5)}  ${p.label}`);
console.log(`   ${String(orphanFiles.length + seedTmp.length).padStart(5)}  storage objects`);
console.log(`   ${String(demoUsers.length).padStart(5)}  auth accounts`);
console.log(`\n   total: ${totalDocs} documents`);

if (yoursInDemo.length) {
  console.log('\n   NOT seed data — you created these inside a demo course, so they go with it:');
  for (const y of yoursInDemo) console.log(`      ${y}`);
}

// -------------------------------------------------------------- what stays --
console.log('\nWhat survives:');
for (const c of ['cohorts','courses','sessions','recordings','auditLog','staffUsers']) {
  const snap = await db.collection(c).get();
  const left = snap.docs.filter((d) => !seen.has(d.ref.path));
  console.log(`   ${String(left.length).padStart(5)}  ${c}` +
    (left.length && left.length <= 4 ? `  (${left.map((d) => d.id.slice(0, 22)).join(', ')})` : ''));
}

if (!EXECUTE) {
  console.log('\nRe-run with --yes to delete.');
  process.exit(0);
}

// ----------------------------------------------------------------- execute --
console.log('\nDeleting…');
for (const p of plan) {
  for (let i = 0; i < p.docs.length; i += 400) {
    const batch = db.batch();
    for (const d of p.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  console.log(`   removed ${p.docs.length} ${p.label}`);
}
for (const group of [orphanFiles, seedTmp]) {
  for (let i = 0; i < group.length; i += 20) {
    await Promise.all(group.slice(i, i + 20).map((f) => f.delete().catch(() => {})));
  }
}
console.log(`   removed ${orphanFiles.length + seedTmp.length} storage objects`);
for (let i = 0; i < demoUsers.length; i += 900) {
  await auth.deleteUsers(demoUsers.slice(i, i + 900).map((u) => u.uid));
}
console.log(`   removed ${demoUsers.length} auth accounts`);
console.log('\nDone.');
process.exit(0);
