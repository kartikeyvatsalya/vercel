import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useTelescopeStore } from '../store/useTelescopeStore';
import { useAlignmentStore } from '../store/useAlignmentStore';
import { useProgressStore } from '../store/useProgressStore';
import { createPersistStorage, isRecord, sanitizeBoolean, sanitizeEnum, sanitizeNumber, sanitizeStringArray } from '../store/persistGuards';
import { missions, type MissionTelescopeView } from '../data/missions';
import { TARGETS } from '../data/bookContent';
import * as opticalMath from './opticalMath';
import { computeSkyOffsetDeg, angularSeparationDeg } from './skyGeometry';
import { getSmoothSimTime } from './timeEngine';
import type { InstructorResponse } from '../types';

export type MissionStepId =
  | 'dust_cap'
  | 'finderscope_spire'
  | 'dobsonian_saturn'
  | 'magnification_25mm'
  | 'astrophoto_planetary'
  | 'dso_tracking'
  | 'dso_stack'
  | 'dso_darks';

export interface MissionStep {
  id: MissionStepId;
  title: string;
  instruction: string;
  isComplete: boolean;
}

export interface MissionDefinition {
  id: string;
  name: string;
  steps: MissionStep[];
}

// ─────────────────────────────────────────────────────────────────────────────
// RANK CURRICULUM RUNTIME — "Skywatcher" / "Observer" missions (src/data/missions.ts)
//
// successCondition contract (see missions.ts header for full details): a
// typed predicate over MissionTelescopeView, re-invoked on every relevant
// state change. Phase 66 replaced the old `new Function` source strings — the
// conditions only ever came from this repository's own bundled data, so this
// was not a remote-code path, but strings bypassed the type checker entirely.
// ─────────────────────────────────────────────────────────────────────────────

/** Missions whose predicate has already thrown — warned about once, not on every state change. */
const warnedMissionIds = new Set<string>();

/** Runs a mission's success predicate; a throw counts as "not yet successful", never a crash. */
function isMissionSatisfied(missionId: string, view: MissionTelescopeView): boolean {
  const mission = missions.find((m) => m.id === missionId);
  if (!mission) return false;
  try {
    return mission.successCondition(view, opticalMath) === true;
  } catch (err) {
    if (!warnedMissionIds.has(missionId)) {
      warnedMissionIds.add(missionId);
      console.warn(`[missionEngine] successCondition threw for "${missionId}":`, err);
    }
    return false;
  }
}

// ─── Mission Definitions (Legacy Guided Workflows) ──────────────

const SATURN_RECON_STEPS: MissionStep[] = [
  {
    id: 'dust_cap',
    title: '1. Environmental Awareness',
    instruction: 'Verify the Dust Cap is OFF and wait for the primary mirror to cool down.',
    isComplete: false,
  },
  {
    id: 'finderscope_spire',
    title: '2. Terrestrial Alignment',
    instruction: 'Select the Spire target, open Finderscope Alignment, and center the crosshairs on the tower.',
    isComplete: false,
  },
  {
    id: 'dobsonian_saturn',
    title: '3. Inverted Tracking',
    instruction: 'Select Saturn, switch to the Inverted View Tracker, and hold Saturn in the center for 15 seconds.',
    isComplete: false,
  },
  {
    id: 'magnification_25mm',
    title: '4. Optical Balancing',
    instruction: 'With Saturn selected, equip the 25mm eyepiece using the Eyepiece selector in the footer.',
    isComplete: false,
  },
  {
    id: 'astrophoto_planetary',
    title: '5. Lucky Imaging Capture',
    instruction: 'Open Astrophotography (Planetary mode). Record video, set Stack Cutoff to ≤20%, and capture a B-grade or better Lucky Imaging stack of Saturn!',
    isComplete: false,
  }
];

