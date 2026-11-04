import React from 'react';
import { formatRunway } from '../utils/format';
import { GeneratedFlightPlan, AirportWeather } from '../types/flightDesk';
import { downloadLittleNavmapFile, generateLittleNavmapXml } from '../utils/littleNavmapExporter';
import {
  downloadMsfsPlnFile,
  generateMsfs2020PlnXml,
  generateMsfs2024PlnXml,
  msfsPlnFilename,
  type MsfsVersion,
} from '../utils/msfsExporter';
import { downloadKneeboardPdf } from '../utils/kneeboardPdfExporter';
import { useSimConnect } from '../hooks/useSimConnect';
import {
  ChevronDown,
  Radio,
  Zap,
  MapPin,
  Navigation,
  Download,
  FileText,
  AlertTriangle,
  FolderSync,
  CheckCircle2,
  FolderOpen,
  HardDrive,
} from 'lucide-react';

interface TacticalBriefingCardProps {
  plan: GeneratedFlightPlan;
  onRegenerate?: () => void;
  onCopyBrief?: () => void;
  copiedBrief?: boolean;
}

export const TacticalBriefingCard: React.FC<TacticalBriefingCardProps> = ({
  plan,
}) => {
  const isTng = plan.missionProfile === 'lltr_tng';
  const { isElectron, saveWithDialog, showInFolder } = useSimConnect();
  const [saveToast, setSaveToast] = React.useState<{ filename: string; filePath?: string } | null>(null);
  const [showDetails, setShowDetails] = React.useState(false);

  const windText = (w: AirportWeather): string =>
    w.isCalm
      ? 'Calm'
      : `${w.windDirDeg.toString().padStart(3, '0')}°/${w.windSpeedKts} KT${w.windGustKts ? ` G${w.windGustKts}` : ''}`;

  const handleExportMsfs = async (version: MsfsVersion) => {
    if (isElectron) {
      const xml = version === '2024' ? generateMsfs2024PlnXml(plan) : generateMsfs2020PlnXml(plan);
      const filename = msfsPlnFilename(plan, version);

      const res = await saveWithDialog(filename, xml, 'pln', 'MSFS Flight Plan (*.pln)');
      if (res.success && res.filename) {
        setSaveToast({ filename: res.filename, filePath: res.filePath });
        setTimeout(() => setSaveToast(null), 6000);
      }
    } else {
      downloadMsfsPlnFile(plan, version);
    }
  };

  const handleExportLnm = async () => {
    if (isElectron) {
      const xml = generateLittleNavmapXml(plan);
      const depIcao = plan.operatingAirbase.ident;
      const arrIcao = depIcao;
      const callsignClean = plan.callsign.replace(/\s+/g, '_');
      const filename = `VFR_${depIcao}_to_${arrIcao}_${callsignClean}.lnmpln`;

      const res = await saveWithDialog(filename, xml, 'lnmpln', 'Little Navmap Plan (*.lnmpln)');
      if (res.success && res.filename) {
        setSaveToast({ filename: res.filename, filePath: res.filePath });
        setTimeout(() => setSaveToast(null), 6000);
      }
    } else {
      downloadLittleNavmapFile(plan);
    }
  };

  const exportButtonClass =
    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-300 rounded-md text-xs font-semibold transition-colors cursor-pointer';

  const missionLabel = plan.aircraftType === 'Cargo' ? 'Airlift' : 'Fighter';

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
      {/* Title and the one place to export */}
      <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold text-xl tracking-wider text-slate-900">{plan.callsign}</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider">
              {missionLabel} · {isTng ? 'LLTR + Touch & Go' : 'LLTR'} · {plan.flightRules}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1 truncate">{plan.sectorDescription}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">Export</span>
          <button
            type="button"
            onClick={() => handleExportMsfs('2020')}
            className={exportButtonClass}
            title={isElectron ? 'Save MSFS 2020 flight plan (.pln)' : 'Download MSFS 2020 flight plan (.pln)'}
          >
            <Download className="w-3.5 h-3.5" />
            <span>MSFS 2020</span>
          </button>
          <button
            type="button"
            onClick={() => handleExportMsfs('2024')}
            className={exportButtonClass}
            title={isElectron ? 'Save MSFS 2024 flight plan (.pln)' : 'Download MSFS 2024 flight plan (.pln)'}
          >
            <Download className="w-3.5 h-3.5" />
            <span>MSFS 2024</span>
          </button>
          <button
            type="button"
            onClick={handleExportLnm}
            className={exportButtonClass}
            title={isElectron ? 'Save Little Navmap flight plan (.lnmpln)' : 'Download Little Navmap flight plan (.lnmpln)'}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Little Navmap</span>
          </button>
          <button
            type="button"
            onClick={() => downloadKneeboardPdf(plan)}
            className={exportButtonClass}
            title="Kneeboard PDF"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Kneeboard PDF</span>
          </button>
        </div>
      </div>

      {/* Save Notification Toast in Desktop Mode */}
      {saveToast && (
        <div className="px-5 py-2.5 bg-emerald-50 text-emerald-800 border-y border-emerald-200 flex items-center justify-between text-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Saved flight plan: <strong>{saveToast.filename}</strong>
            </span>
          </div>
          {saveToast.filePath && (
            <button
              onClick={() => showInFolder(saveToast.filePath!)}
              className="flex items-center gap-1 font-semibold text-emerald-700 hover:text-emerald-900 underline cursor-pointer shrink-0 ml-4"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Show in Folder
            </button>
          )}
        </div>
      )}

      {/* The four numbers that matter */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-200 border-y border-slate-200 text-xs">
        {[
          { label: 'Distance', value: `${plan.totalDistanceNm}`, unit: 'NM' },
          { label: 'Duration', value: `${plan.totalFlightTimeMin}`, unit: 'MIN' },
          { label: 'Altitude', value: plan.assignedAltitude, unit: '' },
          { label: 'Speed', value: `${plan.cruiseSpeedKts}`, unit: 'KIAS' },
        ].map((item) => (
          <div key={item.label} className="bg-white px-5 py-3 flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{item.label}</span>
            <span className="font-mono font-bold text-base text-slate-900 leading-snug">
              {item.value} {item.unit && <span className="text-xs font-normal text-slate-500">{item.unit}</span>}
            </span>
          </div>
        ))}
      </div>

      {/* At a glance: runway and wind, radio, squawk */}
      <div className="px-5 py-3 grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-2 text-xs">
        {plan.departureWeather && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Departure · {plan.weatherMode === 'live' ? 'live weather' : 'calm weather'}
            </span>
            <span className="font-mono text-slate-800 flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong>{plan.departureWeather.icao}</strong>
              <span>{plan.departureWeather.activeRunway}</span>
              <span>{windText(plan.departureWeather)}</span>
              <span>{plan.departureWeather.flightCategory}</span>
              {plan.departureWeather.runwayEstimated && (
                <span
                  title="No runway data for this airfield: the runway is an estimate. Verify it in the sim."
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
                >
                  RWY EST.
                </span>
              )}
            </span>
          </div>
        )}

        {isTng && plan.tngAirbase && plan.tngWeather && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Touch & Go</span>
            <span className="font-mono text-slate-800 flex flex-wrap items-center gap-x-2 gap-y-1">
              <strong>{plan.tngAirbase.ident}</strong>
              <span>{formatRunway(plan.tngWeather.activeRunway)}</span>
              <span>{windText(plan.tngWeather)}</span>
              <span>{plan.tngWeather.flightCategory}</span>
              {plan.tngWeather.runwayEstimated && (
                <span
                  title="No runway data for this airfield: the runway is an estimate. Verify it in the sim."
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
                >
                  RWY EST.
                </span>
              )}
            </span>
          </div>
        )}

        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Radio</span>
          <span className="font-mono text-slate-800 flex flex-wrap items-center gap-x-3">
            <span>
              TAC <strong>{plan.tacFrequencyMhz}</strong>
            </span>
            <span>
              SQUAWK <strong>{plan.squawk}</strong>
            </span>
          </span>
        </div>
      </div>

      {/* A terrain problem always stays visible */}
      {plan.terrainSource === 'ESTIMATED' && (
        <div className="mx-5 mb-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 flex items-center gap-1.5 text-xs text-amber-800 font-medium">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          <span>Terrain data unavailable. Altitudes estimated; verify AGL.</span>
        </div>
      )}

      {/* Everything else is one click away */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-600 flex items-center justify-between cursor-pointer transition-colors"
      >
        <span>{showDetails ? 'Hide briefing details' : 'Show briefing details: frequencies, weather, airfield'}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
      </button>

      {showDetails && (
      <div className="border-t border-slate-200">
      {/* Operational Communications & Station Strip */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* Tactical Avionics & Comms */}
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
            <span className="font-semibold text-slate-800 flex items-center gap-1.5 uppercase text-[11px] tracking-wider">
              <Radio className="w-3.5 h-3.5 text-blue-600" /> Tactical Avionics & Comms
            </span>
            <span className="text-[10px] font-mono font-semibold text-blue-700 bg-blue-100/60 px-1.5 py-0.5 rounded">
              SQUAWK: {plan.squawk}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div>
              <span className="text-[10px] text-slate-500 block">TAC COM 1</span>
              <span className="font-bold text-slate-800">{plan.tacFrequencyMhz}</span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">
                BASE TOWER
              </span>
              <span className="font-bold text-slate-800">
                {plan.operatingAirbase.towerMhz ||
                  '122.800 MHz'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">
                MIL TACAN
              </span>
              {plan.operatingAirbase.tacanChannel ? (
                <span className="font-bold text-blue-700 flex items-center gap-0.5">
                  <Zap className="w-3 h-3 text-blue-600 inline" />
                  {plan.operatingAirbase.tacanChannel}
                </span>
              ) : (
                <span className="text-slate-500">VOR / TAC</span>
              )}
            </div>
          </div>
        </div>

        {/* Operating Station & Recovery Parameters */}
        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex flex-col gap-2">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-1.5">
            <span className="font-semibold text-slate-800 flex items-center gap-1.5 uppercase text-[11px] tracking-wider">
              <MapPin className="w-3.5 h-3.5 text-emerald-600" />
              Airbase & Recovery
            </span>
            <span className="text-[10px] font-mono text-slate-600 font-semibold bg-emerald-100/60 text-emerald-800 px-1.5 py-0.5 rounded">
              {isTng && plan.tngAirbase
                ? `BASE: ${plan.operatingAirbase.ident} · T&G: ${plan.tngAirbase.ident}`
                : `BASE: ${plan.operatingAirbase.ident}`}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div>
              <span className="text-[10px] text-slate-500 block">
                BASE ELEVATION
              </span>
              <span className="font-bold text-slate-800">
                {plan.operatingAirbase.elevationFt} ft MSL
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">
                BASE RUNWAY
              </span>
              <span className="font-bold text-slate-800">
                {plan.operatingAirbase.longestRunwayFt
                  ? `${plan.operatingAirbase.longestRunwayFt.toLocaleString()} ft`
                  : 'Paved Military'}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 block">RECOVERY PATTERN</span>
              <span className="font-bold text-slate-800 flex items-center gap-1">
                <Navigation className="w-3 h-3 text-blue-600 inline shrink-0" />
                <span className="text-slate-800">
                  {plan.aircraftType === 'Cargo'
                    ? plan.waypoints.some((w) => w.name.startsWith('IAF'))
                      ? 'Straight-in Final'
                      : 'Visual Pattern'
                    : 'Overhead Pattern'}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Surface Weather & Active Runway Operational Strip */}
      <div className="border-t border-slate-200 bg-slate-900/95 text-slate-100 p-4 flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              Surface Weather & Active Runway Dispatch
            </span>
            {plan.weatherMode === 'live' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE METAR
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                RUNWAY-NEUTRAL (ISA / CALM)
              </span>
            )}
          </div>

          <span className="text-[11px] font-mono text-slate-400">
            {plan.weatherMode === 'live'
              ? plan.departureWeather?.notes || 'Real-time observation'
              : 'Standard 15°C · 29.92 inHg · 0 KT'}
          </span>
        </div>

        {/* Weather Cards (Dep + Dest/TnG) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Departure Airfield Weather */}
          {plan.departureWeather && (
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-sky-400">
                    DEP: {plan.departureWeather.icao}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-950 border border-sky-800 text-sky-300">
                    {plan.departureWeather.activeRunway} ACTIVE
                  </span>
                  {plan.departureWeather.runwayEstimated && (
                    <span
                      title="No runway data for this airfield: the runway is an estimate. Verify it in the sim."
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 border border-amber-800 text-amber-300"
                    >
                      RWY EST.
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  plan.departureWeather.flightCategory === 'VFR'
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                    : 'bg-amber-950/80 text-amber-400 border border-amber-800'
                }`}>
                  {plan.departureWeather.flightCategory}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                <div>
                  <span className="text-[10px] text-slate-500 block">SURFACE WIND</span>
                  <span className="font-bold text-slate-200">
                    {plan.departureWeather.isCalm
                      ? 'Calm (0 KT)'
                      : `${plan.departureWeather.windDirDeg.toString().padStart(3, '0')}°@${plan.departureWeather.windSpeedKts}KT${
                          plan.departureWeather.windGustKts ? `G${plan.departureWeather.windGustKts}` : ''
                        }`}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">WIND COMPONENT</span>
                  <span className="font-bold text-slate-200">
                    HW {plan.departureWeather.headwindKts >= 0 ? `+${plan.departureWeather.headwindKts}` : plan.departureWeather.headwindKts} · XW {Math.abs(plan.departureWeather.crosswindKts)}{plan.departureWeather.crosswindKts >= 0 ? 'R' : 'L'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">ALTIMETER / QNH</span>
                  <span className="font-bold text-slate-200">
                    {plan.departureWeather.altimeterInHg.toFixed(2)} inHg ({Math.round(plan.departureWeather.altimeterHpa)})
                  </span>
                </div>
              </div>

              {/* Raw METAR String */}
              <div className="mt-1 pt-1.5 border-t border-slate-800/80 font-mono text-[10px] text-slate-400 break-all bg-slate-900/80 px-2 py-1 rounded">
                <span className="text-slate-500 select-none mr-1.5">METAR:</span>
                {plan.departureWeather.rawMetar}
              </div>

              {/* Live ATIS Info if available */}
              {plan.departureWeather.atis && (
                <div className="pt-1 font-mono text-[10px] text-emerald-400 flex flex-wrap items-center gap-2">
                  <span className="font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/60">
                    📻 ATIS [{plan.departureWeather.atis.code}]
                  </span>
                  {plan.departureWeather.atis.frequency && (
                    <span className="text-slate-300">FREQ {plan.departureWeather.atis.frequency}</span>
                  )}
                  {plan.departureWeather.atis.depRunways.length > 0 && (
                    <span className="text-amber-300">
                      DEP RWY: {plan.departureWeather.atis.depRunways.join(', ')}
                    </span>
                  )}
                  {plan.departureWeather.atis.arrRunways.length > 0 && (
                    <span className="text-sky-300">
                      ARR RWY: {plan.departureWeather.atis.arrRunways.join(', ')}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Touch & Go Block (if LLTR + TNG) */}
          {isTng && plan.tngAirbase && plan.tngWeather ? (
            /* Dedicated Touch & Go Operational Block */
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm text-amber-400">
                    T&G: {plan.tngAirbase.ident}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 border border-amber-800 text-amber-300">
                    {formatRunway(plan.tngWeather.activeRunway)} ACTIVE
                  </span>
                  {plan.tngWeather.runwayEstimated && (
                    <span
                      title="No runway data for this airfield: the runway is an estimate. Verify it in the sim."
                      className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 border border-amber-800 text-amber-300"
                    >
                      RWY EST.
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                  plan.tngWeather.flightCategory === 'VFR'
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800'
                    : 'bg-amber-950/80 text-amber-400 border border-amber-800'
                }`}>
                  {plan.tngWeather.flightCategory}
                </span>
              </div>

              <div className="text-[11px] font-semibold text-slate-200 truncate">
                {plan.tngAirbase.name}
              </div>

              <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                <div>
                  <span className="text-[10px] text-slate-500 block">T&G RUNWAY</span>
                  <span className="font-bold text-slate-200">
                    {formatRunway(plan.tngWeather.activeRunway)}
                    {plan.tngAirbase.longestRunwayFt ? ` (${plan.tngAirbase.longestRunwayFt.toLocaleString()} ft)` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">TOWER FREQ</span>
                  <span className="font-bold text-slate-200">
                    {plan.tngAirbase.towerMhz ? `${plan.tngAirbase.towerMhz} MHz` : '122.800 MHz'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block">ELEVATION</span>
                  <span className="font-bold text-slate-200">
                    {plan.tngAirbase.elevationFt.toLocaleString()} ft MSL
                  </span>
                </div>
              </div>

              {/* Raw TnG METAR String */}
              <div className="mt-1 pt-1.5 border-t border-slate-800/80 font-mono text-[10px] text-slate-400 break-all bg-slate-900/80 px-2 py-1 rounded">
                <span className="text-slate-500 select-none mr-1.5">TnG METAR:</span>
                {plan.tngWeather.rawMetar}
              </div>
            </div>
          ) : (
            <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-3 flex flex-col justify-between gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">Runway Alignment & Vector</span>
                <span className="text-[10px] font-mono text-slate-500">CLOSED CIRCUIT RTB</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed font-mono">
                Departure and recovery assigned to {plan.departureWeather?.activeRunway || 'Primary Runway'} based on {plan.weatherMode === 'live' ? 'live surface wind vector' : 'neutral calm air standard'}.
              </p>
              <div className="text-[10px] font-mono text-slate-500">
                Crosswind Limit: 25 KT (dry) · 15 KT (wet)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Terrain data attribution */}
      {plan.terrainSource && plan.terrainSource !== 'ESTIMATED' && (
        <div className="px-5 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-mono">
            <span>Terrain: Copernicus DEM (~90 m) via Open-Meteo</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">AGL Terrain Contour</span>
        </div>
      )}
      </div>
      )}
    </div>
  );
};
