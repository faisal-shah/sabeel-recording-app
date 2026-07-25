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
 * Assignments are the exception worth explaining: they are written by the
 * production triggers, not by the seed, so they carry no marker. They are
 * matched by `recordingId` starting with `demo-rec-` instead — the recordings
 * ARE marked, and an assignment can only exist for one of them.
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

// Trigger-created assignments: matched via their demo recording id.
const assigns = await db.collection('assignments').get();
await del(assigns.docs.filter((d) => String(d.data().recordingId ?? '').startsWith('demo-rec-')),
  'assignments (trigger-created)');

// Storage: only the demo recordings' audio.
const [files] = await bucket.getFiles({ prefix: 'recordings/demo-rec-' });
if (files.length) {
  for (let i = 0; i < files.length; i += 20) {
    await Promise.all(files.slice(i, i + 20).map((f) => f.delete().catch(() => {})));
  }
  console.log(`   ${String(files.length).padStart(5)}  storage objects`);
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
console.log('Anything not created by the demo seed was left untouched:');
for (const c of ['cohorts','courses','staffUsers']) {
  console.log(`   ${c}: ${(await db.collection(c).count().get()).data().count} remaining`);
}
process.exit(0);
