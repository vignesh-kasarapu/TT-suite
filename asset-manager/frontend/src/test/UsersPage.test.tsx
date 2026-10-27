import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { UsersPage } from '../pages/UsersPage';
import * as usersApi from '../api/users';
import type { User } from '../types';

vi.mock('../api/users', () => ({
  listUsersApi: vi.fn(),
  listRoleRequestsApi: vi.fn(),
  requestRoleChangeApi: vi.fn(),
}));

const MOCK_USERS: User[] = [
  {
    id: 1,
    name: 'Tektalis Admin',
    email: 'admin@tektalis.com',
    role: 'ADMIN',
    active: true,
    created_at: '2026-10-19T12:00:00Z',
  },
  {
    id: 2,
    name: 'Alex Morgan',
    email: 'manager@tektalis.com',
    role: 'ASSET_MANAGER',
    active: true,
    created_at: '2026-10-19T12:00:00Z',
  },
  {
    id: 3,
    name: 'Jordan Lee',
    email: 'employee@tektalis.com',
    role: 'EMPLOYEE',
    active: true,
    created_at: '2026-10-19T12:00:00Z',
  },
];

describe('UsersPage & Role Protection (FR-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  const mockList = () => {
    vi.mocked(usersApi.listUsersApi).mockResolvedValue({
      items: MOCK_USERS,
      total: 3,
      page: 1,
      size: 20,
      pages: 1,
    });
  };

  it('lists users without any create, import, edit or deactivate controls', async () => {
    mockList();
    vi.mocked(usersApi.listRoleRequestsApi).mockResolvedValue([]);

    render(<UsersPage />);

    await waitFor(() => {
      expect(screen.getByText('Tektalis Admin')).toBeInTheDocument();
      expect(screen.getByText('Alex Morgan')).toBeInTheDocument();
      expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Create User/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import Users/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deactivate|Activate/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Request role change/i })).toHaveLength(3);
  });

  it('requests a role change from the global admin and shows it as requested', async () => {
    const user = userEvent.setup();
    mockList();
    vi.mocked(usersApi.listRoleRequestsApi)
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: 7,
          email: 'employee@tektalis.com',
          role: 'manager',
          requested_at: '2026-10-26T09:00:00Z',
          requested_by: 'Tektalis Admin',
        },
      ]);
    vi.mocked(usersApi.requestRoleChangeApi).mockResolvedValueOnce({
      id: 7,
      role: 'manager',
      message: 'Sent to the global admin for approval.',
    });

    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('role-request-badge-3')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Request role change for Jordan Lee/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const select = screen.getByLabelText(/New role/i);
    expect(select).toHaveValue('employee');
    expect(screen.getByRole('option', { name: 'No access' })).toBeInTheDocument();

    await user.selectOptions(select, 'manager');
    await user.type(screen.getByLabelText(/Note for the global admin/i), 'Runs the store room');
    await user.click(screen.getByRole('button', { name: /Send request/i }));

    await waitFor(() => {
      expect(usersApi.requestRoleChangeApi).toHaveBeenCalledWith(3, 'manager', 'Runs the store room');
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Sent to the global admin for approval.');
      expect(screen.getByTestId('role-request-badge-3')).toHaveTextContent('Requested: Asset Manager');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks to remove access with role null and shows request errors in the modal', async () => {
    const user = userEvent.setup();
    mockList();
    vi.mocked(usersApi.listRoleRequestsApi).mockResolvedValue([]);
    vi.mocked(usersApi.requestRoleChangeApi).mockRejectedValueOnce(
      new Error("unknown role 'lead' for app 'ams'"),
    );

    render(<UsersPage />);
    await waitFor(() => {
      expect(screen.getByText('Alex Morgan')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Request role change for Alex Morgan/i }));
    await user.selectOptions(screen.getByLabelText(/New role/i), 'none');
    await user.click(screen.getByRole('button', { name: /Send request/i }));

    await waitFor(() => {
      expect(usersApi.requestRoleChangeApi).toHaveBeenCalledWith(2, null, '');
      expect(screen.getByRole('alert')).toHaveTextContent(/unknown role/i);
    });
  });

  it('blocks non-ADMIN role from accessing ProtectedRoute for /users', async () => {
    localStorage.setItem('ams_access_token', 'employee-jwt');
    localStorage.setItem(
      'ams_user',
      JSON.stringify({
        id: 3,
        name: 'Jordan Lee',
        email: 'employee@tektalis.com',
        role: 'EMPLOYEE',
        active: true,
        created_at: '2026-10-19T12:00:00Z',
      }),
    );

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/users']}>
          <Routes>
            <Route
              path="/users"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <UsersPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText(/403 — Access Restricted/i)).toBeInTheDocument();
    });
  });
});
