import React, { useState, useEffect, useRef } from 'react';
import { Airport } from '../types/flightDesk';
import { searchAirports, getAirportByIcao } from '../data/airports';
import { Block } from './ui';
import { useUnits } from '../hooks/useUnits';

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
  const [focused, setFocused] = useState(false);
  const U = useUnits();
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

  const locationOf = (a: Airport) => [a.city, a.stateOrProvince, a.countryOrAreaCode].filter(Boolean).join(', ');

  return (
    <Block label={label} hint={sublabel}>
      <div className="relative" ref={containerRef}>
        <div className="relative">
          <div className="flex items-center gap-3">
            {/* Four letter boxes like a paper form; the real input lies invisibly on top of them */}
            <div className="relative shrink-0">
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`w-[38px] h-10 bg-inset flex items-center justify-center font-mono text-[23px] font-bold ${
                      focused && i === Math.min(value.length, 3)
                        ? 'border-2 border-accent'
                        : 'border border-rule-strong'
                    }`}
                  >
                    {value[i] ?? ''}
                  </span>
                ))}
              </div>
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
                  setFocused(true);
                  if (value.trim().length > 0) {
                    setSuggestions(searchAirports(value, 8));
                    setIsOpen(true);
                  }
                }}
                onBlur={() => setFocused(false)}
                onKeyDown={handleKeyDown}
                maxLength={4}
                aria-label={label}
                aria-required={required}
                autoComplete="off"
                spellCheck={false}
                className="absolute inset-0 w-full h-full opacity-0 cursor-text"
              />
            </div>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setSuggestions([]);
                  setIsOpen(false);
                  inputRef.current?.focus();
                }}
                className="cond text-[10px] text-ink-3 hover:text-accent underline cursor-pointer"
                title="Clear"
                aria-label="Clear airfield"
              >
                Clear
              </button>
            ) : (
              <span className="text-[11px] text-ink-3 leading-tight">{placeholder}</span>
            )}
          </div>

          {/* Suggestions */}
          {isOpen && suggestions.length > 0 && (
            <div className="absolute z-30 left-0 right-0 mt-1 bg-panel border border-rule-strong shadow-[3px_3px_0_rgb(0_0_0/0.35)] max-h-72 overflow-y-auto">
              <div className="flex justify-between px-2 py-1 border-b border-rule text-[10px] uppercase tracking-wider text-ink-3">
                <span>Matching ICAO codes</span>
                <span>{suggestions.length}</span>
              </div>
              {suggestions.map((airport, idx) => (
                <button
                  key={`${airport.ident}-${idx}`}
                  type="button"
                  onClick={() => handleSelect(airport)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full px-2 py-1.5 text-left flex items-center justify-between gap-2 border-b border-rule/60 last:border-b-0 cursor-pointer ${
                    highlightedIndex === idx ? 'bg-inset' : ''
                  }`}
                >
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono font-bold text-[12px] tracking-wider shrink-0">{airport.ident}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold">
                        {airport.name}
                        {airport.military ? <span className="ml-1.5 font-mono text-[10px] text-warn">MIL</span> : null}
                      </span>
                      <span className="block truncate text-[10px] text-ink-3">{locationOf(airport) || 'Airfield'}</span>
                    </span>
                  </div>
                  <div className="text-right font-mono text-[10px] text-ink-2 shrink-0">
                    <span className="block">{U.alt(airport.elevationFt)}</span>
                    {airport.longestRunwayFt ? (
                      <span className="block text-ink-3">
                        {airport.runwayDesignator ? `${airport.runwayDesignator} · ` : ''}
                        {U.alt(airport.longestRunwayFt)}
                      </span>
                    ) : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Resolved airfield */}
        {resolvedAirport ? (
          <div className="mt-1.5">
            <p className="text-[12px] font-semibold truncate">
              {resolvedAirport.name}
              <span className="font-normal text-ink-3"> {locationOf(resolvedAirport)}</span>
            </p>
            <p className="mt-0.5 font-mono text-[11px] text-ink-2">
              <span className={resolvedAirport.military ? 'font-bold text-warn' : 'font-bold'}>
                {resolvedAirport.military ? 'MIL' : 'CIV'}
              </span>
              {'  '}ELEV {U.alt(resolvedAirport.elevationFt)}
              {resolvedAirport.longestRunwayFt
                ? `  RWY ${resolvedAirport.runwayDesignator ? `${resolvedAirport.runwayDesignator} ` : ''}${U.alt(resolvedAirport.longestRunwayFt)}`
                : ''}
              {resolvedAirport.towerMhz ? `  TWR ${resolvedAirport.towerMhz}` : ''}
              {resolvedAirport.magDecl ? `  MAG ${resolvedAirport.magDecl}` : ''}
            </p>
            <p className="text-[10px] text-ink-3">
              {resolvedAirport.military
                ? 'Military: overhead break, straight-in or pattern join.'
                : 'Civil: straight-in only.'}
            </p>
          </div>
        ) : isDestination && !value && fallbackAirport ? (
          <p className="mt-1.5 font-mono text-[11px] text-ink-2">
            Round trip: returns to {fallbackAirport.ident}, {fallbackAirport.name}.
          </p>
        ) : isDestination && !value ? (
          <p className="mt-1.5 text-[11px] text-ink-3">Leave empty for a round trip back to the departure airfield.</p>
        ) : null}
      </div>
    </Block>
  );
};
