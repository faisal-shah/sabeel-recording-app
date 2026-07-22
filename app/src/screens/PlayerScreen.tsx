import { StyleSheet, Text, View } from 'react-native';
import { canPlayFromClass, listenedFraction } from '@sabeel/shared';
import { Button, Card, Notice, Row, Screen, SectionTitle } from '../components/ui';
import { usePlayback } from '../playback';
import type { ClassRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();
const RATES = [1, 1.25, 1.5, 2];

/**
 * Listening to one recording.
 *
 * When the class is archived with listening turned off, this says so plainly
 * rather than showing controls that would fail — the callable refuses the URL
 * either way, so a working-looking button would only produce a confusing error.
 */
export function PlayerScreen({
  recording,
  cls,
  studentUid,
}: {
  recording: RecordingRow;
  cls: ClassRow;
  studentUid: string | null;
}) {
  const allowed = canPlayFromClass(cls);
  const { state, play, pause, seek, setRate } = usePlayback(
    recording.id,
    studentUid,
    recording.classId,
  );

  if (!allowed) {
    return (
      <Screen subtitle={recording.title}>
        <Notice tone="info">
          This class has been archived and listening has been turned off. Your listening
          history is kept — ask your teacher if you need access again.
        </Notice>
      </Screen>
    );
  }

  const durationMs = (recording.durationSec ?? 0) * 1000;
  const fraction = durationMs > 0 ? Math.min(1, state.positionMs / durationMs) : 0;
  const listened = listenedFraction(state.listenedMs, recording.durationSec);

  return (
    <Screen subtitle={recording.title}>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {recording.notes ? <Notice tone="info">{recording.notes}</Notice> : null}

      <Card>
        <Text style={styles.time}>
          {fmt(state.positionMs)} <Text style={styles.of}>/ {fmt(durationMs)}</Text>
        </Text>

        <View style={styles.track}>
          <View style={[styles.played, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
        <Text style={styles.listened}>
          {Math.round(listened * 100)}% listened
          {state.listenedMs > 0 && listened < 0.02 ? ' (just started)' : ''}
        </Text>

        <Row>
          <Button
            testID="player-back"
            label="← 15s"
            variant="secondary"
            disabled={!state.ready}
            onPress={() => seek(Math.max(0, state.positionMs - 15_000))}
          />
          <Button
            testID="player-play"
            label={state.playing ? 'Pause' : 'Play'}
            disabled={!state.ready}
            onPress={state.playing ? pause : play}
          />
          <Button
            testID="player-forward"
            label="30s →"
            variant="secondary"
            disabled={!state.ready}
            onPress={() => seek(state.positionMs + 30_000)}
          />
        </Row>

        <SectionTitle>Speed</SectionTitle>
        <Row>
          {RATES.map((r) => (
            <Button
              key={r}
              testID={`player-rate-${r}`}
              label={`${r}×`}
              variant={state.rate === r ? 'primary' : 'secondary'}
              disabled={!state.ready}
              onPress={() => setRate(r)}
            />
          ))}
        </Row>

        {!state.ready && !state.error ? <Text style={styles.hint}>Preparing…</Text> : null}
      </Card>

      <Text style={styles.footnote}>
        Your place is saved automatically, so you can carry on from another device.
      </Text>
    </Screen>
  );
}

function fmt(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  time: { fontSize: 32, fontWeight: '700', color: t.text.primary, fontVariant: ['tabular-nums'] },
  of: { fontSize: 18, fontWeight: '400', color: t.text.secondary },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: t.bg.inset,
    overflow: 'hidden',
    marginTop: spacing(3),
  },
  played: { height: 8, backgroundColor: t.accent.base },
  listened: { fontSize: 13, color: t.text.secondary, marginTop: spacing(2) },
  hint: { fontSize: 13, color: t.text.secondary, marginTop: spacing(2) },
  footnote: { fontSize: 13, color: t.text.secondary, marginTop: spacing(2) },
});
