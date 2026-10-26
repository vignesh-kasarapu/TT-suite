import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as leaveTypesAdmin from '../../../api/leaveTypesAdmin';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

const ACCRUAL_METHODS = ['MONTHLY', 'QUARTERLY', 'ANNUAL'] as const;

/** LMS-025: is_system/is_selectable_by_employee are never settable through
 * the create path (structurally enforced server-side — a caller can never
 * mint a second LOP type), so this form only exposes what the backend
 * actually accepts. */
export default function LeaveTypesAdmin() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(leaveTypesAdmin.listLeaveTypes);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const quickToggle = async (leaveTypeId: number, currentlySelectable: boolean) => {
    setTogglingId(leaveTypeId);
    try {
      await leaveTypesAdmin.updateLeaveTypePolicy(leaveTypeId, { is_selectable_by_employee: !currentlySelectable });
      await reload();
    } catch (err) {
      Alert.alert('Could not update', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.toggleButton} onPress={() => setShowCreate((s) => !s)}>
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ New Leave Type'}</Text>
      </Pressable>

      {showCreate && <CreateForm onDone={() => { setShowCreate(false); reload(); }} colors={colors} />}

      {!data?.length ? (
        <EmptyState text="No leave types yet." />
      ) : (
        data.map((row) => (
          <View key={row.leave_type.leave_type_id} style={styles.card}>
            <Pressable style={styles.header} onPress={() => setEditingId(editingId === row.leave_type.leave_type_id ? null : row.leave_type.leave_type_id)}>
              <View style={styles.headerMain}>
                <Text style={styles.name}>{row.leave_type.type_name}</Text>
                <Text style={styles.code}>{row.leave_type.type_code}{row.leave_type.is_system ? ' · system' : ''}</Text>
              </View>
              <Text style={styles.entitlement}>{row.policy?.annual_entitlement ?? '–'} days/yr</Text>
            </Pressable>
            {!row.leave_type.is_system && (
              <Pressable
                style={styles.quickToggleRow}
                disabled={togglingId === row.leave_type.leave_type_id}
                onPress={() => quickToggle(row.leave_type.leave_type_id, row.leave_type.is_selectable_by_employee)}
              >
                {togglingId === row.leave_type.leave_type_id ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={StyleSheet.flatten([styles.quickToggleText, row.leave_type.is_selectable_by_employee ? styles.enabledText : styles.disabledText])}>
                    {row.leave_type.is_selectable_by_employee ? 'Enabled · tap to disable' : 'Disabled · tap to enable'}
                  </Text>
                )}
              </Pressable>
            )}
            {editingId === row.leave_type.leave_type_id && (
              <PolicyEditForm
                leaveTypeId={row.leave_type.leave_type_id}
                policy={row.policy}
                isSelectableByEmployee={row.leave_type.is_selectable_by_employee}
                isSystem={row.leave_type.is_system}
                onDone={() => { setEditingId(null); reload(); }}
                colors={colors}
              />
            )}
          </View>
        ))
      )}
    </Screen>
  );
}

