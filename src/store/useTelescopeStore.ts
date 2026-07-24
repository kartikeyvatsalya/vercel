import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TELESCOPE_PROFILES, TELESCOPE_PROFILES_LIST } from '../engine/constants';
import { TARGETS } from '../data/bookContent';
import { convertEquatorialToHorizontal, convertHorizontalToRaDec } from '../engine/ephemerisMath';
import { SIM_MODE_RULES, type SimulationMode } from '../engine/simulationModes';
import { TERRESTRIAL_POINTING, getBodyEquatorial } from '../engine/skyGeometry';
import { EYEPIECE_CATALOG, DEFAULT_EYEPIECE_ID } from '../engine/opticalMath';
import { getSmoothSimTime, reanchorTimeEngine } from '../engine/timeEngine';
import { useProgressStore } from './useProgressStore';
import type { TelescopeProfile, Target } from '../types';
import type { LoadedAssets } from '../engine/assetLoader';

// ── Phase B: Physics Bridge (Zustand → 3D) ──────────────────────
// Real Alt-Az pointing is now derived from each target's RA/Dec via
// ephemerisMath, the observer's location, and the current time. This
// does NOT touch the existing 2D optical/rules math — it's purely
// new "where is the tube pointing" state consumed by ObservatoryScene.tsx.
// ── Coordinate-frame rule (Phase 25) ──
// Celestial targets are anchored to the EQUATORIAL grid (RA/Dec): their
// Alt/Az changes as simTime advances. Terrestrial targets are anchored to
// the HORIZONTAL grid: a fixed Alt/Az relative to the ground, immune to
// Earth's rotation. TERRESTRIAL_POINTING (now defined in engine/skyGeometry,
// the canonical home for sky-projection constants) is that fixed ground
// anchor — re-exported here so existing `from '../store/useTelescopeStore'`
// imports across the app keep working unchanged.
export { TERRESTRIAL_POINTING };
const DEFAULT_POINTING = TERRESTRIAL_POINTING;

export interface ObserverLocation {
  latitude: number;
  longitude: number;
}

/** How badly the finderscope starts out misaligned when scrambled. */
export type AlignmentDifficulty = 'auto' | 'easy' | 'medium' | 'realistic';

export interface FinderscopeError {
  deltaAlt: number; // degrees the finder aims ABOVE the mount's true pointing
  deltaAz: number;  // degrees the finder aims RIGHT of the mount's true pointing
}

// Random angular error magnitude (degrees) per difficulty tier.
const FINDER_ERROR_RANGES: Record<Exclude<AlignmentDifficulty, 'auto'>, [number, number]> = {
  easy: [0.3, 0.6],
  medium: [0.6, 1.2],
  realistic: [1.2, 2.0],
};

const DEFAULT_OBSERVER_LOCATION: ObserverLocation = { latitude: 26.9124, longitude: 75.7873 };

function computePointing(target: Target, observer: ObserverLocation, time: Date): { altitude: number; azimuth: number } {
  // Terrestrial targets live on the horizontal grid — fixed Alt/Az, no
  // ephemeris. Celestial coordinates resolve through getBodyEquatorial
  // (Phase 35): the Sun follows the LIVE solar ephemeris — and since Phase
  // 42.8 the Moon follows its live lunar ephemeris too — so a GoTo slew
  // lands exactly where the universal sky renderer draws it.
  const eq = getBodyEquatorial(target, time.getTime());
  if (!eq) {
    return { altitude: DEFAULT_POINTING.alt, azimuth: DEFAULT_POINTING.az };
  }
  return convertEquatorialToHorizontal(eq.ra, eq.dec, observer.latitude, observer.longitude, time);
}

const INITIAL_SIM_TIME = Date.now();
const INITIAL_POINTING = computePointing(TARGETS.moon, DEFAULT_OBSERVER_LOCATION, new Date(INITIAL_SIM_TIME));

