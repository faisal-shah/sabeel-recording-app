import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  allowedTransitions,
  publishBlockers,
  type RecordingStatus,
} from '@sabeel/shared';
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
import {
  clearRecordingAudio,
  createRecording,
  finalizeRecordingUpload,
  readAudioDuration,
  setRecordingStatus,
  updateRecording,
  uploadRecordingAudio,
  useClassRecordings,
  type RecordingRow,
} from '../recordings';
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
export function RecordingsScreen({ classId, className }: { classId: string; className: string }) {
  const recordings = useClassRecordings(classId);
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
      const file = await pickAudioFile();
      if (!file) return; // user changed their mind
      setInfo(null);
      const duration = await readAudioDuration(file);
      const { id } = await createRecording({
        classId,
        title: title.trim(),
        recordedAt: Date.now(),
      });
      setProgress(0);
      try {
        await uploadRecordingAudio(id, file, setProgress);
        await finalizeRecordingUpload({ recordingId: id, durationSec: duration });
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
          <RecordingCard key={r.id} recording={r} busy={busy} onRun={run} />
        ))
      )}
    </Screen>
  );
}

function RecordingCard({
  recording: r,
  busy,
  onRun,
}: {
  recording: RecordingRow;
  busy: string | null;
  onRun: (key: string, fn: () => Promise<void>) => void;
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
          <Field
            label="Due date (YYYY-MM-DD, blank for none)"
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="2026-08-01"
          />
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
          {moves.map((to) => (
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
    </Card>
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
