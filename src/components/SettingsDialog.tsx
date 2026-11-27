import React, { useEffect, useRef } from 'react';
import { Block, Segmented, Tape } from './ui';
import type { KneeboardStyle, Settings, Simulator, Theme } from '../hooks/useSettings';
import type { Units } from '../utils/units';
import { useEnglishVoice } from '../hooks/useEnglishVoice';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

/** One line of the units box: the name and the choice. */
const UnitRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center gap-3 py-1">
    <span className="cond w-16 shrink-0 text-[10px] text-ink-3">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>
);

/** The Settings window: opened from the top bar, closes with the button, Escape or a click outside. */
export const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onClose, settings, onChange }) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const voice = useEnglishVoice();

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
        className="sheet w-full max-w-md max-h-[90vh] flex flex-col text-ink"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b-2 border-ink">
          <Tape>
            <h2 id="settings-title" className="inline">
              Settings
            </h2>
          </Tape>
        </div>

        <div className="min-h-0 overflow-y-auto">
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

          <Block label="Simulator" hint="for the Export button">
            <p className="mb-1.5 text-[12px] text-ink-2">The flight plan file is made for this version of MSFS.</p>
            <Segmented<Simulator>
              ariaLabel="Simulator"
              value={settings.simulator}
              onChange={(simulator) => onChange({ simulator })}
              options={[
                { id: '2020', label: 'MSFS 2020' },
                { id: '2024', label: 'MSFS 2024' },
              ]}
            />
          </Block>

          {/* Only in the Windows app: the live link to the simulator is not there in the browser */}
          {typeof window !== 'undefined' && window.electronSim?.simLink && (
            <Block label="Spoken alerts" hint="live link to the simulator">
              <p className="mb-1.5 text-[12px] text-ink-2">
                A voice calls low altitude, off track and the main waypoints while the live link is on. The alerts are always
                spoken in English, with an English voice installed in Windows.
              </p>
              <Segmented<'on' | 'off'>
                ariaLabel="Spoken alerts"
                value={settings.voiceAlerts ? 'on' : 'off'}
                onChange={(v) => onChange({ voiceAlerts: v === 'on' })}
                options={[
                  { id: 'on', label: 'On' },
                  { id: 'off', label: 'Off' },
                ]}
              />
              {!voice.supported && <p className="mt-1.5 text-[11px] text-alert">This system has no speech, so nothing can be spoken.</p>}
              {voice.supported && !voice.available && (
                <p className="mt-1.5 text-[11px] text-alert">
                  No English voice is installed, so nothing is spoken (a voice in another language would read the English words and
                  numbers wrongly). In Windows, add one under Settings &gt; Time &amp; language &gt; Speech &gt; Add voices, choose an
                  English language, then restart this app.
                </p>
              )}
              {voice.available && <p className="mt-1.5 text-[11px] text-ink-3">Voice: {voice.voiceName}</p>}
            </Block>
          )}

          <Block label="Flight plan files" hint="MSFS and Little Navmap">
            <p className="mb-1.5 text-[12px] text-ink-2">
              These sorties take off and land at the same airfield. A plan that also ends with the landing circuit over the airfield
              starts and ends in the same place, which confuses the flight tracking of the simulator and of Little Navmap. Ending the
              plan where the route leaves the low-level corridor for the airfield (10 to 15 NM out), before the landing circuit,
              avoids that. You fly the circuit and land yourself.
            </p>
            <Segmented<'before' | 'at'>
              ariaLabel="Where the exported flight plan ends"
              value={settings.planEndsBeforeAirfield ? 'before' : 'at'}
              onChange={(v) => onChange({ planEndsBeforeAirfield: v === 'before' })}
              options={[
                { id: 'before', label: 'Before the landing circuit' },
                { id: 'at', label: 'On the airfield' },
              ]}
            />
          </Block>

          <Block label="Kneeboard PDF" hint="print mode">
            <p className="mb-1.5 text-[12px] text-ink-2">
              Print mode makes the kneeboard black on white with no coloured page, so it uses little ink.
            </p>
            <Segmented<KneeboardStyle>
              ariaLabel="Kneeboard style"
              value={settings.kneeboard}
              onChange={(kneeboard) => onChange({ kneeboard })}
              options={[
                { id: 'theme', label: 'Colours of the theme' },
                { id: 'print', label: 'Print: black on white' },
              ]}
              layout="col"
            />
          </Block>

          <Block label="Units" hint="shown on screen and in the PDF">
            <UnitRow label="Altitude">
              <Segmented<Units['altitude']>
                ariaLabel="Altitude unit"
                value={settings.units.altitude}
                onChange={(altitude) => onChange({ units: { ...settings.units, altitude } })}
                options={[
                  { id: 'ft', label: 'Feet' },
                  { id: 'm', label: 'Metres' },
                ]}
              />
            </UnitRow>
            <UnitRow label="Speed">
              <Segmented<Units['speed']>
                ariaLabel="Speed unit"
                value={settings.units.speed}
                onChange={(speed) => onChange({ units: { ...settings.units, speed } })}
                options={[
                  { id: 'kt', label: 'Knots' },
                  { id: 'kmh', label: 'km/h' },
                ]}
              />
            </UnitRow>
            <UnitRow label="Distance">
              <Segmented<Units['distance']>
                ariaLabel="Distance unit"
                value={settings.units.distance}
                onChange={(distance) => onChange({ units: { ...settings.units, distance } })}
                options={[
                  { id: 'nm', label: 'Nautical miles' },
                  { id: 'km', label: 'Kilometres' },
                ]}
              />
            </UnitRow>
            <UnitRow label="Pressure">
              <Segmented<Units['pressure']>
                ariaLabel="Pressure unit"
                value={settings.units.pressure}
                onChange={(pressure) => onChange({ units: { ...settings.units, pressure } })}
                options={[
                  { id: 'inhg', label: 'inHg' },
                  { id: 'hpa', label: 'hPa' },
                ]}
              />
            </UnitRow>
            <p className="mt-1.5 text-[11px] text-ink-3">
              Flight plan files for the simulator always stay in feet and knots.
            </p>
          </Block>
        </div>

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
