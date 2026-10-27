import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import { useAppStore } from './store/useAppStore'
import ToastContainer from './components/ToastContainer'
import { ConfirmDialogMount } from './components/shared/ConfirmDialog'
import Layout from './components/Layout'
import { getMe } from './api/client'

// Route-level code splitting: each page ships in its own chunk instead of one ~2MB bundle.
const Configure = lazy(() => import('./pages/Configure'))
const Upload = lazy(() => import('./pages/Upload'))
const Leaderboard = lazy(() => import('./pages/Leaderboard'))
const CandidateDetail = lazy(() => import('./pages/CandidateDetail'))
const Analytics = lazy(() => import('./pages/Analytics'))
const Settings = lazy(() => import('./pages/Settings'))
const Search = lazy(() => import('./pages/Search'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const CompareResumes = lazy(() => import('./pages/CompareResumes'))
const AddJobPage = lazy(() => import('./pages/AddJobPage'))
const KanbanBoard = lazy(() => import('./pages/KanbanBoard'))
const ShareView = lazy(() => import('./pages/ShareView'))
const SharedReportView = lazy(() => import('./pages/SharedReportView'))
const DiversityDashboard = lazy(() => import('./pages/DiversityDashboard'))
const Reports = lazy(() => import('./pages/Reports'))

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <svg className="animate-spin h-8 w-8 text-accent" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    </div>
  )
}

type Access = 'loading' | 'ready' | 'noAccess' | 'unavailable'

/** TT Suite sign-in: the portal's session decides. Asking /auth/me once per page load is enough -
 * every API call re-checks it; a 401 goes to the suite sign-in and a 403 NO_APP_ACCESS to the
 * dashboard (api/client.ts). */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = useState<Access>(() => (useAppStore.getState().user ? 'ready' : 'loading'))
  const setMe = useAppStore((s) => s.setMe)

  useEffect(() => {
    if (access !== 'loading') return
    getMe()
      .then((me) => { setMe(me); setAccess('ready') })
      .catch((err: any) => {
        const status = err?.response?.status
        if (status === 401 || status === 403) setAccess('noAccess') // the client interceptor is already redirecting
        else setAccess('unavailable')
      })
  }, [access, setMe])

  if (access === 'ready') return <>{children}</>
  if (access === 'unavailable') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold">The Resume Evaluator is not answering right now.</p>
        <p className="text-sm opacity-70">It may be starting up. Try again in a moment, or go back to the dashboard.</p>
        <div className="flex gap-3">
          <button type="button" className="rounded-md border px-4 py-2" onClick={() => setAccess('loading')}>Try again</button>
          <a className="rounded-md border px-4 py-2" href="/">Dashboard</a>
        </div>
      </div>
    )
  }
  return <RouteFallback />
}


export default function App() {
  return (
    <ConfirmDialogMount>
    <ErrorBoundary>
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route
        path="/configure"
        element={
          <ProtectedRoute>
            <Layout>
              <Configure />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/upload"
        element={
          <ProtectedRoute>
            <Layout>
              <Upload />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/leaderboard"
        element={
          <ProtectedRoute>
            <Layout>
              <Leaderboard />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/kanban"
        element={
          <ProtectedRoute>
            <Layout>
              <KanbanBoard />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/results/:id"
        element={
          <ProtectedRoute>
            <Layout>
              <CandidateDetail />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <Layout>
              <Analytics />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/diversity"
        element={
          <ProtectedRoute>
            <Layout>
              <DiversityDashboard />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <Layout>
              <Reports />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Consolidated admin/config hub — Email Ingestion, User Management,
          Audit Logs, and Data Retention all live under here now instead of
          as separate top-level nav items. */}
      <Route
        path="/settings/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Settings />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Old top-level paths — redirect to their new home under /settings */}
      <Route path="/email-ingestion" element={<Navigate to="/settings/email" replace />} />
      <Route path="/users" element={<Navigate to="/settings/users" replace />} />
      <Route path="/audit" element={<Navigate to="/settings/audit" replace />} />
      <Route path="/gdpr" element={<Navigate to="/settings/gdpr" replace />} />

      <Route
        path="/search"
        element={
          <ProtectedRoute>
            <Layout>
              <Search />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/compare"
        element={
          <ProtectedRoute>
            <Layout>
              <CompareResumes />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Post a Job — protected, stays inside recruiter portal */}
      <Route
        path="/jobs/new"
        element={
          <ProtectedRoute>
            <Layout>
              <AddJobPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Public share view — no auth required */}
      <Route path="/share/:token" element={<ShareView />} />
      <Route path="/reports/shared/:token" element={<SharedReportView />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
    </Suspense>
    <ToastContainer />
    </ErrorBoundary>
    </ConfirmDialogMount>
  )
}
