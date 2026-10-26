import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import * as reports from '../../../api/reports';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmptyState, Screen } from '../../../components/Screen';
import { StatusPill } from '../../../components/StatusPill';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

/** BR-39/40: manager-scoping is enforced server-side (this report only ever
 * returns rows the caller is allowed to see — no client-side filtering
 * needed to keep it safe). One filter set at a time via a collapsible panel
 * rather than the web's always-visible multi-filter row — same capability,
 * phone-appropriate layout. */
export default function Reports() {
  const [showFilters, setShowFilters] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedFilters, setAppliedFilters] = useState<{ from_date?: string; to_date?: string }>({});
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { data, loading, error, refreshing, refresh, reload } = useApi(
    () => reports.getLeaveTakenReport(appliedFilters),
    [appliedFilters],
  );

  const applyFilters = () => {
    setAppliedFilters({ from_date: fromDate || undefined, to_date: toDate || undefined });
    setShowFilters(false);
  };

  const clearFilters = () => {
    setFromDate('');
    setToDate('');
    setAppliedFilters({});
    setShowFilters(false);
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.filterToggle} onPress={() => setShowFilters((s) => !s)}>
        <Text style={styles.filterToggleText}>{showFilters ? 'Hide filters' : 'Filter by date range'}</Text>
      </Pressable>

      {showFilters && (
        <View style={styles.filterBox}>
          <DatePickerField label="From" value={fromDate} onChange={setFromDate} />
          <DatePickerField label="To" value={toDate} onChange={setToDate} />
          <View style={styles.filterActions}>
            <Pressable style={styles.clearButton} onPress={clearFilters}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
            <Pressable style={styles.applyButton} onPress={applyFilters}>
              <Text style={styles.applyText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!data?.length ? (
        <EmptyState text="No leave taken in this period." />
      ) : (
        data.map((row) => (
          <View key={row.request_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{row.employee_name}</Text>
              <Text style={styles.meta}>{row.leave_type_name} · {row.start_date} → {row.end_date}</Text>
              <Text style={styles.days}>{row.deducted_days ?? '–'} day(s)</Text>
            </View>
            <StatusPill state={row.state} />
          </View>
        ))
      )}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    filterToggle: { alignSelf: 'flex-start' },
    filterToggleText: { color: colors.accent, fontWeight: '600', fontSize: 13 },
    filterBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 4 },
    filterActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
    clearButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    clearText: { color: colors.textMuted, fontWeight: '600' },
    applyButton: { flex: 1, backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    applyText: { color: colors.accentContrast, fontWeight: '700' },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    days: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
