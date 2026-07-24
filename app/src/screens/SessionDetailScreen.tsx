import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  allowedTransitions,
  publishBlockers,
  type AttendanceStatus,
  type RecordingStatus,
} from '@sabeel/shared';
import { Button, Card, Empty, Field, Notice, Row, Screen, SectionTitle, StatusChip } from '../components/ui';
import { DateField } from '../components/DateField';
import {
  deleteSession,
  submitAttendance,
  updateSession,
  useSession,
  type SessionRow,
} from '../sessions';
import {
  clearRecordingAudio,
  createRecording,
  deleteRecording,
  finalizeRecordingUpload,
  setRecordingStatus,
  uploadRecordingAudio,
  useRecording,
  type RecordingRow,
} from '../recordings';
import { retryZoomImport } from '../zoom';
import { useRoster } from '../structure';
import { useStudents } from '../students';
import { canPickAudio, pickAudioFile } from '../filePicker';
import { getTheme, spacing } from '../theme';

const t = getTheme();
const STATUSES: AttendanceStatus[] = ['present', 'absent', 'excused'];
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent: 'Absent',
  excused: 'Excused',
};

/**
 * Staff: one session — attendance and its recording.
 *
 * Attendance is the point: mark who was present, submit, and the absent + excused
 * are assigned the recording. Present students are exempt (they can still listen;
 * their progress shows in the ledger but they are never overdue).
 */
