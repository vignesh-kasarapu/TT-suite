import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuiteHeaderControls, unreadLabel } from '../components/SuiteHeaderControls';

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

  it('shows toggle, inbox, profile and sign out in that order, with the unread badge', async () => {
    stubPortal({ name: 'Jordan Lee', photoUrl: null, unreadCount: 3 });
    const onSignOut = vi.fn();
    render(<SuiteHeaderControls name="Jordan Lee" onSignOut={onSignOut} />);

    const controls = screen.getByTestId('suite-header-controls');
    const order = Array.from(controls.children).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['theme-toggle', 'inbox-link', 'profile-link', 'header-sign-out']);

    expect(screen.getByTestId('inbox-link')).toHaveAttribute('href', '/inbox');
    expect(screen.getByTestId('profile-link')).toHaveAttribute('href', '/profile');
    expect(screen.getByTestId('profile-link')).toHaveTextContent('JLJordan Lee');

    await waitFor(() => {
      expect(screen.getByTestId('inbox-badge')).toHaveTextContent('3');
    });
    expect(screen.getByTestId('inbox-link')).toHaveAttribute('aria-label', 'Inbox, 3 unread');

    await userEvent.setup().click(screen.getByTestId('header-sign-out'));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('has no badge without unread messages and caps it at 99+', async () => {
    stubPortal({ name: 'Jordan Lee', unreadCount: 0 });
    render(<SuiteHeaderControls name="Jordan Lee" onSignOut={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByTestId('inbox-link')).toHaveAttribute('aria-label', 'Inbox');
    });
    expect(screen.queryByTestId('inbox-badge')).not.toBeInTheDocument();
    expect(unreadLabel(5)).toBe('5');
    expect(unreadLabel(150)).toBe('99+');
  });

  it('toggles light/dark at once and saves it as the suite preference', async () => {
    const fetchMock = stubPortal({ name: 'Jordan Lee', unreadCount: 0 });
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
