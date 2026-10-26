import { useEffect, useState } from 'react';
import { avatarUrl } from '../../api/employees';

// Falls back to initials whenever there's no uploaded photo, or the stored file 404s
// (e.g. it was deleted on disk after the DB row was written).
export default function Avatar({ employee, size = 36, fontSize = 14, className = '' }) {
  const initials = employee?.full_name?.slice(0, 2).toUpperCase() || '??';
  // `has_avatar` is what the API returns; the stored path itself is never sent to the client.
  const src = employee?.has_avatar ? avatarUrl(employee.employee_id, employee.avatar_version) : null;
  const [failedSrc, setFailedSrc] = useState(null);

  // A 404 is remembered per-URL, not forever: without this, one missing file would keep the
  // initials showing even after the person uploaded a replacement.
  useEffect(() => { setFailedSrc(null); }, [src]);

  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={employee.full_name}
        onError={() => setFailedSrc(src)}
        className={className}
        style={{ width: size, height: size, borderRadius: 'var(--radius-pill)', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }

  return (
    <span
      className={`avatar ${className}`}
      style={{ width: size, height: size, fontSize, background: 'var(--color-accent)', color: 'var(--color-accent-contrast)' }}
    >
      {initials}
    </span>
  );
}