export function SessionDetailScreen({
  sessionId,
  cls,
  isAdmin,
  onOpenLedger,
  onPlay,
  onImportZoom,
}: {
  sessionId: string;
  cls: { id: string; name: string };
  isAdmin: boolean;
  onOpenLedger: (recording: RecordingRow, session: SessionRow) => void;
  onPlay: (recording: RecordingRow, session: SessionRow) => void;
  onImportZoom: (session: SessionRow) => void;
}) {
  const session = useSession(sessionId);
  const recording = useRecording(session?.recordingId ?? null);

  if (!session) return <Screen subtitle={cls.name}><Empty>Loading…</Empty></Screen>;

  return (
    <Screen title={session.title} subtitle={`${cls.name} · ${session.date}`}>
      <SessionHeader session={session} isAdmin={isAdmin} />
      <AttendanceSection session={session} />
      <RecordingSection
        session={session}
        recording={recording}
        isAdmin={isAdmin}
        onOpenLedger={onOpenLedger}
        onPlay={onPlay}
        onImportZoom={onImportZoom}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------- header --

function SessionHeader({ session, isAdmin }: { session: SessionRow; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [date, setDate] = useState(session.date);
  const [dueDate, setDueDate] = useState(session.dueDate ?? '');
  const [notes, setNotes] = useState(session.notes);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (key: string, fn: () => Promise<unknown>) =>
    void (async () => {
      setBusy(key);
      setError(null);
      try {
        await fn();
        setEditing(false);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    })();

  if (editing) {
    return (
      <Card>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Title" value={title} onChangeText={setTitle} autoCapitalize="words" />
        <DateField label="Date" value={date} onChange={setDate} />
        <DateField label="Due date for absentees (optional)" value={dueDate} onChange={setDueDate} />
        <Field label="Notes (everyone with access sees these)" value={notes} onChangeText={setNotes} />
        <Row>
          <Button
            label="Save"
            busy={busy === 'save'}
            onPress={() =>
              run('save', () =>
                updateSession({
                  sessionId: session.id,
                  title: title.trim(),
                  date,
                  dueDate: dueDate.trim() ? dueDate.trim() : null,
                  notes,
                }),
              )
            }
          />
          <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
        </Row>
      </Card>
    );
  }

  return (
    <Card>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Text style={styles.meta}>
        Due for absentees: {session.dueDate ?? 'no due date'}
      </Text>
      {session.notes ? <Text style={styles.notes}>{session.notes}</Text> : null}
      <Row>
        <Button label="Edit session" variant="secondary" onPress={() => setEditing(true)} />
      </Row>
      {isAdmin && !session.recordingId ? (
        <View style={styles.dangerZone}>
          {confirmingDelete ? (
            <>
              <Notice tone="error">
                Permanently delete this session and its attendance? This can&apos;t be undone.
              </Notice>
              <Row>
                <Button
                  label="Delete permanently"
                  variant="danger"
                  busy={busy === 'del'}
                  onPress={() => run('del', () => deleteSession({ sessionId: session.id }))}
                />
                <Button label="Cancel" variant="secondary" onPress={() => setConfirmingDelete(false)} />
              </Row>
            </>
          ) : (
            <Button label="Delete session" variant="danger" onPress={() => setConfirmingDelete(true)} />
          )}
        </View>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------ attendance --

function AttendanceSection({ session }: { session: SessionRow }) {
  const roster = useRoster(session.courseId);
  const students = useStudents(true);
  const nameByUid = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of students) m.set(s.uid, s.displayName);
    return m;
  }, [students]);
  const activeUids = useMemo(
    () => roster.filter((e) => e.active).map((e) => e.studentUid),
    [roster],
  );

  // Local marks: default present, seeded from a prior submit.
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const statusOf = (uid: string): AttendanceStatus =>
    marks[uid] ?? session.attendance[uid] ?? 'present';
  const setStatus = (uid: string, s: AttendanceStatus) =>
    setMarks((m) => ({ ...m, [uid]: s }));
  const markAllAbsent = () =>
    setMarks(Object.fromEntries(activeUids.map((uid) => [uid, 'absent' as AttendanceStatus])));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = () =>
    void (async () => {
      setBusy(true);
      setError(null);
      setInfo(null);
      try {
        const attendance = Object.fromEntries(activeUids.map((uid) => [uid, statusOf(uid)]));
        const res = await submitAttendance({ sessionId: session.id, attendance });
        setMarks({});
        setInfo(`Attendance submitted for ${res.marked} student${res.marked === 1 ? '' : 's'}.`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    })();

  return (
    <>
      <SectionTitle>Attendance</SectionTitle>
      <Card>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="success">{info}</Notice> : null}
        <Text style={styles.meta}>
          {session.attendanceSubmittedAt
            ? 'Submitted. Absent and excused students are assigned the recording; present students are exempt.'
            : 'Not taken yet. Mark who was present, then submit — nothing is assigned until you do.'}
        </Text>
        {activeUids.length === 0 ? (
          <Empty>No students enrolled in this course yet.</Empty>
        ) : (
          <>
            {activeUids.map((uid) => (
              <View key={uid} style={styles.rosterRow}>
                <Text style={styles.rosterName}>{nameByUid.get(uid) ?? uid}</Text>
                <View style={styles.segment}>
                  {STATUSES.map((s) => {
                    const on = statusOf(uid) === s;
                    return (
                      <Pressable
                        key={s}
                        testID={`att-${nameByUid.get(uid) ?? uid}-${s}`}
                        onPress={() => setStatus(uid, s)}
                        style={[styles.segBtn, on ? styles.segBtnOn : null]}
                      >
                        <Text style={[styles.segText, on ? styles.segTextOn : null]}>
                          {STATUS_LABEL[s]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            <Row>
              <Button testID="att-submit" label="Submit attendance" busy={busy} onPress={submit} />
              <Button label="Mark all absent" variant="secondary" onPress={markAllAbsent} />
            </Row>
          </>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------- recording --

function RecordingSection({
  session,
  recording,
  isAdmin,
  onOpenLedger,
  onPlay,
  onImportZoom,
}: {
  session: SessionRow;
  recording: RecordingRow | null;
  isAdmin: boolean;
  onOpenLedger: (recording: RecordingRow, session: SessionRow) => void;
  onPlay: (recording: RecordingRow, session: SessionRow) => void;
  onImportZoom: (session: SessionRow) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run = (key: string, fn: () => Promise<unknown>) =>
    void (async () => {
      setBusy(key);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    })();

  const upload = () =>
    void (async () => {
      const picked = await pickAudioFile();
      if (!picked) return;
      setBusy('upload');
      setError(null);
      try {
        const { id } = await createRecording({ sessionId: session.id });
        setProgress(0);
        await uploadRecordingAudio(id, picked.blob, setProgress);
        await finalizeRecordingUpload({ recordingId: id, durationSec: picked.durationSec });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setProgress(null);
        setBusy(null);
      }
    })();

  return (
    <>
      <SectionTitle>Recording</SectionTitle>
      <Card>
        {error ? <Notice tone="error">{error}</Notice> : null}

        {!recording ? (
          <>
            <Text style={styles.meta}>
              No recording yet. Upload the audio or import it from Zoom; the session&apos;s title and
              date are used automatically.
            </Text>
            {canPickAudio ? (
              <>
                {progress !== null ? (
                  <View style={styles.progressWrap}>
                    <View style={[styles.progressBar, { width: `${Math.round(progress * 100)}%` }]} />
                    <Text style={styles.progressText}>Uploading {Math.round(progress * 100)}%</Text>
                  </View>
                ) : null}
                <Button testID="recording-upload" label="Upload audio…" busy={busy === 'upload'} onPress={upload} />
              </>
            ) : (
              <Notice tone="info">Uploading is done from the web app on a computer.</Notice>
            )}
            <Button
              testID="recording-import-zoom"
              label="Import from Zoom"
              variant="secondary"
              onPress={() => onImportZoom(session)}
            />
          </>
        ) : (
          <RecordingCard
            recording={recording}
            session={session}
            isAdmin={isAdmin}
            busy={busy}
            confirmingDelete={confirmingDelete}
            setConfirmingDelete={setConfirmingDelete}
            onRun={run}
            onOpenLedger={onOpenLedger}
            onPlay={onPlay}
          />
        )}
      </Card>
    </>
  );
}

function RecordingCard({
  recording: r,
  session,
  isAdmin,
  busy,
  confirmingDelete,
  setConfirmingDelete,
  onRun,
  onOpenLedger,
  onPlay,
}: {
  recording: RecordingRow;
  session: SessionRow;
  isAdmin: boolean;
  busy: string | null;
  confirmingDelete: boolean;
  setConfirmingDelete: (v: boolean) => void;
  onRun: (key: string, fn: () => Promise<unknown>) => void;
  onOpenLedger: (recording: RecordingRow, session: SessionRow) => void;
  onPlay: (recording: RecordingRow, session: SessionRow) => void;
}) {
  const blockers = publishBlockers(r);
  const moves = allowedTransitions(r.status).filter((to) => to !== 'needsAttention');

  return (
    <>
      <View style={styles.recMeta}>
        <StatusChip status={r.status} />
        <Text style={styles.hint}>
          {r.durationSec ? fmtDuration(r.durationSec) : 'no duration'}
          {r.sizeBytes ? ` · ${(r.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ''}
        </Text>
      </View>

      {blockers.includes('audio') ? (
        <Notice tone="error">This recording has no audio. Upload one before publishing.</Notice>
      ) : null}
      {r.status === 'needsAttention' && r.attentionReason ? (
        <Notice tone="error">{r.attentionReason}</Notice>
      ) : null}
      {r.status === 'needsAttention' && r.source === 'zoom' ? (
        <Button
          label="Retry import"
          busy={busy === `retry-${r.id}`}
          onPress={() => onRun(`retry-${r.id}`, () => retryZoomImport({ recordingId: r.id }))}
        />
      ) : null}

      <Row>
        {r.audioPath ? (
          <Button testID="recording-listen" label="Listen" variant="secondary" onPress={() => onPlay(r, session)} />
        ) : null}
        {moves.map((to) => (
          <Button
            key={to}
            testID={`recording-${to}`}
            label={LABELS[to]}
            variant={to === 'published' ? 'primary' : 'secondary'}
            disabled={to === 'published' && blockers.length > 0}
            busy={busy === `status-${r.id}`}
            onPress={() => onRun(`status-${r.id}`, () => setRecordingStatus({ recordingId: r.id, status: to }))}
          />
        ))}
        {r.audioPath && (r.status === 'draft' || r.status === 'needsAttention') ? (
          <Button
            label="Remove audio"
            variant="secondary"
            busy={busy === `clear-${r.id}`}
            onPress={() => onRun(`clear-${r.id}`, () => clearRecordingAudio({ recordingId: r.id }))}
          />
        ) : null}
      </Row>

      {r.status === 'published' ? (
        <View style={styles.ledgerRow}>
          <Button
            testID="recording-ledger"
            label="Listening progress"
            variant="secondary"
            onPress={() => onOpenLedger(r, session)}
          />
        </View>
      ) : null}

      {isAdmin && r.status !== 'published' ? (
        <View style={styles.dangerZone}>
          {confirmingDelete ? (
            <>
              <Notice tone="error">
                This permanently removes the audio and every listening record for it — it can&apos;t
                be undone. Archiving keeps everything; delete only to free up storage.
              </Notice>
              <Row>
                <Button
                  testID="recording-delete-confirm"
                  label="Delete permanently"
                  variant="danger"
                  busy={busy === `del-${r.id}`}
                  onPress={() => onRun(`del-${r.id}`, () => deleteRecording({ recordingId: r.id }))}
                />
                <Button label="Cancel" variant="secondary" onPress={() => setConfirmingDelete(false)} />
              </Row>
            </>
          ) : (
            <Button
              testID="recording-delete"
              label="Delete recording"
              variant="danger"
              onPress={() => setConfirmingDelete(true)}
            />
          )}
        </View>
      ) : null}
    </>
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
  meta: { fontSize: 14, color: t.text.secondary },
  notes: { fontSize: 14, color: t.text.secondary, marginTop: spacing(2) },
  hint: { fontSize: 13, color: t.text.secondary },
  rosterRow: { marginTop: spacing(3) },
  rosterName: { fontSize: 15, color: t.text.primary, marginBottom: spacing(1) },
  segment: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, borderColor: t.border.strong, overflow: 'hidden' },
  segBtn: { flex: 1, paddingVertical: spacing(2), alignItems: 'center', backgroundColor: t.bg.surface },
  segBtnOn: { backgroundColor: t.accent.base },
  segText: { fontSize: 13, fontWeight: '600', color: t.text.secondary },
  segTextOn: { color: t.accent.onAccent },
  recMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing(3), marginBottom: spacing(2) },
  ledgerRow: { marginTop: spacing(3), paddingTop: spacing(3), borderTopWidth: 1, borderTopColor: t.border.subtle },
  dangerZone: { marginTop: spacing(4), paddingTop: spacing(3), borderTopWidth: 1, borderTopColor: t.border.subtle },
  progressWrap: { marginTop: spacing(3), backgroundColor: t.bg.inset, borderRadius: 6, overflow: 'hidden', minHeight: 26, justifyContent: 'center' },
  progressBar: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: t.bg.sage },
  progressText: { fontSize: 12, color: t.text.primary, paddingHorizontal: spacing(2), paddingVertical: spacing(1) },
});
