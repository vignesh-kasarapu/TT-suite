import React, { useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { goToSuiteLogin } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
}) => {
  const { isAuthenticated, isLoading, status, user } = useAuth();

  useEffect(() => {
    // TT Suite: there is no AMS login page; the suite's sign-in returns here afterwards.
    // (No access: the API client already sends the person to the dashboard's banner.)
    if (status === 'signedOut') goToSuiteLogin();
  }, [status]);

  if (status === 'unavailable') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm font-medium text-slate-600 text-center">
          Asset Management is not reachable right now. Try again in a moment.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Verifying session...</div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Redirecting...</div>
      </div>
    );
  }

  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return (
      <div className="p-8 max-w-xl mx-auto mt-12 bg-white border border-slate-200 rounded-xl shadow-xs text-center">
        <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto mb-4">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-slate-900 mb-2">
          403 — Access Restricted
        </h2>
        <p className="text-sm text-slate-600 mb-4">
          Your role (<span className="font-semibold text-slate-900">{user.role}</span>) does not
          have permission to view this module. Required role:{' '}
          <span className="font-semibold text-blue-600">{allowedRoles.join(', ')}</span>.
        </p>
      </div>
    );
  }

  return <>{children}</>;
};
