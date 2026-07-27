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

// ── Transparency (Phase 59) ────────────────────────────────────────
// Seeing and transparency are the two independent numbers every observing
// report carries, and beginners conflate them constantly. SEEING is how
// STEADY the air is — it smears fine detail at high power and it is what the
// Antoniadi slider already models. TRANSPARENCY is how CLEAR the air is —
// haze, dust, humidity and thin cirrus scatter light out of the beam, which
// costs magnitudes rather than arcseconds. A night can easily be superb for
// Saturn and useless for a galaxy, or the reverse, and that is exactly the
// lesson the two sliders exist to separate.
//
// Deliberate polarity note: the Antoniadi seeing scale runs 1 = perfect to
// 5 = boiling, which is backwards from intuition. Transparency runs the other
// way (5 = pristine, 1 = milky) because that IS the amateur convention, so
// the UI labels both sliders in words as well as numbers.
//
// The scale is anchored at 5 = the identity: everything this renderer drew
// before Phase 59 was implicitly a pristine mountaintop sky, so a transparency
// of 5 changes nothing and the slider can only ever take light away — which
// is all haze does.

export const TRANSPARENCY_MIN = 1;
export const TRANSPARENCY_MAX = 5;
/** Pristine — the historical (and identity) case. */
export const DEFAULT_TRANSPARENCY = TRANSPARENCY_MAX;

/** Extinction cost of one step down the transparency scale, in magnitudes. */
export const TRANSPARENCY_MAG_PER_STEP = 0.5;

export const TRANSPARENCY_LABELS: Record<number, string> = {
  5: 'Pristine',
  4: 'Clear',
  3: 'Average',
  2: 'Hazy',
  1: 'Milky',
};

/** Magnitudes of extinction relative to a pristine sky. */
export function transparencyExtinctionMag(transparency: number): number {
  const t = Math.max(TRANSPARENCY_MIN, Math.min(TRANSPARENCY_MAX, transparency));
  return (TRANSPARENCY_MAX - t) * TRANSPARENCY_MAG_PER_STEP;
}

/** Throughput multiplier for a point source (a star) under this transparency. */
export function transparencyThroughput(transparency: number): number {
  return Math.pow(10, -0.4 * transparencyExtinctionMag(transparency));
}

// ── Dark adaptation (Phase 59) ─────────────────────────────────────
// The rods in a human retina take roughly twenty minutes in the dark to reach
// full sensitivity, and a single glance at a white light throws all of it
// away in an instant. Every observer learns this the hard way, usually by
// checking their phone halfway through a session.
//
// Modelled as accumulated SIMULATED dark time, so the fix is the one a real
// observer uses: wait (or run the clock forward). The session STARTS fully
// adapted — you arrived at the eyepiece already night-eyed — so this only
// bites after an actual white-light event or a spell of daylight, which is
// precisely when it has something to teach.

/** Simulated milliseconds of darkness for full rod adaptation. */
export const DARK_ADAPTATION_FULL_MS = 20 * 60 * 1000;
/** Sky darkness (see skyDarknessForSunAlt) at or above which the eye adapts. */
export const DARK_ADAPTATION_SKY_DARKNESS_MIN = 0.6;
/** Adaptation is lost far faster than it is gained — seconds versus minutes. */
export const DARK_ADAPTATION_LOSS_RATE = 6;
/** Faint-object throughput for a fully LIGHT-adapted eye (cones only). */
export const LIGHT_ADAPTED_FLOOR = 0.35;
/** Limiting-magnitude penalty for a fully light-adapted eye. */
export const DARK_ADAPTATION_MAG_PENALTY = 1.2;

/** Sensitivity multiplier from 0 (just blinded) to 1 (fully dark-adapted). */
export function darkAdaptationThroughput(adaptation: number): number {
  const a = Math.max(0, Math.min(1, adaptation));
  return LIGHT_ADAPTED_FLOOR + (1 - LIGHT_ADAPTED_FLOOR) * a;
}

/**
 * Combined visibility multiplier for FAINT, EXTENDED objects — nebulae and
 * galaxies, whose surface brightness sits within a magnitude or two of the
 * sky background even on a good night. This is what haze and a light-blasted
 * eye actually take from you: not the Moon, not Saturn, but the drizzle.
 * 1.0 under a pristine sky with a dark-adapted eye, so the default session
 * renders exactly as it always has.
 */
export function deepSkyVisibility(transparency: number, darkAdaptation: number): number {
  return Math.max(0, Math.min(1, transparencyThroughput(transparency) * darkAdaptationThroughput(darkAdaptation)));
}

/**
 * How many magnitudes shallower the sky gets — subtracted from the aperture's
 * limiting magnitude, so haze and a light-adapted eye simply delete the
 * faintest field stars rather than dimming everything uniformly. That is what
 * the eye actually experiences: stars do not fade out, they stop being there.
 */
export function faintStarMagPenalty(transparency: number, darkAdaptation: number): number {
  const adaptationPenalty = (1 - Math.max(0, Math.min(1, darkAdaptation))) * DARK_ADAPTATION_MAG_PENALTY;
  return transparencyExtinctionMag(transparency) + adaptationPenalty;
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
