/**
 * Rebuilds public/airports.json and public/runways.json from OurAirports (public domain).
 *
 *   npm install --save-dev geomagnetism   (once; used for magnetic declination, NOAA World Magnetic Model)
 *   npm run data:airports                 (downloads the CSV files from OurAirports)
 *   npm run data:airports -- --dir ./csv  (use CSV files you downloaded yourself)
 *
 * The CSV files are airports.csv, runways.csv and airport-frequencies.csv from https://ourairports.com/data/
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildAirports, buildRunways, keepRunwaysFor, parseCsv } from './ourairports';

const BASE_URL = 'https://davidmegginson.github.io/ourairports-data/';
const FILES = ['airports.csv', 'runways.csv', 'airport-frequencies.csv'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function loadCsv(dir: string | undefined, file: string): Promise<string> {
  if (dir) {
    const p = join(resolve(dir), file);
    if (!existsSync(p)) throw new Error(`Missing ${p}`);
    return readFile(p, 'utf8');
  }
  console.log(`Downloading ${BASE_URL}${file} ...`);
  const res = await fetch(BASE_URL + file);
  if (!res.ok) throw new Error(`Download of ${file} failed: HTTP ${res.status}`);
  return res.text();
}

function loadDeclinationModel(): (lat: number, lon: number) => number | undefined {
  const require = createRequire(import.meta.url);
  let geomagnetism: any;
  try {
    geomagnetism = require('geomagnetism');
  } catch {
    console.error('The "geomagnetism" package is not installed. Run:  npm install --save-dev geomagnetism');
    process.exit(1);
  }
  let model: any;
  try {
    model = geomagnetism.model(new Date(), { allowOutOfBoundsModel: true });
  } catch {
    model = geomagnetism.model(new Date('2025-01-01'));
  }
  return (lat, lon) => {
    try {
      const d = model.point([lat, lon]).decl;
      return Number.isFinite(d) ? d : undefined;
    } catch {
      return undefined;
    }
  };
}

async function main() {
  const dir = arg('dir');
  const outDir = resolve(arg('out') ?? 'public');
  const declination = loadDeclinationModel();

  const [airportsCsv, runwaysCsv, freqCsv] = await Promise.all(FILES.map((f) => loadCsv(dir, f)));
  const allRunways = buildRunways(parseCsv(runwaysCsv));
  const airports = buildAirports(parseCsv(airportsCsv), allRunways, parseCsv(freqCsv), declination);
  const runways = keepRunwaysFor(allRunways, airports);

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'airports.json'), JSON.stringify(airports));
  await writeFile(join(outDir, 'runways.json'), JSON.stringify(runways));

  const withRunways = airports.filter((a) => (runways[a.ident]?.length ?? 0) > 0).length;
  console.log(`airports.json: ${airports.length} airports (${withRunways} with runway data)`);
  console.log(`runways.json:  ${Object.keys(runways).length} airports with runways`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
