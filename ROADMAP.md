# BRAHMAND — Telescope Simulator: Project Roadmap

*Bharat's Rural Astronomy and Holistic Minds Advancement for Nation's Development*

This document is the permanent semantic-versioning anchor for the project: every architectural milestone, physics system, and pedagogical mechanism we have built, phase by phase, from scaffolding to Gold Master.

---

## 🚀 Current State: Version 1.0 — Release Candidate (Gold Master)

**Phases 1 through 63 are complete.** The simulator is a full hybrid 2D/3D educational engine: a physically-grounded optical simulation (Canvas 2D eyepiece and finderscope feeds) integrated with a walkable 3D Observatory (React Three Fiber), wrapped in a Rank Curriculum, an offline-persistent Field Logbook, and a bilingual (EN/हिं) instructor experience. Every module described below is shipped, wired, and exercised in the live app — nothing in this document is aspirational.

---

## Core Philosophy

> **Law of the Simulator: The sky is never the enemy. The sky is the teacher. Failure is data.**

Every system below — pedagogy, progression, feedback loops, assessment, the 3D transition — is an expression of that law. A student who points at the wrong star, forgets the dust cap, or blows their dark adaptation on the Sun has not hit a bug or a wall; they have generated data the simulator turns into a lesson.

**Guided Discovery, not Guided Tours.** We reject transmission-first teaching (definitions, then application, if ever). The model is **Experience → Puzzlement → Vocabulary → Mastery**: the student first experiences the phenomenon (the Moon drifts out of the eyepiece), *then* feels the puzzlement (why does it move?), *then* receives the vocabulary (Earth rotates — this is why we track), and only then demonstrates mastery. Failure is never a dead end: abandoning a mission converts the attempt into a genuine Field Logbook entry rather than silently resetting.

---

## Tech Stack

- **Vite 8 + React 19 + TypeScript** — build tooling and component architecture.
- **Zustand 5**, with `persist` middleware for offline-durable student logbooks and mission state (Field Logbook, Rank Curriculum progress, telescope profiles all survive a refresh).
- **Tailwind CSS 4** for the instrument-panel UI.
- **HTML5 Canvas 2D** — the optical simulation core: the Main Eyepiece and Finderscope feeds, star fields, diffraction/defocus rendering, astrophotography compositing.
- **React Three Fiber 9 / @react-three/drei 10 / Three.js** — the walkable 3D Observatory scene (orbit and sky-gaze cameras, physical tube dragging, Alt/Az clutches), lazy-loaded via code-splitting so the 2D optics never wait on the 3D bundle.

---

## Version History & SemVer

### `v0.1.0` — Phase 1 (Scaffolding & Core Engine) ✅
- Scaffolding & dual-canvas viewport architecture.
- Core optical math engine (`opticalMath.ts`).
- Finderscope game module with alignment thumbscrew physics.

### `v0.2.0` — Phase 2 (Visual Fidelity) ✅
- Procedural canvas shaders for celestial targets (Moon, Saturn, Sun, Spire).
- Focuser knob physics with central-obstruction bokeh (donut effect).
- Observatory Control Desk footer layout.
- Safe solar observation rules (solar hazard radial flash).

### `v0.3.0` — Phase 3 (Dobsonian Trainer) ✅
- Dobsonian Inverted View Trainer (Module 2).
- 180° drag-inversion muscle-memory tracking logic.
- Solar filter light-blocking rules (pitch black on non-solar targets).
- Tabbed module switching in `App.tsx`.

### `v0.4.0` — Phase 4 (Optics Sandbox & Logbook) ✅
- Magnification Sandbox (Module 3).
- True exit-pupil scaling (dimming at high power via the inverse-square law).
- Severe atmospheric jitter and Gaussian blur for over-magnification.
- Hybrid Field Logbook Modal with telemetry-populated quick-tags.

### `v0.5.0` — Phase 5 (Astrophotography & Missions) ✅
- Astrophotography Simulator (Module 4) with digital camera HUD and rule-of-thirds grid.
- Digital sensor noise shader and star-trailing rules.
- Night Sky Mission Engine (`missionEngine.ts`) with guided workflows.
- Astrophotography snapshots persisted to the Field Logbook.

