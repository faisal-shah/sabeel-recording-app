import './setup';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import {
  COLLECTIONS,
  INSTITUTE_TIMEZONE,
  todayInZone,
  type AssignmentDoc,
} from '@sabeel/shared';
import { notifyAttendanceMissing, notifyLastDay, notifyRecordingReady } from './notifyJobs';
import { reportError } from './sentry';
import { SENTRY_DSN } from './reported';

/**
 * The two ways a notification is triggered: a grant appearing, and the morning.
 *
 * Bindings only — every decision is in `notifyJobs`, which the integration tests
 * drive directly with the FCM sender stubbed. There is no FCM emulator, so that
 * split is the difference between logic that is tested and logic that is hoped
 * for.
 */

/**
 * A grant became active: tell the student their recording is ready.
 *
 * Fires only on the false→true edge. Reconciles are frequent and idempotent —
 * every attendance correction rewrites every grant on the session — so firing on
 * any write would send one notification per staff edit. The `sent` marker would
 * catch it anyway; this keeps the work off the wire in the first place.
 */
export const onAssignmentWritten = onDocumentWritten(
  { document: `${COLLECTIONS.assignments}/{assignmentId}`, secrets: [SENTRY_DSN] },
  async (event) => {
    try {
      const before = event.data?.before.data() as AssignmentDoc | undefined;
      const after = event.data?.after.data() as AssignmentDoc | undefined;
      if (!after?.active) return;
      if (before?.active) return;
      await notifyRecordingReady(getFirestore(), after);
    } catch (e) {
      await reportError(e, { source: 'onAssignmentWritten' });
      throw e;
    }
  },
);

/**
 * The morning sweep: last-day reminders, and attendance nobody has taken.
 *
 * 07:00 in the institute timezone, so "today" here is the same civil day the
 * due-date maths uses everywhere else — a UTC schedule would fire the reminder
 * on the wrong side of midnight for half the year.
 *
 * The repo's first scheduled function. It reuses `todayInZone` rather than
 * deriving the date itself, for the same reason the rules do not compute due
 * dates: one implementation of the rollover, or two that drift.
 */
export const onMorning = onSchedule(
  { schedule: '0 7 * * *', timeZone: INSTITUTE_TIMEZONE, secrets: [SENTRY_DSN] },
  async () => {
    try {
      const db = getFirestore();
      const today = todayInZone(INSTITUTE_TIMEZONE);
      const lastDay = await notifyLastDay(db, today);
      const attendance = await notifyAttendanceMissing(db, today);
      console.log(`morning sweep ${today}: ${lastDay} last-day, ${attendance} attendance`);
    } catch (e) {
      await reportError(e, { source: 'onMorning' });
      throw e;
    }
  },
);
