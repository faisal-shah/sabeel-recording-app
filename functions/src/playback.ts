import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  canPlayFromClass,
  enrollmentId,
  isStaffRole,
  type ClassDoc,
  type EnrollmentDoc,
  type RecordingDoc,
  type TokenClaims,
} from '@sabeel/shared';
import { signedPlaybackUrl, type SignedPlayback } from './mediaUrl';

export type PlaybackDenial =
  | 'not-published'
  | 'not-enrolled'
  | 'class-listening-off'
  | 'not-your-class'
  | 'no-audio';

/**
 * May this caller play this recording, and if not, why?
 *
 * Pure, so every branch is unit-testable without an emulator or a signing
 * service. `playbackDenial` returning null means allowed.
 */
export function playbackDenial(input: {
  claims: TokenClaims;
  recording: Pick<RecordingDoc, 'status' | 'audioPath'>;
  cls: Pick<ClassDoc, 'effectiveActive' | 'archivedAccess' | 'managerUids'>;
  uid: string;
  enrollmentActive: boolean;
}): PlaybackDenial | null {
  const { claims, recording, cls, uid, enrollmentActive } = input;
  if (!recording.audioPath) return 'no-audio';

  if (isStaffRole(claims.role)) {
    // Staff may play ANY status — the brief requires them to listen in order to
    // verify an import or check metadata before publishing.
    if (claims.role === 'admin') return null;
    return cls.managerUids.includes(uid) ? null : 'not-your-class';
  }

  // Students: only published recordings, only their own class, and only while
  // that class still allows listening.
  if (recording.status !== 'published') return 'not-published';
  if (!enrollmentActive) return 'not-enrolled';
  // The archived-access rule from Phase 1 finally does some work: an archived
  // class is still VISIBLE to a student, but playback is off unless staff
  // deliberately kept it on.
  if (!canPlayFromClass(cls)) return 'class-listening-off';
  return null;
}

const MESSAGES: Record<PlaybackDenial, string> = {
  'no-audio': 'That recording has no audio yet.',
  'not-published': 'That recording is not published.',
  'not-enrolled': 'You are not enrolled in that class.',
  'class-listening-off': 'This class is archived and listening has been turned off.',
  'not-your-class': 'You are not assigned to that class.',
};

/**
 * Mint a playback URL for one recording.
 *
 * Authorization happens HERE, not in security rules, because the URL is signed
 * with the service account's own credentials and bypasses rules entirely. This
 * callable is the only thing standing between a signed-in user and the audio.
 */
export const getPlaybackUrl = onCall<{ recordingId?: unknown }, Promise<SignedPlayback>>(
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const claims = (req.auth.token ?? {}) as TokenClaims;
    if (claims.status !== 'active') {
      throw new HttpsError('permission-denied', 'Account is not active.');
    }

    const recordingId = req.data?.recordingId;
    if (typeof recordingId !== 'string' || !recordingId) {
      throw new HttpsError('invalid-argument', 'recordingId is required.');
    }

    const db = getFirestore();
    const recSnap = await db.collection(COLLECTIONS.recordings).doc(recordingId).get();
    if (!recSnap.exists) throw new HttpsError('not-found', 'No such recording.');
    const recording = recSnap.data() as RecordingDoc;

    const [clsSnap, enrSnap] = await Promise.all([
      db.collection(COLLECTIONS.classes).doc(recording.classId).get(),
      db
        .collection(COLLECTIONS.enrollments)
        .doc(enrollmentId(req.auth.uid, recording.classId))
        .get(),
    ]);
    if (!clsSnap.exists) throw new HttpsError('not-found', 'No such class.');

    const denial = playbackDenial({
      claims,
      recording,
      cls: clsSnap.data() as ClassDoc,
      uid: req.auth.uid,
      enrollmentActive: enrSnap.exists && (enrSnap.data() as EnrollmentDoc).active,
    });
    if (denial) throw new HttpsError('permission-denied', MESSAGES[denial]);

    return signedPlaybackUrl(recording.audioPath as string);
  },
);
