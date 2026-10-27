import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { AssetRequestsPage } from '../pages/AssetRequestsPage';
import { MyAssetsPage } from '../pages/MyAssetsPage';
import * as assetRequestsApi from '../api/assetRequests';
import * as assignmentsApi from '../api/assignments';
import * as categoriesApi from '../api/categories';
import * as replacementsApi from '../api/replacements';
import type { Asset, AssetRequest, AssignedAsset, Category } from '../types';

vi.mock('../api/assetRequests', () => ({
  listAssetRequestsApi: vi.fn(),
  createAssetRequestApi: vi.fn(),
  listAvailableAssetsForRequestApi: vi.fn(),
  approveAssetRequestApi: vi.fn(),
  rejectAssetRequestApi: vi.fn(),
}));

vi.mock('../api/categories', () => ({
  listCategoriesApi: vi.fn(),
}));

vi.mock('../api/assignments', () => ({
  listMyAssetsApi: vi.fn(),
  fillMyAssetDetailsApi: vi.fn(),
  registerMyAssetApi: vi.fn(),
}));

vi.mock('../api/replacements', () => ({
  listReplacementRequestsApi: vi.fn().mockResolvedValue([]),
  createReplacementRequestApi: vi.fn(),
}));

const MOCK_CATEGORIES: Category[] = [
  {
    id: 1,
    name: 'Laptop',
    total_assets: 2,
    available_assets: 1,
    created_at: '2026-10-19T12:00:00Z',
  },
];

const PENDING_REQUEST: AssetRequest = {
  id: 11,
  requested_by: 3,
  requester_name: 'Jordan Lee',
  requester_email: 'employee@tektalis.com',
  name: 'Laptop',
  category_id: 1,
  category_name: 'Laptop',
  is_other: false,
  reason: 'Need a laptop for development work',
  status: 'PENDING',
  created_at: '2026-10-24T10:00:00Z',
};

function setSession(role: 'ADMIN' | 'ASSET_MANAGER' | 'EMPLOYEE') {
  localStorage.setItem('ams_access_token', 'fake-jwt');
  localStorage.setItem(
    'ams_user',
    JSON.stringify({
      id: role === 'EMPLOYEE' ? 3 : 1,
      name: role === 'EMPLOYEE' ? 'Jordan Lee' : 'Tektalis Admin',
      email:
        role === 'EMPLOYEE'
          ? 'employee@tektalis.com'
          : role === 'ASSET_MANAGER'
            ? 'manager@tektalis.com'
            : 'admin@tektalis.com',
      role,
      active: true,
      created_at: '2026-10-19T12:00:00Z',
    }),
  );
}

const STOCK_ASSET: Asset = {
  id: 77,
  tag: 'TEK-LPT-ST01-0001',
  name: 'Stock Latitude',
  serial_no: 'SN-STOCK-77',
  category_id: 1,
  category_name: 'Laptop',
  purchase_date: '2026-01-01',
  cost: 999,
  location: 'Store',
  status: 'AVAILABLE',
  awaiting_employee_details: false,
  version: 1,
  created_at: '2026-10-01T12:00:00Z',
};

