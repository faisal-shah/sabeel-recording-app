import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  INSTITUTE_TIMEZONE,
  allowedTransitions,
  publishBlockers,
  todayInZone,
  type RecordingStatus,
} from '@sabeel/shared';
import { useClassLedger } from '../ledger';
import {
  Button,
  Card,
  Empty,
  Field,
  Notice,
  Row,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { DateField } from '../components/DateField';
import {
  assignCatchup,
  clearRecordingAudio,
  createRecording,
  finalizeRecordingUpload,
  setRecordingStatus,
  updateRecording,
  uploadRecordingAudio,
  useClassRecordings,
  useRecordingAssignments,
  type RecordingRow,
} from '../recordings';
import { useRoster } from '../structure';
import { useStudents } from '../students';
import { canPickAudio, pickAudioFile } from '../filePicker';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Staff: the recordings in one class.
 *
 * Upload is two steps by design — a callable creates the draft (checking class
 * scope server-side) and hands back an id, and only then does the audio go
 * straight to Storage. Nothing is publishable until the upload is confirmed.
 */
export function RecordingsScreen({
  classId,
  className,
  onOpenLedger,
}: {
  classId: string;
  className: string;
  onOpenLedger: (recording: RecordingRow) => void;
}) {
  const recordings = useClassRecordings(classId);
  const today = todayInZone(INSTITUTE_TIMEZONE);
  const { byRecording } = useClassLedger(classId, today);
  // For catch-up assignment: the class roster and student names, loaded once.
  const roster = useRoster(classId);
  const students = useStudents(true);
  const nameByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of students) m.set(s.uid, s.displayName);
    return m;
  }, [students]);
  const activeStudentUids = useMemo(
    () => roster.filter((e) => e.active).map((e) => e.studentUid),
    [roster],
  );
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const addRecording = () =>
    void run('create', async () => {
      const picked = await pickAudioFile();
      if (!picked) return; // user changed their mind
      setInfo(null);
      const { id } = await createRecording({
        classId,
        title: title.trim(),
        recordedAt: Date.now(),
      });
      setProgress(0);
      try {
        await uploadRecordingAudio(id, picked.blob, setProgress);
        await finalizeRecordingUpload({ recordingId: id, durationSec: picked.durationSec });
        setTitle('');
        setInfo('Uploaded. Review the details, then publish.');
      } finally {
        setProgress(null);
      }
    });

  return (
    <Screen subtitle={className}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? <Notice tone="success">{info}</Notice> : null}

      <SectionTitle>Add a recording</SectionTitle>
      {!canPickAudio ? (
        <Card>
          <Notice tone="info">
            Uploading is done from the web app on a computer. You can still review,
            edit and publish recordings here.
          </Notice>
        </Card>
      ) : (
      <Card>
        <Field
          testID="recording-title"
          label="Title"
          value={title}
          onChangeText={setTitle}
          autoCapitalize="words"
          placeholder="Session 1"
        />
        {progress !== null ? (
          <View style={styles.progressWrap}>
            <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
            <Text style={styles.progressText}>Uploading {Math.round(progress * 100)}%</Text>
          </View>
        ) : null}
        <Button
          testID="recording-pick"
          label="Choose audio file…"
          busy={busy === 'create'}
          disabled={!title.trim()}
          onPress={addRecording}
        />
        <Text style={styles.hint}>
          Audio only, up to 300 MB. A two-hour class is normally well under 30 MB.
        </Text>
      </Card>
      )}

      <SectionTitle>Recordings ({recordings.length})</SectionTitle>
      {recordings.length === 0 ? (
        <Empty>No recordings in this class yet.</Empty>
      ) : (
        recordings.map((r) => (
          <RecordingCard
            key={r.id}
            recording={r}
            busy={busy}
            onRun={run}
            activeStudentUids={activeStudentUids}
            nameByUid={nameByUid}
            counts={byRecording.get(r.id)}
            onOpenLedger={() => onOpenLedger(r)}
          />
        ))
      )}
    </Screen>
  );
}

