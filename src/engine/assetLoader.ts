/**
 * assetLoader.ts — Phase 13, rebuilt in Phase 29 (Asset Warm-Up), bounded in
 * Phase 66.
 *
 * Preloads the photographic target textures from Wikimedia Commons and WARMS
 * them before any canvas draws them:
 *
 *   1. `Image.decode()` — decoding happens asynchronously, off the render path,
 *      instead of synchronously inside the first rAF frame that calls drawImage.
 *   2. Resample-once — each texture is resampled ONCE into a ≤1024px
 *      offscreen canvas and only that small canvas is drawn per frame.
 *
 * Phase 66 — bounded sources. The Orion texture used to be the original
 * 18,000 × 18,000 px Hubble mosaic: a 38.7 MB download that decodes to about
 * 1.3 GB of pixels (plus a 9,000² intermediate during the first halving
 * pass) before being thrown away for a 1024px copy — a cold-start memory
 * spike big enough to take down a tab on a 4 GB tablet or Chromebook. Every
 * texture now loads Commons' standard 1280px rendition of the SAME file (same
 * image, same licence, same credit — see TEXTURE_CREDITS), about 0.76 MB for
 * all four instead of 43 MB. The app never waits on these: App.tsx opens
 * after a short grace period whatever state they are in, and a failed or
 * stalled image simply keeps the procedural glyph.
 *
 * Returns a dictionary of ready-to-draw textures keyed by target ID.
 */

/** A warmed, draw-ready texture: either a small decoded image or a downsampled canvas. */
export type LoadedTexture = HTMLImageElement | HTMLCanvasElement;

export type LoadedAssets = Record<string, LoadedTexture>;

const COMMONS = 'https://upload.wikimedia.org/wikipedia/commons';

const ASSET_URLS: Record<string, string> = {
  // 1280 × 620, ~38 KB (original 4613 × 2233, 2.3 MB)
  saturn: `${COMMONS}/thumb/c/c7/Saturn_during_Equinox.jpg/1280px-Saturn_during_Equinox.jpg`,
  // 1280 × 1216, ~366 KB (original 2580 × 2452, 2.1 MB)
  moon: `${COMMONS}/thumb/e/e1/FullMoon2010.jpg/1280px-FullMoon2010.jpg`,
  // 1280 × 1280, ~216 KB (original 18000 × 18000, 38.7 MB)
  orion: `${COMMONS}/thumb/f/f3/Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg/1280px-Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg`,
  // 940 × 940, ~144 KB — the original is already small
  jupiter: `${COMMONS}/2/2b/Jupiter_and_its_shrunken_Great_Red_Spot.jpg`,
};

/** Credits for the photographic textures, shown in the About panel. */
export const TEXTURE_CREDITS: { subject: string; credit: string; license: string; licenseUrl?: string; sourceUrl: string }[] = [
  {
    subject: 'Moon',
    credit: 'Gregory H. Revera',
    license: 'CC BY-SA 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:FullMoon2010.jpg',
  },
  {
    subject: 'Saturn',
    credit: 'NASA / JPL / Space Science Institute',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Saturn_during_Equinox.jpg',
  },
  {
    subject: 'Jupiter',
    credit: 'NASA, ESA and A. Simon (Goddard Space Flight Center)',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Jupiter_and_its_shrunken_Great_Red_Spot.jpg',
  },
  {
    subject: 'Orion Nebula',
    credit: 'NASA, ESA, M. Robberto (STScI/ESA) and the Hubble Space Telescope Orion Treasury Project Team',
    license: 'Public domain',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg',
  },
];

/** Longest side of any texture kept in memory after the warm-up pass. */
const MAX_TEXTURE_PX = 1024;

/**
 * Some network conditions (a stalled connection with no RST, a silently
 * dropped request) never fire `onload` OR `onerror` at all — without a
 * timeout, one stuck image would leave its promise pending forever.
 */
