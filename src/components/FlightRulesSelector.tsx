import React from 'react';
import { FlightRules } from '../types/flightDesk';
import { Lock, Eye } from 'lucide-react';

interface FlightRulesSelectorProps {
  value: FlightRules;
  onChange: (rules: FlightRules) => void;
}

export const FlightRulesSelector: React.FC<FlightRulesSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold tracking-wider text-slate-700 uppercase flex items-center gap-1.5">
          <span>Flight Rules</span>
        </label>
        <span className="text-[11px] text-slate-500 font-medium">Visual vs Instrument</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* VFR Option - Active */}
        <button
          type="button"
          onClick={() => onChange('VFR')}
          className={`relative p-3.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
            value === 'VFR'
              ? 'bg-slate-900 border-slate-900 text-white shadow-xs ring-1 ring-slate-900'
              : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="font-bold text-sm tracking-wide flex items-center gap-1.5">
              <Eye className={`w-4 h-4 ${value === 'VFR' ? 'text-emerald-400' : 'text-slate-500'}`} />
              VFR
            </span>
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                value === 'VFR' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-100 text-slate-600'
              }`}
            >
              Active
            </span>
          </div>
          <p className={`text-xs ${value === 'VFR' ? 'text-slate-300' : 'text-slate-500'}`}>
            Visual Flight Rules. Tactical low-level routes, visual orbits, and terrain masking.
          </p>
        </button>

        {/* IFR Option - Locked / Grayed out */}
        <div
          className="relative p-3.5 rounded-lg border border-slate-200 bg-slate-100/60 text-slate-400 select-none cursor-not-allowed flex flex-col justify-between"
          title="IFR flight rules will be unlocked in a future update"
        >
          <div className="flex items-center justify-between w-full mb-1">
            <span className="font-bold text-sm tracking-wide text-slate-400 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              IFR
            </span>
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 uppercase tracking-wider">
              Locked · Coming Soon
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Instrument Flight Rules. Military airway corridors and standard instrument departures (planned).
          </p>
        </div>
      </div>
    </div>
  );
};
