import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as employees from '../../../api/employees';
import * as holidays from '../../../api/holidays';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

/** LMS-028/7.3.15: the mandatory calendar (GET /api/holidays) plus the
 * current leave year's optional-holiday quota/selection — mirrors the web
 * HolidayCalendar page. The optional-summary endpoint needs a leave_year_id;
 * the dashboard call is the cheapest already-existing way to get the current
 * one without a dedicated employee-facing "current leave year" endpoint. */
export default function HolidayCalendar() {
  const { data: dashboard } = useApi(employees.getDashboard);
  const leaveYearId = dashboard?.leaveYear.leave_year_id;
  const { data: allHolidays, loading, error, refreshing, refresh, reload } = useApi(holidays.listHolidays);
  const { data: summary, reload: reloadSummary } = useApi(() => holidays.getOptionalSummary(leaveYearId), [leaveYearId]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const toggleOptional = async (holidayId: number, isSelected: boolean) => {
    setBusyId(holidayId);
    try {
      if (isSelected) await holidays.deselectOptionalHoliday(holidayId);
      else await holidays.selectOptionalHoliday(holidayId);
      await reloadSummary();
    } catch (err) {
      Alert.alert('Could not update selection', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {summary && (
        <View style={styles.quotaCard}>
          <Text style={styles.quotaTitle}>Optional holidays</Text>
          <Text style={styles.quotaText}>
            {summary.taken} of {summary.quota} taken · {summary.remaining} remaining
          </Text>
        </View>
      )}

      {!allHolidays?.length ? (
        <EmptyState text="No holidays published for this leave year yet." />
      ) : (
        allHolidays.map((h) => {
          const eligible = summary?.eligibleHolidays.find((e) => e.holidayId === h.holiday_id);
          return (
            <View key={h.holiday_id} style={styles.row}>
              <View style={styles.rowMain}>
                <Text style={styles.name}>{h.holiday_name}</Text>
                <Text style={styles.date}>{h.holiday_date}</Text>
              </View>
              {h.is_optional && eligible && (
                <Pressable
                  disabled={busyId === h.holiday_id}
                  onPress={() => toggleOptional(h.holiday_id, eligible.isSelected)}
                  style={StyleSheet.flatten([styles.selectButton, eligible.isSelected && styles.selectedButton])}
                >
                  {busyId === h.holiday_id ? (
                    <ActivityIndicator size="small" color={eligible.isSelected ? colors.accentContrast : colors.accent} />
                  ) : (
                    <Text style={StyleSheet.flatten([styles.selectText, eligible.isSelected && styles.selectedText])}>
                      {eligible.isSelected ? 'Selected' : 'Select'}
                    </Text>
                  )}
                </Pressable>
              )}
              {h.is_optional && !eligible && <Text style={styles.optionalTag}>Optional</Text>}
            </View>
          );
        })
      )}
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    quotaCard: { backgroundColor: colors.tint2, borderRadius: 10, padding: 12 },
    quotaTitle: { fontWeight: '700', color: colors.text, fontSize: 13 },
    quotaText: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    rowMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '600', color: colors.text },
    date: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    optionalTag: { color: colors.warning, fontSize: 11, fontWeight: '600' },
    selectButton: { borderWidth: 1, borderColor: colors.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
    selectedButton: { backgroundColor: colors.accent },
    selectText: { color: colors.accent, fontSize: 12, fontWeight: '600' },
    selectedText: { color: colors.accentContrast },
  });
}
