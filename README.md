# BRAHMAND — Telescope Operations Simulator

**A browser-based training observatory that teaches students how to actually operate a telescope — before they ever touch one.**

BRAHMAND (ब्रह्मांड, *"the cosmos"*) is an interactive telescope simulator built for classroom astronomy education. Students drive a physically simulated mount under a physically simulated sky: they align a misaligned finderscope, hunt targets with a slew pad, fight real sidereal drift, discover why high magnification shows *less*, watch Jupiter's moons reshuffle night after night — and learn, unforgettably, why you never point an unfiltered telescope anywhere near the Sun.

The sky is not a picture. Every star, planet, and photon-count in the view is computed from the same spherical-astronomy formulas used in real ephemeris software, running live in the browser at 60 fps. The full mathematics is documented in the **[Physics Engine Whitepaper](PHYSICS_ENGINE.md)**.

---

## Features

### 🔭 A real optical stack
- **Three telescope profiles** — an 8″ f/6 Dobsonian, a 60 mm beginner refractor, and a 14″ SCT on an equatorial mount — plus a **Custom Equipment Garage** for building your own (with live focal-ratio and max-magnification previews).
- **Four-eyepiece catalog + 2× Barlow**: magnification, true field of view, and exit pupil recomputed live; exit pupils under 0.5 mm dim and float, exactly like the real thing.
- **Absolute angular scaling**: the Moon (0.51°) nearly fills a low-power field while Saturn stays a hard-won dot — sizes are the strict ratio of angular diameter to true FOV, never artistic license.
- **Dual optical feeds**: the main eyepiece and a 6×30 straight-through finder render the same sky through one unified pipeline — including the Newtonian's fully inverted view, which the finder doesn't share.

### 🌌 The Universal Physical Sky
- Every catalog body — Moon, Sun, Jupiter (with all four Galilean moons on a live ephemeris), Saturn, the Orion Nebula, and a terrestrial practice spire — is evaluated for **physical visibility every frame**. Slew off the Moon and it pans out of the field in rigid formation with the stars; it is never "deselected" out of existence.
- **~150 named stars + constellation lines**, plus a deterministic two-tier procedural starfield hashed from fixed celestial coordinates — so eyepiece fields show the anonymous field stars a real telescope shows, bolted permanently to the sky.
- **A full day/night cycle**: a live solar ephemeris drives sunrise, the civil/nautical/astronomical twilight ladder, and per-body daylight washout (the Moon ghosts through noon; nebulae need true darkness). A *Virtual Night* toggle lets daytime classrooms observe anyway.
- **Field rotation on Alt-Az mounts**: targets visibly rotate over a Dobsonian session (the parallactic angle, recomputed each frame) — and stop rotating when you switch to the equatorial SCT.

### 🎮 Training modules
- **Finder Alignment** — a scrambled finderscope, thumbscrew physics, and an alignment protocol with three difficulty tiers.
- **Tracking Trainer** — keep a drifting target in the reticle against true sidereal motion, mechanical droop, and your own overcorrections.
- **Astrophotography Lab** — planetary lucky imaging (frame-cutoff vs. seeing) and deep-sky stacking with a real √(N·t) SNR model, dark-frame calibration, and letter-graded results.
- **Missions, curriculum & logbook** — a bilingual (English/हिन्दी) textbook with "Try it out" hooks, rank missions, achievements, and a field logbook portfolio of graded captures.

### 🛡️ Safety, faithfully enforced
- A **physical solar-hazard interlock** watches the mount's actual pointing against the live Sun — slewing across the daytime sky into it triggers the full-canvas hazard flash whether or not the Sun is "selected." Solar filter and dust-cap rules are enforced everywhere.

### 🏫 Classroom features
- **Instructor Dashboard** (`Alt+I`) — a simulated classroom telemetry grid with student statuses and master-override broadcast controls.
- **Simulation modes** — one switch sets the whole app's strictness:

  | Mode | Drift | Finder error | Focus tolerance | Extras |
  |---|---|---|---|---|
  | **Fun** | Off (auto-tracking) | Pinned perfect | Generous | 2× Digital Zoom |
  | **Easy** | 35% rate | Real | Generous | — |
  | **Realistic** | Full sidereal | Real | ±4 units | Full penalties |

