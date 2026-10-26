import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import * as blackoutCapacity from '../../../api/blackoutCapacity';
import { ApiError } from '../../../api/client';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmployeePicker } from '../../../components/EmployeePicker';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee } from '../../../types/models';

type Segment = 'blackout' | 'capacity';

/** LMS-085/086. Two independent panels, same as the web's Blackout & Capacity
 * admin section — a segmented switch instead of two side-by-side panels,
 * since a phone screen can't show both at once. */
export default function BlackoutCapacityAdmin() {
  const [segment, setSegment] = useState<Segment>('blackout');
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.flex}>
      <View style={styles.segmentRow}>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'blackout' && styles.segmentActive])} onPress={() => setSegment('blackout')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'blackout' && styles.segmentTextActive])}>Blackout Periods</Text>
        </Pressable>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'capacity' && styles.segmentActive])} onPress={() => setSegment('capacity')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'capacity' && styles.segmentTextActive])}>Team Capacity</Text>
        </Pressable>
      </View>
      {segment === 'blackout' ? <BlackoutPanel colors={colors} /> : <CapacityPanel colors={colors} />}
    </View>
  );
}

function BlackoutPanel({ colors }: { colors: Palette }) {
  const { data, loading, error, refreshing, refresh, reload } = useApi(() => blackoutCapacity.listBlackoutPeriods());
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const submit = async () => {
    if (!name.trim() || !startDate || !endDate) return;
    setBusy(true);
    try {
      await blackoutCapacity.createBlackoutPeriod(name.trim(), startDate, endDate);
      setShowCreate(false);
      setName('');
      setStartDate('');
      setEndDate('');
      await reload();
    } catch (err) {
      Alert.alert('Could not create blackout period', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (blackoutId: number, isActive: boolean) => {
    setBusy(true);
    try {
      await blackoutCapacity.setBlackoutActive(blackoutId, !isActive);
      await reload();
    } catch (err) {
      Alert.alert('Could not update', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const remove = (blackoutId: number) => {
    Alert.alert('Delete blackout period?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await blackoutCapacity.removeBlackoutPeriod(blackoutId);
            await reload();
          } catch (err) {
            Alert.alert('Could not delete', err instanceof ApiError ? err.message : 'Something went wrong.');
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
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ New Blackout Period'}</Text>
      </Pressable>
      {showCreate && (
        <View style={styles.formCard}>
          <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
          <DatePickerField label="Start date" value={startDate} onChange={setStartDate} />
          <DatePickerField label="End date" value={endDate} onChange={setEndDate} />
          <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Create</Text>}
          </Pressable>
        </View>
      )}
      {!data?.length ? (
        <EmptyState text="No blackout periods." />
      ) : (
        data.map((b) => (
          <View key={b.blackout_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{b.name}</Text>
              <Text style={styles.span}>{b.start_date} → {b.end_date}</Text>
            </View>
            <View style={styles.rowRight}>
              <Pressable disabled={busy} onPress={() => toggleActive(b.blackout_id, b.is_active)}>
                <Text style={StyleSheet.flatten([styles.statusTag, b.is_active ? styles.activeTag : styles.inactiveTag])}>{b.is_active ? 'Active' : 'Inactive'}</Text>
              </Pressable>
              <Pressable disabled={busy} onPress={() => remove(b.blackout_id)}>
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

function CapacityPanel({ colors }: { colors: Palette }) {
  const { data, loading, error, refreshing, refresh, reload } = useApi(blackoutCapacity.listAllCapacityLimits);
  const [showCreate, setShowCreate] = useState(false);
  const [manager, setManager] = useState<Employee | null>(null);
  const [maxConcurrent, setMaxConcurrent] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const today = new Date().toISOString().slice(0, 10);

  const submit = async () => {
    const parsed = parseInt(maxConcurrent, 10);
    if (!manager || !parsed || !effectiveFrom) return;
    setBusy(true);
    try {
      await blackoutCapacity.createCapacityLimit(manager.employee_id, parsed, effectiveFrom);
      setShowCreate(false);
      setManager(null);
      setMaxConcurrent('');
      setEffectiveFrom('');
      await reload();
    } catch (err) {
      Alert.alert('Could not create capacity limit', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (capacityLimitId: number, isCurrentlyActive: boolean) => {
    setBusy(true);
    try {
      await blackoutCapacity.setCapacityLimitActive(capacityLimitId, !isCurrentlyActive);
      await reload();
    } catch (err) {
      Alert.alert('Could not update', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.toggleButton} onPress={() => setShowCreate((s) => !s)}>
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ New Capacity Limit'}</Text>
      </Pressable>
      {showCreate && (
        <View style={styles.formCard}>
          <EmployeePicker label="Manager" value={manager} onSelect={setManager} />
          <Text style={styles.label}>Max concurrent on leave</Text>
          <TextInput style={styles.input} value={maxConcurrent} onChangeText={setMaxConcurrent} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
          <DatePickerField label="Effective from" value={effectiveFrom} onChange={setEffectiveFrom} />
          <Pressable style={StyleSheet.flatten([styles.submitButton, (!manager || !maxConcurrent || !effectiveFrom) && styles.submitDisabled])} disabled={busy || !manager || !maxConcurrent || !effectiveFrom} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Create</Text>}
          </Pressable>
        </View>
      )}
      {!data?.length ? (
        <EmptyState text="No team capacity limits." />
      ) : (
        data.map((c) => {
          const isActive = !c.effective_to || c.effective_to >= today;
          return (
            <View key={c.capacity_limit_id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{c.manager_name ?? `Manager #${c.manager_employee_id}`}</Text>
                <Text style={styles.span}>Max {c.max_concurrent_on_leave} concurrent · from {c.effective_from}</Text>
              </View>
              <Pressable disabled={busy} onPress={() => toggleActive(c.capacity_limit_id, isActive)}>
                <Text style={StyleSheet.flatten([styles.statusTag, isActive ? styles.activeTag : styles.inactiveTag])}>{isActive ? 'Active' : 'Inactive'}</Text>
              </Pressable>
            </View>
          );
        })
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
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text },
    span: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rowRight: { alignItems: 'flex-end', gap: 6 },
    statusTag: { fontSize: 11, fontWeight: '700' },
    activeTag: { color: colors.success },
    inactiveTag: { color: colors.textMuted },
    deleteText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  });
}
