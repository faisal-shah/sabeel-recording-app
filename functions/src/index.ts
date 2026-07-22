import './setup';
import { initializeApp } from 'firebase-admin/app';
import { EMULATOR_PROJECT_ID, EMULATOR_STORAGE_BUCKET } from '@sabeel/shared';

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
} from './recordings';
export { getPlaybackUrl } from './playback';
export { bootstrapAdmin } from './bootstrap';
