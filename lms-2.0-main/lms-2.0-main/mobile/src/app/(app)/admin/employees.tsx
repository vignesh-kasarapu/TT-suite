import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../../../utils/alert';

import * as employees from '../../../api/employees';
import * as employeesAdmin from '../../../api/employeesAdmin';
import { ApiError } from '../../../api/client';
import * as orgStructureRef from '../../../api/orgStructureRef';
import { DatePickerField } from '../../../components/DatePickerField';
import { EmployeePicker } from '../../../components/EmployeePicker';
import { EmptyState, Screen } from '../../../components/Screen';
import { useApi } from '../../../hooks/useApi';
import type { Palette } from '../../../theme/colors';
import { useThemeColors } from '../../../theme/ThemeContext';
import type { Employee } from '../../../types/models';

const ROLE_OPTIONS = ['MANAGER', 'HR_ADMIN'];
type ActionPanel = 'edit' | 'roles' | 'reassign' | 'deactivate' | null;

function FieldLabel({ text, required, colors }: { text: string; required?: boolean; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Text style={styles.label}>
      {text}
      {required && <Text style={styles.required}> *</Text>}
    </Text>
  );
}

/** LMS-016/017/018/019 — onboarding, role toggles (through the existing
 * last-HR_ADMIN guard, server-enforced), deactivation (final-settlement
 * snapshot) and manager reassignment (pending requests stay put unless
 * explicitly transferred). CSV bulk import is deliberately excluded from
 * mobile per the plan — that stays a web-only workflow. */
export default function EmployeesAdmin() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [showOnboard, setShowOnboard] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [panel, setPanel] = useState<ActionPanel>(null);
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const runSearch = () => {
    setLoading(true);
    employees
      .listEmployees(search.trim() || undefined)
      .then(setResults)
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (employeeId: number) => {
    if (expandedId === employeeId) {
      setExpandedId(null);
      setPanel(null);
    } else {
      setExpandedId(employeeId);
      setPanel(null);
    }
  };

  return (
    <Screen loading={false} error={null}>
      <Pressable style={styles.toggleButton} onPress={() => setShowOnboard((s) => !s)}>
        <Text style={styles.toggleText}>{showOnboard ? 'Cancel' : '+ Onboard Employee'}</Text>
      </Pressable>
      {showOnboard && <OnboardForm onDone={() => { setShowOnboard(false); runSearch(); }} colors={colors} />}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name or employee code…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={runSearch}
        />
        <Pressable style={styles.searchButton} onPress={runSearch}>
          <Text style={styles.searchButtonText}>Search</Text>
        </Pressable>
      </View>

      {loading && <ActivityIndicator color={colors.accent} />}
      {!loading && results.length === 0 && <EmptyState text="No employees found." />}
      {results.map((e) => (
        <View key={e.employee_id} style={styles.card}>
          <Pressable style={styles.header} onPress={() => toggle(e.employee_id)}>
            <View style={styles.headerMain}>
              <Text style={styles.name}>{e.full_name}</Text>
              <Text style={styles.meta}>{e.employee_code} · {e.designation ?? '–'} · {e.status}</Text>
            </View>
            <Text style={styles.chevron}>{expandedId === e.employee_id ? '︿' : '﹀'}</Text>
          </Pressable>
          {expandedId === e.employee_id && (
            <View style={styles.actionsBox}>
              <View style={styles.actionTabs}>
                <ActionTab label="Edit" active={panel === 'edit'} onPress={() => setPanel('edit')} colors={colors} />
                <ActionTab label="Roles" active={panel === 'roles'} onPress={() => setPanel('roles')} colors={colors} />
                <ActionTab label="Reassign" active={panel === 'reassign'} onPress={() => setPanel('reassign')} colors={colors} />
                <ActionTab label="Deactivate" active={panel === 'deactivate'} onPress={() => setPanel('deactivate')} colors={colors} />
              </View>
              {panel === 'edit' && <EditForm employee={e} onDone={runSearch} colors={colors} />}
              {panel === 'roles' && <RolesForm employee={e} colors={colors} />}
              {panel === 'reassign' && <ReassignForm employee={e} onDone={runSearch} colors={colors} />}
              {panel === 'deactivate' && <DeactivateForm employee={e} onDone={runSearch} colors={colors} />}
            </View>
          )}
        </View>
      ))}
    </Screen>
  );
}

