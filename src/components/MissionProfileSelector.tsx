import React from 'react';
import { AircraftClass, MissionProfile, MissionProfileInfo } from '../types/flightDesk';
import { IcaoAutocomplete } from './IcaoAutocomplete';
import { Mountain, Compass, Gauge, ShieldCheck, PlaneLanding } from 'lucide-react';

interface MissionProfileSelectorProps {
  value: MissionProfile;
  onChange: (profile: MissionProfile) => void;
  destinationIcao?: string;
  onDestinationChange?: (icao: string) => void;
  departureIcao?: string;
  aircraftClass?: AircraftClass;
}

export const MISSION_PROFILES: MissionProfileInfo[] = [
  {
    id: 'low_level_mtr',
    militaryName: 'LLTR (Low-Level Tactical Navigation Route)',
    shortCode: 'LLTR',
    headline: 'Low-Level Peacetime Military Training Route (MTR / VR)',
    description:
      'High-speed visual low-altitude navigation corridor through regional terrain. Sequential tactical checkpoints, dynamic obstacle clearance (broadcast masts and wind turbines), timing marks, and an overhead-break recovery at military airfields (straight-in at civil ones).',
    typicalAltitude: '≥1,500 ft above highest terrain per leg',
    airspeedRegime: '420 – 480 KIAS',
    trainingObjective: 'Terrain Masking, Visual Dead Reckoning, High-Speed Low-Altitude Navigation',
  },
  {
    id: 'lltr_tng',
    militaryName: 'LLTR + Touch & Go (Training Sortie)',
    shortCode: 'LLTR-TNG',
    headline: 'Low-Level Tactical Navigation with Intermediate Touch-and-Go',
    description:
      'High-speed low-level corridor navigation to an intermediate airfield for a runway lineup, tactical approach, and touch-and-go, followed by a low-level return corridor to home base.',
    typicalAltitude: '≥1,500 ft above highest terrain per leg',
    airspeedRegime: '420 – 480 KIAS',
    trainingObjective: 'Low-level navigation plus touch-and-go at a second airfield',
  },
];

/** Cargo aircraft profiles: the same two sortie types as fighters, flown with airlift rules. */
export const CARGO_PROFILES: MissionProfileInfo[] = [
  {
    id: 'low_level_mtr',
    militaryName: 'LLTR (Tactical Airlift Low-Level Route)',
    shortCode: 'LLTR',
    headline: 'Low-Level Peacetime Airlift Training Route (MTR / VR)',
    description:
      'Visual low-level navigation corridor for tactical airlifters: longer legs, gentle bends, a wide turnaround, and a stabilized straight-in or wide visual pattern recovery.',
    typicalAltitude: '≥1,500 ft above highest terrain per leg',
    airspeedRegime: '230 – 250 KIAS',
    trainingObjective: 'Low-Level Navigation, Terrain Masking, Airlift Approach Discipline',
  },
  {
    id: 'lltr_tng',
    militaryName: 'LLTR + Touch & Go (Airlift Training Sortie)',
    shortCode: 'LLTR-TNG',
    headline: 'Low-Level Airlift Navigation with Intermediate Touch-and-Go',
    description:
      'Gentle low-level corridor to a second airfield with a long runway (at least 5,000 ft, 40 NM or more away) for a straight-in or wide visual pattern, a touch-and-go with takeoff flaps and no reverse thrust, and an offset low-level return to home.',
    typicalAltitude: '≥1,500 ft above highest terrain per leg',
    airspeedRegime: '230 – 250 KIAS',
    trainingObjective: 'Low-level navigation plus airlift touch-and-go technique at a second airfield',
  },
];

export function getMissionProfiles(aircraftClass: AircraftClass = 'fighter_jet'): MissionProfileInfo[] {
  return aircraftClass === 'cargo' ? CARGO_PROFILES : MISSION_PROFILES;
}

export const MissionProfileSelector: React.FC<MissionProfileSelectorProps> = ({
  value,
  onChange,
  destinationIcao,
  onDestinationChange,
  departureIcao,
  aircraftClass = 'fighter_jet',
}) => {
  const profiles = getMissionProfiles(aircraftClass);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold tracking-wider text-slate-700 uppercase flex items-center gap-1.5">
          <span>Mission Profile</span>
        </label>
        <span className="text-[11px] text-slate-500 font-medium">VFR Peacetime Sortie</span>
      </div>

      {/* Selectable Cards: one per MISSION_PROFILES entry */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {profiles.map((profile) => {
          const isSelected = value === profile.id;
          const isTngProfile = profile.id === 'lltr_tng';

          return (
            <button
              key={profile.id}
              type="button"
              onClick={() => onChange(profile.id)}
              className={`p-4 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                isSelected
                  ? 'bg-slate-900 border-slate-900 text-white shadow-xs ring-1 ring-slate-900'
                  : 'bg-white border-slate-200 text-slate-800 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div>
                <div className="flex items-center justify-between w-full mb-1.5">
                  <span className="font-bold text-sm tracking-wide flex items-center gap-2">
                    {isTngProfile ? (
                      <PlaneLanding className={`w-4 h-4 shrink-0 ${isSelected ? 'text-amber-400' : 'text-slate-600'}`} />
                    ) : (
                      <Mountain className={`w-4 h-4 shrink-0 ${isSelected ? 'text-amber-400' : 'text-slate-600'}`} />
                    )}
                    <span>{profile.militaryName}</span>
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider font-mono flex items-center gap-1 ${
                      isSelected
                        ? 'bg-amber-400/20 text-amber-300 border border-amber-400/30'
                        : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}
                  >
                    {isSelected && <ShieldCheck className="w-3 h-3 text-amber-400" />}
                    {isSelected ? 'ACTIVE PROFILE' : 'SELECT'}
                  </span>
                </div>

                <p className={`font-semibold text-xs mb-1 ${isSelected ? 'text-white' : 'text-slate-900'}`}>
                  {profile.headline}
                </p>

                <p className={`text-xs mb-3 leading-relaxed ${isSelected ? 'text-slate-300' : 'text-slate-600'}`}>
                  {profile.description}
                </p>
              </div>

              <div
                className={`pt-2.5 border-t grid grid-cols-1 gap-1.5 text-[11px] font-mono ${
                  isSelected ? 'border-slate-800 text-slate-300' : 'border-slate-200 text-slate-600'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <Compass className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-sky-400' : 'text-sky-600'}`} />
                  <span>Floor: {profile.typicalAltitude}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Gauge className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-emerald-400' : 'text-emerald-600'}`} />
                  <span>Speed: {profile.airspeedRegime}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* When lltr_tng is selected, show manual Touch & Go ICAO input */}
      {value === 'lltr_tng' && (
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-2 mt-1">
          <IcaoAutocomplete
            label="Touch & Go Airfield ICAO"
            sublabel="Intermediate training airfield (governs sortie distance)"
            value={destinationIcao || ''}
            onChange={(icao) => onDestinationChange?.(icao)}
            placeholder="Enter 4-letter ICAO (e.g. EPKS, KEDW, EGXC)"
            isDestination
            departureIcao={departureIcao}
            required
          />
        </div>
      )}
    </div>
  );
};