// The smooth clock (engine/timeEngine) and the store's low-frequency simTime
// mirror must agree on the same epoch from the very first frame.
reanchorTimeEngine(INITIAL_SIM_TIME, 1);

/**
 * When simTime shifts, a running sidereal motor keeps the mount locked onto
 * its captured RA/Dec — so celestial targets stay put in the eyepiece while
 * anything ground-anchored drifts out. With the motor off the mount is inert.
 */
function pointingAfterTimeShift(
  isTrackingMotorOn: boolean,
  trackedEquatorial: { ra: number; dec: number } | null,
  observer: ObserverLocation,
  newTime: number
): { pointingAlt: number; pointingAz: number } | Record<string, never> {
  if (!isTrackingMotorOn || !trackedEquatorial) return {};
  const p = convertEquatorialToHorizontal(
    trackedEquatorial.ra,
    trackedEquatorial.dec,
    observer.latitude,
    observer.longitude,
    new Date(newTime)
  );
  return { pointingAlt: p.altitude, pointingAz: p.azimuth };
}

interface TelescopeState {
  availableProfiles: TelescopeProfile[];
  activeProfile: TelescopeProfile;
  // null = no target lock (e.g. the user manually slewed the 3D mount away)
  activeTarget: Target | null;
  // `eyepieceFocalLength` is DERIVED from `activeEyepieceId` (kept in sync by
  // setEyepiece) and MUST stay a plain numeric field — legacy mission logic
  // and the rules engine compare it directly (including an exact `=== 25`
  // check), so it cannot become a computed getter without touching those.
  eyepieceFocalLength: number;
  activeEyepieceId: string;
  // Every eyepiece ID ever selected (any mode) — drives the 'optics_master' achievement.
  testedEyepieceIds: string[];
  focuserPosition: number; // 0 to 100, where 50 is perfect focus
  
  // Environment & Rules State
  seeingQuality: number; // 1 to 5
  isDustCapOn: boolean;
  isSolarFilterAttached: boolean;
  isMirrorCooled: boolean;
  isAltTensionLocked: boolean;
  isMechanicallyBalanced: boolean;
  isCollimated: boolean;
  isLowPerformanceDevice: boolean;
  isHighPerformanceMode: boolean;
  isFocuserDragging: boolean;
  isBarlowActive: boolean;

  // ── Asset Cache (NOT persisted — re-loaded on each page visit) ──
  loadedAssets: LoadedAssets | null;

  // ── 3D Pointing State (Phase B: State Bridge for R3F) ──
  // Alt-Az orientation of the physical telescope tube/mount.
  // ObservatoryScene.tsx reads these to rotate the placeholder 3D model.
  pointingAlt: number; // degrees above horizon, 0-90
  pointingAz: number;  // degrees from North, 0-360

  // ── Alt/Az Clutch Locks (Phase 46) ──
  // User-toggled precision aids: when locked, dragging the 3D tube (see
  // useTubeDrag in ObservatoryScene.tsx) ignores pointer movement along
  // that axis entirely, so a panning drag can't accidentally nudge the
  // other axis. NOT the same thing as isAltTensionLocked (a mechanical
  // "is the friction clutch tightened" rules-engine flag that governs
  // whether the mount holds position under gravity) — these two just
  // isolate drag INPUT to one axis at a time. Not persisted: a fresh
  // session always starts fully unlocked.
  isAltLocked: boolean;
  isAzLocked: boolean;

  // ── EQ Meridian Collision Guard (Phase 46) ──
  // True while a German Equatorial mount's counterweight is higher than the
  // OTA (hourAngle > 180°, numerically verified against the actual 3D rig
  // transform in ObservatoryScene.tsx's EquatorialAssembly) — the real-world
  // "OTA about to hit the tripod/pier, meridian flip required" danger zone.
  // Set by EquatorialAssembly's per-frame check, which also clamps pointing
  // back to the safe boundary; read by App.tsx to show the warning banner.
  // Not persisted: irrelevant outside a live EQ-mounted session.
  isEqMeridianDanger: boolean;

