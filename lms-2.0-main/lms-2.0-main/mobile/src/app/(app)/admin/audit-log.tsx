import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import * as auditLog from '../../../api/auditLog';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

export default function AuditLog() {
  const [showFilters, setShowFilters] = useState(false);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [applied, setApplied] = useState<{ action?: string; entity_type?: string }>({});
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { data, loading, error, refreshing, refresh, reload } = useApi(() => auditLog.getAuditLog(applied), [applied]);

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.filterToggle} onPress={() => setShowFilters((s) => !s)}>
        <Text style={styles.filterToggleText}>{showFilters ? 'Hide filters' : 'Filter'}</Text>
      </Pressable>
      {showFilters && (
        <View style={styles.filterBox}>
          <TextInput style={styles.input} placeholder="Action (e.g. CONFIG_UPDATED)" placeholderTextColor={colors.textMuted} value={action} onChangeText={setAction} autoCapitalize="characters" />
          <TextInput style={styles.input} placeholder="Entity type (e.g. leave_requests)" placeholderTextColor={colors.textMuted} value={entityType} onChangeText={setEntityType} />
          <View style={styles.filterActions}>
            <Pressable style={styles.clearButton} onPress={() => { setAction(''); setEntityType(''); setApplied({}); }}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
            <Pressable style={styles.applyButton} onPress={() => setApplied({ action: action || undefined, entity_type: entityType || undefined })}>
              <Text style={styles.applyText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      )}
      {!data?.length ? (
        <EmptyState text="No audit entries match." />
      ) : (
        data.map((log) => (
          <View key={log.audit_id} style={styles.row}>
            <Text style={styles.action}>{log.action}</Text>
            <Text style={styles.meta}>{log.entity_type} #{log.entity_id ?? '–'} · {log.is_system_actor ? 'system' : log.actor_name ?? `Employee #${log.actor_id}`}</Text>
            <Text style={styles.date}>{new Date(log.timestamp).toLocaleString()}</Text>
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
    filterBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    filterActions: { flexDirection: 'row', gap: 8 },
    clearButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    clearText: { color: colors.textMuted, fontWeight: '600' },
    applyButton: { flex: 1, backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    applyText: { color: colors.accentContrast, fontWeight: '700' },
    row: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    action: { fontWeight: '700', color: colors.text, fontSize: 13 },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    date: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  });
}
