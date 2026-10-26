import { useEffect, useState } from 'react';
import { Settings2, Save, AlertTriangle } from 'lucide-react';
import { listConfig, updateConfig } from '../../api/config';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import { PrimaryButton } from '../common/GlassButton';

const FIELD_META = {
  'leave_year.start_month_day': { label: 'Leave year start (MM-DD)', hint: 'Changes apply from the next leave year only — never retrospective.' },
  'weekend.days': { label: 'Weekend days', hint: 'Comma-separated, e.g. SAT,SUN' },
  'weekend.count_within_leave': { label: 'Count weekends within leave', hint: 'ON deducts weekend days inside a requested span.' },
  'holiday.count_within_leave': { label: 'Count public holidays within leave', hint: 'ON deducts holidays inside a requested span.' },
  timezone: { label: 'Time zone', hint: 'All dates, deadlines and scheduled jobs resolve in this zone.' },
  'approval.long_leave_threshold_days': { label: 'Long-leave HR threshold (days)', hint: 'Above this, HR/Admin second-stage approval is required.' },
  'approval.sla_working_days': { label: 'Approval SLA (working days)', hint: 'Per approval stage.' },
  'approval.sla_reminder_days_before': { label: 'SLA reminder (days before deadline)', hint: 'A reminder fires this many days before the SLA deadline.' },
  'backdating.window_days': { label: 'Backdating window (calendar days)', hint: 'Capped further at the current leave-year start.' },
  'advance_leave.withdrawal_window_days': { label: 'Advance-leave withdrawal window (days)', hint: 'Before an unwithdrawn rejection converts to loss of pay.' },
  'sick_leave.alert_threshold_days': { label: 'Sick-leave alert threshold (days)', hint: 'Above this, the supervisor/HR alerts fire.' },
  'sick_leave.alert_supervisor_enabled': { label: 'Sick-leave alert to supervisor', hint: 'Independent of the HR toggle.' },
  'sick_leave.alert_hr_enabled': { label: 'Sick-leave alert to HR/Admin', hint: 'Independent of the supervisor toggle.' },
  'holiday.optional_holiday_quota_override': { label: 'Optional holiday quota override', hint: '0 = auto (half of published optional holidays, rounded up). A positive number fixes the quota org-wide instead.' },
};

// weekend.days is stored as a JSON array string (e.g. '["SAT","SUN"]') — shown/edited here
// as a plain comma-separated list instead of raw JSON.
function toDisplayValue(key, rawValue) {
  if (key !== 'weekend.days') return rawValue;
  try { return JSON.parse(rawValue).join(','); } catch { return rawValue; }
}
function fromDisplayValue(key, displayValue) {
  if (key !== 'weekend.days') return displayValue;
  return JSON.stringify(displayValue.split(',').map((d) => d.trim().toUpperCase()).filter(Boolean));
}

// INT fields are freeform text inputs — validate client-side rather than letting a bad
// value round-trip to the server as a raw error.
function intFieldError(valueType, displayValue) {
  if (valueType !== 'INT') return null;
  if (!/^\d+$/.test(String(displayValue).trim())) {
    return 'Must be a whole number (0 or greater).';
  }
  return null;
}

export default function OrgConfigAdmin() {
  const [rows, setRows] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState(null);

  const load = () => {
    setError(null);
    listConfig().then((res) => setRows(res.data)).catch((err) => setError(err.message));
  };
  useEffect(() => { load(); }, []);

  const save = async (key, valueType) => {
    setSavingKey(key);
    try {
      await updateConfig(key, fromDisplayValue(key, drafts[key]), valueType);
      load();
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <GlassCard>
      <h3 className="h3 mb-1 flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-accent-text" /> Organisation configuration
      </h3>
      <p className="small muted mb-5">Every value here is read at runtime — nothing on this screen is a code constant.</p>

      {error ? (
        <EmptyState icon={AlertTriangle} title="Couldn't load configuration" description={error} />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const meta = FIELD_META[row.config_key] || { label: row.config_key };
            const displayStored = toDisplayValue(row.config_key, row.config_value);
            const draftValue = drafts[row.config_key] ?? displayStored;
            const dirty = draftValue !== displayStored;
            const fieldError = intFieldError(row.value_type, draftValue);

            return (
              <div key={row.config_key} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start bg-tint-2 rounded-md px-4 py-3">
                <div className="sm:col-span-1">
                  <p className="text-sm font-medium">{meta.label}</p>
                  {meta.hint && <p className="muted small mt-0.5">{meta.hint}</p>}
                </div>
                <div className="sm:col-span-2">
                  <div className="flex items-center gap-2">
                    {row.value_type === 'BOOL' ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={draftValue === 'true'}
                        aria-label={meta.label}
                        onClick={() => setDrafts((d) => ({ ...d, [row.config_key]: draftValue === 'true' ? 'false' : 'true' }))}
                        className="switch"
                      />
                    ) : (
                      <input className="input" value={draftValue}
                        placeholder={row.config_key === 'weekend.days' ? 'SAT,SUN' : undefined}
                        onChange={(e) => setDrafts((d) => ({ ...d, [row.config_key]: e.target.value }))} />
                    )}
                    {dirty && (
                      <PrimaryButton onClick={() => save(row.config_key, row.value_type)} disabled={savingKey === row.config_key || !!fieldError} className="!px-3">
                        <Save className="w-3.5 h-3.5" />
                      </PrimaryButton>
                    )}
                  </div>
                  {dirty && fieldError && <p className="error-msg mt-1.5">{fieldError}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
