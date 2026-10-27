import React from 'react';

// TT Suite: the shared top-bar / nav glyphs, copied from Kanban's components/Icon.tsx so every
// suite app draws the same icons. 24 px grid, stroke from currentColor; width and linecap follow
// the preset via --icon-stroke / --icon-linecap.
const PATHS = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9',
} as const;

export type SuiteIconName = keyof typeof PATHS;

const STROKE_STYLE: React.CSSProperties = {
  strokeWidth: 'var(--icon-stroke, 1.75)',
  strokeLinecap: 'var(--icon-linecap, round)' as React.CSSProperties['strokeLinecap'],
};

export const SuiteIcon: React.FC<{ name: SuiteIconName; size?: number; className?: string }> = ({
  name,
  size = 22,
  className,
}) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeLinejoin="round"
    style={STROKE_STYLE}
    className={className}
  >
    <path d={PATHS[name]} />
  </svg>
);
