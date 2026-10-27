import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Search,
  UserCog,
  X,
} from 'lucide-react';
import { extractErrorMessage } from '../api/client';
import { listRoleRequestsApi, listUsersApi, requestRoleChangeApi } from '../api/users';
import { getRoleBadgeClasses } from '../components/Layout';
import type { RoleRequest, SuiteRole, User, UserRole } from '../types';

// TT Suite: accounts, roles, emails and deactivation belong to the global admin in the portal.
// Here an AMS admin lists people and requests a role change, which the global admin approves.
type RoleChoice = SuiteRole | 'none';

const ROLE_CHOICES: { value: RoleChoice; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'manager', label: 'Asset Manager' },
  { value: 'admin', label: 'Admin' },
  { value: 'none', label: 'No access' },
];

const SUITE_ROLE_OF: Record<UserRole, SuiteRole> = {
  EMPLOYEE: 'employee',
  ASSET_MANAGER: 'manager',
  ADMIN: 'admin',
};

function roleRequestLabel(role: SuiteRole | null): string {
  return ROLE_CHOICES.find((c) => c.value === (role ?? 'none'))?.label ?? 'No access';
}

const SENT_FOR_APPROVAL = 'Sent to the global admin for approval.';

export const UsersPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pages, setPages] = useState<number>(1);
  const [search, setSearch] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Open role-change requests, by email
  const [requests, setRequests] = useState<Record<string, RoleRequest>>({});

  // Request role change modal
  const [requestingFor, setRequestingFor] = useState<User | null>(null);
  const [requestRole, setRequestRole] = useState<RoleChoice>('employee');
  const [requestNote, setRequestNote] = useState<string>('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState<boolean>(false);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    setPageError(null);
    try {
      const activeParam =
        activeFilter === 'ALL' ? '' : activeFilter === 'ACTIVE' ? true : false;
      const data = await listUsersApi({
        page,
        size: 20,
        sort: 'id,asc',
        search,
        role: roleFilter,
        active: activeParam,
      });
      setUsers(data.items);
      setTotal(data.total);
      setPages(data.pages);
    } catch (err) {
      setPageError(extractErrorMessage(err, 'Failed to load users'));
    } finally {
      setIsLoading(false);
    }
  }, [page, search, roleFilter, activeFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const fetchRequests = useCallback(async () => {
    try {
      const list = await listRoleRequestsApi();
      const byEmail: Record<string, RoleRequest> = {};
      for (const r of Array.isArray(list) ? list : []) {
        byEmail[r.email.toLowerCase()] = r;
      }
      setRequests(byEmail);
    } catch {
      // The badges are a convenience; the list still works without them.
      setRequests({});
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const openRequestModal = (u: User) => {
    const open = requests[u.email.toLowerCase()];
    setRequestingFor(u);
    setRequestRole(open ? (open.role ?? 'none') : SUITE_ROLE_OF[u.role]);
    setRequestNote('');
    setRequestError(null);
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestingFor) return;
    setRequestError(null);
    setIsRequesting(true);
    try {
      await requestRoleChangeApi(
        requestingFor.id,
        requestRole === 'none' ? null : requestRole,
        requestNote.trim(),
      );
      setRequestingFor(null);
      setPageError(null);
      setSuccessMessage(SENT_FOR_APPROVAL);
      await fetchRequests();
    } catch (err) {
      setRequestError(extractErrorMessage(err, 'Could not send the request'));
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">User Management</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            People with Asset Management access. Accounts and roles are managed by the global
            admin in the TT Suite portal; request a change here.
          </p>
        </div>
      </div>

      {/* Banners */}
      {pageError && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center justify-between gap-3 text-sm text-red-700"
        >
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{pageError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPageError(null)}
            className="text-red-500 hover:text-red-700 cursor-pointer"
            aria-label="Dismiss error"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-3 text-sm text-emerald-700"
        >
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-600 hover:text-emerald-800 cursor-pointer"
            aria-label="Dismiss status"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search & Filters Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search users"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name or email..."
            className="w-full pl-10 pr-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <select
          aria-label="Filter by role"
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as UserRole | '');
            setPage(1);
          }}
          className="px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="">All Roles</option>
          <option value="ADMIN">ADMIN</option>
          <option value="ASSET_MANAGER">ASSET_MANAGER</option>
          <option value="EMPLOYEE">EMPLOYEE</option>
        </select>

        <select
          aria-label="Filter by status"
          value={activeFilter}
          onChange={(e) => {
            setActiveFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE');
            setPage(1);
          }}
          className="px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="ALL">All Statuses</option>
          <option value="ACTIVE">Active Only</option>
          <option value="INACTIVE">Deactivated Only</option>
        </select>
      </div>

      {/* Users Table Card */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 px-4 whitespace-nowrap">Name</th>
                <th className="py-3 px-4 whitespace-nowrap">Email</th>
                <th className="py-3 px-4 whitespace-nowrap">Role</th>
                <th className="py-3 px-4 whitespace-nowrap">Status</th>
                <th className="py-3 px-4 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-600">
                    Loading users...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-slate-600">
                    No users found matching the current filters.
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap font-medium text-slate-900">
                      {u.name}
                    </td>
                    <td className="py-3.5 px-4 align-middle break-all text-slate-600">
                      {u.email}
                    </td>
                    <td className="py-3.5 px-4 align-middle">
                      <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold border ${getRoleBadgeClasses(
                          u.role,
                        )}`}
                      >
                        {u.role}
                      </span>
                      {requests[u.email.toLowerCase()] && (
                        <span
                          data-testid={`role-request-badge-${u.id}`}
                          title="Waiting for the global admin"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap"
                        >
                          <Clock className="w-3 h-3" />
                          Requested: {roleRequestLabel(requests[u.email.toLowerCase()].role)}
                        </span>
                      )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                      {u.active ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-300">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          Deactivated
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-middle text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openRequestModal(u)}
                        aria-label={`Request role change for ${u.name}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors cursor-pointer"
                      >
                        <UserCog className="w-3.5 h-3.5" />
                        <span>Request change</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span>
            Showing <strong className="text-slate-900">{users.length}</strong> of{' '}
            <strong className="text-slate-900">{total}</strong> user(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="px-3 py-1 rounded-md border border-slate-200 bg-white text-slate-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Request Role Change Modal */}
      {requestingFor && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="role-request-modal-title"
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-lg max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <UserCog className="w-5 h-5 text-blue-600" />
                <h3 id="role-request-modal-title" className="text-base font-bold text-slate-900">
                  Request role change — {requestingFor.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRequestingFor(null)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                aria-label="Close request modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitRequest} className="p-6 space-y-4" noValidate>
              <p className="text-xs text-slate-600">
                The global admin approves role changes in the TT Suite portal. Current role:{' '}
                <strong className="text-slate-900">{requestingFor.role}</strong>.
              </p>

              {requestError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{requestError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="role-request-role"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  New role
                </label>
                <select
                  id="role-request-role"
                  value={requestRole}
                  onChange={(e) => setRequestRole(e.target.value as RoleChoice)}
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {ROLE_CHOICES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="role-request-note"
                  className="block text-sm font-medium text-slate-900 mb-1"
                >
                  Note for the global admin <span className="text-slate-500">(optional)</span>
                </label>
                <textarea
                  id="role-request-note"
                  rows={3}
                  maxLength={1000}
                  value={requestNote}
                  onChange={(e) => setRequestNote(e.target.value)}
                  placeholder="Why the change is needed"
                  className="w-full px-3.5 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setRequestingFor(null)}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRequesting}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 cursor-pointer"
                >
                  {isRequesting ? 'Sending...' : 'Send request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

