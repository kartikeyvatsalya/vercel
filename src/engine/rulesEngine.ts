import type { InstructorResponse } from '../types';
import { INSTRUCTOR_STRINGS } from '../data/bookContent';
import { isAtmosphericLimitExceeded, getPerfectFocusPoint } from './opticalMath';

export interface RuleStateInput {
  isDustCapOn: boolean;
  isSolarFilterAttached: boolean;
  targetId: string;
  magnification: number;
  seeingQuality: number;
  isAltTensionLocked: boolean;
  isMechanicallyBalanced: boolean;
  isCollimated: boolean;
  isMirrorCooled: boolean;
  focuserPosition: number;
  eyepieceFocalLength: number;
  isBarlowActive: boolean;
  // ── Simulation-mode knobs (Phase 26) — optional so the function stays
  // pure and callers that don't care keep the historical strict behavior.
  /** Focuser units of tolerance before defocus kicks in (default 5). */
  focusToleranceUnits?: number;
  /** Enforce the empty-magnification atmospheric blur penalty (default true). */
  enforceAtmosphericLimit?: boolean;
  /**
   * ── The Universal Physical Sky (Phase 35) ── True when the mount is
   * PHYSICALLY pointed within the solar hazard radius of the live Sun
   * (LiveViewPanel computes this from the mount's raw pointing + the solar
   * ephemeris). The universal renderer draws the Sun wherever the tube
   * crosses it — target lock or not — so the safety interlock must fire on
   * physical pointing too, exactly as a real telescope would blind you
   * regardless of what the hand controller's menu says. Optional so legacy
   * callers keep the historical UI-selection-only behavior.
   */
  isPhysicallyPointedAtSun?: boolean;
}

/** Extended input for astrophotography-specific rule evaluation */
export interface AstroPhotoRuleInput {
  mode: 'planetary' | 'dso';
  targetId: string;
  // Planetary mode
  exposureMs?: number;
  frameCutoff?: number; // 5–100%
  // DSO mode
  subExposures?: number;
  subExposureTimeSec?: number;
  trackingLocked?: boolean;
  hasDarkFrames?: boolean;
  darkFrameCount?: number;
  iso?: number;
}

export interface RuleEvaluationResult {
  isBlackedOut: boolean;
  hasSolarHazard: boolean;
  isSolarFilterBlocking: boolean;
  isAtmosphericBlurActive: boolean;
  isThermalBlurActive: boolean;
  isAltDrooping: boolean;
  isDefocused: boolean;
  defocusAmount: number;
  instructorResponse: InstructorResponse | null;
}

export interface AstroPhotoRuleResult {
  instructorResponse: InstructorResponse | null;
}

export function evaluateState(state: RuleStateInput): RuleEvaluationResult {
  const result: RuleEvaluationResult = {
    isBlackedOut: false,
    hasSolarHazard: false,
    isSolarFilterBlocking: false,
    isAtmosphericBlurActive: false,
    isThermalBlurActive: false,
    isAltDrooping: false,
    isDefocused: false,
    defocusAmount: 0,
    instructorResponse: null,
  };

  // 1. Solar Hazard (Highest Priority) — fires on the UI selection OR on
  // physically sweeping the tube across the live Sun (Phase 35): the danger
  // is where the optics point, not what the menu says.
  if ((state.targetId === 'sun' || state.isPhysicallyPointedAtSun) && !state.isSolarFilterAttached && !state.isDustCapOn) {
    result.hasSolarHazard = true;
    result.instructorResponse = {
      title: 'Safety Override',
      severity: 'critical',
      message: {
        id: 'solar-hazard',
        text: INSTRUCTOR_STRINGS.solarHazard,
        emotion: 'urgent',
        priority: 1,
      },
    };
    return result;
  }

  // 2. Solar Filter on Non-Solar Target
  if (state.isSolarFilterAttached && state.targetId !== 'sun' && !state.isDustCapOn) {
    result.isBlackedOut = true;
    result.isSolarFilterBlocking = true;
    result.instructorResponse = {
      title: 'Solar Filter Active',
      severity: 'warning',
      message: {
        id: 'solar-filter-blocking',
        text: "Everything is black! Remember, a solar filter blocks out almost all light so you don't damage your eyes on the Sun. Take it off if you are looking at night-sky objects like the Moon or Saturn!",
        emotion: 'encouraging',
        priority: 2,
      },
    };
    return result;
  }

  // 3. Dust Cap Trap
  if (state.isDustCapOn) {
    result.isBlackedOut = true;
    result.instructorResponse = {
      title: 'No Light',
      severity: 'warning',
      message: {
        id: 'dust-cap',
        text: INSTRUCTOR_STRINGS.dustCapWarning,
        emotion: 'encouraging',
        priority: 3,
      },
    };
    return result;
  }

  // 4. Mechanical Failure: Alt Tension
  if (!state.isAltTensionLocked) {
    result.isAltDrooping = true;
    result.instructorResponse = {
      title: 'Mechanical Slippage',
      severity: 'warning',
      message: {
        id: 'alt-droop',
        text: INSTRUCTOR_STRINGS.altDroop,
        emotion: 'neutral',
        priority: 4,
      },
    };
  }

  // 5. Atmospheric / Thermal Limits
  if ((state.enforceAtmosphericLimit ?? true) && isAtmosphericLimitExceeded(state.magnification, state.seeingQuality)) {
    result.isAtmosphericBlurActive = true;
    if (!result.instructorResponse) {
      result.instructorResponse = {
        title: 'Atmospheric Turbulence',
        severity: 'info',
        message: {
          id: 'atmos-blur',
          text: state.magnification >= 300 
            ? "At 300x magnification, your field of view shrinks to just 0.17° and the image gets much dimmer! Plus, high power magnifies atmospheric turbulence—notice how boiling the target looks tonight? Drop down to the 25mm eyepiece for a crisper view!"
            : INSTRUCTOR_STRINGS.overMagnification,
          emotion: 'neutral',
          priority: 5,
        },
      };
    }
  }

  if (!state.isMirrorCooled) {
    result.isThermalBlurActive = true;
  }

  // Mechanical: Collimation Error
  if (!state.isCollimated && !result.instructorResponse) {
    result.instructorResponse = {
      title: 'Collimation Error',
      severity: 'warning',
      message: {
        id: 'collimation',
        text: "The stars look like little comets! Your mirrors are out of collimation. The primary and secondary mirrors must be perfectly aligned to produce a sharp point of light.",
        emotion: 'serious',
        priority: 4,
      },
    };
  }

  // 6. Defocus
  const perfectFocusPoint = getPerfectFocusPoint(state.eyepieceFocalLength, state.isBarlowActive);
  const defocusOffset = Math.abs(state.focuserPosition - perfectFocusPoint);
  const focusTolerance = state.focusToleranceUnits ?? 5;
  if (defocusOffset > focusTolerance) {
    result.isDefocused = true;
    result.defocusAmount = defocusOffset;
    if (!result.instructorResponse) {
      result.instructorResponse = {
        title: 'Out of Focus',
        severity: 'warning',
        message: {
          id: 'defocus',
          text: "The image is blurry. Try adjusting the focuser knob until the stars look like sharp pinpricks.",
          emotion: 'encouraging',
          priority: 4,
        },
      };
    }
  }

  return result;
}

