import type { LoadedAssets, LoadedTexture } from './assetLoader';

/**
 * Target Glyphs (Phase 27, P27.1; M42 warm cache added in Phase 29)
 * ─────────────────────────────────────────────────────────────────
 * Canonical procedural/photo renderers for each celestial/terrestrial
 * target, extracted from near-identical copies that used to live in
 * FinderscopeGame, MagnificationSandbox, and DobsonianTrainer.
 *
 * Every draw function takes the target's CENTER position (x, y) and a
 * RADIUS scalar (size) already computed by the caller via
 * opticalMath.getTargetRenderScale — these functions only know how to
 * paint a target at a given screen size, never how big that size should be.
 */

/**
 * True if a loaded texture has real pixel data. Textures are either
 * HTMLImageElements (small originals) or the ≤1024px offscreen canvases the
 * Phase 29 warm-up pass downsamples the giant sources into.
 */
export function isTextureReady(tex?: LoadedTexture | null): tex is LoadedTexture {
  if (!tex) return false;
  if (tex instanceof HTMLCanvasElement) return tex.width > 0;
  return tex.naturalWidth > 0;
}

// ── Soft-limb photo sprite cache (Phase 34) ────────────────────────
// The Wikimedia textures are JPEGs — no alpha channel — so the photographic
// targets used to meet the sky at a pixel-perfect boundary: Moon and Jupiter
// at a hard ctx.clip() circle/ellipse edge, and Saturn as an OPAQUE
// photo-on-black rectangle that occulted the starfield around it. Real
// optics never show such an edge (diffraction, seeing, and skyglow all
// feather it), so each photographic glyph is now baked ONCE per
// (target, quantized radius) into an offscreen sprite with a soft alpha
// limb: a feathered radial mask plus a subtle inner limb shadow for the
// disks, and a luminance-keyed alpha for Saturn (the black space background
// melts away and the limb inherits the photo's own glow falloff). Per-frame
// draws then blit the cached bitmap scaled to the exact live radius — the
// same bake-once philosophy as the M42 composite cache below (Phase 29).

interface BakedGlyphSprite {
  canvas: HTMLCanvasElement;
  /** Body radius (px) the sprite was baked at — blits scale it to the live radius. */
  radius: number;
}

const glyphSpriteCache = new Map<string, BakedGlyphSprite>();
const GLYPH_SPRITE_CACHE_MAX_ENTRIES = 12;

/** Jupiter's visible polar flattening (shared by the sprite bake and the fallback). */
const JUPITER_POLAR_RATIO = 0.935;

// Outer fraction of the disk radius that fades to transparent. The bake
// widens it to at least ~1.2px so the feather survives at finder sizes.
const LIMB_FEATHER_FRACTION = 0.045;
// Subtle darkening of the outermost disk — reads as limb darkening and hides
// the photo's own hard crop inside the feather.
const LIMB_SHADOW_START_FRACTION = 0.8;
const LIMB_SHADOW_ALPHA = 0.26;

// Bake-radius caps: the warmed textures are ≤1024px on a side, so these
// already capture every pixel the source has — extreme zooms blit the capped
// bake upscaled instead of allocating giant offscreen bitmaps.
const DISK_SPRITE_MAX_RADIUS = 512;
const SATURN_SPRITE_MAX_RADIUS = 200;

/** Padding (px) around a baked sprite so the feather's antialiasing never clips. */
const SPRITE_PAD_PX = 2;

function quantizeSpriteRadius(radiusPx: number, maxRadius: number): number {
  const clamped = Math.min(maxRadius, Math.max(2, radiusPx));
  return Math.min(maxRadius, Math.round(clamped / 2) * 2);
}

function getGlyphSprite(
  key: string,
  radius: number,
  width: number,
  height: number,
  bake: (cctx: CanvasRenderingContext2D) => boolean
): BakedGlyphSprite | null {
  const cached = glyphSpriteCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const cctx = canvas.getContext('2d');
  if (!cctx) return null;
  if (!bake(cctx)) return null; // bake declined (e.g. tainted texture) — don't cache
  if (glyphSpriteCache.size >= GLYPH_SPRITE_CACHE_MAX_ENTRIES) glyphSpriteCache.clear();
  const sprite: BakedGlyphSprite = { canvas, radius };
  glyphSpriteCache.set(key, sprite);
  return sprite;
}

