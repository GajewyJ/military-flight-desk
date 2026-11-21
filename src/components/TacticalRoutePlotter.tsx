import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeneratedFlightPlan, FlightWaypoint, Airport, AirportWeather } from '../types/flightDesk';
import { destinationPoint } from '../utils/geo';
import { isDraggableWaypoint } from '../utils/routeEdit';
import { ROUTE_SHAPE_LABELS } from '../utils/routeShapes';
import { DataRow, Tape, cx } from './ui';
import { useUnits } from '../hooks/useUnits';

interface TacticalRoutePlotterProps {
  plan: GeneratedFlightPlan;
  /** Re-draws the route in the colours of the theme when it changes. */
  theme?: string;
  /** Waypoint shown highlighted (hovered in the nav log or on the map). */
  activeWpId?: string | null;
  onActiveWpChange?: (id: string | null) => void;
  /** Fills the height of its parent instead of using a fixed height. */
  fill?: boolean;
  /**
   * A waypoint was dropped at a new position. Returns false if the move was refused
   * (the waypoint then jumps back).
   */
  onWaypointMove?: (id: string, lat: number, lon: number) => boolean;
  /** Back to the route as it was generated. */
  onResetRoute?: () => void;
  /** Short message over the map (for example why a move was refused). */
  notice?: string | null;
  /** The altitudes are being recalculated after a move. */
  busy?: boolean;
}

type MapLayerType = 'chart' | 'satellite' | 'topo';

interface TileLayerConfig {
  name: string;
  urls: string[];
  attribution: string;
  maxZoom: number;
  subdomains?: string[];
  /** Paper / amber tint of the tiles (see index.css). */
  tint?: boolean;
}

const TILE_LAYERS: Record<MapLayerType, TileLayerConfig> = {
  chart: {
    name: 'Chart',
    urls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors',
    maxZoom: 17,
    tint: true,
  },
  satellite: {
    name: 'Satellite',
    urls: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and GIS User Community',
    maxZoom: 18,
  },
  topo: {
    name: 'Topo',
    urls: ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
    subdomains: ['a', 'b', 'c'],
  },
};

