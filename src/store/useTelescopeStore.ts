import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TELESCOPE_PROFILES, TELESCOPE_PROFILES_LIST } from '../engine/constants';
import { TARGETS } from '../data/bookContent';
import { convertEquatorialToHorizontal, convertHorizontalToRaDec } from '../engine/ephemerisMath';
import { SIM_MODE_RULES, type SimulationMode } from '../engine/simulationModes';
import { TERRESTRIAL_POINTING, getBodyEquatorial } from '../engine/skyGeometry';
import { EYEPIECE_CATALOG, DEFAULT_EYEPIECE_ID } from '../engine/opticalMath';
import { getSmoothSimTime, reanchorTimeEngine, setTimeAssistScale } from '../engine/timeEngine';
import {
  DARK_ADAPTATION_FULL_MS,
  DARK_ADAPTATION_LOSS_RATE,
  DARK_ADAPTATION_SKY_DARKNESS_MIN,
  DEFAULT_TRANSPARENCY,
  TRANSPARENCY_MAX,
  TRANSPARENCY_MIN,
  getSkyState,
} from '../engine/daylight';
import { useProgressStore } from './useProgressStore';
import type { CollimationSpec, MirrorCell, TelescopeProfile, Target } from '../types';
import type { LoadedAssets } from '../engine/assetLoader';
import {
  createPersistStorage, isRecord, pickPersisted, sanitizeBoolean, sanitizeEnum, sanitizeNumber, sanitizeStringArray,
} from './persistGuards';

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

/** Which onboarding walkthrough is running — see `tourTrack` below (Phase 60). */
export type TourTrack = 'basic' | 'advanced';

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
  const eq = getBodyEquatorial(target, time.getTime(), observer);
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

/**
 * ── Dark adaptation clock (Phase 59) ──
 * Accumulates SIMULATED time spent under a genuinely dark sky and bleeds it
 * back off (much faster) under a bright one — see engine/daylight for the
 * physiology and why the session starts fully adapted. Any single time shift
 * is capped at one full adaptation span, so a Time-Machine jump of a century
 * doesn't turn into a meaningless enormous number; a backwards jump leaves
 * the eye exactly as it was, since un-observing is not a thing.
 */
function adaptationAfterTimeShift(
  current: number,
  previousSimTime: number,
  newSimTime: number,
  observer: ObserverLocation,
  isVirtualNight: boolean
): number {
  const elapsed = newSimTime - previousSimTime;
  if (elapsed <= 0) return current;
  const step = Math.min(elapsed, DARK_ADAPTATION_FULL_MS);
  const sky = getSkyState(observer.latitude, observer.longitude, newSimTime, isVirtualNight);
  if (sky.darkness >= DARK_ADAPTATION_SKY_DARKNESS_MIN) {
    return Math.min(DARK_ADAPTATION_FULL_MS, current + step);
  }
  return Math.max(0, current - step * DARK_ADAPTATION_LOSS_RATE);
}

/**
 * ── Drift assist (Phase 66) ──
 * How fast the whole sky turns relative to the chosen playback rate. Easy and
 * Fun gentle the PASSIVE drift of an untracked sky (driftMultiplier 0.35 / 0);
 * once the motor is tracking there is no drift left to gentle, so the sky
 * runs true. Applied to the one clock in engine/timeEngine, which re-anchors
 * on every change — toggling the motor or switching mode can never make the
 * sky jump, and no consumer can end up on a different clock.
 */
function timeAssistScaleFor(mode: SimulationMode, isTrackingMotorOn: boolean): number {
  const drift = SIM_MODE_RULES[mode]?.driftMultiplier ?? 1;
  return isTrackingMotorOn || drift >= 1 ? 1 : drift;
}

/**
 * RA/Dec a running motor should hold after the mount has been aimed at
 * `target`: the body's own coordinates (the Sun and the topocentric Moon from
 * their live ephemerides), or — for a ground-anchored target — whatever
 * RA/Dec currently passes through the pointing, so the motor drags off it.
 */
function motorLockFor(
  target: Target,
  pointing: { altitude: number; azimuth: number },
  observer: ObserverLocation,
  timeMs: number
): { ra: number; dec: number } {
  return getBodyEquatorial(target, timeMs, observer)
    ?? convertHorizontalToRaDec(pointing.altitude, pointing.azimuth, observer.latitude, observer.longitude, new Date(timeMs));
}

