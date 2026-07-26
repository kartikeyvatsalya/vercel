/**
 * Bahtinov Mask Diffraction Physics (Phase 56)
 * ─────────────────────────────────────────────────────────────────
 * A real Bahtinov mask has three grating sections: one large, untilted
 * section whose bars run vertical (producing a HORIZONTAL diffraction
 * spike — perpendicular to the bars), and two smaller sections tilted
 * ±20° from the first (producing two spikes crossing at ±20° to the
 * central one). All three spikes meet at a single point exactly at
 * perfect focus. Defocusing the telescope doesn't move the central spike
 * (it's symmetric, so it stays anchored on the star) — it slides the
 * crossing point of the two tilted spikes ALONG the central spike's own
 * length. That sliding offset is the entire diagnostic: astrophotographers
 * rack focus until the X sits exactly centered on the middle spike.
 *
 * Every constant below is a physical/geometric fact of that mask design,
 * not a rendering choice — see MAIN_MM_TO_PX etc. at the bottom for the
 * (separate, cosmetic) screen-space scale.
 */

import { focuserDefocusMm } from './opticalMath';

/** Tilt of the two crossed grating sections relative to the central spike. */
export const BAHTINOV_ARM_ANGLE_DEG = 20;

/**
 * δ = K · Δz / F — the classic Bahtinov geometric-shadow result: the
 * central-spike-to-X-crossing displacement δ (mm, at the focal plane) is
 * linear in defocus Δz (mm) and inverse in focal ratio F. K folds in the
 * ±20° grating tilt.
 */
const DISPLACEMENT_COEFFICIENT = 0.347;

/** A diffraction spike's lateral FWHM is ≈ this many wavelengths × focal ratio. */
const SPIKE_WIDTH_COEFFICIENT = 3.5;

/** Reference visual wavelength — green light, ~550nm, the standard choice for optical hand-formulas. */
const VISUAL_WAVELENGTH_MM = 0.00055;

// The 0–100 slider → mm bridge moved to engine/opticalMath (Phase 57) once
// the star test needed the very same conversion: two diagnostics reading one
// drawtube must not each own a private calibration of it.

export interface BahtinovGeometry {
  /** Signed physical defocus, mm (0 = perfect focus; sign is arbitrary — which side of "perfect" the focuser sits on). */
  defocusMm: number;
  /** Signed displacement (mm) of the X-spike crossing from the central spike's true (in-focus) position. */
  displacementMm: number;
  /** Diffraction spike lateral FWHM, mm. */
  spikeWidthMm: number;
}

/**
 * Derives the true Bahtinov geometry from the sim's current focuser state.
 * Pure function of the numbers — no rendering, no store access — so the
 * physics is independently checkable from the two draw functions below.
 */
export function computeBahtinovGeometry(
  focuserPosition: number,
  perfectFocusPoint: number,
  focalRatio: number
): BahtinovGeometry {
  const defocusMm = focuserDefocusMm(focuserPosition, perfectFocusPoint);
  const safeFocalRatio = Math.max(0.1, focalRatio); // guard against a degenerate f/0 custom profile
  const displacementMm = (DISPLACEMENT_COEFFICIENT * defocusMm) / safeFocalRatio;
  const spikeWidthMm = SPIKE_WIDTH_COEFFICIENT * VISUAL_WAVELENGTH_MM * safeFocalRatio;
  return { defocusMm, displacementMm, spikeWidthMm };
}

// ── Screen-space rendering ──────────────────────────────────────────
// Everything below is cosmetic scale, not physics: how many screen px
// represent one mm of the geometry above. MAIN_MM_TO_PX is tuned so
// large, obvious defocus reads clearly in the live view, while the
// microscopic displacement near correct focus stays sub-pixel — that gap
// is exactly why the vernier inset (VERNIER_MAGNIFICATION×) exists.
export const MAIN_MM_TO_PX = 250;
export const MAIN_ARM_LENGTH_PX = 130;

export const VERNIER_MAGNIFICATION = 8;
export const VERNIER_MM_TO_PX = MAIN_MM_TO_PX * VERNIER_MAGNIFICATION;
/** Short arms in the inset by design — it crops tight on just the crossing, not the full asterism. */
export const VERNIER_ARM_LENGTH_PX = 34;
export const VERNIER_INSET_WIDTH_PX = 80;
export const VERNIER_INSET_HEIGHT_PX = 24;

