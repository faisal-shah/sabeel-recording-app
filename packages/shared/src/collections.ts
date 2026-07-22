/**
 * Firestore collection names, from the data-model sketch in
 * docs/PRODUCT_BRIEF.md. Names only — the document types land with the phase
 * that first writes them, so this file stays the one place a collection is
 * spelled and rules/tests/queries cannot disagree on a string literal.
 */
export const COLLECTIONS = {
  /** Staff identity, role, approval state. */
  staffUsers: 'staffUsers',
  /** Class-level Manager assignments. Cohort assignment grants nothing. */
  managerClassScopes: 'managerClassScopes',
  /** Student identity, active/disabled state, profile. */
  students: 'students',
  /** Cohort/semester records and archive state. */
  cohorts: 'cohorts',
  /** Classes inside cohorts, archive state, archived-access setting. */
  classes: 'classes',
  /** Student membership in classes over time. */
  enrollments: 'enrollments',
  /** Zoom source configuration and manual upload source metadata. */
  recordingSources: 'recordingSources',
  /** Recording asset, metadata, status, source, notes. */
  recordings: 'recordings',
  /** Required-listening obligations. */
  assignments: 'assignments',
  /** Playback progress, listened percent, last listened, sync metadata. */
  listeningProgress: 'listeningProgress',
  /** Current completion STATE per student+recording, client-written. Keyed by
   *  student+recording because completion can exist for an accessible recording
   *  that was never assigned, so it cannot live on the assignment. */
  completions: 'completions',
  /** Completion/uncompletion events and staff overrides — append-only audit. */
  completionEvents: 'completionEvents',
  /** Student notification preferences and sent records. */
  notifications: 'notifications',
  /** Admin-facing operational metrics. */
  backendStats: 'backendStats',
  /** Staff and system changes that must remain inspectable. */
  auditLog: 'auditLog',
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
