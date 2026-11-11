import React, { useEffect } from 'react';
import { MapPin } from 'lucide-react';
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
  const options = home ? trainingGroundsInReach(home, aircraft) : [];
  const { minNm, maxNm } = TRAINING_REACH[aircraft];

  // A chosen ground that is out of reach of a newly entered home airfield falls back to 'auto'.
  useEffect(() => {
    if (home && value !== 'auto' && !options.some((o) => o.id === value)) onChange('auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home?.lat, home?.lon, value]);

  const chosen = value === 'auto' ? options[0] : options.find((o) => o.id === value);

  return (
    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-2 mt-1">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="training-ground"
          className="text-xs font-semibold tracking-wider text-slate-700 uppercase flex items-center gap-1.5"
        >
          <MapPin className="w-3.5 h-3.5 text-slate-600" />
          <span>Training ground ({targetWord})</span>
        </label>
        <span className="text-[11px] text-slate-500 font-medium">
          {minNm}–{maxNm} NM from home
        </span>
      </div>

      <select
        id="training-ground"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        <option value="auto">Automatic: nearest training ground</option>
        {home
          ? options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.country}) · {o.distanceNm} NM · {String(o.bearingDeg).padStart(3, '0')}°
              </option>
            ))
          : TRAINING_GROUNDS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.country})
              </option>
            ))}
      </select>

      <p className="text-[11px] text-slate-500 leading-snug">
        {!home
          ? 'Enter the home airfield to see the distance to each training ground.'
          : options.length === 0
            ? `No training ground between ${minNm} and ${maxNm} NM from this airfield. Choose a different home airfield.`
            : chosen
              ? `${value === 'auto' ? 'Nearest: ' : ''}${chosen.name}, ${chosen.distanceNm} NM at ${String(chosen.bearingDeg).padStart(3, '0')}° true from home.`
              : ''}{' '}
        Positions are approximate. Check the real range boundaries, times and NOTAMs before any real-world use.
      </p>
    </div>
  );
};
