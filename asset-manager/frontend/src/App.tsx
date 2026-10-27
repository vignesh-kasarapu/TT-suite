import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Layout } from './components/Layout';
import { SessionExpiredModal } from './components/SessionExpiredModal';
import { DashboardPage } from './pages/DashboardPage';
import { UsersPage } from './pages/UsersPage';
import { AssetsPage } from './pages/AssetsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { MyAssetsPage } from './pages/MyAssetsPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { OffboardingPage } from './pages/OffboardingPage';
import { ReplacementsPage } from './pages/ReplacementsPage';
import { AssetRequestsPage } from './pages/AssetRequestsPage';
import { ReportsPage } from './pages/ReportsPage';

export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="my-assets" element={<MyAssetsPage />} />
        <Route path="me/assets" element={<MyAssetsPage />} />
        <Route path="replacements" element={<ReplacementsPage />} />
        <Route path="replacement-requests" element={<ReplacementsPage />} />
        <Route path="asset-requests" element={<AssetRequestsPage />} />
        <Route
          path="assets"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'ASSET_MANAGER']}>
              <AssetsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="categories"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'ASSET_MANAGER']}>
              <CategoriesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="maintenance"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'ASSET_MANAGER']}>
              <MaintenancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="offboarding"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'ASSET_MANAGER']}>
              <OffboardingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="reports"
          element={
            <ProtectedRoute allowedRoles={['ADMIN', 'ASSET_MANAGER']}>
              <ReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="users"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      {/* TT Suite: served under /ams/ by the portal gateway (vite.config.ts `base`). */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <AppRoutes />
        <SessionExpiredModal />
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
