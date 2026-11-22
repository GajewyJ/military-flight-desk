export interface SaveDialogResult {
  success?: boolean;
  canceled?: boolean;
  filePath?: string;
  filename?: string;
  error?: string;
}

/** One reading of the user's aircraft from the simulator (see electron/simLink.cjs). */
export interface SimSample {
  lat: number;
  lon: number;
  /** Altitude above mean sea level (ft). */
  altMslFt: number;
  /** Height above the ground (ft), the radar altitude. */
  aglFt: number;
  headingTrueDeg: number;
  groundSpeedKts: number;
  iasKts: number;
  vsFpm: number;
  onGround: boolean;
  /** Time of the reading (ms since 1970). */
  t: number;
}

/** off: switched off; waiting: switched on, the simulator is not running yet; unavailable: not part of this build. */
export type SimLinkState = 'off' | 'waiting' | 'connected' | 'unavailable';

export interface SimLinkStatus {
  status: SimLinkState;
  detail: string;
}

export interface SimLinkAPI {
  setEnabled: (on: boolean) => Promise<SimLinkStatus>;
  getStatus: () => Promise<SimLinkStatus>;
  /** Returns a function that stops listening. */
  onSample: (callback: (sample: SimSample) => void) => () => void;
  onStatus: (callback: (status: SimLinkStatus) => void) => () => void;
}

export interface ElectronSimAPI {
  isElectron: boolean;
  saveFileDialog: (
    defaultFilename: string,
    content: string,
    extension?: string,
    filterName?: string
  ) => Promise<SaveDialogResult>;
  savePdfDialog: (
    defaultFilename: string,
    pdfBase64: string
  ) => Promise<SaveDialogResult>;
  showItemInFolder: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  /** Missing in builds without the live simulator link. */
  simLink?: SimLinkAPI;
}

declare global {
  interface Window {
    electronSim?: ElectronSimAPI;
  }
}