### `v0.6.0` — Phase 6 / 6.5 (Scientific Astrophotography Engine) ✅
- Split Module 4 into two professional workflows: **Planetary (Lucky Imaging)** and **Deep-Sky (DSO Stacking + Calibration)**.
- Lucky Imaging: high-speed video capture with a frame-sorting cutoff slider.
- DSO Stacking: continuous SNR model (∝ √(N·t)) replacing binary ISO noise thresholds.
- Calibration frame subtraction: dark-frame capture (dust cap ON) → hot-pixel removal.
- Rules engine: context-aware instructor messages for planetary over-exposure and missing dark-frame calibration.
- Draggable floating Instructor HUD; focus penalty in AP (F-grade if out of focus).

### `v0.7.0` — Phase 7 (Global Optics Audit, About Credits & Telescope Profiles) ✅
- Universal canvas blackout rule: `isBlackedOut` guard makes dust-cap/solar-filter behavior consistent across all four modules.
- Top navigation bar, About Modal, and the original project credit.
- Telescope Profiles system: multiple real instruments (e.g. a 14" SCT Observatory Scope at 355 mm aperture / 3910 mm focal length) with a selector that instantly recalculates all optical math.

### `v0.8.0` — Phase 8 (Observatory Instructor Dashboard) ✅
- Classroom telemetry store simulating live student status polling.
- Full-screen instructor grid (Nominal / Out of Focus / Safety Violation states).
- "God Mode" broadcast controls: lock student controls, force-sync targets.
- Secret instructor toggle (`Alt+I` / title double-click).

### `v0.9.0` — Phase 9 (The Custom Equipment Garage) ✅
- Dynamic telescope profiles: `addCustomProfile`, persisted via Zustand's `persist` middleware.
- Custom Equipment Builder UI with live focal-ratio and max-useful-magnification previews.
- "Add Custom Scope" wrench button wired into the global telescope selector.

### `v0.10.0` — Phase 16 (The Field Logbook & Portfolio) ✅
- Student Portfolio Modal: dark-mode, dual-tab gamification hub (badges + astrophotography gallery).
- Mission Badges Gallery rendered against the full achievement catalogue, locked badges dimmed.
- Masonry-style Astrophotography Gallery surfacing every graded capture with color-coded grade chips.
- Defensive, schema-drift-tolerant data reads so the portfolio never crashes on malformed entries.

### `v0.11.0` — Phase 19 (Offline Data Persistence) ✅
- Every Zustand store that matters to a student's progress — telescope profiles, Field Logbook, Rank Curriculum/mission state — wrapped in `persist` middleware.
- A badge earned or a capture logged now survives a browser refresh or closed tab: the trust the "failure is data" pedagogy depends on.
- `onRehydrateStorage` re-derives runtime-only state (e.g. re-compiling a mission's success-condition function, re-asserting GoTo suppression) on reload, so a resumed session behaves identically to a fresh one.

### `v0.12.0` — Phases ~20–41 (The Unified Live View & 3D Observatory Era) ✅
- **React Three Fiber integration:** a walkable 3D Observatory scene (`ObservatoryScene.tsx`) with Orbit and Sky Gaze cameras, physical click-and-drag telescope tube aiming, and Alt/Az clutch locks that isolate the drag to a single axis.
- **`LiveViewPanel` unification:** `align` / `track` / `collimate` / `astrophotography` became lenses over ONE shared Main Eyepiece + Finderscope feed and ONE shared rAF render loop, instead of four separate screens — manual slewing, sky drift, and motorized tracking now update every view in lockstep by construction.
- Hold-to-slew D-Pad driving real mount pointing with FOV-proportional angular velocity.
- Real lunar ephemeris orbital mechanics: accurate phases, terminator rendering, and parallactic rotation (replacing earlier phase-bug approximations).
- Time Travel: a native datetime-local picker driving the entire simulated sky to any date, plus Pause/Play and ×1/×10/×60 playback.
- Onboarding Tour and the animated Mascot; full mobile touch support (D-pad, instructor panel, 3D tube drag) and a mobile-viewport warning.
- Early performance hardening: idle-redraw throttling (~5 fps when nothing is moving), cached-canvas leak fixes, and a deep performance audit.

### `v0.13.0` — Phases 49–52 (Mount Fidelity & Performance Defusal) ✅
- Terrestrial targets grounded to a physically sensible altitude; EQ mount tracking/clamp feedback loop fixed.
- VRAM memory leak defused and WebGL device-pixel-ratio capped for sustained frame stability.
- `useShallow` selector adoption begins: the first pass at scoping store subscriptions so heavy panels stop re-rendering on unrelated global state writes.

### `v0.14.0` — Phases 54–56 (Optical & Equipment Correctness Pass) ✅
- Fixed sky-projection shear, `localStorage` write spam, shadow-map rendering, and AFOV/Barlow magnification math.
- Custom telescope validation, mount-type selection, and mirror/rotation parity separated and corrected.
- LRU sprite cache for target rendering; true Bahtinov mask diffraction-spike geometry with an 8× vernier magnifier inset for focus-critical astrophotography.

### `v0.15.0` — Phase 57 (The Collimation Engine) ✅
- Complete mirror-collimation physics: six-screw beam-error model, a real defocused star-test renderer (Fresnel ring count, central-obstruction shadow, coma severity and direction — all derived, never stored), and a dedicated Collimation UI panel/bench.

### `v0.16.0` — Phases 58–59 (Mechanics, Ephemeris & 3D Code-Splitting) ✅
- Counterweight/mount-balance physics: a real net moment about the RA axis drives tracking droop direction and speed — nose-heavy sinks, counterweight-heavy climbs, Alt-Az rigs (no counterweight shaft) fall back to the historical boolean droop.
- Ephemeris system completion and further pedagogy polish across the Rank Curriculum.
- White-light dark-adaptation event: an unfiltered glance at the Sun instantly resets a student's simulated night vision.
- WebGL code-splitting: the 3D Observatory bundle is now lazily fetched, so the 2D optical simulation never pays for 3D's weight.

### `v0.17.0` — Phases 60–63 (Identity, Advanced Tour & Capstone Review) ✅
- Collimation error now physically couples into the finderscope's alignment error — the mirror and the finder are one mechanical instrument, not two independent lessons.
- Advanced Tour added alongside the beginner tour, with separated tour tracks so the two never cross-contaminate state.
- BRAHMAND identity: the full acronym and mission blurb integrated into a dedicated About Modal, reachable from the global footer.
- Isolated tour-box clipping and overflow fixed via `maxHeight` + internal scrolling; lunar halo removed for render correctness.
- Phase 63 capstone: a full architectural review of the codebase ahead of the v1.0 cut.

### `v1.0.0` — Phase 64 (Gold Master Hardening) ✅ ⬅ **CURRENT**
- Fixed an unmount timeout leak in `LiveViewPanel.tsx`'s astrophotography capture/record handlers (`handlePlanetaryCapture`, `handleRecordVideo`, `handleDsoCapture`) — all three now clear their pending `setTimeout` on unmount.
- Fixed `TelemetryPanel.tsx`'s last unscoped store subscription: `useMissionStore()` now reads only `activeRankMissionId`, `completedTargetIds`, and `rankMissionStatus` via `useShallow`, matching every other store this always-mounted panel touches.
- Full documentation sync (this file) against the real, verified state of the codebase and git history.

---

## A Note on This Document

Every phase above is drawn from the project's actual commit history and cross-checked against the live source — not reconstructed from memory or narrative alone. Where earlier planning documents described the 3D Observatory as a *future* transition, the truth is more interesting: React Three Fiber was integrated organically in the Phase ~20–41 era, alongside dozens of 2D refinements, and the two have been developed as one coherent instrument ever since. There is no "2D-complete, 3D-pending" seam in this codebase — v1.0 ships both, together.
