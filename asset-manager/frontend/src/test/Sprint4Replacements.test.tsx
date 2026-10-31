import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { MyAssetsPage } from '../pages/MyAssetsPage';
import { ReplacementsPage } from '../pages/ReplacementsPage';
import { Layout } from '../components/Layout';
import * as assignmentsApi from '../api/assignments';
import * as assetsApi from '../api/assets';
import * as replacementsApi from '../api/replacements';
import * as maintenanceApi from '../api/maintenance';
import type {
  Asset,
  AssignedAsset,
  ReplacementRequest,
} from '../types';

vi.mock('../api/assignments', () => ({
  listMyAssetsApi: vi.fn(),
  fillMyAssetDetailsApi: vi.fn(),
}));

vi.mock('../api/assets', () => ({
  listAssetsApi: vi.fn(),
  importAssetsCsvApi: vi.fn(),
  importAssetsDataApi: vi.fn(),
  downloadAssetsSampleCsv: vi.fn(),
  ASSETS_SAMPLE_CSV: '',
}));

vi.mock('../api/replacements', () => ({
  listReplacementRequestsApi: vi.fn(),
  createReplacementRequestApi: vi.fn(),
  approveReplacementRequestApi: vi.fn(),
  rejectReplacementRequestApi: vi.fn(),
  holdReplacementRequestApi: vi.fn(),
}));

vi.mock('../api/maintenance', () => ({
  listMaintenanceRecordsApi: vi.fn().mockResolvedValue([]),
}));

vi.mock('../api/assetRequests', () => ({
  listAssetRequestsApi: vi.fn().mockResolvedValue([]),
  createAssetRequestApi: vi.fn(),
  approveAssetRequestApi: vi.fn(),
  rejectAssetRequestApi: vi.fn(),
}));

const MOCK_HELD_ASSETS: AssignedAsset[] = [
  {
    id: 10,
    tag: 'AST-0010',
    name: 'MacBook Pro 14 M4',
    serial_no: 'SN-MBP14-010',
    service_tag: 'SVC-MBP14-010',
    asset_tag: 'ATG-MBP14-010',
    category_id: 1,
    category_name: 'Laptop',
    purchase_date: '2026-01-10',
    cost: 2199.0,
    location: 'HQ - Floor 4',
    status: 'ASSIGNED',
    version: 2,
    created_at: '2026-10-19T12:00:00Z',
    assignment_id: 501,
    assigned_on: '2026-03-01',
    user_id: 3,
    user_name: 'Employee User',
    user_email: 'employee@tektalis.com',
  },
];

const MOCK_AVAILABLE_ASSETS: Asset[] = [
  {
    id: 22,
    tag: 'AST-0022',
    name: 'Loaner MacBook Air M3',
    serial_no: 'SN-MBA-022',
    service_tag: 'SVC-MBA-022',
    asset_tag: 'ATG-MBA-022',
    category_id: 1,
    category_name: 'Laptop',
    purchase_date: '2026-02-15',
    cost: 1299.0,
    location: 'HQ - IT Closet',
    status: 'AVAILABLE',
    version: 1,
    created_at: '2026-10-19T12:00:00Z',
  },
];

const MOCK_REQUESTS: ReplacementRequest[] = [
  {
    id: 7,
    asset_id: 10,
    asset_tag: 'AST-0010',
    asset_name: 'MacBook Pro 14 M4',
    asset_category_id: 1,
    asset_category_name: 'Laptop',
    requested_by: 3,
    requester_name: 'Employee User',
    requester_email: 'employee@tektalis.com',
    reason: 'USB-C ports intermittent during docking',
    old_asset_action: 'REPAIR',
    temporary: true,
    replacement_asset_id: null,
    replacement_asset_tag: null,
    replacement_asset_name: null,
    status: 'PENDING',
    decided_by: null,
    decider_name: null,
    decider_email: null,
    decision_comment: null,
    decided_at: null,
    created_at: '2026-10-19T14:00:00Z',
  },
];

