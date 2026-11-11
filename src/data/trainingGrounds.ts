import type { TrainingGroundInfo } from '../types/flightDesk';
import { calculateBearingDeg, calculateDistanceNm } from '../utils/geo';

/**
 * Training grounds and military training areas used as the target of range-strafing and
 * cargo-drop sorties. Positions are the approximate centre of each area (good to a few NM), not
 * official range coordinates: check the range boundaries, activity times and NOTAMs before using
 * one for anything but simulation.
 */
export const TRAINING_GROUNDS: TrainingGroundInfo[] = [
  // Poland
  { id: 'nowa-deba', name: 'Nowa Dęba', country: 'Poland', lat: 50.44, lon: 21.75, radiusNm: 6 },
  { id: 'drawsko', name: 'Drawsko Pomorskie', country: 'Poland', lat: 53.5, lon: 16.0, radiusNm: 10 },
  { id: 'wedrzyn', name: 'Wędrzyn', country: 'Poland', lat: 52.42, lon: 15.0, radiusNm: 7 },
  { id: 'zagan', name: 'Żagań–Świętoszów', country: 'Poland', lat: 51.52, lon: 15.4, radiusNm: 12 },
  { id: 'bemowo-piskie', name: 'Bemowo Piskie', country: 'Poland', lat: 53.64, lon: 21.62, radiusNm: 8 },
  { id: 'orzysz', name: 'Orzysz', country: 'Poland', lat: 53.8, lon: 21.95, radiusNm: 6 },
  { id: 'biedrusko', name: 'Biedrusko', country: 'Poland', lat: 52.55, lon: 16.92, radiusNm: 5 },
  // Germany
  { id: 'grafenwoehr', name: 'Grafenwöhr', country: 'Germany', lat: 49.7, lon: 11.93, radiusNm: 8 },
  { id: 'hohenfels', name: 'Hohenfels', country: 'Germany', lat: 49.22, lon: 11.83, radiusNm: 6 },
  { id: 'bergen-hohne', name: 'Bergen-Hohne', country: 'Germany', lat: 52.8, lon: 9.9, radiusNm: 10 },
  { id: 'altmark', name: 'Altmark (Gardelegen)', country: 'Germany', lat: 52.5, lon: 11.35, radiusNm: 10 },
  { id: 'munster', name: 'Munster', country: 'Germany', lat: 52.97, lon: 10.1, radiusNm: 8 },
  { id: 'wildflecken', name: 'Wildflecken', country: 'Germany', lat: 50.36, lon: 9.93, radiusNm: 5 },
  { id: 'baumholder', name: 'Baumholder', country: 'Germany', lat: 49.65, lon: 7.3, radiusNm: 6 },
  { id: 'nordhorn', name: 'Nordhorn Range', country: 'Germany', lat: 52.45, lon: 7.2, radiusNm: 4 },
  // Czech Republic and Slovakia
  { id: 'libava', name: 'Libavá', country: 'Czech Republic', lat: 49.74, lon: 17.53, radiusNm: 10 },
  { id: 'boletice', name: 'Boletice', country: 'Czech Republic', lat: 48.88, lon: 14.19, radiusNm: 8 },
  { id: 'brdy', name: 'Brdy', country: 'Czech Republic', lat: 49.72, lon: 13.85, radiusNm: 10 },
  { id: 'hradiste', name: 'Hradiště (Doupov)', country: 'Czech Republic', lat: 50.22, lon: 13.12, radiusNm: 10 },
  { id: 'lest', name: 'Lešť', country: 'Slovakia', lat: 48.52, lon: 19.22, radiusNm: 7 },
  // United Kingdom, Spain, Italy
  { id: 'salisbury-plain', name: 'Salisbury Plain', country: 'United Kingdom', lat: 51.22, lon: -1.93, radiusNm: 10 },
  { id: 'otterburn', name: 'Otterburn', country: 'United Kingdom', lat: 55.27, lon: -2.15, radiusNm: 8 },
  { id: 'cape-wrath', name: 'Cape Wrath', country: 'United Kingdom', lat: 58.62, lon: -4.97, radiusNm: 5 },
  { id: 'bardenas', name: 'Bardenas Reales', country: 'Spain', lat: 42.17, lon: -1.5, radiusNm: 8 },
  { id: 'capo-teulada', name: 'Capo Teulada', country: 'Italy', lat: 38.9, lon: 8.63, radiusNm: 6 },
  { id: 'quirra', name: 'Salto di Quirra', country: 'Italy', lat: 39.6, lon: 9.5, radiusNm: 8 },
  // United States
  { id: 'nttr', name: 'Nevada Test and Training Range', country: 'United States', lat: 37.0, lon: -115.5, radiusNm: 25 },
  { id: 'fort-irwin', name: 'Fort Irwin (NTC)', country: 'United States', lat: 35.27, lon: -116.68, radiusNm: 15 },
  { id: 'white-sands', name: 'White Sands', country: 'United States', lat: 32.9, lon: -106.4, radiusNm: 20 },
  { id: 'uttr', name: 'Utah Test and Training Range', country: 'United States', lat: 40.4, lon: -113.7, radiusNm: 20 },
  { id: 'eglin', name: 'Eglin Range', country: 'United States', lat: 30.55, lon: -86.55, radiusNm: 12 },
];

/** Distance limits (NM) between the home airfield and the training ground. */
export const TRAINING_REACH = {
  fighter: { minNm: 35, maxNm: 300 },
  cargo: { minNm: 45, maxNm: 350 },
};

export type AircraftReach = keyof typeof TRAINING_REACH;

export interface TrainingGroundOption extends TrainingGroundInfo {
  distanceNm: number;
  bearingDeg: number;
}

/** All training grounds within reach of a home position, nearest first. */
export function trainingGroundsInReach(
  home: { lat: number; lon: number },
  aircraft: AircraftReach
): TrainingGroundOption[] {
  const { minNm, maxNm } = TRAINING_REACH[aircraft];
  return TRAINING_GROUNDS.map((g) => ({
    ...g,
    distanceNm: Math.round(calculateDistanceNm(home.lat, home.lon, g.lat, g.lon)),
    bearingDeg: Math.round(calculateBearingDeg(home.lat, home.lon, g.lat, g.lon)),
  }))
    .filter((g) => g.distanceNm >= minNm && g.distanceNm <= maxNm)
    .sort((a, b) => a.distanceNm - b.distanceNm);
}

export function findTrainingGround(id: string): TrainingGroundInfo | undefined {
  return TRAINING_GROUNDS.find((g) => g.id === id);
}
