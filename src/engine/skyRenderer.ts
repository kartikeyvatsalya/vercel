import { getTargetRenderScale, getApertureBrightnessMultiplier } from './opticalMath';
import { computeSkyOffsetDeg, projectSkyOffsetPx, wrap180, getBodyEquatorial } from './skyGeometry';
import { drawMoon, drawSaturn, drawSun, drawSpire, drawM42, drawJupiter, type JovianMoonSprite } from './targetGlyphs';
import { getJulianDate, getLocalSiderealTime, convertEquatorialToHorizontalLST, convertHorizontalToRaDec, getParallacticAngleDeg, getGalileanMoonPositions, getLunarPhase } from './ephemerisMath';
import { STAR_CATALOG, STAR_TINT, starRadiusPx, CONSTELLATION_LINES, STAR_BY_NAME, type CatalogStar } from './starCatalog';
import { skyColorForSunAlt, skyDarknessForSunAlt, starAlpha } from './daylight';
import type { Target } from '../types';
import type { LoadedAssets } from './assetLoader';
import type { RuleEvaluationResult } from './rulesEngine';

/**
 * Unified Optical View Renderer (Phase 27, P27.2)
 * ─────────────────────────────────────────────────────────────────
 * One canonical draw routine for a single square canvas — either the Main
 * Eyepiece Feed or the Finderscope Feed. Both feeds in LiveViewPanel call
 * this with the same `evalResult`/`target`/`pointing`, differing only in
 * `role`, `trueFovDeg`, and the finder-only axis fields — so manual
 * slewing, simTime drift, and motorized tracking update both feeds
 * simultaneously by construction (they read the same store), each scaled
 * correctly by its own field of view.
 *
 * This is a pure function of its spec: no store access, no React.
 */
export interface OpticalViewSpec {
  /** Which physical eyepiece this canvas represents. */
  role: 'main' | 'finder';
  /** Square canvas side length in px. */
  viewportPx: number;
  /** True field of view for THIS role (main: eyepiece-derived; finder: fixed 6×/45°). */
  trueFovDeg: number;
  /** The mount's true Alt/Az pointing — identical for both feeds. */
  pointing: { alt: number; az: number };
  /** Finder-only: divergence between the finder's aim and the mount's true pointing. */
  axisErrorDeg?: { deltaAlt: number; deltaAz: number };
  /** Finder-only: legacy px-based thumbscrew nudge from useAlignmentStore. */
  legacyAlignmentOffsetPx?: { x: number; y: number };
  /** Finder-only: drives the crosshair's aligned (green) vs seeking (red) color. */
  isCrosshairAligned?: boolean;
  /**
   * Main-only: profile.isInvertedView. A real Newtonian/Dobsonian mirror
   * flips the ENTIRE field 180° — not just asymmetric targets — so this
   * rotates the whole target position + glyph as one unit around the
   * canvas center, leaving the crosshair/bezel HUD screen-locked.
   */
  rotate180?: boolean;
  /**
   * Drift-gentled ephemeris time for the WHOLE SKY's position — stars AND
   * every catalog body alike (Phase 38; see skyGeometry.getDriftGentledSimTime).
   * Easy/Fun modes slow this clock relative to `simTime` so passive drift is
   * gentler with the motor off; the celestial sphere stays perfectly rigid
   * because the starfield and every body all read this SAME clock (never a
   * per-body one). The mount's raw pointing is untouched by any of this, so
   * manual slews still map 1:1 onto both feeds during any drag. Defaults to
   * `simTime` (no gentling) when a caller doesn't supply it.
   */
  targetSimTime?: number;
  /** Main-only "Digital Zoom" override (Fun mode); 1 = no zoom. */
  digitalZoom?: number;
  evalResult: RuleEvaluationResult;
  isHighPerformanceMode: boolean;
  aperture: number;
  /**
   * The UI-locked target (Phase 35 semantics): marks which sky body runs on
   * the drift-gentled `targetSimTime` clock and anchors the defocus bokeh.
   * It NO LONGER gates rendering — `skyBodies` below is what gets drawn.
   */
  target: Target | null;
  /**
   * ── The Universal Physical Sky (Phase 35) ──
   * EVERY major catalog body (Moon, Sun, planets, DSOs, terrestrial marks),
   * evaluated for physical visibility every frame regardless of the UI
   * target lock. Whatever naturally falls in this feed's field of view is
   * drawn — so a manual slew pans the Moon out of (or past) the eyepiece in
   * rigid formation with the starfield instead of blanking it. Bodies
   * outside the field are mathematically culled before any texture/sprite
   * work (see drawUniversalSkyBodies).
   */
  skyBodies: Target[];
  assets: LoadedAssets | null;
  observer: { latitude: number; longitude: number };
  simTime: number;
  /** A single performance.now() sampled once per frame, shared by both feeds. */
  now: number;
  /**
   * EFFECTIVE sun altitude in degrees (Phase 29) — after any Virtual Night
   * override. Drives the dynamic day/twilight/night background color and
   * how deeply the real starfield shows through.
   */
  sunAltDeg: number;
  /**
   * True for Alt-Az mounts (Dobsonian, forks) — no equatorial derotator, so
   * the target glyph itself visibly rotates over time (parallactic/field
   * rotation, Phase 30). False for Equatorial (GEM/fork-on-wedge) mounts,
   * which track the sky without this rotation by mechanical design.
   */
  isAltAzMount: boolean;
}