function CreateForm({ onDone, colors }: { onDone: () => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [typeCode, setTypeCode] = useState('');
  const [typeName, setTypeName] = useState('');
  const [entitlement, setEntitlement] = useState('');
  const [accrualMethod, setAccrualMethod] = useState<(typeof ACCRUAL_METHODS)[number]>('MONTHLY');
  const [isSickLeave, setIsSickLeave] = useState(false);
  const [permitsHalfDay, setPermitsHalfDay] = useState(true);
  const [permitsAttachments, setPermitsAttachments] = useState(false);
  const [carriesForward, setCarriesForward] = useState(false);
  const [carryForwardCap, setCarryForwardCap] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsedEntitlement = parseFloat(entitlement);
    if (!typeCode.trim() || !typeName.trim() || !parsedEntitlement) return;
    setBusy(true);
    try {
      await leaveTypesAdmin.createLeaveType({
        type_code: typeCode.trim().toUpperCase(),
        type_name: typeName.trim(),
        is_sick_leave: isSickLeave,
        permits_half_day: permitsHalfDay,
        permits_attachments: permitsAttachments,
        annual_entitlement: parsedEntitlement,
        carries_forward: carriesForward,
        carry_forward_cap: carriesForward && carryForwardCap ? parseFloat(carryForwardCap) : null,
        accrual_method: accrualMethod,
      });
      onDone();
    } catch (err) {
      Alert.alert('Could not create leave type', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <TextInput style={styles.input} placeholder="Type code (e.g. SABBATICAL)" placeholderTextColor={colors.textMuted} value={typeCode} onChangeText={setTypeCode} autoCapitalize="characters" />
      <TextInput style={styles.input} placeholder="Type name" placeholderTextColor={colors.textMuted} value={typeName} onChangeText={setTypeName} />
      <TextInput style={styles.input} placeholder="Annual entitlement (days)" placeholderTextColor={colors.textMuted} value={entitlement} onChangeText={setEntitlement} keyboardType="decimal-pad" />

      <Text style={styles.label}>Accrual method</Text>
      <View style={styles.chipRow}>
        {ACCRUAL_METHODS.map((m) => (
          <Pressable key={m} style={StyleSheet.flatten([styles.chip, accrualMethod === m && styles.chipSelected])} onPress={() => setAccrualMethod(m)}>
            <Text style={StyleSheet.flatten([styles.chipText, accrualMethod === m && styles.chipTextSelected])}>{m}</Text>
          </Pressable>
        ))}
      </View>

      <SwitchRow label="Sick leave" value={isSickLeave} onChange={setIsSickLeave} colors={colors} />
      <SwitchRow label="Permits half-day" value={permitsHalfDay} onChange={setPermitsHalfDay} colors={colors} />
      <SwitchRow label="Permits attachments" value={permitsAttachments} onChange={setPermitsAttachments} colors={colors} />
      <SwitchRow label="Carries forward" value={carriesForward} onChange={setCarriesForward} colors={colors} />
      {carriesForward && (
        <TextInput style={styles.input} placeholder="Carry-forward cap (days)" placeholderTextColor={colors.textMuted} value={carryForwardCap} onChangeText={setCarryForwardCap} keyboardType="decimal-pad" />
      )}

      <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Create Leave Type</Text>}
      </Pressable>
    </View>
  );
}

function PolicyEditForm({
  leaveTypeId,
  policy,
  isSelectableByEmployee,
  isSystem,
  onDone,
  colors,
}: {
  leaveTypeId: number;
  policy: { annual_entitlement: number; carries_forward: boolean; carry_forward_cap: number | null } | null;
  isSelectableByEmployee: boolean;
  isSystem: boolean;
  onDone: () => void;
  colors: Palette;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entitlement, setEntitlement] = useState(String(policy?.annual_entitlement ?? ''));
  const [carriesForward, setCarriesForward] = useState(policy?.carries_forward ?? false);
  const [carryForwardCap, setCarryForwardCap] = useState(policy?.carry_forward_cap != null ? String(policy.carry_forward_cap) : '');
  const [selectable, setSelectable] = useState(isSelectableByEmployee);
  const [busy, setBusy] = useState(false);

  if (isSystem) {
    return (
      <View style={styles.formCard}>
        <Text style={styles.lockedNote}>LMS-025: system leave types (e.g. LOP) have their policy locked and cannot be edited or disabled.</Text>
      </View>
    );
  }

  const submit = async () => {
    setBusy(true);
    try {
      await leaveTypesAdmin.updateLeaveTypePolicy(leaveTypeId, {
        annual_entitlement: parseFloat(entitlement) || undefined,
        carries_forward: carriesForward,
        carry_forward_cap: carriesForward && carryForwardCap ? parseFloat(carryForwardCap) : null,
        is_selectable_by_employee: selectable,
      });
      onDone();
    } catch (err) {
      Alert.alert('Could not update policy', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <Text style={styles.label}>Annual entitlement</Text>
      <TextInput style={styles.input} value={entitlement} onChangeText={setEntitlement} keyboardType="decimal-pad" placeholderTextColor={colors.textMuted} />
      <SwitchRow label="Carries forward" value={carriesForward} onChange={setCarriesForward} colors={colors} />
      {carriesForward && (
        <TextInput style={styles.input} placeholder="Carry-forward cap (days)" placeholderTextColor={colors.textMuted} value={carryForwardCap} onChangeText={setCarryForwardCap} keyboardType="decimal-pad" />
      )}
      <SwitchRow label="Enabled for employees" value={selectable} onChange={setSelectable} colors={colors} />
      <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Save Policy</Text>}
      </Pressable>
    </View>
  );
}

function SwitchRow({ label, value, onChange, colors }: { label: string; value: boolean; onChange: (v: boolean) => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.switchRow}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.surface} />
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    toggleButton: { alignSelf: 'flex-start' },
    toggleText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
    formCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
    headerMain: { flex: 1 },
    name: { fontWeight: '700', color: colors.text },
    code: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    entitlement: { color: colors.accentText, fontSize: 12, fontWeight: '600' },
    quickToggleRow: { paddingHorizontal: 12, paddingBottom: 10 },
    quickToggleText: { fontSize: 11, fontWeight: '600' },
    enabledText: { color: colors.success },
    disabledText: { color: colors.danger },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    chipRow: { flexDirection: 'row', gap: 6 },
    chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: 12, color: colors.textMuted },
    chipTextSelected: { color: colors.accentContrast },
    switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    lockedNote: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', padding: 12 },
  });
}