/** Value of a theme colour (a CSS variable of the page), so map layers follow the day / night theme. */
function themeColor(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type MarkerKind = 'base' | 'ip' | 'target' | 'carp' | 'touch' | 'fix' | 'minor';

const MINOR_NAME =
  /^(TURN|BASE TURN|APPROACH ARC|DOWNWIND|RE-ENTRY|PULL-OFF|ROLL-IN|RUN-IN|PERCH|BASE \d|RTB \d|DZ EXIT|TNG (CLIMB|DEPARTURE|DOWNWIND|BASE|PERCH|TURN|SHORT)|.* TOUCHDOWN$|RWY \d+\w* (LIFTOFF|CLIMB)|CROSSWIND|DEPARTURE ROLLOUT|RECOVERY|OVERHEAD|BREAK|SHORT FINAL|BASE RWY|DOWNWIND RWY)/;

function markerKind(wp: FlightWaypoint, idx: number, last: number): MarkerKind {
  if (idx === 0 || idx === last) return 'base';
  if (wp.type === 'IP') return 'ip';
  if (wp.type === 'RANGE' || wp.type === 'DROP') {
    if (/^(TARGET|DZ \d)/.test(wp.name)) return 'target';
    if (wp.name.startsWith('CARP')) return 'carp';
    return MINOR_NAME.test(wp.name) ? 'minor' : 'fix';
  }
  if (wp.type === 'TNG' && wp.name.includes('TOUCH & GO')) return 'touch';
  return MINOR_NAME.test(wp.name) ? 'minor' : 'fix';
}

/** Chart-style symbols: aerodrome circle with cross, IP triangle, target ring, fix ring. */
function symbolSvg(kind: MarkerKind): string {
  const open = '<svg class="mfd-sym" width="22" height="22" viewBox="0 0 22 22" style="overflow:visible">';
  switch (kind) {
    case 'base':
      return `${open}<circle cx="11" cy="11" r="7" style="fill:var(--panel);stroke:var(--ink);stroke-width:2"/><path d="M11 1v20M1 11h20" style="stroke:var(--ink);stroke-width:1.6"/></svg>`;
    case 'ip':
      return `${open}<polygon points="11,3 20,19 2,19" style="fill:var(--panel);stroke:var(--accent);stroke-width:2.2"/></svg>`;
    case 'target':
      return `${open}<circle cx="11" cy="11" r="8" style="fill:var(--panel);stroke:var(--alert);stroke-width:2"/><circle cx="11" cy="11" r="2.5" style="fill:var(--alert)"/><path d="M11 0v5M11 17v5M0 11h5M17 11h5" style="stroke:var(--alert);stroke-width:1.6"/></svg>`;
    case 'carp':
      return `${open}<polygon points="11,4 18,11 11,18 4,11" style="fill:var(--panel);stroke:var(--alert);stroke-width:2"/></svg>`;
    case 'touch':
      return `${open}<rect x="5" y="5" width="12" height="12" style="fill:var(--ok);stroke:var(--ink);stroke-width:1.6"/></svg>`;
    case 'fix':
      return `${open}<circle cx="11" cy="11" r="4.5" style="fill:var(--panel);stroke:var(--accent);stroke-width:2"/></svg>`;
    default:
      return `${open}<circle cx="11" cy="11" r="2.6" style="fill:var(--accent)"/></svg>`;
  }
}

/** Runway footprint with the active centerline and the extended approach / departure lines. */
function drawRunwayOverlay(group: L.LayerGroup, airport: Airport, weather: AirportWeather | undefined, ink: string, paper: string) {
  if (!weather) return;
  const trueHdg =
    weather.activeRunwayTrueHeadingDeg !== undefined ? weather.activeRunwayTrueHeadingDeg : weather.activeRunwayHeadingDeg;
  const rwyLengthFt = airport.longestRunwayFt || 8000;
  const halfLenNm = Math.min(1.2, Math.max(0.5, rwyLengthFt / 6076.1 / 2));

  const pThresh = destinationPoint(airport.latitude, airport.longitude, halfLenNm, (trueHdg + 180) % 360);
  const pDer = destinationPoint(airport.latitude, airport.longitude, halfLenNm, trueHdg);
  const strip: L.LatLngExpression[] = [
    [pThresh.lat, pThresh.lon],
    [pDer.lat, pDer.lon],
  ];

  L.polyline(strip, { color: ink, weight: 7, opacity: 1, lineCap: 'butt' }).addTo(group);
  L.polyline(strip, { color: paper, weight: 1.5, dashArray: '4, 4', opacity: 1 }).addTo(group);

  const pExtApp = destinationPoint(airport.latitude, airport.longitude, halfLenNm + 2.5, (trueHdg + 180) % 360);
  const pExtDep = destinationPoint(airport.latitude, airport.longitude, halfLenNm + 2.5, trueHdg);
  const dashed = { color: ink, weight: 1, dashArray: '2, 5', opacity: 0.7 };
  L.polyline([[pExtApp.lat, pExtApp.lon], [pThresh.lat, pThresh.lon]], dashed).addTo(group);
  L.polyline([[pDer.lat, pDer.lon], [pExtDep.lat, pExtDep.lon]], dashed).addTo(group);
}

export const TacticalRoutePlotter: React.FC<TacticalRoutePlotterProps> = ({
  plan,
  theme,
  activeWpId,
  onActiveWpChange,
  fill = false,
  onWaypointMove,
  onResetRoute,
  notice,
  busy = false,
}) => {
  const U = useUnits();
  const distUnits = U.units.distance;
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const lastLayerSwitchRef = useRef(0);
  const onActiveRef = useRef(onActiveWpChange);
  onActiveRef.current = onActiveWpChange;
  const onMoveRef = useRef(onWaypointMove);
  onMoveRef.current = onWaypointMove;
  const casingRef = useRef<L.Polyline | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  // The map is fitted to the route only for a newly generated route, not after a waypoint was moved
  const fittedKeyRef = useRef<string>('');

  const [activeLayer, setActiveLayer] = useState<MapLayerType>('chart');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const waypoints = plan.waypoints;
  const selectedWaypoint: FlightWaypoint | null = waypoints.find((w) => w.id === selectedId) ?? null;
  const planKey = `${plan.sortieId}|${plan.callsign}|${plan.generatedAt}`;

  const addTiles = (group: L.LayerGroup, layer: MapLayerType) => {
    const config = TILE_LAYERS[layer];
    config.urls.forEach((url) => {
      L.tileLayer(url, {
        attribution: config.attribution,
        maxZoom: config.maxZoom,
        subdomains: config.subdomains || 'abc',
        updateWhenIdle: true, // load tiles when the map stops moving, not during a drag
        keepBuffer: 1,
      }).addTo(group);
    });
  };

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true,
      minZoom: 3,
      maxZoom: 18,
    });

    const tileGroup = L.layerGroup().addTo(map);
    tileGroupRef.current = tileGroup;
    addTiles(tileGroup, 'chart');

    routeLayerGroupRef.current = L.layerGroup().addTo(map);
    L.control.scale({ position: 'bottomright', maxWidth: 140 }).addTo(map);
    mapInstanceRef.current = map;

    // Keep the map correct when the layout around it changes size
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(mapContainerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Switch tile layer
  useEffect(() => {
    if (!mapInstanceRef.current || !tileGroupRef.current) return;
    tileGroupRef.current.clearLayers();
    addTiles(tileGroupRef.current, activeLayer);
  }, [activeLayer]);

  // Draw the route and its markers whenever the plan or theme changes
  useEffect(() => {
    if (!mapInstanceRef.current || !routeLayerGroupRef.current) return;
    const map = mapInstanceRef.current;
    const group = routeLayerGroupRef.current;
    group.clearLayers();
    markersRef.current.clear();
    if (!waypoints || waypoints.length === 0) return;

    const ink = themeColor('--ink', '#1d1f1a');
    const paper = themeColor('--panel', '#e9e1c8');
    const accent = themeColor('--accent', '#d4400a');
    const alert = themeColor('--alert', '#a3201a');

    drawRunwayOverlay(group, plan.operatingAirbase, plan.departureWeather, ink, paper);
    if (plan.tngAirbase && plan.tngAirbase.ident !== plan.operatingAirbase.ident) {
      drawRunwayOverlay(group, plan.tngAirbase, plan.tngWeather, ink, paper);
    }

    // Training ground outline for range and drop sorties
    if (plan.trainingGround) {
      L.circle([plan.trainingGround.lat, plan.trainingGround.lon], {
        radius: plan.trainingGround.radiusNm * 1852,
        color: alert,
        weight: 1.5,
        opacity: 0.9,
        dashArray: '6, 4',
        fillColor: alert,
        fillOpacity: 0.06,
      })
        .bindTooltip(plan.trainingGround.name, { sticky: true })
        .addTo(group);
    }

    const latLngs: [number, number][] = waypoints.map((w) => [w.lat, w.lon]);

    // Route: a paper-coloured casing under a plain magenta line, like a plotted course
    const casing = L.polyline(latLngs, { color: paper, weight: 6, opacity: 0.85, lineCap: 'round', lineJoin: 'round' }).addTo(group);
    const line = L.polyline(latLngs, { color: accent, weight: 3, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(group);
    casingRef.current = casing;
    lineRef.current = line;
    const livePoints: [number, number][] = latLngs.map((p) => [p[0], p[1]]);

    // Bearing and distance on the long legs
    waypoints.forEach((wp, idx) => {
      if (idx === 0 || wp.legDistNm < 4) return;
      const prev = waypoints[idx - 1];
      const mid: [number, number] = [(prev.lat + wp.lat) / 2, (prev.lon + wp.lon) / 2];
      L.marker(mid, {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'mfd-leg-icon',
          html: `<span class="mfd-leg-label">${String(Math.round(wp.bearingMagDeg) % 360).padStart(3, '0')}° ${U.distValue(wp.legDistNm).toFixed(0)}</span>`,
          iconSize: [0, 0],
        }),
      }).addTo(group);
    });

    // Waypoint markers
    const last = waypoints.length - 1;
    waypoints.forEach((wp, idx) => {
      const kind = markerKind(wp, idx, last);
      const labelled = kind !== 'minor';
      const html = `<div class="mfd-wp">${symbolSvg(kind)}${labelled ? `<span class="mfd-wp-label">${escapeHtml(wp.name)}</span>` : ''}</div>`;
      const draggable = isDraggableWaypoint(plan, idx);
      const marker = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({
          html,
          className: draggable ? 'mfd-wp-icon mfd-wp-drag' : 'mfd-wp-icon',
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        zIndexOffset: kind === 'minor' ? 0 : 100,
        draggable,
        autoPan: draggable,
      });
      marker.bindTooltip(escapeHtml(draggable ? `${wp.name} (drag to move)` : wp.name), { direction: 'top', offset: [0, -8] });
      marker.on('click', () => setSelectedId(wp.id));
      if (draggable) {
        // The route line follows the marker while it is dragged; the plan is recalculated when it is dropped
        marker.on('drag', () => {
          const ll = marker.getLatLng();
          livePoints[idx] = [ll.lat, ll.lng];
          casing.setLatLngs(livePoints);
          line.setLatLngs(livePoints);
        });
        marker.on('dragend', () => {
          const ll = marker.getLatLng();
          const accepted = onMoveRef.current?.(wp.id, ll.lat, ll.lng) ?? false;
          if (!accepted) {
            marker.setLatLng([wp.lat, wp.lon]);
            livePoints[idx] = [wp.lat, wp.lon];
            casing.setLatLngs(livePoints);
            line.setLatLngs(livePoints);
          }
        });
      }
      marker.on('mouseover', () => onActiveRef.current?.(wp.id));
      marker.on('mouseout', () => onActiveRef.current?.(null));
      marker.addTo(group);
      markersRef.current.set(wp.id, marker);
    });

    if (fittedKeyRef.current !== planKey) {
      fittedKeyRef.current = planKey;
      map.fitBounds(L.latLngBounds(latLngs), { padding: [45, 45], maxZoom: 12 });
    }
  }, [plan, theme, distUnits]);

  // Highlight the waypoint that is hovered in the nav log (or on the map)
  useEffect(() => {
    markersRef.current.forEach((marker, id) => {
      const el = marker.getElement();
      if (!el) return;
      if (id === activeWpId) {
        L.DomUtil.addClass(el, 'mfd-wp-active');
        marker.setZIndexOffset(1000);
      } else {
        L.DomUtil.removeClass(el, 'mfd-wp-active');
        marker.setZIndexOffset(0);
      }
    });
  }, [activeWpId, plan, theme]);

  const fitRoute = () => {
    if (!mapInstanceRef.current || waypoints.length === 0) return;
    mapInstanceRef.current.fitBounds(L.latLngBounds(waypoints.map((w) => [w.lat, w.lon] as [number, number])), {
      padding: [45, 45],
      maxZoom: 12,
    });
  };
  const centerOn = (airport?: Airport) => {
    if (!mapInstanceRef.current || !airport) return;
    mapInstanceRef.current.setView([airport.latitude, airport.longitude], 10, { animate: true });
  };

  const title =
    plan.missionProfile === 'lltr_tng'
      ? `${plan.operatingAirbase.ident} to ${plan.tngAirbase?.ident ?? 'T&G'} and back`
      : plan.missionProfile === 'range_strafe'
        ? `${plan.operatingAirbase.ident} to ${plan.trainingGround?.name ?? 'range'}`
        : plan.missionProfile === 'cargo_drop'
          ? `${plan.operatingAirbase.ident} to ${plan.trainingGround?.name ?? 'drop zone'}`
          : `${plan.operatingAirbase.ident} low-level route`;

  const tool =
    'h-7 min-w-7 px-1.5 bg-panel text-ink border border-rule-strong font-mono text-[11px] font-semibold hover:bg-inset cursor-pointer';

  return (
    <div
      className={cx(
        'sheet flex flex-col',
        isFullscreen ? 'fixed inset-2 z-50' : fill ? 'h-full' : 'relative w-full'
      )}
    >
      {/* Map toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 border-b-2 border-ink">
        <div className="flex items-center gap-2 min-w-0">
          <Tape>Route map</Tape>
          <span className="font-mono text-[12px] font-bold truncate">{title}</span>
          {plan.routeShape && (
            <span className="cond hidden sm:inline text-[11px] text-ink-3 whitespace-nowrap">{ROUTE_SHAPE_LABELS[plan.routeShape]}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {plan.routeEdited && (
            <>
              <span className="cond text-[11px] font-bold text-accent px-1" title="A waypoint was moved by hand">
                EDITED
              </span>
              {onResetRoute && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    onResetRoute();
                  }}
                  className={tool}
                  title="Go back to the route as it was generated"
                >
                  RESET ROUTE
                </button>
              )}
            </>
          )}
          <div role="radiogroup" aria-label="Map layer" className="flex border border-rule-strong">
            {(Object.keys(TILE_LAYERS) as MapLayerType[]).map((layer, i) => (
              <button
                key={layer}
                type="button"
                role="radio"
                aria-checked={activeLayer === layer}
                onClick={() => {
                  // Every switch downloads a new set of map tiles: ignore clicks that come too fast
                  const now = Date.now();
                  if (layer === activeLayer || now - lastLayerSwitchRef.current < 800) return;
                  lastLayerSwitchRef.current = now;
                  setActiveLayer(layer);
                }}
                className={cx(
                  'cond px-2 h-7 text-[11px] cursor-pointer',
                  i > 0 && 'border-l border-rule-strong',
                  activeLayer === layer ? 'bg-ink text-on-ink' : 'bg-panel text-ink hover:bg-inset'
                )}
              >
                {TILE_LAYERS[layer].name}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={tool}
            title={isFullscreen ? 'Leave the full-window map' : 'Show the map over the whole window'}
          >
            {isFullscreen ? 'CLOSE' : 'FULL'}
          </button>
        </div>
      </div>

      {/* Map */}
      <div className={cx('relative flex-1 min-h-0 select-none', !fill && !isFullscreen && 'h-[420px]')}>
        {/* The class that changes with the layer sits on this wrapper: React must never touch the element
            Leaflet owns, or it wipes the classes Leaflet adds to it and the map disappears. The wrapper is
            its own stacking layer (relative z-0), so Leaflet's high z-index panes stay under the buttons. */}
        <div className={cx('mfd-map relative z-0 w-full h-full', TILE_LAYERS[activeLayer].tint && 'mfd-map-tint')}>
          <div ref={mapContainerRef} className="w-full h-full" />
        </div>

        {/* North arrow */}
        <div className="absolute top-2 right-2 z-20 pointer-events-none" aria-hidden="true">
          <svg width="38" height="46" viewBox="0 0 38 46">
            <circle cx="19" cy="27" r="16" style={{ fill: 'var(--panel)', stroke: 'var(--ink)', strokeWidth: 1.4 }} />
            <path d="M19 13L24 33 19 29 14 33Z" style={{ fill: 'var(--ink)' }} />
            <text x="19" y="9" textAnchor="middle" style={{ fill: 'var(--ink)', font: '700 10px var(--font-mono)' }}>
              N
            </text>
          </svg>
        </div>

        {/* Message over the map */}
        {(notice || busy) && (
          <div className="sheet absolute top-2 left-1/2 -translate-x-1/2 z-20 px-2 py-1 font-mono text-[11px] max-w-[70%] text-center" role="status">
            {notice ?? 'Updating the altitudes for the new route...'}
          </div>
        )}

        {/* Tools */}
        <div className="absolute top-2 left-2 z-20 flex flex-col gap-1">
          <button type="button" onClick={() => mapInstanceRef.current?.zoomIn()} className={tool} title="Zoom in" aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => mapInstanceRef.current?.zoomOut()} className={tool} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={fitRoute} className={tool} title="Show the whole route">
            FIT
          </button>
          <button type="button" onClick={() => centerOn(plan.operatingAirbase)} className={tool} title="Centre on the home airfield">
            {plan.operatingAirbase.ident}
          </button>
          {plan.tngAirbase && (
            <button type="button" onClick={() => centerOn(plan.tngAirbase)} className={tool} title="Centre on the Touch & Go airfield">
              {plan.tngAirbase.ident}
            </button>
          )}
        </div>

        {/* Selected waypoint */}
        {selectedWaypoint && (
          <div className="sheet absolute bottom-6 left-2 z-20 w-72 max-w-[calc(100%-1rem)] p-2 max-h-[60%] overflow-y-auto">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="font-mono text-[12px] font-bold truncate">{selectedWaypoint.name}</span>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="px-1 text-ink-3 hover:text-ink cursor-pointer"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <DataRow label="Altitude">{U.text(selectedWaypoint.altDisplay)}</DataRow>
            <DataRow label="Speed">
              {U.speedValue(selectedWaypoint.speedKts)} {U.units.speed === 'kmh' ? 'km/h' : 'KIAS'} (M{selectedWaypoint.mach})
            </DataRow>
            <DataRow label="Heading">{String(Math.round(selectedWaypoint.bearingMagDeg) % 360).padStart(3, '0')}°M</DataRow>
            <DataRow label="Leg">{U.dist(selectedWaypoint.legDistNm)}</DataRow>
            <DataRow label="Total">{U.dist(selectedWaypoint.cumulativeDistNm)}</DataRow>
            <DataRow label="Position">
              {selectedWaypoint.lat.toFixed(3)}°, {selectedWaypoint.lon.toFixed(3)}°
            </DataRow>
            <p className="mt-1.5 text-[11px] leading-snug text-ink-2">{U.text(selectedWaypoint.remarks)}</p>
          </div>
        )}
      </div>
    </div>
  );
};
