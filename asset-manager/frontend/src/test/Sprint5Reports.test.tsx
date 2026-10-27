import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportsPage } from '../pages/ReportsPage';
import * as reportsApi from '../api/reports';
import * as usersApi from '../api/users';
import * as assignmentsApi from '../api/assignments';
import type { AssignedAsset, ReportsSummaryResponse, User } from '../types';

vi.mock('../api/reports', () => ({
  getReportsSummaryApi: vi.fn(),
  downloadAssetsCsvApi: vi.fn(),
  downloadAssetsPdfApi: vi.fn(),
  triggerFileDownload: vi.fn(),
  triggerCsvFileDownload: vi.fn(),
}));

vi.mock('../api/users', () => ({
  listUserDirectoryApi: vi.fn(),
}));

vi.mock('../api/assignments', () => ({
  listUserAssetsApi: vi.fn(),
}));

const MOCK_SUMMARY: ReportsSummaryResponse = {
  total_assets: 18,
  total_value: 24500.5,
  by_status: {
    AVAILABLE: 7,
    ASSIGNED: 8,
    IN_MAINTENANCE: 2,
    RETIRED: 1,
  },
  status_breakdown: [
    { status: 'AVAILABLE', count: 7 },
    { status: 'ASSIGNED', count: 8 },
    { status: 'IN_MAINTENANCE', count: 2 },
    { status: 'RETIRED', count: 1 },
  ],
  by_category: {
    Laptop: 8,
    Monitor: 5,
    Phone: 3,
    Furniture: 2,
  },
  category_breakdown: [
    {
      category_id: 1,
      category_name: 'Laptop',
      total: 8,
      available: 3,
      assigned: 4,
      in_maintenance: 1,
      retired: 0,
      total_value: 16000.0,
    },
    {
      category_id: 2,
      category_name: 'Monitor',
      total: 5,
      available: 2,
      assigned: 2,
      in_maintenance: 0,
      retired: 1,
      total_value: 3500.5,
    },
    {
      category_id: 3,
      category_name: 'Phone',
      total: 3,
      available: 1,
      assigned: 1,
      in_maintenance: 1,
      retired: 0,
      total_value: 3600.0,
    },
    {
      category_id: 4,
      category_name: 'Furniture',
      total: 2,
      available: 1,
      assigned: 1,
      in_maintenance: 0,
      retired: 0,
      total_value: 1400.0,
    },
  ],
};

const MOCK_USERS: User[] = [
  {
    id: 3,
    name: 'Employee User',
    email: 'employee@tektalis.com',
    role: 'EMPLOYEE',
    active: true,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const MOCK_EMPLOYEE_ASSETS: AssignedAsset[] = [
  {
    id: 101,
    tag: 'AST-0101',
    name: 'MacBook Pro 16 M4',
    serial_no: 'SN-MBP-0101',
    service_tag: 'SVC-MBP-0101',
    asset_tag: 'ATG-MBP-0101',
    category_id: 1,
    category_name: 'Laptop',
    purchase_date: '2026-01-10',
    cost: 2899.0,
    location: 'HQ Floor 3',
    status: 'ASSIGNED',
    version: 2,
    created_at: '2026-01-10T00:00:00Z',
    assignment_id: 501,
    assigned_on: '2026-02-01',
    user_id: 3,
    user_name: 'Employee User',
    user_email: 'employee@tektalis.com',
  },
];

describe('Sprint 5 Executive Reports & CSV Export (FR-12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reportsApi.getReportsSummaryApi).mockResolvedValue(MOCK_SUMMARY);
    vi.mocked(usersApi.listUserDirectoryApi).mockResolvedValue(MOCK_USERS);
    vi.mocked(assignmentsApi.listUserAssetsApi).mockResolvedValue(
      MOCK_EMPLOYEE_ASSETS,
    );
    vi.mocked(reportsApi.downloadAssetsCsvApi).mockResolvedValue(
      new Blob(['id,tag,name\n1,AST-0001,MacBook'], { type: 'text/csv' }),
    );
    vi.mocked(reportsApi.downloadAssetsPdfApi).mockResolvedValue(
      new Blob(['%PDF-1.4 mock'], { type: 'application/pdf' }),
    );
  });

  it('renders Executive Summary KPI cards (Total, Available, Assigned, In Maintenance, Retired) and Category Breakdown table', async () => {
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-total-assets')).toHaveTextContent('18');
    });

    expect(screen.getByTestId('kpi-available-assets')).toHaveTextContent('7');
    expect(screen.getByTestId('kpi-assigned-assets')).toHaveTextContent('8');
    expect(screen.getByTestId('kpi-maintenance-assets')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-retired-assets')).toHaveTextContent('1');

    expect(screen.getByText('₹24,500.50')).toBeInTheDocument();
    expect(screen.getAllByText('Laptop').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Monitor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Phone').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Furniture').length).toBeGreaterThan(0);
  });

  it('triggers CSV and PDF export downloads for the asset register (FR-12)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('kpi-total-assets')).toHaveTextContent('18');
    });

    await user.click(screen.getByRole('button', { name: /Download CSV/i }));

    await waitFor(() => {
      expect(reportsApi.downloadAssetsCsvApi).toHaveBeenCalledWith({
        status: '',
        category_id: '',
      });
      expect(reportsApi.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Blob),
        'assets_report.csv',
      );
    });

    expect(
      screen.getByText(/Asset register CSV report downloaded/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Download PDF/i }));

    await waitFor(() => {
      expect(reportsApi.downloadAssetsPdfApi).toHaveBeenCalledWith({
        status: '',
        category_id: '',
      });
      expect(reportsApi.triggerFileDownload).toHaveBeenCalledWith(
        expect.any(Blob),
        'assets_report.pdf',
      );
    });

    expect(
      screen.getByText(/Asset register PDF report downloaded/i),
    ).toBeInTheDocument();
  });

  it('fetches and displays assets assigned to a selected employee (FR-12)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Select Employee for Asset Report/i),
      ).toBeInTheDocument();
    });

    const selectEl = screen.getByLabelText(/Select Employee for Asset Report/i);
    await user.selectOptions(selectEl, '3');

    await waitFor(() => {
      expect(assignmentsApi.listUserAssetsApi).toHaveBeenCalledWith(3);
      expect(screen.getByText('AST-0101')).toBeInTheDocument();
      expect(screen.getByText('MacBook Pro 16 M4')).toBeInTheDocument();
    });
  });
});
