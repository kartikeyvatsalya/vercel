import {
  convertEquatorialToHorizontal, getSunEquatorial, getMoonEquatorial, getJulianDate, degToRad,
  type ObserverGeodetic,
} from './ephemerisMath';
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
export const TERRESTRIAL_POINTING = { alt: 2.0, az: 180 };

/** Wraps a degree delta into (-180, 180], so "358° away" reads as "-2° away." */
export const wrap180 = (deg: number): number => ((deg + 180) % 360 + 360) % 360 - 180;

// ── Per-instant ephemeris memo (Phase 66) ───────────────────────────
// Both 2D feeds, the solar-hazard check and the Moon's phase shading all ask
// for the Sun and Moon at the SAME frame instant; the lunar series alone is a
// few dozen transcendental calls. One remembered answer per body keyed by
// (instant, site) makes every repeat within a frame free. Bounded by
// construction: at most one entry per computed body.
interface EquatorialMemo { timeMs: number; lat: number; lon: number; value: { ra: number; dec: number } }
const sunMemo: { entry: EquatorialMemo | null } = { entry: null };
const moonMemo: { entry: EquatorialMemo | null } = { entry: null };

function memoized(
  memo: { entry: EquatorialMemo | null },
  timeMs: number,
  lat: number,
  lon: number,
  compute: () => { ra: number; dec: number }
): { ra: number; dec: number } {
  const e = memo.entry;
  if (e && e.timeMs === timeMs && e.lat === lat && e.lon === lon) return e.value;
  // Frozen because the same object is handed to every caller for this instant.
  const value = Object.freeze(compute());
  memo.entry = { timeMs, lat, lon, value };
  return value;
}

/** The Sun's RA/Dec at an instant — memoized per instant (see above). */
export function getSunEquatorialAt(simTimeMs: number): { ra: number; dec: number } {
  return memoized(sunMemo, simTimeMs, 0, 0, () => getSunEquatorial(getJulianDate(new Date(simTimeMs))));
}

/**
 * ── Universal body ephemeris resolution (Phase 35; Moon live in 42.8) ──
 * The single authority for "where is this catalog body on the celestial
 * sphere at simTime." Every celestial body is a static catalog snapshot
 * except the Sun and the Moon:
 *   • Sun — the daylight engine already drives the sky's brightness from
 *     the LIVE low-precision solar ephemeris (getSunEquatorial), so the
 *     Sun's rendered/slewed-to position must come from the same source —
 *     otherwise stepping simTime a few days could draw a sun glyph above
 *     the horizon of a sky whose brightness says the sun has set.
 *   • Moon (Phase 42.8) — a static snapshot made real-calendar phase math
 *     impossible (the Moon moves ~13°/day; its terminator is set by the
 *     live Sun–Moon elongation), so it now rides getMoonEquatorial's
 *     low-precision lunar series. Because every consumer — GoTo slews,
 *     the 3D dome billboard, both 2D feeds, the phase renderer, telemetry
 *     altitude — resolves through THIS function, the whole app agrees on
 *     the orbiting Moon by construction.
 *
 * Phase 59: pass `observer` and the Moon comes back TOPOCENTRIC — corrected
 * for the observer's own offset from the Earth's centre, worth up to 57
 * arcminutes (a full lunar diameter). Every call site in the app that knows
 * where the observer is standing passes it, so the whole app agrees on ONE
 * Moon; the argument is optional only so a caller with no location (a pure
 * catalog lookup) still gets a sensible geocentric answer.
 * Returns null for bodies with no equatorial anchor (terrestrial targets).
 */