// ── Star tint → RGB (Phase 42) ─────────────────────────────────────
// The radial-gradient star draw below needs rgba() stops (an opaque core
// fading to a transparent glow), but STAR_TINT holds hex strings. Parse each
// spectral class once at module load — there are only seven — so the per-star
// per-frame path just interpolates the cached channels into template strings.
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
const STAR_TINT_RGB: Record<string, { r: number; g: number; b: number }> = Object.fromEntries(
  Object.entries(STAR_TINT).map(([spec, hex]) => [spec, hexToRgb(hex)])
);

// ── Constellation Lines (Phase 30) ─────────────────────────────────
// Faint asterism lines, drawn BEFORE the star points so the dots layer
// cleanly on top of their own connecting lines. Shares the exact same
// Alt/Az→pixel projection as the star field so a line's endpoints always
// land precisely on their stars — no line-clipping needed either: the
// circular field-stop mask applied at the end of renderOpticalView crops
// everything (stars, target, lines) to the eyepiece aperture regardless.
function drawConstellationLines(
  ctx: CanvasRenderingContext2D,
  spec: OpticalViewSpec,
  offsetX: number,
  offsetY: number,
  darkness: number
): void {
  const { viewportPx, trueFovDeg, pointing, observer, simTime, targetSimTime } = spec;
  if (trueFovDeg <= 0) return;
  const centerX = viewportPx / 2;
  const centerY = viewportPx / 2;
  const pxPerDeg = viewportPx / trueFovDeg;
  // A touch looser than the star cull — a line can legitimately span
  // between one visible star and one just past the star-cull margin.
  const maxOffDeg = trueFovDeg * 0.85;
  // Phase 38: the same gentled clock as every other sky layer — see the
  // "Real starfield" comment below for why this must be shared, not per-body.
  const skySimTime = targetSimTime ?? simTime;
  const lstHours = getLocalSiderealTime(getJulianDate(new Date(skySimTime)), observer.longitude);

  const project = (star: CatalogStar): { x: number; y: number } | null => {
    const pos = convertEquatorialToHorizontalLST(star.ra, star.dec, observer.latitude, lstHours);
    if (pos.altitude < -1) return null;
    const dAlt = pos.altitude - pointing.alt;
    if (dAlt > maxOffDeg || dAlt < -maxOffDeg) return null;
    const dAz = wrap180(pos.azimuth - pointing.az);
    if (dAz > maxOffDeg || dAz < -maxOffDeg) return null;
    return { x: centerX + offsetX + dAz * pxPerDeg, y: centerY + offsetY - dAlt * pxPerDeg };
  };

  ctx.strokeStyle = `rgba(148, 197, 255, ${0.28 * darkness})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [nameA, nameB] of CONSTELLATION_LINES) {
    const starA = STAR_BY_NAME.get(nameA);
    const starB = STAR_BY_NAME.get(nameB);
    if (!starA || !starB) continue;
    const a = project(starA);
    const b = project(starB);
    if (!a || !b) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

// ── Faint telescopic field stars (Phase 33) ────────────────────────
// The named catalog above is ~150 stars — one per ~275 square degrees. Real
// and correct for the naked eye, but an eyepiece-scale field (a 25mm at 46×
// sees ~1.3 sq deg) is then statistically ALWAYS empty: manual slews showed
// a bare void with nothing streaking past. This layer supplies the
// anonymous field stars every real telescope shows: deterministic
// pseudo-stars hashed from FIXED RA/Dec grid cells, so each one is bolted
// to the celestial sphere — it pans 1:1 with the mount during slews and
// drifts at the true sidereal rate, exactly like the named stars.
// Two tiers bound the per-frame projection count at any zoom:
//   tier 0: 4°×4° cells, mag ≈4.8–7.5 — wide fields (the 7.5° finder)
//   tier 1: 1°×1° cells, mag ≈7.5–11.5 — eyepiece fields only (FOV ≤ 4°)
interface FieldStarTier {
  cellSizeDeg: number;
  starsPerCell: number;
  magMin: number;
  magMax: number;
  /** Tier is skipped for fields wider than this (keeps cell counts bounded). */
  maxFovDeg: number;
}

const FIELD_STAR_TIERS: FieldStarTier[] = [
  { cellSizeDeg: 4, starsPerCell: 8, magMin: 4.8, magMax: 7.5, maxFovDeg: 60 },
  { cellSizeDeg: 1, starsPerCell: 14, magMin: 7.5, magMax: 11.5, maxFovDeg: 4 },
];

/** The 6×30 straight-through finder's fixed objective aperture, mm. */
const FINDER_APERTURE_MM = 30;

/** Deterministic per-cell PRNG (mulberry32) so the same sky cell always holds the same stars. */
function cellRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawFaintFieldStars(
  ctx: CanvasRenderingContext2D,
  spec: OpticalViewSpec,
  offsetX: number,
  offsetY: number,
  darkness: number
): void {
  const { viewportPx, trueFovDeg, pointing, observer, simTime, targetSimTime, role, aperture } = spec;
  if (trueFovDeg <= 0) return;
  // Faint stars die first as the sky brightens: fully gone by late civil
  // twilight, full strength once past nautical dusk.
  const twilightGate = Math.max(0, Math.min(1, (darkness - 0.15) / 0.35));
  if (twilightGate <= 0.02) return;

  const centerX = viewportPx / 2;
  const centerY = viewportPx / 2;
  const pxPerDeg = viewportPx / trueFovDeg;
  const maxOffDeg = trueFovDeg * 0.78;
  // Phase 38: gentled sky clock, shared with every other layer (see the
  // "Real starfield" comment below) — the LST spin and the center-cell
  // anchor just below must agree on the same instant, or the anchor drifts
  // loose from the very stars it's supposed to be centered among.
  const skySimTime = targetSimTime ?? simTime;
  const lstHours = getLocalSiderealTime(getJulianDate(new Date(skySimTime)), observer.longitude);
  // Standard limiting-magnitude estimate Lm ≈ 7.5 + 5·log10(D/10mm):
  // the 30mm finder reaches ~9.9, a 200mm Dob ~14 — which stars survive
  // at all depends on the glass, exactly as at a real eyepiece.
  const apertureMm = role === 'finder' ? FINDER_APERTURE_MM : Math.max(10, aperture);
  const limitingMag = 7.5 + 5 * Math.log10(apertureMm / 10);

  // Which RA/Dec cells cover this field: anchor the search at the RA/Dec
  // currently passing through the view center.
  const centerEq = convertHorizontalToRaDec(
    pointing.alt, pointing.az,
    observer.latitude, observer.longitude,
    new Date(skySimTime)
  );
  const centerRaDeg = centerEq.ra * 15;
  const centerDecDeg = centerEq.dec;

  ctx.fillStyle = '#dde5f2';
  for (let tierIdx = 0; tierIdx < FIELD_STAR_TIERS.length; tierIdx++) {
    const tier = FIELD_STAR_TIERS[tierIdx];
    if (trueFovDeg > tier.maxFovDeg) continue;
    const cell = tier.cellSizeDeg;
    const reachDeg = maxOffDeg + cell;
    const decLo = Math.floor((centerDecDeg - reachDeg) / cell);
    const decHi = Math.floor((centerDecDeg + reachDeg) / cell);
    const raCellsTotal = Math.ceil(360 / cell);

    for (let di = decLo; di <= decHi; di++) {
      const cellDecMid = (di + 0.5) * cell;
      if (cellDecMid >= 90 || cellDecMid <= -90) continue;
      // RA degrees shrink toward the poles — widen the RA search to match.
      const cosDec = Math.max(0.15, Math.cos((cellDecMid * Math.PI) / 180));
      const raReachCells = Math.ceil(reachDeg / cosDec / cell);
      const raMid = Math.floor(centerRaDeg / cell);
      const raSpan = Math.min(raCellsTotal, raReachCells * 2 + 1);

      for (let k = 0; k < raSpan; k++) {
        const ri = ((raMid - raReachCells + k) % raCellsTotal + raCellsTotal) % raCellsTotal;
        // Seed from the wrapped, sky-fixed cell identity (never the FOV or
        // frame), so a cell's stars are identical from every view forever.
        const rand = cellRandom((ri * 73856093) ^ (di * 19349663) ^ (tierIdx * 83492791));

        for (let s = 0; s < tier.starsPerCell; s++) {
          const raDeg = (ri + rand()) * cell;
          const decDeg = (di + rand()) * cell;
          // Quadratic skew toward the faint end — real star counts climb
          // steeply with magnitude.
          const frac = rand();
          const mag = tier.magMax - (tier.magMax - tier.magMin) * frac * frac;
          if (mag > limitingMag) continue;

          const pos = convertEquatorialToHorizontalLST(raDeg / 15, decDeg, observer.latitude, lstHours);
          if (pos.altitude < -1) continue;
          const dAlt = pos.altitude - pointing.alt;
          if (dAlt > maxOffDeg || dAlt < -maxOffDeg) continue;
          const dAz = wrap180(pos.azimuth - pointing.az);
          if (dAz > maxOffDeg || dAz < -maxOffDeg) continue;

          const headroom = limitingMag - mag;
          ctx.globalAlpha = Math.min(0.9, 0.3 + headroom * 0.11) * twilightGate;
          // Floor at 1px — sub-pixel arcs antialias into near-invisibility,
          // and a field star's whole job here is to be a SEEN pinpoint.
          const radius = Math.max(1, 1.9 - 0.1 * mag);
          const x = centerX + offsetX + dAz * pxPerDeg;
          const y = centerY + offsetY - dAlt * pxPerDeg;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  ctx.globalAlpha = 1;
}

// ── Daylight target visibility (Phase 33) ──────────────────────────
// Rayleigh-scattered skylight washes out everything with lower surface
// brightness than the sky itself. Who survives daytime is decided by type:
// the Sun IS the daylight; ground scenery is front-lit; the Moon reads as a
// pale ghost; planets only emerge through civil twilight (Jupiter in a blue
// noon sky was pure fiction); nebulae need genuinely dark skies. The
// Virtual Night toggle forces darkness = 1, restoring full visibility.
function daylightTargetVisibility(targetType: Target['type'], darkness: number): number {
  switch (targetType) {
    case 'sun':
    case 'terrestrial':
      return 1;
    case 'moon':
      return 0.35 + 0.65 * darkness;
    case 'planet':
      return Math.max(0, Math.min(1, (darkness - 0.12) / 0.45));
    default: // nebula, galaxy, star — surface brightness far below the day sky
      return Math.max(0, Math.min(1, (darkness - 0.45) / 0.5));
  }
}

// ── Real starfield (Phase 29, Stellarium-lite; rigid sky in Phase 38) ──
// Replaces the old procedural random-hash stars: the ~150 brightest catalog
// stars are projected through the SAME flat Alt/Az viewport mapping the
// target uses, so constellations hold together during manual slews and
// drift. The starfield and EVERY catalog body (drawUniversalSkyBodies) now
// read the same gentled clock (spec.targetSimTime ?? spec.simTime) — the
// celestial sphere is treated as one rigid object, so Easy/Fun mode's slowed
// drift rate applies to it as a whole instead of letting a locked target lag
// behind the stars around it (the old per-body clock produced exactly that
// visible desync). Raw mount pointing is untouched by any of this, so manual
// slews still pan honestly at 1:1 in both feeds.
function drawStarField(
  ctx: CanvasRenderingContext2D,
  spec: OpticalViewSpec,
  offsetX: number,
  offsetY: number,
  darkness: number
): void {
  if (darkness <= 0) return; // full daylight — no stars pierce it

  drawConstellationLines(ctx, spec, offsetX, offsetY, darkness);
  // Anonymous telescopic field stars underneath the named catalog (Phase 33).
  drawFaintFieldStars(ctx, spec, offsetX, offsetY, darkness);

  const { viewportPx, trueFovDeg, pointing, observer, simTime, targetSimTime, role, aperture } = spec;
  if (trueFovDeg <= 0) return;
  const centerX = viewportPx / 2;
  const centerY = viewportPx / 2;
  const pxPerDeg = viewportPx / trueFovDeg;
  // Cull margin: half the canvas diagonal plus a little slack for halos.
  const maxOffDeg = trueFovDeg * 0.78;
  const skySimTime = targetSimTime ?? simTime;
  const lstHours = getLocalSiderealTime(getJulianDate(new Date(skySimTime)), observer.longitude);
  // Small apertures gather less light — stars dim slightly in the main
  // eyepiece of a 60mm scope. The 6×30 finder keeps its bright wide view.
  const apertureFactor = role === 'finder'
    ? 1
    : Math.max(0.35, Math.min(1, getApertureBrightnessMultiplier(aperture)));

  for (const star of STAR_CATALOG) {
    const pos = convertEquatorialToHorizontalLST(star.ra, star.dec, observer.latitude, lstHours);
    if (pos.altitude < -1) continue; // below the horizon
    const dAlt = pos.altitude - pointing.alt;
    if (dAlt > maxOffDeg || dAlt < -maxOffDeg) continue;
    const dAz = wrap180(pos.azimuth - pointing.az);
    if (dAz > maxOffDeg || dAz < -maxOffDeg) continue;

    const alpha = starAlpha(star.mag, darkness) * apertureFactor;
    if (alpha <= 0.02) continue;

    const x = centerX + offsetX + dAz * pxPerDeg;
    const y = centerY + offsetY - dAlt * pxPerDeg;
    const radius = starRadiusPx(star.mag);

    // ── Diffuse radial-gradient star (Phase 42) ── Replaces the old hard
    // arc + separate halo pair. A single radial gradient models what a real
    // point source looks like through atmosphere and glass: a bright, nearly
    // white core that bleeds out through its spectral tint into a soft,
    // fully-transparent glow — no hard-edged disk. The glow reaches farther
    // for the showpiece first-magnitude stars (Sirius, Vega) so they visibly
    // bloom, riding on top of the exponential core radius from starRadiusPx.
    const { r, g, b } = STAR_TINT_RGB[star.spec];
    const glowRadius = radius * (star.mag < 0.8 ? 3.6 : 2.8);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    grad.addColorStop(0, 'rgba(255,255,255,1)');            // white-hot pinpoint core
    grad.addColorStop(0.26, `rgba(${r},${g},${b},0.95)`);  // tinted core
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.25)`);  // mid atmospheric glow
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);        // fades fully to sky
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── The Universal Physical Sky (Phase 35) ──────────────────────────
// Draws every catalog body that physically falls in the field of view,
// decoupled from the UI target lock. A real telescope looks at a physical
// universe: pushing the tube off the Moon pans the Moon out of the field
// along with the stars — it doesn't erase it from the sky. The previously
// locked-target-only pipeline (absolute angular scaling, aperture
// brightness, daylight washout, parallactic field rotation, the Jovian
// moon system) now runs per visible body, unchanged in the physics.

