import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as encashment from '../../../api/encashment';
import * as r3 from '../../../api/r3';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmployeePicker } from '../../../components/EmployeePicker';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee } from '../../../types/models';

type Segment = 'encashment' | 'compoff';

/** LMS-084/083 — two independent HR-initiated forms, same grouping as the
 * web Administration page's "Encashment & Comp-off" section. Both are
 * write-only from this screen (no list view here — HR posts the action,
 * the employee sees the result on their own Balance/My Team-equivalent
 * view); a full audit list belongs to the Ledger/Audit Log admin screens,
 * not duplicated here. */
export default function EncashmentCompOffAdmin() {
  const [segment, setSegment] = useState<Segment>('encashment');
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.flex}>
      <View style={styles.segmentRow}>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'encashment' && styles.segmentActive])} onPress={() => setSegment('encashment')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'encashment' && styles.segmentTextActive])}>Encashment</Text>
        </Pressable>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'compoff' && styles.segmentActive])} onPress={() => setSegment('compoff')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'compoff' && styles.segmentTextActive])}>Comp-off</Text>
        </Pressable>
      </View>
      {segment === 'encashment' ? <EncashmentForm colors={colors} /> : <CompOffForm colors={colors} />}
    </View>
  );
}

function EncashmentForm({ colors }: { colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [leaveYearId, setLeaveYearId] = useState('');
  const [days, setDays] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsedType = parseInt(leaveTypeId, 10);
    const parsedYear = parseInt(leaveYearId, 10);
    const parsedDays = parseFloat(days);
    if (!employee || !parsedType || !parsedYear || !parsedDays) return;
    setBusy(true);
    try {
      await encashment.createEncashment(employee.employee_id, parsedType, parsedYear, parsedDays, notes.trim() || undefined);
      Alert.alert('Posted', `Encashment posted for ${employee.full_name}.`);
      setEmployee(null);
      setLeaveTypeId('');
      setLeaveYearId('');
      setDays('');
      setNotes('');
    } catch (err) {
      Alert.alert('Could not post encashment', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <EmployeePicker label="Employee" value={employee} onSelect={setEmployee} />
      <Text style={styles.label}>Leave type ID</Text>
      <TextInput style={styles.input} value={leaveTypeId} onChangeText={setLeaveTypeId} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Leave year ID</Text>
      <TextInput style={styles.input} value={leaveYearId} onChangeText={setLeaveYearId} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Days encashed</Text>
      <TextInput style={styles.input} value={days} onChangeText={setDays} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholderTextColor={colors.textMuted} />
      <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Post Encashment</Text>}
      </Pressable>
    </View>
  );
}

function CompOffForm({ colors }: { colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [workDate, setWorkDate] = useState('');
  const [days, setDays] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parseFloat(days);
    if (!employee || !workDate || !parsed) return;
    setBusy(true);
    try {
      await r3.creditCompOff(employee.employee_id, workDate, parsed, notes.trim() || undefined);
      Alert.alert('Credited', `Comp-off credited to ${employee.full_name}.`);
      setEmployee(null);
      setWorkDate('');
      setDays('');
      setNotes('');
    } catch (err) {
      Alert.alert('Could not credit comp-off', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <EmployeePicker label="Employee" value={employee} onSelect={setEmployee} />
      <DatePickerField label="Work date" value={workDate} onChange={setWorkDate} />
      <Text style={styles.label}>Days</Text>
      <TextInput style={styles.input} value={days} onChangeText={setDays} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Notes (optional)</Text>
      <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholderTextColor={colors.textMuted} />
      <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Credit Comp-off</Text>}
      </Pressable>
    </View>
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
    formCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, margin: 16, borderWidth: 1, borderColor: colors.border, gap: 8 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
  });
}