/**
 * Feathered limb for a baked disk: erases everything outside the (possibly
 * oblate) disk with a destination-in radial fade, then paints a subtle inner
 * limb shadow source-atop so it only tints surviving disk pixels.
 */
function applyFeatheredDiskMask(
  cctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  polarRatio: number
): void {
  const featherFrac = Math.max(LIMB_FEATHER_FRACTION, Math.min(0.5, 1.2 / radius));
  // Cover the whole canvas in the scaled local frame (generous on purpose).
  const reach = cx + radius;
  cctx.save();
  cctx.translate(cx, cy);
  cctx.scale(1, polarRatio);
  const mask = cctx.createRadialGradient(0, 0, radius * (1 - featherFrac), 0, 0, radius);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  cctx.globalCompositeOperation = 'destination-in';
  cctx.fillStyle = mask;
  cctx.fillRect(-reach, -reach / polarRatio, reach * 2, (reach * 2) / polarRatio);
  cctx.globalCompositeOperation = 'source-atop';
  const shade = cctx.createRadialGradient(0, 0, radius * LIMB_SHADOW_START_FRACTION, 0, 0, radius);
  shade.addColorStop(0, 'rgba(4, 6, 14, 0)');
  shade.addColorStop(1, `rgba(4, 6, 14, ${LIMB_SHADOW_ALPHA})`);
  cctx.fillStyle = shade;
  cctx.fillRect(-reach, -reach / polarRatio, reach * 2, (reach * 2) / polarRatio);
  cctx.restore();
  cctx.globalCompositeOperation = 'source-over';
}

/** Centered blit of a baked sprite, scaled so its baked radius lands on the live radius. */
function blitGlyphSprite(ctx: CanvasRenderingContext2D, sprite: BakedGlyphSprite, x: number, y: number, radiusPx: number): void {
  const s = radiusPx / sprite.radius;
  ctx.drawImage(
    sprite.canvas,
    x - (sprite.canvas.width / 2) * s,
    y - (sprite.canvas.height / 2) * s,
    sprite.canvas.width * s,
    sprite.canvas.height * s
  );
}

function getMoonSprite(radiusPx: number, tex: LoadedTexture): BakedGlyphSprite | null {
  const r = quantizeSpriteRadius(radiusPx, DISK_SPRITE_MAX_RADIUS);
  const side = (r + SPRITE_PAD_PX) * 2;
  return getGlyphSprite(`moon|${r}`, r, side, side, (cctx) => {
    const c = r + SPRITE_PAD_PX;
    cctx.drawImage(tex, c - r, c - r, r * 2, r * 2);
    // Phase 42: the fixed left-to-right terminator gradient that used to be
    // baked in here is gone — the real, Sun-driven phase shadow is now
    // erased live from this clean full-disk sprite by eraseLunarPhaseShadow
    // (Phase 44), and the surface texture is field-rotated by the
    // parallactic angle at blit time, so a baked-in shadow would fight both.
    applyFeatheredDiskMask(cctx, c, c, r, 1);
    return true;
  });
}

function getJupiterSprite(radiusPx: number, tex: LoadedTexture): BakedGlyphSprite | null {
  const r = quantizeSpriteRadius(radiusPx, DISK_SPRITE_MAX_RADIUS);
  const side = (r + SPRITE_PAD_PX) * 2;
  return getGlyphSprite(`jupiter|${r}`, r, side, side, (cctx) => {
    const c = r + SPRITE_PAD_PX;
    // Slight overscan so the photo's disk (black margin in the source frame)
    // fully covers the masked ellipse — same 2.3 factor as the old clip path.
    const span = r * 2.3;
    cctx.drawImage(tex, c - span / 2, c - span / 2, span, span);
    applyFeatheredDiskMask(cctx, c, c, r, JUPITER_POLAR_RATIO);
    return true;
  });
}