function ActionTab({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable style={StyleSheet.flatten([styles.tab, active && styles.tabActive])} onPress={onPress}>
      <Text style={StyleSheet.flatten([styles.tabText, active && styles.tabTextActive])}>{label}</Text>
    </Pressable>
  );
}

function OnboardForm({ onDone, colors }: { onDone: () => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: regions } = useApi(orgStructureRef.listRegions);
  const { data: levels } = useApi(orgStructureRef.listManagementLevels);
  const [fullName, setFullName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [designation, setDesignation] = useState('');
  const [dateOfJoining, setDateOfJoining] = useState('');
  const [roleCode, setRoleCode] = useState<string | null>(null);
  const [departmentName, setDepartmentName] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [regionId, setRegionId] = useState<number | null>(null);
  const [managementLevelId, setManagementLevelId] = useState<number | null>(null);
  const [gender, setGender] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [manager, setManager] = useState<Employee | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = fullName.trim() && workEmail.trim() && employeeCode.trim() && designation.trim() && dateOfJoining;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await employeesAdmin.onboardEmployee({
        full_name: fullName.trim(),
        work_email: workEmail.trim(),
        employee_code: employeeCode.trim().toUpperCase(),
        designation: designation.trim(),
        date_of_joining: dateOfJoining,
        role_code: roleCode,
        department_name: departmentName.trim() || null,
        grade_id: gradeId ? parseInt(gradeId, 10) : null,
        region_id: regionId,
        management_level_id: managementLevelId,
        gender: gender.trim() || null,
        marital_status: maritalStatus.trim() || null,
        reporting_manager_id: manager?.employee_id ?? null,
      });
      onDone();
    } catch (err) {
      Alert.alert('Could not onboard employee', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.formCard}>
      <FieldLabel text="Full name" required colors={colors} />
      <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Work email" required colors={colors} />
      <TextInput style={styles.input} value={workEmail} onChangeText={setWorkEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Employee code" required colors={colors} />
      <TextInput style={styles.input} value={employeeCode} onChangeText={setEmployeeCode} autoCapitalize="characters" placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Designation" required colors={colors} />
      <TextInput style={styles.input} value={designation} onChangeText={setDesignation} placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Date of joining" required colors={colors} />
      <DatePickerField label="" value={dateOfJoining} onChange={setDateOfJoining} />

      <FieldLabel text="Initial role (optional)" colors={colors} />
      <View style={styles.chipRow}>
        {['EMPLOYEE', 'MANAGER', 'HR_ADMIN'].map((r) => (
          <Pressable key={r} style={StyleSheet.flatten([styles.chip, roleCode === r && styles.chipSelected])} onPress={() => setRoleCode(roleCode === r ? null : r)}>
            <Text style={StyleSheet.flatten([styles.chipText, roleCode === r && styles.chipTextSelected])}>{r}</Text>
          </Pressable>
        ))}
      </View>

      <FieldLabel text="Department (optional)" colors={colors} />
      <TextInput style={styles.input} value={departmentName} onChangeText={setDepartmentName} placeholderTextColor={colors.textMuted} />

      <FieldLabel text="Grade ID (optional)" colors={colors} />
      <TextInput style={styles.input} value={gradeId} onChangeText={setGradeId} keyboardType="number-pad" placeholderTextColor={colors.textMuted} />

      <FieldLabel text="Region (optional)" colors={colors} />
      <View style={styles.chipRow}>
        {regions?.map((r) => (
          <Pressable key={r.region_id} style={StyleSheet.flatten([styles.chip, regionId === r.region_id && styles.chipSelected])} onPress={() => setRegionId(regionId === r.region_id ? null : r.region_id)}>
            <Text style={StyleSheet.flatten([styles.chipText, regionId === r.region_id && styles.chipTextSelected])}>{r.region_name}</Text>
          </Pressable>
        ))}
      </View>

      <FieldLabel text="Management level (optional)" colors={colors} />
      <View style={styles.chipRow}>
        {levels?.map((l) => (
          <Pressable key={l.management_level_id} style={StyleSheet.flatten([styles.chip, managementLevelId === l.management_level_id && styles.chipSelected])} onPress={() => setManagementLevelId(managementLevelId === l.management_level_id ? null : l.management_level_id)}>
            <Text style={StyleSheet.flatten([styles.chipText, managementLevelId === l.management_level_id && styles.chipTextSelected])}>{l.level_name}</Text>
          </Pressable>
        ))}
      </View>

      <FieldLabel text="Gender (optional)" colors={colors} />
      <TextInput style={styles.input} value={gender} onChangeText={setGender} placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Marital status (optional)" colors={colors} />
      <TextInput style={styles.input} value={maritalStatus} onChangeText={setMaritalStatus} placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Reporting manager (optional)" colors={colors} />
      <EmployeePicker label="" value={manager} onSelect={setManager} />

      <Pressable style={StyleSheet.flatten([styles.submitButton, !canSubmit && styles.submitDisabled])} disabled={busy || !canSubmit} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Onboard</Text>}
      </Pressable>
    </View>
  );
}