/** The Alt/Az ↔ RA/Dec formulas divide by cos(latitude); keep the site off the exact poles. */
const MAX_OBSERVER_LATITUDE_DEG = 89.9;

/** A usable observer location, or null. Valid in-range values pass through untouched (city lookup matches exactly). */
function sanitizeObserverLocation(value: unknown): ObserverLocation | null {
  if (!isRecord(value)) return null;
  const { latitude, longitude } = value;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90) return null;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 360) return null;
  return {
    latitude: Math.abs(latitude) <= MAX_OBSERVER_LATITUDE_DEG
      ? latitude
      : Math.sign(latitude) * MAX_OBSERVER_LATITUDE_DEG,
    longitude: longitude >= -180 && longitude <= 180 ? longitude : ((longitude + 180) % 360 + 360) % 360 - 180,
  };
}

const PROFILE_TYPES: readonly TelescopeProfile['type'][] = [
  'Dobsonian', 'Newtonian EQ', 'Refractor', 'SCT', 'Maksutov', 'Binoculars', 'Smart',
];

function sanitizeMirrorCell(value: unknown): MirrorCell | undefined {
  if (!isRecord(value)) return undefined;
  const cell: MirrorCell = {
    screwCircleRadiusMm: sanitizeNumber(value.screwCircleRadiusMm, Number.NaN, 0.1, 1000),
    threadPitchMm: sanitizeNumber(value.threadPitchMm, Number.NaN, 0.01, 10),
    screwPhaseDeg: sanitizeNumber(value.screwPhaseDeg, Number.NaN, -360, 360),
    beamDeviationGain: sanitizeNumber(value.beamDeviationGain, Number.NaN, 0.1, 100),
    pistonFocusGain: sanitizeNumber(value.pistonFocusGain, Number.NaN, 0, 1000),
  };
  return Object.values(cell).every(Number.isFinite) ? cell : undefined;
}

function sanitizeCollimationSpec(value: unknown): CollimationSpec | undefined {
  if (!isRecord(value)) return undefined;
  const primary = sanitizeMirrorCell(value.primary);
  const secondary = sanitizeMirrorCell(value.secondary);
  if (!primary && !secondary) return undefined;
  return { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}) };
}

/**
 * ── Profile schema repair (Phase 55; shape-checked Phase 66) ──
 * Built-in profiles always come back from the live catalog, which alone
 * fixes any corruption in their stored copies. A custom (user-built) profile
 * is rebuilt field by field from whatever validates — a null entry, a bare
 * string, or a record with garbage fields can never reach the optics math.
 * Returns null for "drop this entry". focalRatio is re-derived, never
 * trusted (Phase 55); the legacy isInvertedView boolean (true→'inverted',
 * false→'mirrored' — every pre-Phase-55 isInvertedView:false profile was in
 * practice a mirrored scope) backfills a missing viewOrientation.
 */
