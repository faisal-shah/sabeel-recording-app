import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { getTheme, spacing } from '../theme';

const t = getTheme();

/**
 * Native side of the date seam (web sibling: DateField.web.tsx).
 *
 * A calendar picker instead of a hand-typed `YYYY-MM-DD` — the value stays a
 * date-only string so nothing downstream changes. Optional: a Clear control
 * removes the date entirely (`''` → stored as null by the caller).
 */
interface DateFieldProps {
  label: string;
  value: string; // YYYY-MM-DD, or '' for none
  onChange: (v: string) => void;
}

export function DateField({ label, value, onChange }: DateFieldProps) {
  const [show, setShow] = useState(false);
  // Parse as LOCAL midnight so the picker opens on the stored day; a due date is
  // a plain calendar date, never a UTC instant.
  const current = value ? new Date(`${value}T00:00:00`) : new Date();

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable
          testID="datefield-open"
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value || 'not set'}`}
          style={styles.input}
          onPress={() => setShow(true)}
        >
          <Text style={value ? styles.value : styles.placeholder}>{value || 'Set a date'}</Text>
        </Pressable>
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear the date"
            onPress={() => onChange('')}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      {show ? (
        <DateTimePicker
          value={current}
          mode="date"
          // onValueChange fires on OK with the chosen date; onDismiss on cancel.
          // (Replaces the deprecated single onChange.) Either way, unmount the
          // dialog by clearing `show`.
          onValueChange={(_event, date) => {
            setShow(false);
            if (date) onChange(toYmd(date));
          }}
          onDismiss={() => setShow(false)}
        />
      ) : null}
    </View>
  );
}

/** Local calendar date → YYYY-MM-DD, without the UTC shift toISOString brings. */
function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const styles = StyleSheet.create({
  field: { marginTop: spacing(3) },
  label: { fontSize: 13, color: t.text.secondary, marginBottom: spacing(1) },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  input: {
    flex: 1,
    backgroundColor: t.bg.inset,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.border.subtle,
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(3),
  },
  value: { fontSize: 16, color: t.text.primary },
  placeholder: { fontSize: 16, color: t.text.muted },
  clear: { fontSize: 14, color: t.text.secondary, fontWeight: '600' },
});