const IMAGE_LOAD_TIMEOUT_MS = 15000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      // Detach, so releasing the source later (src = '') can't fire a
      // spurious "failed to load" warning through these handlers.
      img.onload = null;
      img.onerror = null;
      resolve(img);
    };

    img.crossOrigin = 'anonymous'; // Required for ctx.drawImage with CORS-enabled Wikimedia assets
    img.onload = settle;
    img.onerror = () => {
      // On CORS / network failure, resolve with a never-ready image so the
      // canvas modules gracefully fall back to procedural rendering.
      console.warn(`[assetLoader] Failed to load: ${src}. Falling back to procedural rendering.`);
      settle();
    };
    const timeoutId = setTimeout(() => {
      console.warn(`[assetLoader] Timed out loading: ${src}. Falling back to procedural rendering.`);
      img.src = ''; // stop the stalled request from lingering in the background
      settle();
    }, IMAGE_LOAD_TIMEOUT_MS);

    img.src = src;
  });
}

/**
 * Push decode work off the render path: `decode()` rasterizes the compressed
 * bytes on a background thread so the bitmap is GPU-ready before first draw.
 * Best-effort — a failure just means the old lazy-decode behavior.
 */
async function decodeImage(img: HTMLImageElement): Promise<void> {
  if (img.naturalWidth === 0 || typeof img.decode !== 'function') return;
  try {
    await img.decode();
  } catch {
    /* decode() can reject for already-broken images — non-fatal */
  }
}

/** Frees a canvas's backing store now instead of whenever the GC gets to it. */
function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Resample a texture down to ≤MAX_TEXTURE_PX on its longest side, halving
 * progressively (each 2:1 step is properly box-filtered by the browser, so a
 * large shrink stays crisp instead of aliasing in one giant jump). Each
 * intermediate is released as soon as the next step has consumed it.
 * Failed/small images pass through untouched.
 */
function downsampleToCanvas(img: HTMLImageElement): LoadedTexture {
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (srcW === 0 || Math.max(srcW, srcH) <= MAX_TEXTURE_PX) return img;

  const scale = MAX_TEXTURE_PX / Math.max(srcW, srcH);
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  let current: HTMLImageElement | HTMLCanvasElement = img;
  let curW = srcW;
  let curH = srcH;

  // Progressive halving until within 2× of the target…
  while (curW >= dstW * 2 && curH >= dstH * 2) {
    const half = document.createElement('canvas');
    half.width = Math.round(curW / 2);
    half.height = Math.round(curH / 2);
    const hctx = half.getContext('2d');
    if (!hctx) return img;
    hctx.imageSmoothingEnabled = true;
    hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(current, 0, 0, half.width, half.height);
    if (current instanceof HTMLCanvasElement) releaseCanvas(current);
    current = half;
    curW = half.width;
    curH = half.height;
  }

  // …then one final exact-size pass.
  const out = document.createElement('canvas');
  out.width = dstW;
  out.height = dstH;
  const octx = out.getContext('2d');
  if (!octx) return img;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(current, 0, 0, dstW, dstH);
  if (current instanceof HTMLCanvasElement) releaseCanvas(current);
  return out;
}

async function loadAll(): Promise<LoadedAssets> {
  const keys = Object.keys(ASSET_URLS);
  const textures = await Promise.all(
    keys.map(async (key) => {
      const img = await loadImage(ASSET_URLS[key]);
      await decodeImage(img);
      const warmed = downsampleToCanvas(img);
      if (warmed !== img) {
        // Let the source bitmap be reclaimed right away.
        img.src = '';
      }
      return warmed;
    })
  );

  const result: LoadedAssets = {};
  keys.forEach((key, i) => { result[key] = textures[i]; });
  return result;
}

let inflight: Promise<LoadedAssets> | null = null;

/**
 * Preload, decode, and warm all astronomical textures in parallel. Shared
 * per page load (Phase 66): React StrictMode runs the boot effect twice in
 * development, which used to fetch and decode everything twice.
 * Check readiness with `isTextureReady` (engine/targetGlyphs) before use.
 */
export function preloadAssets(): Promise<LoadedAssets> {
  if (!inflight) inflight = loadAll();
  return inflight;
}
