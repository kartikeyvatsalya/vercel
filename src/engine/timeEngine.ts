/**
 * Time Engine (Phase 29) — the smooth simulation clock authority.
 * ─────────────────────────────────────────────────────────────────
 * Phase 25's clock advanced `simTime` in discrete 1-second setInterval ticks,
 * which made unmotored sky drift move in visible jumps at high magnification.
 * This module replaces the tick as the source of truth with a continuous
 * anchor: simTime(t) = anchorSimMs + (t − anchorRealMs) × rate.
 *
 * Split of responsibilities:
 *   • Render loops (LiveViewPanel's rAF, ObservatoryScene's useFrame) call
 *     `getSmoothSimTime()` every frame for buttery, millisecond-interpolated
 *     ephemeris positions.
 *   • The Zustand store keeps its own `simTime` field as a LOW-FREQUENCY
 *     mirror (synced ~1×/sec by App.tsx) so React UI like the telemetry
 *     clock re-renders once a second, not 60× — the Phase 28 idle-throttle
 *     philosophy applied to time itself.
 *   • Every discontinuous change (±1 Hour steps, playback-rate changes)
 *     re-anchors the engine so the smooth clock never rewinds or leaps
 *     relative to what the store believes.
 *
 * performance.now() keeps counting in hidden/background tabs, so — like the
 * old setInterval driver, but exactly instead of approximately — simulation
 * time keeps flowing while the tab is hidden and is already correct on the
 * first frame after the user returns.
 */

let anchorSimMs = Date.now();
let anchorRealMs = performance.now();
let rate = 1;

/** Continuous simulated epoch-ms. Pass a shared `performance.now()` when calling per-frame. */
export function getSmoothSimTime(nowRealMs: number = performance.now()): number {
  return anchorSimMs + (nowRealMs - anchorRealMs) * rate;
}

/**
 * Re-anchor the clock at an exact simulated moment (and optionally a new
 * playback rate). Call on every discontinuity: boot, ±hour steps, rate cycling.
 */
export function reanchorTimeEngine(simMs: number, newRate?: number): void {
  anchorSimMs = simMs;
  anchorRealMs = performance.now();
  // Floor of 0 (not 1): Phase 41's Pause button needs a genuine rate=0 to
  // freeze the clock. getSmoothSimTime()'s (now − anchor) × rate formula
  // multiplies by rate rather than dividing, so 0 is safe — it just zeroes
  // the elapsed-time term instead of causing a divide-by-zero.
  if (newRate !== undefined) rate = Math.max(0, newRate);
}

export function getTimeEngineRate(): number {
  return rate;
}

/** Sidereal drift rate — how fast the sky itself moves (15.041°/hour). */
export const SIDEREAL_DEG_PER_SEC = 15.041 / 3600;
