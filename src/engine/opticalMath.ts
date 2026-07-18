/**
 * Optical Mathematics Engine
 * Implements pure functions for telescope optics.
 */

/**
 * Baseline pixel size at 50x magnification.
 * All target sizes in the render loops are derived from this constant.
 * 50x is defined as the "1× visual scale" reference point.
 */
export const BASE_REFERENCE_PIXELS = 30;

/**
 * The standard magnification reference (50x = 1× visual scale).
 * targetSize = BASE_REFERENCE_PIXELS * (absoluteMag / MAG_REFERENCE_SCALE)
 */
export const MAG_REFERENCE_SCALE = 50;

/** Fixed magnification of the straight-through finderscope (classic 6×30). */
export const FINDERSCOPE_MAG = 6;

/** Apparent field of the finderscope eyepiece — 45° gives the typical ~7.5° true field. */
export const FINDERSCOPE_APPARENT_FOV = 45;

/**
 * ── Global Eyepiece Catalog (Phase 27, P27.3) ──
 * Extracted from MagnificationSandbox's local EYEPIECES table. `id` is the
 * persisted identity (useTelescopeStore.activeEyepieceId); `focalLengthMm`
 * is kept as the historical numeric value so `eyepieceFocalLength` — which
 * legacy mission logic checks with `=== 25` — stays byte-identical.
 */
export interface EyepieceSpec {
  id: string;
  label: string;
  focalLengthMm: number;
  afovDeg: number;
}

export const EYEPIECE_CATALOG: EyepieceSpec[] = [
  { id: '32mm', label: '32mm Wide', focalLengthMm: 32, afovDeg: 52 },
  { id: '25mm', label: '25mm Std', focalLengthMm: 25, afovDeg: 52 },
  { id: '10mm', label: '10mm Med', focalLengthMm: 10, afovDeg: 52 },
  { id: '4mm', label: '4mm High', focalLengthMm: 4, afovDeg: 60 }, // Planetary
];

/** Default eyepiece — matches the store's historical `eyepieceFocalLength: 25` default. */
export const DEFAULT_EYEPIECE_ID = '25mm';

/**
 * ── ABSOLUTE ANGULAR SCALING ──
 * On-screen size of a target as the strict ratio of its angular diameter to
 * the current true field of view:  screenPx = (angDiam / trueFOV) × viewport.
 * The Moon (0.51°) nearly fills a 0.55° field; Saturn (0.0125°) stays a dot
 * at the same magnification. Clamped to 3px so nothing vanishes entirely.
 */
export const getAngularDiameterPx = (
  angularDiameterDeg: number,
  trueFovDeg: number,
  viewportPx: number
): number => {
  if (trueFovDeg <= 0 || angularDiameterDeg <= 0) return 0;
  return Math.max(3, (angularDiameterDeg / trueFovDeg) * viewportPx);
};

/**
 * Minimum on-screen RADIUS (px), applied AFTER any target-specific ratio
 * adjustment (Phase 30). Without this, Saturn's /2.2 ring-to-body divide ran
 * on an already-floored value (getAngularDiameterPx's own 3px floor), so a
 * genuinely tiny true angular size — Saturn's rings in the 7.5° finder —
 * rounded back down to a sub-pixel, effectively invisible dot.
 */
const MIN_TARGET_RENDER_SCALE_PX = 2;

/**
 * Converts a target's angular diameter to the draw-scalar the 2D renderers
 * pass to their glyph functions (which treat the scalar as the body RADIUS).
 * Saturn's angular extent is ring-tip to ring-tip, but its glyphs draw rings
 * at 2.2× the body scalar — divide out so the RING span matches the angle.
 */
export const getTargetRenderScale = (
  targetId: string,
  angularDiameterDeg: number,
  trueFovDeg: number,
  viewportPx: number
): number => {
  const radiusPx = getAngularDiameterPx(angularDiameterDeg, trueFovDeg, viewportPx) / 2;
  const scaled = targetId === 'saturn' ? radiusPx / 2.2 : radiusPx;
  return Math.max(MIN_TARGET_RENDER_SCALE_PX, scaled);
};

/**
 * Baseline aperture for the human eye (fully dark-adapted pupil ~7mm).
 * Used to compute light-gathering ratio relative to the naked eye.
 */
export const EYE_APERTURE_MM = 7;

/**
 * Calculates the aperture brightness multiplier relative to the human eye.
 * A 200mm aperture gathers (200/7)² ≈ 816× more light than the naked eye.
 * We normalise to a 130mm "baseline" scope so the 8" Dob feels like a
 * meaningful upgrade and the 14" SCT feels dramatically brighter.
 *
 * @param apertureMm  Aperture of the active telescope in mm
 * @returns           Brightness multiplier (1.0 = 130mm baseline)
 */
