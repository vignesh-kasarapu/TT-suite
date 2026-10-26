import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as ledgerAdmin from '../../../api/ledgerAdmin';
import { EmployeePicker } from '../../../components/EmployeePicker';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee } from '../../../types/models';

type Segment = 'browse' | 'adjust';

/** Org-wide ledger (paginated server-side) + the balance-adjustment write
 * path, grouped on one screen since an adjustment is meaningless without
 * seeing the ledger it affects — same as the web's "pick employee -> view
 * ledger -> adjust" flow, just as two segments instead of one long page. */
export default function LedgerAdmin() {
  const [segment, setSegment] = useState<Segment>('browse');
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.flex}>
      <View style={styles.segmentRow}>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'browse' && styles.segmentActive])} onPress={() => setSegment('browse')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'browse' && styles.segmentTextActive])}>Browse</Text>
        </Pressable>
        <Pressable style={StyleSheet.flatten([styles.segment, segment === 'adjust' && styles.segmentActive])} onPress={() => setSegment('adjust')}>
          <Text style={StyleSheet.flatten([styles.segmentText, segment === 'adjust' && styles.segmentTextActive])}>Adjust Balance</Text>
        </Pressable>
      </View>
      {segment === 'browse' ? <BrowsePanel colors={colors} /> : <AdjustPanel colors={colors} />}
    </View>
  );
}

function BrowsePanel({ colors }: { colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [page, setPage] = useState(1);
  const { data, loading, error, refreshing, refresh, reload } = useApi(() => ledgerAdmin.listAllLedgerEntries({ page, page_size: 30 }), [page]);

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {!data?.length ? (
        <EmptyState text="No ledger entries." />
      ) : (
        data.map((entry) => (
          <View key={entry.entry_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{entry.employee_name} ({entry.employee_code})</Text>
              <Text style={styles.meta}>{entry.leave_type_name} · {entry.entry_type.replace(/_/g, ' ')}</Text>
              <Text style={styles.date}>{new Date(entry.created_at).toLocaleDateString()}</Text>
            </View>
            <Text style={StyleSheet.flatten([styles.quantity, entry.quantity < 0 ? styles.negative : styles.positive])}>
              {entry.quantity > 0 ? '+' : ''}{entry.quantity}
            </Text>
          </View>
        ))
      )}
      <View style={styles.pageRow}>
        <Pressable disabled={page <= 1} onPress={() => setPage((p) => Math.max(1, p - 1))}>
          <Text style={StyleSheet.flatten([styles.pageText, page <= 1 && styles.pageDisabled])}>‹ Prev</Text>
        </Pressable>
        <Text style={styles.pageNumber}>Page {page}</Text>
        <Pressable disabled={(data?.length ?? 0) < 30} onPress={() => setPage((p) => p + 1)}>
          <Text style={StyleSheet.flatten([styles.pageText, (data?.length ?? 0) < 30 && styles.pageDisabled])}>Next ›</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

function AdjustPanel({ colors }: { colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [leaveYearId, setLeaveYearId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsedType = parseInt(leaveTypeId, 10);
    const parsedYear = parseInt(leaveYearId, 10);
    const parsedQty = parseFloat(quantity);
    if (!employee || !parsedType || !parsedYear || !parsedQty || !reason.trim()) return;
    setBusy(true);
    try {
      await ledgerAdmin.adjustBalance(employee.employee_id, parsedType, parsedYear, parsedQty, reason.trim());
      Alert.alert('Adjusted', `Balance adjustment posted for ${employee.full_name}.`);
      setEmployee(null);
      setLeaveTypeId('');
      setLeaveYearId('');
      setQuantity('');
      setReason('');
      setConfirming(false);
    } catch (err) {
      Alert.alert('Could not adjust balance', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = employee && leaveTypeId && leaveYearId && quantity && reason.trim();

  return (
    <View style={styles.formCard}>
      <EmployeePicker label="Employee" value={employee} onSelect={(e) => { setEmployee(e); setConfirming(false); }} />
      <Text style={styles.label}>Leave type ID</Text>
      <TextInput style={styles.input} value={leaveTypeId} onChangeText={(v) => { setLeaveTypeId(v); setConfirming(false); }} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Leave year ID</Text>
      <TextInput style={styles.input} value={leaveYearId} onChangeText={(v) => { setLeaveYearId(v); setConfirming(false); }} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Quantity (signed — negative deducts)</Text>
      <TextInput style={styles.input} value={quantity} onChangeText={(v) => { setQuantity(v); setConfirming(false); }} keyboardType="numbers-and-punctuation" placeholderTextColor={colors.textMuted} />
      <Text style={styles.label}>Reason (required, mandatory audit trail)</Text>
      <TextInput style={styles.input} value={reason} onChangeText={(v) => { setReason(v); setConfirming(false); }} placeholderTextColor={colors.textMuted} multiline />

      {!confirming ? (
        <Pressable style={StyleSheet.flatten([styles.submitButton, !canSubmit && styles.submitDisabled])} disabled={!canSubmit} onPress={() => setConfirming(true)}>
          <Text style={styles.submitText}>Review Adjustment</Text>
        </Pressable>
      ) : (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            Confirm: {quantity.startsWith('-') ? '' : '+'}{quantity} days for {employee?.full_name}, leave type #{leaveTypeId}.
          </Text>
          <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Confirm & Post</Text>}
          </Pressable>
        </View>
      )}
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
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text, fontSize: 13 },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    date: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    quantity: { fontWeight: '700', fontSize: 14 },
    positive: { color: colors.success },
    negative: { color: colors.danger },
    pageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
    pageText: { color: colors.accent, fontWeight: '600' },
    pageDisabled: { color: colors.textMuted, opacity: 0.5 },
    pageNumber: { color: colors.textMuted, fontSize: 12 },
    formCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 16, margin: 16, borderWidth: 1, borderColor: colors.border, gap: 8 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    confirmBox: { backgroundColor: colors.warningBg, borderRadius: 8, padding: 10, gap: 8 },
    confirmText: { color: colors.warning, fontSize: 13 },
  });
}
