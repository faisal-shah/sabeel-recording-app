/**
 * One-shot migration: `sessions.archived` becomes `sessions.notRecorded`.
 *
 *   node scripts/migrate-not-recorded.mjs --dry-run   # report, change nothing
 *   node scripts/migrate-not-recorded.mjs             # apply
 *
 * `archived` was written `false` at creation and set true by nothing: no
 * callable offered it and no screen showed it, while two readers — the staff
 * work queue and the "attendance still not taken" job — already treated it as
 * "leave this session alone". The field now says which kind of leaving-alone it
 * means, and staff have a control that sets it: a class that met and was
 * deliberately not recorded.
 *
 * SAFE EITHER WAY, which is why this is tidying rather than a prerequisite. Both
 * readers test truthiness, so a document with neither field behaves exactly as
 * one with `notRecorded: false`. Running it late changes no behaviour; not
 * running it at all leaves every session carrying a field the code no longer
 * names and missing one the type says is required — which is a lie waiting for
 * the next person who reads the type and trusts it.
 *
 * NO TRIGGER IS WANTED HERE. Unlike the excused-only migration, this must NOT
 * re-derive anything: `onSessionWritten` reconciles grants from attendance, and
 * touching every session in the institute to rename a field would re-run that
 * fan-out for no reason. The update carries only the two fields.
 *
 * Ordering: deploy the functions FIRST, so `createSessionRecord` is already
 * writing `notRecorded` before this sweeps the ones that predate it.
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = require('firebase-admin');

const PROJECT = process.env.MIGRATE_PROJECT ?? 'sabeel-class-recordings';
const DRY = process.argv.includes('--dry-run');

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();

console.log(`notRecorded migration against ${PROJECT}${DRY ? '  (DRY RUN)' : ''}\n`);

const sessions = await db.collection('sessions').get();
const stale = sessions.docs.filter((d) => {
  const s = d.data();
  return s.archived !== undefined || s.notRecorded === undefined;
});
// `archived: true` was unreachable — nothing ever set it — so finding one means
// this migration's assumption is wrong and the value must be carried across by
// hand rather than dropped.
const wereArchived = sessions.docs.filter((d) => d.data().archived === true);

console.log(`  sessions                 ${sessions.size}`);
console.log(`  needing the rename       ${stale.length}`);
console.log(`  already notRecorded      ${sessions.docs.filter((d) => d.data().notRecorded === true).length}`);
console.log(`  UNEXPECTED archived:true ${wereArchived.length}\n`);

if (wereArchived.length > 0) {
  console.error('Refusing to run: `archived: true` exists, which no code path could write.');
  console.error('Decide what those sessions mean before renaming the field.');
  process.exit(1);
}

if (DRY) {
  console.log('Dry run — nothing written.');
  process.exit(0);
}

// Batched at 400; a Firestore batch caps at 500. Only the two fields — see the
// note above on not waking the fan-out.
let done = 0;
for (let i = 0; i < stale.length; i += 400) {
  const batch = db.batch();
  for (const d of stale.slice(i, i + 400)) {
    batch.update(d.ref, { notRecorded: false, archived: admin.firestore.FieldValue.delete() });
    done++;
  }
  await batch.commit();
}
console.log(`  renamed on ${done} session(s)`);

const after = await db.collection('sessions').get();
const left = after.docs.filter((d) => d.data().archived !== undefined || d.data().notRecorded === undefined);
console.log(`  sessions still carrying the old shape: ${left.length}`);
process.exit(left.length === 0 ? 0 : 1);
