import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getMyLedger } from '../../api/ledger';
import { EmptyState, Screen } from '../../components/Screen';
import { useApi } from '../../hooks/useApi';
import type { Palette } from '../../theme/colors';
import { useThemeColors } from '../../theme/ThemeContext';

/** LMS-057: an employee's full ledger, every entry with type/quantity/
 * running balance/source/timestamp — defaults to the current leave year
 * server-side when no leave_year_id is passed. */
export default function Balance() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(() => getMyLedger());
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {data && data.length === 0 && <EmptyState text="No ledger entries yet for this leave year." />}
      {data?.map((entry) => (
        <View key={entry.entry_id} style={styles.row}>
          <View style={styles.rowMain}>
            <Text style={styles.entryType}>{entry.entry_type.replace(/_/g, ' ')}</Text>
            {entry.reason && <Text style={styles.reason}>{entry.reason}</Text>}
            <Text style={styles.date}>{new Date(entry.created_at).toLocaleDateString()}</Text>
          </View>
          <View style={styles.numbers}>
            <Text style={StyleSheet.flatten([styles.quantity, entry.quantity < 0 ? styles.negative : styles.positive])}>
              {entry.quantity > 0 ? '+' : ''}{entry.quantity}
            </Text>
            <Text style={styles.running}>bal: {entry.running_balance}</Text>
          </View>
        </View>
      ))}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    entryType: { fontWeight: '600', color: colors.text, fontSize: 13 },
    reason: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    date: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    numbers: { alignItems: 'flex-end' },
    quantity: { fontWeight: '700', fontSize: 14 },
    positive: { color: colors.success },
    negative: { color: colors.danger },
    running: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