// Luminance ramp for Saturn's alpha key: pixels at/below LO become fully
// transparent (black space + JPEG noise), pixels at/above HI keep full
// opacity, and the photo's own limb glow ramps smoothly in between.
const SATURN_KEY_LUM_LO = 6;
const SATURN_KEY_LUM_HI = 26;

function getSaturnSprite(radiusPx: number, tex: LoadedTexture): BakedGlyphSprite | null {
  const r = quantizeSpriteRadius(radiusPx, SATURN_SPRITE_MAX_RADIUS);
  // Same 5 × 2.4 body-radius footprint the live draw always used.
  const w = r * 5 + SPRITE_PAD_PX * 2;
  const h = r * 2.4 + SPRITE_PAD_PX * 2;
  return getGlyphSprite(`saturn|${r}`, r, w, h, (cctx) => {
    cctx.drawImage(tex, SPRITE_PAD_PX, SPRITE_PAD_PX, r * 5, r * 2.4);
    let frame: ImageData;
    try {
      frame = cctx.getImageData(0, 0, cctx.canvas.width, cctx.canvas.height);
    } catch {
      // Tainted texture (CORS fallback) — decline; caller draws procedurally.
      return false;
    }
    const px = frame.data;
    for (let i = 0; i < px.length; i += 4) {
      const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      const key = (lum - SATURN_KEY_LUM_LO) / (SATURN_KEY_LUM_HI - SATURN_KEY_LUM_LO);
      px[i + 3] = Math.round(px[i + 3] * Math.max(0, Math.min(1, key)));
    }
    cctx.putImageData(frame, 0, 0);
    return true;
  });
}

/**
 * Live lunar rendering parameters (Phase 42), all computed per-frame in
 * skyRenderer from the real ephemeris. Optional so the fallback/other callers
 * still get a plain, upright full Moon.
 */
export interface MoonRenderOptions {
  /** Parallactic field rotation (rad) applied to the surface texture only. */
  parallacticRad: number;
  /** Sunlit fraction of the disk: 0 = new, 0.5 = quarter, 1 = full. */
  illuminatedFraction: number;
  /** Canvas rotation (rad) that points the lit limb (+x local) toward the Sun. */
  brightLimbRad: number;
}

/**
 * Sun-driven terminator shadow (Phase 42; rewritten Phase 42.5; contrast
 * pass Phase 42.7; converted to an erase Phase 44; feathered Phase 45).
 * Geometry is built in a local frame with the lit side toward +x; the
 * caller's `brightLimbRad` rotation then aims that toward the real Sun.
 *
 * Phase 44 daytime-realism fix: a flat dark overlay read as a grey sticker
 * against a blue daytime sky instead of true shadow. This function ERASES
 * the unlit portion from an off-screen canvas that holds ONLY the Moon disk
 * (see drawMoon) via `globalCompositeOperation = 'destination-out'` — once
 * that canvas is composited onto the real sky, the erased pixels let the
 * true background (blue by day, black by night) show through instead of any
 * painted color. No stroke: the erased boundary IS the terminator.
 *
 * Phase 45: the erase shape is now filled through a `blur()` canvas filter,
 * not a crisp path. `destination-out` keys off the source shape's ALPHA, so
 * blurring it turns a hard 1px antialiased cutoff into a soft few-pixel
 * ramp from fully-erased to fully-opaque — the terminator reads as a
 * gradual day/night fade (atmosphere + optical softness) rather than a cut
 * digital line. The blur scales with the disk radius (a fixed px blur would
 * be invisible on a huge zoomed disk and would mush a tiny finder disk into
 * nothing) and is clamped so it never gets excessive at extreme zoom.
 *
 * A single ordinary path — an `arc()` for the true limb (always a plain
 * circular half, since that edge is the Moon's actual silhouette) joined by
 * ONE cubic `bezierCurveTo()` standing in for the terminator ellipse's arc —
 * filled once with opaque black (alpha 1 = full erasure under
 * destination-out, before the blur softens that edge). The bezier's control
 * points sit at the standard 4/3 tangent-offset distance used to
 * approximate a circular/elliptical arc with a single cubic — accurate
 * enough that the terminator reads as a sharp, smooth curve, not an
 * approximation artifact.
 *   b = R·(1 − 2·illum): the terminator's signed half-width at the disk's
 *   equator. +R at new (bulges fully into the lit +x side — almost all of
 *   the disk erases), 0 at quarter (a dead-straight vertical line), −R at
 *   full (bulges back to the limb — vanishingly thin erasure).
 * Explicitly clipped to the true disk first: the bezier is an approximation
 * and can overshoot the circular limb by a hair at its widest bulge, and
 * this guarantees the erasure (blurred spread included) can never eat into
 * canvas pixels beyond the Moon's own silhouette.
 */
