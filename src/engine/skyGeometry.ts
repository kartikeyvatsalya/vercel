import { convertEquatorialToHorizontal, getSunEquatorial, getJulianDate } from './ephemerisMath';
import type { Target } from '../types';

/**
 * Sky Geometry (Phase 27, P27.1)
 * ─────────────────────────────────────────────────────────────────
 * Shared math for projecting "where a target actually is" against "where
 * the mount points" onto a 2D eyepiece canvas. Promoted out of
 * FinderscopeGame so the unified LiveViewPanel (and any future optical
 * view) can share one implementation instead of re-deriving it.
 */

/**
 * Fixed horizontal-grid anchor for terrestrial targets (e.g. the Distant
 * Tower): unlike celestial objects, terrestrial targets don't move with
 * Earth's rotation — they're bolted to the ground at a constant Alt/Az.
 * Re-exported from useTelescopeStore for backward compatibility with
 * existing call sites.
 */
export const TERRESTRIAL_POINTING = { alt: 45, az: 180 };

/** Wraps a degree delta into (-180, 180], so "358° away" reads as "-2° away." */
export const wrap180 = (deg: number): number => ((deg + 180) % 360 + 360) % 360 - 180;

/**
 * ── Universal body ephemeris resolution (Phase 35) ──
 * The single authority for "where is this catalog body on the celestial
 * sphere at simTime." Every celestial body is a static catalog snapshot
 * except the Sun: the daylight engine already drives the sky's brightness
 * from the LIVE low-precision solar ephemeris (getSunEquatorial), so the
 * Sun's rendered/slewed-to position must come from the same source —
 * otherwise stepping simTime a few days could draw a sun glyph above the
 * horizon of a sky whose brightness says the sun has set.
 * Returns null for bodies with no equatorial anchor (terrestrial targets).
 */
export function getBodyEquatorial(target: Target, simTimeMs: number): { ra: number; dec: number } | null {
  if (target.type === 'terrestrial') return null;
  if (target.id === 'sun') return getSunEquatorial(getJulianDate(new Date(simTimeMs)));
  if (target.ra === undefined || target.dec === undefined) return null;
  return { ra: target.ra, dec: target.dec };
}

/**
 * ── Coordinate-frame rule (Phase 25) ──
 * Angular offset between where the target actually IS at simTime and where
 * the mount POINTS. Celestial targets are equatorial-anchored, so this
 * offset grows as the Earth turns (unless the motor drives the mount);
 * terrestrial targets are ground-anchored and only move if the MOUNT moves.
 * Returns null for targets with no ephemeris data (they render centered).
 * Coordinates resolve through getBodyEquatorial (Phase 35), so the Sun's
 * offset tracks the live solar ephemeris here and in every consumer.
 */
export function computeSkyOffsetDeg(
  target: Target,
  pointingAlt: number,
  pointingAz: number,
  latitude: number,
  longitude: number,
  simTime: number
): { dAlt: number; dAz: number } | null {
  if (target.type === 'terrestrial') {
    return {
      dAlt: TERRESTRIAL_POINTING.alt - pointingAlt,
      dAz: wrap180(TERRESTRIAL_POINTING.az - pointingAz),
    };
  }
  const eq = getBodyEquatorial(target, simTime);
  if (!eq) return null;
  const pos = convertEquatorialToHorizontal(eq.ra, eq.dec, latitude, longitude, new Date(simTime));
  return { dAlt: pos.altitude - pointingAlt, dAz: wrap180(pos.azimuth - pointingAz) };
}

// Cap the rendered sky offset so a target hours off-axis doesn't produce
// absurd canvas coordinates — beyond ~6 fields it's simply out of view.
export const clampSkyPx = (px: number): number => Math.max(-2000, Math.min(2000, px));

/**
 * Projects an angular sky offset onto a square canvas of `viewportPx` side
 * length, given the view's true field of view. Pure angular truth — the
 * simulation modes' drift gentling happens in TIME (see
 * getDriftGentledSimTime below), never by scaling this projection.
 */
export function projectSkyOffsetPx(
  offset: { dAlt: number; dAz: number } | null,
  trueFovDeg: number,
  viewportPx: number
): { px: number; py: number } {
  if (!offset || trueFovDeg <= 0) return { px: 0, py: 0 };
  return {
    px: clampSkyPx((offset.dAz / trueFovDeg) * viewportPx),
    py: clampSkyPx((-offset.dAlt / trueFovDeg) * viewportPx),
  };
}

/**
 * ── Drift gentling in TIME, not space (Phase 33) ──
 * The simulation modes' driftMultiplier used to scale the projected target
 * offset itself (projectSkyOffsetPx's old `scale` param). That conflated two
 * very different motions: the slow PASSIVE drift of an untracked sky (the
 * thing "Easy" mode should gentle) and the student's own DELIBERATE mount
 * slews — which got scaled too, so in Fun mode (×0) a locked target sat
 * pinned to the crosshair however far you slewed, and in Easy (×0.35) it
 * visibly lagged the starfield in the finder ("frozen finderscope").
 *
 * The fix: gentle the target's EPHEMERIS CLOCK instead. The rendered offset
 * is targetPosition(gentledTime) − rawPointing, so mount motion always maps
 * 1:1 onto the view (both feeds pan honestly during any slew) while the
 * sky's own rotation is slowed to `driftScale` of true rate.
 *
 *   • Motor ON (or Realistic's scale 1): true time — the motor already
 *     cancels drift, and gentling a tracked clock would make the mount
 *     appear to drag the view off its own target.
 *   • Motor OFF: time flows at driftScale from `driftAnchorSimTime` — the
 *     store re-anchors it on target locks, motor toggles, and ±1 Hour steps
 *     (deliberate time jumps should show their full, honest effect).
 */
export function getDriftGentledSimTime(
  simTime: number,
  driftAnchorSimTime: number,
  driftScale: number,
  isTrackingMotorOn: boolean
): number {
  if (isTrackingMotorOn || driftScale >= 1) return simTime;
  return driftAnchorSimTime + (simTime - driftAnchorSimTime) * driftScale;
}
