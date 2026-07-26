import type { CollimationSpec, MirrorCell, TelescopeProfile } from '../types';

/**
 * Collimation Physics (Phase 57)
 * ─────────────────────────────────────────────────────────────────
 * Pure geometry, no rendering and no store access, so the whole chain
 * "screw turns → mirror tilt → beam error → what the eyepiece shows" is
 * independently checkable from one file.
 *
 * The central idea is that a three-screw mirror cell is an OVER-determined
 * control for a two-axis problem. Three screws define a plane, and a plane
 * has exactly three degrees of freedom: two tilts and one piston (height).
 * Tilt is the collimation the student is chasing; piston is the focus shift
 * that sneaks in as a side effect — which is why "equal turns on all three"
 * is the standard trick for moving focus without disturbing alignment, and
 * why an uneven set of turns always does both at once. screwsToTilt and
 * screwPiston below are that 3 → (2 + 1) decomposition, nothing more.
 */

/** Turns applied to screws #1/#2/#3 (positive = driven in). */
export type ScrewTriple = readonly [number, number, number];

/** Tilt of a mirror's surface normal, in arcmin, on the cell's own two axes. */
export interface Tilt2 {
  x: number;
  y: number;
}

/** One click of the UI's screw pad: a 15° detent, 24 to the full turn. */
export const SCREW_DETENT_TURNS = 1 / 24;

/** Angular spacing of the three screws — the defining fact of the cell. */
const SCREW_SPACING_DEG = 120;

const RAD_TO_ARCMIN = (180 / Math.PI) * 60;

/** Screen/cell-frame angle (radians) of screw `index` (0-based) on its bolt circle. */
export function screwAngleRad(cell: MirrorCell, index: number): number {
  return ((cell.screwPhaseDeg + index * SCREW_SPACING_DEG) * Math.PI) / 180;
}

/**
 * The 3 → 2 transformation: fit the plane the three screw heights define, and
 * report its slope as a tilt.
 *
 * Screw i sits at (R·cos φᵢ, R·sin φᵢ) and lifts the cell there by
 * zᵢ = turnsᵢ × pitch. The best-fit (here: exact, three points) plane
 * z = a·x + b·y + c has, because the three φᵢ are 120° apart and therefore
 * Σcos φᵢ = Σsin φᵢ = Σcos φᵢ·sin φᵢ = 0 while Σcos²φᵢ = Σsin²φᵢ = 3/2:
 *
 *     a = (2 / 3R) · Σ zᵢ cos φᵢ      b = (2 / 3R) · Σ zᵢ sin φᵢ
 *
 * The slopes a and b ARE the tilt (small-angle: tan θ ≈ θ), and the leftover
 * c is the piston screwPiston returns below. Note the 1/R: the same turn on a
 * cramped 12mm secondary circle tilts the mirror 7.5× harder than on a 90mm
 * primary circle — the physical reason a diagonal feels so much twitchier.
 */
export function screwsToTilt(s: ScrewTriple, cell: MirrorCell): Tilt2 {
  const radius = Math.max(0.1, cell.screwCircleRadiusMm); // guard a degenerate custom cell
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < 3; i++) {
    const z = s[i] * cell.threadPitchMm;
    const phi = screwAngleRad(cell, i);
    sumX += z * Math.cos(phi);
    sumY += z * Math.sin(phi);
  }
  const slopeToArcmin = ((2 / (3 * radius)) * RAD_TO_ARCMIN);
  return { x: sumX * slopeToArcmin, y: sumY * slopeToArcmin };
}

/**
 * The piston half of the same decomposition: the plane's height term c, the
 * mean of the three screw displacements, scaled into a focal-plane shift.
 *
 * Turn all three screws equally and tilt cancels exactly (Σcos φᵢ = 0 above),
 * leaving only this — the cell rides straight up or down its axis and the
 * image goes soft without ever going out of alignment. Returns mm of focal
 * plane travel, signed; pistonFocusGain carries the optical amplification
 * (1 for a translated Newtonian primary, ~26 for a Cassegrain secondary).
 */
export function screwPiston(s: ScrewTriple, cell: MirrorCell): number {
  const meanTravelMm = ((s[0] + s[1] + s[2]) / 3) * cell.threadPitchMm;
  return meanTravelMm * cell.pistonFocusGain;
}

