import React from 'react';
import { AircraftClass, MissionProfile, MissionProfileInfo } from '../types/flightDesk';
import { IcaoAutocomplete } from './IcaoAutocomplete';
import { TrainingGroundSelector } from './TrainingGroundSelector';
import { Block, DataRow } from './ui';
import { useUnits } from '../hooks/useUnits';

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
      'Visual low-level route with checkpoints and a floor that clears masts and wind turbines. Recovery: overhead break at a military field, straight-in at a civil one.',
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
      'Low-level route to a second airfield for an approach and a touch-and-go, then a low-level return. Straight-in at a civil field; straight-in or pattern join at a military field.',
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
      'Low-level transit to an IP 10 NM from the range, then racetrack passes: a dry pass first, then live gun passes. Roll-in 1,800 ft AGL, 10-15° dive, pull-off not below 500 ft AGL.',
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
      'Visual low-level route for tactical airlifters: longer legs, gentle bends, a wide turnaround, straight-in or wide visual pattern recovery.',
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
      'Gentle low-level route to a second airfield (runway 5,000 ft or more, 40 NM or more away) for a touch-and-go with takeoff flaps and no reverse thrust, then an offset return.',
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
      'Low-level transit to an IP 10 NM from the drop zone, then a run-in on the drop heading (into the wind): 210 KIAS at the IP, 800 ft AGL at 130-150 KIAS, release at the CARP. Longer sorties add a dry pass and more drops.',
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
  const selected = profiles.find((p) => p.id === value) ?? profiles[0];
  const U = useUnits();

  return (
    <div className="flex flex-col">
      <Block label="Mission" hint="VFR peacetime sortie">
        {/* One row per profile: a box with an X marks the chosen mission */}
        <div role="radiogroup" aria-label="Mission profile">
          {profiles.map((profile) => {
            const isSelected = value === profile.id;
            return (
              <button
                key={profile.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onChange(profile.id)}
                className={`w-full flex items-center gap-2 px-1 py-0.5 text-left cursor-pointer ${
                  isSelected ? 'bg-hilite' : 'hover:bg-inset'
                }`}
              >
                <span className="w-[15px] h-[15px] shrink-0 border-[1.5px] border-ink bg-inset flex items-center justify-center text-[13px] font-bold leading-none">
                  {isSelected ? 'X' : ''}
                </span>
                <span className="w-12 shrink-0 font-mono text-[12px] font-bold">{profile.shortCode}</span>
                <span className="min-w-0 font-semibold leading-tight">{profile.militaryName}</span>
              </button>
            );
          })}
        </div>

        {/* Data of the selected profile */}
        <p className="mt-1.5 text-[12px] leading-snug text-ink-2">{U.text(selected.description)}</p>
        <div className="mt-1.5">
          <DataRow label="Objective">{selected.trainingObjective}</DataRow>
          <DataRow label="Altitude">{U.text(selected.typicalAltitude)}</DataRow>
          <DataRow label="Speed">{U.text(selected.airspeedRegime)}</DataRow>
        </div>
      </Block>

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

      {/* Touch & Go: the second airfield */}
      {value === 'lltr_tng' && (
        <IcaoAutocomplete
          label="Touch & Go airfield"
          sublabel="second airfield, sets the distance"
          value={destinationIcao || ''}
          onChange={(icao) => onDestinationChange?.(icao)}
          placeholder="ICAO"
          isDestination
          departureIcao={departureIcao}
          required
        />
      )}
    </div>
  );
};
