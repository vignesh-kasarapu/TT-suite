import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../theme/colors';
import { useThemeColors } from '../theme/ThemeContext';

/** Metro resolves this file (not DatePickerField.tsx) for web builds — see
 * DatePickerField.tsx's header comment for why the two are split rather than
 * branching on Platform.OS inside one file. Plain HTML date input; every
 * modern browser ships a native date picker on it for free. */
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
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <input
        type="date"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 8,
          padding: 10,
          backgroundColor: colors.surface,
          color: colors.text,
          fontSize: 14,
          fontFamily: 'inherit',
        }}
      />
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    wrap: { marginTop: 6 },
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 4 },
  });
}
