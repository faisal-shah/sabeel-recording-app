import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  createStudent,
  resendPasswordSetup,
  setStudentAccess,
  useStudents,
} from '../students';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Staff: create students and manage their access.
 *
 * Creating a student IS the approval — they arrive active, with no pending
 * state. The account is made without a password and the student sets their own
 * from an emailed link; completing that link is what proves they control the
 * address, so there is no separate verification step.
 *
 * Enrolment into a class is added in 1b, once classes exist.
 */
export function StudentsScreen({ canManageAccess }: { canManageAccess: boolean }) {
  const students = useStudents(true);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await createStudent({ displayName: displayName.trim(), email: email.trim() });
      setDisplayName('');
      setEmail('');
      setInfo(
        res.emailSent
          ? 'Account created. They have been emailed a link to set their password.'
          : 'Account created, but the password email could not be sent. Use Resend below.',
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen subtitle="Create accounts and manage access">
      <SectionTitle>Add a student</SectionTitle>
      <Card>
        <Field
          testID="student-name"
          label="Full name"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          placeholder="Fatima Ahmed"
        />
        <Field
          testID="student-email"
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          placeholder="student@example.com"
        />
        <Button
          testID="student-create"
          label="Create account"
          busy={busy}
          disabled={!displayName.trim() || !email.includes('@')}
          onPress={() => void create()}
        />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="success">{info}</Notice> : null}
      </Card>

      <SectionTitle>Students ({students.length})</SectionTitle>
      {students.length === 0 ? (
        <Empty>No students yet.</Empty>
      ) : (
        students.map((s) => (
          <Card key={s.uid}>
            <Text style={styles.name}>{s.displayName}</Text>
            <Text style={styles.email}>{s.email}</Text>
            <View style={styles.meta}>
              <StatusChip status={s.status} />
            </View>
            <Row>
              <Button
                label="Resend password link"
                variant="secondary"
                busy={busyUid === s.uid}
                onPress={() =>
                  void (async () => {
                    setBusyUid(s.uid);
                    setError(null);
                    setInfo(null);
                    try {
                      await resendPasswordSetup(s.email);
                      setInfo(`Password link sent to ${s.email}.`);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusyUid(null);
                    }
                  })()
                }
              />
              {canManageAccess ? (
                <Button
                  label={s.status === 'disabled' ? 'Re-enable' : 'Disable'}
                  variant={s.status === 'disabled' ? 'secondary' : 'danger'}
                  busy={busyUid === s.uid}
                  onPress={() =>
                    void (async () => {
                      setBusyUid(s.uid);
                      setError(null);
                      try {
                        await setStudentAccess({
                          uid: s.uid,
                          status: s.status === 'disabled' ? 'active' : 'disabled',
                        });
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusyUid(null);
                      }
                    })()
                  }
                />
              ) : null}
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '600', color: t.text.primary },
  email: { fontSize: 14, color: t.text.secondary, marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', marginTop: spacing(2) },
});