  // Observer's location on Earth, anchoring the RA/Dec → Alt/Az sky math.
  observerLocation: ObserverLocation;

  // ── Finderscope Alignment (Phase 24) ──
  // Angular divergence between the finder's optical axis and the mount's
  // true pointing. The finder viewport renders the sky at pointing + error.
  alignmentDifficulty: AlignmentDifficulty;
  finderscopeError: FinderscopeError;

  // ── Global Simulation Mode (Phase 26) ──
  // Controls the whole app's strictness via SIM_MODE_RULES.
  simulationMode: SimulationMode;
  // Fun-mode "Digital Zoom" — a 2× view-level magnifier with no optics penalty.
  isDigitalZoomOn: boolean;

  // ── Localization (Phase 28) ──
  // UI chrome language; astronomical catalog data (target/eyepiece/profile
  // names) stays English by design — see engine/i18n.ts.
  language: 'en' | 'hi';

  // ── Simulation Time Engine (Phase 25; smooth-clock split in Phase 29) ──
  // simTime is the LOW-FREQUENCY React-visible mirror of the continuous
  // clock in engine/timeEngine (synced ~1×/sec by App.tsx). Render loops
  // that need millisecond-smooth time call getSmoothSimTime() directly.
  simTime: number;   // simulated epoch ms — drives all ephemeris math
  timeRate: number;  // playback multiplier: 1× | 10× | 60×
  // Sidereal tracking motor: when ON the mount continuously follows
  // trackedEquatorial (the RA/Dec captured at engage time) as simTime moves.
  isTrackingMotorOn: boolean;
  trackedEquatorial: { ra: number; dec: number } | null;
  // ── Drift gentling anchor (Phase 33) ──
  // Epoch-ms moment the simulation modes' driftMultiplier gentling counts
  // from (see skyGeometry.getDriftGentledSimTime). Re-anchored whenever the
  // drift-fighting situation changes — target lock, motor toggle, ±1 Hour
  // steps — so gentling only ever slows PASSIVE drift accumulated since
  // then, never the student's own slews or deliberate time jumps.
  driftAnchorSimTime: number;

  // ── Virtual Night (Phase 29) ──
  // Forces a dark sky render regardless of the Sun's actual position, so
  // daytime students can still see stars. Not persisted — a fresh session
  // always shows the true sky.
  isVirtualNight: boolean;

  // ── Onboarding Tour (Phase 30) ──
  // 0 = inactive/hidden; 1+ = which spotlighted step is showing. The total
  // step count (and what each step points at) is UI-layer knowledge owned
  // by components/ui/OnboardingTour.tsx, not the store — its "Finish"
  // button calls endTour() directly on the last step rather than the store
  // needing to know where the tour ends. Not persisted: a fresh session
  // always starts with the tour closed.
  tourStep: number;