// Paint order far → near, so a nearer body occludes a farther one when
// they overlap: M42 (1,344 ly) under the planets, the Moon over them, and
// terrestrial scenery (2.5 km) in front of everything.
const BODY_DEPTH_RANK: Record<string, number> = {
  m42: 0, saturn: 1, jupiter: 2, sun: 3, moon: 4, spire: 6,
};
const DEFAULT_DEPTH_RANK = 5; // unknown celestial bodies: above the Moon, behind scenery

// ── Starfield occlusion set (Phase 39) ─────────────────────────────
// Opaque, roughly circular disks that must BLOCK the stars drawn behind
// them: without this, aperture dimming (a small scope draws the body at
// reduced alpha) or daylight washout let the already-painted starfield
// bleed straight through the Moon/planet ("ghost moon"). Deliberately
// excludes:
//   • m42 — a real emission nebula IS translucent; stars genuinely show
//     through it, so occluding behind it would be physically wrong.
//   • sun — culled below the horizon whenever the sky is dark enough to
//     draw stars at all, so it is never co-visible with the starfield.
//   • spire — a terrestrial tower (non-circular) only ever seen against a
//     daytime sky, where no starfield is drawn.
const STARFIELD_OCCLUDING_BODIES = new Set(['moon', 'saturn', 'jupiter']);

