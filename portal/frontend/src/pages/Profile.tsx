import { useEffect, useRef, useState } from 'react';
import { activeApps, api, HIDDEN_UNLESS_GRANTED, describeDevice, timeAgo, type AppKey, type Device, type Me, type Preferences } from '../api';
import { Icon } from '../components/Icon';
import { Banner } from '../components/ui';
import { SignOutDialog } from '../components/SignOutDialog';
import { applyMode, applyPreset, MODES, PRESETS, type Mode, type Preset } from '../theme/theme-switch';
import { useMe } from '../useMe';
import p from '../styles/profile.module.css';

const PRESET_LABEL: Record<Preset, string> = { linen: 'Linen', harbour: 'Harbour', graphite: 'Graphite' };
const MODE_LABEL: Record<Mode, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const MODE_ICON: Record<Mode, string> = { system: 'laptop', light: 'moon', dark: 'sun' };
const APP_LOOK: Record<AppKey, { icon: string; tint: string }> = {
  lms: { icon: 'calendar', tint: p.tintLms ?? '' },
  expense: { icon: 'receipt', tint: p.tintExpense ?? '' },
  kanban: { icon: 'board', tint: p.tintKanban ?? '' },
  ams: { icon: 'package', tint: p.tintAms ?? '' },
  resume: { icon: 'filecheck', tint: p.tintResume ?? '' },
};
const TABS = [
  { id: 'profile', label: 'Profile', icon: 'user' },
  { id: 'access', label: 'Access', icon: 'lock' },
  { id: 'sessions', label: 'Sessions', icon: 'history' },
  { id: 'theme', label: 'Theme', icon: 'palette' },
] as const;

type Details = { name: string; jobTitle: string; phone: string; location: string };

function detailsOf(me: Me): Details {
  return { name: me.name, jobTitle: me.jobTitle ?? '', phone: me.phone ?? '', location: me.location ?? '' };
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Profile: who you are (edited here only; every app picks it up), your access, your devices and the
 * one theme every app uses. The apps have no profile or preferences screens of their own. */
export function Profile() {
  const { me, setMe } = useMe();
  const [active, setActive] = useState<string>('profile');

  // The tab strip follows the section you are reading.
  useEffect(() => {
    const seen = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: '-140px 0px -55% 0px' },
    );
    TABS.forEach((t) => { const el = document.getElementById(t.id); if (el) seen.observe(el); });
    return () => seen.disconnect();
  }, []);

  return (
    <div className={p.page}>
      <header className={p.head}>
        <h1 className={p.title}>Profile</h1>
        <p className={p.subtitle}>Manage your profile, access, theme and connected devices.</p>
      </header>

      <nav className={p.tabs} aria-label="Profile sections">
        {TABS.map((t) => (
          <a key={t.id} href={`#${t.id}`} className={p.tab} aria-current={active === t.id ? 'true' : undefined}
            onClick={() => setActive(t.id)} data-testid={`profile-tab-${t.id}`}>
            <Icon name={t.icon} size={18} />
            {t.label}
          </a>
        ))}
        <a href="/inbox" className={p.tab} data-testid="profile-tab-notifications">
          <Icon name="bell" size={18} />
          Notifications
        </a>
      </nav>

      <IdentityCard me={me} setMe={setMe} />
      <AboutCard me={me} setMe={setMe} />
      <AccessCard me={me} />
      <SessionsCard />
      <ThemeCard me={me} setMe={setMe} />
    </div>
  );
}

type MeProps = { me: Me; setMe: (me: Me) => void };

