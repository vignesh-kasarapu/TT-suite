import { useState } from 'react';
import { Palette, Sun, Moon, Monitor, AlertTriangle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { removeMyAvatar, uploadMyAvatar } from '../api/employees';
import Avatar from '../components/common/Avatar';
import GlassCard from '../components/common/GlassCard';
import { SecondaryButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';

const MODE_ICON = { system: Monitor, light: Sun, dark: Moon };
const MODE_NAME = { system: 'System', light: 'Light', dark: 'Dark' };
const PRESET_NAME = { linen: 'Linen', harbour: 'Harbour', graphite: 'Graphite' };

/** One settings row: what it is on the left, the control on the right. */
function Row({ title, description, children }) {
  return (
    <GlassCard className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="muted small">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </GlassCard>
  );
}

/** Self-service preferences, open to every signed-in user whatever their role.
 * Theme preset and colour mode are TT Suite-wide (ThemeContext saves them to the
 * portal, PUT /api/me/preferences); the picture lives on the employee record. The
 * name is HR-controlled and has no field here, matching updateOwnProfile's
 * allow-list — see EditProfileModal for the personal details that are editable. */
export default function Preferences() {
  const { user, refreshUser } = useAuth();
  const { preset, mode, cyclePreset, cycleMode } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const emp = user?.employee || {};
  const ModeIcon = MODE_ICON[mode] || Monitor;

  const run = async (action, after) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      after?.();
    }
  };

  const choosePicture = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    run(() => uploadMyAvatar(file), () => { event.target.value = ''; });
  };

  return (
    <>
      <Topbar title="Preferences" />

      <div className="flex flex-col gap-4">
        <Row title="Theme preset" description="Colours and type. Press the button to cycle.">
          <SecondaryButton
            onClick={cyclePreset}
            aria-label={`Theme preset: ${PRESET_NAME[preset] || preset}, press to change`}
          >
            <Palette className="w-4 h-4" /> {PRESET_NAME[preset] || preset}
          </SecondaryButton>
        </Row>

        <Row title="Colour mode" description="System follows your device; Light and Dark force it.">
          <SecondaryButton onClick={cycleMode} aria-label={`Colour mode: ${mode}, press to change`}>
            <ModeIcon className="w-4 h-4" /> {MODE_NAME[mode] || mode}
          </SecondaryButton>
        </Row>

        <GlassCard className="flex flex-col sm:flex-row sm:items-center gap-4">
          <Avatar employee={emp} size={64} fontSize={20} />
          <div className="min-w-0 flex-1">
            <p className="font-medium">Picture</p>
            <p className="muted small">Any image; it is resized to a small square before upload.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap shrink-0">
            <label className="btn btn--secondary" style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Working…' : 'Choose a picture'}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={choosePicture}
                disabled={busy}
              />
            </label>
            {emp.has_avatar && (
              <button type="button" className="btn btn--ghost" onClick={() => run(removeMyAvatar)} disabled={busy}>
                Remove picture
              </button>
            )}
          </div>
        </GlassCard>

        {error && (
          <div className="alert alert--danger" role="alert">
            <AlertTriangle /> <p>{error}</p>
          </div>
        )}
      </div>
    </>
  );
}
