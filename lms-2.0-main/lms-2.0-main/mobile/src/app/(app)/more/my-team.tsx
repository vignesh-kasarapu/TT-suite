import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as employees from '../../../api/employees';
import * as holidays from '../../../api/holidays';
import * as r3 from '../../../api/r3';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee, TeamBalanceRow } from '../../../types/models';

type ActionPanel = 'watcher' | 'compoff' | 'holiday' | null;

/** BR-39: Manager sees every report at any depth. Standing Watcher / Comp-off
 * / Optional Holiday are the same three "act on behalf of a team member"
 * controls the web MyTeam page bundles inline per row — here each opens as
 * an expandable panel under that row instead of a popover, since a phone has
 * no room for three simultaneous inline forms per row. */
export default function MyTeam() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(employees.getMyTeam);
  const { data: candidates } = useApi(employees.getWatchableEmployees);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [panel, setPanel] = useState<ActionPanel>(null);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const toggle = (employeeId: number) => {
    if (expandedId === employeeId) {
      setExpandedId(null);
      setPanel(null);
    } else {
      setExpandedId(employeeId);
      setPanel(null);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {!data?.length ? (
        <EmptyState text="No one reports to you yet." />
      ) : (
        data.map((row) => (
          <View key={row.employee.employee_id} style={styles.card}>
            <Pressable style={styles.header} onPress={() => toggle(row.employee.employee_id)}>
              <Text style={styles.name}>{row.employee.full_name}</Text>
              <Text style={styles.chevron}>{expandedId === row.employee.employee_id ? '︿' : '﹀'}</Text>
            </Pressable>
            <View style={styles.balanceRow}>
              {row.balances.map((b) => (
                <View key={b.leaveType} style={styles.balancePill}>
                  <Text style={styles.balancePillText}>{b.leaveType}: {b.effectiveBalance}</Text>
                </View>
              ))}
            </View>

            {expandedId === row.employee.employee_id && (
              <View style={styles.actionsBox}>
                <View style={styles.actionTabs}>
                  <ActionTab label="Watcher" active={panel === 'watcher'} onPress={() => setPanel('watcher')} colors={colors} />
                  <ActionTab label="Comp-off" active={panel === 'compoff'} onPress={() => setPanel('compoff')} colors={colors} />
                  <ActionTab label="Holidays" active={panel === 'holiday'} onPress={() => setPanel('holiday')} colors={colors} />
                </View>
                {panel === 'watcher' && <WatcherPanel employee={row.employee} candidates={candidates ?? []} colors={colors} />}
                {panel === 'compoff' && <CompOffPanel employee={row.employee} colors={colors} />}
                {panel === 'holiday' && <OptionalHolidayPanel employee={row.employee} colors={colors} />}
              </View>
            )}
          </View>
        ))
      )}
    </Screen>
  );
}

function ActionTab({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable style={StyleSheet.flatten([styles.tab, active && styles.tabActive])} onPress={onPress}>
      <Text style={StyleSheet.flatten([styles.tabText, active && styles.tabTextActive])}>{label}</Text>
    </Pressable>
  );
}