function eraseLunarPhaseShadow(
  octx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  R: number,
  illum: number,
  brightLimbRad: number
): void {
  if (illum >= 0.985) return; // effectively full — nothing to erase

  octx.save();
  octx.translate(cx, cy);
  octx.rotate(brightLimbRad);

  octx.beginPath();
  octx.arc(0, 0, R, 0, Math.PI * 2);
  octx.clip();

  octx.globalCompositeOperation = 'destination-out';
  octx.filter = `blur(${Math.max(1, Math.min(6, R * 0.05))}px)`;

  octx.beginPath();
  if (illum <= 0.015) {
    // New moon: the entire disk is unlit — erase it outright.
    octx.arc(0, 0, R, 0, Math.PI * 2);
  } else {
    const b = R * (1 - 2 * illum);
    const k = (4 / 3) * b;
    octx.moveTo(0, -R); // top of the disk
    octx.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, true); // true limb: top → dark (−x) side → bottom
    octx.bezierCurveTo(k, R, k, -R, 0, -R); // terminator: bottom back to top
    octx.closePath();
  }
  octx.fillStyle = 'rgba(0, 0, 0, 1)';
  octx.fill();

  octx.restore(); // also resets globalCompositeOperation and filter
}

// ── Per-frame scratch canvas (Phase 47 perf fix) ───────────────────
// drawMoon composites the disk+phase onto an off-screen canvas every call
// (see below) so the terminator can be softly erased before blitting onto
// the real sky. This used to `document.createElement('canvas')` fresh on
// EVERY call — with the sky visibly moving (a slew, or the idle-redraw
// throttle never engaging at 60× playback, see LiveViewPanel's
// `skyVisiblyMoving`) that's up to 120 canvases/sec (main + finder feeds)
// continuously allocated and garbage-collected, the GC pressure behind the
// reported hangs. One scratch canvas now lives for the module's lifetime
// and is only resized when the required side actually changes; clearRect
// erases the previous frame's content the rest of the time.
interface MoonScratchCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
let moonScratch: MoonScratchCanvas | null = null;
let moonScratchSide = 0;

function getMoonScratchCanvas(side: number): MoonScratchCanvas | null {
  if (!moonScratch) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    moonScratch = { canvas, ctx };
  }
  if (moonScratchSide !== side) {
    // Assigning width/height (even via a getter that later shrinks back)
    // resets the bitmap, so this resize doubles as the clear.
    moonScratch.canvas.width = side;
    moonScratch.canvas.height = side;
    moonScratchSide = side;
  } else {
    moonScratch.ctx.clearRect(0, 0, side, side);
  }
  return moonScratch;
}

