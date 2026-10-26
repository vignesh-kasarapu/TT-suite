import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Alert } from '../../utils/alert';
import { router } from 'expo-router';

import { getDashboard } from '../../api/employees';
import * as leaveRequests from '../../api/leaveRequests';
import { uploadAttachment } from '../../api/attachments';
import { ApiError } from '../../api/client';
import { DatePickerField } from '../../components/DatePickerField';
import { Screen } from '../../components/Screen';
import { useApi } from '../../hooks/useApi';
import type { Palette } from '../../theme/colors';
import { useThemeColors } from '../../theme/ThemeContext';
import type { DashboardBalanceCard, Preview } from '../../types/models';

/** LMS-033 to LMS-040: mirrors the web Apply screen — leave types come from
 * the dashboard's balances (there's no dedicated employee-facing "selectable
 * leave types" endpoint; GET /api/admin/leave-types is HR_ADMIN-only in both
 * Node and this port). Draft save/submit mirrors ApplyLeave.jsx's save-as-
 * draft path; attachment upload happens after submission (needs a real
 * request_id first), best-effort — a failed upload doesn't roll back the
 * already-submitted request, matching the web app exactly. */
export default function ApplyLeave() {
  const { data: dashboard, loading: loadingDashboard } = useApi(getDashboard);
  const [leaveTypeId, setLeaveTypeId] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [attachment, setAttachment] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const selectedType: DashboardBalanceCard | undefined = dashboard?.balances.find((c) => c.leaveType.leave_type_id === leaveTypeId);

  useEffect(() => {
    if (!leaveTypeId || !startDate || !endDate) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    leaveRequests
      .preview({ leave_type_id: leaveTypeId, start_date: startDate, end_date: endDate, is_half_day: isHalfDay })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err) => {
        if (!cancelled) setPreviewError(err instanceof ApiError ? err.message : 'Could not compute a preview.');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leaveTypeId, startDate, endDate, isHalfDay]);

  const canSubmit = leaveTypeId && startDate && endDate && reason.trim() && preview && preview.deductedWorkingDays > 0;

  const pickAttachment = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/png', 'image/jpeg'] });
    if (result.canceled || !result.assets[0]) return;
    setAttachment(result.assets[0]);
  };

  const uploadPickedAttachment = async (requestId: number) => {
    if (!attachment) return;
    try {
      await uploadAttachment(requestId, { uri: attachment.uri, name: attachment.name, type: attachment.mimeType ?? 'application/octet-stream' });
    } catch (err) {
      Alert.alert('Request submitted, but attachment failed', err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  };

  const submit = async () => {
    if (!leaveTypeId) return;
    setSubmitting(true);
    try {
      const created = await leaveRequests.submit({
        leave_type_id: leaveTypeId, start_date: startDate, end_date: endDate, is_half_day: isHalfDay, reason: reason.trim(),
      });
      await uploadPickedAttachment(created.request_id);
      Alert.alert('Submitted', 'Your leave request has been submitted.');
      router.push(`/(app)/requests/${created.request_id}`);
    } catch (err) {
      Alert.alert('Could not submit', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  const saveDraft = async () => {
    if (!leaveTypeId || !startDate || !endDate || !reason.trim()) return;
    setSavingDraft(true);
    try {
      const created = await leaveRequests.saveDraft({
        leave_type_id: leaveTypeId, start_date: startDate, end_date: endDate, is_half_day: isHalfDay, reason: reason.trim(),
      });
      Alert.alert('Saved as draft', 'You can finish and submit it later from My Requests.');
      router.push(`/(app)/requests/${created.request_id}`);
    } catch (err) {
      Alert.alert('Could not save draft', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <Screen loading={loadingDashboard} error={null}>
      <Text style={styles.label}>Leave type</Text>
      <View style={styles.typeRow}>
        {dashboard?.balances.map((card) => (
          <Pressable
            key={card.leaveType.leave_type_id}
            style={StyleSheet.flatten([styles.typeChip, leaveTypeId === card.leaveType.leave_type_id && styles.typeChipSelected])}
            onPress={() => setLeaveTypeId(card.leaveType.leave_type_id)}
          >
            <Text style={StyleSheet.flatten([styles.typeChipText, leaveTypeId === card.leaveType.leave_type_id && styles.typeChipTextSelected])}>
              {card.leaveType.type_name}
            </Text>
          </Pressable>
        ))}
      </View>

      <DatePickerField label="Start date" value={startDate} onChange={setStartDate} />
      <DatePickerField label="End date" value={endDate} onChange={setEndDate} disabled={isHalfDay} />

      {selectedType?.leaveType.type_code && (
        <View style={styles.switchRow}>
          <Text style={styles.label}>Half day</Text>
          <Switch
            value={isHalfDay}
            onValueChange={(v) => {
              setIsHalfDay(v);
              if (v) setEndDate(startDate); // BR-34: a half-day is always a single-day span
            }}
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={colors.surface}
          />
        </View>
      )}

      <Text style={styles.label}>Reason</Text>
      <TextInput
        style={StyleSheet.flatten([styles.input, styles.multiline])}
        value={reason}
        onChangeText={setReason}
        placeholder="Reason for leave"
        placeholderTextColor={colors.textMuted}
        multiline
      />

      {selectedType?.leaveType.permits_attachments && (
        <>
          <Text style={styles.label}>Attachment (optional)</Text>
          <Pressable style={styles.attachButton} onPress={pickAttachment}>
            <Text style={styles.attachButtonText}>{attachment ? attachment.name : 'Choose a file (PDF/PNG/JPEG)'}</Text>
          </Pressable>
        </>
      )}

      {previewLoading && <ActivityIndicator style={styles.previewSpinner} color={colors.accent} />}
      {previewError && <Text style={styles.errorText}>{previewError}</Text>}
      {preview && (
        <View style={styles.previewBox}>
          <Text style={styles.previewLine}>Deducted working days: {preview.deductedWorkingDays}</Text>
          <Text style={styles.previewLine}>Effective balance: {preview.effectiveBalance}</Text>
          <Text style={styles.previewLine}>Projected balance after: {preview.projectedBalance}</Text>
          {preview.isAdvanceLeave && (
            <Text style={styles.warnLine}>This would put you {preview.shortfall} day(s) into advance leave.</Text>
          )}
        </View>
      )}

      <View style={styles.buttonRow}>
        <Pressable
          style={StyleSheet.flatten([styles.draftButton, (!leaveTypeId || !startDate || !endDate || !reason.trim()) && styles.submitDisabled])}
          disabled={!leaveTypeId || !startDate || !endDate || !reason.trim() || savingDraft}
          onPress={saveDraft}
        >
          {savingDraft ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.draftText}>Save Draft</Text>}
        </Pressable>
        <Pressable style={StyleSheet.flatten([styles.submitButton, !canSubmit && styles.submitDisabled])} disabled={!canSubmit || submitting} onPress={submit}>
          {submitting ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Submit Request</Text>}
        </Pressable>
      </View>
    </Screen>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 12 },
    typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    typeChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    typeChipText: { color: colors.textMuted, fontSize: 13 },
    typeChipTextSelected: { color: colors.accentContrast },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginTop: 6, backgroundColor: colors.surface, color: colors.text },
    multiline: { minHeight: 80, textAlignVertical: 'top' },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
    attachButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, marginTop: 6, backgroundColor: colors.surface },
    attachButtonText: { color: colors.accentText, fontSize: 13 },
    previewSpinner: { marginTop: 12 },
    errorText: { color: colors.danger, marginTop: 8 },
    previewBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: colors.border },
    previewLine: { color: colors.text, fontSize: 13, marginTop: 2 },
    warnLine: { color: colors.warning, fontSize: 13, marginTop: 6, fontWeight: '600' },
    buttonRow: { flexDirection: 'row', gap: 10, marginTop: 20, marginBottom: 40 },
    draftButton: { flex: 1, borderWidth: 1, borderColor: colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    draftText: { color: colors.accent, fontWeight: '700' },
    submitButton: { flex: 1, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700' },
  });
}
