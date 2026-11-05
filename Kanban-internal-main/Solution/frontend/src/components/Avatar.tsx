// Avatar (D-064): the user's picture when they have one, initials otherwise. The picture URL
// carries photoUpdatedAt as a cache-buster; a 404 falls back to initials.
import { useState } from 'react';
import { API_BASE } from '../api/client';
import s from './components.module.css';

export function Avatar({
  user,
  size = 28,
}: {
  user: { id: string; name: string; photoUpdatedAt?: string | null };
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (user.photoUpdatedAt && !broken)
    return (
      <img
        className={s.avatar}
        style={style}
        src={`${API_BASE}/users/${user.id}/photo?v=${encodeURIComponent(user.photoUpdatedAt)}`}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        data-testid="avatar-img"
      />
    );
  return (
    <span className={s.avatar} style={style} aria-hidden="true" data-testid="avatar-initials">
      {initials}
    </span>
  );
}
