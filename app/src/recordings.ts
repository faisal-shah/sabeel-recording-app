import { collection, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import {
  COLLECTIONS,
  audioStoragePath,
  type RecordingDoc,
  type RecordingStatus,
} from '@sabeel/shared';
import { db, functions, storage } from './firebase';
import { useLiveQuery } from './liveQuery';

export interface RecordingRow extends RecordingDoc {
  id: string;
}

/**
 * Recordings for one class.
 *
 * Constrained to a single classId, which is also what makes the security rule
 * affordable: its staff arm resolves a class lookup per row, and only a
 * single-class query lets that resolve one cached path.
 */
export function useClassRecordings(classId: string | null): RecordingRow[] {
  return useLiveQuery<RecordingRow[]>(
    'classRecordings',
    () =>
      classId
        ? query(
            collection(db, COLLECTIONS.recordings),
            where('classId', '==', classId),
            orderBy('createdAt', 'desc'),
          )
        : null,
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) })),
    [],
    [classId],
  );
}

const call = <I, O>(name: string) => (input: I) =>
  httpsCallable<I, O>(functions, name)(input).then((r) => r.data);

export const createRecording = call<
  { classId: string; title: string; recordedAt: number | null },
  { id: string; audioPath: string }
>('createRecording');

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
      (s) => onProgress(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0),
      reject,
      () => resolve(),
    );
  });
}

/**
 * Read a file's duration by decoding just enough of it.
 *
 * Client-side because the server would need ffmpeg to find out, and the value is
 * advisory — it draws a progress bar. Resolves null rather than throwing if the
 * browser cannot read it, so an odd file does not block an otherwise fine
 * upload.
 */
export function readAudioDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.addEventListener('loadedmetadata', () =>
      done(Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration) : null),
    );
    el.addEventListener('error', () => done(null));
    el.src = url;
  });
}
