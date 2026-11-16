import React, { useEffect, useRef } from 'react';
import { Block, Segmented, Tape } from './ui';
import type { Settings, Theme } from '../hooks/useSettings';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** The Settings window: opened from the top bar, closes with the button, Escape or a click outside. */
export const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose, settings, onChange }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="sheet w-full max-w-md flex flex-col text-ink"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b-2 border-ink">
          <Tape>
            <h2 id="settings-title" className="inline">
              Settings
            </h2>
          </Tape>
        </div>

        <Block label="Appearance" hint="saved on this computer">
          <p className="mb-1.5 text-[12px] text-ink-2">Theme of the app and of the kneeboard PDF.</p>
          <Segmented<Theme>
            ariaLabel="Theme"
            value={settings.theme}
            onChange={(theme) => onChange({ theme })}
            options={[
              { id: 'day', label: 'Day', sub: 'manila paper' },
              { id: 'night', label: 'Night', sub: 'dark green' },
            ]}
          />
        </Block>

        <div className="flex justify-end p-2 border-t-2 border-ink">
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
