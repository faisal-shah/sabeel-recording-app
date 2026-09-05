import { Pressable, StyleSheet, Text, View } from 'react-native';
import { INSTITUTE_TIMEZONE, todayInZone } from '@sabeel/shared';
import { Empty, Grid, Notice, Screen } from '../components/ui';
import { PushNudge } from '../components/PushNudge';
import type { TodayItem, TodayKind, TodayQueue } from '../today';
import { getTheme, spacing } from '../theme';

const t = getTheme();

const HEADINGS: { kind: TodayKind; label: string; blurb: string }[] = [
  {
    kind: 'attendance',
    label: 'Attendance not taken',
    blurb: 'Until this is submitted, nobody in the class has access.',
  },
  { kind: 'publish', label: 'Waiting to publish', blurb: 'Recorded, not yet released.' },
  { kind: 'recording', label: 'No recording yet', blurb: 'Attendance is in; the audio is not.' },
  { kind: 'closing', label: 'Closing soon', blurb: 'Access ends within the week.' },
];

/**
 * The staff landing screen: what is waiting, most urgent first.
 *
 * The argument for leading with this rather than with the cohort hierarchy is
 * the shape of the job. Everything a teacher does here
 * runs on a fixed cycle: a class meets, attendance is taken, the recording is
 * added and published, and a week later access closes. Every one of those steps
 * is dated, every one has an owner, and every one is invisible until somebody
 * goes looking for it course by course. A hierarchy answers "where is X"; this
 * answers "what is waiting", which is the question actually being asked on a
 * Tuesday evening.
 *
 * Nothing here is stored — see `today.ts`. Each row is derived, live, from
 * documents the reader can already see, so it cannot go stale and there is no
 * second copy of the truth to reconcile. The count on the tab comes from the
 * same subscription, so the badge and this screen cannot disagree.
 *
 * An empty queue is a RESULT, not a blank screen: "nothing is waiting" is the
 * single most useful thing this screen can say, and it has to say it in those
 * words rather than showing an empty list.
 */
export function TodayScreen({
  uid,
  queue,
  onOpenSession,
  onOpenLedger,
}: {
  uid: string;
  /** Subscribed by the app shell, so the tab's badge cannot disagree with it. */
  queue: TodayQueue;
  onOpenSession: (sessionId: string, courseId: string) => void;
  onOpenLedger: (recordingId: string) => void;
}) {
  const { items, blocking, loading, failed, scoped, truncated } = queue;
  const today = todayInZone(INSTITUTE_TIMEZONE);

  return (
    <Screen
      title="Today"
      subtitle={
        failed
          ? 'Could not read your courses'
          : loading
          ? 'Checking your courses…'
          : !scoped
            ? 'No courses yet'
            : items.length === 0
              ? `Nothing is waiting · ${today}`
              : blocking > 0
                ? `${items.length} waiting · ${blocking} blocking access`
                : `${items.length} waiting`
      }
      width="list"
    >
      {/* Top of the content. Same place in all three apps: first thing after
          anything that needs acting on today. */}
      <PushNudge uid={uid} />

      {/* Not "the first N" in any order a reader could predict — the scope is
          cut by document id, which is arbitrary. Say what is true. */}
      {truncated ? (
        <Text style={styles.note}>
          More courses than this queue can span. Some are not counted here — open a
          cohort to see them.
        </Text>
      ) : null}

      {/* An empty queue has two quite different causes, and only one of them is
          good news. Saying "attendance is in" to someone who has not been given
          a course yet is a sentence about courses they do not have. */}
      {!loading && !failed && items.length === 0 ? (
        scoped ? (
          <Empty>
            Attendance is in, every recording is published, and nothing closes this week.
          </Empty>
        ) : (
          <Notice tone="info">
            You are not assigned to any courses yet. An administrator assigns them; once
            they do, this is where the work waiting on you appears.
          </Notice>
        )
      ) : null}

      {HEADINGS.map((h) => {
        const rows = items.filter((i) => i.kind === h.kind);
        if (rows.length === 0) return null;
        return (
          <View key={h.kind} style={styles.group}>
            <View style={styles.groupHead}>
              <Text style={[styles.groupLabel, h.kind === 'attendance' ? styles.urgent : null]}>
                {h.label} ({rows.length})
              </Text>
              <Text style={styles.groupBlurb}>{h.blurb}</Text>
            </View>
            <Grid min={330}>
              {rows.map((item) => (
                <QueueCard
                  key={item.key}
                  item={item}
                  onPress={() =>
                    item.kind === 'closing' && item.recordingId
                      ? onOpenLedger(item.recordingId)
                      : onOpenSession(item.sessionId, item.courseId)
                  }
                />
              ))}
            </Grid>
          </View>
        );
      })}
    </Screen>
  );
}

function QueueCard({ item, onPress }: { item: TodayItem; onPress: () => void }) {
  const urgent = item.kind === 'attendance';
  return (
    <Pressable
      testID={`today-${item.key}`}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.detail}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        urgent ? styles.cardUrgent : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <Text style={styles.course} numberOfLines={1}>
        {item.courseName}
      </Text>
      <Text style={styles.title} numberOfLines={2}>
        {item.title}
      </Text>
      <Text style={styles.detail}>{item.detail}</Text>
      <Text style={styles.action}>
        {item.kind === 'attendance'
          ? 'Take attendance ›'
          : item.kind === 'closing'
            ? 'See who has listened ›'
            : item.kind === 'publish'
              ? 'Review and publish ›'
              : 'Add the recording ›'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: spacing(5) },
  groupHead: { marginBottom: spacing(2) },
  groupLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, color: t.text.secondary, textTransform: 'uppercase' },
  urgent: { color: t.text.danger },
  groupBlurb: { fontSize: 13, color: t.text.muted, marginTop: 2 },
  note: { fontSize: 13, color: t.text.muted, marginBottom: spacing(3) },
  card: {
    backgroundColor: t.bg.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.border.subtle,
    padding: spacing(4),
    marginBottom: spacing(3),
    minHeight: 132,
  },
  cardUrgent: { borderColor: t.feedback.danger, backgroundColor: t.bg.dangerSoft },
  cardPressed: { opacity: 0.8 },
  course: { fontSize: 12, fontWeight: '700', color: t.text.secondary, letterSpacing: 0.4 },
  title: { fontSize: 16, fontWeight: '700', color: t.text.primary, marginTop: 2 },
  detail: { fontSize: 13, color: t.text.secondary, marginTop: spacing(2), flex: 1 },
  action: { fontSize: 13, fontWeight: '700', color: t.text.accent, marginTop: spacing(3) },
});
