import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as employees from '../../../api/employees';
import * as holidaysAdmin from '../../../api/holidaysAdmin';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

/** LMS-028/7.3.15 — HR sees the same overlap warning the web app shows
 * (affectedRequestIds), just as an alert instead of an inline banner. */
export default function HolidayAdmin() {
  const { data: dashboard } = useApi(employees.getDashboard);
  const leaveYearId = dashboard?.leaveYear.leave_year_id;
  const { data, loading, error, refreshing, refresh, reload } = useApi(() => (leaveYearId ? holidaysAdmin.listHolidaysForYear(leaveYearId) : Promise.resolve([])), [leaveYearId]);
  const { data: usage } = useApi(() => (leaveYearId ? holidaysAdmin.getOptionalUsage(leaveYearId) : Promise.resolve(null)), [leaveYearId]);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [isOptional, setIsOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const submit = async () => {
    if (!name.trim() || !date || !leaveYearId) return;
    setBusy(true);
    try {
      const result = await holidaysAdmin.addHoliday({ holiday_date: date, holiday_name: name.trim(), leave_year_id: leaveYearId, is_optional: isOptional });
      setShowCreate(false);
      setName('');
      setDate('');
      setIsOptional(false);
      if (result.affectedRequestIds.length > 0) {
        Alert.alert('Holiday added', `Note: ${result.affectedRequestIds.length} approved request(s) overlap this date.`);
      }
      await reload();
    } catch (err) {
      Alert.alert('Could not add holiday', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (holidayId: number) => {
    Alert.alert('Remove holiday?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await holidaysAdmin.removeHoliday(holidayId);
            await reload();
          } catch (err) {
            Alert.alert('Could not remove', err instanceof ApiError ? err.message : 'Something went wrong.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.toggleButton} onPress={() => setShowCreate((s) => !s)}>
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ Add Holiday'}</Text>
      </Pressable>
      {showCreate && (
        <View style={styles.formCard}>
          <TextInput style={styles.input} placeholder="Holiday name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
          <DatePickerField label="Date" value={date} onChange={setDate} />
          <View style={styles.switchRow}>
            <Text style={styles.label}>Optional holiday</Text>
            <Switch value={isOptional} onValueChange={setIsOptional} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.surface} />
          </View>
          <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Add Holiday</Text>}
          </Pressable>
        </View>
      )}

      {!data?.length ? (
        <EmptyState text="No holidays for this leave year." />
      ) : (
        data.map((h) => (
          <View key={h.holiday_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{h.holiday_name}{h.is_optional ? ' (optional)' : ''}</Text>
              <Text style={styles.span}>{h.holiday_date}</Text>
            </View>
            <Pressable disabled={busy} onPress={() => remove(h.holiday_id)}>
              <Text style={styles.deleteText}>Remove</Text>
            </Pressable>
          </View>
        ))
      )}

      {usage && usage.employees.length > 0 && (
        <View style={styles.usageSection}>
          <Text style={styles.sectionTitle}>Optional holiday usage (quota: {usage.quota})</Text>
          {usage.employees.map((row) => (
            <View key={row.employeeId} style={styles.usageRow}>
              <Text style={styles.usageName}>{row.fullName} ({row.employeeCode})</Text>
              <Text style={styles.usageStat}>{row.taken} taken · {row.remaining} left</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    toggleButton: { alignSelf: 'flex-start' },
    toggleText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
    formCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text },
    span: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    deleteText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
    usageSection: { marginTop: 12, gap: 6 },
    sectionTitle: { fontWeight: '700', color: colors.text, fontSize: 13 },
    usageRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: colors.border },
    usageName: { color: colors.text, fontSize: 12 },
    usageStat: { color: colors.textMuted, fontSize: 12 },
  });
}
