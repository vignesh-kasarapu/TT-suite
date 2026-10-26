import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as selfApproval from '../../../api/selfApproval';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmployeePicker } from '../../../components/EmployeePicker';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee } from '../../../types/models';

/** "At most one active grant per employee" is a service-layer guard (MySQL
 * has no partial unique index to enforce it at the DB level) — the server
 * rejects a duplicate active grant, this screen doesn't try to pre-check it. */
export default function SelfApprovalAdmin() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(selfApproval.listSelfApprovalGrants);
  const [showCreate, setShowCreate] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const submit = async () => {
    if (!employee || !fromDate) return;
    setBusy(true);
    try {
      await selfApproval.grantSelfApproval(employee.employee_id, fromDate, toDate || null, notes.trim() || undefined);
      setShowCreate(false);
      setEmployee(null);
      setFromDate('');
      setToDate('');
      setNotes('');
      await reload();
    } catch (err) {
      Alert.alert('Could not grant self-approval', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (grantId: number) => {
    setBusy(true);
    try {
      await selfApproval.revokeSelfApproval(grantId);
      await reload();
    } catch (err) {
      Alert.alert('Could not revoke', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.toggleButton} onPress={() => setShowCreate((s) => !s)}>
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ Grant Self-Approval'}</Text>
      </Pressable>

      {showCreate && (
        <View style={styles.formCard}>
          <EmployeePicker label="Employee" value={employee} onSelect={setEmployee} />
          <DatePickerField label="Effective from" value={fromDate} onChange={setFromDate} />
          <DatePickerField label="Effective to (optional)" value={toDate} onChange={setToDate} />
          <Pressable style={StyleSheet.flatten([styles.submitButton, (!employee || !fromDate) && styles.submitDisabled])} disabled={busy || !employee || !fromDate} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Grant</Text>}
          </Pressable>
        </View>
      )}

      {!data?.length ? (
        <EmptyState text="No self-approval grants." />
      ) : (
        data.map((grant) => (
          <View key={grant.self_approval_permission_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>Employee #{grant.employee_id}</Text>
              <Text style={styles.span}>{grant.effective_from} → {grant.effective_to ?? 'open-ended'}</Text>
              {grant.notes && <Text style={styles.notes}>{grant.notes}</Text>}
            </View>
            <View style={styles.rowRight}>
              <Text style={StyleSheet.flatten([styles.statusTag, grant.is_active ? styles.activeTag : styles.inactiveTag])}>
                {grant.is_active ? 'Active' : 'Inactive'}
              </Text>
              {grant.is_active && (
                <Pressable disabled={busy} onPress={() => revoke(grant.self_approval_permission_id)}>
                  <Text style={styles.revokeText}>Revoke</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    toggleButton: { alignSelf: 'flex-start' },
    toggleText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
    formCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    row: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text },
    span: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    notes: { color: colors.textMuted, fontSize: 12, marginTop: 2, fontStyle: 'italic' },
    rowRight: { alignItems: 'flex-end', gap: 6 },
    statusTag: { fontSize: 11, fontWeight: '700' },
    activeTag: { color: colors.success },
    inactiveTag: { color: colors.textMuted },
    revokeText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  });
}
