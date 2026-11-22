export interface SimSample {
  lat: number;
  lon: number;
  altMslFt: number;
  aglFt: number;
  headingTrueDeg: number;
  groundSpeedKts: number;
  iasKts: number;
  vsFpm: number;
  onGround: boolean;
  t: number;
}

export type SimLinkState = 'off' | 'waiting' | 'connected' | 'unavailable';

export interface SimLinkOptions {
  loadLib: () => Promise<any>;
  emit: (channel: string, payload: unknown) => void;
  retryMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => any;
  clearTimer?: (id: any) => void;
  log?: (msg: string, err?: unknown) => void;
}

export interface SimLink {
  setEnabled(on: boolean): SimLinkState;
  getStatus(): { status: SimLinkState; detail: string };
  dispose(): void;
}

export function createSimLink(opts: SimLinkOptions): SimLink;
export const VARIABLES: ReadonlyArray<readonly [string, string]>;
export function toSample(values: number[], now: () => number): SimSample | null;
