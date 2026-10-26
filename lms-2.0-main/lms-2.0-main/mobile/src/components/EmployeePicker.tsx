import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { listEmployees } from '../api/employees';
import type { Palette } from '../theme/colors';
import { useThemeColors } from '../theme/ThemeContext';
import type { Employee } from '../types/models';

/** Org-wide employee search (GET /api/employees?search=, HR_ADMIN-only) —
 * shared by every admin screen that needs to target an arbitrary employee
 * (self-approval grants, encashment, capacity-limit managers), as opposed to
 * getWatchableEmployees()/getMyTeam(), which are scoped to a Manager's own
 * hierarchy and wrong for HR-wide actions. */
export function EmployeePicker({ label, value, onSelect }: { label: string; value: Employee | null; onSelect: (e: Employee) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      listEmployees(query.trim())
        .then((rows) => {
          if (!cancelled) setResults(rows.slice(0, 15));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  if (value) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.selectedRow}>
          <Text style={styles.selectedText}>{value.full_name} ({value.employee_code})</Text>
          <Pressable onPress={() => onSelect(null as unknown as Employee)} hitSlop={8}>
            <Text style={styles.changeText}>Change</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={query}
        onChangeText={setQuery}
        placeholder="Search by name or employee code…"
        placeholderTextColor={colors.textMuted}
      />
      {loading && <ActivityIndicator size="small" color={colors.accent} style={styles.spinner} />}
      {results.map((e) => (
        <Pressable key={e.employee_id} style={styles.resultRow} onPress={() => onSelect(e)}>
          <Text style={styles.resultText}>{e.full_name} ({e.employee_code})</Text>
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { marginTop: 6 },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.surface, color: colors.text },
    spinner: { marginTop: 6 },
    resultRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    resultText: { color: colors.text, fontSize: 13 },
    selectedRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.tint2,
      borderRadius: 8,
      padding: 10,
    },
    selectedText: { color: colors.accentText, fontSize: 13, fontWeight: '600' },
    changeText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  });
}