export const getApertureBrightnessMultiplier = (apertureMm: number): number => {
  const BASELINE_APERTURE = 130; // mm — reference scope
  return (apertureMm / BASELINE_APERTURE) ** 2;
};

/**
 * Calculates the Dawes' Limit resolution penalty blur in pixels.
 * Dawes' Limit: resolving power (arc-seconds) = 116 / aperture_mm
 * Small apertures cannot resolve fine detail; we simulate this as a
 * minimum residual blur that persists even at perfect focus.
 *
 * @param apertureMm  Aperture of the active telescope in mm
 * @returns           Minimum blur in pixels (0 for large apertures)
 */
export const getDawesBlurPx = (apertureMm: number): number => {
  // Scopes under 100mm get a small but visible residual blur.
  // 60mm → ~0.9px, 80mm → ~0.5px, 100mm+ → 0px
  if (apertureMm >= 100) return 0;
  return Math.max(0, (100 - apertureMm) / 100) * 0.9;
};

/**
 * Calculates the magnification of the telescope.
 * @param focalLengthObjective Focal length of the telescope (mm)
 * @param focalLengthEyepiece Focal length of the eyepiece (mm)
 * @returns Magnification factor (x)
 */
export const getMagnification = (focalLengthObjective: number, focalLengthEyepiece: number, isBarlowActive: boolean = false): number => {
  if (focalLengthEyepiece <= 0) return 0;
  const effectiveFocalLength = isBarlowActive ? focalLengthObjective * 2 : focalLengthObjective;
  return effectiveFocalLength / focalLengthEyepiece;
};

/**
 * Calculates the True Field of View (TFOV).
 * @param apparentFOV Apparent Field of View of the eyepiece (degrees)
 * @param magnification Magnification of the system
 * @returns True Field of View in degrees
 */
export const getTrueFOV = (apparentFOV: number, magnification: number): number => {
  if (magnification <= 0) return 0;
  return apparentFOV / magnification;
};

/**
 * Calculates the Exit Pupil.
 * @param aperture Aperture of the telescope (mm)
 * @param magnification Magnification of the system
 * @returns Exit Pupil in mm
 */
export const getExitPupil = (aperture: number, magnification: number): number => {
  if (magnification <= 0) return 0;
  return aperture / magnification;
};

/**
 * Calculates Relative Brightness based on Exit Pupil.
 * Usually bounded by the human eye pupil (~7mm maximum).
 * @param exitPupil Exit pupil in mm
 * @returns Relative brightness factor
 */
export const getRelativeBrightness = (exitPupil: number): number => {
  // Cap effective exit pupil to 7mm for human eye
  const effectivePupil = Math.min(exitPupil, 7.0);
  return effectivePupil * effectivePupil;
};

/**
 * Determines if the exit pupil is too small, resulting in dimming and floaters.
 * @param exitPupil Exit pupil in mm
 * @returns boolean indicating if the view is too dim
 */
export const isExitPupilTooSmall = (exitPupil: number): boolean => {
  return exitPupil < 0.5;
};

/**
 * Determines if magnification exceeds atmospheric limits.
 * @param magnification Current magnification
 * @param seeingQuality Quality of the atmosphere (1 = Perfect, 5 = Terrible)
 * @returns boolean indicating if the image should boil/blur
 */
export const isAtmosphericLimitExceeded = (magnification: number, seeingQuality: number): boolean => {
  // Simple heuristic: Max useful magnification drops as seeing worsens.
  // 1: 300x, 2: 250x, 3: 150x, 4: 100x, 5: 50x
  const maxMags = [300, 250, 150, 100, 50];
  const maxMagForSeeing = maxMags[Math.min(Math.max(seeingQuality - 1, 0), 4)];
  return magnification > maxMagForSeeing;
};

/**
 * Calculates the dynamic perfect focus point on the 0-100 slider based on the eyepiece focal length.
 * Shorter eyepieces require a shorter focuser drawtube position.
 * @param eyepieceFocalLength Focal length of the eyepiece (mm)
 * @returns Perfect focus position (0-100)
 */
export const getPerfectFocusPoint = (eyepieceFocalLength: number, isBarlowActive: boolean = false): number => {
  const baseFocus = 50 + (eyepieceFocalLength - 15);
  return Math.max(0, Math.min(100, isBarlowActive ? baseFocus + 20 : baseFocus));
};