export function drawMoon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  assets: LoadedAssets | null,
  options?: MoonRenderOptions
): void {
  const { parallacticRad = 0, illuminatedFraction = 1, brightLimbRad = 0 } = options ?? {};

  // ── Atmospheric glow (Phase 42) ── A soft halo bleeding past the limb so
  // the Moon melts into the sky instead of ending at a hard digital edge; it
  // widens/brightens toward full. Rides the caller's globalAlpha, so it already
  // dims correctly in a bright/daylit sky.
  const haloAlpha = 0.24 * (0.45 + 0.55 * illuminatedFraction);
  const haloR = size * 2.15;
  const halo = ctx.createRadialGradient(x, y, size * 0.82, x, y, haloR);
  halo.addColorStop(0, `rgba(226, 231, 242, ${haloAlpha})`);
  halo.addColorStop(0.5, `rgba(208, 217, 236, ${haloAlpha * 0.32})`);
  halo.addColorStop(1, 'rgba(208, 217, 236, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fill();

  // ── Disk + phase, composited off-screen (Phase 44; feathered Phase 45) ──
  // The disk (texture or fallback) is painted onto a transparent off-screen
  // canvas sized to the disk, field-rotated by the parallactic angle exactly
  // as before (Tycho and the maria stay correctly oriented at any hour
  // angle). The unlit portion is then softly ERASED from that canvas — see
  // eraseLunarPhaseShadow — so blitting the result onto the real sky reveals
  // the TRUE background (blue by day, black by night) behind the night side,
  // through a feathered edge, instead of a painted-on grey overlay with a
  // hard boundary.
  const pad = 4; // headroom for the sprite's own feather/antialiasing bleed
  const half = size + pad;
  const scratch = getMoonScratchCanvas(half * 2);
  if (!scratch) return;
  const { canvas: off, ctx: octx } = scratch;

  octx.save();
  octx.translate(half, half);
  octx.rotate(parallacticRad);
  const moonImg = assets?.moon;
  const sprite = isTextureReady(moonImg) ? getMoonSprite(size, moonImg) : null;
  if (sprite) {
    // High-res texture, pre-baked with a feathered limb (Phase 34).
    blitGlyphSprite(octx, sprite, 0, 0, size);
  } else {
    // Procedural fallback — a plain grey disk with a few maria.
    octx.beginPath();
    octx.arc(0, 0, size, 0, Math.PI * 2);
    octx.fillStyle = '#cccccc';
    octx.fill();
    octx.fillStyle = 'rgba(0,0,0,0.15)';
    octx.beginPath(); octx.arc(-size * 0.3, -size * 0.4, size * 0.3, 0, Math.PI * 2); octx.fill();
    octx.beginPath(); octx.arc(size * 0.4, -size * 0.1, size * 0.25, 0, Math.PI * 2); octx.fill();
    octx.beginPath(); octx.arc(size * 0.1, size * 0.3, size * 0.4, 0, Math.PI * 2); octx.fill();
  }
  octx.restore();

  // Sun-driven phase terminator: erases the night side in place on `off`,
  // independent of the texture's parallactic rotation above (aimed at the
  // real Sun via brightLimbRad instead).
  eraseLunarPhaseShadow(octx, half, half, size, illuminatedFraction, brightLimbRad);

  ctx.drawImage(off, x - half, y - half);
}

export function drawSaturn(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, assets: LoadedAssets | null): void {
  const saturnImg = assets?.saturn;
  const sprite = isTextureReady(saturnImg) ? getSaturnSprite(size, saturnImg) : null;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-20 * Math.PI / 180);

  if (sprite) {
    // High-res texture, luminance-keyed so the photo's black space
    // background is transparent instead of an opaque rectangle (Phase 34).
    blitGlyphSprite(ctx, sprite, 0, 0, size);
  } else {
    // Procedural fallback
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 2.2, size * 0.6, 0, Math.PI, 0);
    ctx.lineWidth = size * 0.4;
    ctx.strokeStyle = '#e6c887';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.8, size * 0.48, 0, Math.PI, 0);
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = '#050510';
    ctx.stroke();
    const pGrad = ctx.createLinearGradient(0, -size, 0, size);
    pGrad.addColorStop(0, '#f4d08c');
    pGrad.addColorStop(0.3, '#d3ab61');
    pGrad.addColorStop(0.7, '#e8c784');
    pGrad.addColorStop(1, '#9b7e45');
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.fillStyle = pGrad;
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 2.2, size * 0.6, 0, 0, Math.PI);
    ctx.lineWidth = size * 0.4;
    ctx.strokeStyle = '#e6c887';
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 1.8, size * 0.48, 0, 0, Math.PI);
    ctx.lineWidth = size * 0.05;
    ctx.strokeStyle = '#050510';
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A Galilean moon ready to paint: the CALLER (skyRenderer) owns the physics —
 * ephemeris phase, deg→px projection, occultation filtering — and this glyph
 * only paints the surviving point sources. Offsets run along the glyph-frame
 * +x axis (Jupiter's equatorial plane); the field-rotation transform wrapped
 * around the whole draw orients that line on-sky.
 */
export interface JovianMoonSprite {
  /** Signed offset from Jupiter's center along glyph-frame +x, px. */
  offsetPx: number;
  /** Point-source radius, px. */
  radiusPx: number;
}

/**
 * Jupiter + the Galilean moons (Phase 32). Photographic disk when the
 * Wikimedia texture loaded, else a procedural banded disk. Moons are drawn
 * AFTER the disk, so a moon transiting in front shows against the clouds
 * (occulted moons never reach this function). The disk is drawn with
 * Jupiter's real ~6.5% polar flattening.
 */
export function drawJupiter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  assets: LoadedAssets | null,
  moons: JovianMoonSprite[] = []
): void {
  const polarSize = size * JUPITER_POLAR_RATIO; // visible oblateness
  const jupiterImg = assets?.jupiter;
  const sprite = isTextureReady(jupiterImg) ? getJupiterSprite(size, jupiterImg) : null;

  ctx.save();
  if (sprite) {
    // High-res texture, pre-baked with a feathered oblate limb (Phase 34).
    blitGlyphSprite(ctx, sprite, x, y, size);
  } else {
    ctx.beginPath();
    ctx.ellipse(x, y, size, polarSize, 0, 0, Math.PI * 2);
    ctx.clip();
    // ── Procedural fallback: limb-darkened cream disk + atmospheric bands ──
    const base = ctx.createRadialGradient(x - size * 0.25, y - size * 0.25, 0, x, y, size * 1.15);
    base.addColorStop(0, '#f7ecd4');
    base.addColorStop(0.55, '#e8d3ab');
    base.addColorStop(0.85, '#cfae7d');
    base.addColorStop(1, '#a58455');
    ctx.fillStyle = base;
    ctx.fillRect(x - size, y - polarSize, size * 2, polarSize * 2);

    // Horizontal cloud bands, glyph-frame y as fractions of the polar radius:
    // the two dark equatorial belts (NEB/SEB), thinner temperate bands, and
    // dusky polar hoods.
    const bands: { yFrac: number; hFrac: number; color: string }[] = [
      { yFrac: -0.28, hFrac: 0.16, color: 'rgba(164, 106, 62, 0.55)' },  // North Equatorial Belt
      { yFrac: 0.16,  hFrac: 0.18, color: 'rgba(150, 94, 58, 0.5)' },   // South Equatorial Belt
      { yFrac: -0.55, hFrac: 0.09, color: 'rgba(140, 110, 84, 0.35)' }, // N temperate
      { yFrac: 0.52,  hFrac: 0.08, color: 'rgba(140, 110, 84, 0.32)' }, // S temperate
      { yFrac: -0.82, hFrac: 0.22, color: 'rgba(120, 100, 88, 0.35)' }, // N polar hood
      { yFrac: 0.84,  hFrac: 0.24, color: 'rgba(120, 100, 88, 0.35)' }, // S polar hood
    ];
    for (const band of bands) {
      ctx.fillStyle = band.color;
      ctx.fillRect(x - size, y + band.yFrac * polarSize - (band.hFrac * polarSize) / 2, size * 2, band.hFrac * polarSize);
    }

    // Great Red Spot — an anticyclone nestled against the SEB's south edge.
    ctx.fillStyle = 'rgba(190, 92, 58, 0.85)';
    ctx.beginPath();
    ctx.ellipse(x - size * 0.32, y + polarSize * 0.3, size * 0.16, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // ── Galilean moons: star-like point sources along the equatorial plane ──
  // Painted with the same two-arc core+halo technique as the catalog star
  // field (no shadowBlur). globalAlpha may carry the caller's aperture
  // brightness — scale it rather than overwrite it.
  const baseAlpha = ctx.globalAlpha;
  ctx.fillStyle = '#f6f1e2';
  for (const moon of moons) {
    const mx = x + moon.offsetPx;
    ctx.globalAlpha = baseAlpha * 0.25;
    ctx.beginPath();
    ctx.arc(mx, y, moon.radiusPx * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = baseAlpha;
    ctx.beginPath();
    ctx.arc(mx, y, moon.radiusPx, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, size * 1.2);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.7, '#ffcc00');
  gradient.addColorStop(1, 'rgba(255, 100, 0, 0)');
  ctx.beginPath();
  ctx.arc(x, y, size * 1.2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Sunspots
  ctx.fillStyle = '#442200';
  ctx.beginPath(); ctx.arc(x - size * 0.2, y + size * 0.1, size * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + size * 0.4, y - size * 0.15, size * 0.05, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + size * 0.45, y - size * 0.1, size * 0.03, 0, Math.PI * 2); ctx.fill();
}

/**
 * The Distant Tower — a terrestrial target, so unlike the celestial glyphs
 * above it has a true "up." `invert` rotates it 180°, which is how a
 * Newtonian/Dobsonian's mirror flips every terrestrial view: pass
 * `profile.isInvertedView` for the main eyepiece feed, `false` for the
 * finder (real finders are straight-through/correct-image in this sim).
 */
export function drawSpire(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, now: number, invert: boolean = false): void {
  ctx.save();
  ctx.translate(x, y);
  if (invert) ctx.rotate(Math.PI);

  // ── Phase 29 visibility fix ──
  // The original palette (#111128 mountains, #222244 tower) was painted onto
  // the #050510 space-black backdrop — a terrestrial daytime scene rendered
  // in colors 3–7% brighter than pure black, i.e. effectively invisible.
  // Repainted with an atmospheric-haze palette that silhouettes against the
  // daylight sky and stays clearly visible against the night backdrop.

  // Hazy ground plane at the horizon
  ctx.fillStyle = '#31405e';
  ctx.fillRect(-size * 1.5, size * 0.2, size * 3, size * 1.5);

  // Mountain ridge — distant-haze slate, with a faint rim to catch the eye
  ctx.fillStyle = '#3e4d6d';
  ctx.beginPath();
  ctx.moveTo(-size * 1.5, size * 0.2);
  ctx.lineTo(-size * 0.8, -size * 0.3);
  ctx.lineTo(-size * 0.2, size * 0.1);
  ctx.lineTo(0, -size * 0.8);
  ctx.lineTo(size * 0.3, -size * 0.1);
  ctx.lineTo(size * 0.7, -size * 0.4);
  ctx.lineTo(size * 1.5, size * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(190, 205, 235, 0.5)';
  ctx.lineWidth = Math.max(1, size * 0.015);
  ctx.stroke();

  // Lattice tower on the central peak — pale concrete/steel, visible day & night
  ctx.fillStyle = '#c7cedd';
  ctx.fillRect(-size * 0.035, -size * 0.8, size * 0.07, -size * 0.5);
  ctx.strokeStyle = '#7e899f';
  ctx.lineWidth = Math.max(1, size * 0.01);
  ctx.strokeRect(-size * 0.035, -size * 1.3, size * 0.07, size * 0.5);

  // Tower cross-beams
  ctx.strokeStyle = '#8d99b3';
  ctx.lineWidth = Math.max(1, size * 0.012);
  ctx.beginPath();
  ctx.moveTo(-size * 0.035, -size * 0.9);
  ctx.lineTo(size * 0.035, -size * 1.1);
  ctx.moveTo(size * 0.035, -size * 0.9);
  ctx.lineTo(-size * 0.035, -size * 1.1);
  ctx.moveTo(-size * 0.035, -size * 1.1);
  ctx.lineTo(size * 0.035, -size * 1.3);
  ctx.moveTo(size * 0.035, -size * 1.1);
  ctx.lineTo(-size * 0.035, -size * 1.3);
  ctx.stroke();

  // Blinking red aircraft-warning LED at the top of the tower
  if (now % 2000 < 1000) {
    ctx.fillStyle = '#ff2222';
    ctx.shadowBlur = 12;
    ctx.shadowColor = '#ff0000';
    ctx.beginPath();
    ctx.arc(0, -size * 1.33, Math.max(2.5, size * 0.02), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  ctx.restore();
}

// ── M42 composite cache (Phase 29, M42 render bottleneck fix) ──────
// The photographic M42 draw runs the image through a grayscale+contrast+blur
// ctx.filter chain — a multi-pass CPU composite that used to execute on
// EVERY frame of both feeds. Now the filtered result is rendered ONCE into
// an offscreen canvas keyed by (quantized size, quantized blur) and each
// frame just blits that cached bitmap. Recalculated only when the eyepiece/
// zoom/defocus actually changes the requested size or blur.
const m42CompositeCache = new Map<string, HTMLCanvasElement>();
const M42_CACHE_MAX_ENTRIES = 8;

function getM42Composite(sizePx: number, blurPx: number, orionTex: LoadedTexture): HTMLCanvasElement | null {
  // Quantize so continuous defocus animation doesn't re-bake every frame.
  const qSize = Math.max(4, Math.round(sizePx / 4) * 4);
  const qBlur = Math.round(blurPx * 2) / 2;
  const key = `${qSize}|${qBlur}`;

  const cached = m42CompositeCache.get(key);
  if (cached) return cached;

  const drawSize = qSize * 2.4;
  const pad = Math.ceil(qBlur * 2) + 2; // blur bleeds past the bitmap edge
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(drawSize + pad * 2);
  canvas.height = Math.ceil(drawSize + pad * 2);
  const cctx = canvas.getContext('2d');
  if (!cctx) return null;

  cctx.filter = `grayscale(100%) contrast(80%)${qBlur > 0 ? ` blur(${qBlur}px)` : ''}`;
  cctx.drawImage(orionTex, pad, pad, drawSize, drawSize);
  cctx.filter = 'none';

  if (m42CompositeCache.size >= M42_CACHE_MAX_ENTRIES) m42CompositeCache.clear();
  m42CompositeCache.set(key, canvas);
  return canvas;
}

/**
 * M42 (Orion Nebula). The caller owns the brightness/blur decision (it
 * depends on each view's own optics model — exit pupil, aperture, seeing) and
 * passes the resolved `alpha`/`blurPx` in; this function only knows how to
 * paint the photo-or-procedural-glow at that brightness. ctx must already be
 * translated so (0,0) is the target center — callers that aren't already
 * translated should wrap in ctx.save()/translate(x,y)/…/ctx.restore().
 */
export function drawM42(ctx: CanvasRenderingContext2D, size: number, orionImg: LoadedTexture | undefined, alpha: number, blurPx: number = 0): void {
  if (isTextureReady(orionImg)) {
    const composite = getM42Composite(size, blurPx, orionImg);
    if (composite) {
      ctx.globalAlpha = alpha;
      // 1:1 blit of the cached, pre-filtered bitmap — no per-frame filtering.
      ctx.drawImage(composite, -composite.width / 2, -composite.height / 2);
      return;
    }
  }
  const rGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, size);
  rGrad.addColorStop(0, 'rgba(200, 200, 200, 0.4)');
  rGrad.addColorStop(0.2, 'rgba(150, 150, 150, 0.2)');
  rGrad.addColorStop(0.5, 'rgba(100, 100, 100, 0.05)');
  rGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fillStyle = rGrad;
  ctx.fill();
}

/**
 * Boot-time glyph warm-up (Phase 29) — pre-bakes the M42 filter composite at
 * the sizes the default eyepiece/finder configuration will request first, so
 * the first switch to M42 never pays the multi-pass filter cost mid-frame.
 * Runs behind the boot loading screen; wrong guesses just re-bake lazily.
 */
export function warmGlyphCaches(assets: LoadedAssets | null): void {
  const orion = assets?.orion;
  if (isTextureReady(orion)) {
    // Representative radii: ~140px (main feed at default 25mm low power on a
    // 300px canvas), ~17px (6× finder), ~64px (mid-power main feed).
    for (const size of [140, 64, 17]) {
      getM42Composite(size, 0, orion);
    }
  }
  // Phase 34 soft-limb sprites, at the radii the default 25mm main feed and
  // the 6× finder request first; wrong guesses just re-bake lazily.
  const moon = assets?.moon;
  if (isTextureReady(moon)) for (const r of [72, 10]) getMoonSprite(r, moon);
  const jupiter = assets?.jupiter;
  if (isTextureReady(jupiter)) for (const r of [12, 2]) getJupiterSprite(r, jupiter);
  const saturn = assets?.saturn;
  if (isTextureReady(saturn)) for (const r of [10, 2]) getSaturnSprite(r, saturn);
}
