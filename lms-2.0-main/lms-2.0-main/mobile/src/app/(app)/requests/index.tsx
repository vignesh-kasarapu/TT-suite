import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { listMine } from '../../../api/leaveRequests';
import { EmptyState, Screen } from '../../../components/Screen';
import { StatusPill } from '../../../components/StatusPill';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

export default function MyRequests() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(listMine);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {data && data.length === 0 && <EmptyState text="You haven't submitted any leave requests yet." />}
      {data?.map((r) => (
        <Link key={r.request_id} href={`/(app)/requests/${r.request_id}`} asChild>
          <Pressable style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.rowDates}>{r.start_date} → {r.end_date}</Text>
              <Text style={styles.rowReason} numberOfLines={1}>{r.reason}</Text>
              <Text style={styles.rowDays}>{r.deducted_days ?? '–'} day(s)</Text>
            </View>
            <StatusPill state={r.state} />
          </Pressable>
        </Link>
      ))}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    rowDates: { fontWeight: '600', color: colors.text },
    rowReason: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    rowDays: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
