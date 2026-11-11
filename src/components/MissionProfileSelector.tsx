import React from 'react';
import { AircraftClass, MissionProfile, MissionProfileInfo } from '../types/flightDesk';
import { IcaoAutocomplete } from './IcaoAutocomplete';
import { Mountain, Compass, Gauge, ShieldCheck, PlaneLanding, Crosshair, Package } from 'lucide-react';
import { TrainingGroundSelector } from './TrainingGroundSelector';

interface MissionProfileSelectorProps {
  value: MissionProfile;
  onChange: (profile: MissionProfile) => void;
  destinationIcao?: string;
  onDestinationChange?: (icao: string) => void;
  departureIcao?: string;
  aircraftClass?: AircraftClass;
  /** Training-ground choice for the range and drop profiles ('auto' or a ground id). */
  trainingGroundId?: string;
  onTrainingGroundChange?: (id: string) => void;
  homePosition?: { lat: number; lon: number };
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
  {
    id: 'range_strafe',
    militaryName: 'Range Training (Air-to-Ground Strafing)',
    shortCode: 'RANGE',
    headline: 'Low-Level Transit to a Training Ground and Strafing Passes',
    description:
      'Low-level transit to an initial point 10 NM from a training ground, then a racetrack pattern at 1,500 ft AGL: one dry pass and live gun passes (roll-in 1,800 ft AGL, 10-15° dive, pull-off no lower than 500 ft AGL), a perch and base turn between passes, then a climb and return to home.',
    typicalAltitude: 'Pattern 1,500 ft AGL, pull-off ≥ 500 ft AGL',
    airspeedRegime: '350 – 400 KIAS',
    trainingObjective: 'Pattern discipline, dive delivery and pull-off, range procedures',
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
  {
    id: 'cargo_drop',
    militaryName: 'Cargo Drop (Airdrop Training)',
    shortCode: 'DROP',
    headline: 'Low-Level Transit and Airdrop over a Training Ground',
    description:
      'Low-level transit to an IP 10 NM from a drop zone, then a run-in on the drop heading (into the wind when there is wind): slow to 210 KIAS, descend to 800 ft AGL at 130-150 KIAS, release at the computed air release point, then climb out. Longer sorties add a dry pass and a second drop.',
    typicalAltitude: 'Drop 800 ft AGL, pattern 1,500 ft AGL',
    airspeedRegime: '130 – 250 KIAS',
    trainingObjective: 'Run-in accuracy, drop speed and height discipline, wide racetrack re-entry',
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
  trainingGroundId = 'auto',
  onTrainingGroundChange,
  homePosition,
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
          const ProfileIcon =
            profile.id === 'range_strafe' ? Crosshair : profile.id === 'cargo_drop' ? Package : isTngProfile ? PlaneLanding : Mountain;

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
                    <ProfileIcon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-amber-400' : 'text-slate-600'}`} />
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

      {/* Range and drop profiles: choose the training ground */}
      {(value === 'range_strafe' || value === 'cargo_drop') && (
        <TrainingGroundSelector
          value={trainingGroundId}
          onChange={(id) => onTrainingGroundChange?.(id)}
          home={homePosition}
          aircraft={aircraftClass === 'cargo' ? 'cargo' : 'fighter'}
          targetWord={value === 'cargo_drop' ? 'drop zone' : 'range'}
        />
      )}

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