function EditForm({ employee, onDone, colors }: { employee: Employee; onDone: () => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: regions } = useApi(orgStructureRef.listRegions);
  const { data: levels } = useApi(orgStructureRef.listManagementLevels);
  const [fullName, setFullName] = useState(employee.full_name);
  const [designation, setDesignation] = useState(employee.designation ?? '');
  const [departmentName, setDepartmentName] = useState('');
  const [regionId, setRegionId] = useState<number | null>(employee.region_id);
  const [managementLevelId, setManagementLevelId] = useState<number | null>(employee.management_level_id);
  const [gender, setGender] = useState(employee.gender ?? '');
  const [maritalStatus, setMaritalStatus] = useState(employee.marital_status ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await employeesAdmin.updateEmployeeDetails(employee.employee_id, {
        full_name: fullName.trim(),
        designation: designation.trim(),
        department_name: departmentName.trim() || undefined,
        region_id: regionId,
        management_level_id: managementLevelId,
        gender: gender.trim() || null,
        marital_status: maritalStatus.trim() || null,
      });
      onDone();
    } catch (err) {
      Alert.alert('Could not update', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.readOnlyRow}>Employee code: {employee.employee_code}</Text>
      <Text style={styles.readOnlyRow}>Work email: {employee.work_email}</Text>
      <Text style={styles.readOnlyRow}>Status: {employee.status}</Text>

      <FieldLabel text="Full name" colors={colors} />
      <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Designation" colors={colors} />
      <TextInput style={styles.input} value={designation} onChangeText={setDesignation} placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Change department (optional)" colors={colors} />
      <TextInput style={styles.input} value={departmentName} onChangeText={setDepartmentName} placeholder="Leave blank to keep current" placeholderTextColor={colors.textMuted} />

      <FieldLabel text="Region" colors={colors} />
      <View style={styles.chipRow}>
        {regions?.map((r) => (
          <Pressable key={r.region_id} style={StyleSheet.flatten([styles.chip, regionId === r.region_id && styles.chipSelected])} onPress={() => setRegionId(regionId === r.region_id ? null : r.region_id)}>
            <Text style={StyleSheet.flatten([styles.chipText, regionId === r.region_id && styles.chipTextSelected])}>{r.region_name}</Text>
          </Pressable>
        ))}
      </View>

      <FieldLabel text="Management level" colors={colors} />
      <View style={styles.chipRow}>
        {levels?.map((l) => (
          <Pressable key={l.management_level_id} style={StyleSheet.flatten([styles.chip, managementLevelId === l.management_level_id && styles.chipSelected])} onPress={() => setManagementLevelId(managementLevelId === l.management_level_id ? null : l.management_level_id)}>
            <Text style={StyleSheet.flatten([styles.chipText, managementLevelId === l.management_level_id && styles.chipTextSelected])}>{l.level_name}</Text>
          </Pressable>
        ))}
      </View>

      <FieldLabel text="Gender" colors={colors} />
      <TextInput style={styles.input} value={gender} onChangeText={setGender} placeholderTextColor={colors.textMuted} />
      <FieldLabel text="Marital status" colors={colors} />
      <TextInput style={styles.input} value={maritalStatus} onChangeText={setMaritalStatus} placeholderTextColor={colors.textMuted} />

      <Pressable style={styles.submitButton} disabled={busy} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Save</Text>}
      </Pressable>
    </View>
  );
}

