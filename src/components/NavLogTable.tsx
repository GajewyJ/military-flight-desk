import React from 'react';
import { FlightWaypoint, GeneratedFlightPlan } from '../types/flightDesk';
import { Tape, cx } from './ui';
import { useUnits } from '../hooks/useUnits';

interface NavLogTableProps {
  plan: GeneratedFlightPlan;
  /** Waypoint highlighted here and on the map. */
  activeWpId?: string | null;
  onActiveWpChange?: (id: string | null) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Short type code of a fix, as on a paper navigation log. */
function typeCode(wp: FlightWaypoint, idx: number, last: number): string {
  const n = wp.name.toUpperCase();
  if (idx === 0) return 'DEP';
  if (idx === last) return 'ARR';
  if (wp.type === 'RANGE' || wp.type === 'DROP') {
    if (n.startsWith('TARGET')) return 'TGT';
    if (/^DZ \d/.test(n)) return 'DZ';
    if (n.startsWith('CARP')) return 'CARP';
    if (n.startsWith('ROLL-IN')) return 'ROLL';
    if (n.startsWith('RUN-IN')) return 'RUN';
    if (n.startsWith('PULL-OFF')) return 'PULL';
    return 'PAT';
  }
  if (wp.type === 'IP') return 'IP';
  if (n.includes('TOUCH & GO')) return 'T&G';
  if (n.startsWith('IAF')) return 'IAF';
  if (n.includes('INITIAL')) return 'INIT';
  if (n.includes('FINAL')) return 'FINAL';
  switch (wp.type) {
    case 'CHECKPOINT':
      return 'CP';
    case 'MTR_ENTRY':
      return 'ENTRY';
    case 'EGRESS':
      return 'EGRS';
    case 'RECOVERY':
      return 'RCV';
    default:
      return wp.type;
  }
}

/** The navigation log: always visible, with row hover tied to the map. */
export const NavLogTable: React.FC<NavLogTableProps> = ({ plan, activeWpId, onActiveWpChange }) => {
  const U = useUnits();
  const last = plan.waypoints.length - 1;
  const head = 'cond px-2 py-1 text-[10px] font-normal text-ink-3 bg-panel border-b-2 border-ink';

  return (
    <section className="border-t border-ink">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-rule">
        <Tape>Navigation log</Tape>
        <span className="font-mono text-[10px] text-ink-3">
          {plan.waypoints.length} waypoints · {U.dist(plan.totalDistanceNm, 0)} · {plan.totalFlightTimeMin} min
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse font-mono text-[11px] [&_td]:border-l [&_td]:border-rule [&_td:first-child]:border-l-0">
          <thead>
            <tr>
              <th className={cx(head, 'w-8 text-center')}>#</th>
              <th className={cx(head, 'min-w-[150px]')}>Fix</th>
              <th className={cx(head, 'w-12')}>Type</th>
              <th className={cx(head, 'text-right')}>HDG°M</th>
              <th className={cx(head, 'text-right')}>Leg {U.labels.dist}</th>
              <th className={head}>Altitude</th>
              <th className={cx(head, 'text-right')}>{U.units.speed === 'kmh' ? 'km/h' : 'KIAS'}</th>
              <th className={cx(head, 'text-right')}>Leg</th>
              <th className={cx(head, 'text-right')}>Elapsed</th>
            </tr>
          </thead>
          <tbody>
            {plan.waypoints.map((wp, idx) => {
              const active = wp.id === activeWpId;
              const code = typeCode(wp, idx, last);
              const key = idx === 0 || idx === last || code === 'IP' || code === 'TGT' || code === 'DZ' || code === 'T&G';
              return (
                <tr
                  key={wp.id}
                  onMouseEnter={() => onActiveWpChange?.(wp.id)}
                  onMouseLeave={() => onActiveWpChange?.(null)}
                  className={cx(
                    'border-b border-rule',
                    active ? 'bg-hilite' : 'hover:bg-inset/70',
                    key && 'font-semibold'
                  )}
                >
                  <td className={cx('px-2 py-0.5 text-center text-ink-3', active && 'shadow-[inset_3px_0_var(--accent)]')}>{idx + 1}</td>
                  <td className="px-2 py-0.5 whitespace-nowrap">{wp.name}</td>
                  <td className={cx('px-2 py-0.5', code === 'TGT' || code === 'DZ' || code === 'CARP' ? 'text-alert' : code === 'IP' ? 'text-accent' : 'text-ink-2')}>
                    {code}
                  </td>
                  <td className="px-2 py-0.5 text-right">
                    {idx === 0 ? '—' : `${String(Math.round(wp.bearingMagDeg) % 360).padStart(3, '0')}°`}
                  </td>
                  <td className="px-2 py-0.5 text-right">{idx === 0 ? '—' : U.distValue(wp.legDistNm).toFixed(1)}</td>
                  <td className="px-2 py-0.5 whitespace-nowrap">{U.text(wp.altDisplay)}</td>
                  <td className="px-2 py-0.5 text-right">{U.speedValue(wp.speedKts)}</td>
                  <td className="px-2 py-0.5 text-right text-ink-2">{idx === 0 ? '—' : formatDuration(wp.legEteSeconds)}</td>
                  <td className="px-2 py-0.5 text-right font-semibold">{formatDuration(wp.cumulativeTimeSeconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="px-2 py-1 font-mono text-[10px] text-ink-3 border-t border-rule">
        Magnetic variation {plan.operatingAirbase.magDecl || '0°'}. Headings are magnetic.
      </p>
    </section>
  );
};
