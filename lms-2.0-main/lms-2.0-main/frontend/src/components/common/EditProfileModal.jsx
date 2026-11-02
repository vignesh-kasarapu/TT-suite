import { ExternalLink } from 'lucide-react';
import Modal from './Modal';
import Avatar from './Avatar';
import { SecondaryButton } from './GlassButton';
import { useAuth } from '../../context/AuthContext';
import { normaliseMarital } from '../../utils/maritalStatus';

/** "My details" — read-only.
 *
 * A person's own details belong to their TT Suite profile and are copied into LMS on every
 * request (app/core/deps.py's suite sync), so editing them here would be overwritten on the
 * next page load. Everything personal is edited once, at /profile, and shows in every app.
 * Department, designation, region, grade and role are HR's and live in Administration.
 */
export default function EditProfileModal({ onClose }) {
  const { user } = useAuth();
  const emp = user?.employee || {};

  const rows = [
    ['Work email', emp.work_email],
    ['Employee code', emp.employee_code],
    ['Phone', emp.phone],
    ['Personal email', emp.personal_email],
    ['Date of birth', emp.date_of_birth],
    ['Gender', emp.gender],
    ['Marital status', normaliseMarital(emp.marital_status)],
    ['Emergency contact', emp.emergency_contact_name],
    ['Emergency contact phone', emp.emergency_contact_phone],
  ];

  return (
    <Modal open onClose={onClose} title="My details">
      <div className="flex items-center gap-4 mb-4">
        <Avatar employee={emp} size={64} />
        <div className="min-w-0">
          <p className="name">{emp.full_name}</p>
          <p className="muted small">{emp.designation || 'Employee'}</p>
        </div>
      </div>

      <div className="alert alert--info mb-4" role="status">
        <ExternalLink />
        <p>
          These details come from your TT Suite profile. Change them once there and every app —
          LMS, Expense, Kanban and Asset Management — shows the new value.
        </p>
      </div>

      <dl className="list">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="small muted">{label}</dt>
            <dd className="small">{value || '—'}</dd>
          </div>
        ))}
      </dl>

      <p className="hint mt-3">
        Department, designation, reporting manager, region and grade are managed by HR in
        Administration.
      </p>

      <div className="actions" style={{ marginTop: 'var(--space-4)', justifyContent: 'flex-end' }}>
        <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        <a href="/profile" className="btn btn--primary">
          Edit in TT Suite <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </Modal>
  );
}
