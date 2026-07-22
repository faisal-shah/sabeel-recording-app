/**
 * A class is effectively active only when both it and its cohort are active.
 *
 * The single source of truth for this rule. A Cloud Function stores the result
 * on the class document (`ClassDoc.effectiveActive`) whenever either side
 * changes, so security rules and clients read a boolean instead of re-deriving
 * it — rules cannot import this file, and a second implementation there would
 * drift from this one silently.
 *
 * Note what it implies: archiving a cohort deactivates its classes without
 * touching their own `archived` flags, so **reactivating the cohort restores
 * each class to whatever state it was already in**. That is the required
 * behaviour (docs/PRODUCT_BRIEF.md § Academic structure), and it only works
 * because the cascade is derived rather than written into the classes.
 */
export function deriveEffectiveActive(
  cohortArchived: boolean,
  classArchived: boolean,
): boolean {
  return !cohortArchived && !classArchived;
}

/**
 * May a student play recordings from this class right now?
 *
 * Active classes: yes. Archived ones: only if staff explicitly kept access on —
 * students can still SEE an archived class in their history either way, but
 * playback is disabled with a clear message when this is false.
 */
export function canPlayFromClass(cls: {
  effectiveActive: boolean;
  archivedAccess: boolean;
}): boolean {
  return cls.effectiveActive || cls.archivedAccess;
}
