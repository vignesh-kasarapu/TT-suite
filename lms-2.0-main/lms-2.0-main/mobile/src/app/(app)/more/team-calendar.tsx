import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import * as employees from '../../../api/employees';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import { useSession } from '../../../services/session';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { PeerCalendarEntry, TeamCalendarEntry } from '../../../types/models';

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** BR-39 (Manager sees every report at any depth) vs BR-41/NFR-14 (peer view
 * — same manager AND same management level — never sends leave type). Pick a
 * date, see who's out that day and how many — mirrors the web's "click a day
 * to see who's out" month-grid interaction, just via a date picker instead of
 * a grid. list_for_employees_overlapping is a real overlap query server-side
 * (not "starts on this day"), so start_date == end_date == the picked date
 * correctly catches multi-day spans that cover it. */
export default function TeamCalendar() {
  const { me } = useSession();
  const isApprover = (me?.roles ?? []).some((r) => r === 'MANAGER' || r === 'HR_ADMIN');
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));

  const { data, loading, error, refreshing, refresh, reload } = useApi<(TeamCalendarEntry | PeerCalendarEntry)[]>(
    () => (isApprover ? employees.getTeamCalendar(selectedDate, selectedDate) : employees.getPeerCalendar(selectedDate, selectedDate)),
    [isApprover, selectedDate],
  );

  const count = data?.length ?? 0;

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <DatePickerField label="Date" value={selectedDate} onChange={setSelectedDate} />

      <View style={styles.summaryCard}>
        <Text style={styles.summaryCount}>{count}</Text>
        <Text style={styles.summaryLabel}>{isApprover ? 'team member(s)' : 'peer(s)'} on leave on {selectedDate}</Text>
      </View>

      {count === 0 ? (
        <EmptyState text="No one is out on this date." />
      ) : (
        data?.map((row) => (
          <View key={row.request_id} style={styles.row}>
            <View style={styles.rowMain}>
              <Text style={styles.name}>{row.employee_name ?? `Employee #${row.employee_id}`}</Text>
              {'leave_type_name' in row && row.leave_type_name && <Text style={styles.leaveType}>{row.leave_type_name}</Text>}
            </View>
            <Text style={styles.span}>{row.start_date} → {row.end_date}</Text>
          </View>
        ))
      )}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    summaryCard: { flexDirection: 'row', alignItems: 'baseline', gap: 8, backgroundColor: colors.tint2, borderRadius: 10, padding: 14 },
    summaryCount: { fontSize: 28, fontWeight: '700', color: colors.accentText },
    summaryLabel: { fontSize: 13, color: colors.accentText, flexShrink: 1 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text },
    leaveType: { color: colors.accentText, fontSize: 12, marginTop: 2 },
    span: { color: colors.textMuted, fontSize: 12 },
  });
}
