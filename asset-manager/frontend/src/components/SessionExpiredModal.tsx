import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  SESSION_EXPIRED_EVENT,
  goToSuiteLogin,
  resetSessionExpiredFlag,
} from '../api/client';

const COUNTDOWN_SECONDS = 3;

export const SessionExpiredModal: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    const handleExpired = () => {
      setSecondsLeft(COUNTDOWN_SECONDS);
      setIsOpen(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;

    if (secondsLeft <= 0) {
      // TT Suite: sign in again through the portal, which returns here afterwards.
      resetSessionExpiredFlag();
      setIsOpen(false);
      goToSuiteLogin();
      return undefined;
    }

    const timerId = window.setTimeout(() => {
      setSecondsLeft((prev) => prev - 1);
    }, 1000);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isOpen, secondsLeft]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      data-testid="session-expired-modal"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 pointer-events-auto">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h2
              id="session-expired-title"
              className="text-lg font-bold text-slate-900"
            >
              Authentication has expired
            </h2>
            <p className="text-sm text-slate-600 mt-1.5">
              Authentication has been expired, redirecting to login in{' '}
              <strong className="text-slate-900" data-testid="session-expired-countdown">
                {secondsLeft}
              </strong>{' '}
              second{secondsLeft === 1 ? '' : 's'}.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Please sign in to the Tektalis Suite again to continue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
