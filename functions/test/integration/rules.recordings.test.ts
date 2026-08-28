import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  COLLECTIONS,
  EMULATOR_PROJECT_ID,
  assignmentId,
  audioStoragePath,
  enrollmentId,
} from '@sabeel/shared';

let testEnv: RulesTestEnvironment;

/**
 * `host:port` from the emulator env var the CLI exports.
 *
 * NO fallback port, deliberately. `emulators:exec` always sets these
 * (`firebase-tools/lib/emulator/env.js`), so an unset var means the suite is
 * running outside the wrapper — and a hardcoded default does not rescue that,
 * it points at whatever happens to be on that port. On a machine where three
 * checkouts run emulators, that is a SIBLING's: it reads and writes happily and
 * turns a rules suite green against the wrong database. Failing loudly is the
 * only safe behaviour.
 */
function hostPort(envName: string) {
  const value = process.env[envName];
  if (!value) throw new Error(`${envName} is unset — run via npm run test:emulator`);
  const [host, port] = value.split(':');
  // Literal 127.0.0.1, never 'localhost': the emulators bind IPv4 only, while
  // 'localhost' can resolve to IPv6 ::1 first and fail at connect.
  return { host: host || '127.0.0.1', port: Number(port) };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: EMULATOR_PROJECT_ID,
    firestore: {
      ...hostPort('FIRESTORE_EMULATOR_HOST'),
      rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'),
    },
    storage: {
      ...hostPort('FIREBASE_STORAGE_EMULATOR_HOST'),
      rules: readFileSync(new URL('../../../storage.rules', import.meta.url), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const ADMIN = 'admin1';
const MINE = 'mgrMine';
const THEIRS = 'mgrTheirs';
const STUDENT = 'stu1';
const OUTSIDER = 'stu2';
const CLASS_MINE = 'classMine';
const CLASS_THEIRS = 'classTheirs';
const PUBLISHED = 'recPublished';
/** Published in the student's own course, but they were never excused for it. */
const UNGRANTED = 'recUngranted';
/** Published, but their grant was withdrawn (corrected to present, unpublished…). */
const WITHDRAWN = 'recWithdrawn';
const DRAFT = 'recDraft';
const THEIR_REC = 'recTheirs';

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const cls = (id: string, managerUids: string[]) =>
      setDoc(doc(db, COLLECTIONS.courses, id), {
        cohortId: 'c1',
        name: id,
        archived: false,
        effectiveActive: true,
        archivedAccess: false,
        managerUids,
        createdAt: 1,
        createdBy: ADMIN,
      });
    const rec = (id: string, courseId: string, status: string) =>
      setDoc(doc(db, COLLECTIONS.recordings, id), {
        cohortId: 'c1',
        courseId,
        title: id,
        status,
        source: 'manual',
        recordedAt: 1,
        notes: '',
        audioPath: audioStoragePath(id),
        durationSec: 60,
        sizeBytes: 100,
        createdAt: 1,
        createdBy: ADMIN,
        updatedAt: 1,
      });
    // The grant. A student reads a recording through this document and nothing
    // else, so every student-read case below is really a case about one of these.
    const grant = (recordingId: string, active: boolean) =>
      setDoc(doc(db, COLLECTIONS.assignments, assignmentId(STUDENT, recordingId)), {
        studentUid: STUDENT,
        recordingId,
        sessionId: 's1',
        courseId: CLASS_MINE,
        cohortId: 'c1',
        dueDate: '2099-01-01',
        active,
        assignedAt: 1,
        assignedBy: 'system',
      });
    await Promise.all([
      cls(CLASS_MINE, [MINE]),
      cls(CLASS_THEIRS, [THEIRS]),
      rec(PUBLISHED, CLASS_MINE, 'published'),
      rec(UNGRANTED, CLASS_MINE, 'published'),
      rec(WITHDRAWN, CLASS_MINE, 'published'),
      rec(DRAFT, CLASS_MINE, 'draft'),
      rec(THEIR_REC, CLASS_THEIRS, 'published'),
      grant(PUBLISHED, true),
      grant(WITHDRAWN, false),
      grant(DRAFT, true),
      setDoc(doc(db, COLLECTIONS.enrollments, enrollmentId(STUDENT, CLASS_MINE)), {
        studentUid: STUDENT,
        courseId: CLASS_MINE,
        cohortId: 'c1',
        active: true,
        enrolledAt: 1,
        enrolledBy: ADMIN,
      }),
    ]);
  });
});

const ctx = (uid: string, role: string) =>
  testEnv.authenticatedContext(uid, { role, status: 'active' });
