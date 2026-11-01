import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { SuiteProvider } from './context/SuiteContext';
import { ROUTER_BASENAME } from './api/paths';
import AppLayout from './components/layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ApplyLeave from './pages/ApplyLeave';
import MyRequests from './pages/MyRequests';
import RequestDetail from './pages/RequestDetail';
import Approvals from './pages/Approvals';
import MyTeam from './pages/MyTeam';
import TeamCalendar from './pages/TeamCalendar';
import HolidayCalendar from './pages/HolidayCalendar';
import Delegation from './pages/Delegation';
import Reports from './pages/Reports';
import CompOff from './pages/CompOff';
import Administration from './pages/Administration';

/** TT Suite: a 401 (no suite session) or 403 NO_APP_ACCESS is already being handled by
 * api/client.js, which sends the browser to the portal (/login?returnTo=... or
 * /?denied=lms) — keep the loader up meanwhile instead of racing it with a redirect
 * that would drop the deep link. Anything else (a genuine server/network failure on
 * the initial /employees/me call) is explained on the /login page. */
function isBeingRedirected(error) {
  return error?.status === 401 || error?.code === 'NO_APP_ACCESS';
}

function loginRedirectPath(error) {
  return `/login?error=${encodeURIComponent(error?.message || 'Something went wrong loading your session. Please sign in again.')}`;
}

function Protected({ children, roles }) {
  const { user, loading, error, hasRole } = useAuth();
  if (loading || (!user && isBeingRedirected(error))) return <FullScreenLoader />;
  if (!user) return <Navigate to={loginRedirectPath(error)} replace />;
  if (roles && !hasRole(...roles)) return <Navigate to="/" replace />;
  return children;
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg)' }}>
      <div className="w-10 h-10 rounded-full animate-spin" style={{ border: '2px solid var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
    </div>
  );
}

function PortalProfileRedirect() {
  window.location.replace('/profile');
  return <FullScreenLoader />;
}

function Shell() {
  const { user, loading, error } = useAuth();
  if (loading || (!user && isBeingRedirected(error))) return <FullScreenLoader />;
  if (!user) return <Navigate to={loginRedirectPath(error)} replace />;
  return <AppLayout />;
}

export default function App() {
  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      <SuiteProvider>
        <ThemeProvider>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<Shell />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/apply" element={<ApplyLeave />} />
                <Route path="/my-requests" element={<MyRequests />} />
                <Route path="/my-requests/:requestId" element={<RequestDetail />} />
                <Route path="/team-calendar" element={<TeamCalendar />} />
                <Route path="/holidays" element={<HolidayCalendar />} />
                {/* Profile and preferences live in the portal now; keep old links working. */}
                <Route path="/preferences" element={<PortalProfileRedirect />} />
                <Route path="/approvals" element={<Protected roles={['MANAGER', 'HR_ADMIN']}><Approvals /></Protected>} />
                <Route path="/my-team" element={<Protected roles={['MANAGER', 'HR_ADMIN']}><MyTeam /></Protected>} />
                <Route path="/delegation" element={<Protected roles={['MANAGER', 'HR_ADMIN']}><Delegation /></Protected>} />
                <Route path="/reports" element={<Protected><Reports /></Protected>} />
                <Route path="/comp-off" element={<Protected><CompOff /></Protected>} />
                <Route path="/administration" element={<Protected roles={['HR_ADMIN']}><Administration /></Protected>} />
              </Route>
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </SuiteProvider>
    </BrowserRouter>
  );
}
