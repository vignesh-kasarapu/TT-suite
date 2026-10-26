// S12 Preferences (FR-170, D-112): one cycling button per setting; each press applies the
// value immediately and saves it via updateMyPreferences. Digest opt-in + calendar feed: B08/B09.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Alert, Button, Skeleton } from '../../components';
import { Icon } from '../../components/Icon';
import { api, asProblem, problemMessage, unwrap } from '../../api/client';
import { t } from '../../i18n/t';
import { nextMode, nextPreset, type Mode, type Preset } from '../../theme/theme-switch';
import { useThemePreferences } from '../auth/suite';
import {
  ME_KEY,
  PREFS_KEY,
  useContextData,
  usePreferences,
  type Preferences as Prefs,
} from '../auth/useMe';
import { Avatar } from '../../components/Avatar';
import { useProjects } from '../org/api';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { pageTitleClass } from '../Shell';
import s from './pages.module.css';

const PRESET_LABEL: Record<Preset, string> = {
  linen: t('prefs.preset.linen'),
  harbour: t('prefs.preset.harbour'),
  graphite: t('prefs.preset.graphite'),
};
const MODE_LABEL: Record<Mode, string> = {
  system: t('prefs.mode.system'),
  light: t('prefs.mode.light'),
  dark: t('prefs.mode.dark'),
};

/** CR-19: the retention window offered on Preferences; the contract allows 1..365. */
const INBOX_WINDOWS = [7, 14, 30, 60, 90] as const;

function asPreset(v: string): Preset {
  return v === 'harbour' || v === 'graphite' ? v : 'linen';
}
function asMode(v: string): Mode {
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** Resize an image file to a square JPEG data URL (<= 256 px) in the browser - no upload of originals. */
export async function toAvatarDataUrl(file: File, size = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    size,
    size,
  );
  return canvas.toDataURL('image/jpeg', 0.85);
}

