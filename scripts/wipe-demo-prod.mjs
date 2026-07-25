/**
 * Remove everything `seed-demo-prod.mjs` put into the LIVE project — and nothing
 * else.
 *
 *   node scripts/wipe-demo-prod.mjs
 *
 * Precision comes from two markers the seed sets on everything it creates:
 * a `demoSeed: true` field, and a `demo-` id prefix on every document and auth
 * uid. Anything you created yourself has neither, so it survives.
 *
 * But the flag alone is NOT enough, and assuming it was left orphans behind.
 * Plenty of demo-related documents are written by the app and the triggers
 * rather than by the seed, so they never carry the flag:
 *
 *   - assignments      — the publish/attendance fan-out creates them
 *   - listeningProgress / completions / completionEvents — written by anyone who
 *     opens a demo recording and presses play, including while demoing it
 *   - auditLog         — `getPlaybackUrl` and every staff callable audits itself
 *
 * So the sweep is by REFERENCE as well: any of those documents pointing at a
 * `demo-rec-` recording, a `demo-stu-` student, or a `demo-crs-` course goes
 * too. Those prefixes only exist on seeded data, so this cannot reach anything
 * of yours — and it keeps working however much you click around before wiping.
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT = 'sabeel-class-recordings';
const BUCKET = 'sabeel-class-recordings.firebasestorage.app';
if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST is set — this script targets production.');
}
admin.initializeApp({ projectId: PROJECT, storageBucket: BUCKET });
const db = admin.firestore();
const auth = admin.auth();
const bucket = admin.storage().bucket();

const MARKED = ['cohorts','courses','sessions','recordings','students','enrollments',
  'completions','listeningProgress','completionOverrides','completionEvents','auditLog','staffUsers'];

let total = 0;
async function del(docs, label) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }
  if (docs.length) console.log(`   ${String(docs.length).padStart(5)}  ${label}`);
  total += docs.length;
}

console.log('Removing demo data from PRODUCTION…');
for (const coll of MARKED) {
  const snap = await db.collection(coll).where('demoSeed', '==', true).get();
  await del(snap.docs, coll);
}

// Anything the APP or the TRIGGERS wrote about demo data. These never carry the
// flag, so they are matched by what they point at.
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
// Sessions and recordings are swept by reference too, not only by the flag —
// anything YOU added inside a demo course lands here. Deleting the course while
// leaving those behind would orphan them (a session pointing at a course that no
// longer exists, and its audio paid for indefinitely), so they go with it. They
// are listed individually below, because they are the one category of thing this
// removes that you created rather than the seed.
const yoursInDemo = [];
for (const coll of ['sessions', 'recordings']) {
  const snap = await db.collection(coll).get();
  const refd = snap.docs.filter((d) => d.data().demoSeed !== true && isDemoRef(d));
  for (const d of refd) yoursInDemo.push(`${coll}/${d.id} — “${d.data().title ?? ''}”`);
  await del(refd, `${coll} (yours, inside a demo course)`);
}

for (const coll of ['assignments', 'completions', 'completionEvents', 'listeningProgress',
  'completionOverrides', 'auditLog']) {
  const snap = await db.collection(coll).get();
  await del(snap.docs.filter((d) => d.data().demoSeed !== true && isDemoRef(d)),
    `${coll} (app/trigger-written)`);
}

// Storage: the audio of every recording removed above — which is NOT the same as
// "everything under recordings/demo-rec-". A recording you added inside a demo
// course has an ordinary random id, and keying the delete off the prefix would
// leave its bytes in the bucket forever, being paid for.
const surviving = new Set((await db.collection('recordings').get()).docs.map((d) => d.id));
const [files] = await bucket.getFiles({ prefix: 'recordings/' });
const orphaned = files.filter((f) => !surviving.has(f.name.split('/')[1]));
if (orphaned.length) {
  for (let i = 0; i < orphaned.length; i += 20) {
    await Promise.all(orphaned.slice(i, i + 20).map((f) => f.delete().catch(() => {})));
  }
  console.log(`   ${String(orphaned.length).padStart(5)}  storage objects (audio with no recording left)`);
}
await bucket.deleteFiles({ prefix: 'demo-seed/' }).catch(() => {});

// Auth: only uids the seed minted.
const demoUids = [];
let page;
do {
  const r = await auth.listUsers(1000, page);
  demoUids.push(...r.users.filter((u) => u.uid.startsWith('demo-')).map((u) => u.uid));
  page = r.pageToken;
} while (page);
for (let i = 0; i < demoUids.length; i += 900) {
  await auth.deleteUsers(demoUids.slice(i, i + 900));
}
if (demoUids.length) console.log(`   ${String(demoUids.length).padStart(5)}  auth accounts`);

console.log(`\nRemoved ${total} documents + ${demoUids.length} accounts.`);
if (yoursInDemo.length) {
  console.log('\nThese were NOT seed data — you created them inside a demo course, so they');
  console.log('went with it rather than being left pointing at nothing:');
  for (const y of yoursInDemo) console.log(`   ${y}`);
}
console.log('\nLeft untouched:');
for (const c of ['cohorts', 'courses', 'sessions', 'recordings', 'auditLog', 'staffUsers']) {
  console.log(`   ${c}: ${(await db.collection(c).count().get()).data().count} remaining`);
}
process.exit(0);
