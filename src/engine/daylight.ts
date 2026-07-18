import { getSunAltitudeDeg } from './ephemerisMath';

/**
 * Daylight Engine (Phase 29) — atmospheric scattering, simplified.
 * ─────────────────────────────────────────────────────────────────
 * One shared ramp maps the Sun's altitude to what the sky looks like, used
 * by BOTH the 2D eyepiece/finder canvases (skyRenderer background) and the
 * 3D observatory dome (scene background + fog). The stops follow the real
 * twilight ladder:
 *
 *   sun alt ≥ +8°   full daylight (Rayleigh blue)
 *        +8…0°      sunset/sunrise warm wash
 *         0…−6°     civil twilight (deep blue, brightest stars emerge)
 *        −6…−12°    nautical twilight
 *       −12…−18°    astronomical twilight
 *        ≤ −18°     true night — #050510, the app's historical space black
 *
 * `darkness` (0 = full day … 1 = astronomical night) gates star visibility:
 * the catalog starfield fades in through twilight exactly the way the real
 * sky does — Sirius first, faint stars only after astronomical dusk.
 */

export interface SkyState {
  /** Effective sun altitude in degrees (after any Virtual Night override). */
  sunAltDeg: number;
  /** CSS color for the sky background at this sun altitude. */
  skyColor: string;
  /** 0 = full daylight … 1 = astronomical night. Drives star visibility. */
  darkness: number;
}

/** Sun altitude forced by the Virtual Night toggle — safely past astronomical dusk. */
export const VIRTUAL_NIGHT_SUN_ALT_DEG = -30;

type Rgb = [number, number, number];

// (sunAltDeg, color) stops, descending altitude. Linear-interpolated between.
const SKY_RAMP: [number, Rgb][] = [
  [8, [116, 178, 234]],   // full day — Rayleigh blue
  [0, [204, 141, 94]],    // sun on the horizon — warm sunset wash
  [-6, [52, 62, 110]],    // civil dusk — deep blue hour
  [-12, [18, 24, 52]],    // nautical
  [-18, [5, 5, 16]],      // astronomical night = historical '#050510'
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rampColor(sunAltDeg: number): Rgb {
  if (sunAltDeg >= SKY_RAMP[0][0]) return SKY_RAMP[0][1];
  const last = SKY_RAMP[SKY_RAMP.length - 1];
  if (sunAltDeg <= last[0]) return last[1];
  for (let i = 0; i < SKY_RAMP.length - 1; i++) {
    const [altHi, colorHi] = SKY_RAMP[i];
    const [altLo, colorLo] = SKY_RAMP[i + 1];
    if (sunAltDeg <= altHi && sunAltDeg >= altLo) {
      const t = (altHi - sunAltDeg) / (altHi - altLo);
      return [
        Math.round(lerp(colorHi[0], colorLo[0], t)),
        Math.round(lerp(colorHi[1], colorLo[1], t)),
        Math.round(lerp(colorHi[2], colorLo[2], t)),
      ];
    }
  }
  return last[1];
}

/** Sky color for an (effective) sun altitude — shared by 2D canvases and the 3D dome. */
export function skyColorForSunAlt(sunAltDeg: number): string {
  const [r, g, b] = rampColor(sunAltDeg);
  return `rgb(${r},${g},${b})`;
}

/** 0 (day) → 1 (astronomical night), ramping through the whole twilight ladder. */
export function skyDarknessForSunAlt(sunAltDeg: number): number {
  if (sunAltDeg >= 0) return 0;
  if (sunAltDeg <= -18) return 1;
  return -sunAltDeg / 18;
}

/**
 * Per-star visibility through twilight: bright stars pierce civil dusk,
 * faint ones need true darkness. Returns a draw alpha, 0 = invisible.
 */
export function starAlpha(magnitude: number, darkness: number): number {
  if (darkness <= 0) return 0;
  // Threshold: at darkness d, stars brighter than ~(d × 7.5 − 1.5) mag show.
  const limitingMag = darkness * 7.5 - 1.5;
  if (magnitude > limitingMag) return 0;
  const brightnessFactor = Math.max(0.25, Math.min(1, 1.25 - magnitude * 0.14));
  return Math.min(1, darkness * 1.4) * brightnessFactor;
}

/**
 * The one-call summary used by render loops. `virtualNight` (the Environment
 * HUD toggle) forces a dark sky regardless of the actual sun position, so
 * daytime students can still see stars.
 */
export function getSkyState(
  latDeg: number,
  lonDeg: number,
  simTimeMs: number,
  virtualNight: boolean
): SkyState {
  const sunAltDeg = virtualNight
    ? VIRTUAL_NIGHT_SUN_ALT_DEG
    : getSunAltitudeDeg(latDeg, lonDeg, simTimeMs);
  return {
    sunAltDeg,
    skyColor: skyColorForSunAlt(sunAltDeg),
    darkness: skyDarknessForSunAlt(sunAltDeg),
  };
}
