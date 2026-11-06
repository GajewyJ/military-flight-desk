import React, { useState, useEffect, useRef } from 'react';
import { Airport } from '../types/flightDesk';
import { searchAirports, getAirportByIcao } from '../data/airports';
import {
  PlaneTakeoff,
  PlaneLanding,
  MapPin,
  Check,
  Shield,
  Radio,
} from 'lucide-react';

interface IcaoAutocompleteProps {
  label: string;
  sublabel?: string;
  value: string;
  onChange: (icao: string) => void;
  placeholder?: string;
  isDestination?: boolean;
  departureIcao?: string;
  required?: boolean;
}

export const IcaoAutocomplete: React.FC<IcaoAutocompleteProps> = ({
  label,
  sublabel,
  value,
  onChange,
  placeholder = 'Ident / ICAO (e.g. EPLK, KLSV, 00AA)',
  isDestination = false,
  departureIcao = '',
  required = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Airport[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Current matched airport with priority resolution (airports database)
  const resolvedAirport = value ? getAirportByIcao(value) : undefined;
  const fallbackAirport = isDestination && !value && departureIcao ? getAirportByIcao(departureIcao) : undefined;

  useEffect(() => {
    if (value.trim().length > 0) {
      const results = searchAirports(value, 8);
      setSuggestions(results);
    } else {
      setSuggestions([]);
    }
    setHighlightedIndex(-1);
  }, [value]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (airport: Airport) => {
    onChange(airport.ident);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        setIsOpen(true);
        setHighlightedIndex(0);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
        handleSelect(suggestions[highlightedIndex]);
      } else if (suggestions.length > 0) {
        handleSelect(suggestions[0]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative flex flex-col gap-1.5" ref={containerRef}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold tracking-wider text-slate-700 uppercase flex items-center gap-1.5">
          {isDestination ? (
            <PlaneLanding className="w-3.5 h-3.5 text-blue-600" />
          ) : (
            <PlaneTakeoff className="w-3.5 h-3.5 text-emerald-600" />
          )}
          <span>{label}</span>
          {required && <span className="text-rose-500 font-bold">*</span>}
        </label>
        {sublabel && (
          <span className="text-[11px] text-slate-400 font-medium">{sublabel}</span>
        )}
      </div>

      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
            onChange(clean);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (value.trim().length > 0) {
              setSuggestions(searchAirports(value, 8));
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={4}
          className="w-full h-11 px-3.5 text-base font-mono font-semibold tracking-widest text-slate-900 bg-white border border-slate-300 rounded-lg shadow-xs focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 placeholder:font-sans placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-400 transition-colors uppercase"
        />

        {value && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              setSuggestions([]);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm font-semibold px-1 py-0.5"
            title="Clear Ident"
          >
            ✕
          </button>
        )}

        {/* Suggestion dropdown below textbox matching priority resolution */}
        {isOpen && suggestions.length > 0 && (
          <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-100">
            <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-semibold tracking-wider text-slate-500 uppercase flex items-center justify-between border-b border-slate-100">
              <span>Matching ICAO Codes</span>
              <span>{suggestions.length} found</span>
            </div>
            {suggestions.map((airport, idx) => {
              const locationParts = [airport.city, airport.stateOrProvince, airport.countryOrAreaCode].filter(Boolean);
              const locationText = locationParts.join(', ');

              return (
                <button
                  key={`${airport.ident}-${idx}`}
                  type="button"
                  onClick={() => handleSelect(airport)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between gap-3 transition-colors ${
                    highlightedIndex === idx ? 'bg-slate-100 text-slate-900' : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="font-mono font-bold text-xs text-slate-900 tracking-wider bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">
                      {airport.ident}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                        <span className="truncate">{airport.name}</span>
                        {airport.military ? (
                          <span className="inline-flex items-center gap-0.5 px-1 py-0.2 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[9px] font-semibold shrink-0">
                            <Shield className="w-2.5 h-2.5" /> MIL
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {locationText || 'MSFS Airfield'}
                      </p>
                    </div>
                  </div>

                  <div className="text-right text-[11px] text-slate-500 font-mono shrink-0 flex flex-col items-end">
                    <span>{airport.elevationFt.toLocaleString()} ft MSL</span>
                    {airport.longestRunwayFt ? (
                      <span className="text-[10px] text-slate-400">
                        {airport.runwayDesignator ? `RWY ${airport.runwayDesignator} · ` : ''}
                        {airport.longestRunwayFt.toLocaleString()} ft
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Resolved Airfield Detail Card */}
      {resolvedAirport ? (
        <div
          className="p-2.5 rounded-lg text-xs flex flex-col gap-1.5 border transition-all bg-slate-50 border-slate-200"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 truncate">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="font-bold text-slate-900 truncate">{resolvedAirport.name}</span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600 truncate">
                {[resolvedAirport.city, resolvedAirport.stateOrProvince, resolvedAirport.countryOrAreaCode]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <span className="font-mono font-bold text-slate-900 text-xs">
                {resolvedAirport.ident}
              </span>
            </div>
          </div>

          {/* Airfield parameters strip */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 font-mono pt-1 border-t border-slate-200/80">
            <span>
              ELEV: <strong className="text-slate-700">{resolvedAirport.elevationFt.toLocaleString()} ft</strong>
            </span>

            {resolvedAirport.longestRunwayFt && (
              <>
                <span className="text-slate-300">·</span>
                <span>
                  RWY:{' '}
                  <strong className="text-slate-700">
                    {resolvedAirport.runwayDesignator ? `${resolvedAirport.runwayDesignator} (` : ''}
                    {resolvedAirport.longestRunwayFt.toLocaleString()} ft
                    {resolvedAirport.runwayDesignator ? ')' : ''}
                  </strong>
                </span>
              </>
            )}

            {resolvedAirport.towerMhz && (
              <>
                <span className="text-slate-300">·</span>
                <span className="flex items-center gap-0.5">
                  <Radio className="w-3 h-3 text-slate-400 inline" />
                  TWR: <strong className="text-slate-700">{resolvedAirport.towerMhz} MHz</strong>
                </span>
              </>
            )}

            {resolvedAirport.magDecl && (
              <>
                <span className="text-slate-300">·</span>
                <span>
                  MAG: <strong className="text-slate-700">{resolvedAirport.magDecl}</strong>
                </span>
              </>
            )}
          </div>
        </div>
      ) : isDestination && !value && fallbackAirport ? (
        <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-blue-900 flex items-center justify-between">
          <div className="flex items-center gap-1.5 truncate">
            <MapPin className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="font-semibold">Round-Trip Sortie:</span>
            <span className="truncate">Defaults to Departure ({fallbackAirport.ident} · {fallbackAirport.name})</span>
          </div>
          <span className="font-mono text-[11px] text-blue-700 shrink-0 ml-2 font-semibold">
            {fallbackAirport.elevationFt} ft MSL
          </span>
        </div>
      ) : isDestination && !value ? (
        <p className="text-[11px] text-slate-400">
          Leave empty for round-trip sortie (returns to departure airbase)
        </p>
      ) : null}
    </div>
  );
};
