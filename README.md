# Military Flight Desk for MSFS

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MSFS 2020/2024](https://img.shields.io/badge/Simulator-MSFS%202020%20%7C%202024-0284c7.svg)](#exports)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows-10b981.svg)](#quick-start)

A tactical flight dispatch and mission planning desk for **Microsoft Flight Simulator 2020 & 2024** peacetime military training sorties.

Pick an airfield, aircraft category, and mission profile. The desk automatically generates a complete sortie: runway-aligned departure, low-level navigation corridor contoured over real terrain, tactical pattern, and recovery to the field. Includes interactive route plotting, live weather, an automatic VFR safety check, and direct simulator flight plan exports.

> **Note:** For flight simulation use only. Not for real-world navigation or flight planning.

---

## Quick Start

Download the latest version from the **[Releases Page](https://github.com/GajewyJ/military-flight-desk/releases/latest)**:

| Distribution | Description | Updates |
| :--- | :--- | :--- |
| **Setup (`.exe`)** *(Recommended)* | Full Windows installer. Installs to user directory with start menu and desktop shortcuts. | **Automatic**: Checks GitHub on start-up and updates in the background. |
| **Portable (`.exe`)** | Standalone executable. Run anywhere (e.g. from a USB drive) without installation. | **Manual**: Download new releases directly from GitHub. |

> **Windows SmartScreen Notice:**
> Community open-source builds are not code-signed. On first launch, Windows SmartScreen may show a warning. Click **More info** &rarr; **Run anyway**.

---

## Features

* **Authentic Field-Manual Interface:** Designed with a military tactical look—manila charts, olive drab framing, Bahnschrift DIN-style typography, and full **Day** and **Night** themes.
* **Realistic Mission Planning:**
  * **Low-Level Tactical Routes (LLTR):** Terrain-following navigation corridors with staggered doglegs, initial points (IP), and tactical overhead break or straight-in recoveries.
  * **Touch & Go Sorties:** Low-level transit to a secondary field with procedural patterns and offset return tracks.
  * **Range Training:** Low-level ingress to a tactical training ground, multiple strafing passes in a racetrack pattern (roll-in, 10–15° dive, pull-off), and climb-out return.
  * **Cargo Airdrop:** Airlifter ingress, slowdown, run-in on drop heading, CARP (Computed Air Release Point), and tactical egress.
* **Built-in Training Ranges:** Database of **53 military training grounds across 18 countries** (North America, Europe, Australia, India), with automatic "Nearest Available" range selection.
* **Real-World Terrain Clearance:** Samples elevation every 2 NM along every leg (Copernicus DEM) to clear ridge lines and compute safe MSL/AGL cruising altitudes.
* **Live Weather & VFR Safety Checks:** Real-time METAR and ATIS (VATSIM and FAA D-ATIS) with automated wind runway selection and pre-flight VFR warnings (cloud ceiling, visibility, crosswind, gusts, and daylight limits).
* **Flexible Units of Measurement:** Toggle between Imperial and Metric units for altitude (ft / m), airspeed (kts / km/h), distance (NM / km), and altimeter pressure (inHg / hPa).
* **No Accounts or API Keys Required:** All map tiles, terrain elevations, and weather data work out of the box using public community services.

---

## How It Works

1. **Select Aircraft & Mission:** Choose between **Fighter Jet** or **Cargo / Airlifter**, then pick your mission profile and sortie duration.
2. **Enter Departure:** Type the 4-letter ICAO code of your home base (e.g., `EPLK`, `ETAR`, `EGQL`, `KNPA`). For Touch & Go sorties, specify the destination airfield.
3. **Generate:** Click **Generate** (or press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> / <kbd>R</kbd>).
4. **Review Briefing:** Inspect the tactical briefing card, interactive map, waypoint leg profiles, and safety checks.
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
* **Map Tiles:** © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [OpenTopoMap](https://opentopomap.org/) (CC-BY-SA), and imagery by Esri.

---

## Disclaimer & License

* *Microsoft Flight Simulator* is a registered trademark of Microsoft Corporation. This project is an independent community tool and is not affiliated with, endorsed by, or sponsored by Microsoft or Asobo Studio.
* Distributed under the **MIT License**. See [LICENSE](LICENSE) for full details.