/** Magnitude (arcmin) and screen-frame direction of a tilt vector. */
export function tiltMagnitudeArcmin(tilt: Tilt2): number {
  return Math.hypot(tilt.x, tilt.y);
}

/**
 * Beam error contributed by one cell: its mirror tilt times the cell's own
 * optical gain (a reflection doubles it; a convex secondary also amplifies).
 */
export function cellBeamError(s: ScrewTriple, cell: MirrorCell): Tilt2 {
  const tilt = screwsToTilt(s, cell);
  return { x: tilt.x * cell.beamDeviationGain, y: tilt.y * cell.beamDeviationGain };
}

export interface CollimationField {
  /** Total residual beam error, arcmin — the single number everything else keys off. */
  errorArcmin: number;
  /** Screen-frame direction the error points, radians. Drives the shadow/coma orientation. */
  angleRad: number;
  /** The secondary's own contribution, arcmin (gates the primary in the UI). */
  secondaryArcmin: number;
  /** The primary's own contribution, arcmin. */
  primaryArcmin: number;
  /** Focal-plane shift (mm) the current screw positions have pistoned in. */
  pistonMm: number;
}

const ZERO_FIELD: CollimationField = {
  errorArcmin: 0, angleRad: 0, secondaryArcmin: 0, primaryArcmin: 0, pistonMm: 0,
};

/**
 * The whole optical train at once: both cells' beam errors add as VECTORS,
 * not magnitudes — which is the honest (and pedagogically important) result
 * that a tilted primary can partially cancel a tilted secondary. The scope
 * then looks acceptable on axis while both mirrors sit wrong, and the error
 * reappears the moment anything moves. The UI's secondary-first gate exists
 * precisely to stop students from chasing that false minimum.
 */
export function computeCollimationField(
  primaryScrews: ScrewTriple,
  secondaryScrews: ScrewTriple,
  spec: CollimationSpec | undefined
): CollimationField {
  if (!spec) return ZERO_FIELD;
  const primary = spec.primary ? cellBeamError(primaryScrews, spec.primary) : { x: 0, y: 0 };
  const secondary = spec.secondary ? cellBeamError(secondaryScrews, spec.secondary) : { x: 0, y: 0 };
  const x = primary.x + secondary.x;
  const y = primary.y + secondary.y;
  return {
    errorArcmin: Math.hypot(x, y),
    angleRad: Math.atan2(y, x),
    primaryArcmin: tiltMagnitudeArcmin(primary),
    secondaryArcmin: tiltMagnitudeArcmin(secondary),
    pistonMm:
      (spec.primary ? screwPiston(primaryScrews, spec.primary) : 0) +
      (spec.secondary ? screwPiston(secondaryScrews, spec.secondary) : 0),
  };
}

/**
 * Suiter's diffraction-limited collimation criterion, converted to a beam
 * angle. The published tolerance is a LINEAR one — the optical axis may miss
 * the eyepiece axis at the focal plane by at most 0.022·F³ mm before coma
 * eats the diffraction-limited wavefront (≈1.4mm at f/4, ≈4.8mm at f/6,
 * ≈29mm at f/11). That cubic in focal ratio is the entire reason fast
 * Newtonians are famously fussy and long SCTs are forgiving.
 *
 * Dividing by the focal length turns that miss distance into the beam angle
 * that produced it, which is the quantity the screws actually control.
 */
export function toleranceArcminFor(focalRatio: number, focalLengthMm: number): number {
  const allowableOffsetMm = 0.022 * Math.max(0.1, focalRatio) ** 3;
  return (allowableOffsetMm / Math.max(1, focalLengthMm)) * RAD_TO_ARCMIN;
}

export function collimationToleranceArcmin(profile: TelescopeProfile): number {
  return toleranceArcminFor(profile.focalRatio, profile.focalLength);
}

export type CollimationGrade = 'diffraction-limited' | 'close' | 'out';

/**
 * The three states the Realistic-mode chip reports. "Close" is the band a
 * real observer would call usable-but-not-right: past the diffraction limit,
 * but inside the ~3× where coma is visible on a planet yet the scope still
 * shows detail.
 */
export function classifyCollimation(errorArcmin: number, toleranceArcmin: number): CollimationGrade {
  if (errorArcmin <= toleranceArcmin) return 'diffraction-limited';
  if (errorArcmin <= toleranceArcmin * 3) return 'close';
  return 'out';
}

