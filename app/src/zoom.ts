import { httpsCallable } from 'firebase/functions';
import type { ZoomImportRow } from '@sabeel/shared';
import { functions } from './firebase';

const call = <I, O>(name: string) => (input: I) =>
  httpsCallable<I, O>(functions, name)(input).then((r) => r.data);

/** List the central account's audio recordings in a date range (YYYY-MM-DD). */
export const listZoomRecordings = call<{ from: string; to: string }, ZoomImportRow[]>(
  'listZoomRecordings',
);

/** Import one Zoom recording into a session as its draft. Idempotent on meetingUuid. */
export const importZoomRecording = call<
  { meetingUuid: string; fileId: string; sessionId: string },
  { recordingId: string; alreadyExisted: boolean }
>('importZoomRecording');

/** Retry a failed (needs-attention) Zoom import. */
export const retryZoomImport = call<{ recordingId: string }, { recordingId: string }>(
  'retryZoomImport',
);
