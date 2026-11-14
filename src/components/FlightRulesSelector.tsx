import React from 'react';
import { FlightRules } from '../types/flightDesk';
import { Block, Segmented } from './ui';

interface FlightRulesSelectorProps {
  value: FlightRules;
  onChange: (rules: FlightRules) => void;
}

export const FlightRulesSelector: React.FC<FlightRulesSelectorProps> = ({ value, onChange }) => (
  <Block label="Flight rules" hint="VFR only for now">
    <Segmented<FlightRules>
      ariaLabel="Flight rules"
      value={value}
      onChange={onChange}
      options={[
        { id: 'VFR', label: 'VFR' },
        { id: 'IFR', label: 'IFR', disabled: true, title: 'IFR flight rules will be unlocked in a future update' },
      ]}
    />
  </Block>
);