/**
 * Angular radius (deg) of a body's full RENDER footprint, for FOV culling.
 * Jupiter's footprint is dominated by the Galilean moons, not the disk:
 * Callisto swings out to ±26.33 Jupiter radii (see GALILEAN_MOONS), so its
 * cull radius must cover the whole moon line. Everything else gets 2× its
 * angular radius — slack for glow halos (Sun 1.2×), Saturn's rotated rings,
 * the spire's tower, and the min-px glyph clamps.
 */
function bodyCullRadiusDeg(body: Target): number {
  const diameterDeg = body.angularDiameterDeg ?? body.angularSize / 60;
  const spanFactor = body.id === 'jupiter' ? 27 : 2;
  return (diameterDeg / 2) * spanFactor;
}

/**
 * Evaluate + draw ALL catalog bodies against the mount's raw pointing.
 * Runs inside renderOpticalView's sky transform (finder axis error, droop,
 * jitter, optical inversion all arrive via offsetX/offsetY and the ambient
 * canvas transform), between the starfield below and the HUD above.
 *
 * 60fps guard: each body is culled by pure math — daylight washout, then
 * below-horizon, then field-of-view bounds — before ANY sprite/texture or
 * per-body trig (parallactic angle, Jovian ephemeris) is touched. A culled
 * body costs one Alt/Az conversion, the same as a single catalog star.
 */
