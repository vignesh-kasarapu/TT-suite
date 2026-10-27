import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { AssetsPage } from '../pages/AssetsPage';
import { MyAssetsPage } from '../pages/MyAssetsPage';
import { MaintenancePage } from '../pages/MaintenancePage';
import { OffboardingPage } from '../pages/OffboardingPage';
import * as assetsApi from '../api/assets';
import * as categoriesApi from '../api/categories';
import * as assignmentsApi from '../api/assignments';
import * as maintenanceApi from '../api/maintenance';
import * as usersApi from '../api/users';
import type {
  Asset,
  AssetHistoryResponse,
  AssignedAsset,
  Category,
  MaintenanceRecord,
  User,
} from '../types';

vi.mock('../api/assets', () => ({
  listAssetsApi: vi.fn(),
  getAssetApi: vi.fn(),
  createAssetApi: vi.fn(),
  updateAssetApi: vi.fn(),
  retireAssetApi: vi.fn(),
  importAssetsCsvApi: vi.fn(),
  importAssetsDataApi: vi.fn(),
  downloadAssetsSampleCsv: vi.fn(),
  ASSETS_SAMPLE_CSV: '',
}));

vi.mock('../api/categories', () => ({
  listCategoriesApi: vi.fn(),
  createCategoryApi: vi.fn(),
}));

vi.mock('../api/assignments', () => ({
  assignAssetApi: vi.fn(),
  returnAssetApi: vi.fn(),
  getAssetHistoryApi: vi.fn(),
  listMyAssetsApi: vi.fn(),
  listUserAssetsApi: vi.fn(),
  fillMyAssetDetailsApi: vi.fn(),
}));

vi.mock('../api/replacements', () => ({
  listReplacementRequestsApi: vi.fn().mockResolvedValue([]),
  createReplacementRequestApi: vi.fn(),
  approveReplacementRequestApi: vi.fn(),
  rejectReplacementRequestApi: vi.fn(),
}));

vi.mock('../api/assetRequests', () => ({
  listAssetRequestsApi: vi.fn().mockResolvedValue([]),
  createAssetRequestApi: vi.fn(),
  approveAssetRequestApi: vi.fn(),
  rejectAssetRequestApi: vi.fn(),
}));

vi.mock('../api/maintenance', () => ({
  listMaintenanceRecordsApi: vi.fn(),
  openMaintenanceApi: vi.fn(),
  closeMaintenanceApi: vi.fn(),
}));

vi.mock('../api/users', () => ({
  listUsersApi: vi.fn(),
  listUserDirectoryApi: vi.fn(),
  importUsersCsvApi: vi.fn(),
  importUsersDataApi: vi.fn(),
  downloadUsersSampleCsv: vi.fn(),
  USERS_SAMPLE_CSV: '',
}));

const MOCK_CATEGORIES: Category[] = [
  { id: 1, name: 'Laptop', total_assets: 2, available_assets: 1, created_at: '2026-10-19T12:00:00Z' },
  { id: 2, name: 'Monitor', total_assets: 1, available_assets: 0, created_at: '2026-10-19T12:00:00Z' },
];

const MOCK_ASSETS: Asset[] = [
  {
    id: 1,
    tag: 'AST-0001',
    name: 'MacBook Pro 16 M4',
    serial_no: 'SN-MBP-1001',
    service_tag: 'SVC-MBP-1001',
    asset_tag: 'ATG-MBP-1001',
    category_id: 1,
    category_name: 'Laptop',
    purchase_date: '2026-01-15',
    cost: 2499.99,
    location: 'HQ - Floor 3',
    status: 'AVAILABLE',
    version: 1,
    created_at: '2026-10-19T12:00:00Z',
  },
  {
    id: 2,
    tag: 'AST-0002',
    name: 'Dell UltraSharp 27',
    serial_no: 'SN-DELL-2002',
    service_tag: 'SVC-DELL-2002',
    asset_tag: 'ATG-DELL-2002',
    category_id: 2,
    category_name: 'Monitor',
    purchase_date: '2026-02-01',
    cost: 649.5,
    location: 'HQ - Floor 2',
    status: 'ASSIGNED',
    version: 2,
    created_at: '2026-10-19T12:00:00Z',
  },
];

const MOCK_DIRECTORY_USERS: User[] = [
  {
    id: 3,
    name: 'Jordan Lee',
    email: 'employee@tektalis.com',
    role: 'EMPLOYEE',
    active: true,
    active_assets_count: 1,
    created_at: '2026-10-19T12:00:00Z',
  },
];

