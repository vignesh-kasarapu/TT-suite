import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as orgConfig from '../../../api/orgConfig';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { OrgConfig } from '../../../types/models';

/** Type-aware inputs (bool switch / int / text) with dirty-state save-per-row,
 * mirroring the web Administration -> Settings section. */
export default function OrgSettings() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(orgConfig.listConfig);

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      {!data?.length ? <EmptyState text="No config keys found." /> : data.map((row) => <ConfigRow key={row.config_key} row={row} onSaved={reload} />)}
    </Screen>
  );
}

function ConfigRow({ row, onSaved }: { row: OrgConfig; onSaved: () => void }) {
  const [value, setValue] = useState(row.config_value);
  const [busy, setBusy] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dirty = value !== row.config_value;

  const save = async () => {
    setBusy(true);
    try {
      const parsed = row.value_type === 'BOOL' ? value === 'true' : row.value_type === 'INT' ? parseInt(value, 10) : value;
      await orgConfig.updateConfig(row.config_key, parsed, row.value_type);
      onSaved();
    } catch (err) {
      Alert.alert('Could not save', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.key}>{row.config_key}</Text>
        {row.description && <Text style={styles.description}>{row.description}</Text>}
      </View>
      {row.value_type === 'BOOL' ? (
        <Switch value={value === 'true'} onValueChange={(v) => setValue(String(v))} trackColor={{ false: colors.border, true: colors.accent }} thumbColor={colors.surface} />
      ) : (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          keyboardType={row.value_type === 'INT' ? 'number-pad' : 'default'}
        />
      )}
      {dirty && (
        <Pressable style={styles.saveButton} disabled={busy} onPress={save}>
          {busy ? <ActivityIndicator size="small" color={colors.accentContrast} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    row: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    rowMain: {},
    key: { fontWeight: '700', color: colors.text, fontSize: 13 },
    description: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, backgroundColor: colors.bg, color: colors.text },
    saveButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
    saveText: { color: colors.accentContrast, fontWeight: '700', fontSize: 12 },
  });
}
