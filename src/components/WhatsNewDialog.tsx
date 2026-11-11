import React, { useEffect, useRef } from 'react';
import { Sparkles, ExternalLink } from 'lucide-react';
import { APP_VERSION, parseInline, parseReleaseMarkdown } from '../utils/changelog';
import type { WhatsNewState } from '../hooks/useWhatsNew';

interface WhatsNewDialogProps {
  state: WhatsNewState;
  onClose: () => void;
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((seg, i) => {
        if (seg.href) {
          return (
            <a
              key={i}
              href={seg.href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-blue-600 hover:underline break-all"
            >
              {seg.text}
            </a>
          );
        }
        if (seg.code) {
          return (
            <code key={i} className="px-1 py-0.5 rounded bg-slate-100 text-[11px] font-mono text-slate-700">
              {seg.text}
            </code>
          );
        }
        if (seg.bold) return <strong key={i}>{seg.text}</strong>;
        return <React.Fragment key={i}>{seg.text}</React.Fragment>;
      })}
    </>
  );
}

/**
 * Modal with the GitHub release notes of the running version. Closes with the button, the Escape
 * key, or a click outside the window.
 */
export const WhatsNewDialog: React.FC<WhatsNewDialogProps> = ({ state, onClose }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isOpen = state.open;

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  if (!state.open) return null;

  const notes = state.loading ? null : state.notes;
  const blocks = notes ? parseReleaseMarkdown(notes.body) : [];

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        <div className="flex items-start gap-3 p-4 bg-blue-50 border-b border-blue-100">
          <div className="p-1.5 rounded-full bg-blue-100 text-blue-600 shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 id="whats-new-title" className="text-sm font-bold text-blue-900">
              What&apos;s new in v{notes ? notes.version : APP_VERSION}
            </h2>
            {notes && <p className="mt-0.5 text-xs text-blue-800 break-words">{notes.title}</p>}
          </div>
        </div>

        <div className="p-4 overflow-y-auto text-xs text-slate-700 space-y-2">
          {state.loading && <p className="text-slate-500">Loading release notes…</p>}
          {!state.loading && !notes && (
            <p className="text-slate-600">
              {state.offline
                ? 'Could not load the release notes. Check your internet connection and try again.'
                : `There are no release notes for v${APP_VERSION}.`}
            </p>
          )}
          {blocks.map((block, i) => {
            if (block.type === 'heading') {
              return (
                <h3
                  key={i}
                  className={`font-bold text-slate-900 ${block.level <= 2 ? 'text-sm pt-1' : 'text-xs pt-1'}`}
                >
                  <Inline text={block.text} />
                </h3>
              );
            }
            if (block.type === 'list') {
              return (
                <ul key={i} className="list-disc pl-5 space-y-1">
                  {block.items.map((item, j) => (
                    <li key={j}>
                      <Inline text={item} />
                    </li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={i}>
                <Inline text={block.text} />
              </p>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 border-t border-slate-100">
          {notes ? (
            <a
              href={notes.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              View on GitHub <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            <span />
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
