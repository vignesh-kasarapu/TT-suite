import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Shared modal shell — extracted from the sign-out confirmation dialog pattern
// (Topbar.jsx) so every "click a row to see details" screen reuses the same
// portal/backdrop/Escape-key/click-outside behavior instead of re-implementing it.
export default function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }) {
  const cardRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const handleClickOutside = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    // Phones: a near-full-screen card (2px gutter less, svh-aware height so the browser's own
    // bars never hide the footer buttons) whose title row and Close button stay pinned while
    // the body scrolls. From 640px up it is the centred 85vh card it always was.
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm">
      <div
        ref={cardRef}
        className={`w-full ${maxWidth} max-h-[calc(100dvh-1rem)] sm:max-h-[85vh] overflow-y-auto overscroll-contain p-4 sm:p-6`}
        style={{
          background: 'var(--color-surface)', color: 'var(--color-text)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)',
          border: '1px solid var(--color-border)',
        }}
      >
        {title && (
          <div
            className="sticky -top-4 sm:static z-10 -mx-4 -mt-4 px-4 pt-4 sm:m-0 sm:mb-4 sm:p-0 sm:pb-4 flex items-center justify-between gap-3 pb-3 mb-4 border-b border-border"
            style={{ background: 'var(--color-surface)' }}
          >
            <h3 className="font-display font-medium text-lg min-w-0 break-words">{title}</h3>
            <button type="button" onClick={onClose} className="btn btn--ghost btn--sm !px-2 shrink-0" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
