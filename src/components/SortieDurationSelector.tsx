import React from 'react';
import { SortieDuration } from '../types/flightDesk';
import { Block, Segmented } from './ui';
import { useUnits } from '../hooks/useUnits';

interface SortieDurationSelectorProps {
  value: SortieDuration;
  onChange: (duration: SortieDuration) => void;
  disabled?: boolean;
  calculatedDistanceNm?: number;
  calculatedTimeMin?: number;
  /** 'strafe' or 'drop': the length sets the number of passes at the training ground. */
  passesMode?: 'strafe' | 'drop';
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

const PASS_DURATIONS: Record<'strafe' | 'drop', typeof DURATIONS> = {
  strafe: [
    { id: 'short', label: 'Short', timeEstimate: '2 passes', distanceEstimate: 'plus transit', description: 'One dry pass and one live pass' },
    { id: 'medium', label: 'Medium', timeEstimate: '3 passes', distanceEstimate: 'plus transit', description: 'One dry pass and two live passes' },
    { id: 'long', label: 'Long', timeEstimate: '4 passes', distanceEstimate: 'plus transit', description: 'One dry pass and three live passes' },
  ],
  drop: [
    { id: 'short', label: 'Short', timeEstimate: '1 pass', distanceEstimate: 'plus transit', description: 'A single drop pass' },
    { id: 'medium', label: 'Medium', timeEstimate: '2 passes', distanceEstimate: 'plus transit', description: 'A dry pass, then the drop' },
    { id: 'long', label: 'Long', timeEstimate: '3 passes', distanceEstimate: 'plus transit', description: 'A dry pass and two drops' },
  ],
};

export const SortieDurationSelector: React.FC<SortieDurationSelectorProps> = ({
  value,
  onChange,
  disabled = false,
  calculatedDistanceNm,
  calculatedTimeMin,
  passesMode,
}) => {
  const U = useUnits();
  const durations = passesMode ? PASS_DURATIONS[passesMode] : DURATIONS;
  const selected = durations.find((d) => d.id === value) ?? durations[0];

  return (
    <Block
      label={passesMode ? 'Number of passes' : 'Sortie length'}
      hint={disabled ? 'set by the Touch & Go field' : undefined}
    >
      <Segmented<SortieDuration>
        ariaLabel="Sortie length"
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={durations.map((d) => ({
          id: d.id,
          label: d.label,
          sub: d.timeEstimate,
        }))}
      />
      {disabled ? (
        <p className="mt-1.5 font-mono text-[11px] text-ink-2">
          Distance follows from the two airfields
          {calculatedDistanceNm ? `: ${U.dist(calculatedDistanceNm, 0)}, about ${calculatedTimeMin} min.` : '.'}
        </p>
      ) : (
        <p className="mt-1.5 font-mono text-[11px] text-ink-2">
          {passesMode ? `${selected.description}, plus the transit.` : `${U.text(selected.distanceEstimate)}. ${selected.description}.`}
        </p>
      )}
    </Block>
  );
};