export interface BahtinovRenderOptions {
  /** Screen px per mm of displacement/spike-width. */
  mmToPx: number;
  /** Half-length of each spike segment, px, from the crossing region outward. */
  armLengthPx: number;
  color?: string;
}

/**
 * Draws the 3-spike asterism relative to ctx's CURRENT transform origin —
 * the caller translates to wherever the star sits (screen space) or to an
 * inset panel's center first. Shared by both the main overlay and the
 * vernier inset so the two can never visually disagree with each other.
 */
export function drawBahtinovAsterism(
  ctx: CanvasRenderingContext2D,
  geometry: BahtinovGeometry,
  options: BahtinovRenderOptions
): void {
  const { mmToPx, armLengthPx, color = 'rgba(255, 90, 90, 0.9)' } = options;
  const displacementPx = geometry.displacementMm * mmToPx;
  const spikeWidthPx = Math.max(0.5, geometry.spikeWidthMm * mmToPx);
  // The diffraction FWHM drives the glow, not the stroke itself — at
  // vernier magnification the raw FWHM would render thicker than the
  // whole inset, which would hide the one thing the inset exists to show.
  const strokeWidthPx = Math.min(2.5, Math.max(1, spikeWidthPx * 0.25));
  const angleRad = (BAHTINOV_ARM_ANGLE_DEG * Math.PI) / 180;
  const armDx = Math.cos(angleRad) * armLengthPx;
  const armDy = Math.sin(angleRad) * armLengthPx;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.min(8, spikeWidthPx);
  ctx.lineWidth = strokeWidthPx;

  // Central spike: horizontal, fixed at the star's true center — the
  // untilted grating half, so defocus never moves it.
  ctx.beginPath();
  ctx.moveTo(-armLengthPx, 0);
  ctx.lineTo(armLengthPx, 0);
  ctx.stroke();

  // The two ±20° spikes cross EACH OTHER at (displacementPx, 0) — that
  // crossing point is the focus indicator: dead center at perfect focus,
  // sliding along the central spike as the focuser moves off it.
  ctx.beginPath();
  ctx.moveTo(displacementPx - armDx, -armDy);
  ctx.lineTo(displacementPx + armDx, armDy);
  ctx.moveTo(displacementPx - armDx, armDy);
  ctx.lineTo(displacementPx + armDx, -armDy);
  ctx.stroke();

  ctx.restore();
}

export interface VernierInsetOptions {
  /** Screen-space top-left corner of the inset panel. */
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/**
 * The 8× "loupe" HUD panel (Phase 56) — real astrophotographers run
 * Bahtinov-grabber software for exactly this reason: at any sane
 * magnification the true displacement is a fraction of a pixel, so the
 * naked-eye asterism alone can't show fine focus. This crops tight on
 * just the crossing region at VERNIER_MAGNIFICATION× the main view's
 * scale, with a reference tick marking where the crossing sits at
 * perfect focus (the main overlay has the star itself for that; this
 * cropped, translated view doesn't).
 */
export function drawVernierInset(
  ctx: CanvasRenderingContext2D,
  geometry: BahtinovGeometry,
  options: VernierInsetOptions
): void {
  const width = options.width ?? VERNIER_INSET_WIDTH_PX;
  const height = options.height ?? VERNIER_INSET_HEIGHT_PX;
  const { x, y } = options;

  ctx.save();

  // Panel chrome — same dark HUD-panel language as the sharpness/SNR bars.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  ctx.beginPath();
  ctx.rect(x + 1, y + 1, width - 2, height - 2);
  ctx.clip();

  ctx.translate(x + width / 2, y + height / 2);

  // Reference reticle at the ideal (perfect-focus) crossing position.
  ctx.strokeStyle = 'rgba(120, 220, 255, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -height / 2 + 2);
  ctx.lineTo(0, height / 2 - 2);
  ctx.stroke();

  drawBahtinovAsterism(ctx, geometry, {
    mmToPx: VERNIER_MM_TO_PX,
    armLengthPx: VERNIER_ARM_LENGTH_PX,
  });

  ctx.restore();
}
