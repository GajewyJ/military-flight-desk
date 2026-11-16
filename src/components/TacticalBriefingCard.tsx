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
import { Block, DataRow } from './ui';

interface TacticalBriefingCardProps {
  plan: GeneratedFlightPlan;
  onRegenerate?: () => void;
  onCopyBrief?: () => void;
  copiedBrief?: boolean;
  /** Theme of the kneeboard PDF (follows the app). */
  theme?: 'day' | 'night';
}

const mhz = (f?: string): string => (f && f.trim() ? (/mhz/i.test(f) ? f.trim() : `${f.trim()} MHz`) : 'N/A');

export const TacticalBriefingCard: React.FC<TacticalBriefingCardProps> = ({ plan, theme = 'day' }) => {
  const isTng = plan.missionProfile === 'lltr_tng';
  const { isElectron, saveWithDialog, showInFolder } = useSimConnect();
  const [saveToast, setSaveToast] = React.useState<{ filename: string; filePath?: string } | null>(null);

  const windText = (w: AirportWeather): string =>
    w.isCalm
      ? 'Calm'
      : `${w.windDirDeg.toString().padStart(3, '0')}°/${w.windSpeedKts} KT${w.windGustKts ? ` G${w.windGustKts}` : ''}`;

  const componentsText = (w: AirportWeather): string =>
    `HW ${w.headwindKts >= 0 ? `+${w.headwindKts}` : w.headwindKts} · XW ${Math.abs(w.crosswindKts)}${w.crosswindKts >= 0 ? 'R' : 'L'}`;

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
    'cond px-2.5 h-7 bg-panel text-ink border border-rule-strong text-[11px] font-bold hover:bg-ink hover:text-on-ink cursor-pointer';

  const missionLabel = plan.aircraftType === 'Cargo' ? 'Airlift' : 'Fighter';
  const profileLabel =
    plan.missionProfile === 'cargo_drop'
      ? 'Airdrop'
      : plan.missionProfile === 'range_strafe'
        ? 'Range strafing'
        : isTng
          ? 'LLTR + Touch & Go'
          : 'LLTR';

  const recovery =
    plan.aircraftType === 'Cargo'
      ? plan.waypoints.some((w) => w.name.startsWith('IAF'))
        ? 'Straight-in final'
        : 'Visual pattern'
      : plan.recoveryType === 'instrument'
        ? 'Straight-in final'
        : 'Overhead break';

  const dep = plan.departureWeather;
  const tng = plan.tngWeather;
  const estTag = (
    <span className="ml-1.5 text-warn" title="No runway data for this airfield: the runway is an estimate. Verify it in the sim.">
      EST
    </span>
  );

  return (
    <section>
      {/* Title and the one place to export */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2 px-2 py-2 border-b border-rule">
        <div className="min-w-0">
          <p className="cond text-[22px] font-bold leading-none">{plan.callsign}</p>
          <p className="font-mono text-[11px] text-ink-2 truncate">
            {missionLabel} · {profileLabel} · {plan.flightRules} · {plan.sectorDescription}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => handleExportMsfs('2020')}
            className={exportButtonClass}
            title={isElectron ? 'Save MSFS 2020 flight plan (.pln)' : 'Download MSFS 2020 flight plan (.pln)'}
          >
            MSFS 2020
          </button>
          <button
            type="button"
            onClick={() => handleExportMsfs('2024')}
            className={exportButtonClass}
            title={isElectron ? 'Save MSFS 2024 flight plan (.pln)' : 'Download MSFS 2024 flight plan (.pln)'}
          >
            MSFS 2024
          </button>
          <button
            type="button"
            onClick={handleExportLnm}
            className={exportButtonClass}
            title={isElectron ? 'Save Little Navmap flight plan (.lnmpln)' : 'Download Little Navmap flight plan (.lnmpln)'}
          >
            Little Navmap
          </button>
          <button type="button" onClick={() => downloadKneeboardPdf(plan, theme)} className={exportButtonClass} title="Kneeboard PDF">
            Kneeboard PDF
          </button>
        </div>
      </div>

      {/* Saved file (desktop app) */}
      {saveToast && (
        <div className="flex items-center justify-between gap-3 px-2 py-1 border-b border-rule bg-inset font-mono text-[11px]" role="status">
          <span className="min-w-0 truncate">
            Saved <strong>{saveToast.filename}</strong>
          </span>
          {saveToast.filePath && (
            <button
              type="button"
              onClick={() => showInFolder(saveToast.filePath!)}
              className="shrink-0 underline hover:text-accent cursor-pointer"
            >
              Show in folder
            </button>
          )}
        </div>
      )}

      {/* The four numbers that matter */}
      <div className="grid grid-cols-2 md:grid-cols-4 border-b border-rule">
        {[
          { label: 'Distance', value: `${plan.totalDistanceNm} NM` },
          { label: 'Duration', value: `${plan.totalFlightTimeMin} min` },
          { label: 'Altitude', value: plan.assignedAltitude },
          { label: 'Speed', value: `${plan.cruiseSpeedKts} KIAS` },
        ].map((item, i) => (
          <div key={item.label} className={`px-2 py-1.5 ${i > 0 ? 'md:border-l border-rule' : ''}`}>
            <span className="cond block text-[10px] text-ink-3">{item.label}</span>
            <span className="block font-mono font-bold text-[13px] leading-snug">{item.value}</span>
          </div>
        ))}
      </div>

      {/* Terrain problem: always visible */}
      {plan.terrainSource === 'ESTIMATED' && (
        <p className="px-2 py-1 border-b border-rule bg-inset font-mono text-[11px] text-warn font-semibold" role="alert">
          Terrain data unavailable. Altitudes are estimated; verify AGL.
        </p>
      )}

      {/* Airfields, range and radio */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        <Block
          label={`Home · ${plan.operatingAirbase.ident}`}
          hint={plan.operatingAirbase.military ? 'MIL' : 'CIV'}
          className="lg:border-r lg:border-b-0"
        >
          <DataRow label="Name">{plan.operatingAirbase.name}</DataRow>
          {dep && (
            <>
              <DataRow label="Runway">
                {dep.activeRunway}
                {dep.runwayEstimated && estTag}
              </DataRow>
              <DataRow label="Wind">
                {windText(dep)}
                {dep.isCalm ? '' : ` · ${componentsText(dep)}`}
              </DataRow>
              <DataRow label="QNH">
                {dep.altimeterInHg.toFixed(2)} inHg ({Math.round(dep.altimeterHpa)} hPa) · {dep.flightCategory}
              </DataRow>
            </>
          )}
          <DataRow label="Elevation">{plan.operatingAirbase.elevationFt.toLocaleString()} ft</DataRow>
          <DataRow label="Runway len">
            {plan.operatingAirbase.longestRunwayFt ? `${plan.operatingAirbase.longestRunwayFt.toLocaleString()} ft` : 'N/A'}
          </DataRow>
          <DataRow label="Tower">{mhz(plan.operatingAirbase.towerMhz)}</DataRow>
          <DataRow label="Recovery">{recovery}</DataRow>
        </Block>

        <div className="flex flex-col">
          {isTng && plan.tngAirbase && tng && (
            <Block label={`Touch & Go · ${plan.tngAirbase.ident}`} hint={plan.tngAirbase.military ? 'MIL' : 'CIV · straight-in only'}>
              <DataRow label="Name">{plan.tngAirbase.name}</DataRow>
              <DataRow label="Runway">
                {formatRunway(tng.activeRunway)}
                {plan.tngAirbase.longestRunwayFt ? ` (${plan.tngAirbase.longestRunwayFt.toLocaleString()} ft)` : ''}
                {tng.runwayEstimated && estTag}
              </DataRow>
              <DataRow label="Wind">
                {windText(tng)}
                {tng.isCalm ? '' : ` · ${componentsText(tng)}`}
              </DataRow>
              <DataRow label="Elevation">{plan.tngAirbase.elevationFt.toLocaleString()} ft</DataRow>
              <DataRow label="Tower">{mhz(plan.tngAirbase.towerMhz)}</DataRow>
            </Block>
          )}

          {plan.trainingGround && (
            <Block
              label={plan.missionProfile === 'cargo_drop' ? 'Drop zone' : 'Range'}
              hint={plan.trainingGround.country}
            >
              <DataRow label="Name">{plan.trainingGround.name}</DataRow>
              <DataRow label={plan.missionProfile === 'cargo_drop' ? 'Drop hdg' : 'Run-in hdg'}>
                {String(plan.runInHeadingMagDeg ?? 0).padStart(3, '0')}°M
              </DataRow>
              <DataRow label="Passes">
                {plan.passes} {plan.passes === 1 ? 'pass' : 'passes'}
                {(plan.passes ?? 0) > 1 ? ' (first one dry)' : ''}
              </DataRow>
              <DataRow label="Pattern">{(plan.patternSide ?? 'left').toUpperCase()}</DataRow>
            </Block>
          )}

          <Block label="Radio" hint={`SQUAWK ${plan.squawk}`}>
            <DataRow label="Tactical">{plan.tacFrequencyMhz}</DataRow>
            <DataRow label="Weather">
              {plan.weatherMode === 'live' ? 'Live METAR' : 'Neutral: ISA, calm'}
            </DataRow>
          </Block>
        </div>
      </div>

      {/* Footer: raw METAR and terrain source on the left, the stamp in the free corner */}
      <div className="flex items-center justify-between gap-4 px-2 py-2 border-t border-rule">
        <div className="min-w-0">
          {(dep?.rawMetar || tng?.rawMetar) && (
            <details>
              <summary className="cond cursor-pointer text-[10px] text-ink-3">Raw METAR</summary>
              {dep?.rawMetar && <p className="mt-1 font-mono text-[10px] text-ink-2 break-all">HOME {dep.rawMetar}</p>}
              {tng?.rawMetar && <p className="mt-1 font-mono text-[10px] text-ink-2 break-all">T&amp;G {tng.rawMetar}</p>}
            </details>
          )}
          {plan.terrainSource && plan.terrainSource !== 'ESTIMATED' && (
            <p className="font-mono text-[10px] text-ink-3">
              Terrain: Copernicus DEM (about 90 m) via Open-Meteo. Altitudes are above the ground.
            </p>
          )}
        </div>
        <span
          aria-hidden="true"
          className="cond shrink-0 mr-2 my-1 -rotate-3 border-2 border-alert text-alert px-2 py-0.5 text-[11px] font-bold leading-tight text-center opacity-80 outline outline-1 outline-alert outline-offset-2 select-none"
        >
          Simulation
          <br />
          use only
        </span>
      </div>
    </section>
  );
};
