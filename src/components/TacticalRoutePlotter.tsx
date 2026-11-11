import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { GeneratedFlightPlan, FlightWaypoint, Airport, AirportWeather } from '../types/flightDesk';
import { destinationPoint } from '../utils/geo';
import {
  Crosshair,
  Layers,
  Maximize2,
  Minimize2,
  Navigation,
  Compass,
  MapPin,
  Eye,
} from 'lucide-react';

interface TacticalRoutePlotterProps {
  plan: GeneratedFlightPlan;
}

type MapLayerType = 'dark' | 'satellite' | 'topo';

interface TileLayerConfig {
  name: string;
  urls: string[];
  attribution: string;
  maxZoom: number;
  subdomains?: string[];
}

const TILE_LAYERS: Record<MapLayerType, TileLayerConfig> = {
  dark: {
    name: 'Tactical Dark',
    urls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 16,
  },
  satellite: {
    name: 'Satellite',
    urls: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and GIS User Community',
    maxZoom: 18,
  },
  topo: {
    name: 'Topographic',
    urls: [
      'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
    subdomains: ['a', 'b', 'c'],
  },
};

/**
 * Draws physical paved runway footprint, edge casing, dashed yellow centerline,
 * and extended centerline approach/departure alignment lines on Leaflet map.
 */
function drawRunwayOverlay(
  group: L.LayerGroup,
  airport: Airport,
  weather?: AirportWeather
) {
  if (!weather) return;
  const trueHdg =
    weather.activeRunwayTrueHeadingDeg !== undefined
      ? weather.activeRunwayTrueHeadingDeg
      : weather.activeRunwayHeadingDeg;
  const rwyLengthFt = airport.longestRunwayFt || 8000;
  const halfLenNm = Math.min(1.2, Math.max(0.5, (rwyLengthFt / 6076.1) / 2));

  // Paved runway threshold and departure end coordinates
  const pThresh = destinationPoint(airport.latitude, airport.longitude, halfLenNm, (trueHdg + 180) % 360);
  const pDer = destinationPoint(airport.latitude, airport.longitude, halfLenNm, trueHdg);

  // 1. Dark paved runway asphalt strip (thick pavement footprint)
  L.polyline([[pThresh.lat, pThresh.lon], [pDer.lat, pDer.lon]], {
    color: '#0f172a',
    weight: 9,
    opacity: 0.95,
    lineCap: 'square',
  }).addTo(group);

  // 2. Runway white edge striping
  L.polyline([[pThresh.lat, pThresh.lon], [pDer.lat, pDer.lon]], {
    color: '#ffffff',
    weight: 10,
    opacity: 0.55,
    lineCap: 'square',
  }).addTo(group);

  // 3. Runway active centerline dash (aviation yellow)
  L.polyline([[pThresh.lat, pThresh.lon], [pDer.lat, pDer.lon]], {
    color: '#facc15',
    weight: 2,
    dashArray: '3, 4',
    opacity: 0.95,
  }).addTo(group);

  // 4. Extended runway centerline guides (aligned out to 2.5 NM)
  const pExtApp = destinationPoint(airport.latitude, airport.longitude, halfLenNm + 2.5, (trueHdg + 180) % 360);
  const pExtDep = destinationPoint(airport.latitude, airport.longitude, halfLenNm + 2.5, trueHdg);

  L.polyline([[pExtApp.lat, pExtApp.lon], [pThresh.lat, pThresh.lon]], {
    color: '#94a3b8',
    weight: 1.5,
    dashArray: '2, 5',
    opacity: 0.7,
  }).addTo(group);

  L.polyline([[pDer.lat, pDer.lon], [pExtDep.lat, pExtDep.lon]], {
    color: '#94a3b8',
    weight: 1.5,
    dashArray: '2, 5',
    opacity: 0.7,
  }).addTo(group);
}

export const TacticalRoutePlotter: React.FC<TacticalRoutePlotterProps> = ({ plan }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileGroupRef = useRef<L.LayerGroup | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const [activeLayer, setActiveLayer] = useState<MapLayerType>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedWaypoint, setSelectedWaypoint] = useState<FlightWaypoint | null>(null);

  const waypoints = plan.waypoints;
  const primaryColor = '#10b981';
  const glowColor = '#34d399';

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
      scrollWheelZoom: true,
      minZoom: 3,
      maxZoom: 18,
    });

    // Add Base Tile Layer Group
    const tileGroup = L.layerGroup().addTo(map);
    tileGroupRef.current = tileGroup;

    const config = TILE_LAYERS[activeLayer];
    config.urls.forEach((url) => {
      L.tileLayer(url, {
        attribution: config.attribution,
        maxZoom: config.maxZoom,
        subdomains: config.subdomains || 'abc',
      }).addTo(tileGroup);
    });

    // Layer group for route polylines and waypoint markers
    const routeGroup = L.layerGroup().addTo(map);
    routeLayerGroupRef.current = routeGroup;

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Tile Layer when user switches layers
  useEffect(() => {
    if (!mapInstanceRef.current || !tileGroupRef.current) return;
    const tileGroup = tileGroupRef.current;
    tileGroup.clearLayers();

    const config = TILE_LAYERS[activeLayer];
    config.urls.forEach((url) => {
      L.tileLayer(url, {
        attribution: config.attribution,
        maxZoom: config.maxZoom,
        subdomains: config.subdomains || 'abc',
      }).addTo(tileGroup);
    });
  }, [activeLayer]);

  // Update Route Polyline & Markers whenever plan changes
  useEffect(() => {
    if (!mapInstanceRef.current || !routeLayerGroupRef.current) return;
    const map = mapInstanceRef.current;
    const group = routeLayerGroupRef.current;

    group.clearLayers();

    if (!waypoints || waypoints.length === 0) return;

    // 1. Draw physical paved runway strips with active centerline
    drawRunwayOverlay(group, plan.operatingAirbase, plan.departureWeather);
    if (plan.tngAirbase && plan.tngAirbase.ident !== plan.operatingAirbase.ident) {
      drawRunwayOverlay(group, plan.tngAirbase, plan.tngWeather);
    }

    // Training ground outline for range and drop sorties
    if (plan.trainingGround) {
      L.circle([plan.trainingGround.lat, plan.trainingGround.lon], {
        radius: plan.trainingGround.radiusNm * 1852,
        color: '#ef4444',
        weight: 1.5,
        opacity: 0.8,
        dashArray: '5, 5',
        fillColor: '#ef4444',
        fillOpacity: 0.07,
      })
        .bindTooltip(plan.trainingGround.name, { permanent: false })
        .addTo(group);
    }

    const latLngs: [number, number][] = waypoints.map((w) => [w.lat, w.lon]);

    // 2. Glowing background polyline
    L.polyline(latLngs, {
      color: glowColor,
      weight: 6,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);

    // 3. Crisp foreground vector polyline
    L.polyline(latLngs, {
      color: primaryColor,
      weight: 2.5,
      opacity: 0.95,
      dashArray: '6, 6',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(group);

    // 4. Add Waypoint Markers
    waypoints.forEach((wp, idx) => {
      const isBase = idx === 0 || idx === waypoints.length - 1;
      const isIp = wp.type === 'IP';
      const isInitial = wp.name.includes('INITIAL');
      const isFinal = wp.name.includes('FINAL');
      const isTouchdown = wp.name.includes('TOUCHDOWN');
      const isBreak = wp.name.includes('BREAK') || wp.name.includes('OVERHEAD');
      const isPerch = wp.name.includes('PERCH');

      let iconHtml = '';

      if (isBase && idx === 0) {
        // Departure Airbase Threshold Icon
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-7 h-7 rounded bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-[10px] font-bold font-mono">
              DEP
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-blue-300 border border-slate-700 px-1 py-0.2 rounded text-[9px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      } else if (isBase && idx === waypoints.length - 1) {
        // Recovery Airbase Rollout Icon
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-7 h-7 rounded bg-emerald-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-[10px] font-bold font-mono">
              RTB
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-emerald-300 border border-slate-700 px-1 py-0.2 rounded text-[9px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      } else if (wp.type === 'RANGE' || wp.type === 'DROP') {
        const isTargetFix = /^(TARGET|DZ \d)/.test(wp.name);
        const isKeyFix = /^(CARP|ROLL-IN|RUN-IN|PERCH|PULL-OFF|DZ EXIT)/.test(wp.name);
        if (isTargetFix) {
          iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-7 h-7 rounded-full bg-red-600 border-2 border-white shadow-lg flex items-center justify-center text-white text-[8px] font-extrabold font-mono">
              ${wp.type === 'DROP' ? 'DZ' : 'TGT'}
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-red-300 border border-slate-700 px-1 py-0.2 rounded text-[9px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
        } else if (isKeyFix) {
          iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-4 h-4 rounded-sm rotate-45 bg-orange-500 border border-white shadow"></div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-orange-300 border border-slate-700 px-1 py-0.2 rounded text-[8px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
        } else {
          iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-2.5 h-2.5 rounded-full bg-orange-400 border border-white shadow"></div>
          </div>
        `;
        }
      } else if (wp.type === 'TNG') {
        // Touch & Go Touchdown Marker
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-7 h-7 rounded bg-amber-500 border-2 border-white shadow-lg flex items-center justify-center text-slate-950 text-[9px] font-extrabold font-mono">
              T&G
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-amber-300 border border-slate-700 px-1 py-0.2 rounded text-[9px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      } else if (isTouchdown) {
        // Touchdown Threshold Marker
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-6 h-6 rounded bg-emerald-500 border-2 border-white shadow-md flex items-center justify-center text-slate-950 text-[8px] font-extrabold font-mono">
              TDZ
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-emerald-300 border border-slate-700 px-1 py-0.2 rounded text-[9px] font-mono whitespace-nowrap shadow">
              TOUCHDOWN
            </div>
          </div>
        `;
      } else if (isBreak) {
        // Tactical Break / Overhead Marker
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-6 h-6 rounded-md rotate-45 bg-purple-600 border-2 border-white shadow flex items-center justify-center">
              <span class="-rotate-45 text-[7px] font-bold text-white font-mono">BRK</span>
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-purple-300 border border-slate-700 px-1 py-0.2 rounded text-[8px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      } else if (isPerch) {
        // Perch Circling Marker
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-6 h-6 rounded-full bg-amber-500 border-2 border-white shadow flex items-center justify-center text-slate-950 text-[7px] font-bold font-mono">
              PRC
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-amber-200 border border-slate-700 px-1 py-0.2 rounded text-[8px] font-mono whitespace-nowrap shadow">
              THE PERCH
            </div>
          </div>
        `;
      } else if (isFinal) {
        // Final Approach Fix
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-5 h-5 rounded-sm rotate-45 bg-amber-400 border border-white shadow flex items-center justify-center">
              <span class="-rotate-45 text-[8px] font-bold text-slate-950 font-mono">FAF</span>
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-amber-200 border border-slate-700 px-1 py-0.2 rounded text-[8px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      } else if (isInitial) {
        // Initial Overhead Break Fix / Initial Pitch
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-6 h-6 rounded bg-indigo-600 border-2 border-white shadow-md flex items-center justify-center text-white text-[8px] font-bold font-mono">
              IAF
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-indigo-300 border border-slate-700 px-1 py-0.2 rounded text-[8px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      } else if (isIp) {
        // Initial Point (IP) Icon
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-6 h-6 rotate-45 bg-amber-500 border-2 border-white shadow-lg flex items-center justify-center">
              <span class="-rotate-45 text-[9px] font-bold text-slate-950 font-mono">IP</span>
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-amber-300 border border-slate-700 px-1 py-0.2 rounded text-[9px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      } else {
        // Standard Tactical Fix
        iconHtml = `
          <div class="relative flex items-center justify-center">
            <div class="w-4 h-4 rotate-45 bg-emerald-500 border border-white shadow flex items-center justify-center">
            </div>
            <div class="absolute -bottom-4 bg-slate-950/90 text-slate-200 border border-slate-700 px-1 py-0.2 rounded text-[8px] font-mono whitespace-nowrap shadow">
              ${wp.name}
            </div>
          </div>
        `;
      }

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'tactical-map-marker',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      const marker = L.marker([wp.lat, wp.lon], { icon: customIcon });

      // Click to select & popup
      marker.on('click', () => {
        setSelectedWaypoint(wp);
      });

      marker.addTo(group);
    });

    // Fit map bounds to encompass full flight path with padding
    const bounds = L.latLngBounds(latLngs);
    map.fitBounds(bounds, { padding: [45, 45], maxZoom: 12 });
  }, [plan, activeLayer]);

  const handleFitBounds = () => {
    if (!mapInstanceRef.current || waypoints.length === 0) return;
    const latLngs: [number, number][] = waypoints.map((w) => [w.lat, w.lon]);
    const bounds = L.latLngBounds(latLngs);
    mapInstanceRef.current.fitBounds(bounds, { padding: [45, 45], maxZoom: 12 });
  };

  const handleCenterBase = () => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.setView(
      [plan.operatingAirbase.latitude, plan.operatingAirbase.longitude],
      10,
      { animate: true }
    );
  };

  const handleCenterTng = () => {
    if (!mapInstanceRef.current || !plan.tngAirbase) return;
    mapInstanceRef.current.setView(
      [plan.tngAirbase.latitude, plan.tngAirbase.longitude],
      10,
      { animate: true }
    );
  };

  const handleZoomIn = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomIn();
  };

  const handleZoomOut = () => {
    if (mapInstanceRef.current) mapInstanceRef.current.zoomOut();
  };

  return (
    <div
      className={`bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md flex flex-col transition-all ${
        isFullscreen ? 'fixed inset-4 z-50 shadow-2xl border-slate-700' : 'relative w-full'
      }`}
    >
      {/* Top Map Control Bar */}
      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-emerald-400" />
          <span className="font-mono font-bold tracking-wider uppercase text-white">
            Tactical Flight Map
          </span>
          <span className="text-slate-600 hidden sm:inline">|</span>
          <span className="text-slate-400 font-mono text-[11px] hidden sm:inline">
            {plan.missionProfile === 'lltr_tng'
              ? `Low-Level LLTR + Touch & Go (${plan.operatingAirbase.ident} ➔ ${plan.tngAirbase?.ident || 'TNG'})`
              : plan.missionProfile === 'range_strafe'
                ? `Range Strafing (${plan.operatingAirbase.ident} ➔ ${plan.trainingGround?.name || 'range'})`
                : plan.missionProfile === 'cargo_drop'
                  ? `Airdrop (${plan.operatingAirbase.ident} ➔ ${plan.trainingGround?.name || 'drop zone'})`
                  : 'Low-Level MTR Corridor'}
          </span>
        </div>

        {/* Map Layers & Quick Actions */}
        <div className="flex items-center gap-2">
          {/* Layer Switcher */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setActiveLayer('dark')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeLayer === 'dark'
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Tactical Dark
            </button>
            <button
              type="button"
              onClick={() => setActiveLayer('satellite')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeLayer === 'satellite'
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Satellite
            </button>
            <button
              type="button"
              onClick={() => setActiveLayer('topo')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeLayer === 'topo'
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Topo Terrain
            </button>
          </div>

          {/* Fullscreen Toggle */}
          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded-lg border border-slate-800 transition-colors cursor-pointer"
            title={isFullscreen ? 'Exit Fullscreen' : 'Expand Fullscreen Map'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Map Viewport */}
      <div
        className={`relative w-full ${
          isFullscreen ? 'h-[calc(100vh-110px)]' : 'h-[440px] sm:h-[480px]'
        } bg-[#0b101b] select-none`}
      >
        <div ref={mapContainerRef} className="w-full h-full z-10" />

        {/* Map Floating HUD Tools */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5">
          <div className="bg-slate-950/85 backdrop-blur-md border border-slate-800/80 rounded-lg shadow-xl p-1 flex flex-col gap-1 text-slate-300">
            <button
              type="button"
              onClick={handleZoomIn}
              className="w-7 h-7 flex items-center justify-center font-bold text-sm bg-slate-900 hover:bg-slate-800 text-white rounded transition-colors cursor-pointer"
              title="Zoom In"
            >
              +
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              className="w-7 h-7 flex items-center justify-center font-bold text-sm bg-slate-900 hover:bg-slate-800 text-white rounded transition-colors cursor-pointer"
              title="Zoom Out"
            >
              −
            </button>
            <hr className="border-slate-800" />
            <button
              type="button"
              onClick={handleFitBounds}
              className="w-7 h-7 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors cursor-pointer"
              title="Reset Route Bounds"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleCenterBase}
              className="w-7 h-7 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors cursor-pointer"
              title="Center on Departure Base"
            >
              <MapPin className="w-3.5 h-3.5 text-blue-400" />
            </button>
            {plan.tngAirbase && (
              <button
                type="button"
                onClick={handleCenterTng}
                className="w-7 h-7 flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors cursor-pointer"
                title="Center on Touch & Go Airfield"
              >
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
              </button>
            )}
          </div>
        </div>

        {/* Hint (top-right, clear of the map credits in the bottom-right corner) */}
        <div className="absolute top-3 right-3 z-20 max-w-[11rem] sm:max-w-none bg-slate-950/90 backdrop-blur-md border border-slate-800/90 px-2.5 py-1.5 rounded-lg text-[10px] font-mono text-slate-400 text-right shadow-xl pointer-events-none">
          Click any waypoint to inspect leg details
        </div>

        {/* Selected Waypoint Detailed Tactical Card */}
        {selectedWaypoint && (
          <div className="absolute bottom-3 left-3 z-20 bg-slate-950/95 backdrop-blur-md border border-slate-700/90 p-3 rounded-xl text-xs font-mono text-slate-200 shadow-2xl max-w-sm animate-in fade-in duration-150">
            <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-1.5 mb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-400 text-sm tracking-wider">
                  {selectedWaypoint.name}
                </span>
                <span className="text-[10px] text-slate-400 uppercase tracking-widest px-1.5 py-0.5 bg-slate-800/80 rounded font-semibold">
                  {selectedWaypoint.type}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedWaypoint(null)}
                className="text-slate-400 hover:text-white px-1 font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div>
                <span className="text-slate-500">ALTITUDE: </span>
                <span className="text-white font-semibold">{selectedWaypoint.altDisplay}</span>
              </div>
              <div>
                <span className="text-slate-500">SPEED: </span>
                <span className="text-white font-semibold">
                  {selectedWaypoint.speedKts} KIAS (M{selectedWaypoint.mach})
                </span>
              </div>
              <div>
                <span className="text-slate-500">MAG HDG: </span>
                <span className="text-white font-semibold">{selectedWaypoint.bearingMagDeg}°M</span>
              </div>
              <div>
                <span className="text-slate-500">LEG DIST: </span>
                <span className="text-white font-semibold">{selectedWaypoint.legDistNm} NM</span>
              </div>
              <div>
                <span className="text-slate-500">CUM DIST: </span>
                <span className="text-white font-semibold">{selectedWaypoint.cumulativeDistNm} NM</span>
              </div>
              <div>
                <span className="text-slate-500">COORDS: </span>
                <span className="text-slate-300 font-semibold">
                  {selectedWaypoint.lat.toFixed(3)}°, {selectedWaypoint.lon.toFixed(3)}°
                </span>
              </div>
            </div>

            <div className="mt-2 pt-1.5 border-t border-slate-800/80 font-sans text-[11px] text-slate-300 leading-snug">
              <span className="text-slate-400 font-mono text-[10px] uppercase font-bold block mb-0.5">
                Tactical Remarks:
              </span>
              {selectedWaypoint.remarks}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
