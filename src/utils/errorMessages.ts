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
  if (err instanceof Error && err.message === 'TNG_ROUTE_INVALID') {
    const dest = destinationIcao.trim().toUpperCase();
    return {
      title: 'No valid route found',
      message: `Could not build a valid Touch & Go route to ${dest || 'the selected airfield'}.`,
      hints: [
        'Click Generate again: every attempt is random, so a second try often works.',
        'Try another Touch & Go airfield, or a different wind so another runway is active.',
        'Fields that are very close together only allow a compact route.',
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
