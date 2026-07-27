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
import { SIM_MODE_RULES } from '../engine/simulationModes';
import { useTelescopeStore } from './useTelescopeStore';

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
   * the renderer can never lag a click behind the hardware — and drags the
   * finderscope out of alignment by the same angle the main axis swung
   * (Phase 60; see withFinderCoupling).
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

/**
 * Below which a coupled finder shift is not worth a store write, in degrees.
 * Pure hygiene: `adjustFinderscope` unconditionally builds a fresh
 * `finderscopeError` object, so an action that moved no screws (a reset of an
 * already-zeroed cell, a scramble on a sealed refractor) would otherwise push
 * a new object reference — and a re-render — through every consumer of the
 * very widely subscribed telescope store for nothing.
 */
const FINDER_COUPLING_EPSILON_DEG = 1e-9;

/**
 * The residual beam error as a VECTOR in the cell/screen frame, arcmin.
 *
 * computeCollimationField hands back magnitude + direction because that is
 * what the renderer and the Cheshire bullseye want, but the underlying
 * quantity is a two-axis tilt and the coupling below needs it that way:
 * differences of magnitudes are meaningless here (backing a screw out through
 * perfect alignment and out the far side leaves |error| unchanged while the
 * beam has swung a full 180°).
 */
function beamErrorVectorArcmin(): { x: number; y: number } {
  const { primaryScrews, secondaryScrews } = useCollimationStore.getState();
  const spec = useTelescopeStore.getState().activeProfile?.collimation;
  const { errorArcmin, angleRad } = computeCollimationField(primaryScrews, secondaryScrews, spec);
  return { x: errorArcmin * Math.cos(angleRad), y: errorArcmin * Math.sin(angleRad) };
}

/**
 * Collimation ⇄ finderscope coupling (Phase 60)
 * ─────────────────────────────────────────────────────────────────
 * Every mutation of the screws runs through here, and the reason is physical
 * rather than architectural: the collimation screws tilt the MIRRORS, and the
 * mirrors are what define the main telescope's outgoing optical axis. The
 * finderscope is bolted to the TUBE. It does not move when a mirror does. So
 * the angle between the two — which is precisely what `finderscopeError`
 * stores — changes by exactly the amount the main axis swung.
 *
 * This is one of the most reliably experienced consequences in amateur
 * astronomy and one of the most reliably forgotten: collimate at dusk, then
 * spend the next ten minutes wondering why the finder's crosshair no longer
 * lands anything in the eyepiece. Modelling it makes the simulator's two
 * alignment lessons stop being independent chores and become the ordered
 * procedure they are in the field — mirrors first, finder second, never the
 * reverse.
 *
 * Sampling before/after rather than deriving the shift from the mutation
 * itself is deliberate. The two cells add as vectors (see
 * computeCollimationField), so a primary turn's effect on the *residual* beam
 * depends on where the secondary already sits; only the endpoints know. It
 * also makes the wrapper total — `scramble` jumping to a random tilt and
 * `resetAll` snapping two cells to zero at once are handled by the same three
 * lines as a single detent, and no future action can forget the coupling by
 * being written the way `turnScrew` originally was.
 *
 * FRAME AND SIGN, the two things that are easy to get backwards:
 *  • Beam-error x is the horizontal axis of the cell frame → AZIMUTH; y is
 *    vertical with +y UP (the same convention CheshireBullseye draws with,
 *    where it flips to canvas coordinates itself) → ALTITUDE. Arcmin ÷ 60 for
 *    the degrees `finderscopeError` is kept in.
 *  • `finderscopeError` is (finder aim − main optical axis). Collimation moves
 *    the MAIN axis by +delta while the tube-mounted finder stays exactly where
 *    it was, so the stored difference moves by −delta. Getting this backwards
 *    would produce a simulator in which collimating a scrambled scope also
 *    magically *fixes* the finder, which is the opposite of the lesson.
 *
 * The cell frame is treated as the alt/az frame directly. A fuller model would
 * rotate it by the tube's roll about its own optical axis, which on an
 * alt-az mount depends on where the scope is pointed and on an equatorial one
 * on the hour angle. That was rejected: the mapping would then change under a
 * student who hadn't touched a screw, the finder error would appear to drift
 * during a slew, and the payoff is a rotation of an error whose direction is
 * arbitrary to begin with. Magnitude is the pedagogy here; the axis is not.
 */
