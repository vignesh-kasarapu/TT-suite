import { Link } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '../../../services/session';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';

function MenuRow({ href, label }: { href: string; label: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Link href={href as never} asChild>
      <Pressable style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </Link>
  );
}

export default function More() {
  const { me } = useSession();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const roles = me?.roles ?? [];
  const isApprover = roles.includes('MANAGER') || roles.includes('HR_ADMIN');
  // Delegation self-service is MANAGER-only server-side (LMS-041/042) — an
  // HR_ADMIN-only account has no self-service delegation to manage (the
  // web app shows them an org-wide admin view instead, not built on mobile
  // yet), so don't link to a screen that can only ever 403 for them.
  const isManager = roles.includes('MANAGER');

  return (
    <View style={styles.container}>
      <MenuRow href="/(app)/balance" label="My Balance" />
      <MenuRow href="/(app)/more/profile" label="Profile" />
      <MenuRow href="/(app)/more/holidays" label="Holiday Calendar" />
      <MenuRow href="/(app)/more/team-calendar" label={isApprover ? 'Team Calendar' : 'Peer Calendar'} />
      {isApprover && (
        <>
          <MenuRow href="/(app)/more/my-team" label="My Team" />
          <MenuRow href="/(app)/more/reports" label="Reports" />
        </>
      )}
      {isManager && <MenuRow href="/(app)/more/delegation" label="Delegation" />}
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
