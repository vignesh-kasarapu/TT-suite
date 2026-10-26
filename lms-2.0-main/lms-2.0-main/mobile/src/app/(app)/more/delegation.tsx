import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as delegations from '../../../api/delegations';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

/** LMS-041/042: peer-manager-or-supervisor-fallback eligibility, one active
 * delegation per nominator (DELEGATION_OVERLAP guard is server-enforced, no
 * client-side tie-break needed). Manager self-service only — the HR-wide
 * "set delegation for any manager" admin view belongs to Phase D. */
export default function Delegation() {
  const { data: eligible, loading: loadingEligible, error: eligibleError } = useApi(delegations.getEligibleDelegates);
  const { data: mine, loading, error, refreshing, refresh, reload } = useApi(delegations.getMyDelegations);
  // Delegation nomination is MANAGER-only server-side (not HR_ADMIN) — an
  // HR_ADMIN-only account (e.g. this app's dev-bypass identity) reaches this
  // screen via the "More" menu's isApprover check but gets a real 403 here.
  // Surface that plainly instead of silently rendering an empty candidate list.
  const combinedError = error ?? eligibleError;
  const [delegateId, setDelegateId] = useState<number | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [busy, setBusy] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const active = mine?.find((d) => !d.revoked_at) ?? null;

  const nominate = async () => {
    if (!delegateId || !fromDate || !toDate) return;
    setBusy(true);
    try {
      await delegations.nominateDelegate(delegateId, fromDate, toDate);
      setDelegateId(null);
      setFromDate('');
      setToDate('');
      await reload();
    } catch (err) {
      Alert.alert('Could not nominate delegate', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (delegationId: number) => {
    setBusy(true);
    try {
      await delegations.revokeDelegation(delegationId);
      await reload();
    } catch (err) {
      Alert.alert('Could not revoke', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen loading={loading || loadingEligible} error={combinedError} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {active ? (
        <View style={styles.activeCard}>
          <Text style={styles.activeTitle}>Active delegation</Text>
          <Text style={styles.activeText}>{active.delegate_name ?? `Employee #${active.delegate_id}`}</Text>
          <Text style={styles.activeSpan}>{active.from_date} → {active.to_date}</Text>
          <Pressable style={styles.revokeButton} disabled={busy} onPress={() => revoke(active.delegation_id)}>
            {busy ? <ActivityIndicator color={colors.dangerContrast} /> : <Text style={styles.revokeText}>Revoke</Text>}
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.sectionTitle}>Nominate a delegate</Text>
          {eligible?.fallbackUsed && (
            <Text style={styles.fallbackNote}>No peer managers found — showing your own supervisor chain instead.</Text>
          )}
          <View style={styles.chipRow}>
            {eligible?.candidates.map((c) => (
              <Pressable key={c.employee_id} style={StyleSheet.flatten([styles.chip, delegateId === c.employee_id && styles.chipSelected])} onPress={() => setDelegateId(c.employee_id)}>
                <Text style={StyleSheet.flatten([styles.chipText, delegateId === c.employee_id && styles.chipTextSelected])}>{c.full_name}</Text>
              </Pressable>
            ))}
          </View>
          {!eligible?.candidates.length && <EmptyState text="No eligible delegates found." />}
          <DatePickerField label="From" value={fromDate} onChange={setFromDate} />
          <DatePickerField label="To" value={toDate} onChange={setToDate} />
          <Pressable
            style={StyleSheet.flatten([styles.submitButton, (!delegateId || !fromDate || !toDate) && styles.submitDisabled])}
            disabled={busy || !delegateId || !fromDate || !toDate}
            onPress={nominate}
          >
            {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Nominate Delegate</Text>}
          </Pressable>
        </>
      )}

      {mine && mine.filter((d) => d.revoked_at).length > 0 && (
        <View style={styles.historySection}>
          <Text style={styles.sectionTitle}>Past delegations</Text>
          {mine.filter((d) => d.revoked_at).map((d) => (
            <View key={d.delegation_id} style={styles.historyRow}>
              <Text style={styles.historyText}>{d.delegate_name ?? `Employee #${d.delegate_id}`}</Text>
              <Text style={styles.historySpan}>{d.from_date} → {d.to_date}</Text>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
    fallbackNote: { color: colors.warning, fontSize: 12, fontStyle: 'italic' },
    activeCard: { backgroundColor: colors.tint2, borderRadius: 10, padding: 14, gap: 4 },
    activeTitle: { fontSize: 12, color: colors.accentText, fontWeight: '700', textTransform: 'uppercase' },
    activeText: { fontSize: 15, fontWeight: '600', color: colors.text },
    activeSpan: { fontSize: 13, color: colors.textMuted },
    revokeButton: { backgroundColor: colors.danger, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
    revokeText: { color: colors.dangerContrast, fontWeight: '700' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: 13, color: colors.textMuted },
    chipTextSelected: { color: colors.accentContrast },
    submitButton: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700' },
    historySection: { marginTop: 12, gap: 6 },
    historyRow: { backgroundColor: colors.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.border },
    historyText: { color: colors.text, fontSize: 13 },
    historySpan: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  });
}
