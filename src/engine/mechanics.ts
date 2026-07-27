import type { TelescopeProfile } from '../types';

/**
 * Mount Mechanics — RA-axis balance (Phase 58)
 * ─────────────────────────────────────────────────────────────────
 * A German equatorial mount is a first-class lever. The optical tube hangs
 * off one side of the polar (RA) axis and a cast-iron weight hangs off the
 * other, and the whole instrument only tracks properly when the two moments
 * cancel:
 *
 *     τ = m_ota · r_ota − m_cw · r_cw
 *
 * τ > 0 the tube end is heavier (NOSE HEAVY — the OTA sinks and the drive
 * gears are fighting gravity on every step); τ < 0 the weight end is heavier
 * (COUNTERWEIGHT HEAVY — the tube creeps upward instead); τ ≈ 0 and the
 * mount will hold any position with the clutches loose, which is the whole
 * point of the exercise.
 *
 * ── Where the geometry comes from ──
 * Every lever arm below is read straight off the 3D rig in
 * components/canvas/ObservatoryScene.tsx (EquatorialAssembly), in the
 * hour-angle group's local frame, so the physics and the picture can never
 * disagree:
 *
 *     counterweight shaft   cylinder centred at x = −0.42, length 0.50
 *     declination group     (the OTA saddle) at x = +0.24
 *     optical tube          a further +0.16 inside that saddle
 *
 * One world unit is treated as one metre — which is not a fudge but a
 * coincidence worth keeping: 0.40 m from the dec axis to the tube's centre
 * of mass and a 24–60 cm counterweight travel are both squarely in the range
 * a real GEM occupies, so the torques below come out in the same few-N·m
 * band a real observer feels through the clutches.
 *
 * Everything here is a pure function of the profile and one scalar (the
 * counterweight's normalised position along its shaft). The scalar itself
 * lives in store/useMechanicsStore.ts; nothing in this file holds state.
 */

/** Standard gravity, m/s². */
export const GRAVITY = 9.80665;

// ── Lever-arm geometry (world units = metres; see the header) ──────

/** Declination group's offset from the RA axis — ObservatoryScene decGroupRef. */
export const OTA_PIVOT_OFFSET_M = 0.24;
/** Optical tube's further offset inside the saddle — ObservatoryScene's inner group. */
export const OTA_TUBE_OFFSET_M = 0.16;
/** Distance from the RA axis to the tube's centre of mass. */
export const OTA_LEVER_ARM_M = OTA_PIVOT_OFFSET_M + OTA_TUBE_OFFSET_M;

/** Counterweight shaft: cylinder centre and half-length, from the same rig. */
export const CW_SHAFT_CENTER_M = -0.42;
export const CW_SHAFT_HALF_LENGTH_M = 0.25;
/** Half the cast weight's own width — it cannot overhang either end of the shaft. */
export const CW_BLOCK_HALF_WIDTH_M = 0.075;

/** Closest the weight can sit to the RA axis (hard against the dec housing). */
export const CW_MIN_LEVER_ARM_M =
  -(CW_SHAFT_CENTER_M + CW_SHAFT_HALF_LENGTH_M) + CW_BLOCK_HALF_WIDTH_M; // 0.245
/** Farthest out, hard against the retaining bolt at the shaft's end. */
export const CW_MAX_LEVER_ARM_M =
  -(CW_SHAFT_CENTER_M - CW_SHAFT_HALF_LENGTH_M) - CW_BLOCK_HALF_WIDTH_M; // 0.595

// ── Mass model ─────────────────────────────────────────────────────
// An OTA's mass is dominated by its glass and its tube: roughly aperture²
// (the mirror/objective and its cell) times physical tube LENGTH (the shell).
// Normalised so the catalog's 8" f/6 Newtonian — the reference instrument
// everywhere else in this codebase — lands at a believable ~9.6 kg.

/** Focuser, finder, rings, saddle plate: present on every tube regardless of size. */
export const OTA_HARDWARE_MASS_KG = 1.5;
/** Optics + shell mass at the reference aperture and tube length. */
export const OTA_OPTICS_MASS_KG = 8;
export const OTA_REFERENCE_APERTURE_MM = 200;
export const OTA_REFERENCE_TUBE_LENGTH_MM = 1300;

/** Catadioptrics fold the light path, so the tube is a fraction of the focal length. */
const FOLDED_OPTICS_TYPES = new Set<TelescopeProfile['type']>(['SCT', 'Maksutov', 'Smart']);
const FOLDED_TUBE_LENGTH_RATIO = 1 / 5;
/** Straight tubes need the focal length plus a little drawtube and cell. */
const STRAIGHT_TUBE_LENGTH_RATIO = 1.1;

/**
 * Physical tube length (mm) — NOT the focal length. A 14" SCT focuses at
 * 3910mm inside a barrel barely 780mm long; treating the two as the same
 * number would make it the heaviest object in the solar system.
 */
export function otaTubeLengthMm(profile: TelescopeProfile): number {
  const ratio = FOLDED_OPTICS_TYPES.has(profile.type)
    ? FOLDED_TUBE_LENGTH_RATIO
    : STRAIGHT_TUBE_LENGTH_RATIO;
  return Math.max(1, profile.focalLength * ratio);
}

