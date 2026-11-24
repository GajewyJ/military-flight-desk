import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GeneratedFlightPlan } from '../types/flightDesk';
import type { LiveFlightView } from '../hooks/useLiveFlight';
import { useUnits } from '../hooks/useUnits';
import { useSimConnect } from '../hooks/useSimConnect';
import { computeDebrief } from '../utils/debrief';
import { OFF_TRACK_NM } from '../utils/liveFlight';
import { trackFileName, trackToGpx, trackToKml } from '../utils/trackExport';

interface FlightDebriefProps {
  plan: GeneratedFlightPlan;
  flight: LiveFlightView['flight'];
}

function clock(seconds: number): string {
  const s = Math.round(Math.max(0, seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

function signedClock(seconds: number): string {
  const sign = seconds > 0.5 ? '+' : seconds < -0.5 ? '-' : '';
  return `${sign}${clock(Math.abs(seconds))}`;
}

const Row: React.FC<{ label: string; children: React.ReactNode; tone?: 'warn' | 'alert' }> = ({ label, children, tone }) => (
  <div className="flex items-baseline justify-between gap-3 py-0.5 border-b border-rule">
    <dt className="text-ink-2">{label}</dt>
    <dd className={`font-mono font-semibold text-right ${tone === 'alert' ? 'text-alert' : tone === 'warn' ? 'text-accent' : ''}`}>{children}</dd>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section>
    <h3 className="cond text-[12px] font-bold tracking-wide border-b-2 border-ink pb-0.5 mb-1">{title}</h3>
    <dl className="text-[12px]">{children}</dl>
  </section>
);

/**
 * Debrief of the recorded flight: how long, how far, how close to the plan, time per leg and the time below the planned
 * radar altitude, with the flown track as a GPX or KML file. Closes with the button, the Escape key, or a click outside.
 */
export const FlightDebrief: React.FC<FlightDebriefProps> = ({ plan, flight }) => {
  const U = useUnits();
  const { saveWithDialog } = useSimConnect();
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(flight.onCloseDebrief);
  onCloseRef.current = flight.onCloseDebrief;
  const [saved, setSaved] = useState<string | null>(null);
  const open = flight.debriefOpen;

  // The figures are worked out when the dialog opens; open it again for the latest of a flight in progress
  const debrief = useMemo(() => (open ? computeDebrief(plan, flight.getPoints()) : null), [open, plan, flight]);

  useEffect(() => {
    if (!open) return;
    setSaved(null);
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

  const exportTrack = async (kind: 'gpx' | 'kml') => {
    const points = flight.getPoints();
    const content = kind === 'gpx' ? trackToGpx(plan, points) : trackToKml(plan, points);
    const result = await saveWithDialog(trackFileName(plan, kind), content, kind, kind === 'gpx' ? 'GPX track' : 'Google Earth KML');
    if (result.success) setSaved(result.filePath ?? 'Saved');
    else if (!result.canceled) setSaved(`Could not save: ${result.error ?? 'unknown error'}`);
  };

  const d = debrief;
  const timeDelta = d ? d.airborneSec - d.plannedSec : 0;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-ink/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) flight.onCloseDebrief();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="debrief-title" className="sheet w-full max-w-3xl max-h-[88vh] flex flex-col text-ink">
        <div className="px-3 pt-2 pb-2 border-b-2 border-ink">
          <h2 id="debrief-title" className="cond text-[16px] font-bold">
            Flight debrief &middot; {plan.callsign}
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-2">
            {flight.phase === 'airborne' ? 'Flight in progress: the figures so far. ' : ''}
            {plan.operatingAirbase.ident} &middot; {plan.missionProfile.replace(/_/g, ' ')}
          </p>
        </div>

        <div className="p-3 overflow-y-auto space-y-4">
          {!d && <p className="text-[12px] text-ink-2">There is not enough recorded yet. Fly a while with the live link switched on.</p>}

          {d && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Section title="FLIGHT">
                  <Row label="Time in the air">
                    {clock(d.airborneSec)} <span className="text-ink-3">(plan {clock(d.plannedSec)}, {signedClock(timeDelta)})</span>
                  </Row>
                  <Row label="Distance flown">
                    {U.dist(d.distanceNm)} <span className="text-ink-3">(plan {U.dist(d.plannedNm)})</span>
                  </Row>
                  <Row label="Ground speed">
                    {U.speed(d.avgGsKts)} avg <span className="text-ink-3">&middot; {U.speed(d.maxGsKts)} max</span>
                  </Row>
                  <Row label="Highest altitude">{U.alt(d.maxAltFt)}</Row>
                  <Row label="Lowest radar altitude">{U.alt(d.minAglFt)}</Row>
                  <Row label="Legs of the plan flown">
                    {d.legsFlown} of {d.legsTotal}
                  </Row>
                </Section>

                <Section title="OFF THE PLANNED TRACK">
                  <Row label="Average distance">{U.dist(d.deviation.avgXtkNm)}</Row>
                  <Row label="Largest distance" tone={d.deviation.maxXtkNm > OFF_TRACK_NM ? 'warn' : undefined}>
                    {U.dist(d.deviation.maxXtkNm)}
                  </Row>
                  <Row label={`Time more than ${U.dist(OFF_TRACK_NM)} off`} tone={d.deviation.offTrackSec > 0 ? 'warn' : undefined}>
                    {clock(d.deviation.offTrackSec)}
                  </Row>
                </Section>
              </div>

              <Section title="LOW LEVEL AND RANGE LEGS (RADAR ALTITUDE CHECKED)">
                {d.checked.seconds === 0 ? (
                  <p className="py-1 text-ink-2">No low-level or range leg was flown, so the radar altitude was not checked.</p>
                ) : (
                  <>
                    <Row label="Time on checked legs">{clock(d.checked.seconds)}</Row>
                    <Row label="Below the planned height (low)" tone={d.checked.lowSec > 0 ? 'warn' : undefined}>
                      {clock(d.checked.lowSec)}
                    </Row>
                    <Row label="Far below it (too low)" tone={d.checked.criticalSec > 0 ? 'alert' : undefined}>
                      {clock(d.checked.criticalSec)}
                    </Row>
                    <Row label="Well above the planned altitude" tone={d.checked.highSec > 0 ? 'warn' : undefined}>
                      {clock(d.checked.highSec)}
                    </Row>
                    <Row label="Lowest radar altitude">{d.checked.minAglFt === null ? '--' : U.alt(d.checked.minAglFt)}</Row>
                  </>
                )}
              </Section>

              <section>
                <h3 className="cond text-[12px] font-bold tracking-wide border-b-2 border-ink pb-0.5 mb-1">TIME PER LEG</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono">
                    <thead>
                      <tr className="text-left text-ink-2 border-b border-rule-strong">
                        <th className="py-0.5 pr-2 font-semibold">Leg</th>
                        <th className="py-0.5 px-2 font-semibold text-right">Plan</th>
                        <th className="py-0.5 px-2 font-semibold text-right">Flown</th>
                        <th className="py-0.5 px-2 font-semibold text-right">Diff</th>
                        <th className="py-0.5 px-2 font-semibold text-right">Off track avg</th>
                        <th className="py-0.5 pl-2 font-semibold text-right">max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.legs.map((l) => {
                        const diff = l.seconds - l.plannedSeconds;
                        const slow = l.flown && Math.abs(diff) > 30 && Math.abs(diff) > l.plannedSeconds * 0.2;
                        return (
                          <tr key={l.index} className="border-b border-rule">
                            <td className="py-0.5 pr-2 truncate max-w-[16rem]" title={`${l.from} to ${l.to}`}>
                              {l.from} &rarr; {l.to}
                            </td>
                            <td className="py-0.5 px-2 text-right">{clock(l.plannedSeconds)}</td>
                            <td className="py-0.5 px-2 text-right">{l.flown ? clock(l.seconds) : '--'}</td>
                            <td className={`py-0.5 px-2 text-right ${slow ? 'text-accent font-bold' : ''}`}>{l.flown ? signedClock(diff) : '--'}</td>
                            <td className="py-0.5 px-2 text-right">{l.flown ? U.dist(l.avgXtkNm) : '--'}</td>
                            <td className={`py-0.5 pl-2 text-right ${l.flown && l.maxXtkNm > OFF_TRACK_NM ? 'text-accent font-bold' : ''}`}>
                              {l.flown ? U.dist(l.maxXtkNm) : '--'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-[11px] text-ink-3">
                  The altitude you flew is drawn over the plan on the altitude profile under the map, and the track on the map.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 p-2 border-t-2 border-ink">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              disabled={!d}
              onClick={() => exportTrack('gpx')}
              className="h-7 px-2 bg-panel text-ink border border-rule-strong font-mono text-[11px] font-semibold hover:bg-inset cursor-pointer disabled:opacity-50"
            >
              EXPORT GPX
            </button>
            <button
              type="button"
              disabled={!d}
              onClick={() => exportTrack('kml')}
              className="h-7 px-2 bg-panel text-ink border border-rule-strong font-mono text-[11px] font-semibold hover:bg-inset cursor-pointer disabled:opacity-50"
            >
              EXPORT KML
            </button>
            {saved && (
              <span className="font-mono text-[11px] text-ink-2 truncate" role="status">
                {saved}
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={flight.onCloseDebrief}
            className="h-7 px-3 bg-ink text-on-ink border border-rule-strong font-mono text-[11px] font-semibold cursor-pointer"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
