// ── Global Simulation Modes (Phase 26) ──────────────────────────
// Single source of truth for the app's strictness. Every difficulty knob
// lives in this table; components and the rules engine read from here
// instead of scattering hardcoded thresholds.

export type SimulationMode = 'fun' | 'easy' | 'realistic';

export interface SimulationModeRules {
  label: string;
  description: string;
  /** Focuser slider units of tolerance before the view counts as defocused. */
  focusToleranceUnits: number;
  /** Whether empty magnification (seeing-limited) blur is enforced. */
  atmosphericLimitEnforced: boolean;
  /** Scales the apparent sky drift in the 2D eyepiece views (0 = perfect tracking). */
  driftMultiplier: number;
  /** Sidereal motor engages automatically on startup/target changes. */
  motorAutoOn: boolean;
  /** Finderscope error is pinned to zero; Scramble becomes a no-op. */
  finderErrorForcedZero: boolean;
  /** Alignment screws unlock when the target is within this fraction of the main FOV. */
  alignmentLockThresholdFovFraction: number;
  /** Legacy px-based finder alignment "snap" threshold (checkAlignment). */
  alignmentSnapPx: number;
  /** The Fun-mode 2× digital zoom override is available. */
  digitalZoomAvailable: boolean;
}

export const SIM_MODE_RULES: Record<SimulationMode, SimulationModeRules> = {
  fun: {
    label: 'Fun',
    description:
      'Sightseeing mode: tracking and alignment are always perfect, blur penalties are off, and Digital Zoom lets you push planets huge.',
    focusToleranceUnits: 12,
    atmosphericLimitEnforced: false,
    driftMultiplier: 0,
    motorAutoOn: true,
    finderErrorForcedZero: true,
    alignmentLockThresholdFovFraction: Number.POSITIVE_INFINITY,
    alignmentSnapPx: 8,
    digitalZoomAvailable: true,
  },
  easy: {
    label: 'Easy',
    description:
      'Training wheels: generous focus tolerance, slow sky drift, forgiving finderscope alignment. The physics is real but patient.',
    focusToleranceUnits: 10,
    atmosphericLimitEnforced: true,
    driftMultiplier: 0.35,
    motorAutoOn: false,
    finderErrorForcedZero: false,
    alignmentLockThresholdFovFraction: 0.6,
    alignmentSnapPx: 6,
    digitalZoomAvailable: false,
  },
  realistic: {
    label: 'Realistic',
    description:
      'Field conditions: true sidereal drift, tight ±4 focus, authentic alignment protocol, and full empty-magnification penalties.',
    focusToleranceUnits: 4,
    atmosphericLimitEnforced: true,
    driftMultiplier: 1,
    motorAutoOn: false,
    finderErrorForcedZero: false,
    alignmentLockThresholdFovFraction: 0.35,
    alignmentSnapPx: 3,
    digitalZoomAvailable: false,
  },
};
