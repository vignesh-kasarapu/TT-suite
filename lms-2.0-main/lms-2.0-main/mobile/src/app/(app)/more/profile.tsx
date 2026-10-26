import * as ImagePicker from 'expo-image-picker';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../../../api/client';
import * as employees from '../../../api/employees';
import { useApi } from '../../../hooks/useApi';
import { useAuthenticatedImage } from '../../../hooks/useAuthenticatedImage';
import { useSession } from '../../../services/session';
import type { Palette } from '../../../theme/colors';
import { useTheme, useThemeColors } from '../../../theme/ThemeContext';
import type { UpdateOwnProfile } from '../../../types/models';

const MODE_LABEL: Record<string, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export default function Profile() {
  const { me, refreshMe } = useSession();
  const { data, loading, reload } = useApi(employees.getMe);
  const { mode, cycleMode } = useTheme();
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const employee = data?.employee ?? me?.employee ?? null;
  const avatarSource = useAuthenticatedImage(employee?.has_avatar ? `/api/employees/${employee.employee_id}/avatar` : null);

  const [form, setForm] = useState<UpdateOwnProfile>({});
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const field = (key: keyof UpdateOwnProfile): string => {
    if (key in form) return form[key] ?? '';
    return (employee?.[key as keyof typeof employee] as string | null) ?? '';
  };
  const setField = (key: keyof UpdateOwnProfile, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (Object.keys(form).length === 0) return;
    setSaving(true);
    try {
      await employees.updateMe(form);
      setForm({});
      await Promise.all([reload(), refreshMe()]);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (err) {
      Alert.alert('Could not save', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to change your profile picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: true, aspect: [1, 1] });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      await employees.uploadAvatar({ uri: asset.uri, name: asset.fileName ?? 'avatar.jpg', type: asset.mimeType ?? 'image/jpeg' });
      await Promise.all([reload(), refreshMe()]);
    } catch (err) {
      Alert.alert('Could not upload photo', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  if (loading || !employee) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.avatarWrap} onPress={pickAvatar} disabled={uploadingAvatar}>
          {avatarSource ? (
            <Image source={avatarSource} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>{employee.full_name?.[0]?.toUpperCase() ?? '?'}</Text>
            </View>
          )}
          {uploadingAvatar ? (
            <ActivityIndicator style={styles.avatarSpinner} color={colors.accent} />
          ) : (
            <Text style={styles.avatarEdit}>Change photo</Text>
          )}
        </Pressable>

        <Text style={styles.name}>{employee.full_name}</Text>
        <Text style={styles.subtext}>{employee.work_email}</Text>
        <Text style={styles.subtext}>{employee.designation ?? employee.employee_code}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance</Text>
          <Pressable style={styles.themeRow} onPress={cycleMode}>
            <Text style={styles.label}>Theme</Text>
            <Text style={styles.themeValue}>{MODE_LABEL[mode]} ›</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact details</Text>
          <Field label="Phone" value={field('phone')} onChangeText={(v) => setField('phone', v)} colors={colors} />
          <Field label="Personal email" value={field('personal_email')} onChangeText={(v) => setField('personal_email', v)} colors={colors} keyboardType="email-address" />
          <Field label="Gender" value={field('gender')} onChangeText={(v) => setField('gender', v)} colors={colors} />
          <Field label="Marital status" value={field('marital_status')} onChangeText={(v) => setField('marital_status', v)} colors={colors} />
          <Field label="Emergency contact name" value={field('emergency_contact_name')} onChangeText={(v) => setField('emergency_contact_name', v)} colors={colors} />
          <Field label="Emergency contact phone" value={field('emergency_contact_phone')} onChangeText={(v) => setField('emergency_contact_phone', v)} colors={colors} />
        </View>

        <Pressable style={StyleSheet.flatten([styles.saveButton, Object.keys(form).length === 0 && styles.saveDisabled])} disabled={saving || Object.keys(form).length === 0} onPress={save}>
          {saving ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.saveText}>Save Changes</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  colors,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  colors: Palette;
  keyboardType?: 'default' | 'email-address';
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: colors.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
    content: { padding: 16, alignItems: 'center' },
    avatarWrap: { alignItems: 'center', marginBottom: 12 },
    avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.tint2 },
    avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.tint2, alignItems: 'center', justifyContent: 'center' },
    avatarInitial: { fontSize: 32, fontWeight: '700', color: colors.accentText },
    avatarSpinner: { marginTop: 6 },
    avatarEdit: { marginTop: 6, color: colors.accent, fontSize: 12, fontWeight: '600' },
    name: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 4 },
    subtext: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
    section: { width: '100%', marginTop: 20 },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase' },
    themeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    themeValue: { color: colors.accent, fontWeight: '600' },
    fieldWrap: { marginBottom: 12 },
    label: { fontSize: 13, color: colors.textMuted, marginBottom: 4 },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.surface, color: colors.text },
    saveButton: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8, width: '100%' },
    saveDisabled: { backgroundColor: colors.textMuted },
    saveText: { color: colors.accentContrast, fontWeight: '700' },
  });
}