function Profile() {
  const me = useContextData();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.user.name);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ME_KEY });
  const fail = (p: unknown) => {
    setError(problemBanner(p as Problem));
    setFieldError(fieldErrorsOf(p as Problem)['name'] ?? fieldErrorsOf(p as Problem)['dataUrl']);
  };
  const saveName = useMutation({
    mutationFn: async () => unwrap(await api.PATCH('/me/profile', { body: { name: name.trim() } })),
    onSuccess: refresh,
    onError: fail,
  });
  const savePhoto = useMutation({
    mutationFn: async (file: File) =>
      unwrap(await api.PUT('/me/photo', { body: { dataUrl: await toAvatarDataUrl(file) } })),
    onSuccess: refresh,
    onError: fail,
  });
  const removePhoto = useMutation({
    mutationFn: async () => {
      const res = await api.DELETE('/me/photo');
      if (!res.response.ok)
        throw asProblem(res.error) ?? { status: res.response.status, code: 'NETWORK' };
    },
    onSuccess: refresh,
    onError: fail,
  });
  return (
    <section className={s.settings} aria-label={t('profile.title')} data-testid="profile">
      <h2 className={s.settingTitle}>{t('profile.title')}</h2>
      <p className={s.settingHint}>{t('profile.lead')}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <form
        className={s.setting}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (name.trim()) saveName.mutate();
        }}
      >
        <label className={s.settingTitle} htmlFor="profile-name">
          {t('profile.name')}
        </label>
        <input
          id="profile-name"
          className={s.input}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          aria-describedby={fieldError ? 'profile-name-error' : undefined}
          required
          data-testid="profile-name"
        />
        {fieldError ? (
          <span id="profile-name-error" className={s.settingHint}>
            {fieldError}
          </span>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          busy={saveName.isPending}
          data-testid="profile-save"
        >
          {t('card.save')}
        </Button>
      </form>
      <div className={s.setting}>
        <Avatar user={me.user} size={64} />
        <div>
          <h3 className={s.settingTitle}>{t('profile.picture')}</h3>
          <p className={s.settingHint}>{t('profile.pictureHint')}</p>
        </div>
        <label className={s.settingHint}>
          <span className="visually-hidden">{t('profile.upload')}</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setError(null);
              if (f) savePhoto.mutate(f);
              e.target.value = '';
            }}
            data-testid="profile-photo"
          />
        </label>
        {me.user.photoUpdatedAt ? (
          <Button
            variant="ghost"
            onClick={() => removePhoto.mutate()}
            busy={removePhoto.isPending}
            data-testid="profile-photo-remove"
          >
            {t('profile.remove')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** D-077: primary team / project and the order rule for the Org tab. */
function Defaults({ prefs, onChange }: { prefs: Prefs; onChange: (p: Partial<Prefs>) => void }) {
  const me = useContextData();
  const projects = useProjects();
  const myTeamIds = new Set(me.teams.map((tm) => tm.id));
  // CR-12: a project that takes no new cards makes a poor default for creating them.
  const mine = (projects.data?.items ?? []).filter((p) => myTeamIds.has(p.team.id) && p.accepting);
  return (
    <section className={s.settings} aria-label={t('prefs.defaults')} data-testid="defaults">
      <div className={s.setting}>
        <div>
          <h2 className={s.settingTitle}>{t('prefs.defaultsTitle')}</h2>
          <p className={s.settingHint}>{t('prefs.defaultsHint')}</p>
        </div>
        <div className={s.fields}>
          <label className={s.fieldCol}>
            <span>{t('card.team')}</span>
            <select
              className={s.input}
              value={prefs.primaryTeamId ?? ''}
              onChange={(e) => onChange({ primaryTeamId: e.target.value || null })}
              data-testid="default-team"
            >
              <option value="">{t('card.none')}</option>
              {me.teams.map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </label>
          <label className={s.fieldCol}>
            <span>{t('card.project')}</span>
            <select
              className={s.input}
              value={prefs.primaryProjectId ?? ''}
              onChange={(e) => onChange({ primaryProjectId: e.target.value || null })}
              data-testid="default-project"
            >
              <option value="">{t('card.none')}</option>
              {mine.map((p) => (
                <option key={p.id} value={p.id}>{`${p.team.name} / ${p.name}`}</option>
              ))}
            </select>
          </label>
          <label className={s.fieldCol}>
            <span>{t('prefs.orgOrder')}</span>
            <select
              className={s.input}
              value={prefs.orgOrder}
              onChange={(e) => onChange({ orgOrder: e.target.value as Prefs['orgOrder'] })}
              data-testid="default-order"
            >
              <option value="team_first">{t('prefs.teamFirst')}</option>
              <option value="project_first">{t('prefs.projectFirst')}</option>
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}

export function Preferences() {
  const queryClient = useQueryClient();
  const prefs = usePreferences(true);
  // Rapid presses overlap: only the newest save's answer may replace the cache.
  const seq = useRef(0);
  const save = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const mine = ++seq.current;
      const data = unwrap(await api.PATCH('/me/preferences', { body: patch }));
      return { data, latest: mine === seq.current };
    },
    onSuccess: ({ data, latest }) => {
      if (latest) queryClient.setQueryData(PREFS_KEY, data);
    },
  });
  // TT Suite (SUITE-CONTRACT §3.4): the preset and colour mode are the suite's, saved to the
  // portal for every app; the rest of this page stays Kanban's own.
  const theme = useThemePreferences();
  if (prefs.isPending || !prefs.data || !theme.current)
    return <Skeleton lines={3} label={t('prefs.loading')} />;
  const preset = asPreset(theme.current.preset);
  const mode = asMode(theme.current.mode);

  function cyclePreset() {
    theme.set({ preset: nextPreset(preset) }); // applied at once (D-112), then saved
  }
  function cycleMode() {
    theme.set({ mode: nextMode(mode) });
  }

  return (
    <>
      <h1 className={pageTitleClass}>{t('prefs.title')}</h1>
      {save.isError || theme.error ? (
        <Alert tone="danger">{problemMessage(asProblem(save.error ?? theme.error))}</Alert>
      ) : null}
      <section className={s.settings} aria-label={t('prefs.appearance')}>
        <div className={s.setting}>
          <div>
            <h2 className={s.settingTitle}>{t('prefs.presetTitle')}</h2>
            <p className={s.settingHint}>{t('prefs.presetHint')}</p>
          </div>
          <Button
            variant="secondary"
            onClick={cyclePreset}
            aria-label={t('prefs.presetAria', { value: PRESET_LABEL[preset] })}
            title={t('prefs.nextTip', { value: PRESET_LABEL[nextPreset(preset)] })}
            data-testid="preset-button"
          >
            <Icon name="palette" size={18} />
            {PRESET_LABEL[preset]}
          </Button>
        </div>
        <div className={s.setting}>
          <div>
            <h2 className={s.settingTitle}>{t('prefs.modeTitle')}</h2>
            <p className={s.settingHint}>{t('prefs.modeHint')}</p>
          </div>
          <Button
            variant="secondary"
            onClick={cycleMode}
            aria-label={t('prefs.modeAria', { value: MODE_LABEL[mode] })}
            title={t('prefs.nextTip', { value: MODE_LABEL[nextMode(mode)] })}
            data-testid="mode-button"
          >
            <Icon name="moon" size={18} />
            {MODE_LABEL[mode]}
          </Button>
        </div>
      </section>
      <section className={s.settings} aria-label={t('prefs.notifications')}>
        <div className={s.setting}>
          <div>
            <h2 className={s.settingTitle}>{t('prefs.notifyTitle')}</h2>
            <p className={s.settingHint}>{t('prefs.notifyHint')}</p>
          </div>
          <label className={s.settingHint}>
            <input
              type="checkbox"
              checked={prefs.data.notifyEmail}
              onChange={(e) => {
                queryClient.setQueryData(PREFS_KEY, {
                  ...prefs.data,
                  notifyEmail: e.target.checked,
                });
                save.mutate({ notifyEmail: e.target.checked });
              }}
              data-testid="notify-email"
            />{' '}
            {t('prefs.notifyLabel')}
          </label>
        </div>
      </section>
      <section className={s.settings} aria-label={t('prefs.inboxTitle')}>
        <div className={s.setting}>
          <div>
            <h2 className={s.settingTitle}>{t('prefs.inboxTitle')}</h2>
            <p className={s.settingHint}>{t('prefs.inboxHint')}</p>
          </div>
          <select
            className={s.input}
            aria-label={t('prefs.inboxTitle')}
            value={prefs.data.inboxWindowDays}
            onChange={(e) => {
              const days = Number(e.target.value);
              queryClient.setQueryData(PREFS_KEY, { ...prefs.data, inboxWindowDays: days });
              save.mutate({ inboxWindowDays: days });
            }}
            data-testid="inbox-window"
          >
            {INBOX_WINDOWS.map((d) => (
              <option key={d} value={d}>
                {t('prefs.inboxDays', { n: d })}
              </option>
            ))}
          </select>
        </div>
      </section>
      <Defaults
        prefs={prefs.data}
        onChange={(patch) => {
          queryClient.setQueryData(PREFS_KEY, { ...prefs.data, ...patch });
          save.mutate(patch);
        }}
      />
      <p className={s.settingHint} role="status">
        {save.isPending ? t('prefs.saving') : save.isSuccess ? t('prefs.saved') : ''}
      </p>
      <Profile />
    </>
  );
}