/**
 * Reference defocus the calibration below is anchored at, mm — one full rack
 * of this sim's focuser away from the mark (see opticalMath.FOCUSER_UNIT_TO_MM),
 * i.e. the biggest, easiest donut a student can open.
 */
const REFERENCE_DEFOCUS_MM = 3;

/**
 * Shadow decentration at exactly the diffraction-limited tolerance, seen at
 * REFERENCE_DEFOCUS_MM. Set at the classic ~10% detection threshold: a scope
 * sitting right on its tolerance should look *arguably* off to a careful eye
 * and unmistakably fine to a casual one, which is precisely what "diffraction
 * limited" means in practice.
 */
const EPSILON_AT_TOLERANCE = 0.12;

/**
 * Fractional decentration of the obstruction's shadow inside a defocused
 * star's donut — the star test's whole diagnostic, in one number.
 *
 * Two competing lengths, and only one of them grows with defocus:
 *   • The shadow's LATERAL displacement is fixed by the beam error alone.
 *     Racking the focuser doesn't change it.
 *   • The donut's RADIUS is pure light-cone geometry, r = Δz / 2F, growing
 *     linearly with defocus.
 *
 * So ε = s/r ∝ 1/Δz. That inverse law is why the technique works the way it
 * does in the field: rack far out and even gross miscollimation looks nearly
 * centred, so you creep back TOWARD focus to magnify the offset until it is
 * unmistakable.
 *
 * The constant of proportionality is referenced to the INSTRUMENT'S OWN
 * tolerance rather than to a geometric lever arm, and that is a deliberate
 * correction rather than a shortcut. Written the geometric way — displacement
 * = θ × (some fixed fraction of focal length) — the ratio carries an F⁴, so a
 * single lever constant that behaves on the f/6 Dob pins the shadow to the rim
 * across the f/11 SCT's entire useful range (and vice versa), and on either
 * scope ε saturates at errors far *inside* the diffraction limit. A display
 * that reads "maximum" from one tolerance to twenty teaches nothing. Anchoring
 * on tolerance keeps the ∝1/Δz physics exactly and makes the number mean the
 * same thing on every instrument: ~0.12 when you are at the limit, growing
 * proportionally as you get worse, and shrinking as you rack further out.
 *
 * Returns 0…0.95 — a shadow cannot leave its own donut.
 */
export function shadowOffsetFrac(
  fieldErrorArcmin: number,
  defocusMm: number,
  focalLengthMm: number,
  focalRatio: number
): number {
  const absDefocus = Math.abs(defocusMm);
  if (absDefocus < 1e-4) return 0; // exactly at focus there is no donut to decentre
  const toleranceArcmin = toleranceArcminFor(focalRatio, focalLengthMm);
  if (toleranceArcmin <= 0) return 0;
  const errorInTolerances = Math.abs(fieldErrorArcmin) / toleranceArcmin;
  return Math.min(
    0.95,
    errorInTolerances * EPSILON_AT_TOLERANCE * (REFERENCE_DEFOCUS_MM / absDefocus)
  );
}

/**
 * Coma severity (0…1) for the renderer's flare, ramped from the diffraction
 * limit up to the ~6× error where the flare is already as ugly as it gets.
 * Below tolerance it is exactly 0 — a correctly collimated scope must draw a
 * clean star, not a faint apology for one.
 */
export function comaSeverity(errorArcmin: number, toleranceArcmin: number): number {
  const tol = Math.max(1e-6, toleranceArcmin);
  return Math.max(0, Math.min(1, (errorArcmin - tol) / (tol * 5)));
}

/**
 * Whether the secondary is aligned well enough to move on to the primary.
 * Real Newtonian procedure is strictly ordered — a diagonal that isn't
 * centred under the focuser and squarely facing the primary vignettes the
 * light cone, and any primary adjustment made through that crooked window is
 * wasted work. Deliberately looser than the diffraction-limited tolerance:
 * squaring the diagonal is a rough, eyeballed step (a Cheshire, not a star
 * test), and demanding perfection there would deadlock the lesson.
 */
export function isSecondaryResolved(secondaryArcmin: number, toleranceArcmin: number): boolean {
  return secondaryArcmin <= toleranceArcmin * 3;
}
