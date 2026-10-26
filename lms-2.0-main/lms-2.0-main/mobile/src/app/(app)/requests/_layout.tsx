import { Stack } from 'expo-router';

import { useThemeColors } from '../../../theme/ThemeContext';

export default function RequestsLayout() {
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
      <Stack.Screen name="index" options={{ title: 'My Requests' }} />
      <Stack.Screen name="[id]" options={{ title: 'Request Detail' }} />
    </Stack>
  );
}
