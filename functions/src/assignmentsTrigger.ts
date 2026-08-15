import './setup';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type RecordingDoc, type SessionDoc } from '@sabeel/shared';
import { applyRecordingFanout, applySessionFanout } from './assignmentsFanout';
import { reconcileAttendanceRecords } from './attendanceMirror';
import { reportError } from './sentry';
import { SENTRY_DSN } from './reported';

/**
 * Obligations are attendance-driven, and the two facts that decide them live on
 * two documents: the recording (is it published?) and the session (attendance +
 * due date). So two triggers converge on the same `reconcileSessionAssignments`.
 *
 * A session write also has a second consequence: each student's own copy of
 * their attendance mark. Both derivations hang off the same event and both read
 * stored truth, so they are called in sequence from one binding rather than
 * given a trigger each — two triggers on one document would double the
 * invocations to no benefit and could interleave.
 *
 * The decision logic lives in `assignmentsFanout` and `attendanceMirror` so it
 * can be tested directly against the emulator; these are only the bindings.
 * Everything here is idempotent and writes only `assignments` and
 * `attendanceRecords`, so nothing can trigger itself.
 */

export const onRecordingWritten = onDocumentWritten(
  { document: `${COLLECTIONS.recordings}/{recordingId}`, secrets: [SENTRY_DSN] },
  async (event) => {
    try {
      await applyRecordingFanout(
        getFirestore(),
        event.params.recordingId,
        event.data?.before.data() as RecordingDoc | undefined,
        event.data?.after.data() as RecordingDoc | undefined,
      );
    } catch (e) {
      await reportError(e, { source: 'onRecordingWritten' });
      throw e;
    }
  },
);

export const onSessionWritten = onDocumentWritten(
  { document: `${COLLECTIONS.sessions}/{sessionId}`, secrets: [SENTRY_DSN] },
  async (event) => {
    try {
      const db = getFirestore();
      await applySessionFanout(
        db,
        event.params.sessionId,
        event.data?.before.data() as SessionDoc | undefined,
        event.data?.after.data() as SessionDoc | undefined,
      );
      // Re-read rather than trusting the event payload, for the same reason
      // applySessionFanout does: delivery is at-least-once and unordered, so an
      // older invocation writing last would restore a mark that was just
      // corrected away.
      const session = (
        await db.collection(COLLECTIONS.sessions).doc(event.params.sessionId).get()
      ).data() as SessionDoc | undefined;
      await reconcileAttendanceRecords(db, event.params.sessionId, session);
    } catch (e) {
      await reportError(e, { source: 'onSessionWritten' });
      throw e;
    }
  },
);
