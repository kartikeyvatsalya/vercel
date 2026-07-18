import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useTelescopeStore } from '../store/useTelescopeStore';
import { useAlignmentStore } from '../store/useAlignmentStore';
import { useProgressStore } from '../store/useProgressStore';
import { missions } from '../data/missions';
import type { RankMission } from '../data/missions';
import * as opticalMath from './opticalMath';
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
// successCondition contract (see missions.ts header for full details):
//   Compiled ONCE via `new Function('telescope', 'math', body)` when the mission
//   starts, then re-invoked on every relevant state change. Must return boolean.
// ─────────────────────────────────────────────────────────────────────────────

type SuccessEvaluator = (telescope: any, math: typeof opticalMath) => boolean;

/**
 * Compiles a RankMission's successCondition string into a safe, memoized
 * evaluator function. Any runtime error inside the student-observable
 * condition body (or a malformed condition string itself) is swallowed and
 * treated as "not yet successful" rather than crashing the app.
 */
function compileSuccessCondition(mission: RankMission): SuccessEvaluator {
  try {
    // eslint-disable-next-line no-new-func -- documented sandboxed evaluator, see missions.ts contract
    const fn = new Function('telescope', 'math', mission.successCondition) as SuccessEvaluator;
    return (telescope, math) => {
      try {
        return !!fn(telescope, math);
      } catch (err) {
        console.warn(`[missionEngine] successCondition threw for "${mission.id}":`, err);
        return false;
      }
    };
  } catch (err) {
    console.warn(`[missionEngine] Failed to compile successCondition for "${mission.id}":`, err);
    return () => false;
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
  startMission: (id: string) => void;
  endMission: () => void;
  advanceStep: () => void;
  resetMission: () => void;

  // ── Rank Curriculum runtime ("Skywatcher" / "Observer") ──
  activeRankMissionId: string | null;
  rankMissionStatus: 'idle' | 'active' | 'success';
  completedTargetIds: string[];
  compiledSuccessFn: SuccessEvaluator | null;
  startRankMission: (id: string) => void;
  endRankMission: () => void;
}

export const useMissionStore = create<MissionState>()(
  persist(
    (set) => ({
      isActive: false,
      activeMissionId: null,
      steps: [],
      currentStepIndex: 0,

      startMission: (id) => set({
        isActive: true,
        activeMissionId: id,
        steps: getMissionSteps(id),
        currentStepIndex: 0,
        // Mutually exclusive with the rank curriculum runtime
        activeRankMissionId: null,
        rankMissionStatus: 'idle',
        completedTargetIds: [],
        compiledSuccessFn: null,
      }),

      endMission: () => set({ isActive: false, activeMissionId: null, steps: [], currentStepIndex: 0 }),

      advanceStep: () => set((state) => {
        const newSteps = state.steps.map((s, i) =>
          i === state.currentStepIndex ? { ...s, isComplete: true } : s
        );
        return {
          steps: newSteps,
          currentStepIndex: Math.min(state.currentStepIndex + 1, newSteps.length),
        };
      }),

      resetMission: () => set((state) => ({
        steps: state.activeMissionId ? getMissionSteps(state.activeMissionId) : [],
        currentStepIndex: 0,
      })),

      // ── Rank Curriculum runtime ──
      activeRankMissionId: null,
      rankMissionStatus: 'idle',
      completedTargetIds: [],
      compiledSuccessFn: null,

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
          compiledSuccessFn: compileSuccessCondition(mission),
        });
      },

      endRankMission: () => set({
        activeRankMissionId: null,
        rankMissionStatus: 'idle',
        completedTargetIds: [],
        compiledSuccessFn: null,
      }),
    }),
    {
      name: 'telescope-mission-storage',
      partialize: (state) => {
        const { compiledSuccessFn, ...rest } = state;
        return rest as MissionState;
      },
      onRehydrateStorage: () => (state) => {
        if (state && state.activeRankMissionId) {
          const mission = missions.find(m => m.id === state.activeRankMissionId);
          if (mission) {
            state.compiledSuccessFn = compileSuccessCondition(mission);
          }
        }
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
  if (state.rankMissionStatus !== 'active' || !state.activeRankMissionId || !state.compiledSuccessFn) {
    return null;
  }

  const missionDef = missions.find(m => m.id === state.activeRankMissionId);
  if (!missionDef) return null;

  const telescopeState = useTelescopeStore.getState();
  if (!telescopeState.activeProfile || !telescopeState.activeTarget) return null;

  const telescopeAdapter = {
    ...telescopeState,
    activeProfile: {
      ...telescopeState.activeProfile,
      apertureMm: telescopeState.activeProfile.aperture,
      focalLengthMm: telescopeState.activeProfile.focalLength,
    },
  };

  const success = state.compiledSuccessFn(telescopeAdapter, opticalMath);
  if (!success) return null;

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

  // Single-target missions succeed on their first valid evaluation.
  useProgressStore.getState().unlockAchievement(missionDef.id);
  useMissionStore.setState({ rankMissionStatus: 'success', completedTargetIds: [missionDef.targetId] });
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
      const lastEntry = progress.logbookEntries[0];
      if (
        lastEntry &&
        lastEntry.targetId === 'saturn' &&
        lastEntry.tags.includes('Lucky ≤20%') &&
        lastEntry.tags.some(t => t.includes('Grade: A') || t.includes('Grade: B'))
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
      // Check if user is in astrophotography module with M42 selected and tracking locked
      // We read the latest logbook entry or just check current state
      if (activeModule === 'astrophotography' && telescope.activeTarget?.id === 'm42') {
        // We can't directly read the component state, so we check for a logbook entry indicating tracking was used
        // For now, advance if they're on the right module with the right target
        // The actual tracking check happens in the next step via logbook tags
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
      const lastEntry = progress.logbookEntries[0];
      if (
        lastEntry &&
        lastEntry.targetId === 'm42' &&
        lastEntry.tags.includes('DSO Stack') &&
        !lastEntry.tags.includes('Star Trailed')
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
      const lastEntry = progress.logbookEntries[0];
      if (
        lastEntry &&
        lastEntry.targetId === 'm42' &&
        lastEntry.tags.includes('Dark Calibrated') &&
        lastEntry.tags.some(t => t.includes('Grade: A') || t.includes('Grade: B'))
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
