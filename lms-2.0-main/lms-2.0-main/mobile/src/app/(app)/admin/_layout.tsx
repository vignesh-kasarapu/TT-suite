import { Stack } from 'expo-router';

import { useThemeColors } from '../../../theme/ThemeContext';

export default function AdminLayout() {
  const colors = useThemeColors();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Administration' }} />
      <Stack.Screen name="leave-types" options={{ title: 'Leave Types' }} />
      <Stack.Screen name="self-approval" options={{ title: 'Self-Approval' }} />
      <Stack.Screen name="blackout-capacity" options={{ title: 'Blackout & Capacity' }} />
      <Stack.Screen name="encashment-compoff" options={{ title: 'Encashment & Comp-off' }} />
      <Stack.Screen name="employees" options={{ title: 'Employees' }} />
      <Stack.Screen name="holiday-admin" options={{ title: 'Holiday Admin' }} />
      <Stack.Screen name="org-settings" options={{ title: 'Org Settings' }} />
      <Stack.Screen name="working-patterns" options={{ title: 'Working Patterns' }} />
      <Stack.Screen name="notification-templates" options={{ title: 'Notification Templates' }} />
      <Stack.Screen name="ledger" options={{ title: 'Ledger & Adjustments' }} />
      <Stack.Screen name="audit-log" options={{ title: 'Audit Log' }} />
    </Stack>
  );
}
