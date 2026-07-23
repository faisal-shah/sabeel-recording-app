import { StyleSheet, Text, View } from 'react-native';
import { Empty, Notice, Screen } from '../components/ui';
import { useAudit, type AuditRow } from '../ledger';
import { useListenerError } from '../liveQuery';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Audit history, newest first. A manager passes their classId (scoped); an admin
 * passes null for the global view.
 */
export function AuditScreen({ classId, title }: { classId: string | null; title: string }) {
  const listenerError = useListenerError();
  const entries = useAudit(classId);

  return (
    <Screen title="Audit" subtitle={title}>
      {listenerError ? <Notice tone="error">{listenerError}</Notice> : null}
      {entries.length === 0 ? (
        <Empty>No audit entries yet.</Empty>
      ) : (
        entries.map((e) => <AuditCard key={e.id} entry={e} />)
      )}
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

// Friendlier labels; unknown actions fall back to the raw name.
const ACTION_LABELS: Record<string, string> = {
  createCohort: 'Created cohort',
  setCohortArchived: 'Archived/unarchived cohort',
  createClass: 'Created class',
  updateClass: 'Updated class',
  setClassManagers: 'Set class managers',
  createStudent: 'Created student',
  setStudentAccess: 'Changed student access',
  createEnrollment: 'Enrolled student',
  setEnrollmentActive: 'Changed enrollment',
  createRecording: 'Created recording',
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
    backgroundColor: t.bg.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(2),
    borderWidth: 1,
    borderColor: t.border.subtle,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  action: { fontSize: 15, fontWeight: '700', color: t.text.primary, flex: 1 },
  time: { fontSize: 12, color: t.text.muted },
  by: { fontSize: 13, color: t.text.secondary, marginTop: spacing(1) },
  targets: { fontSize: 12, color: t.text.muted, marginTop: spacing(1), fontVariant: ['tabular-nums'] },
  detail: { fontSize: 13, color: t.text.accent, marginTop: spacing(1) },
});
