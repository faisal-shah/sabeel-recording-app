import { collection, doc, getDoc, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import {
  COLLECTIONS,
  audioStoragePath,
  type AssignmentDoc,
  type RecordingDoc,
  type RecordingStatus,
} from '@sabeel/shared';
import { db, functions, storage } from './firebase';
import { useLiveQuery } from './liveQuery';

export interface RecordingRow extends RecordingDoc {
  id: string;
}

/** Load one recording by id (for opening it directly, e.g. from the Zoom picker). */
export async function loadRecording(id: string): Promise<RecordingRow | null> {
  const snap = await getDoc(doc(db, COLLECTIONS.recordings, id));
  return snap.exists() ? { id: snap.id, ...(snap.data() as RecordingDoc) } : null;
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
    'courseRecordings',
    () =>
      courseId
        ? query(
            collection(db, COLLECTIONS.recordings),
            where('courseId', '==', courseId),
            orderBy('createdAt', 'desc'),
          )
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) })),
    [],
    [courseId],
  );
}

/**
 * Every recording, newest first — ADMIN ONLY (the rules' admin arm lists
 * recordings without a per-row read; a manager must go class by class). The
 * library's admin view.
 */
export function useAllRecordings(enabled: boolean): RecordingRow[] {
  return useLiveQuery<RecordingRow[]>(
    'allRecordings',
    () => (enabled ? query(collection(db, COLLECTIONS.recordings), orderBy('createdAt', 'desc')) : null),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) })),
    [],
    [enabled],
  );
}

const call = <I, O>(name: string) => (input: I) =>
  httpsCallable<I, O>(functions, name)(input).then((r) => r.data);

export const createRecording = call<
  { courseId: string; title: string; recordedAt: number | null },
  { id: string; audioPath: string }
>('createRecording');

/** Assign an earlier recording to a late-enrolled student as catch-up. */
export const assignCatchup = call<
  { studentUid: string; recordingId: string; dueDate: string | null },
  { studentUid: string; recordingId: string }
>('assignCatchup');

/**
 * Who already has an obligation for this recording — so the catch-up picker can
 * show, and skip, students who are already accountable. Staff-scoped: the rule's
 * manager arm resolves the recording's class per row, affordable for this
 * single-recording query.
 */
export interface AssignmentRow extends AssignmentDoc {
  id: string;
}
export function useRecordingAssignments(recordingId: string | null): AssignmentRow[] {
  return useLiveQuery<AssignmentRow[]>(
    'recordingAssignments',
    () =>
      recordingId
        ? query(collection(db, COLLECTIONS.assignments), where('recordingId', '==', recordingId))
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as AssignmentDoc) })),
    [],
    [recordingId],
  );
}

export const finalizeRecordingUpload = call<
  { recordingId: string; durationSec: number | null },
  { recordingId: string; sizeBytes: number }
>('finalizeRecordingUpload');

export const updateRecording = call<
  { recordingId: string; title?: string; notes?: string; dueDate?: string | null },
  unknown
>('updateRecording');

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

