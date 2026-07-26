import { LRUCache } from './spriteCache';

/**
 * The Star Test (Phase 57)
 * ─────────────────────────────────────────────────────────────────
 * What a bright star actually looks like when you rack a telescope out of
 * focus: not a blurred dot, but a sharply bounded DONUT — the pupil itself,
 * projected. The central obstruction casts the hole, the aperture stop cuts
 * the rim, and interference between the two edges paints a set of concentric
 * Fresnel rings across the annulus.
 *
 * That donut is the most sensitive alignment instrument an amateur owns. Its
 * hole sits dead centre only when the optical axis and the eyepiece axis
 * agree; any collimation error pushes the shadow off to one side by a
 * fraction that GROWS as you approach focus (see collimation.shadowOffsetFrac).
 * Everything here exists to draw that one fact honestly.
 *
 * Baking, not drawing: the pattern is a few dozen gradient stops plus two
 * composite passes — far too expensive for a 60fps loop, and completely
 * static for any given set of parameters. So each distinct donut is rendered
 * once into an offscreen canvas and blitted thereafter, keyed on QUANTIZED
 * parameters (radius to 2px, offset to 5%, angle to 15°) so that slowly
 * racking the focuser reuses one sprite for a run of frames instead of
 * inventing a new one every time the float changes in its sixth decimal.
 */

/** Fresnel-ring contrast: how deeply the interference fringes modulate the annulus. */
const RING_CONTRAST = 0.42;
/** Rings crowd toward the rim; beyond this many the sprite is just noise at eyepiece scale. */
const MAX_RINGS = 9;
/** Radial gradient stops across the annulus — enough to resolve MAX_RINGS without banding. */
const GRADIENT_STEPS = 64;
/** Soft outer falloff (fraction of disk radius) — a real donut's rim is diffraction-feathered, not cut. */
const RIM_FEATHER_FRACTION = 0.06;
/** Transparent margin (px) so the feather and glow never clip the sprite edge. */
const SPRITE_PAD_PX = 3;
/** Beyond this the donut is bigger than any eyepiece view here; bake capped and upscale. */
const MAX_SPRITE_RADIUS_PX = 140;
/** Below this there is no resolvable annulus — the caller should draw an ordinary star. */
export const MIN_STAR_TEST_RADIUS_PX = 3;

const STAR_TEST_CACHE_MAX_ENTRIES = 16;

export interface BakedStarTestSprite {
  canvas: HTMLCanvasElement;
  /** Disk radius (px) the sprite was baked at — blits scale it to the live radius. */
  radius: number;
}

const starTestCache = new LRUCache<string, BakedStarTestSprite>(STAR_TEST_CACHE_MAX_ENTRIES);

/**
 * Everything the sky renderer needs to draw the star test for the CURRENT
 * focuser and collimation state. Angular (not pixel) sizing, because the main
 * eyepiece and the finder scale one physical light cone very differently.
 */
export interface StarTestRenderSpec {
  /** Angular radius of the defocused disk on the sky, degrees. */
  diskRadiusDeg: number;
  /** Central obstruction as a fraction of aperture diameter. */
  obstructionFrac: number;
  /** Shadow decentration, fraction of annulus radius (collimation.shadowOffsetFrac). */
  shadowOffsetFrac: number;
  /** Direction the shadow is pushed, radians, screen space. */
  shadowAngleRad: number;
  /** Visible Fresnel rings (fresnelRingCount). */
  ringCount: number;
  /** Coma flare strength 0…1 (collimation.comaSeverity); 0 draws no flare at all. */
  comaSeverity: number;
  /** Direction the comatic fan points, radians, screen space. */
  comaAngleRad: number;
}

/** Only genuinely bright stars survive being spread into a donut — fainter ones just vanish. */
export const STAR_TEST_MAG_LIMIT = 3.0;

