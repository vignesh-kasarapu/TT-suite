import { Stack } from 'expo-router';

import { useThemeColors } from '../../../theme/ThemeContext';

export default function MoreLayout() {
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
      <Stack.Screen name="index" options={{ title: 'More' }} />
      <Stack.Screen name="profile" options={{ title: 'Profile' }} />
      <Stack.Screen name="holidays" options={{ title: 'Holiday Calendar' }} />
      <Stack.Screen name="team-calendar" options={{ title: 'Team Calendar' }} />
      <Stack.Screen name="my-team" options={{ title: 'My Team' }} />
      <Stack.Screen name="delegation" options={{ title: 'Delegation' }} />
      <Stack.Screen name="reports" options={{ title: 'Reports' }} />
    </Stack>
  );
}
