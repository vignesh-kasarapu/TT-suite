import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import * as templatesAdmin from '../../../api/notificationTemplatesAdmin';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { NotificationTemplate } from '../../../types/models';

/** Protected template keys (PROTECTED_TEMPLATE_KEYS server-side) reject a
 * hard delete with TEMPLATE_IN_USE — this screen just surfaces that error
 * rather than pre-guessing which keys are protected. */
export default function NotificationTemplatesAdmin() {
  const { data, loading, error, refreshing, refresh, reload } = useApi(templatesAdmin.listTemplates);
  const [showCreate, setShowCreate] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Screen loading={loading} error={error} onRetry={reload} refreshing={refreshing} onRefresh={refresh}>
      <Pressable style={styles.toggleButton} onPress={() => setShowCreate((s) => !s)}>
        <Text style={styles.toggleText}>{showCreate ? 'Cancel' : '+ New Template'}</Text>
      </Pressable>
      {showCreate && <TemplateForm mode="create" onDone={() => { setShowCreate(false); reload(); }} colors={colors} />}

      {!data?.length ? (
        <EmptyState text="No notification templates." />
      ) : (
        data.map((t) => (
          <View key={t.template_key} style={styles.card}>
            <Pressable style={styles.header} onPress={() => setEditingKey(editingKey === t.template_key ? null : t.template_key)}>
              <View style={styles.headerMain}>
                <Text style={styles.name}>{t.template_key}</Text>
                <Text style={styles.subject} numberOfLines={1}>{t.subject_template}</Text>
              </View>
              <Text style={StyleSheet.flatten([styles.statusTag, t.is_active ? styles.activeTag : styles.inactiveTag])}>{t.is_active ? 'Active' : 'Disabled'}</Text>
            </Pressable>
            {editingKey === t.template_key && <TemplateForm mode="edit" template={t} onDone={() => { setEditingKey(null); reload(); }} colors={colors} />}
          </View>
        ))
      )}
    </Screen>
  );
}

function TemplateForm({
  mode,
  template,
  onDone,
  colors,
}: {
  mode: 'create' | 'edit';
  template?: NotificationTemplate;
  onDone: () => void;
  colors: Palette;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [templateKey, setTemplateKey] = useState(template?.template_key ?? '');
  const [subject, setSubject] = useState(template?.subject_template ?? '');
  const [body, setBody] = useState(template?.body_template ?? '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!templateKey.trim() || !subject.trim() || !body.trim()) return;
    setBusy(true);
    try {
      if (mode === 'create') {
        await templatesAdmin.createTemplate(templateKey.trim().toUpperCase(), subject.trim(), body.trim());
      } else {
        await templatesAdmin.updateTemplate(templateKey, subject.trim(), body.trim());
      }
      onDone();
    } catch (err) {
      Alert.alert('Could not save template', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!template) return;
    setBusy(true);
    try {
      await templatesAdmin.setTemplateActive(template.template_key, !template.is_active);
      onDone();
    } catch (err) {
      Alert.alert('Could not update', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!template) return;
    Alert.alert('Delete template?', 'Protected templates (still in use) will be refused by the server rather than deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await templatesAdmin.deleteTemplate(template.template_key);
            onDone();
          } catch (err) {
            Alert.alert('Could not delete', err instanceof ApiError ? err.message : 'Something went wrong.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.formCard}>
      <TextInput style={styles.input} placeholder="Template key" placeholderTextColor={colors.textMuted} value={templateKey} onChangeText={setTemplateKey} editable={mode === 'create'} autoCapitalize="characters" />
      <TextInput style={styles.input} placeholder="Subject (supports {{tokens}})" placeholderTextColor={colors.textMuted} value={subject} onChangeText={setSubject} />
      <TextInput style={StyleSheet.flatten([styles.input, styles.multiline])} placeholder="Body (supports {{tokens}})" placeholderTextColor={colors.textMuted} value={body} onChangeText={setBody} multiline />
      <Pressable style={styles.submitButton} disabled={busy} onPress={save}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>{mode === 'create' ? 'Create' : 'Save'}</Text>}
      </Pressable>
      {mode === 'edit' && template && (
        <View style={styles.editActions}>
          <Pressable style={styles.secondaryButton} disabled={busy} onPress={toggleActive}>
            <Text style={styles.secondaryText}>{template.is_active ? 'Disable' : 'Enable'}</Text>
          </Pressable>
          <Pressable style={styles.dangerButton} disabled={busy} onPress={remove}>
            <Text style={styles.dangerText}>Delete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    toggleButton: { alignSelf: 'flex-start' },
    toggleText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
    card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
    headerMain: { flex: 1, marginRight: 8 },
    name: { fontWeight: '700', color: colors.text, fontSize: 12 },
    subject: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    statusTag: { fontSize: 11, fontWeight: '700' },
    activeTag: { color: colors.success },
    inactiveTag: { color: colors.textMuted },
    formCard: { padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: colors.border },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    multiline: { minHeight: 100, textAlignVertical: 'top' },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    editActions: { flexDirection: 'row', gap: 8 },
    secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    secondaryText: { color: colors.text, fontWeight: '600', fontSize: 13 },
    dangerButton: { flex: 1, backgroundColor: colors.danger, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    dangerText: { color: colors.dangerContrast, fontWeight: '700', fontSize: 13 },
  });
}
