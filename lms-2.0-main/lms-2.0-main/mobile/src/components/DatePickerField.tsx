/** Native (iOS/Android) date field — deliberately a separate file from
 * DatePickerField.web.tsx rather than one file branching on Platform.OS.
 * @react-native-community/datetimepicker has no web build; Metro's platform-
 * extension resolution (this file vs. the .web.tsx sibling) keeps the native
 * module out of the web dependency graph entirely, rather than trusting a
 * runtime `if (Platform.OS !== 'web')` guard not to still pull it into the
 * bundle (the expo-secure-store web crash earlier this session was exactly
 * that mistake). */
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../theme/colors';
import { useThemeColors } from '../theme/ThemeContext';

export function DatePickerField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.input} disabled={disabled} onPress={() => setShowPicker(true)}>
        <Text style={{ color: value ? colors.text : colors.textMuted }}>{value || 'Select date'}</Text>
      </Pressable>
      {showPicker && (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          onChange={(_event, date) => {
            setShowPicker(false);
            if (date) onChange(date.toISOString().slice(0, 10));
          }}
        />
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { marginTop: 6 },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.surface },
  });
}
