import confetti from 'canvas-confetti';

/** A short, tasteful confetti burst from the center of the screen — used for
 * moments worth celebrating (submitting leave, approving leave, onboarding). */
export function celebrate() {
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 45,
    origin: { y: 0.6 },
    zIndex: 9999,
    colors: ['#8b6dff', '#22d3ee', '#34d399', '#f59e0b'],
  });
}

/** Two angled bursts from the lower corners — party poppers rather than the single
 * centre burst above. Used when someone is given a role, which is a promotion worth
 * marking more loudly than a routine approval. */
export function celebratePromotion() {
  const colors = ['#8b6dff', '#22d3ee', '#34d399', '#f59e0b', '#ef4444'];
  const shared = { particleCount: 70, startVelocity: 55, spread: 60, zIndex: 9999, colors, ticks: 220 };
  confetti({ ...shared, angle: 60, origin: { x: 0, y: 0.75 } });
  confetti({ ...shared, angle: 120, origin: { x: 1, y: 0.75 } });
}
