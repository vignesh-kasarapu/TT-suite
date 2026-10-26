import { Link, Stack } from 'expo-router';
import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { getDashboard } from '../../api/employees';
import { EmptyState, Screen } from '../../components/Screen';
import { StatusPill } from '../../components/StatusPill';
import { useApi } from '../../hooks/useApi';
import { useSession } from '../../services/session';
import type { Palette } from '../../theme/colors';
import { useThemeColors } from '../../theme/ThemeContext';

export default function Dashboard() {
  const { me, signOut } = useSession();
  const { data, loading, error, refreshing, refresh, reload } = useApi(getDashboard);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <>
      <Stack.Screen
        options={{
          title: `Hi, ${me?.employee.full_name?.split(' ')[0] ?? ''}`,
          headerLeft: () => (
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            <Image source={require('../../../assets/tektalis-logo.png')} style={styles.logo} resizeMode="contain" />
          ),
          headerRight: () => (
            <View style={styles.headerActions}>
              <Link href="/(app)/more/profile" asChild>
                <Pressable hitSlop={12}>
                  <Text style={styles.headerIcon}>👤</Text>
                </Pressable>
              </Link>
              <Link href="/(app)/notifications" asChild>
                <Pressable hitSlop={12}>
                  <Text style={styles.headerIcon}>🔔</Text>
                </Pressable>
              </Link>
              <Pressable hitSlop={12} onPress={() => signOut()}>
                <Text style={styles.signOut}>Sign out</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
        {data && (
          <>
            <Text style={styles.sectionTitle}>Leave Year {data.leaveYear.year_code}</Text>

            <View style={styles.cardsRow}>
              {data.balances.map((card) => (
                <View key={card.leaveType.leave_type_id} style={styles.balanceCard}>
                  <Text style={styles.balanceType}>{card.leaveType.type_name}</Text>
                  <Text style={styles.balanceNumber}>{card.effectiveBalance}</Text>
                  <Text style={styles.balanceLabel}>days available</Text>
                </View>
              ))}
            </View>

            {data.withdrawalWindow.length > 0 && (
              <View style={styles.alertBanner}>
                <Text style={styles.alertText}>
                  {data.withdrawalWindow.length} rejected advance-leave request(s) can still be withdrawn
                  before the window closes.
                </Text>
              </View>
            )}

            <Text style={styles.sectionTitle}>Pending Requests</Text>
            {data.pending.length === 0 ? (
              <EmptyState text="No pending requests." />
            ) : (
              data.pending.map((r) => (
                <Link key={r.request_id} href={`/(app)/requests/${r.request_id}`} asChild>
                  <Pressable style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowDates}>{r.start_date} → {r.end_date}</Text>
                      <Text style={styles.rowReason} numberOfLines={1}>{r.reason}</Text>
                    </View>
                    <StatusPill state={r.state} />
                  </Pressable>
                </Link>
              ))
            )}

            <Text style={styles.sectionTitle}>Upcoming Approved Leave</Text>
            {data.upcoming.length === 0 ? (
              <EmptyState text="Nothing coming up." />
            ) : (
              data.upcoming.map((r) => (
                <Link key={r.request_id} href={`/(app)/requests/${r.request_id}`} asChild>
                  <Pressable style={styles.row}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowDates}>{r.start_date} → {r.end_date}</Text>
                      <Text style={styles.rowReason} numberOfLines={1}>{r.reason}</Text>
                    </View>
                    <StatusPill state={r.state} />
                  </Pressable>
                </Link>
              ))
            )}
          </>
        )}
      </Screen>
    </>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    logo: { height: 24, width: 90, marginLeft: 16 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginRight: 16 },
    headerIcon: { fontSize: 20 },
    signOut: { color: colors.danger, fontWeight: '600', fontSize: 13 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 8 },
    cardsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    balanceCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, minWidth: 110, flexGrow: 1, borderWidth: 1, borderColor: colors.border },
    balanceType: { fontSize: 12, color: colors.textMuted },
    balanceNumber: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: 4 },
    balanceLabel: { fontSize: 11, color: colors.textMuted },
    alertBanner: { backgroundColor: colors.warningBg, borderRadius: 10, padding: 12 },
    alertText: { color: colors.warning, fontSize: 13 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    rowDates: { fontWeight: '600', color: colors.text },
    rowReason: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  });
}
