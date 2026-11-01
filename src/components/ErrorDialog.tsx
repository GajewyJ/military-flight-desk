import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AppErrorInfo } from '../utils/errorMessages';

interface ErrorDialogProps {
  error: AppErrorInfo | null;
  onClose: () => void;
}

/**
 * Modal window that tells the user what went wrong. It is centred over the whole viewport (above the
 * map and the sticky header), so it is visible wherever the user has scrolled to.
 * Closes with the OK button, the Escape key, or a click outside the window.
 */
export const ErrorDialog: React.FC<ErrorDialogProps> = ({ error, onClose }) => {
  const okRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!error) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    okRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        // The OK button is the only control: keep keyboard focus inside the dialog.
        e.preventDefault();
        okRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [error]);

  if (!error) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-dialog-title"
        aria-describedby="error-dialog-message"
        className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-rose-200 overflow-hidden"
      >
        <div className="flex items-start gap-3 p-4 bg-rose-50 border-b border-rose-100">
          <div className="p-1.5 rounded-full bg-rose-100 text-rose-600 shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 id="error-dialog-title" className="text-sm font-bold text-rose-900">
              {error.title}
            </h2>
            <p id="error-dialog-message" className="mt-1 text-sm text-rose-800 break-words">
              {error.message}
            </p>
          </div>
        </div>

        {error.hints && error.hints.length > 0 && (
          <div className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              What to try
            </div>
            <ul className="list-disc pl-5 space-y-1 text-xs text-slate-700">
              {error.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          </div>
        )}

        {error.detail && (
          <div className="px-4 pb-3 text-[10px] font-mono text-slate-400 break-words">
            Technical detail: {error.detail}
          </div>
        )}

        <div className="flex justify-end p-3 bg-slate-50 border-t border-slate-100">
          <button
            ref={okRef}
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
