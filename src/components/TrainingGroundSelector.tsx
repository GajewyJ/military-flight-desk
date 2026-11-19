import React, { useEffect } from 'react';
import { Block } from './ui';
import { useUnits } from '../hooks/useUnits';
import {
  TRAINING_GROUNDS,
  TRAINING_REACH,
  trainingGroundsInReach,
  type AircraftReach,
} from '../data/trainingGrounds';

interface TrainingGroundSelectorProps {
  value: string; // training ground id, or 'auto'
  onChange: (id: string) => void;
  home?: { lat: number; lon: number };
  aircraft: AircraftReach;
  /** Wording for the target: 'range' (strafing) or 'drop zone' (airdrop). */
  targetWord: 'range' | 'drop zone';
}

/**
 * Picks the training ground a range or drop sortie is flown at. With a home airfield only the
 * grounds within reach are listed, nearest first; 'auto' takes the nearest one.
 */
export const TrainingGroundSelector: React.FC<TrainingGroundSelectorProps> = ({
  value,
  onChange,
  home,
  aircraft,
  targetWord,
}) => {
  const U = useUnits();
  const options = home ? trainingGroundsInReach(home, aircraft) : [];
  const { minNm, maxNm } = TRAINING_REACH[aircraft];

  // A chosen ground that is out of reach of a newly entered home airfield falls back to 'auto'.
  useEffect(() => {
    if (home && value !== 'auto' && !options.some((o) => o.id === value)) onChange('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.lat, home?.lon, value]);

  const chosen = value === 'auto' ? options[0] : options.find((o) => o.id === value);

  return (
    <Block label={`Training ground (${targetWord})`} hint={U.text(`${minNm}-${maxNm} NM from home`)}>
      <div className="relative">
      <select
        id="training-ground"
        aria-label="Training ground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 pl-2 pr-6 appearance-none bg-inset border border-rule-strong font-mono text-[12px] text-ink"
      >
        <option value="auto">Automatic: nearest</option>
        {home
          ? options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.country}) {U.dist(o.distanceNm, 0)} {String(o.bearingDeg).padStart(3, '0')}°
              </option>
            ))
          : TRAINING_GROUNDS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.country})
              </option>
            ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px]">
        ▾
      </span>
      </div>

      <p className="mt-1.5 font-mono text-[11px] text-ink-2">
        {!home
          ? 'Enter the home airfield to see the distances.'
          : options.length === 0
            ? U.text(`No training ground ${minNm}-${maxNm} NM from this airfield. Pick another home airfield.`)
            : chosen
              ? `${value === 'auto' ? 'Nearest: ' : ''}${chosen.name}, ${U.dist(chosen.distanceNm, 0)}, ${String(chosen.bearingDeg).padStart(3, '0')}° true from home.`
              : ''}
      </p>
      <p className="mt-0.5 text-[10px] text-ink-3">
        Positions are approximate. Check the real range boundaries, times and NOTAMs before any real flight.
      </p>
    </Block>
  );
};