function drawUniversalSkyBodies(
  ctx: CanvasRenderingContext2D,
  spec: OpticalViewSpec,
  offsetX: number,
  offsetY: number,
  darkness: number,
  blurAmount: number
): void {
  const {
    role, viewportPx, trueFovDeg, pointing, digitalZoom, evalResult, aperture,
    target, skyBodies, assets, observer, simTime, now, isAltAzMount, sunAltDeg,
  } = spec;
  if (trueFovDeg <= 0 || skyBodies.length === 0) return;
  const targetSimTime = spec.targetSimTime ?? simTime;
  const isFinder = role === 'finder';
  const centerX = viewportPx / 2;
  const centerY = viewportPx / 2;
  const zoom = digitalZoom ?? 1;
  // Same cull margin family as the starfield (trueFov × 0.78), widened per
  // body by its own footprint so a disk larger than the field — the Moon at
  // high power — keeps drawing while its center sits off-canvas.
  const fovMarginDeg = trueFovDeg * 0.78;
  // Aperture brightness (main feed only) is body-independent — hoist it.
  const apertureAlpha = isFinder
    ? 1
    : Math.max(0.25, Math.min(1.0, getApertureBrightnessMultiplier(aperture)));
  // Sky background color for the Phase 39 star-occlusion disks (see the draw
  // loop below) — the SAME value renderOpticalView fills the backdrop with, so
  // an occlusion disk is invisible except that it erases the stars an opaque,
  // dimmed body must block from showing through it.
  const occlusionColor = skyColorForSunAlt(sunAltDeg);

  const bodies = [...skyBodies].sort(
    (a, b) => (BODY_DEPTH_RANK[a.id] ?? DEFAULT_DEPTH_RANK) - (BODY_DEPTH_RANK[b.id] ?? DEFAULT_DEPTH_RANK)
  );

  for (const body of bodies) {
    const isLockedTarget = target?.id === body.id;
    // Phase 38: EVERY body — locked target and free bodies alike — reads
    // the same gentled clock as the starfield (targetSimTime, resolved
    // above). The old per-body split (locked target gentled, everything
    // else on true time) let a locked target visibly lag the stars around
    // it whenever the motor was off; a manual slew still streaks any body
    // across the field in rigid formation with the stars, because gentling
    // only slows the celestial sphere's own rotation, never the raw
    // mount-pointing math above. (useTelescopeStore.clearTarget re-anchors
    // driftAnchorSimTime on release, so a body losing its lock never jumps.)
    const bodySimTime = targetSimTime;

    // ── Cull 1: daylight washout ── Bodies dimmer than the day sky simply
    // aren't there to draw (Virtual Night restores them via darkness = 1).
    const daylightVis = daylightTargetVisibility(body.type, darkness);
    if (daylightVis <= 0.01) continue;

    // ── Cull 2: one Alt/Az conversion → below-horizon + FOV bounds ──
    const skyOffset = computeSkyOffsetDeg(
      body, pointing.alt, pointing.az, observer.latitude, observer.longitude, bodySimTime
    );
    if (!skyOffset) continue;
    const cullRadiusDeg = bodyCullRadiusDeg(body);
    // Same −1° horizon grace the starfield uses; terrestrial bodies are
    // ground-anchored and exempt by construction (fixed alt 45°).
    if (body.type !== 'terrestrial' && pointing.alt + skyOffset.dAlt < -1 - cullRadiusDeg) continue;
    const maxOffDeg = fovMarginDeg + cullRadiusDeg;
    if (skyOffset.dAlt > maxOffDeg || skyOffset.dAlt < -maxOffDeg) continue;
    if (skyOffset.dAz > maxOffDeg || skyOffset.dAz < -maxOffDeg) continue;

    // ── Visible: run the full glyph pipeline (ex-locked-target path) ──
    const angularDiameterDeg = body.angularDiameterDeg ?? body.angularSize / 60;
    const { px: skyPxX, py: skyPxY } = projectSkyOffsetPx(skyOffset, trueFovDeg, viewportPx);
    const targetX = centerX + offsetX + skyPxX;
    const targetY = centerY + offsetY + skyPxY;

    // ── ABSOLUTE ANGULAR SCALING (Phase 24) + Digital Zoom (Phase 26) ──
    const baseSize = getTargetRenderScale(body.id, angularDiameterDeg, trueFovDeg, viewportPx) * zoom;
    const targetSize = evalResult.isDefocused && !isFinder
      ? baseSize + evalResult.defocusAmount * 0.5
      : baseSize;

    // ── STARFIELD OCCLUSION (Phase 39) ── An opaque body must BLOCK the
    // stars behind it. The starfield is painted before any body, so drawing
    // the Moon/planet at reduced alpha (aperture dimming on a small scope, or
    // daylight washout) used to let those stars bleed straight through it —
    // the "ghost moon." Punch a solid, fully-opaque disk of the sky's own
    // background color at the glyph's exact radius FIRST, so the dimmed body
    // then composits over clean sky instead of over stars. Main feed only
    // (the finder applies no aperture dimming); a circle is rotation-
    // invariant, so this sits cleanly outside the parallactic transform.
    if (!isFinder && STARFIELD_OCCLUDING_BODIES.has(body.id)) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = occlusionColor;
      ctx.beginPath();
      ctx.arc(targetX, targetY, targetSize, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── APERTURE BRIGHTNESS (main feed only) × DAYLIGHT WASHOUT (both) ──
    ctx.globalAlpha = apertureAlpha * daylightVis;

    // ── FIELD ROTATION (Phase 30) ── An Alt-Az mount has no equatorial
    // derotator: a celestial object's apparent "up" spins by the
    // parallactic angle as it crosses the sky. Depends only on the BODY's
    // own position (not on pointing/tracking error or role), so both feeds
    // — rigidly bolted to the same tube — see an identical spin.
    // Terrestrial bodies have no equatorial anchor and are naturally
    // excluded (getBodyEquatorial → null).
    const bodyEq = getBodyEquatorial(body, bodySimTime);
    const parallacticAngleRad = isAltAzMount && bodyEq
      ? (getParallacticAngleDeg(bodyEq.ra, bodyEq.dec, observer.latitude, observer.longitude, new Date(bodySimTime)) * Math.PI) / 180
      : 0;
    // The Moon opts out of this shared body-spin wrapper (Phase 42): it runs
    // its OWN parallactic rotation on just the surface texture inside drawMoon,
    // because its Sun-driven phase terminator must be oriented toward the Sun
    // independently of how far that surface has field-rotated.
    const applyFieldSpin = parallacticAngleRad !== 0 && body.id !== 'moon';
    if (applyFieldSpin) {
      ctx.save();
      ctx.translate(targetX, targetY);
      ctx.rotate(parallacticAngleRad);
      ctx.translate(-targetX, -targetY);
    }

    // ── The Jovian system (Phase 32) ── Moon offsets from the simplified
    // Galilean ephemeris at this body's own clock, projected at TRUE
    // angular scale through this feed's pxPerDeg. Occulted moons (behind
    // the disk) are filtered here, where the physics lives. Painted inside
    // the parallactic transform above, so disk AND moon line field-rotate
    // as one rigid unit on Alt-Az mounts.
    let jovianMoons: JovianMoonSprite[] = [];
    if (body.id === 'jupiter') {
      const pxPerDeg = (viewportPx / trueFovDeg) * zoom;
      const jupiterRadiusDeg = angularDiameterDeg / 2;
      jovianMoons = getGalileanMoonPositions(getJulianDate(new Date(bodySimTime)))
        .filter((m) => !m.isOcculted)
        .map((m) => ({
          offsetPx: m.offsetJupiterRadii * jupiterRadiusDeg * pxPerDeg,
          radiusPx: Math.max(1.3, starRadiusPx(m.magnitude) + 0.6),
        }));
    }

    if (body.id === 'sun') {
      drawSun(ctx, targetX, targetY, targetSize);
    } else if (body.id === 'saturn') {
      drawSaturn(ctx, targetX, targetY, targetSize, assets);
    } else if (body.id === 'jupiter') {
      drawJupiter(ctx, targetX, targetY, targetSize, assets, jovianMoons);
    } else if (body.id === 'moon') {
      // ── Lunar phase + parallactic surface rotation + halo (Phase 42) ──
      // getLunarPhase pulls the live Sun ephemeris itself; bodyEq is the
      // Moon's own RA/Dec. brightLimbUpAngleDeg is the lit-limb tilt measured
      // clockwise from screen-up — convert it to the canvas rotation that
      // aims drawMoon's local +x (its lit side) at the Sun:
      //   rotate(a) sends (1,0) → (cos a, sin a), and (sin θ, −cos θ) is the
      //   screen vector θ clockwise from up, so a = atan2(−cos θ, sin θ).
      const phase = bodyEq
        ? getLunarPhase(bodyEq.ra, bodyEq.dec, observer.latitude, observer.longitude, new Date(bodySimTime))
        : { illuminatedFraction: 1, brightLimbUpAngleDeg: 0 };
      const theta = (phase.brightLimbUpAngleDeg * Math.PI) / 180;
      const brightLimbRad = Math.atan2(-Math.cos(theta), Math.sin(theta));
      drawMoon(ctx, targetX, targetY, targetSize, assets, {
        parallacticRad: parallacticAngleRad,
        illuminatedFraction: phase.illuminatedFraction,
        brightLimbRad,
      });
    } else if (body.id === 'm42') {
      ctx.save();
      ctx.translate(targetX, targetY);
      // drawM42 owns its own globalAlpha — fold the daylight washout into
      // the alpha it's handed instead.
      drawM42(ctx, targetSize, assets?.orion, 0.3 * daylightVis, blurAmount);
      ctx.restore();
    } else if (body.id === 'spire') {
      // No per-glyph invert flag: renderOpticalView's canvas-level rotate180
      // already covers the whole field, this body included.
      drawSpire(ctx, targetX, targetY, targetSize, now, false);
    } else {
      // Defensive fallback — no body id besides the six above exists in the
      // current catalog, but this mirrors the old locked-target safety net.
      ctx.beginPath();
      ctx.arc(targetX, targetY, targetSize, 0, Math.PI * 2);
      ctx.fillStyle = '#cccccc';
      ctx.fill();
    }

    if (applyFieldSpin) {
      ctx.restore();
    }

    ctx.globalAlpha = 1.0;

    // Bokeh donut hole for defocus (main feed only) — anchored to the
    // LOCKED target only: it's the "you're staring at the bright subject"
    // artifact, and punching destination-out holes at every body would
    // shred the composited field.
    if (isLockedTarget && !isFinder && evalResult.isDefocused && blurAmount > 5) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(targetX, targetY, targetSize * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 0, 0, 1)';
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }
}

export function renderOpticalView(ctx: CanvasRenderingContext2D, spec: OpticalViewSpec): void {
  const {
    role, viewportPx, trueFovDeg, axisErrorDeg, legacyAlignmentOffsetPx,
    isCrosshairAligned, rotate180, evalResult,
    isHighPerformanceMode, now, sunAltDeg,
  } = spec;
  const isFinder = role === 'finder';
  const width = viewportPx;
  const height = viewportPx;
  const centerX = width / 2;
  const centerY = height / 2;

  // ── Dynamic daylight (Phase 29) ── The backdrop tracks the Sun's altitude
  // through the full day → twilight → night ramp instead of being pinned to
  // space-black; the star catalog fades in through twilight to match.
  const skyDarkness = skyDarknessForSunAlt(sunAltDeg);
  ctx.fillStyle = skyColorForSunAlt(sunAltDeg);
  ctx.fillRect(0, 0, width, height);

  if (evalResult.isBlackedOut) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
  } else if (evalResult.hasSolarHazard && !isFinder) {
    // SOLAR HAZARD OVERRIDE - MAIN EYEPIECE
    const flashGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, width);
    flashGrad.addColorStop(0, '#ffffff');
    flashGrad.addColorStop(0.3, '#ffaa00');
    flashGrad.addColorStop(1, '#aa0000');
    ctx.fillStyle = flashGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#000000';
    ctx.fillText('CRITICAL HAZARD', centerX, centerY - 15);
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('Unfiltered sunlight detected!', centerX, centerY + 15);
    ctx.shadowBlur = 0;
  } else if (evalResult.hasSolarHazard && isFinder) {
    // Finder solar flash
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 100, 0, 0.5)';
    ctx.fillRect(0, 0, width, height);
  } else {
    // ── Draw the sky: starfield AND every visible catalog body, always ──
    // (Phase 29 freed the starfield from the target gate; Phase 35 finishes
    // the job — the bodies themselves render from physical visibility, not
    // UI selection.)
    ctx.save();

    let blurAmount = 0;
    if (isHighPerformanceMode) {
      if (evalResult.isAtmosphericBlurActive || evalResult.isThermalBlurActive) blurAmount += 2;
    }
    if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;

    // Atmospheric jitter (main feed only)
    const jitterX = (!isFinder && evalResult.isAtmosphericBlurActive) ? Math.sin(now * 0.01) * 2 : 0;
    const jitterY = (!isFinder && evalResult.isAtmosphericBlurActive) ? Math.cos(now * 0.012) * 2 : 0;

    // ── VIEWPORT DIVERGENCE (Phase 24) ──
    // The main feed shows the sky at the mount's true pointing; the finder
    // shows it at pointing + axisErrorDeg. A finder aimed high/right of true
    // shows the target low/left, so centering it there makes the main miss.
    const errorPxX = isFinder && axisErrorDeg ? (axisErrorDeg.deltaAz / trueFovDeg) * width : 0;
    const errorPxY = isFinder && axisErrorDeg ? (axisErrorDeg.deltaAlt / trueFovDeg) * height : 0;

    const legacyX = legacyAlignmentOffsetPx?.x ?? 0;
    const legacyY = legacyAlignmentOffsetPx?.y ?? 0;
    const currentOffsetX = isFinder ? -legacyX - errorPxX : 0;
    const currentOffsetY = isFinder ? -legacyY + errorPxY : 0;

    const droopY = evalResult.isAltDrooping ? ((now % 10000) / 10000) * height : 0;

    // ── Optical inversion (main feed only) — rotates the whole field (stars
    // AND target), not just the glyph, around the canvas center; HUD chrome
    // stays untouched since this transform is undone by ctx.restore()
    // before the crosshair.
    if (!isFinder && rotate180) {
      ctx.translate(centerX, centerY);
      ctx.rotate(Math.PI);
      ctx.translate(-centerX, -centerY);
    }

    // ── Real starfield (Phase 29) — shares the finder-error/droop/jitter
    // offsets and the inversion transform with the target so the whole
    // field moves as one rigid sky.
    drawStarField(
      ctx, spec,
      currentOffsetX + jitterX,
      currentOffsetY + droopY + jitterY,
      skyDarkness
    );

    // ── THE UNIVERSAL PHYSICAL SKY (Phase 35) ── Every catalog body is
    // evaluated against the mount's raw pointing and drawn if it physically
    // falls in this feed's field — the UI target lock no longer gates
    // rendering. Shares the finder-error/droop/jitter offsets and the
    // inversion transform with the starfield, so the whole sky — stars AND
    // bodies — moves as one rigid unit during any slew.
    drawUniversalSkyBodies(
      ctx, spec,
      currentOffsetX + jitterX,
      currentOffsetY + droopY + jitterY,
      skyDarkness,
      blurAmount
    );

    ctx.restore();
    ctx.filter = 'none';
    ctx.globalAlpha = 1.0; // always reset after sky draw

    // Finderscope crosshair — drawn with or without a target lock
    if (isFinder) {
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, height);
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);

      if (isCrosshairAligned) {
        const pulse = (Math.sin(now * 0.01) + 1) / 2;
        ctx.strokeStyle = `rgba(0, 255, 0, ${0.5 + pulse * 0.5})`;
        ctx.shadowColor = '#00ff00';
        ctx.shadowBlur = 10;
      } else {
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 5;
      }

      ctx.lineWidth = 2;
      ctx.stroke();

      // Center circle indicator
      ctx.beginPath();
      ctx.arc(centerX, centerY, 15, 0, Math.PI * 2);
      ctx.stroke();

      ctx.shadowBlur = 0;
    }
  }

  // Field Stop (Black Bezel) — always drawn, regardless of which branch fired
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.min(width, height) / 2 - 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Outer Bezel Rim
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.min(width, height) / 2 - 5, 0, Math.PI * 2);
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 10;
  ctx.stroke();
}
