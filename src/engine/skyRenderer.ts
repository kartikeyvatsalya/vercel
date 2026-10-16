import { getTargetRenderScale, getApertureBrightnessMultiplier } from './opticalMath';
import { TERRESTRIAL_POINTING, wrap180, getBodyEquatorial, getSunEquatorialAt, projectedFieldCapRadiusDeg } from './skyGeometry';
import { drawMoon, drawSaturn, drawSun, drawSpire, drawM42, drawJupiter, type JovianMoonSprite } from './targetGlyphs';
import { getJulianDate, getLocalSiderealTime, convertEquatorialToHorizontalLST, convertHorizontalToRaDec, getParallacticAngleDeg, getGalileanMoonPositions, getLunarIlluminatedFraction, degToRad } from './ephemerisMath';
import { STAR_CATALOG, STAR_TINT, starRadiusPx, CONSTELLATION_LINES, STAR_BY_NAME, type CatalogStar } from './starCatalog';
import {
  skyColorForSunAlt, skyDarknessForSunAlt, starAlpha,
  deepSkyVisibility, faintStarMagPenalty, transparencyThroughput, DEFAULT_TRANSPARENCY,
} from './daylight';
import { drawBahtinovAsterism, MAIN_MM_TO_PX, MAIN_ARM_LENGTH_PX, type BahtinovGeometry } from './bahtinov';
import {
  bakeStarTestSprite, blitStarTestSprite, drawComaFlare, starTestSpreadDimming,
  MIN_STAR_TEST_RADIUS_PX, STAR_TEST_MAG_LIMIT, type StarTestRenderSpec,
} from './starTest';
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
  /**
   * Main-only: the collimation beam error (Phase 61), converted to degrees of
   * Alt/Az pointing offset. Turning a screw tilts the MIRRORS, which are what
   * define the main telescope's outgoing optical axis — the finderscope is
   * bolted to the tube and does not move when a mirror does. So this is
   * applied to the main feed with the exact same sign convention as the
   * finder's own axisErrorDeg just above (both express "this feed's true aim
   * minus the mount's nominal pointing"), and is never read when
   * role === 'finder'.
   */
  collimationOffsetDeg?: { deltaAlt: number; deltaAz: number };
  /** Finder-only: drives the crosshair's aligned (green) vs seeking (red) color. */
  isCrosshairAligned?: boolean;
  /**
   * Main-only: profile.viewOrientation. A real Newtonian/Dobsonian (two
   * mirror reflections) rotates the ENTIRE field 180° ('inverted'); a
   * refractor/SCT used with a star diagonal (one reflection) mirrors it
   * left-right only ('mirrored') — a physically different transform, not
   * just a weaker version of the same thing. Either rotates/mirrors the
   * whole target position + glyph as one unit around the canvas center,
   * leaving the crosshair/bezel HUD screen-locked.
   */
  viewOrientation?: 'correct' | 'inverted' | 'mirrored';
  /** Main-only "Digital Zoom" override (Fun mode); 1 = no zoom. */
  digitalZoom?: number;
  /**
   * Main-only: true Bahtinov mask diffraction geometry (Phase 56), computed
   * by the caller from the live focuser state (see engine/bahtinov.ts).
   * Present only while the Bahtinov toggle is on, in 'astrophotography'
   * mode, and the locked target isn't the Sun/Moon (both far too extended
   * for a point-source diffraction spike to mean anything). Rendered over
   * the LOCKED target only, same anchor as the defocus bokeh hole below.
   */
  bahtinovGeometry?: BahtinovGeometry | null;
  /**
   * Main-only: live star-test geometry (Phase 57), computed by the caller
   * from the focuser position and the collimation store (see engine/starTest
   * and engine/collimation). Present only in 'collimate' mode. When set, the
   * bright end of the starfield stops drawing focused points and draws the
   * real defocused donut instead — the alignment instrument the whole mode
   * is built around. Null everywhere else, so no other mode pays for it.
   */
  starTest?: StarTestRenderSpec | null;
  evalResult: RuleEvaluationResult;
  /**
   * Whether THIS optic is flooded with unfiltered sunlight (Phase 66). The
   * main tube and the finder have separate axes — a mis-aimed finder can hold
   * the Sun while the main field does not, and vice versa — so the caller
   * resolves each feed's exposure from its own axis. Defaults to
   * evalResult.hasSolarHazard.
   */
  solarHazard?: boolean;
  isHighPerformanceMode: boolean;
  aperture: number;
  /**
   * The UI-locked target (Phase 35 semantics): anchors the defocus bokeh and
   * the Bahtinov overlay. It does NOT gate rendering — `skyBodies` below is
   * what gets drawn.
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
  /**
   * The one astronomical instant for this frame (engine/timeEngine). Every
   * layer — stars, field stars, constellation lines, every body and the
   * daylight — is drawn at this time, so the sky is one rigid object.
   * (Phase 66 removed the separate drift-"gentled" clock that stars and
   * bodies used to run on while the daylight and the 3D dome did not.)
   */
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
  /**
   * Sky transparency, 1 (milky) … 5 (pristine) — Phase 59. Distinct from
   * seeing: haze costs MAGNITUDES, not arcseconds, so it deletes faint field
   * stars and drains the contrast out of a nebula while leaving the Moon and
   * the planets essentially untouched. Defaults to pristine, which is exactly
   * what every frame before Phase 59 implicitly assumed.
   */
  transparency?: number;
  /**
   * The observer's dark adaptation, 0 (just blinded) … 1 (fully night-eyed) —
   * Phase 59. Multiplies the same faint-object budget transparency does; see
   * engine/daylight for the physiology.
   */
  darkAdaptation?: number;
}

