import { useMemo } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Palette } from '../theme/colors';
import { useThemeColors } from '../theme/ThemeContext';

/** Shared loading/error/empty/refresh handling so every screen doesn't
 * reimplement the same three states. */
export function Screen({
  loading,
  error,
  onRetry,
  refreshing,
  onRefresh,
  children,
}: {
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.errorText}>{error}</Text>
        {onRetry && <Text style={styles.retry} onPress={onRetry}>Tap to retry</Text>}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function EmptyState({ text }: { text: string }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 },
    content: { padding: 16, gap: 12 },
    errorText: { color: colors.danger, textAlign: 'center', marginBottom: 12 },
    retry: { color: colors.accent, fontWeight: '600' },
    empty: { padding: 24, alignItems: 'center' },
    emptyText: { color: colors.textMuted },
  });
}
