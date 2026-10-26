import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../utils/alert';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '../services/session';
import type { Palette } from '../theme/colors';
import { useThemeColors } from '../theme/ThemeContext';

export default function SignIn() {
  const { signInWithEntra, signInDev, entraConfigured, devBypassAvailable } = useSession();
  const [busy, setBusy] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      Alert.alert('Sign-in failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>LMS 2.0</Text>
      <Text style={styles.subtitle}>Leave Management</Text>

      {busy && <ActivityIndicator style={styles.spinner} color={colors.accent} />}

      {entraConfigured && (
        <Pressable style={styles.button} disabled={busy} onPress={() => run(signInWithEntra)}>
          <Text style={styles.buttonText}>Sign in with Microsoft</Text>
        </Pressable>
      )}

      {devBypassAvailable && (
        <Pressable style={StyleSheet.flatten([styles.button, styles.devButton])} disabled={busy} onPress={() => run(signInDev)}>
          <Text style={styles.devButtonText}>Dev sign-in</Text>
        </Pressable>
      )}

      {!entraConfigured && !devBypassAvailable && (
        <Text style={styles.warning}>
          No sign-in method is configured. Set EXPO_PUBLIC_ENTRA_TENANT_ID / EXPO_PUBLIC_ENTRA_MOBILE_CLIENT_ID or
          EXPO_PUBLIC_DEV_AUTH_BYPASS_ENABLED in .env.
        </Text>
      )}
    </SafeAreaView>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg },
    title: { fontSize: 32, fontWeight: '700', color: colors.text },
    subtitle: { fontSize: 16, color: colors.textMuted, marginTop: 4, marginBottom: 40 },
    spinner: { marginBottom: 16 },
    button: { backgroundColor: colors.accent, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 10, width: '100%', alignItems: 'center', marginTop: 12 },
    devButton: { backgroundColor: colors.textMuted },
    buttonText: { color: colors.accentContrast, fontWeight: '600', fontSize: 16 },
    devButtonText: { color: colors.bg, fontWeight: '600', fontSize: 16 },
    warning: { color: colors.warning, textAlign: 'center', marginTop: 16 },
  });
}
