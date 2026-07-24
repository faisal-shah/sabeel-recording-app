import './setup';
import { initializeApp } from 'firebase-admin/app';
import { EMULATOR_PROJECT_ID, EMULATOR_STORAGE_BUCKET } from '@sabeel/shared';
import { isEmulatorProject } from './env';

// Once, before any handler runs. Credentials come from the environment on both
// the emulator and Cloud Functions, but the STORAGE BUCKET does not: the Admin
// SDK throws "Bucket name not specified" without one, and the functions
// emulator does not supply it. Deployed, it arrives via FIREBASE_CONFIG.
const projectId = process.env.GCLOUD_PROJECT ?? '';
initializeApp(
  projectId === EMULATOR_PROJECT_ID
    ? { projectId, storageBucket: EMULATOR_STORAGE_BUCKET }
    : undefined,
);

export { onUserCreate } from './authTrigger';
export { setStaffAccess } from './staff';
export { createStudent, setStudentAccess } from './students';
export { createCohort, setCohortArchived } from './cohorts';
export { createClass, updateClass, setClassManagers } from './classes';
export { createEnrollment, setEnrollmentActive } from './enrollments';
export {
  createRecording,
  finalizeRecordingUpload,
  updateRecording,
  setRecordingStatus,
  clearRecordingAudio,
  deleteRecording,
} from './recordings';
export { listZoomRecordings, importZoomRecording, retryZoomImport } from './zoomImport';
export { getPlaybackUrl } from './playback';
export { assignCatchup } from './assignments';
export { onRecordingWritten } from './assignmentsTrigger';
export { overrideCompletion, clearCompletionOverride } from './overrides';

/**
 * `bootstrapAdmin` exists ONLY against the emulator.
 *
 * It was deployed once to the real project on 2026-07-22, called once to
 * promote the first admin, and deleted immediately (verified: the URL 404s).
 * Leaving it in the export list would silently recreate it on the next
 * `deploy --only functions` — an unauthenticated endpoint that grants admin,
 * back in production because nobody remembered a comment.
 *
 * It cannot be deleted outright: the e2e suite calls it to promote its first
 * admin, which is the same bootstrap problem in miniature. So it is scoped to
 * the project where that is safe. Spent in production anyway — it refuses with
 * 409 once any admin exists.
 */
export const bootstrapAdmin = isEmulatorProject()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./bootstrap') as typeof import('./bootstrap')).bootstrapAdmin
  : undefined;
