import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  SCREW_DETENT_TURNS,
  classifyCollimation,
  collimationToleranceArcmin,
  computeCollimationField,
  isSecondaryResolved,
  screwAngleRad,
  type CollimationField,
  type CollimationGrade,
  type ScrewTriple,
} from '../engine/collimation';
import { useTelescopeStore } from './useTelescopeStore';
import { sanitizeNumber } from './persistGuards';

/**
 * Collimation State (Phase 57)
 * ─────────────────────────────────────────────────────────────────
 * The mechanical truth of the instrument: six screw positions, in turns.
 * Everything the app shows about collimation — the star test's decentred
 * shadow, the coma flare, the OUT/CLOSE/DIFFRACTION-LIMITED chip, and
 * useTelescopeStore's `isCollimated` boolean — is DERIVED from these six
 * numbers through engine/collimation.ts, never stored alongside them. A
 * mirror cell that says it is aligned while its screws say otherwise is
 * exactly the kind of contradiction this split exists to make impossible.
 *
 * Kept as its own store rather than a useTelescopeStore slice so that a screw
 * turn doesn't re-render every consumer of the (very widely subscribed) main
 * telescope store, and so the persisted key can be dropped independently if
 * the cell model ever changes shape.
 */

const ALIGNED: ScrewTriple = [0, 0, 0];

/** Which cell a screw belongs to. */
export type MirrorId = 'primary' | 'secondary';

/**
 * How badly `scramble` throws a cell out, expressed in MULTIPLES OF THAT
 * TELESCOPE'S OWN TOLERANCE rather than in turns.
 *
 * Turns are the wrong unit for this and measurably so: a quarter turn looks
 * like a lot of screw, but on the Dob's 90mm primary circle it lands *inside*
 * the f/6 diffraction limit — a "scrambled" scope that is actually fine —
 * while the very same quarter turn on an SCT's 16mm circle, through a 10×
 * amplifying secondary, is catastrophic. Working backwards from the beam
 * error instead gives every instrument a scramble of equal difficulty, and
 * lets the numbers below mean something: 4× tolerance is solidly OUT, clears
 * the 3× gate that locks the primary tab, and is recoverable in a couple of
 * dozen detents.
 */
const SCRAMBLE_TOLERANCE_MULTIPLE = 4;

const RAD_TO_ARCMIN = (180 / Math.PI) * 60;

interface CollimationState {
  primaryScrews: ScrewTriple;
  secondaryScrews: ScrewTriple;

  /**
   * Advance one screw by `detents` 1/24-turn clicks (negative = back it out).
   * Syncs the derived alignment verdict afterward, so the rules engine and
   * the renderer can never lag a click behind the hardware. The finderscope
   * is bolted to the tube and is never touched here (Phase 61) — it is the
   * MAIN eyepiece's optical axis that swings when a mirror tilts; see
   * skyRenderer's collimationOffsetDeg for where that shift is applied.
   */
  turnScrew: (mirror: MirrorId, index: number, detents: number) => void;
  /** Snap one cell back to factory-perfect. */
  resetMirror: (mirror: MirrorId) => void;
  /** Knock a cell out of alignment for practice (the panel's Scramble button). */
  scramble: (mirror: MirrorId) => void;
  /** Both cells to zero — the Settings "Collimation: perfectly aligned" path. */
  resetAll: () => void;
  /**
   * Recompute `isCollimated` in useTelescopeStore from the current screws.
   * Called after every mutation above; exported so callers that change the
   * ACTIVE PROFILE (a different scope has different cells, and therefore a
   * different tolerance for the same screws) can re-derive it too.
   */
  syncCollimationStatus: () => void;
}

/** Live derived view of the current screws against the current telescope. */
export interface CollimationReadout extends CollimationField {
  toleranceArcmin: number;
  grade: CollimationGrade;
  /** Gate for the panel's Primary tab — see engine/collimation.isSecondaryResolved. */
  secondaryResolved: boolean;
  /** False for instruments with no user-adjustable cells at all (a sealed refractor). */
  hasAdjustableOptics: boolean;
}

/**
 * The one place screws meet the active telescope. Deliberately a plain
 * function of both stores' current values rather than a memoized selector:
 * it is pennies to compute, and any caching layer here would be one more
 * thing that could disagree with the screws.
 */
export function getCollimationReadout(): CollimationReadout {
  const { primaryScrews, secondaryScrews } = useCollimationStore.getState();
  const profile = useTelescopeStore.getState().activeProfile;
  const spec = profile?.collimation;
  const field = computeCollimationField(primaryScrews, secondaryScrews, spec);
  const toleranceArcmin = profile ? collimationToleranceArcmin(profile) : Infinity;
  return {
    ...field,
    toleranceArcmin,
    grade: classifyCollimation(field.errorArcmin, toleranceArcmin),
    secondaryResolved: !spec?.secondary || isSecondaryResolved(field.secondaryArcmin, toleranceArcmin),
    hasAdjustableOptics: !!(spec?.primary || spec?.secondary),
  };
}

