# Telescope Trainer — Project Roadmap

This document outlines the architectural milestones and system features for the Telescope Trainer engine. It serves as our permanent semantic versioning anchor.

---

## Version History & SemVer

### `v0.1.0` — Phase 1 (Scaffolding & Core Engine) ✅
- Scaffolding & Dual Canvas Viewport Architecture.
- Core Optical Math Engine (`opticalMath.ts`).
- Finderscope Game Module with alignment thumbscrew physics.

### `v0.2.0` — Phase 2 (Visual Fidelity) ✅
- Procedural Canvas Shaders for celestial targets (Moon, Saturn, Sun, Spire).
- Focuser Knob physics with central obstruction Bokeh (donut effect).
- Observatory Control Desk footer layout.
- Safe Solar Observation rules (Solar hazard radial flash).

### `v0.3.0` — Phase 3 (Dobsonian Trainer) ✅
- Dobsonian Inverted View Trainer (Module 2).
- $180^\circ$ drag-inversion muscle-memory tracking logic.
- Solar Filter Light-Blocking rules (pitch black on non-solar targets).
- Tabbed module switching in `App.tsx`.

### `v0.4.0` — Phase 4 (Optics Sandbox & Logbook) ✅
- Magnification Sandbox (Module 3).
- True exit pupil scaling (dimming at high power via $E^2$).
- Severe atmospheric jitter and Gaussian blur algorithms for over-magnification.
- Hybrid Field Logbook Modal with telemetry-populated quick-tags.

### `v0.5.0` — Phase 5 (Astrophotography & Missions) ✅
- Astrophotography Simulator (Module 4) with digital camera HUD and rule-of-thirds grid.
- Digital sensor noise shader and star-trailing rules.
- Night Sky Mission Engine (`missionEngine.ts`) with guided workflows.
- Astrophotography snapshots persisted to the Field Logbook.

### `v0.6.0` — Phase 6 (Scientific Astrophotography Engine) ✅
- **Split Module 4** into two professional workflows: **Planetary (Lucky Imaging)** and **Deep-Sky (DSO Stacking + Calibration)**.
- **Lucky Imaging Physics:** High-speed video capture with frame-sorting cutoff slider.
- **DSO Stacking Physics:** Continuous SNR model ($\text{SNR} \propto \sqrt{N \cdot t}$) replacing binary ISO noise thresholds.
- **Calibration Frame Subtraction:** Dark Frame capture (Dust Cap ON) → hot pixel removal.
- **Rules Engine:** Context-aware instructor messages for planetary over-exposure and missing Dark Frame calibration.
- **Phase 6.5:** Draggable floating Instructor HUD, focus penalty in AP (F-grade if out of focus), layout cleanup.

### `v0.7.0` — Phase 7 (Global Optics Audit, About Credits & Telescope Profiles) ✅
- **Universal Canvas Blackout Rule:** `isBlackedOut` guard added to Astrophotography module's `requestAnimationFrame` loop, making the dust cap and solar filter rules fully consistent across all 4 modules.
- **De-branding:** Renamed "Vatsalya Master Observer" to "Master Astronomer" in mission engine and achievements. Vatsalya credit preserved prominently in the new About Modal.
- **Top Navigation Bar:** Added a minimalist top nav to `App.tsx` with App Title and an About button.
- **About Modal:** Opened by the About button, displaying the project description and original Vatsalya credit with a clickable URL.
- **Telescope Profiles:** Added `14" SCT Observatory Scope` (355mm, 3910mm) to `constants.ts`. `useTelescopeStore` now exports a `setActiveProfile()` action. Observatory Control Desk shows a Telescope Selector dropdown that instantly recalculates all optical math (Telemetry Panel reflects new true FOV and magnification in real-time).

### `v0.8.0` — Phase 8 (Observatory Instructor Dashboard) ✅
- **Classroom Telemetry Store:** Added `useInstructorStore` simulating live student telemetry and polling intervals.
- **Instructor Grid UI:** Full-screen CSS grid showing real-time student statuses (Nominal, Out of Focus, Safety Violations).
- **Master Override Commands:** Built "God Mode" broadcast controls to lock student controls and force-sync targets.
- **Secret Toggle & Escape Hatch:** Accessible via `Alt+I` hotkey logic built into `App.tsx` and double click on Title.

### `v0.9.0` — Phase 9 (The Custom Equipment Garage) ✅
- **Dynamic Telescope Profiles:** Converted `useTelescopeStore` to allow adding new profiles via `addCustomProfile`, stored persistently using Zustand's `persist` middleware.
- **Custom Equipment Builder UI:** Created `CustomTelescopeModal.tsx` allowing users to input custom Aperture and Focal Length, with live Focal Ratio and Max Useful Magnification physics previews.
- **Control Desk Integration:** Added an "Add Custom Scope" wrench button to the Control Desk which dynamically populates the global telescope dropdown selector upon save.

### `v0.10.0` — Phase 16 (The Field Logbook & Portfolio) ⬅ CURRENT
- **Student Portfolio Modal:** Created `FieldLogbookModal.tsx` — a dark-mode, dual-tab gamification hub that finally gives the "Field Logbook & Badges" footer button somewhere to go.
- **Mission Badges Gallery:** A responsive CSS Grid rendering every badge earned via `useProgressStore().achievements` (populated by `missionEngine.ts` on mission completion), each rendered against the Achievement catalogue (Master Astronomer, Deep Sky Astrophotographer, etc.). Locked badges render dimmed with a lock icon; an encouraging empty-state message appears if no badges have been earned yet.
- **Astrophotography Gallery:** A masonry-style grid surfacing every graded capture from `useProgressStore().logbookEntries`, filtered to Planetary/Deep-Sky tagged entries. Each card safely parses the entry's `tags` and free-text `customNote` to recover the Exposure, ISO/Gain, and letter Grade (A+ → F) awarded by the Astrophotography Trainer, with color-coded grade chips.
- **Data Safety Guards:** All array reads (`achievements`, `logbookEntries`) are defensively type-checked so the portfolio never crashes even if the progress store schema drifts in a future refactor — malformed entries are silently skipped rather than throwing.
- **UI Wiring:** The existing bottom-right "Field Logbook & Badges" tab button in `App.tsx` now toggles `<FieldLogbookModal />` directly (replacing the old achievements/notes `LogbookModal` on that button), closable via the header "X" button or by clicking the backdrop.

---

## Future Roadmap

### `v0.11.0` — Audio Voiceovers & Accessibility
- Web Speech API integration for instructor voice lines.
- Keyboard navigation for all interactive elements.

### `v1.0.0` — Classroom Deployment
- Audio voiceovers and localized language support for Indian classrooms.
- Mobile-responsive PWA (Progressive Web App) deployment for tablets.

