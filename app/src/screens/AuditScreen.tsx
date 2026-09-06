import { StyleSheet, Text, View } from 'react-native';
import { Empty, Grid, Notice, Screen } from '../components/ui';
import { useAudit, type AuditRow } from '../ledger';
import { useListenerError } from '../liveQuery';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Audit history, newest first. A manager passes their courseId (scoped); an admin
 * passes null for the global view.
 */
export function AuditScreen({ courseId, title }: { courseId: string | null; title: string }) {
  const listenerError = useListenerError();
  const entries = useAudit(courseId);

  return (
    <Screen title={title} subtitle="Every change, who made it and when" width="list">
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {/* A handle for "the log rendered", which the layout sweep anchors on —
          this screen is a read-only list and has no control of its own to wait
          for. Wraps both states, so an empty log is an arrival too. */}
      <View testID="audit-list">
        {entries.length === 0 ? (
          <Empty>No audit entries yet.</Empty>
        ) : (
          <Grid min={330}>
            {entries.map((e) => (
              <AuditCard key={e.id} entry={e} />
            ))}
          </Grid>
        )}
      </View>
    </Screen>
  );
}

function AuditCard({ entry: e }: { entry: AuditRow }) {
  const detail = e.detail ? Object.entries(e.detail).map(([k, v]) => `${k}: ${String(v)}`).join(' · ') : '';
  const targets = Object.entries(e.targets ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return (
    <View style={styles.row}>
      <View style={styles.head}>
        <Text style={styles.action}>{ACTION_LABELS[e.action] ?? e.action}</Text>
        <Text style={styles.time}>{new Date(e.at).toLocaleString()}</Text>
      </View>
      <Text style={styles.by}>
        by {e.actorRole === 'system' ? 'system' : `${e.actorRole} ${e.actorUid.slice(0, 6)}…`}
      </Text>
      {targets ? <Text style={styles.targets}>{targets}</Text> : null}
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

/**
 * Friendlier labels; unknown actions fall back to the raw name.
 *
 * EVERY action a callable writes needs an entry, or the fallback prints a
 * camelCase function name in a list of English sentences — `submitAttendance`
 * sat between "Created course" and "Changed recording status" for exactly that
 * reason. Adding a `auditedCall` means adding a line here.
 */
const ACTION_LABELS: Record<string, string> = {
  createCohort: 'Created cohort',
  setCohortArchived: 'Archived/unarchived cohort',
  createCourse: 'Created course',
  updateCourse: 'Updated course',
  setCourseManagers: 'Set course managers',
  createStudent: 'Created student',
  setStudentAccess: 'Changed student access',
  createEnrollment: 'Enrolled student',
  setEnrollmentActive: 'Changed enrollment',
  createSession: 'Created session',
  updateSession: 'Edited session',
  deleteSession: 'Deleted session',
  submitAttendance: 'Submitted attendance',
  createRecording: 'Created recording',
  deleteRecording: 'Deleted recording',
  finalizeRecordingUpload: 'Uploaded audio',
  updateRecording: 'Edited recording',
  setRecordingStatus: 'Changed recording status',
  clearRecordingAudio: 'Removed audio',
  assignCatchup: 'Assigned catch-up',
  setStaffAccess: 'Changed staff access',
  overrideCompletion: 'Overrode completion',
  clearCompletionOverride: 'Removed override',
  authProvision: 'Staff account created',
  authReject: 'Rejected sign-up',
};

const styles = StyleSheet.create({
  row: {
    // Fills the grid cell it is given, so a row of these ends level instead
    // of ragged with its actions at three different heights.
    flexGrow: 1,
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  action: { fontSize: 15, fontWeight: '700', color: t.text.primary, flex: 1 },
  // secondary, not muted. "When" is half of what this screen's own subtitle
  // promises, and taupe is ~2.7:1 — BRAND.md's captions-only colour.
  time: { fontSize: 12, color: t.text.secondary },
  by: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  targets: { fontSize: 12, color: t.text.secondary, marginTop: spacing(1), fontVariant: ['tabular-nums'] },
  // secondary, not accent. `text.accent` is the app's link colour, and an
  // override's reason is content — set in raspberry it was the loudest line on
  // the card and read as something to click.
  detail: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
});
