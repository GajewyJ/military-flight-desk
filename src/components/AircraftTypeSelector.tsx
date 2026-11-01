import React from 'react';
import { AircraftClass } from '../types/flightDesk';
import { Crosshair, Plane, Plus } from 'lucide-react';

interface AircraftTypeSelectorProps {
  value: AircraftClass;
  onChange: (type: AircraftClass) => void;
}

export const AircraftTypeSelector: React.FC<AircraftTypeSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold tracking-wider text-slate-700 uppercase flex items-center gap-1.5">
          <span>Aircraft Category</span>
        </label>
        <span className="text-[11px] text-slate-500 font-medium">Airframe Class</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Fighter Jet - Active & Selected */}
        <button
          type="button"
          onClick={() => onChange('fighter_jet')}
          className={`p-3.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
            value === 'fighter_jet'
              ? 'bg-slate-900 border-slate-900 text-white shadow-xs ring-1 ring-slate-900'
              : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="font-bold text-sm tracking-wide flex items-center gap-1.5">
              <Crosshair className={`w-4 h-4 ${value === 'fighter_jet' ? 'text-amber-400' : 'text-slate-500'}`} />
              Fighter Jet
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                value === 'fighter_jet' ? 'bg-amber-400/20 text-amber-300' : 'bg-slate-100 text-slate-600'
              }`}
            >
              Primary
            </span>
          </div>

          <p className={`text-xs mb-2.5 ${value === 'fighter_jet' ? 'text-slate-300' : 'text-slate-500'}`}>
            High-performance combat airframes (420–540 kts cruise / supersonic dash capability).
          </p>

          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-700/60 text-[11px]">
            <span className="text-slate-400 font-medium">Examples:</span>
            <span className="font-mono text-slate-200">F-16C</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-slate-200">F/A-18E</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-slate-200">Eurofighter Typhoon</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-slate-200">F-35A</span>
          </div>
        </button>

        {/* Cargo - Active */}
        <button
          type="button"
          onClick={() => onChange('cargo')}
          className={`p-3.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
            value === 'cargo'
              ? 'bg-slate-900 border-slate-900 text-white shadow-xs ring-1 ring-slate-900'
              : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="font-bold text-sm tracking-wide flex items-center gap-1.5">
              <Plane className={`w-4 h-4 ${value === 'cargo' ? 'text-amber-400' : 'text-slate-500'}`} />
              Cargo
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                value === 'cargo' ? 'bg-amber-400/20 text-amber-300' : 'bg-slate-100 text-slate-600'
              }`}
            >
              Tactical Airlift
            </span>
          </div>

          <p className={`text-xs mb-2.5 ${value === 'cargo' ? 'text-slate-300' : 'text-slate-500'}`}>
            Tactical airlifters (230–250 kts at low level): gentle turns, wider corridor legs, straight-in or wide visual pattern recovery.
          </p>

          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-700/60 text-[11px]">
            <span className="text-slate-400 font-medium">Examples:</span>
            <span className="font-mono text-slate-200">C-130J</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-slate-200">A400M</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-slate-200">C-295</span>
            <span className="text-slate-500">·</span>
            <span className="font-mono text-slate-200">C-17A</span>
          </div>
        </button>

        {/* Future Classes Placeholder */}
        <div className="p-3.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 text-slate-400 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between w-full mb-1">
              <span className="font-medium text-sm text-slate-500 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-slate-400" />
                Additional Categories
              </span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 uppercase tracking-wider">
                Planned
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Future releases may add Military Trainers (T-6, T-38, Hawk) and CAS/Attack airframes (A-10C).
            </p>
          </div>
          <p className="text-[11px] text-slate-400 font-medium pt-2">
            Fighter Jet and Cargo are available now.
          </p>
        </div>
      </div>
    </div>
  );
};
