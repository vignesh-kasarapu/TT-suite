import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuiteHeaderControls } from '../components/SuiteHeaderControls';

function stubPortal(me: Record<string, unknown>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/me' && !init?.method) {
      return Promise.resolve({ ok: true, json: async () => me });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Suite header controls', () => {
  beforeEach(() => {
    document.documentElement.dataset.preset = 'harbour';
    document.documentElement.dataset.theme = 'light';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('shows toggle, divider, profile and sign out in that order, and no inbox (the Inbox is on the dashboard)', async () => {
    stubPortal({ name: 'Jordan Lee', photoUrl: null });
    const onSignOut = vi.fn();
    render(<SuiteHeaderControls name="Jordan Lee" onSignOut={onSignOut} />);

    const controls = screen.getByTestId('suite-header-controls');
    const order = Array.from(controls.children).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['theme-toggle', 'header-divider', 'profile-link', 'header-sign-out']);
    expect(screen.queryByTestId('inbox-link')).not.toBeInTheDocument();

    expect(screen.getByTestId('profile-link')).toHaveAttribute('href', '/profile');
    await waitFor(() => {
      expect(screen.getByTestId('profile-link')).toHaveTextContent('JLJordan Lee');
    });

    // Sign out opens a card in place (no navigation, no local cleanup yet).
    await userEvent.setup().click(screen.getByTestId('header-sign-out'));
    expect(screen.getByTestId('signout-dialog')).toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it('signs out of all devices from the card, then cleans up locally and goes to /login', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === '/api/me/sessions') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              { current: true, userAgent: 'A', createdAt: '', lastSeenAt: '' },
              { current: false, userAgent: 'B', createdAt: '', lastSeenAt: '' },
              { current: false, userAgent: 'C', createdAt: '', lastSeenAt: '' },
            ],
          }),
        });
      }
      if (url === '/api/auth/logout' && init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ name: 'Jordan Lee' }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const onSignOut = vi.fn();
    render(<SuiteHeaderControls name="Jordan Lee" onSignOut={onSignOut} />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('header-sign-out'));
    const dialog = screen.getByTestId('signout-dialog');
    await waitFor(() => {
      expect(dialog).toHaveTextContent("You're signed in on 3 devices.");
    });
    expect(screen.getByTestId('signout-all')).toHaveTextContent('Sign out of all devices (3)');

    await user.click(screen.getByTestId('signout-all'));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/login');
    });
    const post = fetchMock.mock.calls.find(([url]) => url === '/api/auth/logout');
    expect(post).toBeDefined();
    const init = post![1] as RequestInit;
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('XHR');
    expect(JSON.parse(init.body as string)).toEqual({ everywhere: true });
    expect(onSignOut).toHaveBeenCalled();
  });

  it('toggles light/dark at once and saves it as the suite preference', async () => {
    const fetchMock = stubPortal({ name: 'Jordan Lee' });
    render(<SuiteHeaderControls name="Jordan Lee" onSignOut={() => undefined} />);

    const toggle = screen.getByTestId('theme-toggle');
    expect(toggle).toHaveAttribute('aria-label', 'Switch to dark mode');

    await userEvent.setup().click(toggle);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.preset).toBe('harbour');
    await waitFor(() => {
      expect(screen.getByTestId('theme-toggle')).toHaveAttribute('aria-label', 'Switch to light mode');
    });
    const put = fetchMock.mock.calls.find(([url]) => url === '/api/me/preferences');
    expect(put).toBeDefined();
    const init = put![1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Requested-With']).toBe('XHR');
    expect(JSON.parse(init.body as string)).toEqual({ preset: 'harbour', mode: 'dark' });
    expect(JSON.parse(localStorage.getItem('ams_theme') ?? '{}')).toEqual({ preset: 'harbour', mode: 'dark' });
  });
});
