import { collection, doc, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import {
  COLLECTIONS,
  audioStoragePath,
  type RecordingDoc,
  type RecordingStatus,
} from '@sabeel/shared';
import { db, functions, storage } from './firebase';
import { useLiveDocState, useLiveQuery } from './liveQuery';

export interface RecordingRow extends RecordingDoc {
  id: string;
}

/**
 * Recordings for one class.
 *
 * Constrained to a single courseId, which is also what makes the security rule
 * affordable: its staff arm resolves a class lookup per row, and only a
 * single-class query lets that resolve one cached path.
 */
export function useCourseRecordings(courseId: string | null): RecordingRow[] {
  return useLiveQuery<RecordingRow[]>(
    () =>
      courseId
        ? query(
            collection(db, COLLECTIONS.recordings),
            where('courseId', '==', courseId),
            orderBy('createdAt', 'desc'),
          )
        : null,
    [courseId],
    {
      label: 'courseRecordings',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) })),
      empty: [],
      // The library mounts one of these per course a manager teaches, so the
      // label alone cannot say which course a denial came from. Carry the id.
      context: { scope: courseId ?? 'none' },
    },
  );
}

/**
 * Every recording, newest first — ADMIN ONLY (the rules' admin arm lists
 * recordings without a per-row read; a manager must go class by class). The
 * library's admin view.
 */
export function useAllRecordings(enabled: boolean): RecordingRow[] {
  return useLiveQuery<RecordingRow[]>(
    () => (enabled ? query(collection(db, COLLECTIONS.recordings), orderBy('createdAt', 'desc')) : null),
    [enabled],
    {
      label: 'allRecordings',
      map: (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) })),
      empty: [],
    },
  );
}

const call = <I, O>(name: string) => (input: I) =>
  httpsCallable<I, O>(functions, name)(input).then((r) => r.data);

/** Create the draft recording for a session (audio uploaded next). */
export const createRecording = call<{ sessionId: string }, { id: string; audioPath: string }>(
  'createRecording',
);

/**
 * One recording, live — a DOCUMENT listener, for the same reason as useCourse.
 *
 * The player resolves its recording through this and is reached by students,
 * whose arm on the recordings rule is a per-document check (published, and they
 * are enrolled in its course). A `__name__` query would be a list instead, and
 * would fail closed on exactly that population.
 */
export function useRecording(recordingId: string | null): RecordingRow | null {
  return useRecordingState(recordingId).value;
}

/** As useRecording, plus whether the listener has answered. */
export function useRecordingState(recordingId: string | null) {
  return useLiveDocState<RecordingRow | null>(
    () => (recordingId ? doc(db, COLLECTIONS.recordings, recordingId) : null),
    [recordingId],
    {
      label: 'recording',
      map: (snap) => ({ id: snap.id, ...(snap.data() as RecordingDoc) }),
      empty: null,
    },
  );
}

export const finalizeRecordingUpload = call<
  { recordingId: string; durationSec: number | null },
  { recordingId: string; sizeBytes: number }
>('finalizeRecordingUpload');

export const setRecordingStatus = call<
  { recordingId: string; status: RecordingStatus },
  unknown
>('setRecordingStatus');

export const clearRecordingAudio = call<{ recordingId: string }, unknown>('clearRecordingAudio');

/** Permanent, admin-only, cascading delete. Refused server-side while published. */
export const deleteRecording = call<{ recordingId: string }, unknown>('deleteRecording');

/**
 * Upload audio for a draft, reporting progress.
 *
 * Goes straight to Storage rather than through a Function: a 2-hour recording is
 * tens of megabytes, and the 60-minute function timeout makes proxying long
 * media unworkable — quite apart from paying for the bytes twice.
 */
export function uploadRecordingAudio(
  recordingId: string,
  file: Blob,
  onProgress: (fraction: number) => void,
): Promise<void> {
  const task = uploadBytesResumable(ref(storage, audioStoragePath(recordingId)), file, {
    contentType: file.type || 'audio/mp4',
  });
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      // Clamp to 1: a React Native resumable upload can re-send a chunk on a
      // network hiccup, so bytesTransferred can briefly exceed totalBytes and the
      // raw ratio reads past 100% (seen at ~140%). The bar is advisory; never
      // show more than done.
      (s) => onProgress(s.totalBytes ? Math.min(1, s.bytesTransferred / s.totalBytes) : 0),
      reject,
      () => resolve(),
    );
  });
}