function IdentityCard({ me, setMe }: MeProps) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(f: File) {
    setError(null);
    setBusy(true);
    try {
      const next = await api<Me>('/api/me/photo', { method: 'PUT', body: f, headers: { 'content-type': f.type } });
      setMe({ ...me, photoUrl: next.photoUrl ? `${next.photoUrl}?v=${Date.now()}` : null });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  async function remove() {
    setError(null);
    setBusy(true);
    try {
      const next = await api<Me>('/api/me/photo', { method: 'DELETE' });
      setMe({ ...me, photoUrl: next.photoUrl });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const photo = me.photoUrl;
  return (
    <section id="profile" className={p.card} aria-label="Your profile">
      <div className={p.identity}>
        <div className={p.photoWrap}>
          {photo ? <img className={p.photo} src={photo} alt="" /> : <span className={p.photo} aria-hidden="true">{initials(me.name)}</span>}
          <button type="button" className={p.photoBadge} onClick={() => file.current?.click()} disabled={busy} aria-label="Change photo" title="Change photo">
            <Icon name="camera" size={16} />
          </button>
        </div>
        <div className={p.who}>
          <h2 className={p.name}>{me.name}</h2>
          <span className={p.email}>{me.email}</span>
          {me.employeeCode ? <span className={p.caption} data-testid="profile-employee-code">Employee code {me.employeeCode}</span> : null}
          {me.isGlobalAdmin ? <span className={p.pill}>Global admin</span> : null}
          {me.jobTitle || me.location ? <span className={p.caption}>{[me.jobTitle, me.location].filter(Boolean).join(' · ')}</span> : null}
        </div>
        <div className={p.actions}>
          {me.photoUrl ? (
            <button type="button" className={`${p.button} ${p.outline} ${p.small}`} onClick={() => void remove()} disabled={busy}>Remove photo</button>
          ) : null}
          <button type="button" className={`${p.button} ${p.outline} ${p.small}`} onClick={() => file.current?.click()} disabled={busy} data-testid="change-photo">
            <Icon name="pencil" size={16} />
            Change photo
          </button>
        </div>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className={p.srOnly} tabIndex={-1} aria-hidden="true"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} data-testid="photo-file" />
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </section>
  );
}

function AboutCard({ me, setMe }: MeProps) {
  const [details, setDetails] = useState<Details>(detailsOf(me));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = (Object.keys(details) as (keyof Details)[]).some((k) => details[k].trim() !== detailsOf(me)[k]);

  function edit(field: keyof Details, value: string) {
    setDetails({ ...details, [field]: value });
    setSaved(false);
  }

  async function save() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const next = await api<Me>('/api/me/profile', { method: 'PUT', body: JSON.stringify(details) });
      setMe({ ...me, name: next.name, jobTitle: next.jobTitle, phone: next.phone, location: next.location });
      setDetails(detailsOf(next));
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={p.card} aria-labelledby="about-h" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div>
        <h2 id="about-h" className={p.cardTitle}>About you</h2>
        <p className={p.cardSub}>Your profile information is used across Tektalis.</p>
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {saved ? <Banner tone="ok" onClose={() => setSaved(false)}>Saved. Every app shows your new details from your next visit.</Banner> : null}
      <div className={p.fields}>
        <label className={p.field}>
          <span className={p.label}>Name<span className={p.required} aria-hidden="true">*</span></span>
          <input className={p.input} value={details.name} onChange={(e) => edit('name', e.target.value)} maxLength={200} required autoComplete="name" data-testid="profile-name" />
        </label>
        <label className={p.field}>
          <span className={p.label}>Job title</span>
          <input className={p.input} value={details.jobTitle} onChange={(e) => edit('jobTitle', e.target.value)} maxLength={120} autoComplete="organization-title" placeholder="e.g. Software engineer" data-testid="profile-job-title" />
        </label>
        <label className={p.field}>
          <span className={p.label}>Phone</span>
          <input className={p.input} type="tel" value={details.phone} onChange={(e) => edit('phone', e.target.value)} maxLength={30} autoComplete="tel" placeholder="+91 98765 43210" data-testid="profile-phone" />
        </label>
        <label className={p.field}>
          <span className={p.label}>Location</span>
          <input className={p.input} value={details.location} onChange={(e) => edit('location', e.target.value)} maxLength={120} placeholder="Hyderabad" data-testid="profile-location" />
        </label>
        <label className={`${p.field} ${p.fieldWide}`}>
          <span className={p.label}>Email</span>
          <input className={p.input} value={me.email} disabled />
        </label>
        <label className={p.field}>
          <span className={p.label}>Employee code</span>
          <input className={p.input} value={me.employeeCode ?? ''} disabled placeholder="Not set yet" />
        </label>
      </div>
      <div className={p.actions}>
        <button type="submit" className={p.button} disabled={busy || !changed || !details.name.trim()} data-testid="profile-save">Save changes</button>
        <button type="button" className={`${p.button} ${p.outline}`} disabled={busy || !changed} onClick={() => { setDetails(detailsOf(me)); setError(null); }}>Cancel</button>
      </div>
      <p className={p.caption}>Your email is your Microsoft sign-in. Only a global admin can change it or your employee code.</p>
    </form>
  );
}

function AccessCard({ me }: { me: Me }) {
  return (
    <section id="access" className={p.card} aria-labelledby="access-h">
      <div>
        <h2 id="access-h" className={p.cardTitle}>Your access</h2>
        <p className={p.cardSub}>The apps you can open and your role in each. A global admin changes these.</p>
      </div>
      <table className={p.table}>
        <thead>
          <tr><th scope="col">Area</th><th scope="col">Role</th></tr>
        </thead>
        <tbody>
          {activeApps(me).filter((a) => me.access[a.key] || !HIDDEN_UNLESS_GRANTED.has(a.key)).map((a) => {
            const role = me.access[a.key];
            return (
              <tr key={a.key}>
                <td>
                  <span className={p.area}>
                    <span className={`${p.appIcon} ${APP_LOOK[a.key].tint}`}><Icon name={APP_LOOK[a.key].icon} size={20} /></span>
                    {a.title}
                  </span>
                </td>
                <td>
                  <span className={role ? p.pill : `${p.pill} ${p.pillMuted}`}>
                    {role ? role.charAt(0).toUpperCase() + role.slice(1) : 'No access'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function SessionsCard() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const load = () => api<{ items: Device[] }>('/api/me/sessions').then((d) => setDevices(d.items)).catch(() => setDevices([]));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menu]);

  async function endSession(d: Device) {
    setMenu(null);
    setError(null);
    try {
      await api(`/api/me/sessions/${d.key}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section id="sessions" className={p.card} aria-labelledby="sessions-h">
      <div className={p.cardHead}>
        <div>
          <h2 id="sessions-h" className={p.cardTitle}>Signed in on</h2>
          <p className={p.cardSub}>Devices where you are currently signed in.</p>
        </div>
        <button type="button" className={`${p.button} ${p.danger} ${p.small}`} onClick={() => setSigningOut(true)} data-testid="profile-signout-all">
          <Icon name="logout" size={16} />
          Sign out all devices
        </button>
      </div>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <ul className={p.devices}>
        {devices.map((d) => {
          const mobile = /Mobile|Android|iPhone|iPad/i.test(d.userAgent);
          return (
            <li key={d.key} className={p.device}>
              <span className={p.deviceIcon}><Icon name={mobile ? 'phone' : 'laptop'} size={28} /></span>
              <div className={p.deviceBody}>
                <span className={p.deviceName}>
                  {describeDevice(d.userAgent)}{d.current ? ' (this device)' : ''}
                  {d.current ? <span className={p.pill}>Current device</span> : null}
                </span>
                <span className={p.caption}>Last active {timeAgo(d.lastSeenAt)} · signed in {timeAgo(d.createdAt)}</span>
              </div>
              <div className={p.menuWrap}>
                <button type="button" className={p.iconButton} aria-label={`Options for ${describeDevice(d.userAgent)}`} aria-haspopup="menu"
                  aria-expanded={menu === d.key} onClick={(e) => { e.stopPropagation(); setMenu(menu === d.key ? null : d.key); }}>
                  <Icon name="more" size={20} />
                </button>
                {menu === d.key ? (
                  <div className={p.menu} role="menu">
                    {d.current ? (
                      <button type="button" role="menuitem" onClick={() => { setMenu(null); setSigningOut(true); }}>Sign out…</button>
                    ) : (
                      <button type="button" role="menuitem" className={p.menuDanger} onClick={() => void endSession(d)} data-testid={`end-session-${d.key}`}>
                        Sign out this device
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <p className={p.caption}>You stay signed in while you use the suite. After 24 hours without activity (or 30 days at most) you sign in again.</p>
      <SignOutDialog open={signingOut} onClose={() => setSigningOut(false)} />
    </section>
  );
}

function ThemeCard({ me, setMe }: MeProps) {
  const [error, setError] = useState<string | null>(null);
  const preset = (PRESETS.includes(me.preferences.preset as Preset) ? me.preferences.preset : 'linen') as Preset;
  const mode = (MODES.includes(me.preferences.mode as Mode) ? me.preferences.mode : 'system') as Mode;

  async function save(next: Preferences) {
    applyPreset(next.preset);
    applyMode(next.mode);
    setMe({ ...me, preferences: next });
    setError(null);
    try {
      const stored = await api<Preferences>('/api/me/preferences', { method: 'PUT', body: JSON.stringify(next) });
      setMe({ ...me, preferences: stored });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Each press moves to the next option (Linen → Harbour → Graphite → Linen; System → Light → Dark → System).
  const nextPreset = PRESETS[(PRESETS.indexOf(preset) + 1) % PRESETS.length] as Preset;
  const nextMode = MODES[(MODES.indexOf(mode) + 1) % MODES.length] as Mode;

  return (
    <section id="theme" className={p.themeRows} aria-label="Theme">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <div className={p.settingRow}>
        <div>
          <h2 className={p.settingTitle}>Theme preset</h2>
          <p className={p.cardSub}>Colours and type. Press the button to cycle.</p>
        </div>
        <button type="button" className={`${p.button} ${p.outline}`} onClick={() => void save({ preset: nextPreset, mode })}
          aria-label={`Theme preset: ${PRESET_LABEL[preset]}. Switch to ${PRESET_LABEL[nextPreset]}`} data-testid="preset-cycle">
          <Icon name="palette" size={18} />
          {PRESET_LABEL[preset]}
        </button>
      </div>
      <div className={p.settingRow}>
        <div>
          <h2 className={p.settingTitle}>Colour mode</h2>
          <p className={p.cardSub}>System follows your device; Light and Dark force it.</p>
        </div>
        <button type="button" className={`${p.button} ${p.outline}`} onClick={() => void save({ preset, mode: nextMode })}
          aria-label={`Colour mode: ${MODE_LABEL[mode]}. Switch to ${MODE_LABEL[nextMode]}`} data-testid="mode-cycle">
          <Icon name={MODE_ICON[mode]} size={18} />
          {MODE_LABEL[mode]}
        </button>
      </div>
    </section>
  );
}