export interface StarTestParams {
  /** Outer radius of the defocused disk, px. */
  radiusPx: number;
  /** Central obstruction, as a fraction of aperture DIAMETER (0 for a refractor). */
  obstructionFrac: number;
  /** Shadow decentration as a fraction of the annulus radius (collimation.shadowOffsetFrac). */
  shadowOffsetFrac: number;
  /** Screen-space direction the shadow is pushed, radians. */
  shadowAngleRad: number;
  /** Visible Fresnel rings across the annulus. */
  ringCount: number;
}

/**
 * How many Fresnel rings a given defocus shows: the wavefront error in waves,
 * Δz / (8 λ F²). The F² is why a fast scope explodes into a huge ringless
 * donut with a flick of the focuser while an f/11 SCT shows a patient stack
 * of fringes — and why the star test is traditionally described in terms of
 * "so many rings out," not millimetres.
 */
const VISUAL_WAVELENGTH_MM = 0.00055;
export function fresnelRingCount(defocusMm: number, focalRatio: number): number {
  const safeRatio = Math.max(0.1, focalRatio);
  const waves = Math.abs(defocusMm) / (8 * VISUAL_WAVELENGTH_MM * safeRatio * safeRatio);
  return Math.max(0, Math.min(MAX_RINGS, Math.round(waves)));
}

/**
 * Angular radius of the defocused disk, in degrees on the sky — the honest
 * route to a pixel size, since the renderer already knows how many pixels a
 * degree is worth. The light cone at defocus Δz has radius Δz/2F on the focal
 * plane, and dividing by focal length converts that to an angle.
 */
export function starTestRadiusDeg(defocusMm: number, focalRatio: number, focalLengthMm: number): number {
  const radiusMm = Math.abs(defocusMm) / (2 * Math.max(0.1, focalRatio));
  return (radiusMm / Math.max(1, focalLengthMm)) * (180 / Math.PI);
}

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function cacheKey(p: StarTestParams): string {
  // Angle only matters when there IS an offset to point somewhere — folding
  // it out at zero keeps a perfectly collimated scope on a single sprite no
  // matter which way the (meaningless) error vector happens to face.
  const offset = quantize(p.shadowOffsetFrac, 0.05);
  const angle = offset > 0 ? quantize(p.shadowAngleRad, Math.PI / 12) : 0;
  return [
    quantize(p.radiusPx, 2),
    quantize(p.obstructionFrac, 0.05),
    offset.toFixed(2),
    angle.toFixed(2),
    p.ringCount,
  ].join('|');
}

/**
 * Intensity of the annulus at normalized radius t ∈ [0,1] (inner edge → rim).
 *
 * Fresnel zones are zones of EQUAL AREA, so their boundaries fall at radii
 * proportional to √n — meaning the fringes bunch up toward the rim. Phasing
 * the cosine on t² rather than t reproduces exactly that crowding, which is
 * the visual signature that tells a real star test from a drawn ring pattern.
 * A rising pedestal on top keeps the rim the brightest part of the donut, as
 * the geometric projection of the pupil demands.
 */
function annulusIntensity(t: number, ringCount: number): number {
  const fringe = ringCount > 0 ? Math.cos(Math.PI * 2 * ringCount * t * t) : 1;
  const pedestal = 0.62 + 0.38 * t;
  return Math.max(0, Math.min(1, pedestal * (1 - RING_CONTRAST) + RING_CONTRAST * fringe * pedestal));
}

/**
 * Bakes one defocused-star sprite, or returns a cached one. The canvas is
 * square, the donut centred, and the caller blits it centred on the star,
 * scaled from the returned bake radius to whatever the live radius is.
 * Returns null only if a 2D context can't be had.
 *
 * Deliberately monochrome: the spectral tint the focused starfield applies
 * would multiply this cache by seven for a difference nobody can see once a
 * star's light is smeared across a donut two hundred times its focused area.
 */
