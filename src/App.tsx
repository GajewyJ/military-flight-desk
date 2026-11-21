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
import { MissionProfileSelector } from './components/MissionProfileSelector';
import { IcaoAutocomplete } from './components/IcaoAutocomplete';
import { SortieDurationSelector } from './components/SortieDurationSelector';
import { LiveWeatherStatusIndicator } from './components/WeatherModeSelector';
import { getAirportByIcao, initStaticCsv } from './data/airports';
import { generateMilitaryFlightPlan } from './utils/routeGenerator';
import { calculateDistanceNm } from './utils/geo';
import { fetchLiveAirportWeather, getNeutralWeather } from './utils/weatherService';
import { applyTerrainAgl } from './utils/terrainService';
import { moveWaypoint } from './utils/routeEdit';
import { TacticalBriefingCard } from './components/TacticalBriefingCard';
import { TacticalRoutePlotter } from './components/TacticalRoutePlotter';
import { NavLogTable } from './components/NavLogTable';
import { ErrorNotice } from './components/ErrorNotice';
import { WhatsNewDialog } from './components/WhatsNewDialog';
import { useWhatsNew } from './hooks/useWhatsNew';
import { Tape } from './components/ui';
import { useCooldown } from './hooks/useCooldown';
import { useSettings } from './hooks/useSettings';
import { SettingsDialog } from './components/SettingsDialog';
import { SettingsContext } from './hooks/settingsContext';
import { clearApiCache } from './utils/apiGuard';
import { APP_VERSION } from './utils/changelog';
import { findTrainingGround } from './data/trainingGrounds';
import {
  AppErrorInfo,
  generationError,
  invalidIcaoError,
  sameAirfieldError,
  unknownAirportError,
} from './utils/errorMessages';