const admin = () => ctx(ADMIN, 'admin');
const mine = () => ctx(MINE, 'manager');
const student = () => ctx(STUDENT, 'student');
const outsider = () => ctx(OUTSIDER, 'student');

describe('recordings: staff reads', () => {
  it('let an admin list everything', async () => {
    await assertSucceeds(getDocs(collection(admin().firestore(), COLLECTIONS.recordings)));
  });

  it('let a scoped manager query their own class', async () => {
    await assertSucceeds(
      getDocs(
        query(
          collection(mine().firestore(), COLLECTIONS.recordings),
          where('courseId', '==', CLASS_MINE),
        ),
      ),
    );
  });

  it('do NOT let a manager read another class\'s recordings', async () => {
    await assertFails(getDoc(doc(mine().firestore(), COLLECTIONS.recordings, THEIR_REC)));
    await assertFails(
      getDocs(
        query(
          collection(mine().firestore(), COLLECTIONS.recordings),
          where('courseId', '==', CLASS_THEIRS),
        ),
      ),
    );
  });

  it('let staff read a DRAFT, because they must verify it before publishing', async () => {
    await assertSucceeds(getDoc(doc(mine().firestore(), COLLECTIONS.recordings, DRAFT)));
  });
});

describe('recordings: student reads', () => {
  it('let a student read a published recording they were granted', async () => {
    await assertSucceeds(getDoc(doc(student().firestore(), COLLECTIONS.recordings, PUBLISHED)));
  });

  it('do NOT let an enrolled student read one they were never granted', async () => {
    // Same course, same active enrolment, published — and still refused. This is
    // the whole policy in one assertion: being in the class opens nothing, only
    // being excused does.
    await assertFails(getDoc(doc(student().firestore(), COLLECTIONS.recordings, UNGRANTED)));
  });

  it('do NOT let a student read one whose grant was withdrawn', async () => {
    // active:false — corrected to present, unpublished, or unenrolled. The row
    // survives for the ledger; the access does not.
    await assertFails(getDoc(doc(student().firestore(), COLLECTIONS.recordings, WITHDRAWN)));
  });

  it('do NOT let a student read an unpublished one even WITH a grant', async () => {
    // Drafts are staff working material; a student seeing one would be looking
    // at a recording nobody has checked yet. Both conditions must hold.
    await assertFails(getDoc(doc(student().firestore(), COLLECTIONS.recordings, DRAFT)));
  });

  it('do NOT let a student read a class they are not enrolled in', async () => {
    await assertFails(getDoc(doc(student().firestore(), COLLECTIONS.recordings, THEIR_REC)));
    await assertFails(getDoc(doc(outsider().firestore(), COLLECTIONS.recordings, PUBLISHED)));
  });

  it('deny a student ANY list of recordings, however constrained', async () => {
    // The student arm is get-only on purpose: resolving a grant per row would
    // cost two document-access calls each and blow the per-query cap. Students
    // list their own assignments — which needs no reads — and get from there.
    await assertFails(getDocs(collection(student().firestore(), COLLECTIONS.recordings)));
    await assertFails(
      getDocs(
        query(
          collection(student().firestore(), COLLECTIONS.recordings),
          where('courseId', '==', CLASS_MINE),
          where('status', '==', 'published'),
        ),
      ),
    );
  });
});

describe('recordings: writes', () => {
  it('are denied to everyone, including an admin', async () => {
    await assertFails(
      updateDoc(doc(admin().firestore(), COLLECTIONS.recordings, DRAFT), { status: 'published' }),
    );
    await assertFails(
      updateDoc(doc(mine().firestore(), COLLECTIONS.recordings, DRAFT), { title: 'x' }),
    );
    await assertFails(
      updateDoc(doc(student().firestore(), COLLECTIONS.recordings, PUBLISHED), { title: 'x' }),
    );
  });
});