/** Mass (kg) of the optical tube assembly this profile describes. */
export function otaMassKg(profile: TelescopeProfile): number {
  const apertureRatio = profile.aperture / OTA_REFERENCE_APERTURE_MM;
  const lengthRatio = otaTubeLengthMm(profile) / OTA_REFERENCE_TUBE_LENGTH_MM;
  return OTA_HARDWARE_MASS_KG + OTA_OPTICS_MASS_KG * apertureRatio ** 2 * lengthRatio;
}

/**
 * Counterweights ship in discrete cast blocks, not in whatever mass would be
 * convenient — which is exactly why the shaft is long and the weight slides.
 * Sized at ~90% of the tube so the balance point lands comfortably inside the
 * shaft's travel for every catalog instrument (the weight is fixed hardware;
 * only its POSITION is the student's variable).
 */
export const COUNTERWEIGHT_MASS_RATIO = 0.9;
export const COUNTERWEIGHT_MASS_STEP_KG = 0.5;
export const COUNTERWEIGHT_MIN_MASS_KG = 1;
export const COUNTERWEIGHT_MAX_MASS_KG = 30;

export function counterweightMassKg(profile: TelescopeProfile): number {
  const raw = otaMassKg(profile) * COUNTERWEIGHT_MASS_RATIO;
  const stepped = Math.round(raw / COUNTERWEIGHT_MASS_STEP_KG) * COUNTERWEIGHT_MASS_STEP_KG;
  return clamp(stepped, COUNTERWEIGHT_MIN_MASS_KG, COUNTERWEIGHT_MAX_MASS_KG);
}

// ── Position ↔ lever arm ───────────────────────────────────────────

/**
 * The counterweight's position is stored as a normalised 0…1 fraction of its
 * travel (0 = hard against the mount head, 1 = at the far end of the shaft)
 * rather than as a distance, so a persisted session stays meaningful if the
 * rig's geometry is ever re-modelled.
 */
export function counterweightLeverArmM(position: number): number {
  return CW_MIN_LEVER_ARM_M + clamp(position, 0, 1) * (CW_MAX_LEVER_ARM_M - CW_MIN_LEVER_ARM_M);
}

export function counterweightPositionFromLeverArm(leverArmM: number): number {
  const span = CW_MAX_LEVER_ARM_M - CW_MIN_LEVER_ARM_M;
  return clamp((leverArmM - CW_MIN_LEVER_ARM_M) / span, 0, 1);
}

/**
 * Local x of the cast weight in the hour-angle group's frame — the number
 * ObservatoryScene's counterweight mesh is positioned at. Negative: the
 * weight always lives on the opposite side of the RA axis from the tube.
 */
export function counterweightAnchorX(position: number): number {
  return -counterweightLeverArmM(position);
}

// ── Torque ─────────────────────────────────────────────────────────

/**
 * Net moment about the RA axis, N·m. Positive = nose heavy (the tube side
 * wins), negative = counterweight heavy.
 */
export function netRaTorqueNm(profile: TelescopeProfile, position: number): number {
  return GRAVITY * (
    otaMassKg(profile) * OTA_LEVER_ARM_M
    - counterweightMassKg(profile) * counterweightLeverArmM(position)
  );
}

/** Where the weight has to sit for this instrument to balance, as a 0…1 position. */
export function balanceCounterweightPosition(profile: TelescopeProfile): number {
  const arm = (otaMassKg(profile) * OTA_LEVER_ARM_M) / counterweightMassKg(profile);
  return counterweightPositionFromLeverArm(arm);
}

/**
 * How close is close enough. Expressed as a distance the weight may be off
 * its ideal spot (1.2 cm — about the width of a thumb on the shaft, and the
 * honest limit of what anyone can judge by feel) rather than as a fixed
 * torque, so a heavy instrument isn't penalised for having big numbers.
 */
export const BALANCE_TOLERANCE_ARM_M = 0.012;

export function balanceToleranceNm(profile: TelescopeProfile): number {
  return GRAVITY * counterweightMassKg(profile) * BALANCE_TOLERANCE_ARM_M;
}

export type BalanceVerdict = 'balanced' | 'nose-heavy' | 'counterweight-heavy';

export function classifyBalance(netTorqueNm: number, toleranceNm: number): BalanceVerdict {
  if (Math.abs(netTorqueNm) <= toleranceNm) return 'balanced';
  return netTorqueNm > 0 ? 'nose-heavy' : 'counterweight-heavy';
}

// ── Droop ──────────────────────────────────────────────────────────

/**
 * Torque at which an unbalanced mount sinks at the nominal droop rate (the
 * historical fixed rate LiveViewPanel's 'track' mode has always used). Roughly
 * 3 cm of counterweight misplacement on the 8"-class rig — enough to be
 * visibly wrong within a few seconds at the eyepiece, which is exactly how
 * quickly a real imbalance announces itself.
 */
export const DROOP_REFERENCE_TORQUE_NM = 8;
/** Cap so a wildly misplaced weight streaks the field rather than teleporting it. */
export const DROOP_MAX_SCALAR = 3;

/**
 * Signed multiplier on the base droop rate. POSITIVE = nose heavy = the tube
 * sinks (altitude falls); NEGATIVE = counterweight heavy = the tube rises.
 * Both are real failure modes and they look different at the eyepiece, which
 * is the point of carrying the sign through instead of just a magnitude.
 */
export function imbalanceDroopScalar(netTorqueNm: number): number {
  return clamp(netTorqueNm / DROOP_REFERENCE_TORQUE_NM, -DROOP_MAX_SCALAR, DROOP_MAX_SCALAR);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
