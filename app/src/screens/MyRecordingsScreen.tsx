import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { collection, doc, getDoc, query, where } from 'firebase/firestore';
import { COLLECTIONS, type ClassDoc, type RecordingDoc } from '@sabeel/shared';
import { Card, Empty, Notice, Screen, SectionTitle } from '../components/ui';
import { db } from '../firebase';
import { useLiveQuery } from '../liveQuery';
import { useMyEnrollments, type ClassRow } from '../structure';
import type { RecordingRow } from '../recordings';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * A student's classes, and the published recordings in them.
 *
 * The queries here are shaped by the security rules rather than the other way
 * round: a student lists their own enrollments (constrained by studentUid),
 * reads each class BY ID, then lists published recordings per class. Listing
 * classes, or listing recordings unconstrained, is denied — so this shape is
 * not a style choice.
 */
export function MyRecordingsScreen({
  uid,
  onOpen,
}: {
  uid: string;
  onOpen: (recording: RecordingRow, cls: ClassRow) => void;
}) {
  const enrollments = useMyEnrollments(uid);
  const classIds = useMemo(
    () => enrollments.filter((e) => e.active).map((e) => e.classId),
    [enrollments],
  );

  return (
    <Screen subtitle="Your recordings">
      {classIds.length === 0 ? (
        <Empty>You are not enrolled in any classes yet.</Empty>
      ) : (
        classIds.map((classId) => (
          <ClassSection key={classId} classId={classId} onOpen={onOpen} />
        ))
      )}
    </Screen>
  );
}

/**
 * One class by id.
 *
 * A plain get, not a live subscription: a student may GET a class they are
 * enrolled in but never LIST classes, and a class's own details change rarely
 * enough that a listener each would be noise.
 */
function useClass(classId: string): ClassRow | null {
  const [cls, setCls] = useState<ClassRow | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getDoc(doc(db, COLLECTIONS.classes, classId))
      .then((snap) => {
        if (cancelled) return;
        setCls(snap.exists() ? { id: snap.id, ...(snap.data() as ClassDoc) } : null);
      })
      .catch(() => {
        if (!cancelled) setCls(null);
      });
    return () => {
      cancelled = true;
    };
  }, [classId]);
  return cls;
}

function ClassSection({
  classId,
  onOpen,
}: {
  classId: string;
  onOpen: (r: RecordingRow, c: ClassRow) => void;
}) {
  const cls = useClass(classId);
  const recordings = useLiveQuery<RecordingRow[]>(
    'studentRecordings',
    () =>
      query(
        collection(db, COLLECTIONS.recordings),
        where('classId', '==', classId),
        where('status', '==', 'published'),
      ),
    (snap) => snap.docs.map((d) => ({ id: d.id, ...(d.data() as RecordingDoc) })),
    [],
    [classId],
  );

  if (!cls) return null;
  const listeningOff = !cls.effectiveActive && !cls.archivedAccess;

  return (
    <>
      <SectionTitle>{cls.name}</SectionTitle>
      {listeningOff ? (
        <Notice tone="info">
          This class is archived and listening has been turned off. Your history is kept.
        </Notice>
      ) : null}
      {recordings.length === 0 ? (
        <Empty>Nothing published in this class yet.</Empty>
      ) : (
        recordings.map((r) => (
          <Card key={r.id}>
            <Pressable
              testID={`play-${r.title}`}
              accessibilityRole="button"
              accessibilityLabel={`Listen to ${r.title}`}
              onPress={() => onOpen(r, cls)}
            >
              <Text style={styles.title}>{r.title}</Text>
              <View style={styles.meta}>
                <Text style={styles.hint}>
                  {r.durationSec ? `${Math.round(r.durationSec / 60)} min` : 'duration unknown'}
                  {r.dueDate ? ` · due ${r.dueDate}` : ' · no due date'}
                </Text>
              </View>
            </Pressable>
          </Card>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(1) },
  hint: { fontSize: 13, color: t.text.secondary },
});