describe('storage: audio object', () => {
  const bytes = () => new Uint8Array([0, 1, 2, 3]);
  const audio = { contentType: 'audio/mp4' };

  it('lets staff upload audio for a recording that has none', async () => {
    await assertSucceeds(
      uploadBytes(ref(mine().storage(), audioStoragePath('brandNew')), bytes(), audio),
    );
  });

  it('is WRITE-ONCE — a second upload is refused', async () => {
    // This is what stops a published recording's audio being swapped underneath
    // students who already listened to it.
    await assertSucceeds(
      uploadBytes(ref(mine().storage(), audioStoragePath('once')), bytes(), audio),
    );
    await assertFails(
      uploadBytes(ref(mine().storage(), audioStoragePath('once')), bytes(), audio),
    );
  });

  it('refuses a non-audio content type', async () => {
    await assertFails(
      uploadBytes(ref(mine().storage(), audioStoragePath('vid')), bytes(), {
        contentType: 'video/mp4',
      }),
    );
  });

  it('refuses students and anonymous callers', async () => {
    await assertFails(
      uploadBytes(ref(student().storage(), audioStoragePath('nope')), bytes(), audio),
    );
    await assertFails(
      uploadBytes(
        ref(testEnv.unauthenticatedContext().storage(), audioStoragePath('nope2')),
        bytes(),
        audio,
      ),
    );
  });

  it('denies READS to everyone — playback is signed URLs only', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await uploadBytes(ref(c.storage(), audioStoragePath(PUBLISHED)), bytes(), audio);
    });
    await assertFails(getDownloadURL(ref(admin().storage(), audioStoragePath(PUBLISHED))));
    await assertFails(getDownloadURL(ref(mine().storage(), audioStoragePath(PUBLISHED))));
    await assertFails(getDownloadURL(ref(student().storage(), audioStoragePath(PUBLISHED))));
  });

  it('refuses writes anywhere outside the recordings audio path', async () => {
    await assertFails(uploadBytes(ref(mine().storage(), 'anything/else.m4a'), bytes(), audio));
    await assertFails(
      uploadBytes(ref(mine().storage(), 'recordings/x/notes.txt'), bytes(), {
        contentType: 'text/plain',
      }),
    );
  });
});

describe('listeningProgress', () => {
  const mineId = `${STUDENT}_${PUBLISHED}`;
  const theirsId = `${OUTSIDER}_${PUBLISHED}`;
  const row = (uid: string) => ({
    studentUid: uid,
    recordingId: PUBLISHED,
    courseId: CLASS_MINE,
    positionMs: 1000,
    listenedMs: 1000,
    updatedAt: 1,
  });

  it('lets a student read their own row EVEN WHEN IT DOES NOT EXIST', async () => {
    // The first-time resume path. Without a null guard this is not a denial but
    // a rules EVALUATION ERROR, which surfaces to the app as a broken player.
    await assertSucceeds(
      getDoc(doc(student().firestore(), COLLECTIONS.listeningProgress, mineId)),
    );
  });

  it('lets a student create and update their own row', async () => {
    await assertSucceeds(
      setDoc(doc(student().firestore(), COLLECTIONS.listeningProgress, mineId), row(STUDENT)),
    );
    await assertSucceeds(
      setDoc(doc(student().firestore(), COLLECTIONS.listeningProgress, mineId), {
        ...row(STUDENT),
        positionMs: 5000,
      }),
    );
  });

  it('does NOT let a student write a row carrying someone else\'s uid', async () => {
    await assertFails(
      setDoc(doc(student().firestore(), COLLECTIONS.listeningProgress, theirsId), row(OUTSIDER)),
    );
  });

  it('does NOT let a student overwrite a row that is already someone else\'s', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), COLLECTIONS.listeningProgress, theirsId), row(OUTSIDER));
    });
    // Even claiming their own uid in the payload must not let them clobber it.
    await assertFails(
      setDoc(doc(student().firestore(), COLLECTIONS.listeningProgress, theirsId), row(STUDENT)),
    );
  });

  it('does not let a student LIST everyone\'s progress', async () => {
    // Added after a mutation test: widening `list` to any active student broke
    // no test at all, because every other case here uses a get. An unconstrained
    // list is the one shape that hands over the whole collection.
    await assertFails(getDocs(collection(student().firestore(), COLLECTIONS.listeningProgress)));
    await assertSucceeds(
      getDocs(
        query(
          collection(student().firestore(), COLLECTIONS.listeningProgress),
          where('studentUid', '==', STUDENT),
        ),
      ),
    );
  });

  it('does not let a student read another student\'s row', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), COLLECTIONS.listeningProgress, theirsId), row(OUTSIDER));
    });
    await assertFails(
      getDoc(doc(student().firestore(), COLLECTIONS.listeningProgress, theirsId)),
    );
  });

  it('does not let staff touch progress — that is the Phase 5 ledger', async () => {
    await assertFails(getDocs(collection(mine().firestore(), COLLECTIONS.listeningProgress)));
    await assertFails(
      setDoc(doc(admin().firestore(), COLLECTIONS.listeningProgress, mineId), row(STUDENT)),
    );
  });

  it('never allows deletion', async () => {
    await testEnv.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), COLLECTIONS.listeningProgress, mineId), row(STUDENT));
    });
    await assertFails(
      deleteDoc(doc(student().firestore(), COLLECTIONS.listeningProgress, mineId)),
    );
  });
});