function setSessionUser(role: 'ADMIN' | 'ASSET_MANAGER' | 'EMPLOYEE' = 'ADMIN') {
  localStorage.setItem('ams_access_token', 'test-jwt-token');
  localStorage.setItem(
    'ams_user',
    JSON.stringify({
      id: role === 'EMPLOYEE' ? 3 : 1,
      name: role === 'EMPLOYEE' ? 'Jordan Lee' : 'Tektalis Admin',
      email: role === 'EMPLOYEE' ? 'employee@tektalis.com' : 'admin@tektalis.com',
      role,
      active: true,
      created_at: '2026-10-19T12:00:00Z',
    }),
  );
}

describe('Sprint 3 Workflows: Assignments, History, Maintenance, My Assets & Offboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(categoriesApi.listCategoriesApi).mockResolvedValue(MOCK_CATEGORIES);
    vi.mocked(assetsApi.listAssetsApi).mockResolvedValue({
      items: MOCK_ASSETS,
      total: 2,
      page: 1,
      size: 20,
      pages: 1,
    });
    vi.mocked(usersApi.listUserDirectoryApi).mockResolvedValue(MOCK_DIRECTORY_USERS);
  });

  it('assigns an AVAILABLE asset and returns an ASSIGNED asset via modals (FR-7, FR-8)', async () => {
    const user = userEvent.setup();
    setSessionUser('ASSET_MANAGER');

    vi.mocked(assignmentsApi.assignAssetApi).mockResolvedValueOnce({
      id: 101,
      asset_id: 1,
      asset_tag: 'AST-0001',
      asset_name: 'MacBook Pro 16 M4',
      user_id: 3,
      user_name: 'Jordan Lee',
      user_email: 'employee@tektalis.com',
      assigned_on: '2026-03-01',
      returned_on: null,
      return_reason: null,
      asset_status: 'ASSIGNED',
      created_at: '2026-03-01T10:00:00Z',
    });

    vi.mocked(assignmentsApi.returnAssetApi).mockResolvedValueOnce({
      id: 102,
      asset_id: 2,
      asset_tag: 'AST-0002',
      asset_name: 'Dell UltraSharp 27',
      user_id: 3,
      user_name: 'Jordan Lee',
      user_email: 'employee@tektalis.com',
      assigned_on: '2026-02-10',
      returned_on: '2026-03-05',
      return_reason: 'EMPLOYEE_LEFT',
      asset_status: 'IN_MAINTENANCE',
      created_at: '2026-02-10T10:00:00Z',
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <AssetsPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('AST-0001')).toBeInTheDocument();
    });

    // Click Assign on AST-0001
    await user.click(screen.getByRole('button', { name: /Assign/i }));
    await waitFor(() => {
      expect(screen.getByText(/Assign Asset — AST-0001/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Confirm Assignment/i }));
    await waitFor(() => {
      expect(assignmentsApi.assignAssetApi).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ user_id: 3 }),
      );
      expect(screen.getByTestId('toast-success')).toHaveTextContent(/Assigned AST-0001/i);
    });

    // Click Return on AST-0002
    await user.click(screen.getByRole('button', { name: /Return/i }));
    await waitFor(() => {
      expect(screen.getByText(/Return Asset — AST-0002/i)).toBeInTheDocument();
    });

    await user.selectOptions(
      screen.getByLabelText(/Return Reason/i),
      'IN_MAINTENANCE',
    );
    await user.type(
      screen.getByLabelText(/Reason for Maintenance/i),
      'Screen flicker under load',
    );
    await user.click(screen.getByRole('button', { name: /Confirm Return/i }));

    await waitFor(() => {
      expect(assignmentsApi.returnAssetApi).toHaveBeenCalledWith(
        2,
        expect.objectContaining({
          next_status: 'IN_MAINTENANCE',
          return_reason: 'IN_MAINTENANCE',
          description: 'Screen flicker under load',
        }),
      );
      expect(screen.getByTestId('toast-success')).toHaveTextContent(
        /Returned asset AST-0002/i,
      );
    });
  });

  it('opens standalone maintenance on an AVAILABLE asset from Assets page (FR-10, FR-11)', async () => {
    const user = userEvent.setup();
    setSessionUser('ASSET_MANAGER');

    vi.mocked(maintenanceApi.openMaintenanceApi).mockResolvedValueOnce({
      id: 55,
      asset_id: 1,
      asset_tag: 'AST-0001',
      asset_name: 'MacBook Pro 16 M4',
      opened_on: '2026-03-10',
      closed_on: null,
      description: 'Battery health check before next assignment',
      resolution: null,
      cost: 0,
      created_at: '2026-03-10T10:00:00Z',
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <AssetsPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('AST-0001')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /^Maintenance$/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/Open Maintenance — AST-0001/i),
      ).toBeInTheDocument();
    });

    await user.type(
      screen.getByLabelText(/Description/i),
      'Battery health check before next assignment',
    );
    await user.click(
      screen.getByRole('button', { name: /Send to Maintenance/i }),
    );

    await waitFor(() => {
      expect(maintenanceApi.openMaintenanceApi).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          description: 'Battery health check before next assignment',
        }),
      );
      expect(screen.getByTestId('toast-success')).toHaveTextContent(
        /Opened maintenance for AST-0001/i,
      );
    });
  });

  it('opens Asset Detail & History Drawer showing assignment and maintenance logs (FR-9, FR-13)', async () => {
    const user = userEvent.setup();
    setSessionUser('ADMIN');

    const mockHistory: AssetHistoryResponse = {
      asset: MOCK_ASSETS[0],
      assignments: [
        {
          id: 50,
          asset_id: 1,
          asset_tag: 'AST-0001',
          asset_name: 'MacBook Pro 16 M4',
          user_id: 3,
          user_name: 'Jordan Lee',
          user_email: 'employee@tektalis.com',
          assigned_on: '2026-01-20',
          returned_on: '2026-02-20',
          return_reason: 'OTHER',
          asset_status: 'AVAILABLE',
          created_at: '2026-01-20T10:00:00Z',
        },
      ],
      maintenance_records: [
        {
          id: 70,
          asset_id: 1,
          asset_tag: 'AST-0001',
          asset_name: 'MacBook Pro 16 M4',
          opened_on: '2026-02-21',
          closed_on: null,
          description: 'Thermal paste replacement',
          cost: 65,
          created_at: '2026-02-21T10:00:00Z',
        },
      ],
    };

    vi.mocked(assignmentsApi.getAssetHistoryApi).mockResolvedValue(mockHistory);
    vi.mocked(maintenanceApi.closeMaintenanceApi).mockResolvedValueOnce({
      ...mockHistory.maintenance_records[0],
      closed_on: '2026-02-25',
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <AssetsPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('AST-0001')).toBeInTheDocument();
    });

    const historyBtns = screen.getAllByRole('button', { name: /History/i });
    await user.click(historyBtns[0]);

    await waitFor(() => {
      expect(
        screen.getByText(/Asset Detail & History — AST-0001/i),
      ).toBeInTheDocument();
      expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
      expect(screen.getByText('Thermal paste replacement')).toBeInTheDocument();
    });

    // Close open maintenance right from the drawer
    await user.click(screen.getByRole('button', { name: /Close Maintenance/i }));
    await waitFor(() => {
      expect(maintenanceApi.closeMaintenanceApi).toHaveBeenCalledWith(
        70,
        expect.any(Object),
      );
    });
  });

  it('renders Employee My Assets view calling GET /api/v1/me/assets (FR-9)', async () => {
    setSessionUser('EMPLOYEE');

    const myHeldAssets: AssignedAsset[] = [
      {
        ...MOCK_ASSETS[1],
        assignment_id: 201,
        assigned_on: '2026-03-01',
        user_id: 3,
        user_name: 'Jordan Lee',
        user_email: 'employee@tektalis.com',
      },
    ];
    vi.mocked(assignmentsApi.listMyAssetsApi).mockResolvedValueOnce(myHeldAssets);

    render(
      <AuthProvider>
        <MemoryRouter>
          <MyAssetsPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('My Assigned Assets')).toBeInTheDocument();
      expect(screen.getByText('AST-0002')).toBeInTheDocument();
      expect(screen.getByText('Dell UltraSharp 27')).toBeInTheDocument();
      expect(screen.getByText('1 Held Asset')).toBeInTheDocument();
    });
  });

  it('allows employee one-time fill of blank asset details and shows email note for edits', async () => {
    const user = userEvent.setup();
    setSessionUser('EMPLOYEE');

    const blankHeld: AssignedAsset = {
      ...MOCK_ASSETS[1],
      service_tag: null,
      asset_tag: null,
      assignment_id: 202,
      assigned_on: '2026-03-01',
      user_id: 3,
      user_name: 'Jordan Lee',
      user_email: 'employee@tektalis.com',
    };
    const filledHeld: AssignedAsset = {
      ...blankHeld,
      service_tag: 'SVC-EMP-001',
      asset_tag: 'ATG-EMP-001',
      version: blankHeld.version + 1,
    };

    vi.mocked(assignmentsApi.listMyAssetsApi)
      .mockResolvedValueOnce([blankHeld])
      .mockResolvedValueOnce([filledHeld]);
    vi.mocked(assignmentsApi.fillMyAssetDetailsApi).mockResolvedValueOnce(filledHeld);

    render(
      <AuthProvider>
        <MemoryRouter>
          <MyAssetsPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    expect(await screen.findByText('Dell UltraSharp 27')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Fill Details/i }));

    expect(
      screen.getByRole('dialog', { name: /Asset Details Modal/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('note'),
    ).toHaveTextContent(/request a change, email Admin/i);
    expect(screen.getByRole('link', { name: 'admin@tektalis.com' })).toHaveAttribute(
      'href',
      'mailto:admin@tektalis.com',
    );
    expect(screen.getByRole('link', { name: 'manager@tektalis.com' })).toHaveAttribute(
      'href',
      'mailto:manager@tektalis.com',
    );

    await user.type(screen.getByLabelText('Service Tag'), 'SVC-EMP-001');
    await user.type(screen.getByLabelText('Asset Tag'), 'ATG-EMP-001');
    await user.click(screen.getByRole('button', { name: /Save Details/i }));

    await waitFor(() => {
      expect(assignmentsApi.fillMyAssetDetailsApi).toHaveBeenCalledWith(blankHeld.id, {
        service_tag: 'SVC-EMP-001',
        asset_tag: 'ATG-EMP-001',
      });
    });

    expect(await screen.findByRole('button', { name: /View Details/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /View Details/i }));
    expect(screen.getByLabelText('Service Tag')).toBeDisabled();
    expect(screen.getByLabelText('Asset Tag')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save Details/i })).not.toBeInTheDocument();
  });

  it('renders Maintenance Log page and closes an open maintenance record (FR-10, FR-11)', async () => {
    const user = userEvent.setup();
    setSessionUser('ASSET_MANAGER');

    const mockRecords: MaintenanceRecord[] = [
      {
        id: 11,
        asset_id: 1,
        asset_tag: 'AST-0001',
        asset_name: 'MacBook Pro 16 M4',
        opened_on: '2026-03-02',
        closed_on: null,
        description: 'Display hinge repair',
        employee_name: 'Jordan Lee',
        cost: 120,
        created_at: '2026-03-02T10:00:00Z',
      },
    ];

    vi.mocked(maintenanceApi.listMaintenanceRecordsApi).mockResolvedValue(mockRecords);
    vi.mocked(maintenanceApi.closeMaintenanceApi).mockResolvedValueOnce({
      ...mockRecords[0],
      closed_on: '2026-03-04',
      resolution: 'Hinge repaired and verified',
    });

    render(
      <AuthProvider>
        <MemoryRouter>
          <MaintenancePage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Display hinge repair')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Close Maintenance/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/Resolution/i),
      'Hinge repaired and verified',
    );
    await user.click(screen.getByRole('button', { name: /Confirm Close/i }));
    await waitFor(() => {
      expect(maintenanceApi.closeMaintenanceApi).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          cost: 120,
          resolution: 'Hinge repaired and verified',
        }),
      );
      expect(screen.getByTestId('toast-success')).toHaveTextContent(
        /Closed maintenance/i,
      );
    });
  });

  it('shows pending replacement approvals in the unified Maintenance Log', async () => {
    setSessionUser('ASSET_MANAGER');

    const { listReplacementRequestsApi } = await import('../api/replacements');
    vi.mocked(listReplacementRequestsApi).mockResolvedValueOnce([
      {
        id: 44,
        asset_id: 2,
        asset_tag: 'AST-0002',
        asset_name: 'Dell UltraSharp 27',
        requested_by: 3,
        requester_name: 'Jordan Lee',
        reason: 'Dead pixels on left edge',
        old_asset_action: 'REPAIR',
        temporary: true,
        status: 'PENDING',
        created_at: '2026-03-05T10:00:00Z',
      },
    ]);
    vi.mocked(maintenanceApi.listMaintenanceRecordsApi).mockResolvedValueOnce([]);

    render(
      <AuthProvider>
        <MemoryRouter>
          <MaintenancePage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Pending Approval')).toBeInTheDocument();
      expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
      expect(screen.getByText('Dead pixels on left edge')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Approve$/i })).toBeInTheDocument();
    });
  });

  it('renders Offboarding page with held assets and leaves deactivation to the global admin (FR-14)', async () => {
    setSessionUser('ADMIN');

    const heldList: AssignedAsset[] = [
      {
        ...MOCK_ASSETS[1],
        assignment_id: 301,
        assigned_on: '2026-03-01',
        user_id: 3,
        user_name: 'Jordan Lee',
        user_email: 'employee@tektalis.com',
      },
    ];
    vi.mocked(assignmentsApi.listUserAssetsApi).mockResolvedValue(heldList);
    render(
      <AuthProvider>
        <MemoryRouter>
          <OffboardingPage />
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Offboarding Blocked — Holds 1 Active Asset/i),
      ).toBeInTheDocument();
      expect(screen.getByText('AST-0002')).toBeInTheDocument();
    });

    // TT Suite: no deactivation here; the global admin does it in the portal.
    expect(screen.queryByRole('button', { name: /Deactivate/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('offboarding-deactivation-note')).toHaveTextContent(/global admin/i);
  });
});
