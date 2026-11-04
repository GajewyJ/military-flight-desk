import { CARGO_PROFILE } from './cargoRoute';

/**
 * Structured error messages shown in the error dialog.
 * Every message says what is wrong and what the user can do about it.
 */
export interface AppErrorInfo {
  title: string;
  message: string;
  /** Short, concrete things to try. */
  hints?: string[];
  /** Raw technical message (for unexpected failures only). */
  detail?: string;
}

export type AirfieldRole = 'departure' | 'destination' | 'touchAndGo';

const ROLE_LABEL: Record<AirfieldRole, string> = {
  departure: 'departure airfield',
  destination: 'destination airfield',
  touchAndGo: 'Touch & Go airfield',
};

export function unknownAirportError(icao: string, dbReady: boolean): AppErrorInfo {
  if (!dbReady) {
    return {
      title: 'Airport database is loading',
      message: 'The airport database has not finished loading yet.',
      hints: ['Wait a moment and click Generate again.'],
    };
  }
  return {
    title: 'Airfield not found',
    message: `Airfield ${icao || '(empty)'} was not found in the airport database.`,
    hints: [
      'Check the 4-letter ICAO code (for example EPLK, EPKS or EGXC).',
      'Pick an airfield from the suggestions that appear while you type.',
    ],
  };
}

export function invalidIcaoError(role: AirfieldRole): AppErrorInfo {
  return {
    title: 'Missing airfield code',
    message: `The ${ROLE_LABEL[role]} needs a 4-letter ICAO code.`,
    hints: ['Enter a code such as EPLK, KLSV or EGXC, or choose one from the suggestions.'],
  };
}

export function sameAirfieldError(role: 'destination' | 'touchAndGo'): AppErrorInfo {
  return {
    title: 'Same airfield selected',
    message: `The ${ROLE_LABEL[role]} must be different from the departure airfield.`,
    hints: ['Change one of the two ICAO codes.'],
  };
}

export function generationError(err: unknown, destinationIcao: string): AppErrorInfo {
  if (err instanceof Error && err.message === 'CARGO_TNG_TOO_CLOSE') {
    const dest = destinationIcao.trim().toUpperCase();
    const minNm = CARGO_PROFILE.minTngDistanceNm;
    return {
      title: 'Touch & Go airfield too close for cargo',
      message: `${dest || 'The Touch & Go airfield'} is closer than ${minNm} NM to the departure airfield. A cargo aircraft needs room for gentle turns, a long final and a wide pattern.`,
      hints: [
        `Choose a Touch & Go airfield at least ${minNm} NM away (about 45 NM or more gives the gentlest route).`,
        'Switch the aircraft to Fighter Jet to use a closer airfield (fighters can use fields 12 NM or more away).',
      ],
    };
  }
  if (err instanceof Error && err.message === 'CARGO_TNG_RUNWAY_TOO_SHORT') {
    const dest = destinationIcao.trim().toUpperCase();
    const minFt = CARGO_PROFILE.minTngRunwayFt.toLocaleString('en-US');
    return {
      title: 'Runway too short for cargo',
      message: `${dest || 'The Touch & Go airfield'} has a longest runway under ${minFt} ft, which is too short for a cargo touch-and-go.`,
      hints: [
        `Choose a Touch & Go airfield with a runway of at least ${minFt} ft.`,
        'Switch the aircraft to Fighter Jet if you want to use this airfield.',
      ],
    };
  }
  if (err instanceof Error && err.message === 'TNG_ROUTE_INVALID') {
    const dest = destinationIcao.trim().toUpperCase();
    return {
      title: 'No valid route found',
      message: `Could not build a valid Touch & Go route to ${dest || 'the selected airfield'}.`,
      hints: [
        'Choose a Touch & Go airfield farther from the departure airfield: at least 12 NM for a fighter, 40 NM for cargo. Closer fields only allow a compact route, and with some runway directions no route fits.',
        'Try a different Touch & Go airfield.',
        'If the wind changes, another runway may become active and make the route possible.',
      ],
    };
  }
  return {
    title: 'Plan generation failed',
    message: 'Something went wrong while building the flight plan.',
    hints: ['Check both ICAO codes and try again.', 'If it keeps happening, reload the app.'],
    detail: err instanceof Error ? err.message : undefined,
  };
}
