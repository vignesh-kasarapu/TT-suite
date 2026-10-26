import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

const SECTIONS: { href: string; label: string }[] = [
  { href: '/(app)/admin/employees', label: 'Employees' },
  { href: '/(app)/admin/leave-types', label: 'Leave Types' },
  { href: '/(app)/admin/holiday-admin', label: 'Holiday Admin' },
  { href: '/(app)/admin/org-settings', label: 'Org Settings' },
  { href: '/(app)/admin/self-approval', label: 'Self-Approval Permissions' },
  { href: '/(app)/admin/working-patterns', label: 'Working Patterns' },
  { href: '/(app)/admin/notification-templates', label: 'Notification Templates' },
  { href: '/(app)/admin/blackout-capacity', label: 'Blackout Periods & Team Capacity' },
  { href: '/(app)/admin/encashment-compoff', label: 'Encashment & Comp-off' },
  { href: '/(app)/admin/ledger', label: 'Ledger & Balance Adjustment' },
  { href: '/(app)/admin/audit-log', label: 'Audit Log' },
];

export default function AdminMenu() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      {SECTIONS.map((item) => (
        <Link key={item.href} href={item.href as never} asChild>
          <Pressable style={styles.row}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 10 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    label: { color: colors.text, fontSize: 15, fontWeight: '600' },
    chevron: { color: colors.textMuted, fontSize: 18 },
  });
}