function WatcherPanel({ employee, candidates, colors }: { employee: Employee; candidates: Employee[]; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [watcherId, setWatcherId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!watcherId || !fromDate || !toDate) return;
    setBusy(true);
    try {
      await employees.addStandingWatcher(employee.employee_id, watcherId, fromDate, toDate);
      Alert.alert('Added', `Standing watcher assigned for ${employee.full_name}.`);
      setWatcherId(null);
      setFromDate('');
      setToDate('');
    } catch (err) {
      Alert.alert('Could not add watcher', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>Choose a watcher</Text>
      <View style={styles.chipRow}>
        {candidates
          .filter((c) => c.employee_id !== employee.employee_id)
          .map((c) => (
            <Pressable key={c.employee_id} style={StyleSheet.flatten([styles.chip, watcherId === c.employee_id && styles.chipSelected])} onPress={() => setWatcherId(c.employee_id)}>
              <Text style={StyleSheet.flatten([styles.chipText, watcherId === c.employee_id && styles.chipTextSelected])}>{c.full_name}</Text>
            </Pressable>
          ))}
      </View>
      <DatePickerField label="From" value={fromDate} onChange={setFromDate} />
      <DatePickerField label="To" value={toDate} onChange={setToDate} />
      <Pressable style={StyleSheet.flatten([styles.submitButton, (!watcherId || !fromDate || !toDate) && styles.submitDisabled])} disabled={busy || !watcherId || !fromDate || !toDate} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Add Watcher</Text>}
      </Pressable>
    </View>
  );
}

function CompOffPanel({ employee, colors }: { employee: Employee; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [workDate, setWorkDate] = useState('');
  const [days, setDays] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parseFloat(days);
    if (!workDate || !parsed) return;
    setBusy(true);
    try {
      await r3.creditCompOff(employee.employee_id, workDate, parsed, notes.trim() || undefined);
      Alert.alert('Credited', `Comp-off credited to ${employee.full_name}.`);
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
    <View style={styles.panel}>
      <DatePickerField label="Work date" value={workDate} onChange={setWorkDate} />
      <Text style={styles.panelLabel}>Days</Text>
      <TextInput style={styles.input} value={days} onChangeText={setDays} keyboardType="decimal-pad" placeholder="1" placeholderTextColor={colors.textMuted} />
      <Text style={styles.panelLabel}>Notes (optional)</Text>
      <TextInput style={styles.input} value={notes} onChangeText={setNotes} placeholderTextColor={colors.textMuted} />
      <Pressable style={StyleSheet.flatten([styles.submitButton, (!workDate || !days) && styles.submitDisabled])} disabled={busy || !workDate || !days} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Credit Comp-off</Text>}
      </Pressable>
    </View>
  );
}

function OptionalHolidayPanel({ employee, colors }: { employee: Employee; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: summary, reload } = useApi(() => holidays.getOptionalSummaryFor(employee.employee_id), [employee.employee_id]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const toggle = async (holidayId: number, isSelected: boolean) => {
    setBusyId(holidayId);
    try {
      if (isSelected) await holidays.unassignOptionalHoliday(holidayId, employee.employee_id);
      else await holidays.assignOptionalHoliday(holidayId, employee.employee_id);
      await reload();
    } catch (err) {
      Alert.alert('Could not update', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  if (!summary) return <ActivityIndicator color={colors.accent} style={styles.panel} />;

  return (
    <View style={styles.panel}>
      <Text style={styles.panelLabel}>{summary.taken} of {summary.quota} taken · {summary.remaining} remaining</Text>
      {summary.eligibleHolidays.map((h) => (
        <Pressable key={h.holidayId} style={styles.holidayRow} disabled={busyId === h.holidayId} onPress={() => toggle(h.holidayId, h.isSelected)}>
          <Text style={styles.holidayName}>{h.holidayName}</Text>
          {busyId === h.holidayId ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={StyleSheet.flatten([styles.holidayToggle, h.isSelected && styles.holidaySelected])}>{h.isSelected ? 'Selected' : 'Select'}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    name: { fontWeight: '700', color: colors.text },
    chevron: { color: colors.textMuted },
    balanceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    balancePill: { backgroundColor: colors.tint2, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    balancePillText: { color: colors.accentText, fontSize: 11, fontWeight: '600' },
    actionsBox: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 4, gap: 8 },
    actionTabs: { flexDirection: 'row', gap: 8 },
    tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
    tabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    tabTextActive: { color: colors.accentContrast },
    panel: { gap: 8 },
    panelLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: 12, color: colors.textMuted },
    chipTextSelected: { color: colors.accentContrast },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, backgroundColor: colors.bg, color: colors.text },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    holidayRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
    holidayName: { fontSize: 13, color: colors.text },
    holidayToggle: { fontSize: 12, color: colors.accent, fontWeight: '600' },
    holidaySelected: { color: colors.success },
  });
}
