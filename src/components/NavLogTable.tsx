import React from 'react';
import { GeneratedFlightPlan } from '../types/flightDesk';
import { downloadLittleNavmapFile } from '../utils/littleNavmapExporter';
import { downloadMsfsPlnFile } from '../utils/msfsExporter';
import { downloadKneeboardPdf } from '../utils/kneeboardPdfExporter';
import { ListOrdered, Download, FileText } from 'lucide-react';

interface NavLogTableProps {
  plan: GeneratedFlightPlan;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export const NavLogTable: React.FC<NavLogTableProps> = ({ plan }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs flex flex-col">
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListOrdered className="w-4 h-4 text-slate-700" />
          <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Operational Navigation Log (NavLog)
          </h2>
          <span className="text-[11px] font-mono text-slate-400 hidden sm:inline ml-1">
            • Mag Var: {plan.operatingAirbase.magDecl || '0°'}
          </span>
        </div>

        {/* Export Buttons cleanly aligned on the right */}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <button
            type="button"
            onClick={() => downloadMsfsPlnFile(plan)}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer shadow-xs"
            title="Download MSFS 2020 / 2024 flight plan (.pln)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export MSFS (.pln)</span>
          </button>

          <button
            type="button"
            onClick={() => downloadLittleNavmapFile(plan)}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 text-slate-200 hover:text-white rounded text-[11px] font-semibold border border-slate-700 transition-colors cursor-pointer shadow-xs"
            title="Download Little Navmap flight plan (.lnmpln)"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .lnmpln</span>
          </button>

          <button
            type="button"
            onClick={() => downloadKneeboardPdf(plan)}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded text-[11px] font-semibold transition-colors cursor-pointer shadow-xs"
            title="Export official military pilot thigh Kneeboard PDF (.pdf)"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Kneeboard (.pdf)</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] uppercase font-semibold text-slate-600 tracking-wider font-mono">
              <th className="py-2.5 px-3 w-10 text-center">#</th>
              <th className="py-2.5 px-3">Fix / Waypoint</th>
              <th className="py-2.5 px-3 text-right">HDG (°M)</th>
              <th className="py-2.5 px-3 text-right">Leg Dist</th>
              <th className="py-2.5 px-3 text-right">Total Dist</th>
              <th className="py-2.5 px-3">Altitude</th>
              <th className="py-2.5 px-3">Speed (KIAS)</th>
              <th className="py-2.5 px-3 text-right">Leg ETE</th>
              <th className="py-2.5 px-3 text-right">Cum Time</th>
              <th className="py-2.5 px-4 min-w-[220px]">Tactical Action / Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono text-slate-800">
            {plan.waypoints.map((wp, idx) => {
              const isBase = idx === 0 || idx === plan.waypoints.length - 1;
              const isIp = wp.type === 'IP';
              const isOrbit = wp.type.includes('ORBIT');

              return (
                <tr
                  key={`${wp.id}-${idx}`}
                  className={`hover:bg-slate-50/80 transition-colors ${
                    isBase
                      ? 'bg-blue-50/30 font-semibold'
                      : isIp
                      ? 'bg-amber-50/30'
                      : isOrbit
                      ? 'bg-cyan-50/20'
                      : ''
                  }`}
                >
                  <td className="py-2.5 px-3 text-center text-slate-400 text-[11px]">
                    {idx + 1}
                  </td>

                  <td className="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-1.5 whitespace-nowrap">
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
                    {isOrbit && (
                      <span className="text-[9px] px-1 py-0.2 bg-cyan-100 text-cyan-800 rounded font-semibold uppercase">
                        Orbit
                      </span>
                    )}
                    {wp.type === 'DESCENT' && (
                      <span className="text-[9px] px-1 py-0.2 bg-blue-100 text-blue-800 rounded font-semibold uppercase">
                        Descent
                      </span>
                    )}
                  </td>

                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                    {idx === 0 ? '—' : `${wp.bearingMagDeg.toString().padStart(3, '0')}°`}
                  </td>

                  <td className="py-2.5 px-3 text-right text-slate-700">
                    {idx === 0 ? '—' : `${wp.legDistNm} NM`}
                  </td>

                  <td className="py-2.5 px-3 text-right font-medium text-slate-900">
                    {wp.cumulativeDistNm} NM
                  </td>

                  <td className="py-2.5 px-3 text-slate-800 font-medium whitespace-nowrap">
                    {wp.altDisplay}
                  </td>

                  <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                    {wp.speedKts} kts <span className="text-slate-400 text-[10px]">(M{wp.mach})</span>
                  </td>

                  <td className="py-2.5 px-3 text-right text-slate-600">
                    {idx === 0 ? '—' : formatDuration(wp.legEteSeconds)}
                  </td>

                  <td className="py-2.5 px-3 text-right font-semibold text-slate-900">
                    {formatDuration(wp.cumulativeTimeSeconds)}
                  </td>

                  <td className="py-2.5 px-4 font-sans text-[11px] text-slate-600 leading-snug">
                    {wp.remarks}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="p-3 bg-slate-50/60 border-t border-slate-200 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {plan.isPointToPoint && plan.destinationAirbase ? (
            <span>
              Deployment: <strong className="text-slate-800 font-mono">{plan.operatingAirbase.ident} ➔ {plan.destinationAirbase.ident}</strong>
            </span>
          ) : (
            <span>Base: <strong className="text-slate-800 font-mono">{plan.operatingAirbase.ident}</strong></span>
          )}
          <span>·</span>
          <span>Total Distance: <strong className="text-slate-800 font-mono">{plan.totalDistanceNm} NM</strong></span>
          <span>·</span>
          <span>Flight Time: <strong className="text-slate-800 font-mono">{plan.totalFlightTimeMin} MIN</strong></span>
        </div>
        <div className="font-mono text-slate-400">
          Generated in-app · Little Navmap schema ready
        </div>
      </div>
    </div>
  );
};
