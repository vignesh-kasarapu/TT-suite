import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import { AssetsPage } from '../pages/AssetsPage';
import * as assetsApi from '../api/assets';
import * as categoriesApi from '../api/categories';
import * as reportsApi from '../api/reports';
import type { Asset, Category } from '../types';

vi.mock('../api/assets', () => ({
  listAssetsApi: vi.fn(),
  getAssetApi: vi.fn(),
  createAssetApi: vi.fn(),
  updateAssetApi: vi.fn(),
  retireAssetApi: vi.fn(),
  importAssetsCsvApi: vi.fn(),
  importAssetsDataApi: vi.fn(),
  downloadAssetsSampleCsv: vi.fn(),
  ASSETS_SAMPLE_CSV:
    'name\tserial_no\tcategory\tpurchase_date\tcost\tlocation\tassigned_to_email\nMacBook Pro 16 M4\tSN-MBP-9001\tLaptop\t2026-03-15\t195000.00\tHyderabad - Floor 14\t',
}));

vi.mock('../api/users', () => ({
  listUserDirectoryApi: vi.fn().mockResolvedValue([]),
  importUsersCsvApi: vi.fn(),
  importUsersDataApi: vi.fn(),
  downloadUsersSampleCsv: vi.fn(),
  USERS_SAMPLE_CSV:
    'name\temail\trole\tpassword\tactive\nAarav Mehta\taarav.mehta@tektalis.com\tEMPLOYEE\tWelcome@123\ttrue',
}));

vi.mock('../api/categories', () => ({
  listCategoriesApi: vi.fn(),
  createCategoryApi: vi.fn(),
}));

vi.mock('../api/reports', () => ({
  downloadAssetsCsvApi: vi.fn(),
  downloadAssetsPdfApi: vi.fn(),
  triggerFileDownload: vi.fn(),
  triggerCsvFileDownload: vi.fn(),
}));

vi.mock('../api/maintenance', () => ({
  openMaintenanceApi: vi.fn(),
  closeMaintenanceApi: vi.fn(),
  listMaintenanceRecordsApi: vi.fn().mockResolvedValue([]),
}));

const MOCK_CATEGORIES: Category[] = [
  { id: 1, name: 'Laptop', created_at: '2026-10-19T12:00:00Z' },
  { id: 2, name: 'Monitor', created_at: '2026-10-19T12:00:00Z' },
  { id: 3, name: 'Phone', created_at: '2026-10-19T12:00:00Z' },
  { id: 4, name: 'Furniture', created_at: '2026-10-19T12:00:00Z' },
];

const MOCK_ASSETS: Asset[] = [
  {
    id: 1,
    tag: 'TEK-LPT-MP15-0001',
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
    tag: 'TEK-MON-DU2F-0002',
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
    assigned_to_name: 'Tektalis Employee',
  },
];

