# Military Flight Desk for MSFS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MSFS 2020/2024](https://img.shields.io/badge/Simulator-MSFS%202020%20%7C%202024-0284c7.svg)](#exports)
[![Platform: Windows | Web](https://img.shields.io/badge/Platform-Windows%20%7C%20Web-10b981.svg)](#quick-start)

A flight planner for peacetime military training sorties in **Microsoft Flight Simulator**. Pick a base and a mission, and it builds a complete VFR sortie: runway-aligned departure, a low-level route over real terrain, and a recovery to the field. You get a nav log, a briefing card, an interactive map, live weather, and files you can load into the sim.

**Flight simulation only. Not for real-world navigation or flight planning.**

## Quick start

### Windows app

1. Download the installer or the portable `.exe` from the **Releases** page.
2. Run it. No Node.js and no accounts are needed.

The app is not code-signed, so on first launch Windows SmartScreen may warn you. Click **More info**, then **Run anyway**.

**Updates:** the installed app checks GitHub for a newer release a few seconds after it starts, downloads it in the background, and asks before installing (**Restart now** or **Later**). The portable `.exe` does not update itself, so download new versions of it from the Releases page.

### From source

Needs Node.js 20.19 or newer.

```bash
npm install
npm run dev          # web app at http://localhost:3000
npm test             # unit tests (Vitest)
npm run lint         # TypeScript check
npm run build        # production web build
npm run data:airports  # rebuild the airport data from OurAirports (see Data and credits)
npm run electron:dist  # Windows desktop build (output in /release)
```

## How to use it

1. Choose the aircraft category and the mission profile.
2. Enter the departure airfield by its 4-letter ICAO code (for example `EPLK`). For Touch & Go, also enter the second airfield.
3. Click **Generate**. If something is wrong, a window tells you what and how to fix it.
4. Check the briefing, the map and the nav log. Click any waypoint on the map for its leg details.
5. Export the plan for your simulator or print the kneeboard.

## Aircraft and missions

| Category | Mission | What you get |
| :--- | :--- | :--- |
| Fighter jet | **LLTR** (low-level route) | Departure, a corridor of checkpoints with staggered doglegs, an initial point and egress, then an overhead-break recovery. Short, Medium or Long sortie. |
| Fighter jet | **LLTR + Touch & Go** | A low-level route to a second airfield (any distance), a touch-and-go, and a return on an offset track. Straight-in or downwind join, so the aircraft never overflies the field and reverses. |
| Cargo | **LLTR** | The same idea tuned for airlifters (C-130J, A400M, C-295, C-17A): 250 KIAS at low level, longer legs, gentle bends, and a turn-limited recovery with a straight-in or a wide visual pattern. |
| Cargo | **LLTR + Touch & Go** | The airlift version of the Touch & Go sortie. The second airfield must have a runway of at least 5,000 ft (if the length is known) and be at least 40 NM from the departure field. Corridor legs bend gently, the approach is a 10 NM straight-in or a wide 2 NM visual pattern at 1,500 ft AGL (never an overhead break), the touch-and-go uses takeoff flaps and no reverse thrust, the turn back towards home is made in steps of at most 35°, and the return runs on an offset track to the same recovery as the cargo LLTR. |

## Altitudes and terrain

Waypoint altitudes come from real terrain: elevation is sampled every 2 NM along each leg (Copernicus DEM, about 90 m), and each waypoint is set about 1,500 ft above the highest terrain on its adjoining legs. This keeps straight legs clear of ridges between waypoints.

The nav log shows MSL altitude and the true AGL under each waypoint. If the terrain service cannot be reached after retries, altitudes are estimated and the briefing is marked `ESTIMATED`. The estimate only knows the terrain of parts of Poland, so check altitudes yourself elsewhere.

## Weather and runways

- Weather comes from VATSIM METAR, then Open-Meteo, then a calm standard atmosphere.
- The active runway is chosen from the wind, or from the ATIS when one is available (FAA D-ATIS for US fields, VATSIM ATIS elsewhere).
- Many small airfields have no runway data. For those the runway is a guess from the wind, and the app shows an amber **RWY EST.** warning. Check the real runway in the sim.

## Exports

| File | Use |
| :--- | :--- |
| MSFS 2020 flight plan (`.pln`) | Load in the sim's flight planner. |
| MSFS 2024 flight plan (`.pln`) | Load from the EFB: open **Load / Save Plan File**, then **Load from this PC**. The file name ends in `_MSFS2024`. |
| Little Navmap (`.lnmpln`) | Open in Little Navmap. |
| Kneeboard (`.pdf`) | Printable sheet with the overview, runway data, frequencies, METAR and nav log. |

## Known limitations

- MSFS 2024 uses a different `.pln` format from MSFS 2020, so the app has a separate button for each. The 2020 file is not meant for 2024 and the other way round. Both files use the same waypoints, names and altitudes. The 2024 file follows Microsoft's published EFB format but has not yet been tested in the simulator itself. Reports and fixes are welcome.
- Cargo Touch & Go needs a second airfield at least 40 NM away (45 NM or more gives the gentlest route) and with a runway of at least 5,000 ft. The app tells you when a field does not qualify. These two limits are the app's own training rules for airlifters, not published regulations.
- Fighter Touch & Go works best with an airfield at least 12 NM from the departure field. Closer fields get a compact, less tidy route, and for some runway directions no route fits, so the app shows a "No valid route found" message. In testing, every combination of distance, bearing and runway direction at 12 NM or more built a route. Pick a farther field if you see the message.
- Weather, ATIS and terrain need an internet connection. Without it the app falls back to a calm standard atmosphere and estimated altitudes.
- The Windows build is unsigned (see Quick start).

## Online services

No accounts or API keys are needed. The app calls these public services from your machine:

| Service | Used for |
| :--- | :--- |
| VATSIM METAR and ATIS | Weather and runway in use |
| Open-Meteo (elevation and forecast APIs) | Terrain elevation, weather fallback |
| FAA D-ATIS via `datis.clowd.io` | US ATIS |
| OpenTopoMap and Esri tiles | Map backgrounds |

## Data and credits

- **Airport data:** `public/airports.json` and `public/runways.json` are generated from [OurAirports](https://ourairports.com/data/) (public domain) by `npm run data:airports`. Magnetic declination is computed with the NOAA World Magnetic Model through the [`geomagnetism`](https://github.com/naturalatlas/geomagnetism) package (Apache-2.0).
- **Maps:** © OpenStreetMap contributors; map style © OpenTopoMap (CC-BY-SA); imagery © Esri and its data providers. Credits appear in the map corner.
- **Terrain:** Copernicus DEM, served by [Open-Meteo](https://open-meteo.com/).
- **Libraries:** [Leaflet](https://leafletjs.com/), React, Vite, Electron and others (see `package.json`).

The MIT license covers this project's source code only, not third-party data or services.

Microsoft Flight Simulator is a trademark of Microsoft. This is an unofficial community project and is not affiliated with or endorsed by Microsoft or Asobo Studio.

## Rebuilding the airport data

The airport and runway files are built from OurAirports with one command (needs an internet connection):

```bash
npm install --save-dev geomagnetism   # once
npm run data:airports
```

To use CSV files you downloaded yourself, put `airports.csv`, `runways.csv` and `airport-frequencies.csv` in a folder and run `npm run data:airports -- --dir <folder>`. The script also warns if a curated airfield is missing from the new data.

## Project layout

```
src/utils/       route generators, weather, terrain, exporters
src/components/  React UI (selectors, briefing card, map, nav log)
src/data/        airport database loader
scripts/         airport data builder (OurAirports)
src/__tests__/   Vitest unit tests
public/          bundled airport and runway data
electron/        desktop app shell
```

## Contributing

Issues and pull requests are welcome. Please run `npm run lint` and `npm test` before opening a pull request.

## License

[MIT](LICENSE)
