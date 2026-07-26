import type { MirrorCell, TelescopeProfile } from '../types';

// ── Mirror cells (Phase 57) ────────────────────────────────────────
// The physical three-screw mounts engine/collimation.ts turns into tilt and
// piston. Named separately from the profiles below so the numbers read as
// what they are: hardware specs of a particular cell, not tuning knobs.

/**
 * 8" Dobsonian primary: a 200mm mirror in a cast cell, three M5 (0.8mm pitch)
 * collimation bolts on a 90mm bolt circle just inside the glass. A flat
 * mirror doubles its own tilt into the beam (gain 2), and translating it
 * axially carries its focal plane along 1:1.
 */
const DOB_PRIMARY_CELL: MirrorCell = {
  screwCircleRadiusMm: 90,
  threadPitchMm: 0.8,
  screwPhaseDeg: 90,
  beamDeviationGain: 2,
  pistonFocusGain: 1,
};

/**
 * The same scope's diagonal: a 50mm minor-axis flat on a three-vane spider,
 * three M3 (0.5mm pitch) screws on a cramped 12mm circle — which is exactly
 * why the diagonal feels twitchier than the primary despite the same optical
 * gain. Its cell travels along the tube axis, so only the 45° fold's
 * projection (cos 45° ≈ 0.7) of that travel lengthens the optical path.
 */
const DOB_SECONDARY_CELL: MirrorCell = {
  screwCircleRadiusMm: 12,
  threadPitchMm: 0.5,
  screwPhaseDeg: -90,
  beamDeviationGain: 2,
  pistonFocusGain: 0.707,
};

/**
 * SCT secondary: the classic three 6-32 screws (1/32" = 0.794mm pitch) on the
 * corrector-plate housing. The convex secondary is a ~5× amplifier, so it
 * multiplies its own reflection gain (2 × 5 = 10) — a Schmidt-Cassegrain is
 * an order of magnitude touchier to collimate than a Newtonian, and the same
 * amplification (M² + 1 ≈ 26) means every collimation tweak visibly shifts
 * focus too. An SCT primary is factory-set and has no user screws at all.
 */
const SCT_SECONDARY_CELL: MirrorCell = {
  screwCircleRadiusMm: 16,
  threadPitchMm: 0.794,
  screwPhaseDeg: 90,
  beamDeviationGain: 10,
  pistonFocusGain: 26,
};

export const TELESCOPE_PROFILES: Record<string, TelescopeProfile> = {
  dobsonian8: {
    id: 'dobsonian8',
    name: '8" Dobsonian Reflector',
    type: 'Dobsonian',
    aperture: 200,       // 8 inches ~ 200mm
    focalLength: 1200,   // Typical f/6
    focalRatio: 6,
    centralObstruction: 25, // 25% by diameter
    viewOrientation: 'inverted',
    hasGoTo: false,
    mountType: 'Alt-Az',
    collimation: { primary: DOB_PRIMARY_CELL, secondary: DOB_SECONDARY_CELL },
  },
  refractor60: {
    id: 'refractor60',
    name: '60mm Beginner Refractor',
    type: 'Refractor',
    aperture: 60,
    focalLength: 700,
    focalRatio: 11.6,
    centralObstruction: 0,
    viewOrientation: 'mirrored',
    hasGoTo: false,
    mountType: 'Alt-Az',
    // No `collimation` key: a cemented achromatic doublet in a fixed cell has
    // nothing the owner can (or should) adjust.
  },
  sct14: {
    id: 'sct14',
    name: '14" SCT Observatory Scope',
    type: 'SCT',
    aperture: 355,       // 14 inches ~ 355mm
    focalLength: 3910,   // f/11 standard SCT
    focalRatio: 11,
    centralObstruction: 33, // SCTs have larger central obstruction
    viewOrientation: 'mirrored',
    hasGoTo: true,
    mountType: 'Equatorial',
    // Secondary only — an SCT's primary is set at the factory and has no
    // user-accessible screws (see SCT_SECONDARY_CELL).
    collimation: { secondary: SCT_SECONDARY_CELL },
  },
};

/** Ordered array for the UI selector — controls display order */
export const TELESCOPE_PROFILES_LIST = [
  TELESCOPE_PROFILES.dobsonian8,
  TELESCOPE_PROFILES.refractor60,
  TELESCOPE_PROFILES.sct14,
];

export interface ObservingCity {
  id: string;
  name: string;
  /** Degrees, north-positive. */
  latitude: number;
  /** Degrees, east-positive (matches ephemerisMath.ts's convention). */
  longitude: number;
}

/**
 * A few major cities for the observing-location selector (Settings ›
 * Observing Location). Jaipur's coordinates MUST exactly match
 * useTelescopeStore's DEFAULT_OBSERVER_LOCATION (26.9124, 75.7873) — the
 * app's default location and TelemetryPanel's displayed site name are both
 * derived by matching the store's observerLocation against this list.
 */
export const CITIES: ObservingCity[] = [
  { id: 'jaipur', name: 'Jaipur, India', latitude: 26.9124, longitude: 75.7873 },
  { id: 'newyork', name: 'New York, USA', latitude: 40.7128, longitude: -74.006 },
  { id: 'london', name: 'London, UK', latitude: 51.5074, longitude: -0.1278 },
  { id: 'sydney', name: 'Sydney, Australia', latitude: -33.8688, longitude: 151.2093 },
  { id: 'tokyo', name: 'Tokyo, Japan', latitude: 35.6762, longitude: 139.6503 },
];