describe('Sprint 4 Replacement Engine Workflows (FR-15 to FR-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('allows an employee to open the Request Replacement modal on MyAssetsPage and submit a temporary REPAIR request (FR-15)', async () => {
    localStorage.setItem('ams_access_token', 'fake-emp-jwt');
    localStorage.setItem(
      'ams_user',
      JSON.stringify({
        id: 3,
        name: 'Employee User',
        email: 'employee@tektalis.com',
        role: 'EMPLOYEE',
        active: true,
        created_at: '2026-10-19T12:00:00Z',
      }),
    );

    vi.mocked(assignmentsApi.listMyAssetsApi).mockResolvedValue(MOCK_HELD_ASSETS);
    vi.mocked(replacementsApi.listReplacementRequestsApi)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(MOCK_REQUESTS);
    vi.mocked(replacementsApi.createReplacementRequestApi).mockResolvedValue(
      MOCK_REQUESTS[0],
    );

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <MyAssetsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('MacBook Pro 14 M4')).toBeInTheDocument();

    // Open Request Replacement Modal
    const reqBtn = screen.getByRole('button', { name: /Request Replacement/i });
    await user.click(reqBtn);

    expect(
      screen.getByRole('dialog', { name: /Request Replacement Modal/i }),
    ).toBeInTheDocument();

    // Validate required reason
    await user.click(screen.getByRole('button', { name: /Submit Request/i }));
    expect(
      await screen.findByText(/Please enter a reason for the replacement request/i),
    ).toBeInTheDocument();

    // Check Temporary Replacement & enter reason
    const tempCheckbox = screen.getByLabelText(/Temporary Replacement/i);
    await user.click(tempCheckbox);
    await user.type(
      screen.getByLabelText(/Replacement Reason/i),
      'USB-C ports intermittent during docking',
    );

    await user.click(screen.getByRole('button', { name: /Submit Request/i }));

    await waitFor(() => {
      expect(replacementsApi.createReplacementRequestApi).toHaveBeenCalledWith({
        asset_id: 10,
        reason: 'USB-C ports intermittent during docking',
        old_asset_action: 'REPAIR',
        temporary: true,
      });
    });

    expect(
      await screen.findByText(/Replacement request #7 submitted/i),
    ).toBeInTheDocument();
  });

  it('allows an Asset Manager to approve a replacement request with an AVAILABLE asset selector (FR-16, FR-17)', async () => {
    localStorage.setItem('ams_access_token', 'fake-mgr-jwt');
    localStorage.setItem(
      'ams_user',
      JSON.stringify({
        id: 2,
        name: 'Asset Manager',
        email: 'manager@tektalis.com',
        role: 'ASSET_MANAGER',
        active: true,
        created_at: '2026-10-19T12:00:00Z',
      }),
    );

    vi.mocked(replacementsApi.listReplacementRequestsApi).mockResolvedValue(
      MOCK_REQUESTS,
    );
    vi.mocked(assetsApi.listAssetsApi).mockResolvedValue({
      items: MOCK_AVAILABLE_ASSETS,
      total: 1,
      page: 1,
      size: 100,
      pages: 1,
    });
    vi.mocked(replacementsApi.approveReplacementRequestApi).mockResolvedValue({
      ...MOCK_REQUESTS[0],
      status: 'APPROVED',
      replacement_asset_id: 22,
      replacement_asset_tag: 'AST-0022',
      replacement_asset_name: 'Loaner MacBook Air M3',
      decision_comment: 'Issuing loaner while MBP is in repair',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <ReplacementsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/USB-C ports intermittent during docking/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Approve/i }));

    expect(
      await screen.findByRole('dialog', { name: /Approve Replacement Modal/i }),
    ).toBeInTheDocument();

    // Wait for available asset option to load (same category only)
    await waitFor(() => {
      expect(assetsApi.listAssetsApi).toHaveBeenCalledWith({
        status: 'AVAILABLE',
        size: 100,
        category: 1,
      });
    });

    await user.type(
      screen.getByLabelText(/Approval Comment/i),
      'Issuing loaner while MBP is in repair',
    );
    await user.click(
      screen.getByRole('button', { name: /Confirm Swap/i }),
    );

    await waitFor(() => {
      expect(replacementsApi.approveReplacementRequestApi).toHaveBeenCalledWith(
        7,
        {
          replacement_asset_id: 22,
          comment: 'Issuing loaner while MBP is in repair',
        },
      );
    });

    expect(
      await screen.findByText(/Approved request #7/i),
    ).toBeInTheDocument();
  });

  it('keeps replacement on hold when no AVAILABLE assets in the request category', async () => {
    localStorage.setItem('ams_access_token', 'fake-mgr-jwt');
    localStorage.setItem(
      'ams_user',
      JSON.stringify({
        id: 2,
        name: 'Asset Manager',
        email: 'manager@tektalis.com',
        role: 'ASSET_MANAGER',
        active: true,
        created_at: '2026-10-19T12:00:00Z',
      }),
    );

    vi.mocked(replacementsApi.listReplacementRequestsApi).mockResolvedValue(
      MOCK_REQUESTS,
    );
    vi.mocked(assetsApi.listAssetsApi).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      size: 100,
      pages: 0,
    });
    vi.mocked(replacementsApi.holdReplacementRequestApi).mockResolvedValue({
      ...MOCK_REQUESTS[0],
      status: 'ON_HOLD',
      decision_comment: 'Awaiting AVAILABLE Laptops stock',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <ReplacementsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/USB-C ports intermittent during docking/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Approve/i }));

    expect(
      await screen.findByRole('status', {
        name: /No available assets in category — request on hold/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Confirm Swap/i }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Keep On Hold/i }));

    await waitFor(() => {
      expect(replacementsApi.holdReplacementRequestApi).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ comment: expect.stringMatching(/Awaiting/i) }),
      );
    });
    expect(replacementsApi.approveReplacementRequestApi).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Request #7 is ON HOLD/i),
    ).toBeInTheDocument();
  });

  it('requires a rejection comment when an Asset Manager rejects a replacement request (FR-16)', async () => {
    localStorage.setItem('ams_access_token', 'fake-mgr-jwt');
    localStorage.setItem(
      'ams_user',
      JSON.stringify({
        id: 2,
        name: 'Asset Manager',
        email: 'manager@tektalis.com',
        role: 'ASSET_MANAGER',
        active: true,
        created_at: '2026-10-19T12:00:00Z',
      }),
    );

    vi.mocked(replacementsApi.listReplacementRequestsApi).mockResolvedValue(
      MOCK_REQUESTS,
    );
    vi.mocked(replacementsApi.rejectReplacementRequestApi).mockResolvedValue({
      ...MOCK_REQUESTS[0],
      status: 'REJECTED',
      decision_comment: 'Troubleshooting resolved dock issue without replacement',
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthProvider>
          <ReplacementsPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/USB-C ports intermittent during docking/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Reject$/i }));

    expect(
      await screen.findByRole('dialog', { name: /Reject Replacement Modal/i }),
    ).toBeInTheDocument();

    // Submitting without a comment shows validation error
    await user.click(screen.getByRole('button', { name: /Reject Request/i }));
    expect(
      await screen.findByText(/A rejection comment is required/i),
    ).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/Rejection Comment/i),
      'Troubleshooting resolved dock issue without replacement',
    );
    await user.click(screen.getByRole('button', { name: /Reject Request/i }));

    await waitFor(() => {
      expect(replacementsApi.rejectReplacementRequestApi).toHaveBeenCalledWith(
        7,
        {
          comment: 'Troubleshooting resolved dock issue without replacement',
        },
      );
    });

    expect(
      await screen.findByText(/Rejected replacement request #7/i),
    ).toBeInTheDocument();
  });

  it('displays pending request notification dots on sidebar tabs and top header for ADMIN', async () => {
    localStorage.setItem('ams_access_token', 'fake-admin-jwt');
    localStorage.setItem(
      'ams_user',
      JSON.stringify({
        id: 1,
        name: 'Tektalis Admin',
        email: 'admin@tektalis.com',
        role: 'ADMIN',
        active: true,
        created_at: '2026-10-19T12:00:00Z',
      }),
    );

    vi.mocked(replacementsApi.listReplacementRequestsApi).mockResolvedValue(
      MOCK_REQUESTS,
    );
    vi.mocked(maintenanceApi.listMaintenanceRecordsApi).mockResolvedValue([
      {
        id: 30,
        asset_id: 10,
        asset_tag: 'AST-0010',
        asset_name: 'MacBook Pro 14 M4',
        opened_on: '2026-10-19',
        closed_on: null,
        description: 'Battery replacement',
        cost: 150,
        created_at: '2026-10-19T14:00:00Z',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/maintenance']}>
        <AuthProvider>
          <Layout />
        </AuthProvider>
      </MemoryRouter>,
    );

    // Admin/manager no longer see Replacement Requests nav — queue lives under Maintenance Log
    expect(screen.queryByTestId('nav-dot-replacements')).not.toBeInTheDocument();
    expect(await screen.findByTestId('nav-dot-maintenance')).toBeInTheDocument();
    expect(await screen.findByTestId('nav-dot-dashboard')).toBeInTheDocument();
    // The top-bar envelope (Kanban's inbox slot): the count is its badge, the words its label.
    const pending = await screen.findByTestId('header-pending-indicator');
    await waitFor(() => {
      expect(pending).toHaveAttribute('aria-label', '2 pending requests');
    });
    expect(pending).toHaveAttribute('title', '2 pending requests');
    expect(pending).toHaveTextContent('2');
    expect(screen.getByAltText('Tektalis')).toHaveAttribute(
      'src',
      '/ams/brand/tektalis.svg', // TT Suite: the shared suite logo (68b37e3), served under /ams/
    );
  });
});
