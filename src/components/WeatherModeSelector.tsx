import React from 'react';
import { Airport, AirportWeather } from '../types/flightDesk';
import { Block, DataRow } from './ui';
import { useUnits } from '../hooks/useUnits';

interface LiveWeatherStatusIndicatorProps {
  departureAirport?: Airport;
  departureWeather?: AirportWeather | null;
  isLoadingWeather?: boolean;
  onRefreshWeather?: () => void;
  /** Seconds before the refresh button can be used again (0: ready). */
  refreshCooldownSec?: number;
}

/** Weather of the home field: filled in when a plan is generated, or on request. */
export const LiveWeatherStatusIndicator: React.FC<LiveWeatherStatusIndicatorProps> = ({
  departureAirport,
  departureWeather,
  isLoadingWeather,
  onRefreshWeather,
  refreshCooldownSec = 0,
}) => {
  const U = useUnits();
  const kt = (n: number) => `${U.speedValue(n)} ${U.labels.spd.toUpperCase()}`;
  return (
  <Block label="Weather (METAR / ATIS)" hint={departureWeather ? departureWeather.icao : undefined}>
    {departureWeather ? (
      <div>
        <DataRow label="Runway">{departureWeather.activeRunway}</DataRow>
        <DataRow label="Wind">
          {departureWeather.isCalm ? 'CALM' : `${departureWeather.windDirDeg}° / ${kt(departureWeather.windSpeedKts)}`}
        </DataRow>
        <DataRow label="HW / XW" tone={departureWeather.headwindKts < 0 ? 'warn' : undefined}>
          {departureWeather.headwindKts >= 0 ? `+${U.speedValue(departureWeather.headwindKts)}` : U.speedValue(departureWeather.headwindKts)} /{' '}
          {kt(Math.abs(departureWeather.crosswindKts))}
        </DataRow>
        <DataRow label="QNH">{U.pressure(departureWeather.altimeterInHg, departureWeather.altimeterHpa)}</DataRow>
        {departureWeather.atis && (
          <DataRow label="ATIS">
            [{departureWeather.atis.code}]
            {departureWeather.atis.frequency ? ` ${departureWeather.atis.frequency}` : ''}
            {departureWeather.atis.arrRunways.length > 0 ? `  ARR ${departureWeather.atis.arrRunways.join(', ')}` : ''}
            {departureWeather.atis.depRunways.length > 0 ? `  DEP ${departureWeather.atis.depRunways.join(', ')}` : ''}
          </DataRow>
        )}
        {onRefreshWeather && (
          <button
            type="button"
            onClick={onRefreshWeather}
            disabled={isLoadingWeather || refreshCooldownSec > 0}
            className="mt-1.5 border border-rule-strong px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-inset disabled:opacity-50 cursor-pointer"
          >
            {isLoadingWeather
              ? 'Updating...'
              : refreshCooldownSec > 0
                ? `Refresh in ${refreshCooldownSec} s`
                : 'Refresh METAR / ATIS'}
          </button>
        )}
      </div>
    ) : (
      <p className="font-mono text-[11px] text-ink-2">
        {departureAirport
          ? `${departureAirport.ident}: the live METAR and ATIS are fetched when you press Generate.`
          : 'Enter the home airfield. The live METAR and ATIS are fetched when you press Generate.'}
      </p>
    )}
  </Block>
  );
};

export const WeatherModeSelector = LiveWeatherStatusIndicator;
