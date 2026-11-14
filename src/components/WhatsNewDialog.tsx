import React, { useEffect, useRef } from 'react';
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
              className="text-accent underline break-all"
            >
              {seg.text}
            </a>
          );
        }
        if (seg.code) {
          return (
            <code key={i} className="px-1 bg-inset text-[11px] font-mono">
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
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-ink/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="sheet w-full max-w-lg max-h-[85vh] flex flex-col text-ink"
      >
        <div className="px-3 pt-2 pb-2 border-b-2 border-ink">
          <h2 id="whats-new-title" className="cond text-[16px] font-bold">
            What&apos;s new in v{notes ? notes.version : APP_VERSION}
          </h2>
          {notes && <p className="mt-0.5 text-[11px] text-ink-2 break-words">{notes.title}</p>}
        </div>

        <div className="p-3 overflow-y-auto text-[12px] text-ink space-y-2">
          {state.loading && <p className="text-ink-3">Loading release notes…</p>}
          {!state.loading && !notes && (
            <p className="text-ink-2">
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
                  className={`font-bold ${block.level <= 2 ? 'text-[13px] pt-1' : 'text-[12px] pt-1'}`}
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

        <div className="flex items-center justify-between gap-3 p-2 border-t-2 border-ink">
          {notes ? (
            <a
              href={notes.url}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[11px] text-accent underline"
            >
              View on GitHub
            </a>
          ) : (
            <span />
          )}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="cond px-4 h-7 bg-ink text-on-ink text-[11px] font-bold cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
