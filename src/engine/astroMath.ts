/**
 * ── Astrophotography SNR/Sharpness Physics (Phase 27, P27.4) ──
 * Extracted from AstroPhotoTrainer's local helpers so the unified
 * LiveViewPanel's 'astrophotography' mode can share the same math,
 * mirroring how skyGeometry.ts/targetGlyphs.ts were promoted out of the
 * other legacy modules earlier in Phase 27.
 */

/** Simulated signal-to-noise ratio of a stacked DSO integration. */
export function calculateDsoSNR(subExposures: number, subTimeSec: number, iso: number): number {
  const signal = 0.8; // normalized photon flux from nebula
  const thermalNoise = 0.02 * (iso / 800); // scales with gain
  const readNoise = 3.5 / Math.sqrt(iso / 100); // read noise decreases with modern CMOS at higher gain
  const totalSignal = signal * subTimeSec * subExposures;
  const totalNoise = Math.sqrt(
    (signal * subTimeSec + thermalNoise * subTimeSec + readNoise * readNoise) * subExposures
  );
  if (totalNoise <= 0) return 0;
  return totalSignal / totalNoise;
}

/** Simulated Lucky Imaging sharpness (0-1) from stack cutoff % and seeing quality. */
export function calculatePlanetarySharpness(frameCutoffPct: number, seeingQuality: number): number {
  const seeingPenalty = (seeingQuality - 1) / 4;
  const cutoffBonus = 1 - (frameCutoffPct / 100);
  return Math.max(0, Math.min(1, cutoffBonus * (1 - seeingPenalty * 0.6) + 0.1));
}
