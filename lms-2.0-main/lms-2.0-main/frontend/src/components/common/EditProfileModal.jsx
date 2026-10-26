import { useState } from 'react';
import { AlertTriangle, Camera } from 'lucide-react';
import Modal from './Modal';
import Avatar from './Avatar';
import { PrimaryButton, SecondaryButton } from './GlassButton';
import { updateMyProfile, uploadMyAvatar } from '../../api/employees';
import { useAuth } from '../../context/AuthContext';

/** Self-service "Edit profile" — deliberately limited to personal/contact details.
 * Name, department, designation, region, grade and role are HR-controlled and have no
 * field here (see backend employeeService.updateOwnProfile's allow-list). */
export default function EditProfileModal({ onClose }) {
  const { user, refreshUser } = useAuth();
  const emp = user?.employee || {};
  const [form, setForm] = useState({
    phone: emp.phone || '',
    personalEmail: emp.personal_email || '',
    dateOfBirth: emp.date_of_birth || '',
    gender: emp.gender || '',
    maritalStatus: emp.marital_status || '',
    emergencyContactName: emp.emergency_contact_name || '',
    emergencyContactPhone: emp.emergency_contact_phone || '',
  });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState(null);

  const updateField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setError(null);
    try {
      await uploadMyAvatar(file);
      await refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await updateMyProfile(form);
      await refreshUser();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Edit profile" maxWidth="max-w-xl">
      <div className="flex items-center gap-4 mb-5 pb-5 border-b border-border">
        <Avatar employee={emp} size={64} fontSize={20} />
        <div>
          <label className="btn btn--secondary btn--sm" style={{ cursor: uploadingPhoto ? 'not-allowed' : 'pointer' }}>
            <Camera className="w-4 h-4" /> {uploadingPhoto ? 'Uploading…' : 'Change photo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handlePhotoChange}
              disabled={uploadingPhoto}
            />
          </label>
          <p className="hint mt-1.5">PNG, JPEG or WEBP, up to 3MB.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="hint">
          Only your personal details are editable here — name, department, designation and role are managed by HR.
        </p>

        <div className="grid2">
          <div className="field">
            <label>Phone</label>
            <input className="input" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="+91 98765 43210" />
          </div>
          <div className="field">
            <label>Personal email</label>
            <input type="email" className="input" value={form.personalEmail} onChange={(e) => updateField('personalEmail', e.target.value)} placeholder="you@example.com" />
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label>Date of birth</label>
            <input type="date" className="input" value={form.dateOfBirth || ''} onChange={(e) => updateField('dateOfBirth', e.target.value)} />
          </div>
          <div className="field">
            <label>Gender</label>
            <select className="input" value={form.gender} onChange={(e) => updateField('gender', e.target.value)}>
              <option value="">Prefer not to say</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label>Marital status</label>
          <input className="input" value={form.maritalStatus} onChange={(e) => updateField('maritalStatus', e.target.value)} placeholder="e.g. Single, Married" />
        </div>

        <div className="grid2">
          <div className="field">
            <label>Emergency contact name</label>
            <input className="input" value={form.emergencyContactName} onChange={(e) => updateField('emergencyContactName', e.target.value)} />
          </div>
          <div className="field">
            <label>Emergency contact phone</label>
            <input className="input" value={form.emergencyContactPhone} onChange={(e) => updateField('emergencyContactPhone', e.target.value)} />
          </div>
        </div>

        {error && (
          <div className="alert alert--danger" role="alert">
            <AlertTriangle /> <p>{error}</p>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <PrimaryButton type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</PrimaryButton>
          <SecondaryButton type="button" onClick={onClose} disabled={saving}>Cancel</SecondaryButton>
        </div>
      </form>
    </Modal>
  );
}