export function getBodyEquatorial(
  target: Target,
  simTimeMs: number,
  observer?: ObserverGeodetic
): { ra: number; dec: number } | null {
  if (target.type === 'terrestrial') return null;
  if (target.id === 'sun') return getSunEquatorialAt(simTimeMs);
  if (target.id === 'moon') {
    if (!observer) return getMoonEquatorial(simTimeMs);
    return memoized(moonMemo, simTimeMs, observer.latitude, observer.longitude, () => getMoonEquatorial(simTimeMs, observer));
  }
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
  const eq = getBodyEquatorial(target, simTime, { latitude, longitude });
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
 * simulation modes' drift assist acts on the CLOCK (engine/timeEngine),
 * never on this projection.
 *
 * Azimuth offset is scaled by cos(pointingAlt) (Phase 54): azimuth-circle
 * degrees shrink toward the pole (they'd converge to a point at zenith), so
 * an un-scaled dAz stretches the field horizontally — up to 11x near the
 * zenith — instead of matching what a real flat focal plane shows. Every
 * sky layer in skyRenderer uses this same mapping, and (Phase 66) so does
 * every visibility cull there, so nothing is culled that this would place
 * inside the field.
 */
export function projectSkyOffsetPx(
  offset: { dAlt: number; dAz: number } | null,
  pointingAlt: number,
  trueFovDeg: number,
  viewportPx: number
): { px: number; py: number } {
  if (!offset || trueFovDeg <= 0) return { px: 0, py: 0 };
  const azShrink = Math.cos(degToRad(pointingAlt));
  return {
    px: clampSkyPx(((offset.dAz * azShrink) / trueFovDeg) * viewportPx),
    py: clampSkyPx((-offset.dAlt / trueFovDeg) * viewportPx),
  };
}

/**
 * True great-circle separation (deg) between two Alt/Az directions
 * (haversine — well-conditioned for the small angles that matter here).
 * Unlike hypot(dAlt, dAz), it stays correct near the zenith, where a large
 * azimuth difference can be a tiny angle on the sky.
 */
export function angularSeparationDeg(alt1: number, az1: number, alt2: number, az2: number): number {
  const a1 = degToRad(alt1);
  const a2 = degToRad(alt2);
  const sinDAlt = Math.sin((a2 - a1) / 2);
  const sinDAz = Math.sin(degToRad(az2 - az1) / 2);
  const h = sinDAlt * sinDAlt + Math.cos(a1) * Math.cos(a2) * sinDAz * sinDAz;
  return (2 * Math.asin(Math.min(1, Math.sqrt(h))) * 180) / Math.PI;
}

/**
 * The sky direction reached by tilting an optical axis at (alt, az) by small
 * FIELD angles — `dx` toward increasing azimuth (screen right in an upright
 * view), `dy` toward the zenith — measured in the axis's own tangent plane.
 * This is how a finderscope that is mis-aimed by (Δaz, Δalt) relative to the
 * main tube actually points, and unlike alt + dy / az + dx / cos(alt) it stays
 * well defined straight up.
 */
export function offsetHorizontalDirection(
  altDeg: number,
  azDeg: number,
  dxDeg: number,
  dyDeg: number
): { alt: number; az: number } {
  const alt = degToRad(altDeg);
  const az = degToRad(azDeg);
  // Unit vectors in (east, north, up) coordinates.
  const p = [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
  const right = [Math.cos(az), -Math.sin(az), 0];
  const up = [-Math.sin(alt) * Math.sin(az), -Math.sin(alt) * Math.cos(az), Math.cos(alt)];
  const tx = Math.tan(degToRad(dxDeg));
  const ty = Math.tan(degToRad(dyDeg));
  const v = [p[0] + tx * right[0] + ty * up[0], p[1] + tx * right[1] + ty * up[1], p[2] + tx * right[2] + ty * up[2]];
  const n = Math.hypot(v[0], v[1], v[2]);
  const outAlt = Math.asin(Math.max(-1, Math.min(1, v[2] / n)));
  const outAz = Math.atan2(v[0], v[1]);
  return { alt: (outAlt * 180) / Math.PI, az: (((outAz * 180) / Math.PI) % 360 + 360) % 360 };
}

/**
 * Worst-case TRUE angular radius of the sky that the flat Alt/Az projection
 * above maps into a disk of `fieldRadiusDeg` field-degrees around the
 * pointing. Measured numerically (Phase 66) over pointing altitudes from the
 * horizon to the zenith and field radii up to 16°: the ratio never exceeded
 * 1.26 — the azimuth squeeze near the zenith pulls in sky from across the
 * pole-of-the-horizon, but only a little. 1.3× is the bounded, conservative
 * search radius for layers that must enumerate candidates (the procedural
 * field stars); layers that iterate a fixed list test each object exactly.
 */
export function projectedFieldCapRadiusDeg(fieldRadiusDeg: number): number {
  return Math.max(0, fieldRadiusDeg) * 1.3;
}

/**
 * Angular distance from the Sun's centre (deg) within which unfiltered optics
 * are an eye hazard: half the finder's ~7.5° field (the widest optic bolted to
 * the tube — if the Sun is anywhere in the finder, so is the danger) plus the
 * solar radius.
 */
export const SUN_HAZARD_RADIUS_DEG = 4.0;

export interface SolarExposure {
  /** The Sun is within the hazard radius of the MAIN tube's optical axis. */
  main: boolean;
  /** The Sun is within the hazard radius of the FINDERSCOPE's own (possibly mis-aimed) axis. */
  finder: boolean;
}

/**
 * Physical solar exposure of each optic (Phase 66) — true spherical geometry
 * against the live solar ephemeris at the SAME instant the renderer draws the
 * Sun with, for the main tube and, separately, for the finder, whose axis is
 * offset by its alignment error. Only a risen Sun (the renderer's −1° grace)
 * can shine into either. What the menu has selected plays no part here.
 */
export function computeSolarExposure(
  pointing: { alt: number; az: number },
  finderAxisOffsetDeg: { dx: number; dy: number },
  observer: { latitude: number; longitude: number },
  simTimeMs: number
): SolarExposure {
  const sunEq = getSunEquatorialAt(simTimeMs);
  const sun = convertEquatorialToHorizontal(sunEq.ra, sunEq.dec, observer.latitude, observer.longitude, new Date(simTimeMs));
  if (sun.altitude <= -1) return { main: false, finder: false };
  const main = angularSeparationDeg(pointing.alt, pointing.az, sun.altitude, sun.azimuth) < SUN_HAZARD_RADIUS_DEG;
  const finderAxis = offsetHorizontalDirection(pointing.alt, pointing.az, finderAxisOffsetDeg.dx, finderAxisOffsetDeg.dy);
  const finder = angularSeparationDeg(finderAxis.alt, finderAxis.az, sun.altitude, sun.azimuth) < SUN_HAZARD_RADIUS_DEG;
  return { main, finder };
}
