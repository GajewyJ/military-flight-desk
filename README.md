# Military Flight Desk for MSFS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MSFS 2020/2024](https://img.shields.io/badge/Simulator-MSFS%202020%20%7C%202024-0284c7.svg)](#exports)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-10b981.svg)](#quick-start)

A tactical flight dispatch and mission planning desk for **Microsoft Flight Simulator 2020 & 2024** peacetime military training sorties.

Pick an airfield, aircraft category, and mission profile. The desk automatically generates a complete sortie: runway-aligned departure, low-level navigation corridor contoured over real terrain, tactical pattern, and recovery to the field. Includes interactive route plotting, live weather, an automatic VFR safety check, and direct simulator flight plan exports.

> **Note:** For flight simulation use only. Not for real-world navigation or flight planning.

---

## Quick Start

Download the latest **Setup (`.exe`)** from the **[Releases Page](https://github.com/GajewyJ/military-flight-desk/releases/latest)**. It is a full Windows installer: it installs to a user directory with start menu and desktop shortcuts, checks GitHub on start-up and updates itself in the background.

> **Portable version:** the portable `.exe` is no longer published (last version: v0.8.0 or earlier). It does not update itself, so to move to the current version, install the Setup once.

> **Windows SmartScreen Notice:**
> Community open-source builds are not code-signed. On first launch, Windows SmartScreen may show a warning. Click **More info** &rarr; **Run anyway**.

---

## Features

* **Authentic Field-Manual Interface:** Designed with a military tactical look—manila charts, olive drab framing, Bahnschrift DIN-style typography, and full **Day** and **Night** themes.
* **Realistic Mission Planning:**
  * **Low-Level Tactical Routes (LLTR):** Terrain-following navigation corridors with staggered doglegs, initial points (IP), and tactical overhead break or straight-in recoveries. Every route is a circuit around the field with a random outline (triangle, L-shape, box, loop or four-leg circuit), never an out-and-back.
  * **Touch & Go Sorties:** Low-level transit to a secondary field with procedural patterns and offset return tracks.
  * **Range Training:** Low-level ingress to a tactical training ground, multiple strafing passes in a racetrack pattern (roll-in, 10–15° dive, pull-off), and climb-out return.
  * **Cargo Airdrop:** Airlifter ingress, slowdown, run-in on drop heading, CARP (Computed Air Release Point), and tactical egress.
* **Built-in Training Ranges:** Database of **53 military training grounds across 18 countries** (North America, Europe, Australia, India), with automatic "Nearest Available" range selection.
* **Altitude Profile:** A chart under the map shows the terrain along the whole route, the planned altitude at every waypoint and the main fixes. Move the pointer over it to read distance, planned altitude, terrain and clearance (hovering a fix highlights it on the map). Stretches where the plan is under 500 ft above the terrain, for example just after you moved a waypoint, are shaded red. With the live link, your aircraft and the altitude you flew are drawn on it.
* **Live Flight Link (Windows app):** Click **LIVE** on the map to see your aircraft from Microsoft Flight Simulator 2020 or 2024 on the route: position, heading, a track trail, the next waypoint with distance and time, cross-track error, and a radar-altitude check on low-level and range legs. It only reads from the simulator (SimConnect) and needs no extra setup; it connects as soon as MSFS is running.
* **Spoken Alerts (Windows app):** With the live link on, a voice calls "Low altitude" and "Too low, pull up" by radar altitude, "Off track" with side and distance (and "Back on track"), "High" above the planned altitude, and the main waypoints with turns ("Low level entry, turn left, heading two seven zero"). It speaks when something changes and repeats a warning calmly while it lasts. Switch it off or on under **Settings > Spoken alerts**. The alerts are always spoken in English, with an English voice installed in Windows (Settings shows which one is used, or how to add one).
* **Flight Debrief (Windows app):** The flight is recorded from take-off to landing. When you land, a debrief opens (or click **DEBRIEF**): time and distance against the plan, time per leg, distance from the planned track, time below the planned radar altitude on low-level and range legs, and the lowest radar altitude. The flown track and altitude stay on the map and the altitude profile, and you can export the track as **GPX** or **KML** (with the planned route) to compare it in Google Earth or other tools.
* **Saved Missions:** Click **Missions** in the top bar to save the mission on screen (hand-moved waypoints included) under a name, and to load, or delete saved ones later. Nothing to set up: in the Windows app they are kept automatically in the application's own data folder (`library`), in the browser in the browser's storage.
* **Flight History (Windows app):** Every flight you land with the live link on is saved automatically (plan and recorded flight). Open the **Flight history** tab under Missions to see a past flight's debrief again, export its track, or delete it. The latest 50 flights are kept.
* **Kneeboard Altitude Profile:** The kneeboard PDF carries the altitude profile (terrain and planned altitude along the route, with the main fixes), in your chosen units.
* **Editable Route:** Drag the corridor fixes on the map to reshape the route; legs, headings, times, altitudes, kneeboard and exports follow, and **Reset route** restores the generated one. Airfields, runway procedures and patterns stay fixed.
* **Real-World Terrain Clearance:** Samples elevation every 2 NM along every leg (Copernicus DEM) to clear ridge lines and compute safe MSL/AGL cruising altitudes.
* **Live Weather & VFR Safety Checks:** Real-time METAR and ATIS (VATSIM and FAA D-ATIS) with automated wind runway selection and pre-flight VFR warnings (cloud ceiling, visibility, crosswind, gusts, and daylight limits).
* **Flexible Units of Measurement:** Toggle between Imperial and Metric units for altitude (ft / m), airspeed (kts / km/h), distance (NM / km), and altimeter pressure (inHg / hPa).
* **No Accounts or API Keys Required:** All map tiles, terrain elevations, and weather data work out of the box using public community services.

---

## How It Works

1. **Select Aircraft & Mission:** Choose between **Fighter Jet** or **Cargo / Airlifter**, then pick your mission profile and sortie duration.
2. **Enter Departure:** Type the 4-letter ICAO code of your home base (e.g., `EPLK`, `ETAR`, `EGQL`, `KNPA`). For Touch & Go sorties, specify the destination airfield.
3. **Generate:** Click **Generate** (or press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> / <kbd>R</kbd>).
4. **Review Briefing:** Inspect the tactical briefing card, interactive map, waypoint leg profiles, and safety checks. Drag a corridor fix (a ring or dot on the route) to move it.
5. **Export & Fly:** Save the flight plan file directly to your simulator or print your kneeboard.

---

## Mission Profiles

| Mission | Fighter Jet Profile | Cargo / Airlifter Profile |
| :--- | :--- | :--- |
| **LLTR**<br>*(Low-Level Route)* | High-speed (360–420 KIAS), aggressive low-level corridor, IP, and tactical overhead break (or straight-in at civil fields). | Heavy transport cruising (250 KIAS), wider radius turns, contour altitude, and straight-in or wide visual pattern. |
| **LLTR + Touch & Go** | Low-level transit to second base, visual pattern or straight-in touch-and-go, offset return route. | Long-range route to field with &ge; 5,000 ft runway, visual pattern or 10 NM straight-in, climb-out and offset return. |
| **Range Training**<br>*(Air-to-Ground)* | Low-level ingress to range, 1,800 ft AGL roll-in dive attack, 500 ft pull-off, multi-pass racetrack. | *Not applicable for airlift category.* |
| **Cargo Drop**<br>*(Airdrop)* | *Not applicable for fighter category.* | Transit to drop zone, run-in at 800 ft AGL / 130–150 KIAS with flaps 50%, release at CARP, climb-out. |

---

## Exports

| Format | Purpose | How to Load |
| :--- | :--- | :--- |
| **MSFS 2020 (`.pln`)** | Native MSFS 2020 flight plan | Load from the World Map screen (**More** &rarr; **Load/Save** &rarr; **Load**). |
| **MSFS 2024 (`.pln`)** | Native MSFS 2024 EFB format | In MSFS 2024 EFB: open **Load / Save Plan File** &rarr; **Load from this PC**. |
| **Little Navmap (`.lnmpln`)** | Flight tracking and moving map | Open directly in Little Navmap (**File** &rarr; **Open Flight Plan**). |
| **Kneeboard PDF (`.pdf`)** | Printable or tablet briefing sheet | Printable document with runway data, frequencies, METAR, nav log, and Day/Night/Print color options. |

The MSFS and Little Navmap plans end where the route leaves the low-level corridor for the airfield (the egress, 10 to 15 NM out), before the landing circuit. These sorties start and end at the same airfield, and a plan that also ends with the circuit over it confuses the flight tracking of the simulator and of Little Navmap; you fly the circuit and land yourself, and the simulator still names the airfield as the destination. The kneeboard and the nav log keep the whole approach. If you prefer the plan to end on the airfield, change it under **Settings > Flight plan files**.

---

## Settings & Customization

Click the **Settings** button in the top bar to customize:
* **Appearance:** Toggle between **Day** (light manila paper) and **Night** (low-glare dark green).
* **Simulator Version:** Set your default simulator to **MSFS 2020** or **MSFS 2024** for one-click plan exports.
* **Kneeboard Style:** Match the on-screen theme or use **Print Mode** (pure black-on-white) to conserve printer ink.
* **Units:** Altitude (ft/m), Airspeed (kts/km/h), Distance (NM/km), Altimeter (inHg/hPa).

---

## Building from Source

If you want to contribute or run the web version locally:

### Prerequisites
* **Node.js** &ge; 20.19.0
* **npm**

### Development Commands

```bash
# Install dependencies
npm install

# Start the web app locally (http://localhost:3000)
npm run dev

# Run unit tests
npm test

# Run TypeScript type check
npm run lint

# Build production web bundle
npm run build

# Package desktop application for Windows (output in /release)
npm run electron:dist

# Rebuild bundled airport and runway database from OurAirports
npm run data:airports
```

---

## Data & Credits

* **Airport & Runway Data:** Generated from [OurAirports](https://ourairports.com/data/) (Public Domain). Magnetic declination computed using the NOAA World Magnetic Model via [`geomagnetism`](https://github.com/naturalatlas/geomagnetism).
* **Elevation & Terrain:** Copernicus DEM served by [Open-Meteo](https://open-meteo.com/).
* **Weather & ATIS:** [VATSIM](https://vatsim.net/) METAR/ATIS and FAA D-ATIS via [`datis.clowd.io`](https://datis.clowd.io/).
* **Simulator Link:** [`node-simconnect`](https://github.com/EvenAR/node-simconnect) by EvenAR (LGPL-3.0), a SimConnect client for Node.js, used unmodified.
* **Map Tiles:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA), and imagery by Esri.

---

## Disclaimer & License

* *Microsoft Flight Simulator* is a registered trademark of Microsoft Corporation. This project is an independent community tool and is not affiliated with, endorsed by, or sponsored by Microsoft or Asobo Studio.
* Distributed under the **MIT License**. See [LICENSE](LICENSE) for full details.
