import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { queryClient } from "./controllers/useAsync";
import { AuthProvider, useAuth } from "./controllers/useAuth";
import type { Role } from "./models/types";
import { Shell } from "./views/components/Shell";
import { Empty, ErrorAlert, Skeleton } from "./views/components/ui";
import { AllClaimsPage } from "./views/pages/admin/AllClaimsPage";
import { AuditPage } from "./views/pages/admin/AuditPage";
import { ReportsPage } from "./views/pages/admin/ReportsPage";
import { SettingsPage } from "./views/pages/admin/SettingsPage";
import { AdvanceFormPage } from "./views/pages/AdvanceFormPage";
import { AdvancesPage } from "./views/pages/AdvancesPage";
import { ApprovalsPage } from "./views/pages/ApprovalsPage";
import { BankChangesPage } from "./views/pages/BankChangesPage";
import { ClaimDetailPage } from "./views/pages/ClaimDetailPage";
import { ClaimFormPage } from "./views/pages/ClaimFormPage";
import { ClaimsPage } from "./views/pages/ClaimsPage";
import { DelegationPage } from "./views/pages/DelegationPage";
import { FinanceReviewPage } from "./views/pages/FinanceReviewPage";
import { HomePage } from "./views/pages/HomePage";
import { NotificationsPage } from "./views/pages/NotificationsPage";
import { PayrollPage } from "./views/pages/PayrollPage";
import { PolicyPage } from "./views/pages/PolicyPage";
import { ProfilePage } from "./views/pages/ProfilePage";

function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { has } = useAuth();
  return roles.some(has) ? <>{children}</> : <Empty icon="shield" title="You do not have access to this page">Ask the Admin if you need it.</Empty>;
}

const admin = (el: ReactNode) => <RequireRole roles={["ADMIN"]}>{el}</RequireRole>;
const finance = (el: ReactNode) => <RequireRole roles={["FINANCE"]}>{el}</RequireRole>;

// Sign-in happens in the TT Suite portal; http.ts sends signed-out people to /login and people without
// Expense access to the dashboard (/?denied=expense).
function Gate() {
  const { user, ready, error, retry } = useAuth();
  if (!ready) return <div className="login"><Skeleton rows={3} /></div>;
  if (!user) return <div className="login"><div className="panel"><ErrorAlert error={error} onRetry={retry} /></div></div>;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<HomePage />} />
        <Route path="claims" element={<ClaimsPage />} />
        <Route path="claims/new" element={<ClaimFormPage />} />
        <Route path="claims/:id" element={<ClaimDetailPage />} />
        <Route path="claims/:id/edit" element={<ClaimFormPage />} />
        <Route path="advances/new" element={<AdvanceFormPage />} />
        <Route path="advances/:id/edit" element={<AdvanceFormPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="preferences" element={<Navigate to="/profile" replace />} />
        <Route path="policy" element={<PolicyPage />} />
        <Route path="approvals" element={<RequireRole roles={["APPROVER"]}><ApprovalsPage key="l1" level="L1" /></RequireRole>} />
        <Route path="second-approval" element={<RequireRole roles={["APPROVER"]}><ApprovalsPage key="l2" level="L2" /></RequireRole>} />
        <Route path="delegation" element={<RequireRole roles={["APPROVER", "FINANCE"]}><DelegationPage /></RequireRole>} />
        <Route path="finance/review" element={finance(<FinanceReviewPage />)} />
        <Route path="finance/payroll" element={finance(<PayrollPage />)} />
        <Route path="finance/advances" element={finance(<AdvancesPage />)} />
        <Route path="finance/bank-changes" element={finance(<BankChangesPage />)} />
        <Route path="admin" element={admin(<ReportsPage />)} />
        <Route path="admin/claims" element={admin(<AllClaimsPage />)} />
        <Route path="admin/settings" element={admin(<SettingsPage />)} />
        <Route path="admin/audit" element={admin(<AuditPage />)} />
        {["users", "categories", "limits"].map((t) => (
          <Route key={t} path={`admin/${t}`} element={<Navigate to={`/admin/settings?tab=${t}`} replace />} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