function repairProfile(value: unknown): TelescopeProfile | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 100 ? value.id : null;
  if (!id) return null;
  const builtIn = TELESCOPE_PROFILES[id];
  if (builtIn) return builtIn;
  const aperture = sanitizeNumber(value.aperture, TELESCOPE_PROFILES.dobsonian8.aperture, 1, 10000);
  const focalLength = sanitizeNumber(value.focalLength, TELESCOPE_PROFILES.dobsonian8.focalLength, 1, 100000);
  const collimation = sanitizeCollimationSpec(value.collimation);
  return {
    id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name.slice(0, 80) : 'Custom Telescope',
    type: sanitizeEnum(value.type, PROFILE_TYPES, 'Newtonian EQ'),
    aperture,
    focalLength,
    focalRatio: Number((focalLength / aperture).toFixed(1)),
    centralObstruction: sanitizeNumber(value.centralObstruction, 0, 0, 99),
    viewOrientation: sanitizeEnum(
      value.viewOrientation,
      ['correct', 'inverted', 'mirrored'] as const,
      value.isInvertedView === true ? 'inverted' : 'mirrored'
    ),
    hasGoTo: sanitizeBoolean(value.hasGoTo, false),
    mountType: sanitizeEnum(value.mountType, ['Alt-Az', 'Equatorial'] as const, 'Alt-Az'),
    ...(collimation ? { collimation } : {}),
  };
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
  /**
   * Sky transparency, 1 (milky) to 5 (pristine) — Phase 59. Deliberately the
   * OPPOSITE polarity to the Antoniadi seeing scale above, because that is the
   * convention in both cases; see engine/daylight for why the two are separate
   * measurements and what each one costs you at the eyepiece.
   */
  transparency: number;
  /**
   * Accumulated simulated darkness, in ms, toward DARK_ADAPTATION_FULL_MS
   * (Phase 59). Not persisted: a returning observer's eyes are their own, and
   * a fresh session always starts night-adapted.
   */
  darkAdaptationMs: number;
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
  // that need millisecond-smooth time call getSmoothSimTime() directly, and
  // so does every action that captures a position (GoTo, motor engage,
  // slews, location changes) — the mirror can be a second or more behind.
  // Since Phase 66 this is the ONE astronomical clock: the modes' drift
  // assist slows the clock itself (see timeAssistScaleFor), so there is no
  // separate "gentled" sky time to drift out of agreement with it.
  simTime: number;   // simulated epoch ms — drives all ephemeris math
  timeRate: number;  // playback multiplier chosen by the user: 0 (paused) | 1× | 10× | 60×
  // Sidereal tracking motor: when ON the mount continuously follows
  // trackedEquatorial (the RA/Dec captured at engage time) as simTime moves.
  isTrackingMotorOn: boolean;
  trackedEquatorial: { ra: number; dec: number } | null;

  /**
   * Physical solar exposure of the optics (Phase 66), published by the live
   * eyepiece loop only when it CHANGES. The instructor's safety message reads
   * it, so the warning follows where the tube (or its finder) actually
   * points, not which item the target menu has selected. Not persisted.
   */
  isSunInOptics: boolean;
  /**
   * The Astrophotography desk's "Mount Tracking Lock" (Phase 66: lifted out
   * of LiveViewPanel's local state so the Orion mission can check it). Not
   * persisted — a new session starts with the lock off.
   */
  isAstroTrackingLocked: boolean;

  // ── Virtual Night (Phase 29) ──
  // Forces a dark sky render regardless of the Sun's actual position, so
  // daytime students can still see stars. Not persisted — a fresh session
  // always shows the true sky.
  isVirtualNight: boolean;

  // ── GoTo suppression (Phase 59) ──
  // Set while a mission teaches STAR-HOPPING: selecting a target still locks
  // onto it (the reticle, the telemetry, the rules engine all keep working)
  // but the mount does NOT slew there — the student has to find it themselves,
  // hopping from a bright naked-eye star through the finder. Without this a
  // single click on the target menu hands them the answer, which is the exact
  // habit the lesson exists to break. Not persisted: it belongs to a running
  // mission, and a reopened app should never start with a mysteriously dead
  // GoTo button.
  isGoToSuppressed: boolean;

  // ── Onboarding Tour (Phase 30; two tracks in Phase 60) ──
  // 0 = inactive/hidden; 1+ = which spotlighted step is showing. The total
  // step count (and what each step points at) is UI-layer knowledge owned
  // by components/ui/OnboardingTour.tsx, not the store — its "Finish"
  // button calls endTour() directly on the last step rather than the store
  // needing to know where the tour ends. Not persisted: a fresh session
  // always starts with the tour closed.
  tourStep: number;
  // Which walkthrough is running. 'basic' is the first-visit orientation
  // (what the buttons do); 'advanced' is the Phase 60 tour of the physics
  // that has accumulated since — collimation, counterweight torque,
  // transparency, dark adaptation. Kept as a separate field rather than an
  // offset into one long step list so neither track can ever renumber the
  // other, and so the step counter reads honestly ("3 of 6", not "14 of 17").
  tourTrack: TourTrack;

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
  startTour: (track?: TourTrack) => void;
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
  setTransparency: (transparency: number) => void;
  /** Wipe the observer's night vision — a white-light event (Phase 59). */
  resetDarkAdaptation: () => void;
  setGoToSuppressed: (suppressed: boolean) => void;
  setSunInOptics: (exposed: boolean) => void;
  setAstroTrackingLocked: (locked: boolean) => void;
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