function renderAssetsPage() {
  localStorage.setItem('ams_access_token', 'admin-jwt-token');
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

  return render(
    <AuthProvider>
      <MemoryRouter>
        <AssetsPage />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('AssetsPage Component & Modals (FR-3, FR-4, FR-5, FR-6)', () => {
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
  });

  it('renders asset table with alphanumeric hex tags, status badges, search, and filters', async () => {
    const user = userEvent.setup();
    renderAssetsPage();

    await waitFor(() => {
      expect(screen.getByText('TEK-LPT-MP15-0001')).toBeInTheDocument();
      expect(screen.getByText('MacBook Pro 16 M4')).toBeInTheDocument();
      expect(screen.getByText('TEK-MON-DU2F-0002')).toBeInTheDocument();
      expect(screen.getByText('Dell UltraSharp 27')).toBeInTheDocument();
      expect(screen.getByText('Tektalis Employee')).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Assigned To/i })).toBeInTheDocument();
    });

    // Trigger search filter
    await user.type(screen.getByLabelText(/Search assets/i), 'TEK-LPT-MP15-0001');
    await waitFor(() => {
      expect(assetsApi.listAssetsApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'TEK-LPT-MP15-0001' }),
      );
    });

    // Trigger status filter
    await user.selectOptions(screen.getByLabelText(/Filter by status/i), 'AVAILABLE');
    await waitFor(() => {
      expect(assetsApi.listAssetsApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'AVAILABLE' }),
      );
    });
  });

  it('validates, previews alphanumeric-hex tag, and creates a new asset via Create Asset modal', async () => {
    const user = userEvent.setup();
    vi.mocked(assetsApi.createAssetApi).mockResolvedValueOnce({
      id: 3,
      tag: 'TEK-LPT-TX11-0003',
      name: 'ThinkPad X1 Carbon',
      serial_no: 'SN-TP-3003',
      service_tag: 'SVC-TP-3003',
      asset_tag: 'ATG-TP-3003',
      category_id: 1,
      category_name: 'Laptop',
      purchase_date: '2026-01-15',
      cost: 1899.0,
      location: 'Austin Office',
      status: 'AVAILABLE',
      version: 1,
      created_at: '2026-10-19T13:00:00Z',
    });

    renderAssetsPage();

    await waitFor(() => {
      expect(screen.getByText('TEK-LPT-MP15-0001')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Create Asset/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Submit empty form to trigger validation
    await user.click(screen.getByRole('button', { name: /Save Asset/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Asset name is required/i);

    await user.type(screen.getByLabelText(/Asset Name/i), 'ThinkPad X1 Carbon');
    expect(screen.getByTestId('create-asset-tag-preview')).toHaveTextContent(
      'TEK-LPT-TX11-XXXX',
    );

    await user.type(screen.getByLabelText(/Serial Number/i), 'SN-TP-3003');
    await user.type(screen.getByLabelText(/Service Tag/i), 'SVC-TP-3003');
    await user.type(screen.getByLabelText(/Asset Tag/i), 'ATG-TP-3003');
    await user.type(screen.getByLabelText(/Cost/i), '1899');
    await user.type(screen.getByLabelText(/Location/i), 'Austin Office');

    await user.click(screen.getByRole('button', { name: /Save Asset/i }));

    const today = new Date().toISOString().slice(0, 10);
    await waitFor(() => {
      expect(assetsApi.createAssetApi).toHaveBeenCalledWith({
        name: 'ThinkPad X1 Carbon',
        serial_no: 'SN-TP-3003',
        service_tag: 'SVC-TP-3003',
        asset_tag: 'ATG-TP-3003',
        category_id: 1,
        purchase_date: today,
        cost: 1899,
        location: 'Austin Office',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toHaveTextContent(
        /Created asset TEK-LPT-TX11-0003/i,
      );
    });
  });

  it('opens Edit Asset modal with immutable Asset ID and updates editable fields', async () => {
    const user = userEvent.setup();
    vi.mocked(assetsApi.updateAssetApi).mockResolvedValueOnce({
      ...MOCK_ASSETS[0],
      name: 'MacBook Pro 16 M4 Max',
      location: 'HQ - Floor 5',
      version: 2,
    });

    renderAssetsPage();

    await waitFor(() => {
      expect(screen.getByText('MacBook Pro 16 M4')).toBeInTheDocument();
    });

    const editButtons = screen.getAllByRole('button', { name: /Edit/i });
    await user.click(editButtons[0]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByDisplayValue('TEK-LPT-MP15-0001')).toBeDisabled();
    expect(screen.getByDisplayValue('SN-MBP-1001')).not.toBeDisabled();
    expect(screen.getByDisplayValue(MOCK_ASSETS[0].service_tag ?? '')).not.toBeDisabled();
    expect(screen.getByDisplayValue(MOCK_ASSETS[0].asset_tag ?? '')).not.toBeDisabled();

    const nameInput = screen.getByLabelText(/Asset Name/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'MacBook Pro 16 M4 Max');

    const locationInput = screen.getByLabelText(/Location/i);
    await user.clear(locationInput);
    await user.type(locationInput, 'HQ - Floor 5');

    await user.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(assetsApi.updateAssetApi).toHaveBeenCalledWith(1, {
        name: 'MacBook Pro 16 M4 Max',
        serial_no: MOCK_ASSETS[0].serial_no,
        service_tag: MOCK_ASSETS[0].service_tag ?? null,
        asset_tag: MOCK_ASSETS[0].asset_tag ?? null,
        category_id: 1,
        purchase_date: '2026-01-15',
        cost: 2499.99,
        location: 'HQ - Floor 5',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('toast-success')).toHaveTextContent(
        /Updated asset TEK-LPT-MP15-0001/i,
      );
    });
  });

  it('displays 409 Conflict toast error when retiring an ASSIGNED asset fails', async () => {
    const user = userEvent.setup();
    vi.mocked(assetsApi.retireAssetApi).mockRejectedValueOnce(
      new Error("Cannot retire asset 'TEK-MON-DU2F-0002' while it is ASSIGNED; return it first"),
    );

    renderAssetsPage();

    await waitFor(() => {
      expect(screen.getByText('TEK-MON-DU2F-0002')).toBeInTheDocument();
    });

    const retireButtons = screen.getAllByRole('button', { name: /Retire/i });
    await user.click(retireButtons[1]);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Confirm Retire/i }));

    await waitFor(() => {
      expect(screen.getByTestId('toast-error')).toHaveTextContent(
        /Cannot retire asset 'TEK-MON-DU2F-0002' while it is ASSIGNED/i,
      );
    });
  });

  it('does not render the Retire button for assets that are already RETIRED', async () => {
    vi.mocked(assetsApi.listAssetsApi).mockResolvedValueOnce({
      items: [
        ...MOCK_ASSETS,
        {
          id: 3,
          tag: 'TEK-LPT-RD14-0003',
          name: 'Retired Dell Laptop',
          serial_no: 'SN-RET-3003',
          service_tag: 'SVC-RET-3003',
          asset_tag: 'ATG-RET-3003',
          category_id: 1,
          category_name: 'Laptop',
          purchase_date: '2024-01-10',
          cost: 1200,
          location: 'Storage Vault',
          status: 'RETIRED',
          version: 3,
          created_at: '2026-10-19T12:00:00Z',
        },
      ],
      total: 3,
      page: 1,
      size: 20,
      pages: 1,
    });

    renderAssetsPage();

    await waitFor(() => {
      expect(screen.getByText('TEK-LPT-RD14-0003')).toBeInTheDocument();
    });

    // Only the 2 non-RETIRED assets (AVAILABLE and ASSIGNED) should have Retire buttons
    const retireButtons = screen.getAllByRole('button', { name: /Retire/i });
    expect(retireButtons).toHaveLength(2);
  });

  it('opens Import Assets modal only (no Users tab) and displays new categories & partial-success report', async () => {
    const user = userEvent.setup();
    vi.mocked(assetsApi.importAssetsCsvApi).mockResolvedValueOnce({
      total_rows: 2,
      imported_count: 1,
      skipped_count: 1,
      created_categories: ['Docking Station'],
      imported_items: [
        {
          id: 55,
          tag: 'TEK-DCK-CT5D-0010',
          name: 'CalDigit TS4 Dock',
          serial_no: 'SN-DCK-9003',
          service_tag: 'SVC-DCK-9003',
          asset_tag: 'ATG-DCK-9003',
          category_id: 5,
          category_name: 'Docking Station',
          purchase_date: '2026-03-20',
          cost: 32000,
          location: 'Bengaluru - Floor 5',
          status: 'AVAILABLE',
          version: 1,
          created_at: '2026-10-21T08:00:00Z',
        },
      ],
      errors: [
        {
          row: 3,
          identifier: 'SN-MBP-1001',
          message: "Asset with serial_no 'SN-MBP-1001' already exists",
        },
      ],
    });

    renderAssetsPage();

    await waitFor(() => {
      expect(screen.getByText('TEK-LPT-MP15-0001')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('open-import-assets-btn'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Import Assets' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('tab-import-users')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('load-sample-csv-btn'));
    await user.click(screen.getByTestId('download-sample-csv-btn'));
    expect(assetsApi.downloadAssetsSampleCsv).toHaveBeenCalled();

    await user.click(screen.getByTestId('submit-bulk-import-btn'));

    await waitFor(() => {
      expect(assetsApi.importAssetsCsvApi).toHaveBeenCalled();
      expect(screen.getByTestId('import-summary-card')).toBeInTheDocument();
    });

    expect(screen.getByText('Docking Station')).toBeInTheDocument();
    expect(
      screen.getByText(/Row 3 \(SN-MBP-1001\)/i),
    ).toBeInTheDocument();
  });

  it('exports the asset register as CSV and PDF from the Export menu (FR-12)', async () => {
    const user = userEvent.setup();
    vi.mocked(reportsApi.downloadAssetsCsvApi).mockResolvedValue(
      new Blob(['id,tag\n1,TEK-LPT'], { type: 'text/csv' }),
    );
    vi.mocked(reportsApi.downloadAssetsPdfApi).mockResolvedValue(
      new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    );

    renderAssetsPage();

    await waitFor(() => {
      expect(screen.getByText('TEK-LPT-MP15-0001')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('export-assets-btn'));
    await user.click(screen.getByTestId('export-assets-csv-btn'));

    await waitFor(() => {
      expect(reportsApi.downloadAssetsCsvApi).toHaveBeenCalledWith({
        status: '',
        category_id: '',
        search: '',
      });
      expect(reportsApi.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Blob),
        'assets_report.csv',
      );
    });
    expect(
      screen.getByText(/Asset register CSV downloaded/i),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId('export-assets-btn'));
    await user.click(screen.getByTestId('export-assets-pdf-btn'));

    await waitFor(() => {
      expect(reportsApi.downloadAssetsPdfApi).toHaveBeenCalledWith({
        status: '',
        category_id: '',
        search: '',
      });
      expect(reportsApi.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Blob),
        'assets_report.pdf',
      );
    });
    expect(
      screen.getByText(/Asset register PDF downloaded/i),
    ).toBeInTheDocument();
  });
});
