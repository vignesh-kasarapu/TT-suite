import { useEffect, useState } from 'react';

// Breakpoints per ui-theme/theme.md §4: mobile < 640px, tablet 640-1023, desktop >= 1024.
export const BREAKPOINTS = { tablet: '(min-width: 640px)', desktop: '(min-width: 1024px)' };

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  ));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
