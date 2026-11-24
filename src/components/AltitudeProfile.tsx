import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GeneratedFlightPlan } from '../types/flightDesk';
import type { LiveFlightView } from '../hooks/useLiveFlight';
import { useUnits } from '../hooks/useUnits';
import { fetchTerrainProfile } from '../utils/terrainService';
import {
  isLabelledWaypoint,
  lowSections,
  nearestWaypointIndex,
  niceTicks,
  plannedAltAt,
  routeDistanceNm,
  terrainAt,
  type ProfilePoint,
} from '../utils/altitudeProfile';

interface AltitudeProfileProps {
  plan: GeneratedFlightPlan;
  /** Live link to the simulator (Electron app only): the aircraft is drawn on the profile. */
  live?: LiveFlightView | null;
  activeWpId?: string | null;
  onActiveWpChange?: (id: string | null) => void;
}

const STORAGE_KEY = 'mfd.profile.open';
const HEIGHT = 168;
const MARGIN = { left: 50, right: 12, top: 8, bottom: 30 };

type TerrainState = { key: string; status: 'loading' | 'ready' | 'unavailable'; points: ProfilePoint[] };

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Altitude profile under the map: the terrain, the planned altitude along the route and, with the live link, the aircraft. */
export const AltitudeProfile: React.FC<AltitudeProfileProps> = ({ plan, live, activeWpId, onActiveWpChange }) => {
  const U = useUnits();
  const [open, setOpen] = useState<boolean>(readOpen);
  const [terrain, setTerrain] = useState<TerrainState>({ key: '', status: 'loading', points: [] });
  const [width, setWidth] = useState(800);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const wps = plan.waypoints;
  const totalNm = wps.length > 0 ? wps[wps.length - 1].cumulativeDistNm : 0;

  const toggle = () =>
    setOpen((o) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, o ? '0' : '1');
      } catch {
        /* the choice is just not remembered */
      }
      return !o;
    });

  // Width of the chart follows its box
  useEffect(() => {
    const el = boxRef.current;
    if (!el || !open) return;
    setWidth(Math.max(320, el.clientWidth));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // The terrain is fetched again when a waypoint was moved (after a short pause); heights alone do not need new terrain
  const geometryKey = useMemo(() => wps.map((w) => `${w.lat.toFixed(4)},${w.lon.toFixed(4)}`).join('|'), [wps]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setTerrain((t) => (t.key === geometryKey ? t : { key: geometryKey, status: 'loading', points: t.points }));
      fetchTerrainProfile(plan)
        .then((points) => {
          if (cancelled) return;
          setTerrain(points ? { key: geometryKey, status: 'ready', points } : { key: geometryKey, status: 'unavailable', points: [] });
        })
        .catch(() => {
          if (!cancelled) setTerrain({ key: geometryKey, status: 'unavailable', points: [] });
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [geometryKey, open]);

  // While new terrain is being fetched after a move, the old terrain stays on the chart; it is not used for the checks
  const terrainPoints = terrain.points;
  const freshTerrain = useMemo(() => (terrain.key === geometryKey && terrain.status === 'ready' ? terrain.points : []), [terrain, geometryKey]);
  // The altitude flown stays on the chart after the link is switched off, for a look at the flight
  const trace = live ? live.profileTrace : [];
  const liveSample = live?.enabled && live.status.status === 'connected' ? live.sample : null;
  const liveDist = liveSample && live?.progress ? routeDistanceNm(plan, live.progress) : null;
  const low = useMemo(() => lowSections(plan, freshTerrain), [plan, freshTerrain]);

  // Height range (feet) and its ticks in the display unit
  const factor = U.altValue(1);
  const scale = useMemo(() => {
    const heights: number[] = [0];
    for (const w of wps) heights.push(w.altFt);
    for (const p of terrainPoints) heights.push(p.elevFt);
    for (const t of trace) heights.push(t.altFt);
    if (liveSample) heights.push(liveSample.altMslFt);
    const lowestFt = Math.min(...heights);
    const highestFt = Math.max(...heights) * 1.04;
    const { ticks, step } = niceTicks(U.altValue(lowestFt), U.altValue(highestFt), 4);
    let top = ticks.length ? ticks[ticks.length - 1] : U.altValue(highestFt);
    if (top < U.altValue(highestFt)) top += step;
    const bottomFt = Math.min(0, Math.floor(lowestFt / 500) * 500);
    const topFt = top / factor;
    return { ticks, bottomFt, topFt: Math.max(topFt, bottomFt + 1) };
  }, [wps, terrainPoints, trace, liveSample, U, factor]);

  const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (nm: number) => MARGIN.left + (totalNm > 0 ? (nm / totalNm) * innerW : 0);
  const y = (ft: number) => MARGIN.top + innerH - ((ft - scale.bottomFt) / (scale.topFt - scale.bottomFt)) * innerH;
  const bottomY = y(scale.bottomFt);

  const terrainLine = terrainPoints.map((p) => `${x(p.distNm).toFixed(1)},${y(p.elevFt).toFixed(1)}`).join(' ');
  const terrainArea = terrainPoints.length
    ? `M${x(terrainPoints[0].distNm).toFixed(1)},${bottomY.toFixed(1)} L${terrainLine.replace(/ /g, ' L')} L${x(terrainPoints[terrainPoints.length - 1].distNm).toFixed(1)},${bottomY.toFixed(1)} Z`
    : '';
  const planLine = wps.map((w) => `${x(w.cumulativeDistNm).toFixed(1)},${y(w.altFt).toFixed(1)}`).join(' ');

  // Distance ticks in the display unit
  const distFactor = U.distValue(1);
  const distTicks = niceTicks(0, U.distValue(totalNm), Math.max(2, Math.round(innerW / 110))).ticks;

  // Name labels under the chart, not closer than 64 px to each other
  const labels: Array<{ id: string; name: string; px: number }> = [];
  wps.forEach((w, i) => {
    if (!isLabelledWaypoint(w, i, wps.length)) return;
    const px = x(w.cumulativeDistNm);
    const prev = labels[labels.length - 1];
    if (prev && px - prev.px < 64) return;
    labels.push({ id: w.id, name: w.name, px });
  });

  const hoverNm = hoverX !== null && totalNm > 0 ? Math.max(0, Math.min(totalNm, ((hoverX - MARGIN.left) / innerW) * totalNm)) : null;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    setHoverX(px >= MARGIN.left && px <= MARGIN.left + innerW ? px : null);
    if (onActiveWpChange && totalNm > 0) {
      const nm = ((px - MARGIN.left) / innerW) * totalNm;
      const idx = nearestWaypointIndex(plan, nm);
      onActiveWpChange(Math.abs(x(wps[idx].cumulativeDistNm) - px) <= 8 ? wps[idx].id : null);
    }
  };
  const onLeave = () => {
    setHoverX(null);
    onActiveWpChange?.(null);
  };

  // What the header says: the reading under the pointer, else the aircraft, else the state of the terrain data
  let readout: string;
  if (hoverNm !== null) {
    const planned = plannedAltAt(plan, hoverNm);
    const ground = terrainAt(freshTerrain, hoverNm);
    readout =
      `${U.dist(hoverNm)} \u00b7 PLAN ${U.alt(planned)}` +
      (ground !== null ? ` \u00b7 TERRAIN ${U.alt(ground)} \u00b7 CLEARANCE ${U.alt(Math.round(planned - ground))}` : '');
  } else if (liveSample && liveDist !== null) {
    readout = `AIRCRAFT ${U.dist(liveDist)} \u00b7 ALT ${U.alt(liveSample.altMslFt)} \u00b7 RADAR ${U.alt(liveSample.aglFt)}`;
  } else if (terrain.status === 'loading' && terrainPoints.length === 0) {
    readout = 'Fetching the terrain...';
  } else if (terrain.status === 'unavailable') {
    readout = 'Terrain data unavailable: planned altitudes only';
  } else {
    readout = low.length > 0 ? `PLAN BELOW ${U.alt(500)} OVER TERRAIN: ${low.length} SECTION${low.length > 1 ? 'S' : ''}` : '';
  }

  const activeIdx = activeWpId ? wps.findIndex((w) => w.id === activeWpId) : -1;

  return (
    <div className="sheet" data-testid="altitude-profile">
      <div className="flex items-center justify-between gap-2 px-2 h-8 border-b border-rule">
        <span className="cond text-[11px] font-bold tracking-wide whitespace-nowrap">ALTITUDE PROFILE</span>
        <span className="font-mono text-[11px] text-ink-2 truncate min-w-0" role="status" aria-live="off">
          {open ? readout : ''}
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="h-6 px-1.5 bg-panel text-ink border border-rule-strong font-mono text-[11px] font-semibold hover:bg-inset cursor-pointer whitespace-nowrap"
          title={open ? 'Hide the altitude profile' : 'Show the altitude profile'}
        >
          {open ? 'HIDE' : 'SHOW'}
        </button>
      </div>

      {open && (
        <div ref={boxRef} className="w-full">
          <svg
            width={width}
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label={`Altitude profile of the route, ${U.dist(totalNm)} long, with the terrain and the planned altitude`}
            onPointerMove={onMove}
            onPointerLeave={onLeave}
            style={{ display: 'block', touchAction: 'none' }}
          >
            {/* Height grid and labels */}
            {scale.ticks.map((t) => {
              const ft = t / factor;
              if (ft < scale.bottomFt || ft > scale.topFt) return null;
              return (
                <g key={`h${t}`}>
                  <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={y(ft)} y2={y(ft)} style={{ stroke: 'var(--rule)' }} strokeWidth={1} />
                  <text x={MARGIN.left - 5} y={y(ft) + 3} textAnchor="end" fontSize={10} fontFamily="var(--font-mono, monospace)" style={{ fill: 'var(--ink-3)' }}>
                    {(Math.round(t) || 0).toLocaleString()}
                  </text>
                </g>
              );
            })}
            <text x={4} y={MARGIN.top + 8} fontSize={10} fontFamily="var(--font-mono, monospace)" style={{ fill: 'var(--ink-3)' }}>
              {U.labels.alt}
            </text>

            {/* Parts of the low-level route planned close to the terrain */}
            {low.map((s, i) => (
              <rect
                key={`l${i}`}
                x={x(s.fromNm) - 2}
                y={MARGIN.top}
                width={Math.max(4, x(s.toNm) - x(s.fromNm) + 4)}
                height={innerH}
                style={{ fill: 'var(--alert)', opacity: 0.18 }}
              >
                <title>{`Planned altitude only ${U.alt(Math.max(0, Math.round(s.minAglFt)))} above the terrain`}</title>
              </rect>
            ))}

            {/* Terrain */}
            {terrainArea && <path d={terrainArea} style={{ fill: 'var(--ink-3)', opacity: 0.3 }} />}
            {terrainLine && <polyline points={terrainLine} fill="none" style={{ stroke: 'var(--ink-2)' }} strokeWidth={1.2} />}

            {/* Planned altitude */}
            <polyline points={planLine} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth={2} strokeLinejoin="round" />
            {wps.map((w, i) => (
              <circle
                key={w.id}
                cx={x(w.cumulativeDistNm)}
                cy={y(w.altFt)}
                r={i === activeIdx ? 4.5 : 2}
                style={{ fill: i === activeIdx ? 'var(--accent)' : 'var(--panel)', stroke: 'var(--accent)' }}
                strokeWidth={1.2}
              />
            ))}

            {/* The waypoint under the pointer on the map or in the log */}
            {activeIdx >= 0 && (
              <line
                x1={x(wps[activeIdx].cumulativeDistNm)}
                x2={x(wps[activeIdx].cumulativeDistNm)}
                y1={MARGIN.top}
                y2={bottomY}
                style={{ stroke: 'var(--accent)' }}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            )}

            {/* Altitude flown and the aircraft */}
            {trace.length > 1 && (
              <polyline
                points={trace.map((t) => `${x(t.distNm).toFixed(1)},${y(t.altFt).toFixed(1)}`).join(' ')}
                fill="none"
                style={{ stroke: 'var(--ink)' }}
                strokeWidth={1.6}
                strokeDasharray="1 3"
                strokeLinecap="round"
              />
            )}
            {liveSample && liveDist !== null && (
              <g>
                <line x1={x(liveDist)} x2={x(liveDist)} y1={MARGIN.top} y2={bottomY} style={{ stroke: 'var(--ink)' }} strokeWidth={1} opacity={0.5} />
                <polygon
                  points={`${x(liveDist) - 6},${y(liveSample.altMslFt) + 6} ${x(liveDist)},${y(liveSample.altMslFt) - 7} ${x(liveDist) + 6},${y(liveSample.altMslFt) + 6}`}
                  style={{ fill: 'var(--ink)', stroke: 'var(--panel)' }}
                  strokeWidth={1.5}
                />
              </g>
            )}

            {/* Pointer */}
            {hoverX !== null && (
              <line x1={hoverX} x2={hoverX} y1={MARGIN.top} y2={bottomY} style={{ stroke: 'var(--ink)' }} strokeWidth={1} opacity={0.4} />
            )}

            {/* Distance axis */}
            <line x1={MARGIN.left} x2={MARGIN.left + innerW} y1={bottomY} y2={bottomY} style={{ stroke: 'var(--rule-strong)' }} strokeWidth={1} />
            {distTicks.map((t) => (
              <g key={`d${t}`}>
                <line x1={x(t / distFactor)} x2={x(t / distFactor)} y1={bottomY} y2={bottomY + 3} style={{ stroke: 'var(--rule-strong)' }} />
                <text x={x(t / distFactor)} y={bottomY + 12} textAnchor="middle" fontSize={10} fontFamily="var(--font-mono, monospace)" style={{ fill: 'var(--ink-3)' }}>
                  {(Math.round(t) || 0).toLocaleString()}
                </text>
              </g>
            ))}
            <text x={4} y={bottomY + 12} textAnchor="start" fontSize={10} fontFamily="var(--font-mono, monospace)" style={{ fill: 'var(--ink-3)' }}>
              {U.labels.dist}
            </text>

            {/* Names of the main fixes */}
            {labels.map((l, i) => (
              <text
                key={l.id}
                x={l.px}
                y={HEIGHT - 3}
                textAnchor={i === 0 ? 'start' : l.px > width - 60 ? 'end' : 'middle'}
                fontSize={9}
                fontFamily="var(--font-mono, monospace)"
                style={{ fill: 'var(--ink-2)' }}
              >
                {l.name.length > 12 ? `${l.name.slice(0, 11)}.` : l.name}
              </text>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
};
