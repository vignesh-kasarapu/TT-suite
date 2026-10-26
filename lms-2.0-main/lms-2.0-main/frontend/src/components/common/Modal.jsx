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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        ref={cardRef}
        className={`w-full ${maxWidth} max-h-[85vh] overflow-y-auto p-6`}
        style={{
          background: 'var(--color-surface)', color: 'var(--color-text)',
          borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)',
          border: '1px solid var(--color-border)',
        }}
      >
        {title && (
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-border">
            <h3 className="font-display font-medium text-lg">{title}</h3>
            <button type="button" onClick={onClose} className="btn btn--ghost btn--sm !px-2" aria-label="Close">
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