function RecordingCard({
  recording: r,
  busy,
  onRun,
  activeStudentUids,
  nameByUid,
  counts,
  onOpenLedger,
}: {
  recording: RecordingRow;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<void>) => void;
  activeStudentUids: string[];
  nameByUid: Map<string, string>;
  counts: { complete: number; total: number } | undefined;
  onOpenLedger: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(r.title);
  const [notes, setNotes] = useState(r.notes);
  const [dueDate, setDueDate] = useState(r.dueDate ?? '');

  const blockers = publishBlockers(r);
  const moves = allowedTransitions(r.status);

  return (
    <Card>
      <Text style={styles.title}>{r.title}</Text>
      <View style={styles.meta}>
        <StatusChip status={r.status} />
        <Text style={styles.hint}>
          {r.durationSec ? fmtDuration(r.durationSec) : 'no duration'}
          {r.sizeBytes ? ` · ${(r.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
          {r.dueDate ? ` · due ${r.dueDate}` : ' · no due date'}
        </Text>
      </View>
      {r.notes ? <Text style={styles.notes}>{r.notes}</Text> : null}

      {/* Say WHY publish is unavailable. A disabled button with no explanation
          is the same as a broken one. */}
      {blockers.includes('audio') ? (
        <Notice tone="error">This recording has no audio. Upload one before publishing.</Notice>
      ) : null}

      {editing ? (
        <>
          <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="words" />
          <Field label="Notes (everyone with access sees these)" value={notes} onChangeText={setNotes} />
          <DateField label="Due date (optional)" value={dueDate} onChange={setDueDate} />
          <Row>
            <Button
              label="Save"
              busy={busy === `edit-${r.id}`}
              onPress={() =>
                onRun(`edit-${r.id}`, async () => {
                  await updateRecording({
                    recordingId: r.id,
                    title: title.trim(),
                    notes,
                    dueDate: dueDate.trim() ? dueDate.trim() : null,
                  });
                  setEditing(false);
                })
              }
            />
            <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
          </Row>
        </>
      ) : (
        <Row>
          <Button label="Edit details" variant="secondary" onPress={() => setEditing(true)} />
          {/* `needsAttention` is a review state for problematic IMPORTS — it is
              set by the import pipeline, not something staff flag on their own
              fresh upload. Offering "Flag a problem" beside Publish only muddied
              the manual flow (it reads like it does something to publishing, and
              it does not), so it is left off the manual actions. The reverse move
              (needsAttention → draft) still shows on a flagged import. */}
          {moves
            .filter((to) => to !== 'needsAttention')
            .map((to) => (
            <Button
              key={to}
              testID={`recording-${to}-${r.title}`}
              label={LABELS[to]}
              variant={to === 'published' ? 'primary' : 'secondary'}
              disabled={to === 'published' && blockers.length > 0}
              busy={busy === `status-${r.id}`}
              onPress={() =>
                onRun(`status-${r.id}`, () =>
                  setRecordingStatus({ recordingId: r.id, status: to }).then(() => undefined),
                )
              }
            />
          ))}
          {r.audioPath && (r.status === 'draft' || r.status === 'needsAttention') ? (
            <Button
              label="Remove audio"
              variant="secondary"
              busy={busy === `clear-${r.id}`}
              onPress={() =>
                onRun(`clear-${r.id}`, () =>
                  clearRecordingAudio({ recordingId: r.id }).then(() => undefined),
                )
              }
            />
          ) : null}
        </Row>
      )}

      {r.status === 'published' ? (
        <View style={styles.ledgerRow}>
          <Text style={styles.ledgerCount}>
            {counts ? `${counts.complete}/${counts.total} complete` : 'no one accountable yet'}
          </Text>
          <Button
            testID={`recording-ledger-${r.title}`}
            label="Ledger"
            variant="secondary"
            onPress={onOpenLedger}
          />
        </View>
      ) : null}

      {/* Catch-up: assign this recording to a late student who was not on the
          roster when it published. Only meaningful once it is published. */}
      {r.status === 'published' ? (
        <CatchupControl
          recording={r}
          activeStudentUids={activeStudentUids}
          nameByUid={nameByUid}
          busy={busy}
          onRun={onRun}
        />
      ) : null}
    </Card>
  );
}

/**
 * Assign a published recording to a late-enrolled student as catch-up.
 *
 * Lists enrolled students who do NOT already have an active obligation for this
 * recording — normal publishing already made the rest accountable, so catch-up
 * is only for those who missed it. An optional due date; blank means required
 * with no deadline.
 */
function CatchupControl({
  recording: r,
  activeStudentUids,
  nameByUid,
  busy,
  onRun,
}: {
  recording: RecordingRow;
  activeStudentUids: string[];
  nameByUid: Map<string, string>;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<void>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const assignments = useRecordingAssignments(r.id);
  const assignedActive = new Set(
    assignments.filter((a) => a.active).map((a) => a.studentUid),
  );
  const candidates = activeStudentUids.filter((uid) => !assignedActive.has(uid));

  if (!open) {
    return (
      <Button
        testID={`catchup-open-${r.title}`}
        label="Assign as catch-up…"
        variant="secondary"
        onPress={() => setOpen(true)}
      />
    );
  }

  return (
    <View style={styles.catchup}>
      <Text style={styles.catchupHeading}>Assign as catch-up</Text>
      <DateField label="Due date (optional)" value={dueDate} onChange={setDueDate} />
      {candidates.length === 0 ? (
        <Text style={styles.hint}>Everyone enrolled is already accountable for this recording.</Text>
      ) : (
        candidates.map((uid) => (
          <Row key={uid}>
            <Text style={styles.candidate}>{nameByUid.get(uid) ?? uid}</Text>
            <Button
              testID={`catchup-assign-${nameByUid.get(uid) ?? uid}`}
              label="Assign"
              busy={busy === `catchup-${uid}`}
              onPress={() =>
                onRun(`catchup-${uid}`, () =>
                  assignCatchup({
                    studentUid: uid,
                    recordingId: r.id,
                    dueDate: dueDate.trim() ? dueDate.trim() : null,
                  }).then(() => undefined),
                )
              }
            />
          </Row>
        ))
      )}
      <Button label="Done" variant="secondary" onPress={() => setOpen(false)} />
    </View>
  );
}

const LABELS: Record<RecordingStatus, string> = {
  draft: 'Back to draft',
  published: 'Publish',
  archived: 'Archive',
  unpublished: 'Unpublish',
  needsAttention: 'Flag a problem',
};

function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const styles = StyleSheet.create({
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing(3),
    paddingTop: spacing(3),
    borderTopWidth: 1,
    borderTopColor: t.border.subtle,
  },
  ledgerCount: { fontSize: 14, fontWeight: '600', color: t.text.secondary },
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing(3),
    marginTop: spacing(2),
  },
  hint: { fontSize: 13, color: t.text.secondary },
  notes: { fontSize: 14, color: t.text.secondary, marginTop: spacing(2) },
  catchup: {
    marginTop: spacing(3),
    paddingTop: spacing(3),
    borderTopWidth: 1,
    borderTopColor: t.border.subtle,
    gap: spacing(2),
  },
  catchupHeading: { fontSize: 14, fontWeight: '700', color: t.text.primary },
  candidate: { flex: 1, fontSize: 15, color: t.text.primary, alignSelf: 'center' },
  progressWrap: {
    marginTop: spacing(3),
    backgroundColor: t.bg.inset,
    borderRadius: 6,
    overflow: 'hidden',
    minHeight: 26,
    justifyContent: 'center',
  },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: t.bg.sage },
  progressText: {
    fontSize: 12,
    color: t.text.primary,
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1),
  },
});
