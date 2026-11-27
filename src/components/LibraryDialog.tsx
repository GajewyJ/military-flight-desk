import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { GeneratedFlightPlan } from '../types/flightDesk';
import type { RecPoint } from '../utils/flightRecorder';
import { useUnits } from '../hooks/useUnits';
import { libraryAvailable, listItems, newItemId, readItem, removeItem, writeItem, type LibraryItem } from '../utils/library';
import { defaultMissionName, missionMeta, missionProfileName, packMission, unpackMission, type MissionMeta } from '../utils/missions';
import { unpackFlight, type FlightMeta } from '../utils/flightHistory';

type Tab = 'missions' | 'flights';

interface LibraryDialogProps {
  open: boolean;
  onClose: () => void;
  /** The plan on screen, to save; null when there is none. */
  plan: GeneratedFlightPlan | null;
  /** A saved mission was picked: show it. */
  onLoadMission: (plan: GeneratedFlightPlan) => void;
  /** A saved flight was picked: show its debrief. */
  onOpenFlight: (plan: GeneratedFlightPlan, points: RecPoint[]) => void;
  /** Changes when a flight was saved (so an open list can show it). */
  flightsVersion: number;
}

function when(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function duration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

const small =
  'h-6 px-2 bg-panel text-ink border border-rule-strong font-mono text-[11px] font-semibold hover:bg-inset cursor-pointer disabled:opacity-50 disabled:cursor-default';

/**
 * The library: saved missions (save the plan on screen, load one back, delete) and the history of flown flights (open the
 * debrief of a past flight, delete). Everything is kept automatically inside the application's own files.
 */
export const LibraryDialog: React.FC<LibraryDialogProps> = ({ open, onClose, plan, onLoadMission, onOpenFlight, flightsVersion }) => {
  const U = useUnits();
  const flightsOk = libraryAvailable('flights');
  const [tab, setTab] = useState<Tab>('missions');
  const [missions, setMissions] = useState<Array<LibraryItem<MissionMeta>> | null>(null);
  const [flights, setFlights] = useState<Array<LibraryItem<FlightMeta>> | null>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  // The item whose delete button was clicked once: the second click deletes
  const [sure, setSure] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const fail = (err: unknown) => setMessage({ text: err instanceof Error ? err.message : 'Something went wrong', bad: true });

  const refresh = useCallback(async () => {
    try {
      setMissions(await listItems<MissionMeta>('missions'));
    } catch (err) {
      setMissions([]);
      fail(err);
    }
    if (flightsOk) {
      try {
        setFlights(await listItems<FlightMeta>('flights'));
      } catch (err) {
        setFlights([]);
        fail(err);
      }
    }
  }, [flightsOk]);

  useEffect(() => {
    if (!open) return;
    setMessage(null);
    setSure(null);
    if (plan) setName(defaultMissionName(plan));
    void refresh();
    // The name is offered again each time the dialog opens
  }, [open, flightsVersion, refresh]);

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

  // The "sure?" question goes away by itself
  useEffect(() => {
    if (!sure) return;
    const t = window.setTimeout(() => setSure(null), 3000);
    return () => window.clearTimeout(t);
  }, [sure]);

  if (!open) return null;

  const saveMission = async () => {
    if (!plan) return;
    try {
      await writeItem('missions', newItemId('m'), missionMeta(plan, name), packMission(plan));
      setMessage({ text: `Saved: ${missionMeta(plan, name).name}`, bad: false });
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const loadMission = async (id: string) => {
    try {
      const loaded = unpackMission(await readItem('missions', id));
      if (!loaded) {
        setMessage({ text: 'This mission cannot be opened: it is damaged or from a newer version.', bad: true });
        return;
      }
      onLoadMission(loaded);
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  const openFlight = async (id: string) => {
    try {
      const f = unpackFlight(await readItem('flights', id));
      if (!f) {
        setMessage({ text: 'This flight cannot be opened: it is damaged or from a newer version.', bad: true });
        return;
      }
      onOpenFlight(f.plan, f.points);
      onClose();
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (kind: 'missions' | 'flights', id: string) => {
    if (sure !== id) {
      setSure(id);
      return;
    }
    setSure(null);
    try {
      await removeItem(kind, id);
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const tabButton = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`cond h-7 px-3 text-[12px] font-bold border border-rule-strong cursor-pointer ${tab === id ? 'bg-ink text-on-ink' : 'bg-panel text-ink hover:bg-inset'}`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-ink/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="library-title" className="sheet w-full max-w-2xl max-h-[88vh] flex flex-col text-ink">
        <div className="px-3 pt-2 pb-2 border-b-2 border-ink">
          <h2 id="library-title" className="cond text-[16px] font-bold">
            Missions
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-2">Saved automatically inside the application's own files.</p>
        </div>

        {flightsOk && (
          <div role="tablist" aria-label="Library" className="flex gap-1 px-3 pt-2">
            {tabButton('missions', 'SAVED MISSIONS')}
            {tabButton('flights', 'FLIGHT HISTORY')}
          </div>
        )}

        <div className="p-3 overflow-y-auto space-y-3 min-h-[12rem]">
          {tab === 'missions' && (
            <>
              <div className="flex flex-wrap items-center gap-1">
                <label className="sr-only" htmlFor="mission-name">
                  Name of the mission
                </label>
                <input
                  id="mission-name"
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!plan}
                  placeholder={plan ? 'Name' : 'Generate a mission first'}
                  className="flex-1 min-w-[12rem] h-7 px-2 bg-inset text-ink border border-rule-strong font-mono text-[12px] disabled:opacity-50"
                />
                <button type="button" onClick={saveMission} disabled={!plan} className={small}>
                  SAVE CURRENT MISSION
                </button>
              </div>

              {missions === null && <p className="text-[12px] text-ink-2">Loading...</p>}
              {missions !== null && missions.length === 0 && (
                <p className="text-[12px] text-ink-2">No saved missions yet. Generate a mission and save it here to fly it again later.</p>
              )}
              {missions !== null && missions.length > 0 && (
                <ul className="divide-y divide-rule border-y border-rule">
                  {missions.map((m) => (
                    <li key={m.id} className="py-1.5 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] font-bold truncate">{m.meta.name}</div>
                        <div className="font-mono text-[11px] text-ink-2 truncate">
                          {missionProfileName(m.meta.missionProfile)} &middot; {m.meta.depIdent} &middot; {U.dist(m.meta.distanceNm)} &middot; {m.meta.timeMin} min
                          {m.meta.edited ? ' \u00b7 edited by hand' : ''} &middot; saved {when(m.meta.savedAt)}
                        </div>
                      </div>
                      <button type="button" onClick={() => loadMission(m.id)} className={small}>
                        LOAD
                      </button>
                      <button type="button" onClick={() => remove('missions', m.id)} className={small} aria-label={`Delete ${m.meta.name}`}>
                        {sure === m.id ? 'SURE?' : 'DELETE'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {tab === 'flights' && flightsOk && (
            <>
              <p className="text-[12px] text-ink-2">Every flight is saved when you land with the live link on. Open one to see its debrief again.</p>
              {flights === null && <p className="text-[12px] text-ink-2">Loading...</p>}
              {flights !== null && flights.length === 0 && <p className="text-[12px] text-ink-2">No flights yet.</p>}
              {flights !== null && flights.length > 0 && (
                <ul className="divide-y divide-rule border-y border-rule">
                  {flights.map((f) => (
                    <li key={f.id} className="py-1.5 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[12px] font-bold truncate">
                          {when(f.meta.startedAt)} &middot; {f.meta.callsign}
                        </div>
                        <div className="font-mono text-[11px] text-ink-2 truncate">
                          {missionProfileName(f.meta.missionProfile)} &middot; {f.meta.depIdent} &middot; {duration(f.meta.airborneSec)} &middot; {U.dist(f.meta.distanceNm)}
                        </div>
                      </div>
                      <button type="button" onClick={() => openFlight(f.id)} className={small}>
                        OPEN
                      </button>
                      <button type="button" onClick={() => remove('flights', f.id)} className={small} aria-label={`Delete the flight of ${when(f.meta.startedAt)}`}>
                        {sure === f.id ? 'SURE?' : 'DELETE'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-2 border-t-2 border-ink">
          <span className={`font-mono text-[11px] truncate ${message?.bad ? 'text-alert' : 'text-ink-2'}`} role="status">
            {message?.text ?? ''}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="h-7 px-3 bg-ink text-on-ink border border-rule-strong font-mono text-[11px] font-semibold cursor-pointer"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