export const useCollimationStore = create<CollimationState>()(
  persist(
    (set, get) => ({
      // A new student's telescope arrives collimated; the lesson starts by
      // scrambling it (or by picking up whatever a previous session left).
      primaryScrews: ALIGNED,
      secondaryScrews: ALIGNED,

      turnScrew: (mirror, index, detents) => {
        if (index < 0 || index > 2) return;
        const current = mirror === 'primary' ? get().primaryScrews : get().secondaryScrews;
        const next: [number, number, number] = [current[0], current[1], current[2]];
        next[index] = current[index] + detents * SCREW_DETENT_TURNS;
        set(mirror === 'primary' ? { primaryScrews: next } : { secondaryScrews: next });
        get().syncCollimationStatus();
      },

      resetMirror: (mirror) => {
        set(mirror === 'primary' ? { primaryScrews: ALIGNED } : { secondaryScrews: ALIGNED });
        get().syncCollimationStatus();
      },

      scramble: (mirror) => {
        const profile = useTelescopeStore.getState().activeProfile;
        const cell = mirror === 'primary' ? profile?.collimation?.primary : profile?.collimation?.secondary;
        // Nothing to scramble — a sealed refractor, or an SCT's factory-set primary.
        if (!cell || !profile) return;

        // A pure tilt in a random direction θ: zᵢ = A·cos(φᵢ − θ). Three
        // cosines 120° apart sum to zero, so this carries NO piston at all —
        // Scramble misaligns the mirror without secretly also defocusing it,
        // which would muddle the very symptom the student is learning to read.
        // The identity Σcos(φᵢ−θ)·cos φᵢ = (3/2)cos θ collapses screwsToTilt's
        // plane fit to exactly tilt = A / R, which is what makes the amplitude
        // below solvable in closed form instead of guessed at.
        const targetBeamArcmin = collimationToleranceArcmin(profile) * SCRAMBLE_TOLERANCE_MULTIPLE;
        const tiltRad = targetBeamArcmin / cell.beamDeviationGain / RAD_TO_ARCMIN;
        const amplitudeMm = tiltRad * cell.screwCircleRadiusMm;
        const theta = Math.random() * Math.PI * 2;
        const scrambled = [0, 1, 2].map(
          (i) => (amplitudeMm * Math.cos(screwAngleRad(cell, i) - theta)) / cell.threadPitchMm
        ) as unknown as ScrewTriple;

        set(mirror === 'primary' ? { primaryScrews: scrambled } : { secondaryScrews: scrambled });
        get().syncCollimationStatus();
      },

      resetAll: () => {
        set({ primaryScrews: ALIGNED, secondaryScrews: ALIGNED });
        get().syncCollimationStatus();
      },

      syncCollimationStatus: () => {
        const { grade, hasAdjustableOptics } = getCollimationReadout();
        // A refractor has no cells to misalign, so it is collimated by
        // definition — never let an inherited screw position from a previously
        // selected reflector condemn it.
        const collimated = !hasAdjustableOptics || grade !== 'out';
        if (useTelescopeStore.getState().isCollimated !== collimated) {
          useTelescopeStore.getState().setCollimated(collimated);
        }
      },
    }),
    {
      name: 'telescope-collimation-storage',
      // Only the screws persist; every derived number is recomputed against
      // whatever telescope is active on the next visit.
      partialize: (state) => ({
        primaryScrews: state.primaryScrews,
        secondaryScrews: state.secondaryScrews,
      }),
      // ── Numeric corruption guard (Phase 65) ──
      // Each screw feeds engine/collimation.ts's trig directly; a NaN/null
      // (or a wildly out-of-bounds hand-edited value) turned decentred-shadow
      // and coma-flare math into NaN too, silently blanking the star test
      // canvas. A malformed triple (wrong length, non-array) resets the
      // whole cell to factory-aligned rather than trusting its shape.
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<CollimationState> | undefined;
        const sanitizeScrews = (screws: unknown): ScrewTriple => {
          if (!Array.isArray(screws) || screws.length !== 3) return ALIGNED;
          return [
            sanitizeNumber(screws[0], 0, -10000, 10000),
            sanitizeNumber(screws[1], 0, -10000, 10000),
            sanitizeNumber(screws[2], 0, -10000, 10000),
          ];
        };
        return {
          ...currentState,
          primaryScrews: sanitizeScrews(persisted?.primaryScrews),
          secondaryScrews: sanitizeScrews(persisted?.secondaryScrews),
        };
      },
      // A rehydrated session must republish its verdict: useTelescopeStore
      // persists `isCollimated` separately, and the two snapshots are written
      // at different moments, so they can land out of step.
      onRehydrateStorage: () => (state) => {
        state?.syncCollimationStatus();
      },
    }
  )
);