function RolesForm({ employee, colors }: { employee: Employee; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: roles, reload } = useApi(() => employeesAdmin.listRoles(employee.employee_id), [employee.employee_id]);
  const [busy, setBusy] = useState(false);

  const toggle = async (roleCode: string) => {
    setBusy(true);
    try {
      if (roles?.includes(roleCode)) await employeesAdmin.revokeRole(employee.employee_id, roleCode);
      else await employeesAdmin.assignRole(employee.employee_id, roleCode);
      await reload();
    } catch (err) {
      Alert.alert('Could not update role', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <View style={styles.chipRow}>
        {ROLE_OPTIONS.map((role) => (
          <Pressable key={role} disabled={busy} style={StyleSheet.flatten([styles.chip, roles?.includes(role) && styles.chipSelected])} onPress={() => toggle(role)}>
            <Text style={StyleSheet.flatten([styles.chipText, roles?.includes(role) && styles.chipTextSelected])}>{role}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ReassignForm({ employee, onDone, colors }: { employee: Employee; onDone: () => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [newManager, setNewManager] = useState<Employee | null>(null);
  const [transferPending, setTransferPending] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!newManager) return;
    setBusy(true);
    try {
      await employeesAdmin.reassignManager(employee.employee_id, newManager.employee_id, transferPending);
      onDone();
    } catch (err) {
      Alert.alert('Could not reassign manager', err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.panel}>
      <EmployeePicker label="New manager" value={newManager} onSelect={setNewManager} />
      <Pressable style={styles.checkboxRow} onPress={() => setTransferPending((v) => !v)}>
        <Text style={styles.checkbox}>{transferPending ? '☑' : '☐'}</Text>
        <Text style={styles.checkboxLabel}>Transfer pending requests to new manager</Text>
      </Pressable>
      <Pressable style={StyleSheet.flatten([styles.submitButton, !newManager && styles.submitDisabled])} disabled={busy || !newManager} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.accentContrast} /> : <Text style={styles.submitText}>Reassign</Text>}
      </Pressable>
    </View>
  );
}

function DeactivateForm({ employee, onDone, colors }: { employee: Employee; onDone: () => void; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [lastWorkingDay, setLastWorkingDay] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = () => {
    if (!lastWorkingDay) return;
    Alert.alert('Deactivate employee?', `${employee.full_name} will be deactivated as of ${lastWorkingDay}. This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Deactivate',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await employeesAdmin.deactivateEmployee(employee.employee_id, lastWorkingDay);
            onDone();
          } catch (err) {
            Alert.alert('Could not deactivate', err instanceof ApiError ? err.message : 'Something went wrong.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.panel}>
      <DatePickerField label="Last working day" value={lastWorkingDay} onChange={setLastWorkingDay} />
      <Pressable style={StyleSheet.flatten([styles.dangerButton, !lastWorkingDay && styles.submitDisabled])} disabled={busy || !lastWorkingDay} onPress={submit}>
        {busy ? <ActivityIndicator color={colors.dangerContrast} /> : <Text style={styles.dangerText}>Deactivate</Text>}
      </Pressable>
    </View>
  );
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    toggleButton: { alignSelf: 'flex-start' },
    toggleText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
    formCard: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, gap: 8 },
    searchRow: { flexDirection: 'row', gap: 8 },
    searchInput: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.surface, color: colors.text },
    searchButton: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' },
    searchButtonText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
    headerMain: { flex: 1 },
    name: { fontWeight: '700', color: colors.text },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
    chevron: { color: colors.textMuted },
    actionsBox: { borderTopWidth: 1, borderTopColor: colors.border, padding: 12, gap: 8 },
    actionTabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
    tabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    tabTextActive: { color: colors.accentContrast },
    panel: { gap: 8 },
    label: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
    required: { color: colors.danger, fontWeight: '700' },
    readOnlyRow: { fontSize: 12, color: colors.textMuted },
    input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, backgroundColor: colors.bg, color: colors.text },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
    chipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { fontSize: 12, color: colors.textMuted },
    chipTextSelected: { color: colors.accentContrast },
    checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    checkbox: { fontSize: 16, color: colors.accent },
    checkboxLabel: { fontSize: 12, color: colors.textMuted, flex: 1 },
    submitButton: { backgroundColor: colors.accent, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    submitDisabled: { opacity: 0.5 },
    submitText: { color: colors.accentContrast, fontWeight: '700', fontSize: 13 },
    dangerButton: { backgroundColor: colors.danger, borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 4 },
    dangerText: { color: colors.dangerContrast, fontWeight: '700', fontSize: 13 },
  });
}
