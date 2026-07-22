import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Button,
  Card,
  Empty,
  Field,
  Notice,
  Screen,
  SectionTitle,
  StatusChip,
} from '../components/ui';
import { createClass, useClassesInCohort, type ClassRow } from '../structure';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/** Admin-only: the classes inside one cohort. */
export function ClassesScreen({
  cohortId,
  cohortName,
  cohortArchived,
  onOpen,
}: {
  cohortId: string;
  cohortName: string;
  cohortArchived: boolean;
  onOpen: (cls: ClassRow) => void;
}) {
  const classes = useClassesInCohort(cohortId);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen subtitle={cohortName}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {cohortArchived ? (
        <Notice tone="info">
          This cohort is archived, so every class in it is inactive regardless of its own
          setting. Reactivating the cohort restores each class to the state it was in.
        </Notice>
      ) : null}

      <SectionTitle>Add a class</SectionTitle>
      <Card>
        <Field
          testID="class-name"
          label="Name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          placeholder="Hikam Foundations"
        />
        <Button
          testID="class-create"
          label="Create class"
          busy={busy}
          disabled={!name.trim()}
          onPress={() =>
            void (async () => {
              setBusy(true);
              setError(null);
              try {
                await createClass({ cohortId, name: name.trim() });
                setName('');
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            })()
          }
        />
      </Card>

      <SectionTitle>Classes ({classes.length})</SectionTitle>
      {classes.length === 0 ? (
        <Empty>No classes in this cohort yet.</Empty>
      ) : (
        classes.map((c) => <ClassCard key={c.id} cls={c} onOpen={onOpen} />)
      )}
    </Screen>
  );
}

export function ClassCard({ cls, onOpen }: { cls: ClassRow; onOpen: (c: ClassRow) => void }) {
  return (
    <Card>
      <Pressable
        testID={`class-open-${cls.name}`}
        accessibilityRole="button"
        accessibilityLabel={`Open ${cls.name}`}
        onPress={() => onOpen(cls)}
      >
        <Text style={styles.name}>{cls.name}</Text>
        <View style={styles.meta}>
          <StatusChip status={cls.effectiveActive ? 'active' : 'inactive'} />
          {!cls.effectiveActive && cls.archivedAccess ? (
            <Text style={styles.hint}>listening still allowed</Text>
          ) : null}
          <Text style={styles.hint}>
            {cls.managerUids.length === 1
              ? '1 manager'
              : `${cls.managerUids.length} managers`}
          </Text>
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing(3),
    marginTop: spacing(2),
  },
  hint: { fontSize: 13, color: t.text.secondary },
});
