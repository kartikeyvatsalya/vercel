import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  balanceCounterweightPosition,
  balanceToleranceNm,
  classifyBalance,
  counterweightAnchorX,
  counterweightLeverArmM,
  counterweightMassKg,
  imbalanceDroopScalar,
  netRaTorqueNm,
  otaMassKg,
  OTA_LEVER_ARM_M,
  type BalanceVerdict,
} from '../engine/mechanics';
import { useTelescopeStore } from './useTelescopeStore';

/**
 * Mount Mechanics State (Phase 58)
 * ─────────────────────────────────────────────────────────────────
 * One number: where the counterweight sits on its shaft, 0 (hard against the
 * mount head) to 1 (at the far end). Everything else the app shows about
 * balance — the live torque readout, the 3D weight's position, the droop the
 * eyepiece feed inflicts on an unbalanced mount, and useTelescopeStore's
 * `isMechanicallyBalanced` boolean — is DERIVED from that number through
 * engine/mechanics.ts, never stored beside it. Same discipline as
 * useCollimationStore (Phase 57), and for the same reason: a mount that
 * reports "balanced" while its counterweight is visibly parked at the end of
 * the shaft is exactly the contradiction this split makes impossible.
 *
 * Its own store rather than a useTelescopeStore slice so dragging the balance
 * slider doesn't re-render every consumer of the very widely subscribed main
 * store, and so the persisted key can be dropped independently.
 */

interface MechanicsState {
  /** Normalised counterweight position along the shaft, 0…1. */
  counterweightPosition: number;

  /** Slide the weight to an absolute 0…1 position, then re-derive the verdict. */
  setCounterweightPosition: (position: number) => void;
  /** Nudge it by a delta (the panel's ◀ ▶ buttons). */
  nudgeCounterweight: (delta: number) => void;
  /** Slide it to the exact balance point for the active instrument. */
  autoBalance: () => void;
  /** Knock it well off balance for practice (the Settings sabotage switch). */
  unbalance: () => void;
  /**
   * Recompute `isMechanicallyBalanced` in useTelescopeStore from the current
   * weight position and the ACTIVE telescope. Called after every mutation
   * above, on rehydrate, and whenever the active profile changes (a heavier
   * tube needs the weight further out — the same shaft position that balanced
   * the last instrument will not balance this one).
   */
  syncBalanceStatus: () => void;
}

/** Live derived view of the counterweight against the current telescope. */
export interface MechanicsReadout {
  /** False for Alt-Az mounts: a Dobsonian rocker or a fork has no RA shaft to slide. */
  hasCounterweight: boolean;
  otaMassKg: number;
  counterweightMassKg: number;
  otaLeverArmM: number;
  counterweightLeverArmM: number;
  /** Net moment about the RA axis, N·m. Positive = nose heavy. */
  netTorqueNm: number;
  toleranceNm: number;
  verdict: BalanceVerdict;
  isBalanced: boolean;
  /** Where the weight WOULD balance, 0…1 — drives the slider's target marker. */
  balancePosition: number;
  /**
   * Signed droop multiplier for LiveViewPanel's 'track' mode; 0 while the
   * mount is inside tolerance, so a balanced instrument holds perfectly still
   * exactly as it always has.
   */
  droopScalar: number;
  /** Local x the 3D counterweight mesh should sit at (see engine/mechanics). */
  anchorX: number;
}

/**
 * The one place the counterweight meets the active telescope. Deliberately a
 * plain function of both stores' current values rather than a memoized
 * selector: it is a dozen multiplications, and any cache here would be one
 * more thing that could disagree with the shaft.
 */
