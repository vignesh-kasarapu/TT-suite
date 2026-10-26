import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../utils/alert';

import { ApiError } from '../../api/client';
import * as leaveRequests from '../../api/leaveRequests';
import { EmptyState, Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { useApi } from '../../hooks/useApi';
import type { Palette } from '../../theme/colors';
import { useThemeColors } from '../../theme/ThemeContext';

/** Role-gated (MANAGER/HR_ADMIN) — mirrors the web Approvals screen's
 * approvals-queue endpoint. Approve is a one-tap quick action here; Reject
 * requires a mandatory reason (REASON_REQUIRED server-side), so that opens
 * the request-detail screen's decision section instead of a platform-
 * specific prompt dialog (Alert.prompt is iOS-only in React Native). */
export default function Approvals() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(leaveRequests.listApprovalsQueue);
  const [busyId, setBusyId] = useState<number | null>(null);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const approve = async (requestId: number) => {
    setBusyId(requestId);
    try {
      await leaveRequests.decide(requestId, 'APPROVE');
      await reload();
    } catch (err) {
      Alert.alert('Could not approve', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {data && data.length === 0 && <EmptyState text="Nothing waiting on your decision." />}
      {data?.map((row) => (
        <View key={row.request_id} style={styles.card}>
          <Link href={`/(app)/requests/${row.request_id}`} asChild>
            <Pressable style={styles.cardTop}>
              <View style={styles.cardMain}>
                <Text style={styles.dates}>{row.start_date} → {row.end_date}</Text>
                <Text style={styles.meta} numberOfLines={1}>{row.reason}</Text>
                {row.is_delegated && <Text style={styles.delegated}>Delegated to you</Text>}
              </View>
              <StatusPill state={row.state} />
            </Pressable>
          </Link>
          {busyId === row.request_id ? (
            <ActivityIndicator style={styles.spinner} color={colors.accent} />
          ) : (
            <View style={styles.actions}>
              <Pressable style={StyleSheet.flatten([styles.actionButton, styles.approve])} onPress={() => approve(row.request_id)}>
                <Text style={styles.actionText}>Approve</Text>
              </Pressable>
              <Link href={`/(app)/requests/${row.request_id}`} asChild>
                <Pressable style={StyleSheet.flatten([styles.actionButton, styles.reject])}>
                  <Text style={styles.actionText}>Reject…</Text>
                </Pressable>
              </Link>
            </View>
          )}
        </View>
      ))}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    card: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 10 },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    cardMain: { flex: 1, marginRight: 8 },
    dates: { fontWeight: '600', color: colors.text },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    delegated: { color: colors.warning, fontSize: 11, marginTop: 2, fontWeight: '600' },
    actions: { flexDirection: 'row', gap: 8 },
    actionButton: { flex: 1, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    approve: { backgroundColor: colors.success },
    reject: { backgroundColor: colors.danger },
    actionText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    spinner: { marginTop: 4 },
  });
}
