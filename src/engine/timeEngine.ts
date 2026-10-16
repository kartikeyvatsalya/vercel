/**
 * Time Engine (Phase 29; single sky clock since Phase 66) — the ONE clock
 * authority for everything astronomical.
 * ─────────────────────────────────────────────────────────────────
 * Continuous anchor model:
 *   simTime(t) = anchorSimMs + (t − anchorRealMs) × playbackRate × assistScale
 *
 * Definitions (Phase 66 — these used to be split across two clocks, which is
 * how the 2D sky, the daylight, the 3D dome and the hazard check drifted
 * apart in Easy mode):
 *   • Simulation time — the value this function returns. It is the ONLY
 *     astronomical instant in the app: both 2D feeds, the daylight ramp, the
 *     3D dome, the solar hazard check, GoTo slews, the sidereal motor and the
 *     telemetry clock all read it. There is no separate "gentled" sky clock.
 *   • Playback rate — the user's ×1 / ×10 / ×60 / pause choice (store.timeRate).
 *   • Drift assist — the simulation modes' driftMultiplier, applied while the
 *     motor is off (Easy 0.35, Fun 0). It slows TIME itself, so the whole sky
 *     (stars, Moon, planets, Sun, daylight) drifts gently as one rigid body
 *     and every consumer still agrees on the same instant. The telemetry
 *     panel labels the clock while an assist is slowing it.
 *   • Continuity — every change of rate or assist re-anchors at the current
 *     instant, so the sky never jumps. Only deliberate jumps (±1 Hour, Now,
 *     the date picker) move the clock discontinuously, and they move it by
 *     exactly what was asked for.
 *
 * Render loops (LiveViewPanel's rAF, ObservatoryScene's useFrame) sample
 * getSmoothSimTime() once per frame; the store keeps a ~1 Hz mirror in
 * `simTime` for React UI. performance.now() keeps counting in hidden tabs, so
 * the clock is already correct on the first frame after the user returns.
 */

let anchorSimMs = Date.now();
let anchorRealMs = performance.now();
let playbackRate = 1;
let assistScale = 1;

/** Continuous simulated epoch-ms. Pass a shared `performance.now()` when calling per-frame. */
export function getSmoothSimTime(nowRealMs: number = performance.now()): number {
  return anchorSimMs + (nowRealMs - anchorRealMs) * playbackRate * assistScale;
}

/**
 * Re-anchor the clock at an exact simulated moment (and optionally a new
 * playback rate). Used for deliberate jumps and playback-rate changes.
 */
export function reanchorTimeEngine(simMs: number, newRate?: number): void {
  anchorSimMs = simMs;
  anchorRealMs = performance.now();
  // Floor of 0 (not 1): the Pause button needs a genuine rate of 0. The
  // formula multiplies by the rate, so 0 simply freezes the clock.
  if (newRate !== undefined && Number.isFinite(newRate)) playbackRate = Math.max(0, newRate);
}

/**
 * Change the drift-assist factor WITHOUT moving the clock: re-anchors at the
 * current instant first, so switching modes or toggling the motor changes only
 * how fast the sky turns from here on, never where it already is.
 */
export function setTimeAssistScale(scale: number): void {
  const next = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 1;
  if (next === assistScale) return;
  const nowReal = performance.now();
  anchorSimMs = getSmoothSimTime(nowReal);
  anchorRealMs = nowReal;
  assistScale = next;
}

/** Current drift-assist factor (1 = true sidereal speed). */
export function getTimeAssistScale(): number {
  return assistScale;
}

/** Effective simulated-ms per real-ms (playback rate × drift assist). */
export function getTimeEngineRate(): number {
  return playbackRate * assistScale;
}

/** Sidereal drift rate — how fast the sky itself moves (15.041°/hour). */
export const SIDEREAL_DEG_PER_SEC = 15.041 / 3600;