const ORION_DSO_STEPS: MissionStep[] = [
  {
    id: 'dust_cap',
    title: '1. Prepare the Telescope',
    instruction: 'Remove the Dust Cap and wait for the mirror to thermally equilibrate.',
    isComplete: false,
  },
  {
    id: 'dso_tracking',
    title: '2. Enable Motorized Tracking',
    instruction: 'Select the Orion Nebula (M42) target. Open Astrophotography (Deep Sky mode) and turn on Mount Tracking Lock.',
    isComplete: false,
  },
  {
    id: 'dso_stack',
    title: '3. Capture Sub-Exposures',
    instruction: 'Set at least 10 sub-exposures with ≥30s integration each. Stack and verify SNR is above 15.',
    isComplete: false,
  },
  {
    id: 'dso_darks',
    title: '4. Dark Frame Calibration',
    instruction: 'Put the Dust Cap ON, capture Dark Frames, then Apply Calibration to remove thermal hot pixels. Capture a final graded image!',
    isComplete: false,
  }
];

function getMissionSteps(missionId: string): MissionStep[] {
  switch (missionId) {
    case 'saturn_recon': return SATURN_RECON_STEPS.map(s => ({ ...s }));
    case 'orion_dso': return ORION_DSO_STEPS.map(s => ({ ...s }));
    default: return SATURN_RECON_STEPS.map(s => ({ ...s }));
  }
}

export const AVAILABLE_MISSIONS: MissionDefinition[] = [
  { id: 'saturn_recon', name: 'The Saturn Reconnaissance', steps: SATURN_RECON_STEPS },
  { id: 'orion_dso', name: 'The Orion Deep-Sky Project', steps: ORION_DSO_STEPS },
];

interface MissionState {
  // ── Legacy Guided Workflow runtime ──
  isActive: boolean;
  activeMissionId: string | null;
  steps: MissionStep[];
  currentStepIndex: number;
  /**
   * Epoch-ms when the CURRENT step became active (Phase 66). Logbook-based
   * steps only accept an entry captured at or after this moment, so an old
   * capture — from a previous attempt, or a previous session — can no longer
   * complete a fresh attempt the instant it starts.
   */
  stepStartedAt: number;
  startMission: (id: string) => void;
  endMission: () => void;
  advanceStep: () => void;
  resetMission: () => void;

  // ── Rank Curriculum runtime ("Skywatcher" / "Observer") ──
  activeRankMissionId: string | null;
  rankMissionStatus: 'idle' | 'active' | 'success';
  completedTargetIds: string[];
  startRankMission: (id: string) => void;
  endRankMission: () => void;
}

type PersistedMissionState = Pick<
  MissionState,
  'isActive' | 'activeMissionId' | 'steps' | 'currentStepIndex' | 'stepStartedAt'
  | 'activeRankMissionId' | 'rankMissionStatus' | 'completedTargetIds'
>;

/**
 * GoTo lockout follows the mission lifecycle (Phase 59; tightened Phase 66):
 * only an ACTIVE star-hopping rank mission holds it. Starting a guided
 * workflow, abandoning, completing, or resuming a finished mission all hand
 * the slew back.
 */
function syncGoToLockout(rankMissionId: string | null, status: MissionState['rankMissionStatus']): void {
  const mission = rankMissionId ? missions.find((m) => m.id === rankMissionId) : undefined;
  useTelescopeStore.getState().setGoToSuppressed(status === 'active' && !!mission?.suppressGoTo);
}

