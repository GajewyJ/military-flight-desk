export interface StoreFs {
  mkdirSync(path: string, options?: { recursive?: boolean }): unknown;
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string, encoding: 'utf8'): void;
  renameSync(from: string, to: string): void;
  unlinkSync(path: string): void;
  existsSync(path: string): boolean;
}

export interface StoreOptions {
  root: string;
  fs: StoreFs;
  path: { join: (...parts: string[]) => string };
}

export interface StoreItem {
  id: string;
  meta: Record<string, unknown>;
}

export interface Store {
  list(kind: string): StoreItem[];
  read(kind: string, id: string): unknown;
  write(kind: string, id: string, meta: Record<string, unknown>, data: unknown): void;
  remove(kind: string, id: string): void;
}

export function createStore(opts: StoreOptions): Store;
export const KINDS: Record<string, { max: number; maxBytes: number; autoPrune: boolean }>;
export const ID_PATTERN: RegExp;
