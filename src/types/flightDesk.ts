export interface Airport {
  ident: string; // Ident (ICAO or Local Code, e.g. EPLK, KLSV, 00AA)
  icao: string; // Same as ident for search convenience
  name: string; // Name (e.g. 32nd Tactical Air Base, Nellis AFB, Aero B Ranch)
  city?: string; // City
  stateOrProvince?: string; // State or Province
  countryOrAreaCode?: string; // Country or Area Code
  rating?: string; // Rating (e.g. ★★★-+)
  elevationFt: number; // Elevation ft
  magDecl?: string; // Mag. Decl.° (e.g. 9.4° East, 3.9° West)
  towerMhz?: string; // Tower MHz
  largestRamp?: string; // Largest Ramp (e.g. Small, Medium, Large)
  largestGate?: string; // Largest Gate
  longestRunwayFt?: number; // Longest Runway Length ft
  runwayDesignator?: string; // Runway designators (e.g. 11/29)
  files?: string; // BGL Files (e.g. APX20180.bgl)
  longitude: number; // Longitude
  latitude: number; // Latitude
  military?: boolean;
}

export type FlightRules = 'VFR' | 'IFR';

export type AircraftClass = 'fighter_jet' | 'cargo';

export type MissionProfile = 'low_level_mtr' | 'lltr_tng';

export type SortieDuration = 'short' | 'medium' | 'long';

export type WaypointType =
  | 'DEP'
  | 'CLIMB'
  | 'MTR_ENTRY'
  | 'CHECKPOINT'
  | 'IP'
  | 'EGRESS'
  | 'RECOVERY'
  | 'TNG'
  | 'ARR';

export interface FlightWaypoint {
  id: string;
  name: string;
  type: WaypointType;
  lat: number;
  lon: number;
  altFt: number;
  altDisplay: string;
  speedKts: number;
  mach: string;
  bearingTrueDeg: number;
  bearingMagDeg: number;
  legDistNm: number;
  cumulativeDistNm: number;
  legEteSeconds: number;
  cumulativeTimeSeconds: number;
  remarks: string;
}

export type WeatherMode = 'live' | 'neutral';

export type ApproachRecoveryType = 'instrument' | 'tactical_overhead' | 'visual_pattern';

export interface AtisReport {
  icao: string;
  code: string; // Phonetic or letter, e.g. "J" or "BRAVO"
  frequency?: string; // e.g. "128.725"
  type?: 'ARR' | 'DEP' | 'COMBINED';
  source: 'FAA_DATIS' | 'VATSIM_ATIS';
  rawText: string;
  arrRunways: string[];
  depRunways: string[];
  updatedTime?: string;
}

export interface AirportWeather {
  icao: string;
  source: 'VATSIM_METAR' | 'NOAA_AWC' | 'OPEN_METEO' | 'STANDARD_ISA';
  rawMetar: string;
  reportTime?: string;
  tempC: number;
  dewpointC?: number;
  altimeterInHg: number;
  altimeterHpa: number;
  windDirDeg: number;
  windSpeedKts: number;
  windGustKts?: number;
  visibility?: string;
  flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
  activeRunway: string;
  activeRunwayHeadingDeg: number;
  activeRunwayTrueHeadingDeg: number;
  headwindKts: number;
  crosswindKts: number;
  isCalm: boolean;
  /** True when the airport has no usable runway data, so the active runway is an estimate. */
  runwayEstimated?: boolean;
  atis?: AtisReport;
  notes?: string;
}

export interface GeneratedFlightPlan {
  sortieId: string;
  callsign: string;
  flightRules: 'VFR';
  aircraftType: 'Fighter Jet' | 'Cargo';
  missionProfile: MissionProfile;
  recoveryType: ApproachRecoveryType;
  operatingAirbase: Airport;
  tngAirbase?: Airport;
  tngWeather?: AirportWeather;
  terrainSource?: 'DEM' | 'ESTIMATED';
  weatherMode: WeatherMode;
  departureWeather: AirportWeather;
  totalDistanceNm: number;
  totalFlightTimeMin: number;
  assignedAltitude: string;
  cruiseSpeedKts: number;
  squawk: string;
  tacFrequencyMhz: string;
  sectorHeadingDeg: number;
  sectorDescription: string;
  waypoints: FlightWaypoint[];
  generatedAt: string;
}

export interface MissionProfileInfo {
  id: MissionProfile;
  militaryName: string;
  shortCode: string;
  headline: string;
  description: string;
  typicalAltitude: string;
  airspeedRegime: string;
  trainingObjective: string;
}
