/**
 * Full-viewport background for the login page.
 * A static, non-animated wash built entirely from tokens: two soft
 * color-mix() tints of the accent color against the page background,
 * anchored top-right and bottom-left. No blur, no glow, no motion —
 * just enough tonal variation to keep the hero from reading as a flat
 * fill, in line with theme.md's "no page-load or scroll-triggered
 * motion" rule.
 */
export default function BackgroundEffects() {
  return (
    <div
      className="fixed inset-0 -z-10"
      style={{
        background:
          'radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--color-accent) 10%, var(--color-bg)) 0%, var(--color-bg) 60%), ' +
          'radial-gradient(120% 90% at 0% 100%, color-mix(in srgb, var(--color-accent) 7%, var(--color-bg)) 0%, var(--color-bg) 60%)',
      }}
      aria-hidden="true"
    />
  );
}
