import React from 'react';
import { Airport, AirportWeather } from '../types/flightDesk';
import { Radio, RefreshCw, Compass, ArrowUpRight } from 'lucide-react';

interface LiveWeatherStatusIndicatorProps {
  departureAirport?: Airport;
  destinationAirport?: Airport;
  departureWeather?: AirportWeather | null;
  destinationWeather?: AirportWeather | null;
  isLoadingWeather?: boolean;
  onRefreshWeather?: () => void;
  isFerry?: boolean;
}

export const LiveWeatherStatusIndicator: React.FC<LiveWeatherStatusIndicatorProps> = ({
  departureAirport,
  destinationAirport,
  departureWeather,
  destinationWeather,
  isLoadingWeather,
  onRefreshWeather,
  isFerry,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 shadow-sm text-slate-100 flex flex-col gap-2.5">
      {/* Top Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Live Weather & ATIS Synchronization
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-sky-400 border border-slate-700">
              LIVE FEED
            </span>
          </div>
        </div>

        {departureWeather && onRefreshWeather && (
          <button
            type="button"
            onClick={onRefreshWeather}
            disabled={isLoadingWeather}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-sky-400 hover:text-sky-300 disabled:opacity-50 text-[11px] font-mono rounded border border-slate-700 transition-colors cursor-pointer"
            title="Refresh real-time METAR and live ATIS"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingWeather ? 'animate-spin' : ''}`} />
            <span>{isLoadingWeather ? 'Updating...' : 'Sync ATIS & METAR'}</span>
          </button>
        )}
      </div>

      {/* Live Data Badges (Active once Generated) */}
      {departureWeather ? (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 text-xs">
          {/* Departure Airbase Weather & Active Runway */}
          <div className="flex-1 bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-sky-400 text-xs">
                DEP: {departureWeather.icao}
              </span>
              <span className="font-mono text-[11px] text-amber-400 font-bold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40 flex items-center gap-1">
                <Compass className="w-3 h-3 text-amber-400" />
                ACTIVE {departureWeather.activeRunway}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-300 font-mono">
              <span>
                WIND:{' '}
                {departureWeather.isCalm
                  ? 'CALM (0 KT)'
                  : `${departureWeather.windDirDeg}° @ ${departureWeather.windSpeedKts} KT`}
              </span>
              <span>
                HW:{' '}
                <strong className={departureWeather.headwindKts >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {departureWeather.headwindKts >= 0
                    ? `+${departureWeather.headwindKts}`
                    : departureWeather.headwindKts}{' '}
                  KT
                </strong>
              </span>
              <span>
                XW: <strong>{Math.abs(departureWeather.crosswindKts)} KT</strong>
              </span>
              <span>QNH: {departureWeather.altimeterInHg} inHg</span>
            </div>

            {/* Live ATIS broadcast line if available */}
            {departureWeather.atis && (
              <div className="mt-0.5 pt-1.5 border-t border-slate-800/80 flex items-center gap-2 text-[10px] font-mono text-emerald-400">
                <Radio className="w-3 h-3 text-emerald-400 shrink-0" />
                <span className="font-bold">
                  ATIS INFO [{departureWeather.atis.code}]
                </span>
                {departureWeather.atis.frequency && (
                  <span className="text-slate-400">({departureWeather.atis.frequency})</span>
                )}
                {departureWeather.atis.arrRunways.length > 0 && (
                  <span className="text-slate-300">
                    ARR: {departureWeather.atis.arrRunways.join(', ')}
                  </span>
                )}
                {departureWeather.atis.depRunways.length > 0 && (
                  <span className="text-slate-300">
                    DEP: {departureWeather.atis.depRunways.join(', ')}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Destination Airbase Weather (Ferry) */}
          {isFerry && destinationWeather && (
            <div className="flex-1 bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-sky-400 text-xs">
                  ARR: {destinationWeather.icao}
                </span>
                <span className="font-mono text-[11px] text-amber-400 font-bold bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40 flex items-center gap-1">
                  <ArrowUpRight className="w-3 h-3 text-amber-400" />
                  ACTIVE {destinationWeather.activeRunway}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-300 font-mono">
                <span>
                  WIND:{' '}
                  {destinationWeather.isCalm
                    ? 'CALM'
                    : `${destinationWeather.windDirDeg}° @ ${destinationWeather.windSpeedKts} KT`}
                </span>
                <span>
                  HW:{' '}
                  <strong className={destinationWeather.headwindKts >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {destinationWeather.headwindKts >= 0
                      ? `+${destinationWeather.headwindKts}`
                      : destinationWeather.headwindKts}{' '}
                    KT
                  </strong>
                </span>
                <span>QNH: {destinationWeather.altimeterInHg} inHg</span>
              </div>

              {destinationWeather.atis && (
                <div className="mt-0.5 pt-1.5 border-t border-slate-800/80 flex items-center gap-2 text-[10px] font-mono text-emerald-400">
                  <Radio className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="font-bold">
                    ATIS INFO [{destinationWeather.atis.code}]
                  </span>
                  {destinationWeather.atis.arrRunways.length > 0 && (
                    <span className="text-slate-300">
                      ARR: {destinationWeather.atis.arrRunways.join(', ')}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Pre-Generate State */
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 text-xs bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60 font-mono">
          <div className="flex items-center gap-2 text-slate-400 text-[11px]">
            <Radio className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span>
              Live METAR & digital ATIS will synchronize when you click <strong>Generate Flight Plan</strong>.
            </span>
          </div>

          {departureAirport ? (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <span className="text-sky-400 font-bold">{departureAirport.ident}:</span>
              <span className="text-amber-300 font-bold">
                {departureAirport.runwayDesignator
                  ? `RWY ${departureAirport.runwayDesignator}`
                  : 'Surveyed Runway'}
              </span>
              {departureAirport.longestRunwayFt && (
                <span className="text-slate-500">({departureAirport.longestRunwayFt.toLocaleString()} ft)</span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-slate-500">Select 4-letter ICAO above</span>
          )}
        </div>
      )}
    </div>
  );
};

export const WeatherModeSelector = LiveWeatherStatusIndicator;
