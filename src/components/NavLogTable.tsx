import React from 'react';
import { GeneratedFlightPlan } from '../types/flightDesk';
import { ListOrdered, ChevronDown } from 'lucide-react';

interface NavLogTableProps {
  plan: GeneratedFlightPlan;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const NavLogTable: React.FC<NavLogTableProps> = ({ plan }) => {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-bold text-slate-900">Navigation log</span>
          <span className="text-xs text-slate-500">
            {plan.waypoints.length} waypoints · {plan.totalDistanceNm} NM · {plan.totalFlightTimeMin} min
          </span>
        </span>
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          {open ? 'Hide' : 'Show'}
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <>
          <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-semibold text-slate-500 tracking-wider font-mono">
                  <th className="py-2 px-3 w-10 text-center">#</th>
                  <th className="py-2 px-3 min-w-[240px]">Fix</th>
                  <th className="py-2 px-3 text-right">HDG (°M)</th>
                  <th className="py-2 px-3 text-right">Leg</th>
                  <th className="py-2 px-3">Altitude</th>
                  <th className="py-2 px-3">KIAS</th>
                  <th className="py-2 px-3 text-right">Leg time</th>
                  <th className="py-2 px-3 text-right">Elapsed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono text-slate-800">
                {plan.waypoints.map((wp, idx) => {
                  const isBase = idx === 0 || idx === plan.waypoints.length - 1;
                  const isIp = wp.type === 'IP';

                  return (
                    <tr
                      key={`${wp.id}-${idx}`}
                      className={`hover:bg-slate-50/80 transition-colors align-top ${
                        isBase ? 'bg-blue-50/30 font-semibold' : isIp ? 'bg-amber-50/30' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 text-center text-slate-400 text-[11px]">{idx + 1}</td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900 whitespace-nowrap">
                          <span>{wp.name}</span>
                          {wp.type === 'IP' && (
                            <span className="text-[9px] px-1 py-0.2 bg-amber-100 text-amber-800 rounded font-semibold uppercase">
                              IP
                            </span>
                          )}
                          {wp.type === 'TNG' && (
                            <span className="text-[9px] px-1 py-0.2 bg-amber-200 text-amber-900 rounded font-semibold uppercase">
                              T&G
                            </span>
                          )}
                        </div>
                        {wp.remarks && (
                          <div className="mt-0.5 font-sans text-[11px] font-normal text-slate-500 leading-snug max-w-md">
                            {wp.remarks}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                        {idx === 0 ? '—' : `${wp.bearingMagDeg.toString().padStart(3, '0')}°`}
                      </td>

                      <td className="py-2.5 px-3 text-right text-slate-700 whitespace-nowrap">
                        {idx === 0 ? '—' : `${wp.legDistNm} NM`}
                      </td>

                      <td className="py-2.5 px-3 text-slate-800 font-medium whitespace-nowrap">{wp.altDisplay}</td>

                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{wp.speedKts}</td>

                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {idx === 0 ? '—' : formatDuration(wp.legEteSeconds)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                        {formatDuration(wp.cumulativeTimeSeconds)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 font-mono">
            Magnetic variation {plan.operatingAirbase.magDecl || '0°'} · headings are magnetic
          </div>
        </>
      )}
    </div>
  );
};
