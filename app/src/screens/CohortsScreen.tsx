import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { createCohort, setCohortArchived, useCohorts, type CohortRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Admin-only: cohorts, and the archive switch that cascades to their classes.
 *
 * Archiving is presented as reversible because it is — the cascade never writes
 * a class's own `archived` flag, so reactivating restores each class to the
 * state it was already in.
 */
export function CohortsScreen({ onOpen }: { onOpen: (cohort: CohortRow) => void }) {
  const cohorts = useCohorts(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, id?: string) => {
    if (id) setBusyId(id);
    else setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id) setBusyId(null);
      else setBusy(false);
    }
  };

  return (
    <Screen subtitle="Semesters, and the classes inside them">
      {error ? <Notice tone="error">{error}</Notice> : null}

      <SectionTitle>Add a cohort</SectionTitle>
      <Card>
        <Field
          testID="cohort-name"
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder="Autumn 2026"
        />
        <Button
          testID="cohort-create"
          label="Create cohort"
          busy={busy}
          disabled={!name.trim()}
          onPress={() =>
            void run(async () => {
              await createCohort({ name: name.trim() });
              setName('');
            })
          }
        />
      </Card>

      <SectionTitle>Cohorts ({cohorts.length})</SectionTitle>
      {cohorts.length === 0 ? (
        <Empty>No cohorts yet.</Empty>
      ) : (
        cohorts.map((c) => (
          <Card key={c.id}>
            <Pressable
              testID={`cohort-open-${c.name}`}
              accessibilityRole="button"
              accessibilityLabel={`Open ${c.name}`}
              onPress={() => onOpen(c)}
            >
              <Text style={styles.name}>{c.name}</Text>
              <View style={styles.meta}>
                <StatusChip status={c.archived ? 'archived' : 'active'} />
                <Text style={styles.hint}>Tap to see classes</Text>
              </View>
            </Pressable>
            <Row>
              <Button
                testID={`cohort-archive-${c.name}`}
                label={c.archived ? 'Reactivate' : 'Archive'}
                variant="secondary"
                busy={busyId === c.id}
                onPress={() =>
                  void run(
                    () => setCohortArchived({ cohortId: c.id, archived: !c.archived }),
                    c.id,
                  )
                }
              />
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginTop: spacing(2) },
  hint: { fontSize: 13, color: t.text.secondary },
});