  // Actions
  addCustomProfile: (profile: TelescopeProfile) => void;
  setActiveProfile: (profileId: string) => void;
  setEyepiece: (id: string) => void;
  setFocuserPosition: (pos: number) => void;
  toggleDustCap: () => void;
  toggleSolarFilter: () => void;
  setTarget: (targetId: string) => void;
  clearTarget: () => void;
  setPointing: (alt: number, az: number) => void;
  setObserverLocation: (location: ObserverLocation) => void;
  setAlignmentDifficulty: (difficulty: AlignmentDifficulty) => void;
  scrambleFinderscope: () => void;
  adjustFinderscope: (deltaAlt: number, deltaAz: number) => void;
  syncSimTime: () => void;
  stepSimTimeHours: (hours: number) => void;
  /** Snap the simulation clock back to the real-world present moment. */
  resetSimTimeToNow: () => void;
  /** Jump the simulation clock straight to an arbitrary epoch-ms moment (Phase 44 Time Machine). */
  setSimTime: (ms: number) => void;
  setTimeRate: (rate: number) => void;
  toggleVirtualNight: () => void;
  startTour: () => void;
  advanceTour: () => void;
  endTour: () => void;
  toggleTrackingMotor: () => void;
  setSimulationMode: (mode: SimulationMode) => void;
  toggleDigitalZoom: () => void;
  setLanguage: (language: 'en' | 'hi') => void;
  setAltTensionLocked: (locked: boolean) => void;
  setMechanicallyBalanced: (balanced: boolean) => void;
  setCollimated: (collimated: boolean) => void;
  setSeeingQuality: (quality: number) => void;
  setMirrorCooled: (cooled: boolean) => void;
  setLowPerformanceDevice: (isLow: boolean) => void;
  setHighPerformanceMode: (enabled: boolean) => void;
  setIsFocuserDragging: (dragging: boolean) => void;
  toggleBarlow: () => void;
  setLoadedAssets: (assets: LoadedAssets) => void;
  toggleAltLocked: () => void;
  toggleAzLocked: () => void;
  setEqMeridianDanger: (danger: boolean) => void;
}