export const useMissionStore = create<MissionState>()(
  persist(
    (set) => ({
      isActive: false,
      activeMissionId: null,
      steps: [],
      currentStepIndex: 0,
      stepStartedAt: 0,

      startMission: (id) => {
        set({
          isActive: true,
          activeMissionId: id,
          steps: getMissionSteps(id),
          currentStepIndex: 0,
          stepStartedAt: Date.now(),
          // Mutually exclusive with the rank curriculum runtime
          activeRankMissionId: null,
          rankMissionStatus: 'idle',
          completedTargetIds: [],
        });
        syncGoToLockout(null, 'idle');
      },

      endMission: () => set({ isActive: false, activeMissionId: null, steps: [], currentStepIndex: 0 }),

      advanceStep: () => set((state) => {
        const newSteps = state.steps.map((s, i) =>
          i === state.currentStepIndex ? { ...s, isComplete: true } : s
        );
        return {
          steps: newSteps,
          currentStepIndex: Math.min(state.currentStepIndex + 1, newSteps.length),
          stepStartedAt: Date.now(),
        };
      }),

      resetMission: () => set((state) => ({
        steps: state.activeMissionId ? getMissionSteps(state.activeMissionId) : [],
        currentStepIndex: 0,
        stepStartedAt: Date.now(),
      })),

      // ── Rank Curriculum runtime ──
      activeRankMissionId: null,
      rankMissionStatus: 'idle',
      completedTargetIds: [],

      startRankMission: (id) => {
        const mission = missions.find(m => m.id === id);
        if (!mission) return;
        set({
          // Mutually exclusive with the legacy guided workflow runtime
          isActive: false,
          activeMissionId: null,
          steps: [],
          currentStepIndex: 0,

          activeRankMissionId: id,
          rankMissionStatus: 'active',
          completedTargetIds: [],
        });
        // Phase 59: a star-hopping mission takes the GoTo away for its whole
        // duration. Owned here rather than in App.tsx so it can never get out
        // of step with the mission runtime.
        syncGoToLockout(id, 'active');
      },

      endRankMission: () => {
        set({
          activeRankMissionId: null,
          rankMissionStatus: 'idle',
          completedTargetIds: [],
        });
        // Always restore GoTo — the lockout belongs to the mission, not to the
        // telescope, and a student who abandons the hop must not be left with a
        // permanently dead slew.
        syncGoToLockout(null, 'idle');
      },
    }),
    {
      name: 'telescope-mission-storage',
      storage: createPersistStorage<PersistedMissionState>(),
      partialize: (state): PersistedMissionState => ({
        isActive: state.isActive,
        activeMissionId: state.activeMissionId,
        steps: state.steps,
        currentStepIndex: state.currentStepIndex,
        stepStartedAt: state.stepStartedAt,
        activeRankMissionId: state.activeRankMissionId,
        rankMissionStatus: state.rankMissionStatus,
        completedTargetIds: state.completedTargetIds,
      }),
      // ── Mission snapshot repair (Phase 66) ── Steps are rebuilt from the
      // live definitions (a saved copy carries stale titles/instructions and
      // could carry anything); only progress through them is restored. The
      // two runtimes stay mutually exclusive, and unknown mission ids reset
      // to idle rather than leaving a panel with nothing behind it.
      merge: (persistedState, currentState) => {
        const saved = isRecord(persistedState) ? persistedState : {};
        const activeMissionId = AVAILABLE_MISSIONS.some((m) => m.id === saved.activeMissionId)
          ? (saved.activeMissionId as string)
          : null;
        const isActive = sanitizeBoolean(saved.isActive, false) && activeMissionId !== null;
        const steps = isActive && activeMissionId ? getMissionSteps(activeMissionId) : [];
        const currentStepIndex = isActive
          ? Math.floor(sanitizeNumber(saved.currentStepIndex, 0, 0, steps.length))
          : 0;
        steps.forEach((s, i) => { s.isComplete = i < currentStepIndex; });

        let activeRankMissionId = missions.some((m) => m.id === saved.activeRankMissionId)
          ? (saved.activeRankMissionId as string)
          : null;
        if (isActive) activeRankMissionId = null;
        const rankMissionStatus = activeRankMissionId
          ? sanitizeEnum(saved.rankMissionStatus, ['active', 'success'] as const, 'active')
          : 'idle';
        return {
          ...currentState,
          isActive,
          activeMissionId: isActive ? activeMissionId : null,
          steps,
          currentStepIndex,
          // A snapshot from before Phase 66 has no step clock: start it now,
          // so evidence captured before the upgrade cannot complete the step.
          stepStartedAt: sanitizeNumber(saved.stepStartedAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
          activeRankMissionId,
          rankMissionStatus,
          completedTargetIds: activeRankMissionId
            ? sanitizeStringArray(saved.completedTargetIds, Object.keys(TARGETS))
            : [],
        };
      },
      onRehydrateStorage: () => (state) => {
        // isGoToSuppressed is deliberately NOT persisted (a reopened app must
        // never start with a mysteriously dead GoTo), so a resumed, still
        // ACTIVE star-hopping mission re-asserts it here — and a finished one
        // does not.
        if (state) syncGoToLockout(state.activeRankMissionId, state.rankMissionStatus);
      }
    }
  )
);

/**
 * Evaluates the active Rank Curriculum mission's successCondition against the
 * live telescope state. Called inside the same useEffect as the legacy
 * evaluateMissionProgress in App.tsx.
 *
 * The curriculum's successCondition strings reference `telescope.activeProfile.
 * apertureMm` / `focalLengthMm`, while the live store exposes `aperture` /
 * `focalLength`. We bridge that here via a light adapter rather than renaming
 * the store's fields app-wide.
 */
export function evaluateRankMissionProgress(): InstructorResponse | null {
  const state = useMissionStore.getState();
  if (state.rankMissionStatus !== 'active' || !state.activeRankMissionId) {
    return null;
  }

  const missionDef = missions.find(m => m.id === state.activeRankMissionId);
  if (!missionDef) return null;

  const telescopeState = useTelescopeStore.getState();
  if (!telescopeState.activeProfile || !telescopeState.activeTarget) return null;

  // Phase 59: `targetOffsetDeg` — how far the mount is from the thing it is
  // locked onto. Derived rather than stored (the mount pointing and the
  // target's ephemeris are both already live), and exposed on the adapter
  // because a navigation mission's whole success criterion IS that number.
  // Phase 66: measured as a true angle on the sky against the live clock —
  // hypot(dAlt, dAz) overstated it near the zenith, where a large azimuth
  // difference is a small distance, and the ~1 Hz mirror lagged the view.
  const now = getSmoothSimTime();
  const targetSkyOffset = computeSkyOffsetDeg(
    telescopeState.activeTarget,
    telescopeState.pointingAlt,
    telescopeState.pointingAz,
    telescopeState.observerLocation.latitude,
    telescopeState.observerLocation.longitude,
    now
  );

  const telescopeAdapter: MissionTelescopeView = {
    activeTarget: telescopeState.activeTarget,
    activeProfile: {
      ...telescopeState.activeProfile,
      apertureMm: telescopeState.activeProfile.aperture,
      focalLengthMm: telescopeState.activeProfile.focalLength,
    },
    activeEyepieceId: telescopeState.activeEyepieceId,
    eyepieceFocalLength: telescopeState.eyepieceFocalLength,
    isBarlowActive: telescopeState.isBarlowActive,
    isDustCapOn: telescopeState.isDustCapOn,
    isMirrorCooled: telescopeState.isMirrorCooled,
    isCollimated: telescopeState.isCollimated,
    isMechanicallyBalanced: telescopeState.isMechanicallyBalanced,
    focuserPosition: telescopeState.focuserPosition,
    seeingQuality: telescopeState.seeingQuality,
    isGoToSuppressed: telescopeState.isGoToSuppressed,
    targetOffsetDeg: targetSkyOffset
      ? angularSeparationDeg(
          telescopeState.pointingAlt,
          telescopeState.pointingAz,
          telescopeState.pointingAlt + targetSkyOffset.dAlt,
          telescopeState.pointingAz + targetSkyOffset.dAz
        )
      : null,
  };

  if (!isMissionSatisfied(missionDef.id, telescopeAdapter)) return null;

  const currentTargetId = telescopeState.activeTarget?.id;
  const isMultiTargetCapstone = missionDef.id === 'rank2_capstone_right_tool';

  if (isMultiTargetCapstone) {
    if (!currentTargetId) return null;
    if (state.completedTargetIds.includes(currentTargetId)) return null; // Already logged this target

    const nextCompleted = [...state.completedTargetIds, currentTargetId];
    useMissionStore.setState({ completedTargetIds: nextCompleted });

    if (nextCompleted.length >= 3) {
      useProgressStore.getState().unlockAchievement(missionDef.id);
      useMissionStore.setState({ rankMissionStatus: 'success' });
      syncGoToLockout(missionDef.id, 'success');
      return {
        title: `Capstone Complete: ${missionDef.title}`,
        severity: 'success',
        message: {
          id: `${missionDef.id}-complete`,
          text: 'All three targets configured with disciplined judgment. You have earned Rank II: Observer.',
          emotion: 'celebratory',
          priority: 10,
        },
      };
    }

    return {
      title: `Target Configured: ${currentTargetId.toUpperCase()}`,
      severity: 'success',
      message: {
        id: `${missionDef.id}-partial-${currentTargetId}`,
        text: `Good judgment on ${currentTargetId}. ${nextCompleted.length}/3 targets configured. Log your justification, then move to the next target.`,
        emotion: 'encouraging',
        priority: 8,
      },
    };
  }

  // Single-target missions succeed on their first valid evaluation — and a
  // completed star-hop hands the GoTo back straight away.
  useProgressStore.getState().unlockAchievement(missionDef.id);
  useMissionStore.setState({ rankMissionStatus: 'success', completedTargetIds: [missionDef.targetId] });
  syncGoToLockout(missionDef.id, 'success');
  return {
    title: `Mission Complete: ${missionDef.title}`,
    severity: 'success',
    message: {
      id: `${missionDef.id}-complete`,
      text: `Well done, Observer. "${missionDef.title}" is complete.`,
      emotion: 'celebratory',
      priority: 10,
    },
  };
}

/**
 * Evaluates the current legacy mission step based on global states.
 * Called inside a useEffect in App.tsx whenever global state changes.
 */
export function evaluateMissionProgress(activeModule: string): InstructorResponse | null {
  const mission = useMissionStore.getState();
  const telescope = useTelescopeStore.getState();
  const alignment = useAlignmentStore.getState();
  const progress = useProgressStore.getState();

  if (!mission.isActive || mission.currentStepIndex >= mission.steps.length) {
    return null;
  }

  const currentStep = mission.steps[mission.currentStepIndex];
  // Evidence rule (Phase 66): a logbook-graded step accepts only a capture
  // made while THIS step was the active one. Strictly after its start: the
  // capture that completed the previous step is timestamped before (or in
  // the same millisecond as) the advance, and must not count twice.
  const lastEntry = progress.logbookEntries[0];
  const freshEntry = lastEntry && lastEntry.timestamp > mission.stepStartedAt ? lastEntry : undefined;

  switch (currentStep.id) {
    // ── Shared Steps ──
    case 'dust_cap':
      if (!telescope.isDustCapOn && telescope.isMirrorCooled) {
        mission.advanceStep();
        return {
          title: 'Mission Update',
          severity: 'success',
          message: { id: 'mission-dust', text: 'Excellent! The telescope is uncovered and thermally acclimated. Proceed to the next step.', emotion: 'encouraging', priority: 10 },
        };
      }
      break;

    case 'finderscope_spire':
      if (activeModule === 'finderscope' && telescope.activeTarget?.id === 'spire' && alignment.isAligned) {
        mission.advanceStep();
        return {
          title: 'Mission Update',
          severity: 'success',
          message: { id: 'mission-finder', text: 'Alignment verified. The finderscope is perfectly parallel to the main optical tube.', emotion: 'encouraging', priority: 10 },
        };
      }
      break;

    case 'dobsonian_saturn':
      if (progress.completedModules.includes('dobsonian_trainer')) {
        mission.advanceStep();
        return {
          title: 'Mission Update',
          severity: 'success',
          message: { id: 'mission-dob', text: 'You have mastered the inverted view! Tracking Saturn is now second nature.', emotion: 'encouraging', priority: 10 },
        };
      }
      break;

    case 'magnification_25mm':
      // Phase 29: the Magnification Sandbox tab is retired — the eyepiece
      // selector is global (footer), so this step passes from ANY module.
      if (telescope.activeTarget?.id === 'saturn' && telescope.eyepieceFocalLength === 25) {
        mission.advanceStep();
        return {
          title: 'Mission Update',
          severity: 'success',
          message: { id: 'mission-mag', text: 'Perfect choice. The 25mm provides the ideal balance of magnification and field of view for Saturn.', emotion: 'encouraging', priority: 10 },
        };
      }
      break;

    // ── Saturn Recon: Planetary Lucky Imaging ──
    case 'astrophoto_planetary': {
      if (
        freshEntry &&
        freshEntry.targetId === 'saturn' &&
        freshEntry.tags.includes('Lucky ≤20%') &&
        freshEntry.tags.some(t => t.includes('Grade: A') || t.includes('Grade: B'))
      ) {
        mission.advanceStep();
        progress.unlockAchievement('master_astronomer');
        return {
          title: 'Mission Complete: Saturn Reconnaissance!',
          severity: 'success',
          message: { id: 'mission-saturn-done', text: 'Mission Accomplished! Your Lucky Imaging stack revealed Saturn\'s Cassini Division. You have earned the Master Astronomer badge!', emotion: 'celebratory', priority: 10 },
        };
      }
      break;
    }

    // ── Orion DSO: Tracking ──
    case 'dso_tracking': {
      // The step is literally "Enable Motorized Tracking": it now requires the
      // Deep Sky desk's Mount Tracking Lock (Phase 66 — the lock used to live
      // in LiveViewPanel's local state, invisible here, so the step advanced
      // on module + target alone).
      if (activeModule === 'astrophotography' && telescope.activeTarget?.id === 'm42' && telescope.isAstroTrackingLocked) {
        mission.advanceStep();
        return {
          title: 'Mission Update',
          severity: 'success',
          message: { id: 'mission-dso-track', text: 'Orion Nebula acquired. Ensure Mount Tracking is LOCKED before capturing sub-exposures!', emotion: 'encouraging', priority: 10 },
        };
      }
      break;
    }

    // ── Orion DSO: Stack Sub-Exposures ──
    case 'dso_stack': {
      if (
        freshEntry &&
        freshEntry.targetId === 'm42' &&
        freshEntry.tags.includes('DSO Stack') &&
        !freshEntry.tags.includes('Star Trailed')
      ) {
        mission.advanceStep();
        return {
          title: 'Mission Update',
          severity: 'success',
          message: { id: 'mission-dso-stack', text: 'Sub-exposures stacked successfully! But notice those bright colored specks? Those are hot pixels. Time for calibration...', emotion: 'encouraging', priority: 10 },
        };
      }
      break;
    }

    // ── Orion DSO: Dark Frame Calibration ──
    case 'dso_darks': {
      if (
        freshEntry &&
        freshEntry.targetId === 'm42' &&
        freshEntry.tags.includes('Dark Calibrated') &&
        freshEntry.tags.some(t => t.includes('Grade: A') || t.includes('Grade: B'))
      ) {
        mission.advanceStep();
        progress.unlockAchievement('deep_sky_astrophotographer');
        return {
          title: 'Mission Complete: The Orion Deep-Sky Project!',
          severity: 'success',
          message: { id: 'mission-orion-done', text: 'Outstanding work! You successfully captured, stacked, and calibrated the Orion Nebula. Dark frame subtraction removed those pesky hot pixels. You have earned the Deep Sky Astrophotographer badge!', emotion: 'celebratory', priority: 10 },
        };
      }
      break;
    }
  }

  return null;
}
