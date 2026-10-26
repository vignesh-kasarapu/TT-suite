import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as workingPatterns from '../../../api/workingPatterns';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmployeePicker } from '../../../components/EmployeePicker';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee } from '../../../types/models';

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
type Segment = 'patterns' | 'assignments';

/** LMS-015: overlap validation for assignments is server-enforced
 * (WORKING_PATTERN_OVERLAP), not pre-checked here. */
export default function WorkingPatternsAdmin() {
  const [segment, setSegment] = useState<Segment>('patterns');
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.flex}>
      <View style={styles.segmentRow}>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'patterns' && styles.segmentActive])} onPress={() => setSegment('patterns')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'patterns' && styles.segmentTextActive])}>Patterns</Text>
        </Pressable>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'assignments' && styles.segmentActive])} onPress={() => setSegment('assignments')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'assignments' && styles.segmentTextActive])}>Assignments</Text>
        </Pressable>
      </View>
      {segment === 'patterns' ? <PatternsPanel colors={colors} /> : <AssignmentsPanel colors={colors} />}
    </View>
  );
}

function PatternsPanel({ colors }: { colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data, loading, error, refreshing, refresh, reload } = useApi(() => workingPatterns.listWorkingPatterns());
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [weekendDays, setWeekendDays] = useState<string[]>(['SAT', 'SUN']);
  const [busy, setBusy] = useState(false);

  const toggleDay = (day: string) => {
    setWeekendDays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]));
  };

  const submit = async () => {
    if (!code.trim() || !name.trim() || weekendDays.length === 0) return;
    setBusy(true);
    try {
      await workingPatterns.createWorkingPattern(code.trim().toUpperCase(), name.trim(), weekendDays);
      setShowCreate(false);
      setCode('');
      setName('');
      setWeekendDays(['SAT', 'SUN']);
      await reload();
    } catch (err) {
      Alert.alert('Could not create pattern', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (id: number, isActive: boolean) => {
    setBusy(true);
    try {
      if (isActive) await workingPatterns.deactivateWorkingPattern(id);
      else await workingPatterns.reactivateWorkingPattern(id);
      await reload();
    } catch (err) {
      Alert.alert('Could not update', err instanceof ApiError ? err.message : 'This pattern may still be assigned to an employee.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.toggleButton} onPress={() => setShowCreate((s) => !s)}>
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ New Pattern'}</Text>
      </Pressable>
      {showCreate && (
        <View style={styles.formCard}>
          <TextInput style={styles.input} placeholder="Pattern code" placeholderTextColor={colors.textMuted} value={code} onChangeText={setCode} autoCapitalize="characters" />
          <TextInput style={styles.input} placeholder="Pattern name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
          <Text style={styles.label}>Weekend days</Text>
          <View style={styles.chipRow}>
            {WEEKDAYS.map((day) => (
              <Pressable key={day} style={StyleSheet.flatten([styles.chip, weekendDays.includes(day) && styles.chipSelected])} onPress={() => toggleDay(day)}>
                <Text style={StyleSheet.flatten([styles.chipText, weekendDays.includes(day) && styles.chipTextSelected])}>{day}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Create</Text>}
          </Pressable>
        </View>
      )}
      {!data?.length ? (
        <EmptyState text="No working patterns." />
      ) : (
        data.map((p) => (
          <View key={p.working_pattern_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{p.pattern_name}</Text>
              <Text style={styles.span}>{p.pattern_code} · weekends: {JSON.parse(p.weekend_days).join(', ')}</Text>
            </View>
            <Pressable disabled={busy} onPress={() => toggleActive(p.working_pattern_id, p.is_active)}>
              <Text style={StyleSheet.flatten([styles.statusTag, p.is_active ? styles.activeTag : styles.inactiveTag])}>{p.is_active ? 'Active' : 'Inactive'}</Text>
            </Pressable>
          </View>
        ))
      )}
    </Screen>
  );
}

function AssignmentsPanel({ colors }: { colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: assignments, loading, error, refreshing, refresh, reload } = useApi(workingPatterns.listWorkingPatternAssignments);
  const { data: patterns } = useApi(() => workingPatterns.listWorkingPatterns(false));
  const [showCreate, setShowCreate] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [patternId, setPatternId] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!employee || !patternId || !effectiveFrom) return;
    setBusy(true);
    try {
      await workingPatterns.assignWorkingPattern(employee.employee_id, patternId, effectiveFrom);
      setShowCreate(false);
      setEmployee(null);
      setPatternId(null);
      setEffectiveFrom('');
      await reload();
    } catch (err) {
      Alert.alert('Could not assign pattern', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.toggleButton} onPress={() => setShowCreate((s) => !s)}>
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ New Assignment'}</Text>
      </Pressable>
      {showCreate && (
        <View style={styles.formCard}>
          <EmployeePicker label="Employee" value={employee} onSelect={setEmployee} />
          <Text style={styles.label}>Pattern</Text>
          <View style={styles.chipRow}>
            {patterns?.map((p) => (
              <Pressable key={p.working_pattern_id} style={StyleSheet.flatten([styles.chip, patternId === p.working_pattern_id && styles.chipSelected])} onPress={() => setPatternId(p.working_pattern_id)}>
                <Text style={StyleSheet.flatten([styles.chipText, patternId === p.working_pattern_id && styles.chipTextSelected])}>{p.pattern_name}</Text>
              </Pressable>
            ))}
          </View>
          <DatePickerField label="Effective from" value={effectiveFrom} onChange={setEffectiveFrom} />
          <Pressable style={StyleSheet.flatten([styles.submitButton, (!employee || !patternId || !effectiveFrom) && styles.submitDisabled])} disabled={busy || !employee || !patternId || !effectiveFrom} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Assign</Text>}
          </Pressable>
        </View>
      )}
      {!assignments?.length ? (
        <EmptyState text="No pattern assignments." />
      ) : (
        assignments.map((a) => (
          <View key={a.assignment_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{a.employee_full_name} ({a.employee_code})</Text>
              <Text style={styles.span}>{a.pattern_name} · from {a.effective_from}{a.effective_to ? ` to ${a.effective_to}` : ''}</Text>
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    segmentRow: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 0 },
    segment: { flex: 1, borderRadius: 8, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, alignItems: 'center' },
    segmentActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    segmentText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
    segmentTextActive: { color: colors.accentContrast },
    toggleButton: { alignSelf: 'flex-start' },
    toggleText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
    formCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: 12, color: colors.textMuted },
    chipTextSelected: { color: colors.accentContrast },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text },
    span: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    statusTag: { fontSize: 11, fontWeight: '700' },
    activeTag: { color: colors.success },
    inactiveTag: { color: colors.textMuted },
  });
}
