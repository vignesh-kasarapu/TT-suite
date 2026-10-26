import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Palette } from '../theme/colors';
import { useThemeColors } from '../theme/ThemeContext';
import type { LeaveRequestState } from '../types/models';

function humanize(state: string): string {
  return state.replace(/_/g, ' ').replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
}

/** Mirrors the web app's StatusBadge.jsx STATE_META mapping (pill--accent/
 * success/danger/warning/muted per theme.md), so the same request reads the
 * same way on both clients. */
export function StatusPill({ state }: { state: LeaveRequestState | string }) {
  const colors = useThemeColors();
  const palette: Record<string, { bg: string; fg: string }> = {
    PENDING_MANAGER: { bg: colors.tint2, fg: colors.accentText },
    PENDING_HR: { bg: colors.tint2, fg: colors.accentText },
    CANCELLATION_REQUESTED: { bg: colors.tint2, fg: colors.accentText },
    APPROVED: { bg: colors.successBg, fg: colors.success },
    REJECTED: { bg: colors.dangerBg, fg: colors.dangerText },
    REJECTED_PENDING_WITHDRAWAL: { bg: colors.dangerBg, fg: colors.dangerText },
    LOP_APPLIED: { bg: colors.warningBg, fg: colors.warning },
    DRAFT: { bg: colors.tint3, fg: colors.textMuted },
    WITHDRAWN: { bg: colors.tint3, fg: colors.textMuted },
    CANCELLED: { bg: colors.tint3, fg: colors.textMuted },
  };
  const stateColors = palette[state] ?? { bg: colors.tint3, fg: colors.textMuted };
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={[styles.pill, { backgroundColor: stateColors.bg }]}>
      <Text style={[styles.text, { color: stateColors.fg }]}>{humanize(state)}</Text>
    </View>
  );
}

function makeStyles(_colors: Palette) {
  return StyleSheet.create({
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: 'flex-start' },
    text: { fontSize: 12, fontWeight: '600' },
  });
}