/** Faint, low-surface-brightness bodies — the ones haze and a bright eye actually erase. */
const FAINT_BODY_TYPES = new Set<Target['type']>(['nebula', 'galaxy', 'star']);

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

// ── View geometry & culling (Phase 66) ─────────────────────────────
// Every sky layer draws through one flat Alt/Az mapping —
//   x = origin + dAz·cos(alt₀)·pxPerDeg,   y = origin − dAlt·pxPerDeg
// (see skyGeometry.projectSkyOffsetPx) — translated by this feed's sky-layer
// offset (finder axis error, legacy thumbscrew nudge, collimation, droop,
// jitter). Visibility used to be tested on RAW dAlt/dAz against a fixed
// fraction of the field, which disagreed with that mapping wherever cos(alt₀)
// differs from 1: at 80° altitude an object 2° away in azimuth projects 0.35°
// from centre — inside a 1° field — yet was culled. Every cull below now asks
// the same question the draw answers: does this object's rendered extent
// reach the circular field stop? For layers that walk a fixed list that is
// one multiply-add per object; only the procedural field stars enumerate
// candidates, through a bounded spherical cap (projectedFieldCapRadiusDeg).
interface ViewGeometry {
  /** Canvas centre — the eyepiece field stop is a circle around it. */
  centerX: number;
  centerY: number;
  /** Screen position of the mount's pointing (centre + this feed's sky-layer offset). */
  originX: number;
  originY: number;
  pxPerDeg: number;
  /** pxPerDeg · cos(pointing alt): the azimuth squeeze of the flat mapping. */
  azPxPerDeg: number;
  fieldRadiusPx: number;
  /** Field-angle radius (deg) around the POINTING that contains the whole visible circle. */
  reachDeg: number;
}

function makeViewGeometry(spec: OpticalViewSpec, offsetX: number, offsetY: number): ViewGeometry {
  const { viewportPx, trueFovDeg, pointing } = spec;
  const pxPerDeg = viewportPx / trueFovDeg;
  const fieldRadiusPx = viewportPx / 2;
  return {
    centerX: viewportPx / 2,
    centerY: viewportPx / 2,
    originX: viewportPx / 2 + offsetX,
    originY: viewportPx / 2 + offsetY,
    pxPerDeg,
    azPxPerDeg: pxPerDeg * Math.cos(degToRad(pointing.alt)),
    fieldRadiusPx,
    reachDeg: (fieldRadiusPx + Math.hypot(offsetX, offsetY)) / pxPerDeg,
  };
}

/** Whether a mark at (x, y) with `marginPx` of rendered extent reaches the field stop. */
function reachesField(g: ViewGeometry, x: number, y: number, marginPx: number): boolean {
  const dx = x - g.centerX;
  const dy = y - g.centerY;
  const r = g.fieldRadiusPx + marginPx;
  return dx * dx + dy * dy <= r * r;
}

/** Largest glow any catalog star can have (starRadiusPx caps at 5.5px; brightest glow = 3.6×). */
const MAX_STAR_GLOW_PX = 5.5 * 3.6;