function withFinderCoupling(mutate: () => void): void {
  // Fun mode pins the finder perfectly aligned — mirror scrambleFinderscope's
  // behaviour and skip the sampling entirely rather than applying a delta that
  // something else would only have to zero out again.
  //
  // Verified consequence, not a leak: turn screws in Fun mode and then leave
  // it, and the next screw turn's delta is measured from a beam error that
  // includes the Fun-era changes — so resetting the mirrors afterwards leaves
  // the finder off by exactly what Fun mode had been hiding. That is the
  // honest reading of what Fun mode asserted (finder perfectly aligned AT
  // those mirror positions); moving the mirrors back off them has to cost
  // something. It needs a deliberate mid-session mode switch to reach, and
  // "now go and re-align your finder" is the right lesson at that moment.
  const coupled = !SIM_MODE_RULES[useTelescopeStore.getState().simulationMode].finderErrorForcedZero;
  const before = coupled ? beamErrorVectorArcmin() : null;

  mutate();

  if (before) {
    const after = beamErrorVectorArcmin();
    const deltaAltDeg = -(after.y - before.y) / 60;
    const deltaAzDeg = -(after.x - before.x) / 60;
    if (
      Math.abs(deltaAltDeg) > FINDER_COUPLING_EPSILON_DEG ||
      Math.abs(deltaAzDeg) > FINDER_COUPLING_EPSILON_DEG
    ) {
      useTelescopeStore.getState().adjustFinderscope(deltaAltDeg, deltaAzDeg);
    }
  }

  useCollimationStore.getState().syncCollimationStatus();
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
        withFinderCoupling(() => {
          const current = mirror === 'primary' ? get().primaryScrews : get().secondaryScrews;
          const next: [number, number, number] = [current[0], current[1], current[2]];
          next[index] = current[index] + detents * SCREW_DETENT_TURNS;
          set(mirror === 'primary' ? { primaryScrews: next } : { secondaryScrews: next });
        });
      },

      resetMirror: (mirror) => {
        withFinderCoupling(() => {
          set(mirror === 'primary' ? { primaryScrews: ALIGNED } : { secondaryScrews: ALIGNED });
        });
      },

      scramble: (mirror) => {
        withFinderCoupling(() => {
          const profile = useTelescopeStore.getState().activeProfile;
          const cell = mirror === 'primary' ? profile?.collimation?.primary : profile?.collimation?.secondary;
          // Nothing to scramble (a sealed refractor, or an SCT's factory-set
          // primary). Bailing out INSIDE the wrapper rather than before it
          // keeps the coupling unconditional; the before/after samples are
          // then identical and the epsilon guard swallows the write.
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
        });
      },

      resetAll: () => {
        withFinderCoupling(() => {
          set({ primaryScrews: ALIGNED, secondaryScrews: ALIGNED });
        });
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
      // A rehydrated session must republish its verdict: useTelescopeStore
      // persists `isCollimated` separately, and the two snapshots are written
      // at different moments, so they can land out of step.
      //
      // Emphatically NOT withFinderCoupling (Phase 60). Rehydration is not a
      // screw turn — nobody touched the mirrors, and the finder error those
      // turns already caused is sitting in useTelescopeStore's own persisted
      // snapshot. Coupling here would re-apply the whole accumulated history
      // on every page load, doubling the misalignment each visit.
      onRehydrateStorage: () => (state) => {
        state?.syncCollimationStatus();
      },
    }
  )
);
