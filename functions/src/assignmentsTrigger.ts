import './setup';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, type RecordingDoc } from '@sabeel/shared';
import { applyRecordingFanout } from './assignmentsFanout';

/**
 * Fan out required-listening obligations as a recording moves through its
 * lifecycle. Reacts to the recording's OWN document so every path that changes
 * it — the publish callable, a class move, a due-date edit, unpublish/archive,
 * even a raw admin edit — is covered in one place (planning decision #2).
 *
 * The decision logic lives in `applyRecordingFanout` so it can be tested
 * directly against the emulator; this wrapper is only the trigger binding. It is
 * idempotent (deterministic ids + set/merge) and writes ONLY `assignments`,
 * never `recordings`, so it cannot trigger itself.
 */
export const onRecordingWritten = onDocumentWritten(
  `${COLLECTIONS.recordings}/{recordingId}`,
  async (event) => {
    await applyRecordingFanout(
      getFirestore(),
      event.params.recordingId,
      event.data?.before.data() as RecordingDoc | undefined,
      event.data?.after.data() as RecordingDoc | undefined,
    );
  },
);
