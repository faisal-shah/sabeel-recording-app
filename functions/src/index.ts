import './setup';
import { initializeApp } from 'firebase-admin/app';

// Once, before any handler runs. The emulator and Cloud Functions both provide
// credentials from the environment, so no explicit config is needed.
initializeApp();

export { onUserCreate } from './authTrigger';
export { setStaffAccess } from './staff';
export { createStudent, setStudentAccess } from './students';
export { createCohort, setCohortArchived } from './cohorts';
export { createClass, updateClass, setClassManagers } from './classes';
export { createEnrollment, setEnrollmentActive } from './enrollments';
export { bootstrapAdmin } from './bootstrap';
