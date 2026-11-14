import React from 'react';
import type { AppErrorInfo } from '../utils/errorMessages';

interface ErrorNoticeProps {
  error: AppErrorInfo | null;
  onClose: () => void;
}

/**
 * Message that says what went wrong and what to try, shown in the form panel right above the
 * Generate button, where the user is looking. It replaces the old pop-up window.
 */
export const ErrorNotice: React.FC<ErrorNoticeProps> = ({ error, onClose }) => {
  if (!error) return null;
  return (
    <div role="alert" className="border-2 border-alert bg-panel">
      <div className="flex items-baseline justify-between gap-2 px-2 pt-1">
        <span className="cond text-[11px] font-bold text-alert">{error.title}</span>
        <button
          type="button"
          onClick={onClose}
          className="px-1 text-ink-3 hover:text-ink cursor-pointer"
          aria-label="Dismiss message"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
      <div className="px-2 pb-2">
        <p className="text-[12px] leading-snug break-words">{error.message}</p>
        {error.hints && error.hints.length > 0 && (
          <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[11px] text-ink-2">
            {error.hints.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        )}
        {error.detail && <p className="mt-1 font-mono text-[10px] text-ink-3 break-words">Detail: {error.detail}</p>}
      </div>
    </div>
  );
};
