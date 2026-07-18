/**
 * assetLoader.ts — Phase 13, rebuilt in Phase 29 (Asset Warm-Up).
 *
 * Preloads high-resolution astronomical image textures from Wikimedia
 * Commons before any canvas module tries to draw them, then WARMS them:
 *
 *   1. `Image.decode()` — decoding happens asynchronously here, behind the
 *      boot loading screen, instead of synchronously inside the first
 *      rAF frame that calls drawImage (the old first-paint hitch).
 *   2. Downsample-once — the Orion source is an 18,000×18,000 px Hubble
 *      mosaic (~1.2 GB decoded). Every drawImage from it rescaled gigapixel
 *      data, which is what made switching to M42 stutter. Each texture is
 *      resampled ONCE into a ≤1024px offscreen canvas (progressive halving
 *      for quality), and only that small canvas is ever drawn per-frame.
 *      The gigantic source element is released immediately afterward.
 *
 * Returns a dictionary of ready-to-draw textures keyed by target ID.
 */

/** A warmed, draw-ready texture: either a small decoded image or a downsampled canvas. */
export type LoadedTexture = HTMLImageElement | HTMLCanvasElement;

export type LoadedAssets = Record<string, LoadedTexture>;

const ASSET_URLS: Record<string, string> = {
  saturn:  'https://upload.wikimedia.org/wikipedia/commons/c/c7/Saturn_during_Equinox.jpg',
  moon:    'https://upload.wikimedia.org/wikipedia/commons/e/e1/FullMoon2010.jpg',
  orion:   'https://upload.wikimedia.org/wikipedia/commons/f/f3/Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg',
  jupiter: 'https://upload.wikimedia.org/wikipedia/commons/2/2b/Jupiter_and_its_shrunken_Great_Red_Spot.jpg',
};

/** Longest side of any texture kept in memory after the warm-up pass. */
const MAX_TEXTURE_PX = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();

    img.crossOrigin = 'anonymous'; // Required for ctx.drawImage with CORS-enabled Wikimedia assets
    img.onload  = () => resolve(img);
    img.onerror = () => {
      // On CORS / network failure, resolve with a null-like sentinel so the
      // canvas modules can gracefully fall back to procedural rendering.
      console.warn(`[assetLoader] Failed to load: ${src}. Falling back to procedural rendering.`);
      resolve(img); // img.complete will be false — callers should check
    };
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
    /* decode() can reject for already-broken or gigantic images — non-fatal */
  }
}

/**
 * Resample a texture down to ≤MAX_TEXTURE_PX on its longest side, halving
 * progressively (each 2:1 step is properly box-filtered by the browser, so
 * an 18000→1024 shrink stays crisp instead of aliasing in one giant jump).
 * Failed/tiny images pass through untouched.
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
  return out;
}

/**
 * Preload, decode, and warm all astronomical textures in parallel.
 * Every returned texture is small (≤1024px) and already rasterized —
 * per-frame drawImage calls against them are cheap.
 * Check readiness with `isTextureReady` (engine/targetGlyphs) before use.
 */
export async function preloadAssets(): Promise<LoadedAssets> {
  const keys = Object.keys(ASSET_URLS);
  const textures = await Promise.all(
    keys.map(async (key) => {
      const img = await loadImage(ASSET_URLS[key]);
      await decodeImage(img);
      const warmed = downsampleToCanvas(img);
      if (warmed !== img) {
        // Let the gigantic source bitmap be reclaimed right away.
        img.src = '';
      }
      return warmed;
    })
  );

  const result: LoadedAssets = {};
  keys.forEach((key, i) => { result[key] = textures[i]; });
  return result;
}
