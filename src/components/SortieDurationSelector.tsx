import React from 'react';
import { SortieDuration } from '../types/flightDesk';
import { Timer, Lock, CheckCircle2 } from 'lucide-react';

interface SortieDurationSelectorProps {
  value: SortieDuration;
  onChange: (duration: SortieDuration) => void;
  disabled?: boolean;
  calculatedDistanceNm?: number;
  calculatedTimeMin?: number;
}

const DURATIONS: {
  id: SortieDuration;
  label: string;
  timeEstimate: string;
  distanceEstimate: string;
  description: string;
}[] = [
  {
    id: 'short',
    label: 'Short',
    timeEstimate: '~20 min',
    distanceEstimate: '80–120 NM',
    description: 'Quick local circuit & combat maneuver training',
  },
  {
    id: 'medium',
    label: 'Medium',
    timeEstimate: '~45 min',
    distanceEstimate: '200–300 NM',
    description: 'Standard tactical sortie & cross-region navigation',
  },
  {
    id: 'long',
    label: 'Long',
    timeEstimate: '~75 min',
    distanceEstimate: '400–550 NM',
    description: 'Extended endurance patrol & multi-sector navigation',
  },
];

export const SortieDurationSelector: React.FC<SortieDurationSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  calculatedDistanceNm,
  calculatedTimeMin,
}) => {
  return (
    <div className={`flex flex-col gap-2 ${disabled ? 'opacity-85' : ''}`}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold tracking-wider text-slate-700 uppercase flex items-center gap-1.5">
          {disabled ? (
            <Lock className="w-3.5 h-3.5 text-amber-600" />
          ) : (
            <Timer className="w-3.5 h-3.5 text-slate-600" />
          )}
          <span>Mission Length</span>
          {disabled && (
            <span className="text-[10px] font-mono text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.2 rounded font-semibold uppercase">
              Disabled
            </span>
          )}
        </label>
        <span className="text-[11px] text-slate-500 font-medium">
          {disabled ? 'Governed by Target Airfield' : 'Sortie Duration & Range'}
        </span>
      </div>

      {disabled && (
        <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-lg text-xs text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Mission length selection is <strong>disabled</strong>. Sortie distance is determined by your chosen destination or touch-and-go airfield.
            </span>
          </div>
          {calculatedDistanceNm ? (
            <div className="shrink-0 flex items-center gap-2 font-mono text-[11px] bg-white/80 px-2 py-0.5 rounded border border-amber-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>
                Distance: <strong className="text-slate-900">{calculatedDistanceNm} NM</strong> (~{calculatedTimeMin} min)
              </span>
            </div>
          ) : null}
        </div>
      )}

      <div className={`grid grid-cols-3 gap-2.5 ${disabled ? 'pointer-events-none opacity-40 select-none' : ''}`}>
        {DURATIONS.map((dur) => {
          const isSelected = value === dur.id;
          return (
            <button
              key={dur.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(dur.id)}
              className={`p-3 rounded-lg border text-left transition-all flex flex-col justify-between ${
                disabled
                  ? 'bg-slate-100 border-slate-200 text-slate-400'
                  : isSelected
                  ? 'bg-slate-900 border-slate-900 text-white shadow-xs ring-1 ring-slate-900'
                  : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300 cursor-pointer'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-sm tracking-wide">{dur.label}</span>
                  <span
                    className={`font-mono text-[11px] font-semibold ${
                      isSelected && !disabled ? 'text-amber-300' : 'text-slate-500'
                    }`}
                  >
                    {dur.timeEstimate}
                  </span>
                </div>
                <p className={`text-[11px] font-mono mb-1.5 ${isSelected && !disabled ? 'text-slate-300' : 'text-slate-500'}`}>
                  {dur.distanceEstimate}
                </p>
              </div>
              <p
                className={`text-[10px] leading-tight line-clamp-2 ${
                  isSelected && !disabled ? 'text-slate-400' : 'text-slate-500'
                }`}
              >
                {dur.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};
