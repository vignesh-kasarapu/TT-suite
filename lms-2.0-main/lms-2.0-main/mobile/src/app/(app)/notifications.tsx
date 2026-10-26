import { Stack } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import * as notifications from '../../api/notifications';
import { EmptyState, Screen } from '../../components/Screen';
import { useApi } from '../../hooks/useApi';
import type { Palette } from '../../theme/colors';
import { useThemeColors } from '../../theme/ThemeContext';

export default function Notifications() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(() => notifications.listNotifications());
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const markAllRead = async () => {
    await notifications.markAllRead();
    await reload();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Notifications',
          headerRight: () => (
            <Pressable onPress={markAllRead} hitSlop={12}>
              <Text style={styles.markAll}>Mark all read</Text>
            </Pressable>
          ),
        }}
      />
      <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
        {data && data.length === 0 && <EmptyState text="No notifications." />}
        {data?.map((n) => (
          <Pressable
            key={n.notification_id}
            style={StyleSheet.flatten([styles.row, !n.read_at && styles.unread])}
            onPress={() => notifications.markRead(n.notification_id).then(reload)}
          >
            <Text style={styles.subject}>{n.subject}</Text>
            <Text style={styles.body} numberOfLines={2}>{n.body}</Text>
            <Text style={styles.date}>{new Date(n.created_at).toLocaleString()}</Text>
          </Pressable>
        ))}
      </Screen>
    </>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    markAll: { color: colors.accent, fontWeight: '600', marginRight: 16 },
    row: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border },
    unread: { borderColor: colors.accent, backgroundColor: colors.tint2 },
    subject: { fontWeight: '700', color: colors.text },
    body: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    date: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  });
}
