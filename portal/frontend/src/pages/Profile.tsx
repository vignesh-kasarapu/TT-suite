import { useState } from 'react';
import { api, APPS, type Preferences } from '../api';
import { Avatar, Banner, RoleBadge } from '../components/ui';
import { applyMode, applyPreset, MODES, PRESETS, type Mode, type Preset } from '../theme/theme-switch';
import { useMe } from '../useMe';
import s from '../styles/portal.module.css';

// Preview colours of each preset (bg, surface, accent) - the values tokens.css defines for light mode.
const PREVIEW: Record<Preset, { label: string; font: string; colors: string[] }> = {
  linen: { label: 'Linen', font: 'Figtree', colors: ['#F4F2EE', '#FFFFFF', '#2E6B45'] },
  harbour: { label: 'Harbour', font: 'Inter', colors: ['#F2F5F9', '#FFFFFF', '#1A6BB3'] },
  graphite: { label: 'Graphite', font: 'IBM Plex Sans', colors: ['#F5F5F6', '#FFFFFF', '#4B3FB0'] },
};
const MODE_LABEL: Record<Mode, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** Profile: who you are, your access, and the one theme every app uses. */
export function Profile() {
  const { me, setMe } = useMe();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(next: Preferences) {
    applyPreset(next.preset);
    applyMode(next.mode);
    setMe({ ...me, preferences: next });
    setSaved(false);
    try {
      const stored = await api<Preferences>('/api/me/preferences', { method: 'PUT', body: JSON.stringify(next) });
      setMe({ ...me, preferences: stored });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const { preset, mode } = me.preferences;
  return (
    <div className={s.stack}>
      <div className={s.pageHead}>
        <h1 className={s.pageTitle}>Profile</h1>
      </div>
      <section className={s.panel}>
        <div className={s.profileHead}>
          {me.photoUrl ? <img className={s.profilePhoto} src={me.photoUrl} alt="" /> : <Avatar name={me.name} photoUrl={null} />}
          <div>
            <h2 className={s.section}>{me.name}</h2>
            <p className={s.muted}>{me.email}</p>
            {me.isGlobalAdmin ? <span className={s.badge}>Global admin</span> : null}
          </div>
        </div>
      </section>

      <section className={s.panel} aria-labelledby="access-h">
        <h2 id="access-h" className={s.cardTitle}>Your access</h2>
        <table className={s.table}>
          <tbody>
            {APPS.map((a) => (
              <tr key={a.key}>
                <td>{a.title}</td>
                <td><RoleBadge role={me.access[a.key]} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={s.panel} aria-labelledby="theme-h">
        <div className={s.stack}>
          <div>
            <h2 id="theme-h" className={s.cardTitle}>Theme</h2>
            <p className={s.muted}>Applies to the dashboard and to Leave, Expense and Kanban.</p>
          </div>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          {saved ? <Banner tone="ok" onClose={() => setSaved(false)}>Theme saved for all apps.</Banner> : null}
          <div className={s.presets} role="group" aria-label="Preset">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={s.preset}
                aria-pressed={preset === p}
                onClick={() => void save({ preset: p, mode })}
                data-testid={`preset-${p}`}
              >
                <span className={s.swatches} aria-hidden="true">
                  {PREVIEW[p].colors.map((c) => (
                    <span key={c} className={s.swatch} style={{ background: c }} />
                  ))}
                </span>
                <strong>{PREVIEW[p].label}</strong>
                <span className={s.caption}>{PREVIEW[p].font}</span>
              </button>
            ))}
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel} id="mode-l">Mode</span>
            <div className={s.segmented} role="group" aria-labelledby="mode-l">
              {MODES.map((m) => (
                <button key={m} type="button" className={s.segment} aria-pressed={mode === m} onClick={() => void save({ preset, mode: m })}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