// ── Constellation Lines (Phase 30) ─────────────────────────────────
// Faint asterism lines, drawn BEFORE the star points so the dots layer
// cleanly on top of their own connecting lines. Shares the exact same
// Alt/Az→pixel projection as the star field so a line's endpoints always
// land precisely on their stars — no line-clipping needed either: the
// circular field-stop mask applied at the end of renderOpticalView crops
// everything (stars, target, lines) to the eyepiece aperture regardless.
// A line is drawn when both of its stars are in the field or just beyond
// it — a margin of 0.35 of the field, the same slack as ever, now measured
// in the rendered geometry rather than in raw azimuth degrees.
function drawConstellationLines(
  ctx: CanvasRenderingContext2D,
  spec: OpticalViewSpec,
  g: ViewGeometry,
  darkness: number,
  lstHours: number
): void {
  const { viewportPx, pointing, observer } = spec;
  const marginPx = viewportPx * 0.35;

  const project = (star: CatalogStar): { x: number; y: number } | null => {
    const pos = convertEquatorialToHorizontalLST(star.ra, star.dec, observer.latitude, lstHours);
    if (pos.altitude < -1) return null;
    const x = g.originX + wrap180(pos.azimuth - pointing.az) * g.azPxPerDeg;
    const y = g.originY - (pos.altitude - pointing.alt) * g.pxPerDeg;
    return reachesField(g, x, y, marginPx) ? { x, y } : null;
  };

  ctx.strokeStyle = `rgba(148, 197, 255, ${0.28 * darkness})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [nameA, nameB] of CONSTELLATION_LINES) {
    const starA = STAR_BY_NAME.get(nameA);
    const starB = STAR_BY_NAME.get(nameB);
    if (!starA || !starB) continue;
    const a = project(starA);
    if (!a) continue;
    const b = project(starB);
    if (!b) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

// ── Faint telescopic field stars (Phase 33; bounded pole-safe search Phase 66) ──
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
//
// Phase 66: an RA/Dec cell shrinks toward the celestial poles (its area goes
// as cos(dec)) while it still held a fixed star count, so star density grew
// as 1/cos(dec) — 1.4× at dec 45°, over 100× next to Polaris — and the RA
// search was clamped to a thin sliver there, which drew that overdensity as
// a dense wedge. Each cell now keeps the FIRST n of its stars (so every star
// that survives sits exactly where it always did) with n proportional to the
// cell's true area, and the candidate cells come from a spherical cap around
// the pointing that includes the whole RA circle when the cap covers a pole.
// Cost stays bounded everywhere: a polar band visits all its cells but most
// cells then hold no star at all.
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

/** The candidate search never reaches further than this from the pointing (bounds work under absurd offsets). */
const MAX_FIELD_STAR_CAP_DEG = 30;

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
  g: ViewGeometry,
  darkness: number,
  lstHours: number
): void {
  const { trueFovDeg, pointing, observer, simTime, role, aperture } = spec;
  // Faint stars die first as the sky brightens: fully gone by late civil
  // twilight, full strength once past nautical dusk.
  const twilightGate = Math.max(0, Math.min(1, (darkness - 0.15) / 0.35));
  if (twilightGate <= 0.02) return;

  // Standard limiting-magnitude estimate Lm ≈ 7.5 + 5·log10(D/10mm):
  // the 30mm finder reaches ~9.9, a 200mm Dob ~14 — which stars survive
  // at all depends on the glass, exactly as at a real eyepiece.
  const apertureMm = role === 'finder' ? FINDER_APERTURE_MM : Math.max(10, aperture);
  // Phase 59: haze and a light-adapted eye do not dim the faint stars, they
  // DELETE them — which is what a limiting-magnitude penalty does, and what
  // an observer actually experiences when the sky goes milky.
  const limitingMag = 7.5 + 5 * Math.log10(apertureMm / 10)
    - faintStarMagPenalty(spec.transparency ?? DEFAULT_TRANSPARENCY, spec.darkAdaptation ?? 1);

  // Which RA/Dec cells can reach this field: a cap around the RA/Dec passing
  // through the pointing, wide enough for every point the flat mapping puts
  // inside the (possibly offset) field stop.
  const centerEq = convertHorizontalToRaDec(
    pointing.alt, pointing.az,
    observer.latitude, observer.longitude,
    new Date(simTime)
  );
  const centerRaDeg = centerEq.ra * 15;
  const centerDecDeg = centerEq.dec;
  const capDeg = Math.min(MAX_FIELD_STAR_CAP_DEG, projectedFieldCapRadiusDeg(g.reachDeg + 0.05));
  const capContainsPole = centerDecDeg + capDeg >= 90 || centerDecDeg - capDeg <= -90;
  const raHalfDeg = capContainsPole
    ? 180
    : (Math.asin(Math.min(1, Math.sin(degToRad(capDeg)) / Math.cos(degToRad(centerDecDeg)))) * 180) / Math.PI;
  const decMin = Math.max(-90, centerDecDeg - capDeg);
  const decMax = Math.min(90, centerDecDeg + capDeg);

  ctx.fillStyle = '#dde5f2';
  for (let tierIdx = 0; tierIdx < FIELD_STAR_TIERS.length; tierIdx++) {
    const tier = FIELD_STAR_TIERS[tierIdx];
    if (trueFovDeg > tier.maxFovDeg) continue;
    const cell = tier.cellSizeDeg;
    const raCellsTotal = Math.ceil(360 / cell);
    const raCellFirst = raHalfDeg >= 180 ? 0 : Math.floor((centerRaDeg - raHalfDeg) / cell);
    const raCellCount = raHalfDeg >= 180
      ? raCellsTotal
      : Math.min(raCellsTotal, Math.floor((centerRaDeg + raHalfDeg) / cell) - raCellFirst + 1);
    // Normaliser for band area: an equatorial band of this height has weight 1.
    const equatorialBand = 2 * Math.sin(degToRad(cell / 2));

    for (let di = Math.floor(decMin / cell); di <= Math.floor(decMax / cell); di++) {
      const bandLo = Math.max(-90, di * cell);
      const bandHi = Math.min(90, (di + 1) * cell);
      if (bandHi <= bandLo) continue;
      const bandWeight = (Math.sin(degToRad(bandHi)) - Math.sin(degToRad(bandLo))) / equatorialBand;
      const expectedPerCell = tier.starsPerCell * bandWeight;

      for (let k = 0; k < raCellCount; k++) {
        const ri = ((raCellFirst + k) % raCellsTotal + raCellsTotal) % raCellsTotal;
        // Seed from the wrapped, sky-fixed cell identity (never the FOV or
        // frame), so a cell's stars are identical from every view forever.
        const seed = (ri * 73856093) ^ (di * 19349663) ^ (tierIdx * 83492791);
        // Area-proportional count from an independent stream, so the
        // position stream below is untouched: the first n stars of the cell
        // are exactly the stars it has always had.
        const count = Math.min(tier.starsPerCell, Math.floor(expectedPerCell + cellRandom(seed ^ 0x5bd1e995)()));
        if (count <= 0) continue;
        const rand = cellRandom(seed);

        for (let s = 0; s < count; s++) {
          const raDeg = (ri + rand()) * cell;
          const decDeg = bandLo + rand() * (bandHi - bandLo);
          // Quadratic skew toward the faint end — real star counts climb
          // steeply with magnitude.
          const frac = rand();
          const mag = tier.magMax - (tier.magMax - tier.magMin) * frac * frac;
          if (mag > limitingMag) continue;

          const pos = convertEquatorialToHorizontalLST(raDeg / 15, decDeg, observer.latitude, lstHours);
          if (pos.altitude < -1) continue;
          const x = g.originX + wrap180(pos.azimuth - pointing.az) * g.azPxPerDeg;
          const y = g.originY - (pos.altitude - pointing.alt) * g.pxPerDeg;
          // Floor at 1px — sub-pixel arcs antialias into near-invisibility,
          // and a field star's whole job here is to be a SEEN pinpoint.
          const radius = Math.max(1, 1.9 - 0.1 * mag);
          if (!reachesField(g, x, y, radius + 1)) continue;

          const headroom = limitingMag - mag;
          ctx.globalAlpha = Math.min(0.9, 0.3 + headroom * 0.11) * twilightGate;
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
// drift. The starfield and EVERY catalog body (drawUniversalSkyBodies) are
// drawn at the one frame instant (spec.simTime) — the celestial sphere is
// one rigid object, and a slowed (assisted) sky slows as a whole. Raw mount
// pointing is untouched by any of this, so manual slews still pan honestly
// at 1:1 in both feeds.
function drawStarField(
  ctx: CanvasRenderingContext2D,
  spec: OpticalViewSpec,
  g: ViewGeometry,
  darkness: number,
  lstHours: number
): void {
  if (darkness <= 0) return; // full daylight — no stars pierce it

  drawConstellationLines(ctx, spec, g, darkness, lstHours);
  // Anonymous telescopic field stars underneath the named catalog (Phase 33).
  drawFaintFieldStars(ctx, spec, g, darkness, lstHours);

  const { pointing, observer, role, aperture } = spec;
  // Star test (Phase 57) — main feed only. The finder is a separate, fixed
  // optic the main focuser doesn't touch, so its stars stay focused points
  // no matter how far the drawtube is racked.
  const starTest = role === 'finder' ? null : spec.starTest ?? null;
  // Rendered extent a star can have: its glow, or in 'collimate' mode the
  // defocused donut plus the coma fan (up to 4× the donut radius).
  const starMarginPx = starTest
    ? Math.max(MAX_STAR_GLOW_PX, starTest.diskRadiusDeg * g.pxPerDeg * 4.2, 5.5 * 2.2 * 4.2)
    : MAX_STAR_GLOW_PX;
  // Small apertures gather less light — stars dim slightly in the main
  // eyepiece of a 60mm scope. The 6×30 finder keeps its bright wide view.
  const apertureFactor = role === 'finder'
    ? 1
    : Math.max(0.35, Math.min(1, getApertureBrightnessMultiplier(aperture)));
  // Phase 59: atmospheric extinction on the named catalog. Point sources are
  // hurt by haze but not much by the eye's own adaptation (a 1st-magnitude
  // star is far above threshold either way), so this carries the transparency
  // term only — the adaptation term belongs to the faint end above and to the
  // extended deep-sky objects below.
  const extinctionFactor = transparencyThroughput(spec.transparency ?? DEFAULT_TRANSPARENCY);

  for (const star of STAR_CATALOG) {
    const pos = convertEquatorialToHorizontalLST(star.ra, star.dec, observer.latitude, lstHours);
    if (pos.altitude < -1) continue; // below the horizon
    const x = g.originX + wrap180(pos.azimuth - pointing.az) * g.azPxPerDeg;
    const y = g.originY - (pos.altitude - pointing.alt) * g.pxPerDeg;
    if (!reachesField(g, x, y, starMarginPx)) continue;

    const alpha = starAlpha(star.mag, darkness) * apertureFactor * extinctionFactor;
    if (alpha <= 0.02) continue;

    const radius = starRadiusPx(star.mag);

    // ── Star test intercept (Phase 57) ──────────────────────────────
    // A bright star, deliberately defocused, stops being a point and becomes
    // the donut that reveals the mirror alignment (see engine/starTest). Only
    // the genuinely bright end qualifies: spread a 4th-magnitude star over a
    // hundred times its focused area and there is simply nothing left to see,
    // which is exactly why observers star-test on Polaris and Vega.
    if (starTest && star.mag < STAR_TEST_MAG_LIMIT) {
      const diskRadiusPx = starTest.diskRadiusDeg * g.pxPerDeg;
      if (diskRadiusPx >= MIN_STAR_TEST_RADIUS_PX) {
        const sprite = bakeStarTestSprite({
          radiusPx: diskRadiusPx,
          obstructionFrac: starTest.obstructionFrac,
          shadowOffsetFrac: starTest.shadowOffsetFrac,
          shadowAngleRad: starTest.shadowAngleRad,
          ringCount: starTest.ringCount,
        });
        if (sprite) {
          const donutAlpha = alpha * starTestSpreadDimming(diskRadiusPx);
          ctx.globalAlpha = donutAlpha;
          blitStarTestSprite(ctx, sprite, x, y, diskRadiusPx);
          // Coma rides ON the donut rather than replacing it: both are the
          // same miscollimation seen two ways, and a real eyepiece shows the
          // asymmetric flare and the off-centre hole together.
          drawComaFlare(ctx, x, y, diskRadiusPx, starTest.comaSeverity, starTest.comaAngleRad, donutAlpha);
          ctx.globalAlpha = 1;
          continue;
        }
      }
      // Too small to resolve as an annulus (at or very near focus) — fall
      // through to the ordinary point star, but keep the coma, which is
      // precisely the in-focus symptom the instructor calls "little comets."
      ctx.globalAlpha = alpha;
      drawComaFlare(ctx, x, y, radius * 2.2, starTest.comaSeverity, starTest.comaAngleRad, alpha);
      ctx.globalAlpha = 1;
    }

    // ── Diffuse radial-gradient star (Phase 42) ── Replaces the old hard
    // arc + separate halo pair. A single radial gradient models what a real
    // point source looks like through atmosphere and glass: a bright, nearly
    // white core that bleeds out through its spectral tint into a soft,
    // fully-transparent glow — no hard-edged disk. The glow reaches farther
    // for the showpiece first-magnitude stars (Sirius, Vega) so they visibly
    // bloom, riding on top of the exponential core radius from starRadiusPx.
    const { r, g: gr, b } = STAR_TINT_RGB[star.spec];
    const glowRadius = radius * (star.mag < 0.8 ? 3.6 : 2.8);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    grad.addColorStop(0, 'rgba(255,255,255,1)');            // white-hot pinpoint core
    grad.addColorStop(0.26, `rgba(${r},${gr},${b},0.95)`);  // tinted core
    grad.addColorStop(0.55, `rgba(${r},${gr},${b},0.25)`);  // mid atmospheric glow
    grad.addColorStop(1, `rgba(${r},${gr},${b},0)`);        // fades fully to sky
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

/** Depth-sorted copy of a body list, computed once per list rather than every frame. */
const sortedBodiesCache = new WeakMap<Target[], Target[]>();
function depthSorted(bodies: Target[]): Target[] {
  let sorted = sortedBodiesCache.get(bodies);
  if (!sorted) {
    sorted = [...bodies].sort(
      (a, b) => (BODY_DEPTH_RANK[a.id] ?? DEFAULT_DEPTH_RANK) - (BODY_DEPTH_RANK[b.id] ?? DEFAULT_DEPTH_RANK)
    );
    sortedBodiesCache.set(bodies, sorted);
  }
  return sorted;
}

// ── Starfield occlusion (Phase 39; both feeds + true silhouettes Phase 66) ──
// Opaque bodies must BLOCK the stars behind them: aperture dimming (a small
// scope draws the body at reduced alpha), daylight washout, and the Moon's
// night side (erased transparent by drawMoon's phase shading) would all
// otherwise let the already-painted starfield show through the disk — the
// "ghost moon". Deliberately excludes m42 (an emission nebula IS translucent),
// the Sun (never co-visible with a starfield) and the spire (seen against a
// daytime sky). Phase 66: applied to the finder too (it has its own night-side
// and twilight washout), punched with each glyph's REAL silhouette — Saturn's
// ball and rings, Jupiter's oblate disk — instead of one circle, and painted
// without the sky layer's blur so the erased area is exactly the body.
const STARFIELD_OCCLUDING_BODIES = new Set(['moon', 'saturn', 'jupiter']);

/**
 * Erases the stars under a body's silhouette and backfills those pixels with
 * the sky background, so the dimmed body then composites over clean sky.
 * Two extra draws per visible occluding body; no scratch surfaces.
 */
function punchStarfieldUnder(
  ctx: CanvasRenderingContext2D,
  body: Target,
  x: number,
  y: number,
  size: number,
  assets: LoadedAssets | null,
  skyColor: string,
  viewportPx: number
): void {
  ctx.save();
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  if (body.id === 'saturn') {
    drawSaturn(ctx, x, y, size, assets);
  } else if (body.id === 'jupiter') {
    drawJupiter(ctx, x, y, size, assets, []);
  } else {
    // The Moon's full disk — its unlit side occludes exactly as its lit side does.
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  // Every other pixel is still opaque at this point, so filling BEHIND the
  // canvas refills precisely the hole just made.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = skyColor;
  ctx.fillRect(0, 0, viewportPx, viewportPx);
  ctx.restore();
}

/**
 * Rendered extent (px) of a body's glyph from its centre, for culling —
 * the halo, rings, glow or moon line, whichever reaches furthest, at the
 * glyph's actual size (which carries the min-size clamps and digital zoom).
 */
function bodyExtentPx(body: Target, glyphSizePx: number, angularDiameterDeg: number, pxPerDeg: number, zoom: number): number {
  switch (body.id) {
    case 'moon': return glyphSizePx * 2.2;       // atmospheric halo reaches 2.15 r
    case 'saturn': return glyphSizePx * 2.6;     // ring ansae (the sprite is 5 r wide)
    case 'sun': return glyphSizePx * 1.25;       // glow reaches 1.2 r
    case 'm42': return glyphSizePx * 1.25 + 8;   // composite is 2.4 r wide, plus blur padding
    case 'jupiter':
      // Callisto swings out to ±26.33 Jupiter radii; each moon has a halo.
      return Math.max(glyphSizePx * 1.1, 26.4 * (angularDiameterDeg / 2) * pxPerDeg * zoom + 8);
    default: return glyphSizePx * 2;
  }
}

/**
 * Evaluate + draw ALL catalog bodies against the mount's raw pointing.
 * Runs inside renderOpticalView's sky transform (finder axis error, droop,
 * jitter, optical inversion all arrive via the view geometry's origin and
 * the ambient canvas transform), between the starfield below and the HUD
 * above.
 *
 * 60fps guard: each body is culled by pure math — daylight washout, then
 * below-horizon, then field-of-view bounds — before ANY sprite/texture or
 * per-body trig (parallactic angle, Jovian ephemeris) is touched. A culled
 * body costs one Alt/Az conversion, the same as a single catalog star.
 */
function drawUniversalSkyBodies(
  ctx: CanvasRenderingContext2D,
  spec: OpticalViewSpec,
  g: ViewGeometry,
  darkness: number,
  blurAmount: number,
  lstHours: number,
  onlyBodyId?: string
): void {
  const {
    role, viewportPx, trueFovDeg, pointing, digitalZoom, evalResult, aperture,
    target, skyBodies, assets, observer, simTime, now, isAltAzMount, sunAltDeg,
    bahtinovGeometry,
  } = spec;
  if (trueFovDeg <= 0 || skyBodies.length === 0) return;
  const isFinder = role === 'finder';
  const zoom = digitalZoom ?? 1;
  // Aperture brightness (main feed only) is body-independent — hoist it.
  const apertureAlpha = isFinder
    ? 1
    : Math.max(0.25, Math.min(1.0, getApertureBrightnessMultiplier(aperture)));
  // Sky background color for the occlusion backfill — the SAME value
  // renderOpticalView fills the backdrop with.
  const occlusionColor = skyColorForSunAlt(sunAltDeg);
  // ── Transparency × dark adaptation (Phase 59) ── The one throughput number
  // that decides how much of a nebula's drizzle survives the sky and the eye
  // between it and the observer. Body-independent, so hoist it out of the loop.
  const faintBodyVisibility = deepSkyVisibility(
    spec.transparency ?? DEFAULT_TRANSPARENCY,
    spec.darkAdaptation ?? 1
  );

  for (const body of depthSorted(skyBodies)) {
    if (onlyBodyId && body.id !== onlyBodyId) continue;
    const isLockedTarget = target?.id === body.id;

    // ── Cull 1: daylight washout ── Bodies dimmer than the day sky simply
    // aren't there to draw (Virtual Night restores them via darkness = 1).
    // Phase 59 folds transparency and dark adaptation into the SAME visibility
    // budget, for the faint bodies only: haze and a light-blasted eye take the
    // nebula long before they touch the Moon.
    const daylightVis = daylightTargetVisibility(body.type, darkness)
      * (FAINT_BODY_TYPES.has(body.type) ? faintBodyVisibility : 1);
    if (daylightVis <= 0.01) continue;

    // ── Cull 2: one Alt/Az conversion → below-horizon + field bounds ──
    // The body's RA/Dec is resolved once (the Sun and Moon from a per-instant
    // memo shared with the other feed and the hazard check) and reused below.
    const bodyEq = getBodyEquatorial(body, simTime, observer);
    let bodyAlt: number;
    let bodyAz: number;
    if (body.type === 'terrestrial') {
      bodyAlt = TERRESTRIAL_POINTING.alt;
      bodyAz = TERRESTRIAL_POINTING.az;
    } else {
      if (!bodyEq) continue;
      const pos = convertEquatorialToHorizontalLST(bodyEq.ra, bodyEq.dec, observer.latitude, lstHours);
      bodyAlt = pos.altitude;
      bodyAz = pos.azimuth;
    }
    const angularDiameterDeg = body.angularDiameterDeg ?? body.angularSize / 60;
    // Same −1° horizon grace the starfield uses (widened by the body's own
    // radius); terrestrial bodies are ground-anchored and exempt.
    if (body.type !== 'terrestrial' && bodyAlt < -1 - angularDiameterDeg) continue;

    // ── ABSOLUTE ANGULAR SCALING (Phase 24) + Digital Zoom (Phase 26) ──
    const baseSize = getTargetRenderScale(body.id, angularDiameterDeg, trueFovDeg, viewportPx) * zoom;
    const targetSize = evalResult.isDefocused && !isFinder
      ? baseSize + evalResult.defocusAmount * 0.5
      : baseSize;
    const targetX = g.originX + wrap180(bodyAz - pointing.az) * g.azPxPerDeg;
    const targetY = g.originY - (bodyAlt - pointing.alt) * g.pxPerDeg;

    if (body.type === 'terrestrial') {
      // The spire's ground plane runs 1.5 r to each side and far below it
      // (see drawSpire's floating-tower fix); its tower rises 1.33 r above.
      const inX = Math.abs(targetX - g.centerX) <= g.fieldRadiusPx + targetSize * 1.5 + 2;
      const inY = targetY - targetSize * 1.4 <= g.centerY + g.fieldRadiusPx
        && targetY + targetSize * 1.7 + 3000 >= g.centerY - g.fieldRadiusPx;
      if (!inX || !inY) continue;
    } else if (!reachesField(g, targetX, targetY, bodyExtentPx(body, targetSize, angularDiameterDeg, g.pxPerDeg, zoom))) {
      continue;
    }

    // ── FIELD ROTATION (Phase 30) ── An Alt-Az mount has no equatorial
    // derotator: a celestial object's apparent "up" spins by the
    // parallactic angle as it crosses the sky. Depends only on the BODY's
    // own position (not on pointing/tracking error or role), so both feeds
    // — rigidly bolted to the same tube — see an identical spin.
    // Terrestrial bodies have no equatorial anchor and are naturally
    // excluded (getBodyEquatorial → null).
    const parallacticAngleRad = isAltAzMount && bodyEq
      ? (getParallacticAngleDeg(bodyEq.ra, bodyEq.dec, observer.latitude, observer.longitude, new Date(simTime)) * Math.PI) / 180
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

    // ── STARFIELD OCCLUSION ── Inside the field-spin transform, so a
    // non-circular silhouette turns with its glyph. Only when stars are
    // being drawn at all (darkness > 0).
    if (darkness > 0 && STARFIELD_OCCLUDING_BODIES.has(body.id)) {
      punchStarfieldUnder(ctx, body, targetX, targetY, targetSize, assets, occlusionColor, viewportPx);
    }

    // ── APERTURE BRIGHTNESS (main feed only) × DAYLIGHT WASHOUT (both) ──
    ctx.globalAlpha = apertureAlpha * daylightVis;

    // ── The Jovian system (Phase 32) ── Moon offsets from the simplified
    // Galilean ephemeris at the frame instant, projected at TRUE angular
    // scale through this feed's pxPerDeg. Occulted moons (behind the disk)
    // are filtered here, where the physics lives. Painted inside the
    // parallactic transform above, so disk AND moon line field-rotate as one
    // rigid unit on Alt-Az mounts.
    let jovianMoons: JovianMoonSprite[] = [];
    if (body.id === 'jupiter') {
      const pxPerDeg = g.pxPerDeg * zoom;
      const jupiterRadiusDeg = angularDiameterDeg / 2;
      jovianMoons = getGalileanMoonPositions(getJulianDate(new Date(simTime)))
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
      // ── Lunar phase + parallactic surface rotation + halo (Phase 42.5) ──
      // Illuminated fraction comes from the Sun–Moon angular separation
      // (frame-independent — see getLunarIlluminatedFraction). The
      // terminator's DIRECTION is computed directly from both bodies' real
      // Alt/Az, in the exact same (Δaz, −Δalt)→screen convention every other
      // body in this file uses — no separate equatorial position-angle
      // formula to keep in sync with it. Adding parallacticAngleRad on top
      // (the SAME rotation the texture itself gets, in drawMoon) keeps the
      // shadow rigidly attached to the disk as it field-rotates: the
      // terminator is a property of the Moon's own rotated surface, not an
      // independent overlay, so it must track the texture's spin exactly
      // rather than counter-rotate against it.
      let illuminatedFraction = 1;
      let brightLimbRad = parallacticAngleRad;
      if (bodyEq) {
        illuminatedFraction = getLunarIlluminatedFraction(bodyEq.ra, bodyEq.dec, new Date(simTime));
        const sunEq = getSunEquatorialAt(simTime);
        const sunAltAz = convertEquatorialToHorizontalLST(sunEq.ra, sunEq.dec, observer.latitude, lstHours);
        const dAlt = sunAltAz.altitude - bodyAlt;
        const dAz = wrap180(sunAltAz.azimuth - bodyAz);
        brightLimbRad = Math.atan2(-dAlt, dAz) + parallacticAngleRad;
      }
      drawMoon(ctx, targetX, targetY, targetSize, assets, {
        parallacticRad: parallacticAngleRad,
        illuminatedFraction,
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
      // No per-glyph invert flag: renderOpticalView's canvas-level parity
      // transform (rotate or mirror) already covers the whole field, this
      // body included.
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

    // Bahtinov mask diffraction pattern (Phase 56) — screen space, over the
    // locked target only, same anchor as the bokeh hole above.
    if (isLockedTarget && !isFinder && bahtinovGeometry) {
      ctx.save();
      ctx.translate(targetX, targetY);
      drawBahtinovAsterism(ctx, bahtinovGeometry, {
        mmToPx: MAIN_MM_TO_PX,
        armLengthPx: MAIN_ARM_LENGTH_PX,
      });
      ctx.restore();
    }
  }
}

export function renderOpticalView(ctx: CanvasRenderingContext2D, spec: OpticalViewSpec): void {
  const {
    role, viewportPx, trueFovDeg, axisErrorDeg, legacyAlignmentOffsetPx,
    isCrosshairAligned, viewOrientation, evalResult,
    isHighPerformanceMode, now, sunAltDeg, collimationOffsetDeg, observer, simTime,
  } = spec;
  const isFinder = role === 'finder';
  const width = viewportPx;
  const height = viewportPx;
  const centerX = width / 2;
  const centerY = height / 2;
  const solarHazard = spec.solarHazard ?? evalResult.hasSolarHazard;
  // Through a solar filter only the Sun gets through (Phase 66): a black
  // field with the Sun in it when it is in view — never the daylit sky,
  // the stars, or whatever the target menu happens to name.
  const isSolarFiltered = !!evalResult.isSolarFiltered;

  // ── Dynamic daylight (Phase 29) ── The backdrop tracks the Sun's altitude
  // through the full day → twilight → night ramp instead of being pinned to
  // space-black; the star catalog fades in through twilight to match.
  const skyDarkness = skyDarknessForSunAlt(sunAltDeg);
  ctx.fillStyle = isSolarFiltered ? '#000000' : skyColorForSunAlt(sunAltDeg);
  ctx.fillRect(0, 0, width, height);

  if (evalResult.isBlackedOut) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
  } else if (solarHazard && !isFinder) {
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
  } else if (solarHazard && isFinder) {
    // Finder solar flash
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255, 100, 0, 0.5)';
    ctx.fillRect(0, 0, width, height);
  } else if (trueFovDeg > 0) {
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

    // ── Collimation offset (main feed only, Phase 61) ── Same divergence
    // math as the finder's axisErrorDeg above, mirrored to the feed the
    // mirrors actually steer.
    const collimationPxX = !isFinder && collimationOffsetDeg ? (collimationOffsetDeg.deltaAz / trueFovDeg) * width : 0;
    const collimationPxY = !isFinder && collimationOffsetDeg ? (collimationOffsetDeg.deltaAlt / trueFovDeg) * height : 0;

    const legacyX = legacyAlignmentOffsetPx?.x ?? 0;
    const legacyY = legacyAlignmentOffsetPx?.y ?? 0;
    const currentOffsetX = isFinder ? -legacyX - errorPxX : -collimationPxX;
    const currentOffsetY = isFinder ? -legacyY + errorPxY : collimationPxY;

    const droopY = evalResult.isAltDrooping ? ((now % 10000) / 10000) * height : 0;

    // ── Optical parity (main feed only) — rotates or mirrors the whole
    // field (stars AND target), not just the glyph, around the canvas
    // center; HUD chrome stays untouched since this transform is undone by
    // ctx.restore() before the crosshair. 'inverted' (two mirror
    // reflections, e.g. a straight Newtonian/Dobsonian) rotates the field
    // 180°; 'mirrored' (one reflection, e.g. a refractor/SCT through a star
    // diagonal) flips it left-right only — physically distinct transforms.
    // Neither changes a point's distance from the centre, so the culling
    // geometry below is unaffected.
    if (!isFinder && viewOrientation === 'inverted') {
      ctx.translate(centerX, centerY);
      ctx.rotate(Math.PI);
      ctx.translate(-centerX, -centerY);
    } else if (!isFinder && viewOrientation === 'mirrored') {
      ctx.translate(centerX, centerY);
      ctx.scale(-1, 1);
      ctx.translate(-centerX, -centerY);
    }

    // One view geometry and one sidereal time for every layer of this feed:
    // stars AND bodies share the offsets and the inversion transform, so the
    // whole sky moves as one rigid unit during any slew.
    const view = makeViewGeometry(spec, currentOffsetX + jitterX, currentOffsetY + droopY + jitterY);
    const lstHours = getLocalSiderealTime(getJulianDate(new Date(simTime)), observer.longitude);

    // ── Real starfield (Phase 29) — nothing but the Sun passes a solar filter.
    if (!isSolarFiltered) drawStarField(ctx, spec, view, skyDarkness, lstHours);

    // ── THE UNIVERSAL PHYSICAL SKY (Phase 35) ── Every catalog body is
    // evaluated against the mount's raw pointing and drawn if it physically
    // falls in this feed's field — the UI target lock no longer gates
    // rendering.
    drawUniversalSkyBodies(ctx, spec, view, skyDarkness, blurAmount, lstHours, isSolarFiltered ? 'sun' : undefined);

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