export const useTelescopeStore = create<TelescopeState>()(
  persist(
    (set, get) => ({
      availableProfiles: TELESCOPE_PROFILES_LIST,
      activeProfile: TELESCOPE_PROFILES.dobsonian8,
      activeTarget: TARGETS.moon,
      eyepieceFocalLength: 25, // Default 25mm eyepiece — kept synced by setEyepiece
      activeEyepieceId: DEFAULT_EYEPIECE_ID,
      testedEyepieceIds: [],
      focuserPosition: 50, // Default to perfect focus
      
      seeingQuality: 3, // Antoniadi scale 1-5
      isDustCapOn: true,
      isSolarFilterAttached: false,
      isMirrorCooled: true,
      isAltTensionLocked: true,
      isMechanicallyBalanced: true,
      isCollimated: true,
      isLowPerformanceDevice: false,
      isHighPerformanceMode: false,
      isFocuserDragging: false,
      isBarlowActive: false,

      // Assets start null; App.tsx populates this after preloadAssets() resolves
      loadedAssets: null,

      // Default observer location: Jaipur, India (Vatsalya's home base)
      observerLocation: DEFAULT_OBSERVER_LOCATION,

      // Finderscope starts perfectly aligned until scrambleFinderscope() is called
      alignmentDifficulty: 'easy',
      finderscopeError: { deltaAlt: 0, deltaAz: 0 },

      // Default to the forgiving-but-honest middle mode for new students
      simulationMode: 'easy',
      isDigitalZoomOn: false,

      language: 'en',

      // Simulation clock starts at the real current time, 1× playback, motor off
      simTime: INITIAL_SIM_TIME,
      timeRate: 1,
      isTrackingMotorOn: false,
      trackedEquatorial: null,
      driftAnchorSimTime: INITIAL_SIM_TIME,
      isVirtualNight: false,
      tourStep: 0,

      // 3D pointing defaults to wherever the default target (Moon) lives
      pointingAlt: INITIAL_POINTING.altitude,
      pointingAz: INITIAL_POINTING.azimuth,
      isAltLocked: false,
      isAzLocked: false,
      isEqMeridianDanger: false,

      addCustomProfile: (profile) => set((state) => ({
        availableProfiles: [...state.availableProfiles, profile],
        activeProfile: profile // Auto-select the newly added profile
      })),
      setActiveProfile: (profileId) => {
        const { availableProfiles } = get();
        const profile = availableProfiles.find(p => p.id === profileId) || TELESCOPE_PROFILES.dobsonian8;
        set({ activeProfile: profile });
      },
      // ── Global Eyepiece Selector (Phase 27, P27.3) ──
      // Updates the ID and the legacy numeric focal-length field atomically,
      // and records the ID in testedEyepieceIds so the 'optics_master'
      // achievement (test all 4) tracks usage from ANY mode, not just one tab.
      setEyepiece: (id) => {
        const eyepiece = EYEPIECE_CATALOG.find((e) => e.id === id)
          ?? EYEPIECE_CATALOG.find((e) => e.id === DEFAULT_EYEPIECE_ID)!;
        set((state) => ({
          activeEyepieceId: eyepiece.id,
          eyepieceFocalLength: eyepiece.focalLengthMm,
          testedEyepieceIds: state.testedEyepieceIds.includes(eyepiece.id)
            ? state.testedEyepieceIds
            : [...state.testedEyepieceIds, eyepiece.id],
        }));
        if (get().testedEyepieceIds.length >= EYEPIECE_CATALOG.length) {
          useProgressStore.getState().unlockAchievement('optics_master');
        }
      },
      setFocuserPosition: (pos) => set({ focuserPosition: Math.max(0, Math.min(100, pos)) }),
      toggleDustCap: () => set((state) => ({ isDustCapOn: !state.isDustCapOn })),
      toggleSolarFilter: () => set((state) => ({ isSolarFilterAttached: !state.isSolarFilterAttached })),
      setTarget: (targetId) => {
        const target = TARGETS[targetId] || TARGETS.moon;
        // Bridge: slewing to a new target (e.g. "Slew to Moon") also moves
        // the 3D telescope's Alt-Az pointing — computed from the target's
        // RA/Dec, the observer's location, and the simulation time.
        const { observerLocation, simTime, isTrackingMotorOn } = get();
        const pointing = computePointing(target, observerLocation, new Date(simTime));
        // A running motor re-locks onto the new pointing direction: celestial
        // targets get their exact RA/Dec (the Sun its LIVE ephemeris RA/Dec,
        // Phase 35); terrestrial anchors get whatever RA/Dec currently passes
        // through them (so the motor drags off it).
        let trackedEquatorial = get().trackedEquatorial;
        if (isTrackingMotorOn) {
          trackedEquatorial =
            getBodyEquatorial(target, simTime)
              ?? convertHorizontalToRaDec(
                  pointing.altitude, pointing.azimuth,
                  observerLocation.latitude, observerLocation.longitude,
                  new Date(simTime)
                );
        }
        set({
          activeTarget: target,
          pointingAlt: pointing.altitude,
          pointingAz: pointing.azimuth,
          trackedEquatorial,
          // Fresh lock = fresh drift: the target starts centered, so gentled
          // drift (Phase 33) counts from this exact moment.
          driftAnchorSimTime: simTime,
        });
        // Fun mode: the motor engages itself on every slew (perfect tracking).
        if (SIM_MODE_RULES[get().simulationMode].motorAutoOn && !get().isTrackingMotorOn) {
          get().toggleTrackingMotor();
        }
      },
      // Drops the target lock without moving the mount. Phase 35: also
      // re-anchors the drift-gentled clock — the released body switches from
      // the gentled targetSimTime to the starfield's true clock (see
      // skyRenderer.drawUniversalSkyBodies), and anchoring at the release
      // moment makes the two clocks equal right then, so the body stays
      // painted where it was instead of jumping by the accumulated gentling.
      clearTarget: () => set({ activeTarget: null, driftAnchorSimTime: get().simTime }),
      setPointing: (alt, az) => {
        const clampedAlt = Math.max(0, Math.min(90, alt));
        const wrappedAz = ((az % 360) + 360) % 360;
        const { isTrackingMotorOn, observerLocation, simTime } = get();
        set({
          pointingAlt: clampedAlt,
          pointingAz: wrappedAz,
          // Manual slewing while the motor runs MOVES THE LOCK instead of
          // fighting it — otherwise the next clock tick would snap the mount
          // back to the previously tracked RA/Dec (Phase 26 audit fix 4a).
          ...(isTrackingMotorOn
            ? {
                trackedEquatorial: convertHorizontalToRaDec(
                  clampedAlt, wrappedAz,
                  observerLocation.latitude, observerLocation.longitude,
                  new Date(simTime)
                ),
              }
            : {}),
        });
      },
      setObserverLocation: (location) => {
        set({ observerLocation: location });
        // Re-slew to the current target so the 3D pointing reflects the new location.
        const { activeTarget, simTime } = get();
        if (activeTarget) {
          const pointing = computePointing(activeTarget, location, new Date(simTime));
          set({ pointingAlt: pointing.altitude, pointingAz: pointing.azimuth });
        }
      },
      // ── Simulation Time Engine (Phase 25; smooth clock in Phase 29) ──
      // The continuous clock lives in engine/timeEngine; this action samples
      // it into the store so React UI (telemetry clock, horizon chips)
      // updates at the driver's low cadence (~1 Hz from App.tsx) while
      // canvases interpolate per-frame via getSmoothSimTime().
      syncSimTime: () => {
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = get();
        const newTime = getSmoothSimTime();
        set({
          simTime: newTime,
          ...pointingAfterTimeShift(isTrackingMotorOn, trackedEquatorial, observerLocation, newTime),
        });
      },
      stepSimTimeHours: (hours) => {
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = get();
        const newTime = getSmoothSimTime() + hours * 3_600_000;
        reanchorTimeEngine(newTime);
        set({
          simTime: newTime,
          // Deliberate time jumps show their full effect — drift gentling
          // (Phase 33) restarts from the stepped-to moment.
          driftAnchorSimTime: newTime,
          ...pointingAfterTimeShift(isTrackingMotorOn, trackedEquatorial, observerLocation, newTime),
        });
        // Phase 32: running the clock while locked on Jupiter IS Galileo's
        // moons-in-motion experiment — the Jovian-system lesson's completion
        // signal (curriculum.ts achievementId; unlockAchievement is idempotent).
        if (get().activeTarget?.id === 'jupiter') {
          useProgressStore.getState().unlockAchievement('jovian_observer');
        }
      },
      // ── Present Time (Phase 39) ── Snap the clock back to the real "now."
      // Same discontinuity discipline as stepSimTimeHours: re-anchor the smooth
      // time engine, re-anchor the drift-gentling clock so passive drift counts
      // from this instant, and re-derive the mount's pointing if the motor is
      // tracking. Playback rate is left untouched — "now" answers WHEN, not how
      // fast time flows.
      resetSimTimeToNow: () => {
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = get();
        const newTime = Date.now();
        reanchorTimeEngine(newTime);
        set({
          simTime: newTime,
          driftAnchorSimTime: newTime,
          ...pointingAfterTimeShift(isTrackingMotorOn, trackedEquatorial, observerLocation, newTime),
        });
      },
      // ── Time Machine (Phase 44) ── Jump straight to an arbitrary moment
      // (e.g. a different century) picked via the telemetry panel's
      // datetime-local input. Same discontinuity discipline as the ±1 Hour
      // steps and "Now" above: re-anchor the smooth clock, re-anchor the
      // drift-gentling clock, and re-derive the mount's pointing if the
      // sidereal motor is tracking.
      setSimTime: (ms) => {
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = get();
        reanchorTimeEngine(ms);
        set({
          simTime: ms,
          driftAnchorSimTime: ms,
          ...pointingAfterTimeShift(isTrackingMotorOn, trackedEquatorial, observerLocation, ms),
        });
      },
      setTimeRate: (rate) => {
        // Re-anchor at the current smooth moment so a rate change scales the
        // clock FROM NOW instead of retroactively re-slope-ing the past.
        // Floor of 0 (not 1): Phase 41's Pause button passes 0 to freeze
        // the clock — see the matching floor in engine/timeEngine.ts.
        const clamped = Math.max(0, rate);
        reanchorTimeEngine(getSmoothSimTime(), clamped);
        set({ timeRate: clamped });
        // Accelerated playback on Jupiter counts the same as stepping (above);
        // 1× is a return to normal, not an advance.
        if (clamped > 1 && get().activeTarget?.id === 'jupiter') {
          useProgressStore.getState().unlockAchievement('jovian_observer');
        }
      },
      toggleVirtualNight: () => set((state) => ({ isVirtualNight: !state.isVirtualNight })),
      startTour: () => set({ tourStep: 1 }),
      advanceTour: () => set((state) => ({ tourStep: state.tourStep + 1 })),
      endTour: () => set({ tourStep: 0 }),
      toggleTrackingMotor: () => {
        const { isTrackingMotorOn, pointingAlt, pointingAz, observerLocation, simTime } = get();
        if (isTrackingMotorOn) {
          // Disengage: passive drift starts NOW — re-anchor the gentled
          // clock (Phase 33) so Easy/Fun modes gentle only what accumulates
          // from this moment, not the whole tracked session.
          set({ isTrackingMotorOn: false, trackedEquatorial: null, driftAnchorSimTime: simTime });
          return;
        }
        // Engage: freeze the mount's CURRENT sky direction in the equatorial
        // frame. The motor then follows that RA/Dec as simTime advances —
        // celestial targets hold still, ground targets drift out of view.
        const eq = convertHorizontalToRaDec(
          pointingAlt, pointingAz,
          observerLocation.latitude, observerLocation.longitude,
          new Date(simTime)
        );
        set({ isTrackingMotorOn: true, trackedEquatorial: eq, driftAnchorSimTime: simTime });
      },
      setSimulationMode: (mode) => {
        const previous = get().simulationMode;
        if (previous === mode) return;
        const rules = SIM_MODE_RULES[mode];
        set({
          simulationMode: mode,
          // Fun pins alignment perfect; leaving Fun keeps whatever error existed (0).
          ...(rules.finderErrorForcedZero ? { finderscopeError: { deltaAlt: 0, deltaAz: 0 } } : {}),
          // Digital zoom only exists in modes that allow it.
          ...(!rules.digitalZoomAvailable ? { isDigitalZoomOn: false } : {}),
        });
        // Motor side-effects: Fun auto-engages; leaving Fun disengages so the
        // student returns to a predictable manual state.
        const { isTrackingMotorOn } = get();
        if (rules.motorAutoOn && !isTrackingMotorOn) get().toggleTrackingMotor();
        else if (!rules.motorAutoOn && previous === 'fun' && isTrackingMotorOn) get().toggleTrackingMotor();
      },
      toggleDigitalZoom: () => {
        const { simulationMode, isDigitalZoomOn } = get();
        if (!SIM_MODE_RULES[simulationMode].digitalZoomAvailable) {
          set({ isDigitalZoomOn: false });
          return;
        }
        set({ isDigitalZoomOn: !isDigitalZoomOn });
      },
      setLanguage: (language) => set({ language }),
      setAlignmentDifficulty: (difficulty) => set({ alignmentDifficulty: difficulty }),
      scrambleFinderscope: () => {
        const { alignmentDifficulty, simulationMode } = get();
        // Fun mode pins the finder at perfect alignment — Scramble is a no-op.
        if (SIM_MODE_RULES[simulationMode].finderErrorForcedZero) {
          set({ finderscopeError: { deltaAlt: 0, deltaAz: 0 } });
          return;
        }
        if (alignmentDifficulty === 'auto') {
          // 'auto' = GoTo-style self-aligning finder: no error, ever.
          set({ finderscopeError: { deltaAlt: 0, deltaAz: 0 } });
          return;
        }
        const [min, max] = FINDER_ERROR_RANGES[alignmentDifficulty];
        const randomError = () =>
          (min + Math.random() * (max - min)) * (Math.random() < 0.5 ? -1 : 1);
        set({ finderscopeError: { deltaAlt: randomError(), deltaAz: randomError() } });
      },
      adjustFinderscope: (deltaAlt, deltaAz) =>
        set((state) => ({
          finderscopeError: {
            deltaAlt: state.finderscopeError.deltaAlt + deltaAlt,
            deltaAz: state.finderscopeError.deltaAz + deltaAz,
          },
        })),
      setAltTensionLocked: (locked) => set({ isAltTensionLocked: locked }),
      setMechanicallyBalanced: (balanced) => set({ isMechanicallyBalanced: balanced }),
      setCollimated: (collimated) => set({ isCollimated: collimated }),
      setSeeingQuality: (quality) => set({ seeingQuality: Math.max(1, Math.min(5, quality)) }),
      setMirrorCooled: (cooled: boolean) => set({ isMirrorCooled: cooled }),
      setLowPerformanceDevice: (isLow: boolean) => set({ isLowPerformanceDevice: isLow }),
      setHighPerformanceMode: (enabled: boolean) => set({ isHighPerformanceMode: enabled }),
      setIsFocuserDragging: (dragging: boolean) => set({ isFocuserDragging: dragging }),
      toggleBarlow: () => set((state) => ({ isBarlowActive: !state.isBarlowActive })),
      setLoadedAssets: (assets: LoadedAssets) => set({ loadedAssets: assets }),
      toggleAltLocked: () => set((state) => ({ isAltLocked: !state.isAltLocked })),
      toggleAzLocked: () => set((state) => ({ isAzLocked: !state.isAzLocked })),
      setEqMeridianDanger: (danger) => set({ isEqMeridianDanger: danger }),
    }),
    {
      name: 'telescope-equipment-storage', // persist to localStorage
      // Exclude the non-serializable asset cache AND the simulation clock —
      // reopening the app should always start at the real current time with
      // the motor disengaged, not resume a stale simulated moment.
      partialize: (state) => {
        const {
          loadedAssets: _assets,
          simTime: _simTime,
          timeRate: _timeRate,
          isTrackingMotorOn: _motor,
          trackedEquatorial: _tracked,
          isVirtualNight: _virtualNight,
          tourStep: _tourStep,
          driftAnchorSimTime: _driftAnchor,
          isAltLocked: _altLocked,
          isAzLocked: _azLocked,
          isEqMeridianDanger: _eqDanger,
          ...rest
        } = state;
        return rest;
      },
      // ── Stale-snapshot repair (Phase 26 audit fix 4b) ──
      // activeTarget persists as a full object; when the TARGETS catalog gains
      // fields (angularDiameterDeg, ra/dec…) or corrects data, rehydrate the
      // live catalog entry by ID so stale copies never shadow fresh data.
      merge: (persistedState, currentState) => {
        const merged = { ...currentState, ...(persistedState as Partial<TelescopeState>) };
        if (merged.activeTarget) {
          merged.activeTarget = TARGETS[merged.activeTarget.id] ?? merged.activeTarget;
        }
        // ── Eyepiece-ID backfill (Phase 27, P27.3) ──
        // Sessions persisted before activeEyepieceId existed only have the
        // legacy eyepieceFocalLength number. Map that forward to the closest
        // catalog ID instead of silently resetting returning users to 25mm.
        if (!merged.activeEyepieceId || !EYEPIECE_CATALOG.some((e) => e.id === merged.activeEyepieceId)) {
          const matched = EYEPIECE_CATALOG.find((e) => e.focalLengthMm === merged.eyepieceFocalLength);
          const fallback = EYEPIECE_CATALOG.find((e) => e.id === DEFAULT_EYEPIECE_ID)!;
          merged.activeEyepieceId = (matched ?? fallback).id;
          merged.eyepieceFocalLength = (matched ?? fallback).focalLengthMm;
        }
        return merged;
      },
    }
  )
);