describe('Asset Requests workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(categoriesApi.listCategoriesApi).mockResolvedValue(MOCK_CATEGORIES);
    vi.mocked(assetRequestsApi.listAssetRequestsApi).mockResolvedValue([]);
    vi.mocked(assetRequestsApi.listAvailableAssetsForRequestApi).mockResolvedValue({
      category_id: 1,
      category_name: 'Laptop',
      has_available: false,
      items: [],
    });
  });

  it('shows Register and Request buttons; Register submits full asset details', async () => {
    setSession('EMPLOYEE');
    vi.mocked(assignmentsApi.listMyAssetsApi).mockResolvedValue([]);
    vi.mocked(replacementsApi.listReplacementRequestsApi).mockResolvedValue([]);
    vi.mocked(assetRequestsApi.listAssetRequestsApi).mockResolvedValue([]);
    const registered: AssignedAsset = {
      id: 50,
      tag: 'TEK-LPT-DL01-0001',
      name: 'Dell Latitude 5550',
      serial_no: 'SN-EMP-REG-001',
      category_id: 1,
      category_name: 'Laptop',
      purchase_date: '2026-03-01',
      cost: 1299.5,
      location: 'HQ - Floor 2',
      status: 'ASSIGNED',
      awaiting_employee_details: false,
      version: 1,
      created_at: '2026-10-24T10:00:00Z',
      assignment_id: 9,
      assigned_on: '2026-10-24',
      user_id: 3,
      user_name: 'Jordan Lee',
      user_email: 'employee@tektalis.com',
    };
    vi.mocked(assignmentsApi.registerMyAssetApi).mockResolvedValue(registered);
    vi.mocked(assignmentsApi.listMyAssetsApi)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([registered]);

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <MyAssetsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('My Assigned Assets')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /New Asset Register/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /New Asset Request/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /New Asset Register/i }));
    expect(
      screen.getByRole('dialog', { name: /New Asset Register Modal/i }),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Asset Name'), 'Dell Latitude 5550');
    await user.type(screen.getByLabelText('Serial Number'), 'SN-EMP-REG-001');
    await user.type(screen.getByLabelText('Cost'), '1299.5');
    await user.type(screen.getByLabelText('Location'), 'HQ - Floor 2');
    await user.click(screen.getByRole('button', { name: /Register Asset/i }));

    await waitFor(() => {
      expect(assignmentsApi.registerMyAssetApi).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Dell Latitude 5550',
          serial_no: 'SN-EMP-REG-001',
          category_id: 1,
          cost: 1299.5,
          location: 'HQ - Floor 2',
        }),
      );
    });
  });

  it('shows a reminder banner when an approved request requires employee register', async () => {
    setSession('EMPLOYEE');
    vi.mocked(assignmentsApi.listMyAssetsApi).mockResolvedValue([]);
    vi.mocked(replacementsApi.listReplacementRequestsApi).mockResolvedValue([]);
    vi.mocked(assetRequestsApi.listAssetRequestsApi).mockResolvedValue([
      {
        ...PENDING_REQUEST,
        id: 42,
        status: 'APPROVED',
        requires_employee_register: true,
        reason: 'Need a docking station',
        name: 'Laptop',
        category_name: 'Laptop',
      },
    ]);

    render(
      <MemoryRouter>
        <AuthProvider>
          <MyAssetsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('status', {
        name: /Assets awaiting your registration/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/approved asset to register/i)).toBeInTheDocument();
    expect(screen.getByText(/Need a docking station/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Register now/i }),
    ).toBeInTheDocument();
  });

  it('lets an employee open New Asset Request with category and reason only', async () => {
    setSession('EMPLOYEE');
    vi.mocked(assignmentsApi.listMyAssetsApi).mockResolvedValue([]);
    vi.mocked(replacementsApi.listReplacementRequestsApi).mockResolvedValue([]);
    vi.mocked(assetRequestsApi.createAssetRequestApi).mockResolvedValue({
      ...PENDING_REQUEST,
      id: 88,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <MyAssetsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: /New Asset Request/i }),
    );
    expect(
      screen.getByRole('dialog', { name: /New Asset Request Modal/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Serial Number')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Cost')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(
      /Approval confirms the ask/i,
    );

    await user.type(
      screen.getByLabelText('Reason'),
      'Need ThinkPad for remote work',
    );
    await user.click(screen.getByRole('button', { name: /Submit Request/i }));

    await waitFor(() => {
      expect(assetRequestsApi.createAssetRequestApi).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'Need ThinkPad for remote work',
          is_other: false,
          category_id: 1,
        }),
      );
    });
  });

  it('shows No Asset Available and employee fill when stock is empty', async () => {
    setSession('ADMIN');
    vi.mocked(assetRequestsApi.listAssetRequestsApi).mockResolvedValue([
      PENDING_REQUEST,
    ]);
    vi.mocked(assetRequestsApi.approveAssetRequestApi).mockResolvedValue({
      ...PENDING_REQUEST,
      status: 'APPROVED',
      requires_employee_register: true,
      created_asset_id: null,
      created_asset_tag: null,
      decider_name: 'Tektalis Admin',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AssetRequestsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Need a laptop for development work')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve$/i }));
    expect(
      screen.getByRole('dialog', { name: /Approve Asset Request Modal/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('status', {
        name: /No Asset Available currently/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', {
        name: /Should be filled by an Employee/i,
      }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: /Confirm Approve/i }));

    await waitFor(() => {
      expect(assetRequestsApi.approveAssetRequestApi).toHaveBeenCalledWith(11, {
        requires_employee_register: true,
      });
    });
    expect(
      await screen.findByText(/No stock — .* will be reminded to register/i),
    ).toBeInTheDocument();
  });

  it('lets Admin approve and assign when AVAILABLE stock exists', async () => {
    setSession('ADMIN');
    vi.mocked(assetRequestsApi.listAssetRequestsApi).mockResolvedValue([
      PENDING_REQUEST,
    ]);
    vi.mocked(assetRequestsApi.listAvailableAssetsForRequestApi).mockResolvedValue({
      category_id: 1,
      category_name: 'Laptop',
      has_available: true,
      items: [STOCK_ASSET],
    });
    vi.mocked(assetRequestsApi.approveAssetRequestApi).mockResolvedValue({
      ...PENDING_REQUEST,
      status: 'APPROVED',
      requires_employee_register: false,
      created_asset_id: STOCK_ASSET.id,
      created_asset_tag: STOCK_ASSET.tag,
      decider_name: 'Tektalis Admin',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AssetRequestsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Need a laptop for development work')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Approve$/i }));
    expect(
      await screen.findByRole('combobox', { name: /Available asset/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('status', { name: /No Asset Available currently/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Approve & Assign/i }));

    await waitFor(() => {
      expect(assetRequestsApi.approveAssetRequestApi).toHaveBeenCalledWith(11, {
        requires_employee_register: false,
        asset_id: STOCK_ASSET.id,
      });
    });
    expect(
      await screen.findByText(/assigned TEK-LPT-ST01-0001/i),
    ).toBeInTheDocument();
  });

  it('requires a rejection comment for Asset Manager reject', async () => {
    setSession('ASSET_MANAGER');
    vi.mocked(assetRequestsApi.listAssetRequestsApi).mockResolvedValue([
      PENDING_REQUEST,
    ]);
    vi.mocked(assetRequestsApi.rejectAssetRequestApi).mockResolvedValue({
      ...PENDING_REQUEST,
      status: 'REJECTED',
      decision_comment: 'Not in budget this quarter',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <AssetRequestsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Need a laptop for development work')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Reject$/i }));
    await user.click(screen.getByRole('button', { name: /Confirm Reject/i }));
    expect(
      await screen.findByText(/A rejection comment is required/i),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText('Rejection Comment'),
      'Not in budget this quarter',
    );
    await user.click(screen.getByRole('button', { name: /Confirm Reject/i }));

    await waitFor(() => {
      expect(assetRequestsApi.rejectAssetRequestApi).toHaveBeenCalledWith(11, {
        comment: 'Not in budget this quarter',
      });
    });
  });
});
