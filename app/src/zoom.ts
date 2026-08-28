import { httpsCallable, type HttpsCallableOptions } from 'firebase/functions';
import type { ZoomImportRow } from '@sabeel/shared';
import { functions } from './firebase';

const call = <I, O>(name: string, options?: HttpsCallableOptions) => (input: I) =>
  httpsCallable<I, O>(functions, name, options)(input).then((r) => r.data);

/**
 * An import moves the whole audio file through the function, so it outlives the
 * SDK's 70-second default and gets the same 9 minutes the function itself has
 * (IMPORT_RUNTIME in functions/src/zoomImport.ts). Both ends have to agree: a
 * client that gives up first shows staff a failure while the transfer is still
 * running and completes behind them — which is how one import looked like it
 * failed, then "already existed" on the retry.
 */
const IMPORT_TIMEOUT: HttpsCallableOptions = { timeout: 540_000 };

/** List the central account's audio recordings in a date range (YYYY-MM-DD). */
export const listZoomRecordings = call<{ from: string; to: string }, ZoomImportRow[]>(
  'listZoomRecordings',
);

/** Import one Zoom recording into a session as its draft. Idempotent on meetingUuid. */
export const importZoomRecording = call<
  { meetingUuid: string; fileId: string; sessionId: string },
  { recordingId: string; alreadyExisted: boolean }
>('importZoomRecording', IMPORT_TIMEOUT);

/** Retry a failed (needs-attention) Zoom import. */
export const retryZoomImport = call<{ recordingId: string }, { recordingId: string }>(
  'retryZoomImport',
  IMPORT_TIMEOUT,
);
