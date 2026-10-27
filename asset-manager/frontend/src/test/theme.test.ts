import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPreferences, loadSuiteTheme } from '../theme/theme-switch';

describe('TT Suite theme', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('applies the preset and mode to <html>, falling back to linen / system', () => {
    expect(applyPreferences({ preset: 'graphite', mode: 'dark' })).toEqual({ preset: 'graphite', mode: 'dark' });
    expect(document.documentElement.dataset.preset).toBe('graphite');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.querySelector('link[data-font="graphite"]')).not.toBeNull();

    expect(applyPreferences({ preset: 'neon', mode: 'sepia' })).toEqual({ preset: 'linen', mode: 'system' });
    expect(document.documentElement.dataset.preset).toBe('linen');
  });

  it("reads the person's preference from the portal's /api/me", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ preferences: { preset: 'harbour', mode: 'light' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await loadSuiteTheme();

    expect(fetchMock).toHaveBeenCalledWith('/api/me', { credentials: 'same-origin' });
    expect(document.documentElement.dataset.preset).toBe('harbour');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
