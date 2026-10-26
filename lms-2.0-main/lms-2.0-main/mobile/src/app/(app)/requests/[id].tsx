import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import { ApiError } from '../../../api/client';
import { downloadAttachment } from '../../../api/attachments';
import { getWatchableEmployees } from '../../../api/employees';
import * as leaveRequests from '../../../api/leaveRequests';
import { EmptyState, Screen } from '../../../components/Screen';
import { StatusPill } from '../../../components/StatusPill';
import { useApi } from '../../../hooks/useApi';
import { useSession } from '../../../services/session';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee } from '../../../types/models';

const WITHDRAWABLE_STATES = new Set(['PENDING_MANAGER', 'PENDING_HR', 'REJECTED_PENDING_WITHDRAWAL']);
const DECIDABLE_STATES = new Set(['PENDING_MANAGER', 'PENDING_HR']);

export default function RequestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = Number(id);
  const { me } = useSession();
  const isApprover = (me?.roles ?? []).some((r) => r === 'MANAGER' || r === 'HR_ADMIN');
  const { data, loading, error, reload } = useApi(() => leaveRequests.getDetail(requestId), [requestId]);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [candidates, setCandidates] = useState<Employee[]>([]);
  const [watcherBusy, setWatcherBusy] = useState(false);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const loadCandidates = () => {
    if (!isApprover) return;
    getWatchableEmployees().then(setCandidates).catch(() => {});
  };

  const withdraw = async () => {
    setBusy(true);
    try {
      await leaveRequests.withdraw(requestId);
      await reload();
    } catch (err) {
      Alert.alert('Could not withdraw', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = () => {
    Alert.alert('Discard draft?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await leaveRequests.discardDraft(requestId);
            router.back();
          } catch (err) {
            Alert.alert('Could not discard draft', err instanceof ApiError ? err.message : 'Something went wrong.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const submitDraft = async () => {
    setBusy(true);
    try {
      await leaveRequests.submitDraft(requestId);
      await reload();
    } catch (err) {
      Alert.alert('Could not submit draft', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const requestCancellation = async () => {
    setBusy(true);
    try {
      await leaveRequests.requestCancellation(requestId);
      await reload();
    } catch (err) {
      Alert.alert('Could not request cancellation', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      await leaveRequests.decide(requestId, 'APPROVE');
      await reload();
    } catch (err) {
      Alert.alert('Could not approve', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return;
    setBusy(true);
    try {
      await leaveRequests.decide(requestId, 'REJECT', rejectReason.trim());
      setShowRejectInput(false);
      setRejectReason('');
      await reload();
    } catch (err) {
      Alert.alert('Could not reject', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const addWatcher = async (watcherEmployeeId: number) => {
    setWatcherBusy(true);
    try {
      await leaveRequests.addWatcher(requestId, watcherEmployeeId);
      await reload();
    } catch (err) {
      Alert.alert('Could not add watcher', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setWatcherBusy(false);
    }
  };

  const removeWatcher = async (watcherId: number) => {
    setWatcherBusy(true);
    try {
      await leaveRequests.removeWatcher(requestId, watcherId);
      await reload();
    } catch (err) {
      Alert.alert('Could not remove watcher', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setWatcherBusy(false);
    }
  };

  const download = async (attachmentId: number, fileName: string) => {
    try {
      await downloadAttachment(attachmentId, fileName);
    } catch (err) {
      Alert.alert('Could not download', err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  if (data?.scope === 'DENIED') {
    return (
      <Screen loading={false} error={null}>
        <EmptyState text="You don't have permission to view this request." />
      </Screen>
    );
  }

  const full = data?.scope === 'FULL' ? data : null;
  const masked = data?.scope === 'WATCHER_MASKED' ? data : null;
  const request = full?.request ?? masked?.request ?? null;
  const isOwner = full !== null && full.request.employee_id === me?.employee.employee_id;
  const canDecide = full !== null && !isOwner && DECIDABLE_STATES.has(full.request.state);

  return (
    <Screen loading={loading} error={error} onRetry={reload}>
      {request && (
        <>
          <View style={styles.header}>
            <Text style={styles.dates}>{request.start_date} → {request.end_date}</Text>
            <StatusPill state={request.state} />
          </View>

          {data?.scope === 'WATCHER_MASKED' && (
            <Text style={styles.maskedNotice}>
              You're watching this request — full details (reason, attachments) are only visible to the employee,
              their approvers, and HR/Admin.
            </Text>
          )}

          <View style={styles.card}>
            <Row label="Deducted days" value={String(request.deducted_days ?? '–')} colors={colors} />
            {full && <Row label="Leave type" value={full.request.LeaveType?.type_name ?? '–'} colors={colors} />}
            {full && <Row label="Reason" value={full.request.reason} colors={colors} />}
            {masked && <Row label="Leave type" value={masked.request.leave_type_name} colors={colors} />}
          </View>

          {full && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Approval timeline</Text>
              {full.request.currentApprover && DECIDABLE_STATES.has(full.request.state) && (
                <Text style={styles.timelineNote}>Currently pending with: {full.request.currentApprover.full_name}</Text>
              )}
              {full.request.approvals.length === 0 ? (
                <Text style={styles.timelineNote}>No decisions recorded yet.</Text>
              ) : (
                full.request.approvals.map((a) => (
                  <View key={a.approval_id} style={styles.timelineRow}>
                    <Text style={styles.timelineNote}>
                      {a.stage} · {a.decision === 'APPROVE' ? 'Approved' : 'Rejected'}
                      {a.on_behalf_of_id && ' (as delegate)'}
                    </Text>
                    {a.reason && <Text style={styles.timelineReason}>{a.reason}</Text>}
                    <Text style={styles.timelineDate}>{new Date(a.decision_timestamp).toLocaleString()}</Text>
                  </View>
                ))
              )}
            </View>
          )}

          {isOwner && request.state === 'DRAFT' && (
            <View style={styles.decideRow}>
              <Pressable style={StyleSheet.flatten([styles.actionButton, styles.cancelButton])} disabled={busy} onPress={discardDraft}>
                <Text style={styles.actionText}>Discard Draft</Text>
              </Pressable>
              <Pressable style={styles.actionButton} disabled={busy} onPress={submitDraft}>
                {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.actionText}>Submit Draft</Text>}
              </Pressable>
            </View>
          )}

          {isOwner && WITHDRAWABLE_STATES.has(request.state) && (
            <Pressable style={styles.actionButton} disabled={busy} onPress={withdraw}>
              {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.actionText}>Withdraw</Text>}
            </Pressable>
          )}

          {isOwner && request.state === 'APPROVED' && (
            <Pressable style={StyleSheet.flatten([styles.actionButton, styles.cancelButton])} disabled={busy} onPress={requestCancellation}>
              {busy ? <ActivityIndicator color={colors.dangerContrast} /> : <Text style={styles.actionText}>Request Cancellation</Text>}
            </Pressable>
          )}

          {canDecide && (
            <View style={styles.decideBox}>
              <Text style={styles.decideTitle}>Your decision</Text>
              {!showRejectInput ? (
                <View style={styles.decideRow}>
                  <Pressable style={StyleSheet.flatten([styles.actionButton, styles.approveButton])} disabled={busy} onPress={approve}>
                    <Text style={styles.actionText}>Approve</Text>
                  </Pressable>
                  <Pressable style={StyleSheet.flatten([styles.actionButton, styles.cancelButton])} disabled={busy} onPress={() => setShowRejectInput(true)}>
                    <Text style={styles.actionText}>Reject</Text>
                  </Pressable>
                </View>
              ) : (
                <>
                  <TextInput
                    style={styles.reasonInput}
                    placeholder="Reason for rejection (required)"
                    placeholderTextColor={colors.textMuted}
                    value={rejectReason}
                    onChangeText={setRejectReason}
                    multiline
                  />
                  <View style={styles.decideRow}>
                    <Pressable
                      style={StyleSheet.flatten([styles.actionButton, styles.cancelButton, !rejectReason.trim() && styles.disabled])}
                      disabled={busy || !rejectReason.trim()}
                      onPress={reject}
                    >
                      {busy ? <ActivityIndicator color={colors.dangerContrast} /> : <Text style={styles.actionText}>Confirm Reject</Text>}
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          )}

          {full && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Watchers</Text>
              {full.request.watchers.length === 0 ? (
                <Text style={styles.timelineNote}>No watchers on this request.</Text>
              ) : (
                full.request.watchers.map((w) => (
                  <View key={w.watcher_id} style={styles.watcherRow}>
                    <Text style={styles.watcherName}>{w.watcherEmployee?.full_name ?? `Employee #${w.watcher_employee_id}`}</Text>
                    {isApprover && (
                      <Pressable disabled={watcherBusy} onPress={() => removeWatcher(w.watcher_id)} hitSlop={8}>
                        <Text style={styles.removeWatcher}>Remove</Text>
                      </Pressable>
                    )}
                  </View>
                ))
              )}
              {isApprover && (
                <>
                  {candidates.length === 0 ? (
                    <Pressable onPress={loadCandidates} style={styles.loadCandidates}>
                      <Text style={styles.loadCandidatesText}>Add a watcher…</Text>
                    </Pressable>
                  ) : (
                    candidates
                      .filter((c) => !full.request.watchers.some((w) => w.watcher_employee_id === c.employee_id))
                      .map((c) => (
                        <Pressable key={c.employee_id} disabled={watcherBusy} onPress={() => addWatcher(c.employee_id)} style={styles.candidateRow}>
                          <Text style={styles.candidateText}>+ {c.full_name}</Text>
                        </Pressable>
                      ))
                  )}
                </>
              )}
            </View>
          )}

          {full && full.request.LeaveType?.permits_attachments && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Attachments</Text>
              {full.request.attachments.length === 0 ? (
                <Text style={styles.timelineNote}>No attachments uploaded.</Text>
              ) : (
                full.request.attachments.map((a) => (
                  <Pressable key={a.attachment_id} style={styles.attachmentRow} onPress={() => download(a.attachment_id, a.file_name)}>
                    <Text style={styles.attachmentName} numberOfLines={1}>{a.file_name}</Text>
                    <Text style={styles.attachmentSize}>{(a.size_bytes / 1024).toFixed(0)} KB</Text>
                  </Pressable>
                ))
              )}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function Row({ label, value, colors }: { label: string; value: string; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    dates: { fontSize: 18, fontWeight: '700', color: colors.text },
    maskedNotice: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
    card: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
    sectionTitle: { fontWeight: '700', color: colors.text, marginBottom: 4 },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    rowLabel: { color: colors.textMuted, fontSize: 13 },
    rowValue: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
    timelineRow: { marginTop: 4 },
    timelineNote: { color: colors.textMuted, fontSize: 13 },
    timelineReason: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    timelineDate: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    actionButton: { flex: 1, backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
    approveButton: { backgroundColor: colors.success },
    cancelButton: { backgroundColor: colors.danger },
    disabled: { opacity: 0.5 },
    actionText: { color: colors.accentContrast, fontWeight: '700' },
    decideBox: { backgroundColor: colors.surface, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
    decideTitle: { fontWeight: '700', color: colors.text, marginBottom: 8 },
    decideRow: { flexDirection: 'row', gap: 8 },
    reasonInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, minHeight: 60, textAlignVertical: 'top', marginBottom: 8, color: colors.text },
    watcherRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.tint2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
    watcherName: { color: colors.text, fontSize: 13 },
    removeWatcher: { color: colors.danger, fontSize: 12, fontWeight: '600' },
    loadCandidates: { marginTop: 4 },
    loadCandidatesText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    candidateRow: { paddingVertical: 6 },
    candidateText: { color: colors.accentText, fontSize: 13 },
    attachmentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.tint2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
    attachmentName: { color: colors.text, fontSize: 13, flex: 1, marginRight: 8 },
    attachmentSize: { color: colors.textMuted, fontSize: 12 },
  });
}
