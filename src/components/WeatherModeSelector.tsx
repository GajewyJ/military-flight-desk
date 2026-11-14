import React from 'react';
import { Airport, AirportWeather } from '../types/flightDesk';
import { Block, DataRow } from './ui';

interface LiveWeatherStatusIndicatorProps {
  departureAirport?: Airport;
  departureWeather?: AirportWeather | null;
  isLoadingWeather?: boolean;
  onRefreshWeather?: () => void;
}

/** Weather of the home field: filled in when a plan is generated, or on request. */
export const LiveWeatherStatusIndicator: React.FC<LiveWeatherStatusIndicatorProps> = ({
  departureAirport,
  departureWeather,
  isLoadingWeather,
  onRefreshWeather,
}) => (
  <Block label="Weather (METAR / ATIS)" hint={departureWeather ? departureWeather.icao : undefined}>
    {departureWeather ? (
      <div>
        <DataRow label="Runway">{departureWeather.activeRunway}</DataRow>
        <DataRow label="Wind">
          {departureWeather.isCalm ? 'CALM' : `${departureWeather.windDirDeg}° / ${departureWeather.windSpeedKts} KT`}
        </DataRow>
        <DataRow label="HW / XW" tone={departureWeather.headwindKts < 0 ? 'warn' : undefined}>
          {departureWeather.headwindKts >= 0 ? `+${departureWeather.headwindKts}` : departureWeather.headwindKts} /{' '}
          {Math.abs(departureWeather.crosswindKts)} KT
        </DataRow>
        <DataRow label="QNH">{departureWeather.altimeterInHg} inHg</DataRow>
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
            disabled={isLoadingWeather}
            className="mt-1.5 border border-rule-strong px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-inset disabled:opacity-50 cursor-pointer"
          >
            {isLoadingWeather ? 'Updating...' : 'Refresh METAR / ATIS'}
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

export const WeatherModeSelector = LiveWeatherStatusIndicator;
