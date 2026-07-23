import type { Role } from './auth';

/**
 * One audit-log entry — a staff (or system) change that must stay inspectable.
 *
 * Written ONLY by the server, by the `auditedCall` wrapper that every mutating
 * callable runs through, plus the auth trigger. Never by a client.
 *
 * `classId` is the scoping key: when an action belongs to a class, the entry
 * carries it, and a MANAGER may read the entry for a class they run. When an
 * action is not class-scoped (cohort, staff, student-directory changes) it is
 * null, and only an admin may read it — which matches "managers manage audit
 * history within assigned classes".
 */
export interface AuditEntryDoc {
  at: number;
  actorUid: string;
  actorRole: Role | 'system';
  /** The callable/trigger name, e.g. `createRecording`, `overrideCompletion`. */
  action: string;
  /** Class this action belongs to, or null when it is not class-scoped. */
  classId: string | null;
  /** The ids this action touched — recordingId, studentUid, cohortId, uid… */
  targets: Record<string, string>;
  /** Semantic extra where it matters: an override reason, a status change. */
  detail?: Record<string, unknown>;
}
