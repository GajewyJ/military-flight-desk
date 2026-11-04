import React, { useState, useEffect, useRef } from 'react';
import {
  FlightRules,
  AircraftClass,
  MissionProfile,
  SortieDuration,
  GeneratedFlightPlan,
  Airport,
  AirportWeather,
} from './types/flightDesk';
import { FlightRulesSelector } from './components/FlightRulesSelector';
import { AircraftTypeSelector } from './components/AircraftTypeSelector';
import { MissionProfileSelector, getMissionProfiles } from './components/MissionProfileSelector';
import { IcaoAutocomplete } from './components/IcaoAutocomplete';
import { SortieDurationSelector } from './components/SortieDurationSelector';
import { LiveWeatherStatusIndicator } from './components/WeatherModeSelector';
import { getAirportByIcao, initStaticCsv } from './data/airports';
import { generateMilitaryFlightPlan } from './utils/routeGenerator';
import { calculateDistanceNm } from './utils/geo';
import { fetchLiveAirportWeather, getNeutralWeather } from './utils/weatherService';
import { applyTerrainAgl } from './utils/terrainService';
import { TacticalBriefingCard } from './components/TacticalBriefingCard';
import { TacticalRoutePlotter } from './components/TacticalRoutePlotter';
import { NavLogTable } from './components/NavLogTable';
import { ErrorDialog } from './components/ErrorDialog';
import {
  AppErrorInfo,
  generationError,
  invalidIcaoError,
  sameAirfieldError,
  unknownAirportError,
} from './utils/errorMessages';
import {
  Plane,
  AlertCircle,
  FileCheck2,
  RefreshCw,
  Navigation,
} from 'lucide-react';