export default function App() {
  const [flightRules, setFlightRules] = useState<FlightRules>('VFR');
  const [aircraftType, setAircraftType] = useState<AircraftClass>('fighter_jet');
  const resultsRef = useRef<HTMLElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [activeWpId, setActiveWpId] = useState<string | null>(null);
  const [missionProfile, setMissionProfile] = useState<MissionProfile>('low_level_mtr');
  const [operatingIcao, setOperatingIcao] = useState<string>(''); // No default value
  const [destinationIcao, setDestinationIcao] = useState<string>(''); // Second airfield for Touch & Go
  const [trainingGroundId, setTrainingGroundId] = useState<string>('auto'); // Range / drop sorties
  const [sortieDuration, setSortieDuration] = useState<SortieDuration>('medium');
  const [departureWeather, setDepartureWeather] = useState<AirportWeather | null>(null);
  const [isLoadingWeather, setIsLoadingWeather] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  // Pauses after the actions that call web services, so buttons and shortcuts cannot flood them
  const busyRef = useRef(false);
  const generateCooldown = useCooldown(3000);
  const refreshCooldown = useCooldown(20000);

  // Generated Military Mission Plan State
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedFlightPlan | null>(null);
  // The route as it was generated, for the Reset route button after waypoints were moved by hand
  const [originalPlan, setOriginalPlan] = useState<GeneratedFlightPlan | null>(null);
  const planRef = useRef<GeneratedFlightPlan | null>(null);
  planRef.current = generatedPlan;
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const [terrainBusy, setTerrainBusy] = useState(false);
  // Counts route changes: an altitude update that finishes after a newer change is dropped
  const routeChangeRef = useRef(0);
  const terrainTimerRef = useRef<number | undefined>(undefined);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const [errorInfo, setErrorInfo] = useState<AppErrorInfo | null>(null);
  const whatsNew = useWhatsNew();
  const { settings, update: updateSettings } = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  const isTraining = missionProfile === 'range_strafe' || missionProfile === 'cargo_drop';

  // Small windows stack the form above the result: bring the result into view after generating.
  // On a wide window the map is already next to the form.
  useEffect(() => {
    if (generatedPlan && resultsRef.current && window.matchMedia('(max-width: 1023px)').matches) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [generatedPlan]);

  // Keyboard: Ctrl+Enter generates; R generates again (not while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        formRef.current?.requestSubmit();
      } else if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'r') {
        formRef.current?.requestSubmit();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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
    if (busyRef.current || isLoadingWeather || refreshCooldown.isActive()) return;
    const cleanDep = operatingIcao.trim().toUpperCase();
    if (!cleanDep || cleanDep.length !== 4) return;

    if (!operatingAirport) {
      setErrorInfo(unknownAirport(cleanDep));
      return;
    }
    const depAir = operatingAirport;
    setIsLoadingWeather(true);

    try {
      clearApiCache(); // the button asks for fresh data; the pause after it limits how often
      const depW = await fetchLiveAirportWeather(depAir);
      setDepartureWeather(depW);
    } catch {
      setDepartureWeather(getNeutralWeather(depAir));
    } finally {
      setIsLoadingWeather(false);
      refreshCooldown.start();
    }
  };

  useEffect(
    () => () => {
      window.clearTimeout(terrainTimerRef.current);
      window.clearTimeout(noticeTimerRef.current);
    },
    []
  );

  const showRouteNotice = (text: string) => {
    setRouteNotice(text);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setRouteNotice(null), 4000);
  };

  /** A waypoint was dropped on the map: recalculate the legs now, the altitudes a moment later. */
  const handleWaypointMove = (id: string, lat: number, lon: number): boolean => {
    const current = planRef.current;
    if (!current) return false;
    const moved = moveWaypoint(current, id, lat, lon);
    if (!moved) {
      showRouteNotice('Waypoint not moved: keep it at least 1 NM from the waypoints next to it.');
      return false;
    }
    setRouteNotice(null);
    setGeneratedPlan(moved);
    planRef.current = moved;

    const change = ++routeChangeRef.current;
    window.clearTimeout(terrainTimerRef.current);
    // Wait for the last move of a series, then fetch the terrain once
    terrainTimerRef.current = window.setTimeout(async () => {
      setTerrainBusy(true);
      try {
        const withTerrain = await applyTerrainAgl(moved);
        if (change === routeChangeRef.current) {
          setGeneratedPlan(withTerrain);
          planRef.current = withTerrain;
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (change === routeChangeRef.current) setTerrainBusy(false);
      }
    }, 700);
    return true;
  };

  const handleResetRoute = () => {
    if (!originalPlan) return;
    routeChangeRef.current++;
    window.clearTimeout(terrainTimerRef.current);
    setTerrainBusy(false);
    setRouteNotice(null);
    setGeneratedPlan(originalPlan);
    planRef.current = originalPlan;
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    // The R key and Ctrl+Enter submit the form even while the button is disabled: stop them here
    if (busyRef.current || isLoadingWeather || generateCooldown.isActive()) return;

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
    busyRef.current = true;
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
        aircraftType,
        isTraining && trainingGroundId !== 'auto' ? findTrainingGround(trainingGroundId) : undefined
      );

      // Apply terrain-neutral Copernicus DEM AGL altitude calculation for low-level corridors and range patterns
      newPlan = await applyTerrainAgl(newPlan);

      routeChangeRef.current++;
      window.clearTimeout(terrainTimerRef.current);
      setTerrainBusy(false);
      setRouteNotice(null);
      setOriginalPlan(newPlan);
      setGeneratedPlan(newPlan);
    } catch (err) {
      console.error(err);
      setErrorInfo(generationError(err, destinationIcao));
    } finally {
      busyRef.current = false;
      setIsGenerating(false);
      setIsLoadingWeather(false);
      generateCooldown.start();
    }
  };

  const handleAircraftChange = (type: AircraftClass) => {
    setAircraftType(type);
    // The strafing profile is for fighters only and the drop profile for cargo only
    if ((type === 'cargo' && missionProfile === 'range_strafe') || (type !== 'cargo' && missionProfile === 'cargo_drop')) {
      setMissionProfile('low_level_mtr');
    }
    if (errorInfo) setErrorInfo(null);
  };

  const handleReset = () => {
    setOperatingIcao('');
    setDestinationIcao('');
    setMissionProfile('low_level_mtr');
    setTrainingGroundId('auto');
    setSortieDuration('medium');
    setDepartureWeather(null);
    routeChangeRef.current++;
    window.clearTimeout(terrainTimerRef.current);
    setTerrainBusy(false);
    setRouteNotice(null);
    setGeneratedPlan(null);
    setOriginalPlan(null);
    setErrorInfo(null);
  };

  return (
    <SettingsContext.Provider value={settings}>
    <div className="h-full flex flex-col bg-bg text-on-bg">
      {/* Top bar */}
      <header className="shrink-0 h-10 flex items-center gap-3 px-3">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M11 0v22M0 11h22" />
        </svg>
        <span className="cond text-[17px] font-bold">Military Flight Desk</span>
        <span className="cond hidden md:inline text-[11px] opacity-70">Sortie planner for MSFS 2020 / 2024</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Settings"
          className="cond h-6 px-2.5 text-[11px] border border-on-bg/60 hover:bg-on-bg hover:text-bg cursor-pointer"
        >
          Settings
        </button>
        <button
          type="button"
          onClick={whatsNew.openManually}
          title="Show what's new in this version"
          className="font-mono text-[11px] opacity-80 hover:opacity-100 px-1 cursor-pointer"
        >
          v{APP_VERSION}
        </button>
      </header>

      <main className="flex-1 min-h-0 flex flex-col lg:flex-row gap-2 px-2 pb-2 overflow-y-auto lg:overflow-hidden">
        {/* Planning form: one ruled sheet of numbered boxes */}
        <form ref={formRef} onSubmit={handleGenerate} className="sheet lg:w-[380px] lg:shrink-0 lg:min-h-0 flex flex-col text-ink">
          <div className="flex items-center justify-between px-2 py-1.5 border-b-2 border-ink">
            <Tape>
              <h1 className="inline">Flight plan</h1>
            </Tape>
            <button
              type="button"
              onClick={handleReset}
              className="cond text-[10px] text-ink-3 hover:text-accent underline cursor-pointer"
            >
              Form MFD-1 · Reset
            </button>
          </div>

          <div className="numbered lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
            {/* First box: later the flight rules decide which missions are offered */}
            <FlightRulesSelector value={flightRules} onChange={setFlightRules} />

            <IcaoAutocomplete
              label="Home airfield"
              sublabel="takeoff and recovery"
              value={operatingIcao}
              onChange={(code) => {
                setOperatingIcao(code);
                if (errorInfo) setErrorInfo(null);
              }}
              placeholder="ICAO code, e.g. EPLK"
              required
            />

            <AircraftTypeSelector value={aircraftType} onChange={handleAircraftChange} />

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
              trainingGroundId={trainingGroundId}
              onTrainingGroundChange={(id) => {
                setTrainingGroundId(id);
                if (errorInfo) setErrorInfo(null);
              }}
              homePosition={
                operatingAirport ? { lat: operatingAirport.latitude, lon: operatingAirport.longitude } : undefined
              }
            />

            <SortieDurationSelector
              value={sortieDuration}
              onChange={setSortieDuration}
              disabled={isTng}
              passesMode={missionProfile === 'range_strafe' ? 'strafe' : missionProfile === 'cargo_drop' ? 'drop' : undefined}
              calculatedDistanceNm={calculatedDirectDist}
              calculatedTimeMin={calculatedEstTimeMin}
            />

            <LiveWeatherStatusIndicator
              departureAirport={operatingAirport}
              departureWeather={departureWeather}
              isLoadingWeather={isLoadingWeather}
              refreshCooldownSec={refreshCooldown.remainingSec}
              onRefreshWeather={refreshWeather}
            />

          </div>

          {/* Messages and the Generate button stay in view at the bottom of the form */}
          <div className="shrink-0 border-t-2 border-ink">
            <div className="hazard" aria-hidden="true" />
            <div className="p-2 flex flex-col gap-2">
              <ErrorNotice error={errorInfo} onClose={() => setErrorInfo(null)} />
              <button
                type="submit"
                disabled={isGenerating || generateCooldown.active}
                className="cond w-full h-11 flex items-center justify-center gap-3 bg-accent text-white border-2 border-ink text-[20px] font-bold hover:brightness-95 disabled:opacity-60 cursor-pointer"
              >
                {isGenerating
                  ? 'Building the route...'
                  : generateCooldown.active
                    ? `Wait ${generateCooldown.remainingSec} s`
                    : generatedPlan
                      ? 'Generate again'
                      : 'Generate'}
                <small className="font-mono text-[10px] font-normal normal-case tracking-normal opacity-90">Ctrl+Enter</small>
              </button>
              <p className="font-mono text-[10px] text-ink-3 text-center">
                {isGenerating ? 'Fetching the weather and the terrain.' : 'R generates again, after a short pause'}
              </p>
            </div>
          </div>
        </form>

        {/* Result: the map next to the form, the sortie sheet and the log under it */}
        <section ref={resultsRef} className="flex-1 min-w-0 lg:min-h-0 flex flex-col gap-2 text-ink">
          {generatedPlan ? (
            <>
              <div className="h-[55vh] lg:h-auto lg:flex-[11_1_0%] lg:min-h-[260px]">
                <TacticalRoutePlotter
                  plan={generatedPlan}
                  theme={settings.theme}
                  fill
                  activeWpId={activeWpId}
                  onActiveWpChange={setActiveWpId}
                  onWaypointMove={handleWaypointMove}
                  onResetRoute={handleResetRoute}
                  notice={routeNotice}
                  busy={terrainBusy}
                />
              </div>
              <div className="sheet lg:flex-[9_1_0%] lg:min-h-0 lg:overflow-y-auto">
                <TacticalBriefingCard plan={generatedPlan} />
                <NavLogTable plan={generatedPlan} activeWpId={activeWpId} onActiveWpChange={setActiveWpId} />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <div className="sheet max-w-sm p-4">
                <Tape>No sortie yet</Tape>
                <ol className="mt-3 list-decimal pl-5 space-y-1 text-[13px]">
                  <li>Enter the home airfield.</li>
                  <li>Choose the aircraft and the mission.</li>
                  <li>Press Generate. The route appears here, with the log and the exports.</li>
                </ol>
              </div>
            </div>
          )}
        </section>
      </main>

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
      />

      {/* Release notes of this version: shown once after an update, or on click of the version label */}
      <WhatsNewDialog state={whatsNew.state} onClose={whatsNew.close} />
    </div>
    </SettingsContext.Provider>
  );
}