- **3D observatory** — a grab-the-tube React-Three-Fiber scene where the Dobsonian and German-equatorial rigs move with real inverse kinematics, synced to the same pointing state as the eyepiece feeds.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI framework | [React 19](https://react.dev) + TypeScript |
| Build tooling | [Vite 8](https://vite.dev) (`@vitejs/plugin-react`), [Oxlint](https://oxc.rs) |
| 3D observatory | [Three.js](https://threejs.org) via [React Three Fiber](https://r3f.docs.pmnd.rs) + [drei](https://drei.docs.pmnd.rs) |
| 2D optical feeds | Hand-rolled Canvas 2D renderer (one shared rAF loop, spec-driven) |
| State | [Zustand 5](https://zustand.docs.pmnd.rs) with localStorage persistence |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) (`@tailwindcss/vite`) |
| Icons | [lucide-react](https://lucide.dev) |
| Physics | Pure TypeScript in `src/engine/` — zero runtime dependencies |

---

## Local Development

### Prerequisites
- **Node.js 20.19+** (or 22.12+)
- npm (ships with Node)

### Setup

```bash
# 1. Clone and enter the repository
git clone <repository-url>
cd "Telescope Simulator"

# 2. Install dependencies
npm install

# 3. Start the dev server (Vite, with HMR)
npm run dev
# → http://localhost:5173
```

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot module replacement |
| `npm run build` | Type-checks (`tsc -b`) and produces a production bundle in `dist/` |
| `npm run preview` | Serves the production build locally |
| `npm run lint` | Runs Oxlint |

### Good to know
- **Persistence**: equipment, progress, and settings live in `localStorage` (`telescope-equipment-storage` and friends). Clearing site data resets the simulator to a fresh student state; the simulation clock always restarts at the real current time by design.
- **Default observing site**: Jaipur, India (26.91° N, 75.79° E) — changeable in Settings.
- **Instructor Dashboard**: toggle with `Alt+I`.

---

## Project Structure

```
src/
├── engine/                 # Pure-TypeScript physics core (no React imports)
│   ├── ephemerisMath.ts    #   JD/LST, RA/Dec ⇄ Alt/Az, Sun, parallactic angle, Galilean moons
│   ├── skyGeometry.ts      #   Pointing-relative projection, drift-gentled clock
│   ├── skyRenderer.ts      #   The universal eyepiece/finder canvas renderer
│   ├── timeEngine.ts       #   Continuous anchored simulation clock
│   ├── daylight.ts         #   Sun altitude → twilight ladder → star visibility
│   ├── opticalMath.ts      #   Magnification, FOV, exit pupil, limiting magnitude
│   ├── astroMath.ts        #   Astrophotography SNR / lucky-imaging models
│   ├── simulationModes.ts  #   Fun / Easy / Realistic rule table
│   ├── starCatalog.ts      #   Named stars + constellation lines
│   ├── targetGlyphs.ts     #   Procedural canvas art per body
│   ├── rulesEngine.ts      #   Focus/safety/seeing evaluation → instructor feedback
│   ├── missionEngine.ts    #   Guided mission workflows
│   └── curriculum.ts       #   Bilingual textbook lessons
├── store/                  # Zustand stores (telescope, alignment, progress, instructor)
├── components/
│   ├── liveview/           # LiveViewPanel — both optical feeds, one rAF loop
│   ├── canvas/             # ObservatoryScene — R3F 3D observatory
│   ├── layout/             # Telemetry panel, instructor voice box
│   └── ui/                 # Modals, dashboard, tour, textbook, logbook
├── data/                   # Target catalog, missions, book content
└── types/                  # Shared TypeScript interfaces
```

---

## The Educational Goal

Most astronomy software shows students the sky. BRAHMAND teaches them the **craft of observing it** — the hand skills and judgment that separate owning a telescope from using one:

1. **Why the finder matters**, and how to align it (because at 300× the sky is a pinhole).
2. **Why targets escape**, and what the Earth's rotation does to an unmotored mount in real time.
3. **Why more magnification is usually worse** — true field, exit pupil, and the atmosphere all push back.
4. **Why the view rotates** on a Dobsonian but not on an equatorial mount.
5. **What a night of Jupiter actually shows** — four moons doing celestial mechanics in miniature.
6. **Solar safety as reflex**, enforced by physics rather than a warning label.

Every rule in the simulator exists because a real telescope would enforce it. The difficulty modes bend one thing only — the *pace* of drift, never its geometry — so skills built here transfer to a real eyepiece on a real field night. (Details: [PHYSICS_ENGINE.md §8](PHYSICS_ENGINE.md#8-time-gentled-drift-mechanics).)

The interface is bilingual (English / हिन्दी), the default site is Jaipur, and the project ships alongside the *BRAHMAND Astronomy Handbook* used in the classroom program.

---

## Documentation

- **[PHYSICS_ENGINE.md](PHYSICS_ENGINE.md)** — the architecture whitepaper: coordinate pipeline, rendering loop, field-rotation derivation, Galilean ephemeris, drift mechanics, and every documented simplification.
- **[ROADMAP.md](ROADMAP.md)** — version history and upcoming milestones.

## Credits

Developed for the BRAHMAND astronomy education program. Original program credit: **Vatsalya** (see the in-app About dialog). Astronomical formulas follow Duffett-Smith, *Practical Astronomy with your Calculator*, and Meeus, *Astronomical Algorithms*.