export default function App() {
  const [flightRules, setFlightRules] = useState<FlightRules>('VFR');
  const [aircraftType, setAircraftType] = useState<AircraftClass>('fighter_jet');
  const resultsRef = useRef<HTMLDivElement>(null);
  const [missionProfile, setMissionProfile] = useState<MissionProfile>('low_level_mtr');
  const [operatingIcao, setOperatingIcao] = useState<string>(''); // No default value
  const [destinationIcao, setDestinationIcao] = useState<string>(''); // Second airfield for Touch & Go
  const [sortieDuration, setSortieDuration] = useState<SortieDuration>('medium');
  const [departureWeather, setDepartureWeather] = useState<AirportWeather | null>(null);
  const [isLoadingWeather, setIsLoadingWeather] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Generated Military Mission Plan State
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedFlightPlan | null>(null);
  const [errorInfo, setErrorInfo] = useState<AppErrorInfo | null>(null);

  // Initialize static JSON and CSV databases silently in background
  const [dbReady, setDbReady] = useState<boolean>(false);
  useEffect(() => {
    initStaticCsv().finally(() => setDbReady(true));
  }, []);

  const unknownAirport = (icao: string): AppErrorInfo => unknownAirportError(icao, dbReady);

  // Resolved operating airport (Departure & Recovery)
  const operatingAirport = getAirportByIcao(operatingIcao);
  const destinationAirport = getAirportByIcao(destinationIcao);

  const isTng = missionProfile === 'lltr_tng';

  // After a plan is generated, bring the result into view so nobody has to scroll for it.
  useEffect(() => {
    if (generatedPlan && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [generatedPlan]);

  // Calculate direct distance and duration estimates
  const calculatedDirectDist =
    isTng && operatingAirport && destinationAirport
      ? Math.round(
          2 *
            calculateDistanceNm(
              operatingAirport.latitude,
              operatingAirport.longitude,
              destinationAirport.latitude,
              destinationAirport.longitude
            )
        )
      : undefined;

  const calculatedEstTimeMin = calculatedDirectDist
    ? Math.round((calculatedDirectDist / (aircraftType === 'cargo' ? 240 : 450)) * 60)
    : undefined;

  // Reset cached weather when airfield ICAO changes (Zero background API calls until "Generate")
  useEffect(() => {
    setDepartureWeather(null);
  }, [operatingIcao]);

  const refreshWeather = async () => {
    const cleanDep = operatingIcao.trim().toUpperCase();
    if (!cleanDep || cleanDep.length !== 4) return;

    if (!operatingAirport) {
      setErrorInfo(unknownAirport(cleanDep));
      return;
    }
    const depAir = operatingAirport;
    setIsLoadingWeather(true);

    try {
      const depW = await fetchLiveAirportWeather(depAir);
      setDepartureWeather(depW);
    } catch {
      setDepartureWeather(getNeutralWeather(depAir));
    } finally {
      setIsLoadingWeather(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();

    const cleanDep = operatingIcao.trim().toUpperCase();
    if (!cleanDep || cleanDep.length !== 4) {
      setErrorInfo(invalidIcaoError('departure'));
      return;
    }

    const cleanDest = destinationIcao.trim().toUpperCase();
    if (isTng) {
      if (!cleanDest || cleanDest.length !== 4) {
        setErrorInfo(invalidIcaoError('touchAndGo'));
        return;
      }
      if (!destinationAirport) {
        setErrorInfo(unknownAirport(cleanDest));
        return;
      }
      if (cleanDep === cleanDest) {
        setErrorInfo(sameAirfieldError('touchAndGo'));
        return;
      }
    }

    setErrorInfo(null);
    setIsGenerating(true);

    try {
      // Never fabricate an airfield: unknown ICAOs are rejected, not placed at default coordinates.
      if (!operatingAirport) {
        setErrorInfo(unknownAirport(cleanDep));
        return;
      }
      if (isTng && !destinationAirport) {
        setErrorInfo(unknownAirport(cleanDest));
        return;
      }

      const resolvedAirport: Airport = operatingAirport;
      const resolvedDestAirport: Airport | undefined = isTng ? destinationAirport : undefined;

      setIsLoadingWeather(true);

      // On-demand ecological API dispatch: only runs upon clicking "Generate"
      const depW = await fetchLiveAirportWeather(resolvedAirport);
      setDepartureWeather(depW);

      let destW: AirportWeather | undefined;
      if (resolvedDestAirport) {
        destW = await fetchLiveAirportWeather(resolvedDestAirport);
      }

      let newPlan = generateMilitaryFlightPlan(
        resolvedAirport,
        missionProfile,
        sortieDuration,
        resolvedDestAirport,
        depW,
        destW,
        aircraftType
      );

      // Apply terrain-neutral Copernicus DEM AGL altitude calculation for low-level corridors
      if (missionProfile === 'low_level_mtr' || missionProfile === 'lltr_tng') {
        newPlan = await applyTerrainAgl(newPlan);
      }

      setGeneratedPlan(newPlan);
    } catch (err) {
      console.error(err);
      setErrorInfo(generationError(err, destinationIcao));
    } finally {
      setIsGenerating(false);
      setIsLoadingWeather(false);
    }
  };

  const handleAircraftChange = (type: AircraftClass) => {
    setAircraftType(type);
    if (errorInfo) setErrorInfo(null);
  };

  const handleReset = () => {
    setOperatingIcao('');
    setDestinationIcao('');
    setMissionProfile('low_level_mtr');
    setSortieDuration('medium');
    setDepartureWeather(null);
    setGeneratedPlan(null);
    setErrorInfo(null);
  };

  const selectedProfileInfo = getMissionProfiles(aircraftType).find((p) => p.id === missionProfile);

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 flex flex-col font-sans">
      {/* Top Navigation Bar without bookmark links */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 shadow-xs">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center text-white shadow-xs">
              <Plane className="w-4 h-4 transform -rotate-45" />
            </div>
            <div>
              <span className="font-bold text-sm sm:text-base tracking-wide text-white block leading-tight">
                Military Flight Desk
              </span>
              <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase block">
                MSFS 2020 / 2024 Desktop Dispatch
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-medium px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              VFR ACTIVE
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Viewport */}
      <main className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 flex flex-col gap-5">
        {/* Tactical Mission Dispatch Setup Panel */}
        <form onSubmit={handleGenerate} className="flex flex-col gap-4">
          <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
            {/* Form Section Header */}
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h1 className="font-bold text-sm text-slate-900 tracking-wide uppercase">
                  Tactical Sortie Dispatch Configuration
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Design peacetime visual military training routes (MTR / VR) for Microsoft Flight Simulator.
                </p>
              </div>

              <button
                type="button"
                onClick={handleReset}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
              >
                Reset Defaults
              </button>
            </div>

            {/* Input Form Fields Grid */}
            <div className="p-5 flex flex-col gap-5">
              {/* Row 1: Operating Flight Rules */}
              <div>
                <FlightRulesSelector value={flightRules} onChange={setFlightRules} />
              </div>

              <hr className="border-slate-100" />

              {/* Row 2: Airfield Selection (Operating Base) */}
              <div>
                <IcaoAutocomplete
                  label="Departure & Recovery Airbase"
                  sublabel={aircraftType === 'cargo' ? 'Home Airfield (Takeoff & Recovery)' : 'Home Airfield (Takeoff & Overhead Break)'}
                  value={operatingIcao}
                  onChange={(code) => {
                    setOperatingIcao(code);
                    if (errorInfo) setErrorInfo(null);
                  }}
                  placeholder="Enter 4-letter ICAO (e.g. EPLK, KLSV, EGXC)"
                  required
                />
              </div>

              <hr className="border-slate-100" />

              {/* Row 3: Aircraft Category */}
              <div>
                <AircraftTypeSelector value={aircraftType} onChange={handleAircraftChange} />
              </div>

              <hr className="border-slate-100" />

              {/* Row 4: Peacetime Military Mission Profile */}
              <div>
                <MissionProfileSelector
                  value={missionProfile}
                  onChange={setMissionProfile}
                  destinationIcao={destinationIcao}
                  onDestinationChange={(code) => {
                    setDestinationIcao(code);
                    if (errorInfo) setErrorInfo(null);
                  }}
                  departureIcao={operatingIcao}
                  aircraftClass={aircraftType}
                />
              </div>

              <hr className="border-slate-100" />

              {/* Row 5: Sortie Length (Disabled for Touch-and-Go) */}
              <div>
                <SortieDurationSelector
                  value={sortieDuration}
                  onChange={setSortieDuration}
                  disabled={isTng}
                  calculatedDistanceNm={calculatedDirectDist}
                  calculatedTimeMin={calculatedEstTimeMin}
                />
              </div>

              <hr className="border-slate-100" />

              {/* Row 6: Live Weather & ATIS Synchronization */}
              <div>
                <LiveWeatherStatusIndicator
                  departureAirport={operatingAirport}
                  departureWeather={departureWeather}
                  isLoadingWeather={isLoadingWeather}
                  onRefreshWeather={refreshWeather}
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="px-5 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-xs text-slate-500 flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  Flight plan schema validates surveyed physical runways, real-time NOAA/VATSIM surface winds, and digital ATIS.
                </span>
              </div>

              <button
                type="submit"
                disabled={isGenerating}
                className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 text-white font-bold text-xs uppercase tracking-wider rounded-lg shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Querying METAR & Generating...</span>
                  </>
                ) : (
                  <>
                    <FileCheck2 className="w-4 h-4" />
                    <span>Generate Flight Plan</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Generated Military Flight Plan Section (In-App Only) */}
        {generatedPlan && (
          <div ref={resultsRef} className="flex flex-col gap-4 animate-in fade-in duration-300 scroll-mt-4">
            {/* 1. Summary: key numbers, runway, radio and the one place to export */}
            <TacticalBriefingCard plan={generatedPlan} />

            {/* 2. Route map */}
            <TacticalRoutePlotter plan={generatedPlan} />

            {/* 3. Navigation log (collapsed until asked for) */}
            <NavLogTable plan={generatedPlan} />
          </div>
        )}
      </main>

      {/* Error window: centred over everything so it is seen wherever the user has scrolled */}
      <ErrorDialog error={errorInfo} onClose={() => setErrorInfo(null)} />
    </div>
  );
}
