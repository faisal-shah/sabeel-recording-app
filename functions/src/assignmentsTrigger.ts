import './setup';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type RecordingDoc, type SessionDoc } from '@sabeel/shared';
import { applyRecordingFanout, applySessionFanout } from './assignmentsFanout';
import { reportError } from './sentry';
import { SENTRY_DSN } from './reported';

/**
 * Obligations are attendance-driven, and the two facts that decide them live on
 * two documents: the recording (is it published?) and the session (attendance +
 * due date). So two triggers converge on the same `reconcileSessionAssignments`.
 *
 * The decision logic lives in `assignmentsFanout` so it can be tested directly
 * against the emulator; these are only the bindings. Both are idempotent and
 * write ONLY `assignments`, so neither can trigger itself.
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
      await applySessionFanout(
        getFirestore(),
        event.params.sessionId,
        event.data?.before.data() as SessionDoc | undefined,
        event.data?.after.data() as SessionDoc | undefined,
      );
    } catch (e) {
      await reportError(e, { source: 'onSessionWritten' });
      throw e;
    }
  },
);
