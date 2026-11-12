import type { TrainingGroundInfo } from '../types/flightDesk';
import { calculateBearingDeg, calculateDistanceNm } from '../utils/geo';

/**
 * Training grounds and military training areas used as the target of range-strafing and
 * cargo-drop sorties. Each position is a point inside the training area (about its middle), good
 * to a few NM, and `radiusNm` is the rough size of the area. This is not an official range
 * database: check the range boundaries, activity times and NOTAMs before using one for anything
 * but simulation. To fix or add one, edit a line here.
 *
 * Checked against published coordinates: Drawsko (Oleszno HQ 53.48N 15.73E, Jaworze strip
 * 53.31N 15.71E), Wędrzyn (barracks 52.43N 15.20E), Orzysz / Bemowo Piskie (Rostki strip
 * 53.71N 21.91E, Orzysz 53.80N 21.94E), Grafenwöhr and Hohenfels (their army airfields).
 */
export const TRAINING_GROUNDS: TrainingGroundInfo[] = [
  // Poland
  { id: 'drawsko', name: 'Drawsko Pomorskie', country: 'Poland', lat: 53.42, lon: 15.72, radiusNm: 9 },
  { id: 'wedrzyn', name: 'Wędrzyn', country: 'Poland', lat: 52.43, lon: 15.18, radiusNm: 7 },
  { id: 'zagan', name: 'Żagań–Świętoszów', country: 'Poland', lat: 51.45, lon: 15.5, radiusNm: 12 },
  { id: 'orzysz', name: 'Orzysz / Bemowo Piskie', country: 'Poland', lat: 53.7, lon: 21.97, radiusNm: 9 },
  { id: 'biedrusko', name: 'Biedrusko', country: 'Poland', lat: 52.55, lon: 16.95, radiusNm: 5 },
  { id: 'nowa-deba', name: 'Nowa Dęba', country: 'Poland', lat: 50.44, lon: 21.74, radiusNm: 6 },
  // Germany and Austria
  { id: 'grafenwoehr', name: 'Grafenwöhr', country: 'Germany', lat: 49.73, lon: 11.95, radiusNm: 9 },
  { id: 'hohenfels', name: 'Hohenfels', country: 'Germany', lat: 49.2, lon: 11.88, radiusNm: 7 },
  { id: 'bergen-hohne', name: 'Bergen-Hohne', country: 'Germany', lat: 52.76, lon: 9.9, radiusNm: 10 },
  { id: 'altmark', name: 'Altmark (Letzlinger Heide)', country: 'Germany', lat: 52.42, lon: 11.5, radiusNm: 10 },
  { id: 'munster', name: 'Munster', country: 'Germany', lat: 52.95, lon: 10.0, radiusNm: 8 },
  { id: 'wildflecken', name: 'Wildflecken', country: 'Germany', lat: 50.35, lon: 9.95, radiusNm: 5 },
  { id: 'baumholder', name: 'Baumholder', country: 'Germany', lat: 49.63, lon: 7.28, radiusNm: 6 },
  { id: 'allentsteig', name: 'Allentsteig', country: 'Austria', lat: 48.66, lon: 15.37, radiusNm: 8 },
  // Czech Republic and Slovakia
  { id: 'libava', name: 'Libavá', country: 'Czech Republic', lat: 49.74, lon: 17.53, radiusNm: 10 },
  { id: 'boletice', name: 'Boletice', country: 'Czech Republic', lat: 48.86, lon: 14.2, radiusNm: 8 },
  { id: 'hradiste', name: 'Hradiště (Doupov)', country: 'Czech Republic', lat: 50.22, lon: 13.12, radiusNm: 10 },
  { id: 'lest', name: 'Lešť', country: 'Slovakia', lat: 48.52, lon: 19.22, radiusNm: 7 },
  // United Kingdom
  { id: 'salisbury-plain', name: 'Salisbury Plain', country: 'United Kingdom', lat: 51.21, lon: -1.95, radiusNm: 10 },
  { id: 'otterburn', name: 'Otterburn', country: 'United Kingdom', lat: 55.29, lon: -2.25, radiusNm: 8 },
  { id: 'spadeadam', name: 'Spadeadam', country: 'United Kingdom', lat: 55.05, lon: -2.62, radiusNm: 5 },
  { id: 'cape-wrath', name: 'Cape Wrath', country: 'United Kingdom', lat: 58.63, lon: -4.98, radiusNm: 5 },
  { id: 'tain', name: 'Tain Range', country: 'United Kingdom', lat: 57.83, lon: -3.99, radiusNm: 4 },
  { id: 'holbeach', name: 'Holbeach Range', country: 'United Kingdom', lat: 52.88, lon: 0.25, radiusNm: 3 },
  { id: 'donna-nook', name: 'Donna Nook', country: 'United Kingdom', lat: 53.47, lon: 0.15, radiusNm: 3 },
  { id: 'pembrey', name: 'Pembrey Sands', country: 'United Kingdom', lat: 51.72, lon: -4.31, radiusNm: 3 },
  // Rest of Europe
  { id: 'vliehors', name: 'Vliehors Range', country: 'Netherlands', lat: 53.25, lon: 4.95, radiusNm: 4 },
  { id: 'oksbol', name: 'Oksbøl Range', country: 'Denmark', lat: 55.6, lon: 8.28, radiusNm: 6 },
  { id: 'adazi', name: 'Ādaži', country: 'Latvia', lat: 57.1, lon: 24.4, radiusNm: 6 },
  { id: 'tapa', name: 'Tapa', country: 'Estonia', lat: 59.25, lon: 25.95, radiusNm: 6 },
  { id: 'captieux', name: 'Captieux Range', country: 'France', lat: 44.3, lon: -0.25, radiusNm: 6 },
  { id: 'canjuers', name: 'Canjuers', country: 'France', lat: 43.7, lon: 6.43, radiusNm: 10 },
  { id: 'suippes', name: 'Suippes', country: 'France', lat: 49.15, lon: 4.55, radiusNm: 8 },
  { id: 'bardenas', name: 'Bardenas Reales', country: 'Spain', lat: 42.18, lon: -1.5, radiusNm: 8 },
  { id: 'capo-teulada', name: 'Capo Teulada', country: 'Italy', lat: 38.92, lon: 8.68, radiusNm: 6 },
  { id: 'quirra', name: 'Salto di Quirra', country: 'Italy', lat: 39.62, lon: 9.5, radiusNm: 8 },
  { id: 'capo-frasca', name: 'Capo Frasca', country: 'Italy', lat: 39.75, lon: 8.45, radiusNm: 4 },
  { id: 'capu-midia', name: 'Capu Midia', country: 'Romania', lat: 44.35, lon: 28.65, radiusNm: 5 },
  // Asia and Australia
  { id: 'pokhran', name: 'Pokhran', country: 'India', lat: 27.07, lon: 71.73, radiusNm: 15 },
  { id: 'delamere', name: 'Delamere Range', country: 'Australia', lat: -15.75, lon: 131.9, radiusNm: 15 },
  { id: 'shoalwater-bay', name: 'Shoalwater Bay', country: 'Australia', lat: -22.5, lon: 150.4, radiusNm: 25 },
  { id: 'evans-head', name: 'Evans Head Range', country: 'Australia', lat: -29.15, lon: 153.4, radiusNm: 6 },
  // Canada
  { id: 'cold-lake', name: 'Cold Lake Air Weapons Range', country: 'Canada', lat: 54.65, lon: -110.1, radiusNm: 25 },
  { id: 'suffield', name: 'Suffield', country: 'Canada', lat: 50.4, lon: -111.1, radiusNm: 20 },
  { id: 'wainwright', name: 'Wainwright', country: 'Canada', lat: 52.8, lon: -110.8, radiusNm: 15 },
  { id: 'gagetown', name: 'Gagetown', country: 'Canada', lat: 45.6, lon: -66.5, radiusNm: 15 },
  // United States
  { id: 'nttr', name: 'Nevada Test and Training Range', country: 'United States', lat: 37.35, lon: -115.75, radiusNm: 30 },
  { id: 'fort-irwin', name: 'Fort Irwin (NTC)', country: 'United States', lat: 35.28, lon: -116.63, radiusNm: 18 },
  { id: 'white-sands', name: 'White Sands', country: 'United States', lat: 32.95, lon: -106.4, radiusNm: 25 },
  { id: 'uttr', name: 'Utah Test and Training Range', country: 'United States', lat: 40.35, lon: -113.55, radiusNm: 25 },
  { id: 'eglin', name: 'Eglin Range', country: 'United States', lat: 30.65, lon: -86.55, radiusNm: 12 },
  { id: 'fort-hood', name: 'Fort Hood', country: 'United States', lat: 31.2, lon: -97.85, radiusNm: 15 },
  { id: 'pohakuloa', name: 'Pohakuloa', country: 'United States', lat: 19.75, lon: -155.55, radiusNm: 10 },
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