/**
 * Evaluates astrophotography-specific rules.
 * Returns an instructor response if the student needs guidance.
 */
export function evaluateAstroPhotoRules(input: AstroPhotoRuleInput): AstroPhotoRuleResult {
  const result: AstroPhotoRuleResult = { instructorResponse: null };

  if (input.mode === 'planetary') {
    // RULE: Planetary targets are bright — long exposures overexpose them.
    const targetType = input.targetId;
    const isPlanetary = targetType === 'saturn' || targetType === 'jupiter' || targetType === 'moon' || targetType === 'sun';

    if (isPlanetary && input.exposureMs && input.exposureMs > 500) {
      result.instructorResponse = {
        title: 'Planetary Over-Exposure',
        severity: 'warning',
        message: {
          id: 'planetary-overexpose',
          text: "You are over-exposing this target! Planets are bright—use millisecond exposures and high-speed video instead. Keep individual frame exposures under 100ms for crisp planetary detail.",
          emotion: 'encouraging',
          priority: 6,
        },
      };
      return result;
    }

    // RULE: Stacking too many frames dilutes sharpness
    if (input.frameCutoff && input.frameCutoff > 50) {
      result.instructorResponse = {
        title: 'Frame Selection',
        severity: 'info',
        message: {
          id: 'lucky-imaging-hint',
          text: "In planetary imaging, atmospheric turbulence is the enemy! By shooting high-speed video and stacking only the top 10% sharpest frames—a technique called Lucky Imaging—we beat the atmosphere and reveal crisp details like Saturn's Cassini Division!",
          emotion: 'encouraging',
          priority: 7,
        },
      };
      return result;
    }

  } else if (input.mode === 'dso') {
    // RULE: DSO without tracking = star trails
    if (!input.trackingLocked && input.subExposureTimeSec && input.subExposureTimeSec > 2) {
      result.instructorResponse = {
        title: 'Star Trailing Detected',
        severity: 'warning',
        message: {
          id: 'dso-no-tracking',
          text: "Without motorized tracking, the Earth's rotation smears your sub-exposures into star trails! Turn on Mount Tracking Lock before capturing deep-sky sub-exposures.",
          emotion: 'encouraging',
          priority: 5,
        },
      };
      return result;
    }

    // RULE: Missing Dark Frames
    if (input.subExposures && input.subExposures >= 5 && !input.hasDarkFrames) {
      result.instructorResponse = {
        title: 'Calibration Needed',
        severity: 'info',
        message: {
          id: 'dark-frames-needed',
          text: "Notice those bright colored specks? Those are thermal hot pixels from the camera sensor! Put the dust cap on and shoot some Dark Frames to subtract them out. This is essential calibration for clean deep-sky images.",
          emotion: 'encouraging',
          priority: 6,
        },
      };
      return result;
    }
  }

  return result;
}