export function getMechanicsReadout(): MechanicsReadout {
  const { counterweightPosition } = useMechanicsStore.getState();
  const profile = useTelescopeStore.getState().activeProfile;
  const hasCounterweight = profile?.mountType === 'Equatorial';

  if (!profile) {
    return {
      hasCounterweight: false,
      otaMassKg: 0,
      counterweightMassKg: 0,
      otaLeverArmM: OTA_LEVER_ARM_M,
      counterweightLeverArmM: counterweightLeverArmM(counterweightPosition),
      netTorqueNm: 0,
      toleranceNm: 0,
      verdict: 'balanced',
      isBalanced: true,
      balancePosition: counterweightPosition,
      droopScalar: 0,
      anchorX: counterweightAnchorX(counterweightPosition),
    };
  }

  const netTorqueNm = netRaTorqueNm(profile, counterweightPosition);
  const toleranceNm = balanceToleranceNm(profile);
  const verdict = classifyBalance(netTorqueNm, toleranceNm);
  const isBalanced = verdict === 'balanced';

  return {
    hasCounterweight,
    otaMassKg: otaMassKg(profile),
    counterweightMassKg: counterweightMassKg(profile),
    otaLeverArmM: OTA_LEVER_ARM_M,
    counterweightLeverArmM: counterweightLeverArmM(counterweightPosition),
    netTorqueNm,
    toleranceNm,
    verdict,
    isBalanced,
    balancePosition: balanceCounterweightPosition(profile),
    // An Alt-Az mount has no RA-axis moment at all, and a balanced one has
    // nothing to fall toward — either way the feed must not creep.
    droopScalar: hasCounterweight && !isBalanced ? imbalanceDroopScalar(netTorqueNm) : 0,
    anchorX: counterweightAnchorX(counterweightPosition),
  };
}

/**
 * How far off balance the Settings sabotage switch throws the weight: far
 * enough out that the droop is unmistakable within a few seconds, close
 * enough that sliding it back is a matter of seconds too.
 */
const SABOTAGE_OFFSET = 0.28;

export const useMechanicsStore = create<MechanicsState>()(
  persist(
    (set, get) => ({
      // A mount arrives from the shop balanced for the telescope on it. The
      // default profile is read live rather than hardcoded so the very first
      // session is balanced whatever instrument is mounted.
      counterweightPosition: balanceCounterweightPosition(
        useTelescopeStore.getState().activeProfile
      ),

      setCounterweightPosition: (position) => {
        set({ counterweightPosition: Math.max(0, Math.min(1, position)) });
        get().syncBalanceStatus();
      },

      nudgeCounterweight: (delta) => {
        get().setCounterweightPosition(get().counterweightPosition + delta);
      },

      autoBalance: () => {
        const profile = useTelescopeStore.getState().activeProfile;
        if (!profile) return;
        get().setCounterweightPosition(balanceCounterweightPosition(profile));
      },

      unbalance: () => {
        const profile = useTelescopeStore.getState().activeProfile;
        if (!profile) return;
        const balanced = balanceCounterweightPosition(profile);
        // Throw it toward whichever end of the shaft has room, so the sabotage
        // is always a real imbalance and never silently clipped at a stop.
        const direction = balanced > 0.5 ? -1 : 1;
        get().setCounterweightPosition(balanced + direction * SABOTAGE_OFFSET);
      },

      syncBalanceStatus: () => {
        const { hasCounterweight, isBalanced } = getMechanicsReadout();
        // An Alt-Az mount has no counterweight shaft, so there is nothing here
        // to be out of balance — it reports balanced by definition, the same
        // way a sealed refractor reports collimated by definition. (The
        // Settings sabotage switch still fakes a drooping Dobsonian by
        // writing the boolean directly; nothing calls this for a mount with no
        // shaft except an actual instrument change, where re-deriving is right.)
        const balanced = !hasCounterweight || isBalanced;
        if (useTelescopeStore.getState().isMechanicallyBalanced !== balanced) {
          useTelescopeStore.getState().setMechanicallyBalanced(balanced);
        }
      },
    }),
    {
      name: 'telescope-mechanics-storage',
      // Only the shaft position persists; every derived number is recomputed
      // against whatever telescope is active on the next visit.
      partialize: (state) => ({ counterweightPosition: state.counterweightPosition }),
      // A rehydrated session must republish its verdict: useTelescopeStore
      // persists `isMechanicallyBalanced` separately, and the two snapshots are
      // written at different moments, so they can land out of step.
      onRehydrateStorage: () => (state) => {
        state?.syncBalanceStatus();
      },
    }
  )
);

// ── Instrument changes re-derive the verdict ────────────────────────
// Swapping the OTA changes m_ota, and therefore where the weight has to sit;
// the shaft position that balanced the last scope will not balance this one.
// Subscribed here rather than called from useTelescopeStore so the dependency
// stays one-way (this store knows about the telescope store, never the
// reverse) — the same arrangement useCollimationStore uses.
useTelescopeStore.subscribe((state, prevState) => {
  if (state.activeProfile?.id !== prevState.activeProfile?.id) {
    useMechanicsStore.getState().syncBalanceStatus();
  }
});
