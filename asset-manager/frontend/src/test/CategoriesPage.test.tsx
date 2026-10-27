import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { CategoriesPage } from '../pages/CategoriesPage';
import * as categoriesApi from '../api/categories';
import type { Category } from '../types';

vi.mock('../api/categories', () => ({
  listCategoriesApi: vi.fn(),
  createCategoryApi: vi.fn(),
  updateCategoryApi: vi.fn(),
  deleteCategoryApi: vi.fn(),
}));

const MOCK_CATEGORIES: Category[] = [
  {
    id: 1,
    name: 'Laptop',
    total_assets: 3,
    available_assets: 1,
    created_at: '2026-10-19T12:00:00Z',
  },
  {
    id: 99,
    name: 'Empty Cat',
    total_assets: 0,
    available_assets: 0,
    created_at: '2026-10-20T12:00:00Z',
  },
];

function setSession(role: 'ADMIN' | 'ASSET_MANAGER') {
  localStorage.setItem('ams_access_token', 'fake-jwt');
  localStorage.setItem(
    'ams_user',
    JSON.stringify({
      id: 1,
      name: role === 'ADMIN' ? 'Tektalis Admin' : 'Asset Manager',
      email:
        role === 'ADMIN' ? 'admin@tektalis.com' : 'manager@tektalis.com',
      role,
      active: true,
      created_at: '2026-10-19T12:00:00Z',
    }),
  );
}

describe('CategoriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(categoriesApi.listCategoriesApi).mockResolvedValue(MOCK_CATEGORIES);
  });

  it('shows counts and allows Admin CRUD actions', async () => {
    setSession('ADMIN');
    vi.mocked(categoriesApi.createCategoryApi).mockResolvedValue({
      id: 100,
      name: 'Docking Station',
      total_assets: 0,
      available_assets: 0,
      created_at: '2026-10-24T12:00:00Z',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <CategoriesPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Categories' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Assets across categories')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Edit Laptop/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /New Category/i }));
    await user.type(screen.getByLabelText('Category Name'), 'Docking Station');
    await user.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => {
      expect(categoriesApi.createCategoryApi).toHaveBeenCalledWith({
        name: 'Docking Station',
      });
    });
  });

  it('hides CRUD controls for Asset Manager', async () => {
    setSession('ASSET_MANAGER');
    render(
      <MemoryRouter>
        <AuthProvider>
          <CategoriesPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Laptop')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /New Category/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Edit Laptop/i }),
    ).not.toBeInTheDocument();
  });
});
