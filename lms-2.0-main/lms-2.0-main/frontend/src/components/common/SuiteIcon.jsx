/**
 * The TT Suite's shared glyphs (the same paths as Kanban's components/Icon.tsx), so the top bar
 * and the Dashboard nav item look identical in every suite app. 24px grid, stroke from
 * currentColor; width/linecap come from the theme's --icon-stroke / --icon-linecap.
 */
const PATHS = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  logout: 'M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9',
};

// `strokeWidth` is accepted (and ignored) so this can stand in for a lucide icon; the suite
// stroke always comes from --icon-stroke.
// eslint-disable-next-line no-unused-vars
export default function SuiteIcon({ name, size = 20, strokeWidth, style, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{
        width: size,
        height: size,
        flex: 'none',
        strokeWidth: 'var(--icon-stroke, 1.75)',
        strokeLinecap: 'var(--icon-linecap, round)',
        ...style,
      }}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The suite's Dashboard glyph (a house), as a lucide-style component for the nav lists. */
export function HomeIcon(props) {
  return <SuiteIcon name="home" size={22} {...props} />;
}
