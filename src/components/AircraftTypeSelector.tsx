import React from 'react';
import { AircraftClass } from '../types/flightDesk';
import { Block, Segmented } from './ui';

interface AircraftTypeSelectorProps {
  value: AircraftClass;
  onChange: (type: AircraftClass) => void;
}

const NOTES: Record<AircraftClass, string> = {
  fighter_jet: 'F-16C, F/A-18E, Typhoon, F-35A. 420-540 kt cruise.',
  cargo: 'C-130J, A400M, C-295, C-17A. 230-250 kt low level, gentle turns.',
};

export const AircraftTypeSelector: React.FC<AircraftTypeSelectorProps> = ({ value, onChange }) => (
  <Block label="Aircraft class">
    <Segmented<AircraftClass>
      ariaLabel="Aircraft class"
      value={value}
      onChange={onChange}
      options={[
        { id: 'fighter_jet', label: 'Fighter jet' },
        { id: 'cargo', label: 'Cargo' },
      ]}
    />
    <p className="mt-1.5 font-mono text-[11px] text-ink-2">{NOTES[value]}</p>
  </Block>
);