/**
 * The saved instrument (Phase 66: an explicit allow-list, used by BOTH
 * partialize and merge). Everything else is live-session state: the clock and
 * motor, pointing and finder error, the eye's adaptation, a mission's GoTo
 * lockout, tour progress, clutch locks, and transient flags such as a focuser
 * drag in progress or a mirror still cooling (a reload mid-cooldown used to
 * persist `false` with no timer left to clear it).
 */
const PERSISTED_TELESCOPE_KEYS = [
  'availableProfiles', 'activeProfile', 'activeTarget', 'eyepieceFocalLength', 'activeEyepieceId',
  'testedEyepieceIds', 'focuserPosition', 'seeingQuality', 'transparency',
  'isDustCapOn', 'isSolarFilterAttached', 'isAltTensionLocked', 'isMechanicallyBalanced', 'isCollimated',
  'isLowPerformanceDevice', 'isHighPerformanceMode', 'isBarlowActive', 'isDigitalZoomOn',
  'observerLocation', 'alignmentDifficulty', 'simulationMode', 'language',
] as const satisfies readonly (keyof TelescopeState)[];

type PersistedTelescopeState = Pick<TelescopeState, (typeof PERSISTED_TELESCOPE_KEYS)[number]>;

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
      transparency: DEFAULT_TRANSPARENCY, // 5 = pristine (the identity case)
      // The observer arrives already night-adapted; only a white-light event
      // or a spell of daylight takes it away.
      darkAdaptationMs: DARK_ADAPTATION_FULL_MS,
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
      isSunInOptics: false,
      isAstroTrackingLocked: false,
      isVirtualNight: false,
      isGoToSuppressed: false,
      tourStep: 0,
      tourTrack: 'basic',

      // 3D pointing defaults to wherever the default target (Moon) lives
      pointingAlt: INITIAL_POINTING.altitude,
      pointingAz: INITIAL_POINTING.azimuth,
      isAltLocked: false,
      isAzLocked: false,
      isEqMeridianDanger: false,

      // Phase 55: focalRatio is re-derived here from the raw aperture/focalLength
      // rather than trusted as passed in — the two numbers are the physical
      // ground truth, and storing a ratio computed elsewhere (or hand-edited)
      // risks it silently desyncing from them.
      addCustomProfile: (profile) => {
        const derivedProfile: TelescopeProfile = {
          ...profile,
          focalRatio: profile.aperture > 0 ? Number((profile.focalLength / profile.aperture).toFixed(1)) : 0,
        };
        set((state) => ({
          availableProfiles: [...state.availableProfiles, derivedProfile],
          activeProfile: derivedProfile, // Auto-select the newly added profile
        }));
      },
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
        const target = Object.prototype.hasOwnProperty.call(TARGETS, targetId) ? TARGETS[targetId] : TARGETS.moon;
        // Bridge: slewing to a new target (e.g. "Slew to Moon") also moves
        // the 3D telescope's Alt-Az pointing — computed from the target's
        // RA/Dec, the observer's location, and the simulation time. The LIVE
        // clock (Phase 66), not the ~1 Hz mirror: at 60× the mirror can be a
        // simulated minute stale, which parked a "centered" target off-field.
        const { observerLocation, isTrackingMotorOn, isGoToSuppressed } = get();
        const now = getSmoothSimTime();
        const pointing = computePointing(target, observerLocation, new Date(now));

        // ── Star-hopping (Phase 59) ── With GoTo suppressed the mount does
        // NOT move. The target is still locked, so the reticle, the offset
        // readout, the rules engine and mission evaluation all keep working —
        // but finding it is the student's job, hopping through the finder from
        // a bright star they can already see.
        const { pointingAlt: heldAlt, pointingAz: heldAz } = get();
        const nextAlt = isGoToSuppressed ? heldAlt : pointing.altitude;
        const nextAz = isGoToSuppressed ? heldAz : pointing.azimuth;

        // A running motor re-locks onto the new pointing direction: celestial
        // targets get their exact RA/Dec (the Sun its LIVE ephemeris RA/Dec,
        // Phase 35); terrestrial anchors get whatever RA/Dec currently passes
        // through them (so the motor drags off it). With GoTo suppressed the
        // motor must hold the direction the tube is ACTUALLY pointing, not the
        // target's — otherwise engaging it would slew there by the back door.
        let trackedEquatorial = get().trackedEquatorial;
        if (isTrackingMotorOn) {
          trackedEquatorial = isGoToSuppressed
            ? convertHorizontalToRaDec(
                nextAlt, nextAz,
                observerLocation.latitude, observerLocation.longitude,
                new Date(now)
              )
            : motorLockFor(target, pointing, observerLocation, now);
        }
        // No clock bookkeeping here (Phase 66): there is one sky clock, so a
        // new lock cannot shift the sky — the old per-lock drift anchor made
        // every Easy-mode target change jump the whole sky by the drift
        // assist accumulated since the previous one.
        set({
          activeTarget: target,
          pointingAlt: nextAlt,
          pointingAz: nextAz,
          trackedEquatorial,
        });
        // Fun mode: the motor engages itself on every slew (perfect tracking).
        if (SIM_MODE_RULES[get().simulationMode].motorAutoOn && !get().isTrackingMotorOn) {
          get().toggleTrackingMotor();
        }
      },
      // Drops the target lock without moving the mount — or the sky: the
      // released body keeps being drawn from the same clock as everything else.
      clearTarget: () => set({ activeTarget: null }),
      setPointing: (alt, az) => {
        // A non-finite pointing would poison every projection downstream.
        if (!Number.isFinite(alt) || !Number.isFinite(az)) return;
        const clampedAlt = Math.max(0, Math.min(90, alt));
        const wrappedAz = ((az % 360) + 360) % 360;
        const { isTrackingMotorOn, observerLocation } = get();
        set({
          pointingAlt: clampedAlt,
          pointingAz: wrappedAz,
          // Manual slewing while the motor runs MOVES THE LOCK instead of
          // fighting it — otherwise the next clock tick would snap the mount
          // back to the previously tracked RA/Dec (Phase 26 audit fix 4a).
          // Captured against the live clock: this is the sky on screen now.
          ...(isTrackingMotorOn
            ? {
                trackedEquatorial: convertHorizontalToRaDec(
                  clampedAlt, wrappedAz,
                  observerLocation.latitude, observerLocation.longitude,
                  new Date(getSmoothSimTime())
                ),
              }
            : {}),
        });
      },
      // ── Observing-site change (Phase 66 semantics) ──
      // With a target locked AND GoTo available, the mount re-slews to it from
      // the new site — what a GoTo mount does after re-alignment — and a
      // running motor re-locks onto the target's coordinates there (for the
      // Moon that is a different TOPOCENTRIC RA/Dec, up to a degree away).
      // Otherwise the aim is preserved: a tracking mount keeps holding the
      // same sky coordinates, a stationary one keeps its physical Alt/Az. A
      // star-hopping mission's GoTo lockout can therefore no longer be
      // side-stepped by switching city. One set() keeps observer, pointing
      // and motor lock consistent with each other.
      setObserverLocation: (location) => {
        const next = sanitizeObserverLocation(location);
        if (!next) return;
        const s = get();
        if (next.latitude === s.observerLocation.latitude && next.longitude === s.observerLocation.longitude) return;
        const now = getSmoothSimTime();
        let pointingAlt = s.pointingAlt;
        let pointingAz = s.pointingAz;
        let trackedEquatorial = s.trackedEquatorial;
        if (s.activeTarget && !s.isGoToSuppressed) {
          const p = computePointing(s.activeTarget, next, new Date(now));
          pointingAlt = p.altitude;
          pointingAz = p.azimuth;
          if (s.isTrackingMotorOn) trackedEquatorial = motorLockFor(s.activeTarget, p, next, now);
        } else if (s.isTrackingMotorOn && s.trackedEquatorial) {
          const p = convertEquatorialToHorizontal(
            s.trackedEquatorial.ra, s.trackedEquatorial.dec, next.latitude, next.longitude, new Date(now)
          );
          pointingAlt = p.altitude;
          pointingAz = p.azimuth;
        }
        set({ observerLocation: next, pointingAlt, pointingAz, trackedEquatorial });
      },
      // ── Simulation Time Engine (Phase 25; smooth clock in Phase 29) ──
      // The continuous clock lives in engine/timeEngine; this action samples
      // it into the store so React UI (telemetry clock, horizon chips)
      // updates at the driver's low cadence (~1 Hz from App.tsx) while
      // canvases interpolate per-frame via getSmoothSimTime().
      syncSimTime: () => {
        const state = get();
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = state;
        const newTime = getSmoothSimTime();
        set({
          simTime: newTime,
          // Phase 59: this ~1 Hz sample is also the eye's clock — dark
          // adaptation is measured in SIMULATED time, so it runs with the
          // sky rather than with the wall clock (60× playback adapts you in
          // twenty real seconds, exactly as it compresses everything else).
          darkAdaptationMs: adaptationAfterTimeShift(
            state.darkAdaptationMs, state.simTime, newTime, observerLocation, state.isVirtualNight
          ),
          ...pointingAfterTimeShift(isTrackingMotorOn, trackedEquatorial, observerLocation, newTime),
        });
      },
      stepSimTimeHours: (hours) => {
        const state = get();
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = state;
        const newTime = getSmoothSimTime() + hours * 3_600_000;
        reanchorTimeEngine(newTime);
        // A deliberate jump moves the one sky clock by exactly the hour asked
        // for; playback rate and drift assist carry on unchanged.
        set({
          simTime: newTime,
          darkAdaptationMs: adaptationAfterTimeShift(
            state.darkAdaptationMs, state.simTime, newTime, observerLocation, state.isVirtualNight
          ),
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
      // time engine and re-derive the mount's pointing if the motor is
      // tracking. Playback rate and drift assist are left untouched — "now"
      // answers WHEN, not how fast time flows.
      resetSimTimeToNow: () => {
        const state = get();
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = state;
        const newTime = Date.now();
        reanchorTimeEngine(newTime);
        set({
          simTime: newTime,
          darkAdaptationMs: adaptationAfterTimeShift(
            state.darkAdaptationMs, state.simTime, newTime, observerLocation, state.isVirtualNight
          ),
          ...pointingAfterTimeShift(isTrackingMotorOn, trackedEquatorial, observerLocation, newTime),
        });
      },
      // ── Time Machine (Phase 44) ── Jump straight to an arbitrary moment
      // (e.g. a different century) picked via the telemetry panel's
      // datetime-local input. Same discontinuity discipline as the ±1 Hour
      // steps and "Now" above: re-anchor the smooth clock and re-derive the
      // mount's pointing if the sidereal motor is tracking.
      setSimTime: (ms) => {
        if (!Number.isFinite(ms)) return;
        const state = get();
        const { isTrackingMotorOn, trackedEquatorial, observerLocation } = state;
        reanchorTimeEngine(ms);
        set({
          simTime: ms,
          darkAdaptationMs: adaptationAfterTimeShift(
            state.darkAdaptationMs, state.simTime, ms, observerLocation, state.isVirtualNight
          ),
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
      startTour: (track = 'basic') => set({ tourStep: 1, tourTrack: track }),
      advanceTour: () => set((state) => ({ tourStep: state.tourStep + 1 })),
      endTour: () => set({ tourStep: 0 }),
      toggleTrackingMotor: () => {
        const { isTrackingMotorOn, pointingAlt, pointingAz, observerLocation, simulationMode } = get();
        if (isTrackingMotorOn) {
          // Disengage: the mount stops where it is and passive drift resumes —
          // at the mode's assisted rate, continuously from this instant.
          set({ isTrackingMotorOn: false, trackedEquatorial: null });
          setTimeAssistScale(timeAssistScaleFor(simulationMode, false));
          return;
        }
        // Engage: freeze the mount's CURRENT sky direction in the equatorial
        // frame, against the live clock — exactly the sky on screen right now
        // (the ~1 Hz mirror could be a simulated minute old at 60×). The
        // motor then follows that RA/Dec as time advances: celestial targets
        // hold still, ground targets drift out of view.
        const eq = convertHorizontalToRaDec(
          pointingAlt, pointingAz,
          observerLocation.latitude, observerLocation.longitude,
          new Date(getSmoothSimTime())
        );
        set({ isTrackingMotorOn: true, trackedEquatorial: eq });
        setTimeAssistScale(timeAssistScaleFor(simulationMode, true));
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
        // The new mode's drift assist applies from this instant on — never
        // retroactively (the old anchor-based gentling re-sloped the time
        // since the last lock, jumping the sky on every mode switch).
        setTimeAssistScale(timeAssistScaleFor(mode, get().isTrackingMotorOn));
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
      setTransparency: (transparency) =>
        set({ transparency: Math.max(TRANSPARENCY_MIN, Math.min(TRANSPARENCY_MAX, transparency)) }),
      // Guarded so an edge-triggered caller that fires twice (or a render loop
      // that calls this every frame while the hazard persists) can't spray a
      // fresh state object — and a re-render — through the whole app.
      resetDarkAdaptation: () => {
        if (get().darkAdaptationMs !== 0) set({ darkAdaptationMs: 0 });
      },
      setGoToSuppressed: (suppressed) => {
        if (get().isGoToSuppressed !== suppressed) set({ isGoToSuppressed: suppressed });
      },
      // Edge-only writes: called from a render loop, so a no-op must stay a no-op.
      setSunInOptics: (exposed) => {
        if (get().isSunInOptics !== exposed) set({ isSunInOptics: exposed });
      },
      setAstroTrackingLocked: (locked) => {
        if (get().isAstroTrackingLocked !== locked) set({ isAstroTrackingLocked: locked });
      },
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
      // Dedupes unchanged snapshots and coalesces slider drags into one
      // trailing write (Phase 66) — see createPersistStorage for the flush
      // and failure rules. Pointing/clock updates never reach the disk.
      storage: createPersistStorage<PersistedTelescopeState>({ coalesceMs: 400 }),
      partialize: (state) => {
        const saved: Partial<PersistedTelescopeState> = {};
        for (const key of PERSISTED_TELESCOPE_KEYS) (saved as Record<string, unknown>)[key] = state[key];
        return saved as PersistedTelescopeState;
      },
      // ── Stale-snapshot repair (Phase 26 audit fix 4b; hardened Phase 65/66) ──
      // Only allow-listed keys are read back (a saved key can no longer
      // overwrite an action or live-session field), and every one is
      // re-validated: a stale build, a hand edit, or a value that was NaN when
      // written (JSON has no NaN, so it round-trips as `null`) must never
      // reach render code — nothing downstream guards against NaN, and an
      // invalid enum like simulationMode throws in half a dozen components.
      // A field missing from the snapshot keeps its fresh default.
      merge: (persistedState, currentState) => {
        const saved = pickPersisted<PersistedTelescopeState>(persistedState, PERSISTED_TELESCOPE_KEYS);
        const merged: TelescopeState = { ...currentState };

        merged.focuserPosition = sanitizeNumber(saved.focuserPosition, currentState.focuserPosition, 0, 100);
        merged.seeingQuality = sanitizeNumber(saved.seeingQuality, currentState.seeingQuality, 1, 5);
        merged.transparency = sanitizeNumber(saved.transparency, DEFAULT_TRANSPARENCY, TRANSPARENCY_MIN, TRANSPARENCY_MAX);
        merged.observerLocation = sanitizeObserverLocation(saved.observerLocation) ?? currentState.observerLocation;
        merged.simulationMode = sanitizeEnum(saved.simulationMode, ['fun', 'easy', 'realistic'] as const, currentState.simulationMode);
        merged.alignmentDifficulty = sanitizeEnum(
          saved.alignmentDifficulty, ['auto', 'easy', 'medium', 'realistic'] as const, currentState.alignmentDifficulty
        );
        merged.language = sanitizeEnum(saved.language, ['en', 'hi'] as const, currentState.language);
        merged.testedEyepieceIds = 'testedEyepieceIds' in saved
          ? sanitizeStringArray(saved.testedEyepieceIds, EYEPIECE_CATALOG.map((e) => e.id))
          : currentState.testedEyepieceIds;

        merged.isDustCapOn = sanitizeBoolean(saved.isDustCapOn, currentState.isDustCapOn);
        merged.isSolarFilterAttached = sanitizeBoolean(saved.isSolarFilterAttached, currentState.isSolarFilterAttached);
        merged.isAltTensionLocked = sanitizeBoolean(saved.isAltTensionLocked, currentState.isAltTensionLocked);
        merged.isMechanicallyBalanced = sanitizeBoolean(saved.isMechanicallyBalanced, currentState.isMechanicallyBalanced);
        merged.isCollimated = sanitizeBoolean(saved.isCollimated, currentState.isCollimated);
        merged.isLowPerformanceDevice = sanitizeBoolean(saved.isLowPerformanceDevice, currentState.isLowPerformanceDevice);
        merged.isHighPerformanceMode = sanitizeBoolean(saved.isHighPerformanceMode, currentState.isHighPerformanceMode);
        merged.isBarlowActive = sanitizeBoolean(saved.isBarlowActive, currentState.isBarlowActive);
        merged.isDigitalZoomOn = sanitizeBoolean(saved.isDigitalZoomOn, false)
          && SIM_MODE_RULES[merged.simulationMode].digitalZoomAvailable;

        // activeTarget persists as a full object; resolve it against the live
        // catalog by ID so catalog fixes are never shadowed by a stale copy.
        // A corrupted or unknown entry means "no target lock", a state the
        // app already treats as fully valid.
        if ('activeTarget' in saved) {
          const t: unknown = saved.activeTarget;
          merged.activeTarget = isRecord(t) && typeof t.id === 'string' && Object.prototype.hasOwnProperty.call(TARGETS, t.id)
            ? TARGETS[t.id]
            : null;
        }

        // Profiles: built-ins always come from the catalog (and are always
        // offered, even if a snapshot lost them); custom entries are rebuilt
        // by repairProfile, and anything it rejects — null, a string, a
        // record without an id — is dropped instead of crashing the merge.
        const customProfiles: TelescopeProfile[] = [];
        if (Array.isArray(saved.availableProfiles)) {
          for (const entry of saved.availableProfiles as unknown[]) {
            const profile = repairProfile(entry);
            if (profile && !TELESCOPE_PROFILES[profile.id] && !customProfiles.some((p) => p.id === profile.id)) {
              customProfiles.push(profile);
            }
          }
        }
        let activeProfile = 'activeProfile' in saved ? repairProfile(saved.activeProfile) : currentState.activeProfile;
        if (!activeProfile) activeProfile = TELESCOPE_PROFILES.dobsonian8;
        if (!TELESCOPE_PROFILES[activeProfile.id]) {
          const listed = customProfiles.find((p) => p.id === activeProfile!.id);
          if (listed) activeProfile = listed;
          else customProfiles.push(activeProfile);
        }
        merged.availableProfiles = [...TELESCOPE_PROFILES_LIST, ...customProfiles];
        merged.activeProfile = activeProfile;

        // ── Eyepiece resync (Phase 27 backfill; hardened Phase 65/66) ──
        // eyepieceFocalLength is DERIVED from activeEyepieceId, so resolve the
        // catalog entry once and let it drive both fields: the saved ID if it
        // is real, else the saved focal length (a pre-Phase-27, ID-less
        // snapshot — previously shadowed by the fresh default ID), else the
        // default.
        const resolvedEyepiece =
          EYEPIECE_CATALOG.find((e) => e.id === saved.activeEyepieceId) ??
          EYEPIECE_CATALOG.find((e) => e.focalLengthMm === saved.eyepieceFocalLength) ??
          EYEPIECE_CATALOG.find((e) => e.id === currentState.activeEyepieceId) ??
          EYEPIECE_CATALOG.find((e) => e.id === DEFAULT_EYEPIECE_ID)!;
        merged.activeEyepieceId = resolvedEyepiece.id;
        merged.eyepieceFocalLength = resolvedEyepiece.focalLengthMm;

        return merged;
      },
    }
  )
);

// ── Post-hydration session start (Phase 66) ─────────────────────────
// localStorage hydration is synchronous, so the saved instrument is in place
// by the time create() returns. Three things depend on it:
//   • the initial Moon pointing was computed for the DEFAULT site; a saved
//     site elsewhere would otherwise start the tube aimed at an arbitrary
//     patch of that site's sky;
//   • Fun mode promises a motor that "engages automatically on startup"
//     (motorAutoOn) — without it a returning Fun-mode session began untracked
//     with a frozen sky;
//   • the drift assist must match the restored mode and motor state.
{
  const s = useTelescopeStore.getState();
  const loc = s.observerLocation;
  if (loc.latitude !== DEFAULT_OBSERVER_LOCATION.latitude || loc.longitude !== DEFAULT_OBSERVER_LOCATION.longitude) {
    const p = computePointing(TARGETS.moon, loc, new Date(getSmoothSimTime()));
    useTelescopeStore.setState({ pointingAlt: p.altitude, pointingAz: p.azimuth });
  }
  if (SIM_MODE_RULES[s.simulationMode].motorAutoOn && !s.isTrackingMotorOn) s.toggleTrackingMotor();
  const after = useTelescopeStore.getState();
  setTimeAssistScale(timeAssistScaleFor(after.simulationMode, after.isTrackingMotorOn));
}
