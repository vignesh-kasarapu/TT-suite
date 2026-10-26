import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Text } from 'react-native';

import { useSession } from '../../services/session';
import { useThemeColors } from '../../theme/ThemeContext';

function TabIcon({ label, color }: { label: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 20 }}>{label}</Text>;
}

export default function AppLayout() {
  const { me } = useSession();
  const roles = me?.roles ?? [];
  const isApprover = roles.includes('MANAGER') || roles.includes('HR_ADMIN');
  const isHrAdmin = roles.includes('HR_ADMIN');
  const colors = useThemeColors();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        // A solid accent-tinted background on the selected tab, distinct from
        // react-native-web's default hover overlay (a faint opacity change on
        // any pressable) — without this, hover and "currently selected" read
        // as the same visual state on web.
        tabBarActiveBackgroundColor: colors.tint2,
        tabBarInactiveBackgroundColor: colors.surface,
        tabBarItemStyle: { borderRadius: 10, marginHorizontal: 4, marginVertical: 4 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          // Explicit, independent of `title` — index.tsx's own <Stack.Screen
          // options={{ title: `Hi, ${name}` }}> would otherwise leak into the
          // tab bar label too, since tabBarLabel falls back to `title` when
          // not set separately.
          tabBarLabel: 'Home',
          tabBarIcon: ({ color }) => <TabIcon label="⌂" color={color} />,
        }}
      />
      <Tabs.Screen
        name="apply"
        options={{ title: 'Apply', tabBarIcon: ({ color }) => <TabIcon label="➕" color={color} /> }}
      />
      <Tabs.Screen
        name="requests"
        options={{ title: 'My Requests', tabBarIcon: ({ color }) => <TabIcon label="≡" color={color} /> }}
      />
      <Tabs.Screen name="balance" options={{ title: 'Balance', href: null }} />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          tabBarIcon: ({ color }) => <TabIcon label="✓" color={color} />,
          // Route stays reachable by direct navigation; only the tab button
          // is hidden when the signed-in user isn't a Manager/HR_ADMIN.
          href: isApprover ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', headerShown: false, tabBarIcon: ({ color }) => <TabIcon label="•••" color={color} /> }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          headerShown: false,
          tabBarIcon: ({ color }) => <TabIcon label="⚙" color={color} />,
          href: isHrAdmin ? undefined : null,
        }}
      />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}
