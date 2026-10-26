import ReportsAdmin from '../components/admin/ReportsAdmin';
import Topbar from '../components/layout/Topbar';

/** Standalone Manager + HR/Admin route — ReportsAdmin itself is also embedded inside
 * Administration.jsx (HR/Admin's "Reports" section there), but that page is HR-only, so
 * Managers had no way to reach the leave-taken report the backend already scopes for
 * them (reports.routes.js already allows MANAGER on /reports/leave-taken). */
export default function Reports() {
  return (
    <>
      <Topbar title="Reports" />
      <ReportsAdmin />
    </>
  );
}