export function bakeStarTestSprite(params: StarTestParams): BakedStarTestSprite | null {
  const radius = Math.min(MAX_SPRITE_RADIUS_PX, Math.max(MIN_STAR_TEST_RADIUS_PX, quantize(params.radiusPx, 2)));
  const obstruction = Math.max(0, Math.min(0.6, params.obstructionFrac));
  const offsetFrac = Math.max(0, Math.min(0.95, params.shadowOffsetFrac));
  // Equal-area zones crowd toward the rim: with N zones the outermost is only
  // ≈ R/2N wide, so a small donut asked for nine rings would draw its outer
  // ones at half a pixel and alias into moiré. Capping at R/3 keeps the finest
  // zone ≳1.5px — and says something true, since an eyepiece that can't
  // resolve a fringe doesn't show it either.
  const resolvableRings = Math.floor(radius / 3);
  const ringCount = Math.max(0, Math.min(MAX_RINGS, resolvableRings, Math.round(params.ringCount)));

  // Keyed on the FINAL values, after quantization and every clamp above — two
  // requests that resolve to the same picture must share one cache slot.
  const key = cacheKey({ ...params, radiusPx: radius, obstructionFrac: obstruction, shadowOffsetFrac: offsetFrac, ringCount });
  const cached = starTestCache.get(key);
  if (cached) return cached;

  const side = Math.ceil((radius + SPRITE_PAD_PX) * 2);
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const cctx = canvas.getContext('2d');
  if (!cctx) return null;

  const c = side / 2;
  const innerRadius = radius * obstruction;

  // ── The annulus ── one radial gradient carrying the whole Fresnel profile.
  const grad = cctx.createRadialGradient(c, c, 0, c, c, radius);
  const innerStop = innerRadius / radius;
  for (let i = 0; i <= GRADIENT_STEPS; i++) {
    const stop = i / GRADIENT_STEPS;
    if (stop < innerStop) {
      // Inside the obstruction's own radius the geometric shadow is total —
      // but only when the shadow is centred. A decentred shadow is punched
      // out separately below, so this region has to be PAINTED here and
      // erased there, or the offset hole would have nothing to bite into.
      const t = innerStop > 0 ? stop / innerStop : 0;
      grad.addColorStop(stop, `rgba(255,255,255,${(annulusIntensity(t * 0.35, ringCount) * 0.9).toFixed(3)})`);
      continue;
    }
    const t = innerStop < 1 ? (stop - innerStop) / (1 - innerStop) : stop;
    grad.addColorStop(stop, `rgba(255,255,255,${annulusIntensity(t, ringCount).toFixed(3)})`);
  }
  cctx.fillStyle = grad;
  cctx.beginPath();
  cctx.arc(c, c, radius, 0, Math.PI * 2);
  cctx.fill();

  // ── The rim ── a real donut's outer edge is the aperture stop's own
  // diffraction edge: bright, thin, and softly feathered rather than cut.
  const feather = Math.max(1, radius * RIM_FEATHER_FRACTION);
  const rim = cctx.createRadialGradient(c, c, Math.max(0, radius - feather * 2), c, c, radius + feather);
  rim.addColorStop(0, 'rgba(255,255,255,0)');
  rim.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  rim.addColorStop(1, 'rgba(255,255,255,0)');
  cctx.globalCompositeOperation = 'lighter';
  cctx.fillStyle = rim;
  cctx.beginPath();
  cctx.arc(c, c, radius + feather, 0, Math.PI * 2);
  cctx.fill();

  // Feather the outer boundary itself so the sprite melts into the sky.
  cctx.globalCompositeOperation = 'destination-in';
  const mask = cctx.createRadialGradient(c, c, Math.max(0, radius - feather), c, c, radius + feather * 0.5);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  cctx.fillStyle = mask;
  cctx.fillRect(0, 0, side, side);

  // ── The shadow ── THE diagnostic. Erased (destination-out) rather than
  // painted black, so the hole is genuinely transparent and the sky shows
  // through it exactly as it does through a real donut. Its displacement is
  // a fraction of the annulus radius, which is why the very same collimation
  // error looks mild far out of focus and glaring near it.
  if (innerRadius > 0.5) {
    const shadowX = c + Math.cos(params.shadowAngleRad) * offsetFrac * (radius - innerRadius);
    const shadowY = c + Math.sin(params.shadowAngleRad) * offsetFrac * (radius - innerRadius);
    const shadowFeather = Math.max(0.75, innerRadius * 0.12);
    const hole = cctx.createRadialGradient(
      shadowX, shadowY, Math.max(0, innerRadius - shadowFeather),
      shadowX, shadowY, innerRadius + shadowFeather
    );
    hole.addColorStop(0, 'rgba(0,0,0,1)');
    hole.addColorStop(0.7, 'rgba(0,0,0,0.92)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    cctx.globalCompositeOperation = 'destination-out';
    cctx.fillStyle = hole;
    cctx.beginPath();
    cctx.arc(shadowX, shadowY, innerRadius + shadowFeather, 0, Math.PI * 2);
    cctx.fill();
  }

  cctx.globalCompositeOperation = 'source-over';
  const sprite: BakedStarTestSprite = { canvas, radius };
  starTestCache.set(key, sprite);
  return sprite;
}

/**
 * A defocused star is the same photons spread over a vastly larger area, so
 * it dims as it grows — but not by the raw 1/r² surface-brightness law, which
 * would black out a first-magnitude donut the instant it became big enough to
 * read. Eased instead, and floored, because the whole point of the exercise
 * is that a bright star stays comfortably visible while you rack through it.
 */
export function starTestSpreadDimming(radiusPx: number): number {
  return Math.min(1, Math.max(0.3, 12 / Math.max(1, radiusPx)));
}

/** Centred blit of a baked sprite, scaled so its baked radius lands on the live radius. */
export function blitStarTestSprite(
  ctx: CanvasRenderingContext2D,
  sprite: BakedStarTestSprite,
  x: number,
  y: number,
  radiusPx: number
): void {
  const s = radiusPx / sprite.radius;
  const w = sprite.canvas.width * s;
  const h = sprite.canvas.height * s;
  ctx.drawImage(sprite.canvas, x - w / 2, y - h / 2, w, h);
}

/**
 * Comatic flare, drawn live in screen space rather than baked in — coma's
 * orientation is fixed by the miscollimation axis while the donut's own
 * pattern is rotationally keyed, so folding the two together would multiply
 * the sprite cache by every angle for no visual gain.
 *
 * Miscollimation coma is the "little comet" the instructor warns about: a
 * one-sided fan of light flung away from the star, all of it on the side the
 * optical axis is tilted toward. Drawn as a tapering wedge with a soft
 * gradient — enough to read as asymmetry at eyepiece scale, which is all a
 * real observer perceives before reaching for the hex key.
 */
export function drawComaFlare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  coreRadiusPx: number,
  severity: number,
  angleRad: number,
  alpha: number
): void {
  if (severity <= 0 || alpha <= 0.01) return;
  const length = coreRadiusPx * (1.6 + severity * 2.4);
  const width = coreRadiusPx * (0.9 + severity * 0.5);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.min(1, alpha * (0.35 + severity * 0.65));

  // The fan itself: brightest against the star, fading out along its length.
  const fan = ctx.createLinearGradient(0, 0, length, 0);
  fan.addColorStop(0, 'rgba(255,255,255,0.75)');
  fan.addColorStop(0.45, 'rgba(220,232,255,0.28)');
  fan.addColorStop(1, 'rgba(200,215,255,0)');
  ctx.fillStyle = fan;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.55, -width, length, 0);
  ctx.quadraticCurveTo(length * 0.55, width, 0, 0);
  ctx.fill();

  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
