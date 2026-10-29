import { useEffect, useState } from 'react';
import { Search, Users, Pencil, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { listEmployees, listRoleRequests } from '../../api/employees';
import { listDepartments, listManagementLevels, listRegions } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import ResponsiveList from '../common/ResponsiveList';
import EmptyState from '../common/EmptyState';
import { GhostButton } from '../common/GlassButton';
import StandingWatcherControl from '../common/StandingWatcherControl';
import EmployeeLifecycleActions from './EmployeeLifecycleActions';
import RoleChangeRequest from './RoleChangeRequest';
import EditEmployeeModal from './EditEmployeeModal';

// Roughly a screenful; the directory is scanned, not read end to end.
const PAGE_SIZE = 10;

/** TT Suite: the global admin (portal) creates accounts, assigns roles and removes access.
 * New people arrive here from the portal with default details; HR completes the LMS data
 * (designation, department, level, region, manager...) and asks the global admin
 * for role changes. */
export default function EmployeeAdmin() {
  const [employees, setEmployees] = useState([]);
  const [managementLevels, setManagementLevels] = useState([]);
  const [regions, setRegions] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [roleRequests, setRoleRequests] = useState([]);
  const [search, setSearch] = useState('');
  const [editingEmployee, setEditingEmployee] = useState(null);

  const loadRoleRequests = () => listRoleRequests()
    .then((res) => setRoleRequests(res.data || []))
    .catch(() => setRoleRequests([]));
  // Departments and regions: also reloaded after the edit dialog adds or renames one.
  const loadMasters = () => Promise.all([listDepartments(), listRegions()])
    .then(([departmentRes, regionRes]) => {
      setDepartments(departmentRes.data);
      setRegions(regionRes.data);
    });
  const load = () => {
    loadRoleRequests();
    loadMasters();
    return Promise.all([listEmployees(), listManagementLevels()])
      .then(([employeeRes, levelRes]) => {
        setEmployees(employeeRes.data);
        setManagementLevels(levelRes.data);
      });
  };
  useEffect(() => {
    load();
  }, []);

  const pendingFor = (emp) => roleRequests.find((r) =>
    r.employee_id === emp.employee_id || (r.email && r.email === emp.work_email?.toLowerCase()));

  const [page, setPage] = useState(1);

  const filtered = employees.filter((emp) =>
    emp.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    emp.employee_code?.toLowerCase().includes(search.toLowerCase()) ||
    emp.designation?.toLowerCase().includes(search.toLowerCase()) ||
    emp.work_email?.toLowerCase().includes(search.toLowerCase())
  );

  // Paged client-side: the directory endpoint returns the whole roster in one call, so
  // this is about making a long list readable rather than about transfer size. If the
  // roster grows into the thousands the endpoint itself needs paging, not just this.
  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // A search that shrinks the list below the current page would otherwise leave the user
  // staring at an empty page with results they cannot see.
  useEffect(() => { setPage(1); }, [search]);

  const employeeSummary = (emp) => (
    <button
      type="button"
      onClick={() => setEditingEmployee(emp)}
      className="w-full flex items-center gap-3 group text-left"
      title="Click to edit employee details"
    >
      <div className="avatar shrink-0">{emp.full_name?.slice(0, 2).toUpperCase()}</div>
      <div className="min-w-0">
        <p className="text-sm font-medium flex items-center gap-1.5 truncate">
          {emp.full_name}
          <Pencil className="w-3 h-3 muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </p>
        <p className="small muted truncate">{emp.designation} · <span className="num">{emp.employee_code}</span></p>
        {emp.Department?.department_name && <p className="small muted truncate">{emp.Department.department_name}</p>}
        <span className={`pill mt-1 ${emp.status === 'ACTIVE' ? 'pill--success' : 'pill--muted'}`}>{emp.status}</span>
      </div>
    </button>
  );

  const columns = [
    { key: 'employee', label: 'Employee', render: employeeSummary },
    {
      key: 'roles', label: 'Role',
      render: (emp) => <RoleChangeRequest employee={emp} pending={pendingFor(emp)} onRequested={loadRoleRequests} />,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (emp) => (
        <div className="flex flex-wrap items-center gap-2">
          <StandingWatcherControl employeeId={emp.employee_id} employeeName={emp.full_name} />
          <EmployeeLifecycleActions employee={emp} allEmployees={employees} onChange={load} />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="alert" role="note">
        <Info />
        <p>
          New employees are added, and roles assigned, by the global admin in the TT Suite portal. They appear
          here with default details for you to complete. To change someone&apos;s role or remove their access,
          use <b>Request role change</b>.
        </p>
      </div>

      <GlassCard>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-accent-text" />
            <h3 className="h3">Employee directory</h3>
            <span className="pill pill--accent">{filtered.length} total</span>
          </div>

          <div className="relative w-full sm:w-60">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 muted" />
            <input
              type="text"
              placeholder="Search by name, code, role..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input text-xs"
              style={{ minHeight: 36, paddingLeft: '2.25rem' }}
            />
          </div>
        </div>

        <ResponsiveList
          columns={columns}
          rows={visible}
          rowKey={(emp) => emp.employee_id}
          empty={<EmptyState icon={Users} title="No employees found" description="No employees match your search criteria." />}
          renderCard={(emp) => (
            <>
              {employeeSummary(emp)}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2 border-t border-border">
                <RoleChangeRequest employee={emp} pending={pendingFor(emp)} onRequested={loadRoleRequests} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <StandingWatcherControl employeeId={emp.employee_id} employeeName={emp.full_name} />
                <EmployeeLifecycleActions employee={emp} allEmployees={employees} onChange={load} />
              </div>
            </>
          )}
        />

        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-border small muted">
            <span>
              Showing {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <GhostButton
                type="button"
                className="btn--sm !px-2"
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </GhostButton>
              <span>Page {currentPage} of {totalPages}</span>
              <GhostButton
                type="button"
                className="btn--sm !px-2"
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage >= totalPages}
                aria-label="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </GhostButton>
            </div>
          </div>
        )}
      </GlassCard>

      {editingEmployee && (
        <EditEmployeeModal
          employee={editingEmployee}
          allEmployees={employees}
          managementLevels={managementLevels}
          departments={departments}
          regions={regions}
          onListsChanged={loadMasters}
          onClose={() => setEditingEmployee(null)}
          onSaved={load}
        />
      )}
    </div>
  );
}
