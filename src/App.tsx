import React, { useEffect, useRef, useState } from 'react';
import { useTelescopeStore, TERRESTRIAL_POINTING } from './store/useTelescopeStore';
import { TARGETS } from './data/bookContent';
import { convertEquatorialToHorizontal } from './engine/ephemerisMath';
import type { Target, ModuleId } from './types';
import { SIM_MODE_RULES, type SimulationMode } from './engine/simulationModes';
import { useTranslation, type TranslationKey } from './engine/i18n';
import { useProgressStore } from './store/useProgressStore';
import { evaluateState } from './engine/rulesEngine';
import { getMagnification, getPerfectFocusPoint, getTrueFOV, EYEPIECE_CATALOG, DEFAULT_EYEPIECE_ID } from './engine/opticalMath';
import { useMissionStore, evaluateMissionProgress, evaluateRankMissionProgress, AVAILABLE_MISSIONS } from './engine/missionEngine';
import { missions as RANK_MISSIONS } from './data/missions';
import { evaluateLessonCompletion, type Lesson } from './engine/curriculum';
import { preloadAssets } from './engine/assetLoader';
import { warmGlyphCaches } from './engine/targetGlyphs';


import { TelemetryPanel } from './components/layout/TelemetryPanel';
import { InstructorVoiceBox } from './components/layout/InstructorVoiceBox';
import { DebugPanel } from './components/ui/DebugPanel';
// FinderscopeGame, DobsonianTrainer, MagnificationSandbox, and
// AstroPhotoTrainer are intentionally NOT imported here — Phase 27 (Grand
// Unification) replaced all four with LiveViewPanel modes, and Phase 29
// retired the Magnification Sandbox tab outright (the eyepiece selector is
// global, so a dedicated sandbox tab taught nothing the other lenses don't).
import { LiveViewPanel } from './components/liveview/LiveViewPanel';
import { InstructorDashboard } from './components/ui/InstructorDashboard';
import { CustomTelescopeModal } from './components/ui/CustomTelescopeModal';
import { FieldLogbookModal } from './components/ui/FieldLogbookModal';
import { SettingsModal } from './components/ui/SettingsModal';
import { OnboardingTour } from './components/ui/OnboardingTour';
import { TextbookPanel } from './components/ui/TextbookPanel';
import { ObservatoryScene } from './components/canvas/ObservatoryScene';


import {
  Crosshair, Move, BookOpen, Camera, Rocket, CheckCircle2, ChevronDown, Info, X, Telescope, Settings,
  GraduationCap, Circle, NotebookPen, Columns2, Sparkles, FlaskConical, HelpCircle, BookMarked

} from 'lucide-react';


/** Tri-View Workspace: pure 2D, pure 3D, or an adjustable side-by-side split. */
type ViewMode = 'eyepiece' | 'observatory' | 'split';

const MODULE_META: { id: ModuleId; label: string; icon: React.ReactNode; description: string }[] = [
  {
    id: 'finderscope',
    label: 'Finderscope Alignment',
    icon: <Crosshair className="w-4 h-4" />,
    description: 'Align the finderscope crosshairs to the main eyepiece.',
  },
  {
    id: 'dobsonian',
    label: 'Inverted View Tracker',
    icon: <Move className="w-4 h-4" />,
    description: 'Master the counter-intuitive push of a reflecting telescope.',
  },
  {
    id: 'astrophotography',
    label: 'Astrophotography',
    icon: <Camera className="w-4 h-4" />,
    description: 'Capture deep-sky images with Lucky Imaging or DSO Stacking.',
  },
];

// Translated module labels (Phase 28) — kept separate from MODULE_META.label
// (English, used verbatim by the About modal) so the footer tab bar / active-
// module caption can show the localized name without touching that modal.
const MODULE_LABEL_KEYS: Record<ModuleId, TranslationKey> = {
  finderscope: 'footer.moduleFinderscope',
  dobsonian: 'footer.moduleDobsonian',
  astrophotography: 'footer.moduleAstrophotography',
};

// Dropup display order for the target selector
const TARGET_MENU_ORDER = ['moon', 'saturn', 'jupiter', 'm42', 'sun', 'spire'];

// ─── Field Note Modal ("failure is data") ───────────────────────
// Shown when a student abandons an active Rank Curriculum mission.
// Converts the abandonment into a genuine Field Logbook entry rather
// than a dead end, per the curriculum's design invariants.
const FieldNoteModal: React.FC<{
  prompt: string;
  missionTitle: string;
  targetId: string;
  onSubmit: (note: string) => void;
  onSkip: () => void;
}> = ({ prompt, missionTitle, targetId, onSubmit, onSkip }) => {
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-amber-700/50 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-amber-950/60 to-slate-900 p-4 border-b border-amber-800/40 flex items-center gap-3">
          <div className="bg-amber-500/20 border border-amber-500/40 p-2 rounded-xl">
            <NotebookPen className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-amber-300 leading-none">Field Logbook Entry</h2>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mt-0.5">{missionTitle}</p>
          </div>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <p className="text-slate-300 text-sm leading-relaxed italic">{prompt}</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="One honest sentence is enough..."
            rows={3}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          />
        </div>
        <div className="px-5 pb-5 flex gap-2">
          <button
            onClick={onSkip}
            className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 font-bold uppercase tracking-widest text-[10px] transition-colors"
          >
            Skip
          </button>
          <button
            onClick={() => onSubmit(note)}
            className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold uppercase tracking-widest text-[10px] transition-colors"
          >
            Log It ({targetId})
          </button>
        </div>
      </div>
    </div>
  );
};


// ─── Active 2D Module (shared by Eyepiece + Split layouts) ──────
// Renders the selected optical module. A dropped target lock (manual slew,
// activeTarget === null) does NOT blank the feeds — a real eyepiece keeps
// showing the sky while you push the tube, so LiveViewPanel renders the
// live starfield at the mount's current pointing regardless (Phase 32).
const ActiveModuleView: React.FC<{ activeModule: ModuleId }> = ({ activeModule }) => {
  // All module tabs are lenses on the SAME LiveViewPanel instance —
  // rendered at this ONE JSX position so React reconciles rather than
  // remounts on tab switches (preserves the track-mode lock timer, the
  // astrophotography capture settings, etc. across a quick peek at another
  // lesson).
  const liveViewMode =
    activeModule === 'dobsonian' ? 'track'
    : activeModule === 'astrophotography' ? 'astrophotography'
    : 'align';
  return <LiveViewPanel mode={liveViewMode} />;
};

// ─── About Modal ───────────────────────────────────────────────
const AboutModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
    <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-5 border-b border-slate-700 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500/20 border border-cyan-500/40 p-2.5 rounded-xl">
            <Telescope className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              Telescope Trainer
            </h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">v0.7.0 — Interactive Astronomy Simulator</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="p-6 flex flex-col gap-5">
        <p className="text-slate-300 leading-relaxed">
          <strong className="text-white">Telescope Trainer</strong> is an interactive astronomical simulator designed to teach the optical and mechanical physics of observational astronomy. It simulates three professional workflows — Finderscope Alignment, Dobsonian Inverted-View Tracking, and Astrophotography — grounded in real physics equations, over a live digital twin of the night sky.
        </p>

        {/* Origin Credit Block */}
        <div className="bg-gradient-to-br from-indigo-950/60 to-slate-900/60 border border-indigo-500/40 rounded-xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-3">Origin & Credits</p>
          <p className="text-slate-200 leading-relaxed mb-4">
            Originally built for{' '}
            <strong className="text-white text-base">Vatsalya</strong>
            {' '}— an astronomy education initiative that makes observational science accessible to students in India.
          </p>
          <a
            href="https://www.vatsalya.org"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold uppercase tracking-widest text-xs transition-colors shadow-lg"
          >
            🔭 Visit www.vatsalya.org
          </a>
          <p className="text-slate-400 text-sm mt-4">
            Designed and developed by <strong className="text-slate-200">Kartikey Gupta</strong>.
          </p>
        </div>

        {/* Modules List */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Simulation Modules</p>
          <ul className="flex flex-col gap-1.5 text-sm text-slate-300">
            {MODULE_META.map(m => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="text-cyan-400">{m.icon}</span>
                <strong className="text-white">{m.label}</strong> — {m.description}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="px-6 pb-5">
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-bold uppercase tracking-widest text-xs transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  </div>
);

// ─── App ───────────────────────────────────────────────────────
function App() {
  const telescopeState = useTelescopeStore();
  const progressState = useProgressStore();
  const missionState = useMissionStore();
  const modeRules = SIM_MODE_RULES[telescopeState.simulationMode];
  const activeEyepieceForFooter = EYEPIECE_CATALOG.find((e) => e.id === telescopeState.activeEyepieceId)
    ?? EYEPIECE_CATALOG.find((e) => e.id === DEFAULT_EYEPIECE_ID)!;
  const { t, language } = useTranslation();

  const [instructorResponse, setInstructorResponse] = useState(null);
  const [activeModule, setActiveModule] = useState<ModuleId>('finderscope');
  const [isFieldLogbookOpen, setIsFieldLogbookOpen] = useState(false);

  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isMissionMenuOpen, setIsMissionMenuOpen] = useState(false);
  const [isTargetMenuOpen, setIsTargetMenuOpen] = useState(false);
  const [isEyepieceMenuOpen, setIsEyepieceMenuOpen] = useState(false);
  const missionMenuRef = useRef<HTMLDivElement | null>(null);
  const targetMenuRef = useRef<HTMLDivElement | null>(null);
  const eyepieceMenuRef = useRef<HTMLDivElement | null>(null);
  const [isInstructorMode, setIsInstructorMode] = useState(false);
  const [isCustomScopeModalOpen, setIsCustomScopeModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isTextbookOpen, setIsTextbookOpen] = useState(false);

  // ── Tri-View Workspace Manager ──
  // 'eyepiece' = pure 2D (3D canvas unmounted to save GPU/CPU),
  // 'observatory' = pure fullscreen 3D, 'split' = adjustable side-by-side.
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [eyepiecePanelPct, setEyepiecePanelPct] = useState(42); // split-mode eyepiece width, 30–70%
  const [isDividerDragging, setIsDividerDragging] = useState(false);
  const mainRowRef = useRef<HTMLElement | null>(null);

  // ── Rank Curriculum ("Skywatcher"/"Observer") UI state ──
  const [rankMissionTab, setRankMissionTab] = useState<'I' | 'II'>('I');
  const [showFieldNoteModal, setShowFieldNoteModal] = useState(false);


  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [assetLoadMessage, setAssetLoadMessage] = useState('Loading optical assets...');

  const [showHighPerfToast, setShowHighPerfToast] = useState(false);

  // ── Slew-to-Target Toast — connects a footer target switch to the 3D mount's physical movement ──
  const [slewToast, setSlewToast] = useState<string | null>(null);
  const slewToastTimeoutRef = useRef<number | null>(null);

  // ── First-visit tour prompt (Phase 33) ── One-shot floating nudge toward
  // the Start Tour button for brand-new users. `tourPrompted` is marked the
  // moment the toast shows (and by startTour itself), so returning students
  // are never nagged again — localStorage, deliberately outside the Zustand
  // persist partition, since it must survive store resets.
  const [showTourPrompt, setShowTourPrompt] = useState(false);
  const startTourBtnRef = useRef<HTMLButtonElement | null>(null);

  // ── Preload + WARM high-res textures on mount (Phase 29) ──
  // preloadAssets decodes and downsamples every texture behind this loading
  // screen (the 18000px Orion mosaic becomes a 1024px canvas), and
  // warmGlyphCaches pre-bakes the M42 filter composite — so the first
  // switch to M42 never pays a decode/composite hitch mid-frame.
  useEffect(() => {
    setAssetLoadMessage('Loading optical assets...');
    preloadAssets()
      .then((assets) => {
        setAssetLoadMessage('Warming render caches...');
        warmGlyphCaches(assets);
        useTelescopeStore.getState().setLoadedAssets(assets);
        setAssetsLoaded(true);
      })
      .catch(() => {
        // Even on total failure, let the app through — procedural fallback
        setAssetsLoaded(true);
      });
  }, []);

  // ── First-visit tour prompt trigger (Phase 33) ── After the loading
  // screen clears, users who have never seen (or been offered) the tour get
  // one brief, dismissible nudge. Auto-hides so it stays non-intrusive.
  useEffect(() => {
    if (!assetsLoaded) return;
    let hideId: number | undefined;
    let alreadyPrompted = false;
    try {
      alreadyPrompted = !!localStorage.getItem('tourPrompted');
    } catch { /* storage blocked (private mode) — treat as prompted */ alreadyPrompted = true; }
    if (alreadyPrompted) return;

    const showId = window.setTimeout(() => {
      // Re-check at fire time: the user may have hit Start Tour themselves
      // during the delay (which writes the key) — don't nudge them after.
      try { if (localStorage.getItem('tourPrompted')) return; } catch { return; }
      setShowTourPrompt(true);
      try { localStorage.setItem('tourPrompted', '1'); } catch { /* best effort */ }
      hideId = window.setTimeout(() => setShowTourPrompt(false), 15000);
    }, 1500);
    return () => {
      window.clearTimeout(showId);
      if (hideId !== undefined) window.clearTimeout(hideId);
    };
  }, [assetsLoaded]);

  // Performance (FPS) Tracker — with 5-second startup grace period
  useEffect(() => {
    if (telescopeState.isLowPerformanceDevice) return;

    const GRACE_PERIOD_MS = 5000;
    const startTime = performance.now();

    let frameCount = 0;
    let lastTime = performance.now();
    let lowFpsStartTime = 0;
    let animId: number;

    const measureFPS = () => {
      const now = performance.now();

      // Skip measurements during initial grace period OR when tab is hidden
      if (document.hidden || now - startTime < GRACE_PERIOD_MS) {
        lastTime = now;
        frameCount = 0;
        lowFpsStartTime = 0;
        animId = requestAnimationFrame(measureFPS);
        return;
      }

      frameCount++;

      // Evaluate every 1 second
      if (now - lastTime >= 1000) {
        const fps = frameCount / ((now - lastTime) / 1000);
        frameCount = 0;
        lastTime = now;

        if (fps < 30) {
          if (lowFpsStartTime === 0) lowFpsStartTime = now;
          else if (now - lowFpsStartTime >= 3000) {
            // Show advisory toast — do NOT force any setting changes
            useTelescopeStore.getState().setLowPerformanceDevice(true);
            return; // Stop measuring
          }
        } else {
          lowFpsStartTime = 0; // Reset streak
        }
      }
      animId = requestAnimationFrame(measureFPS);
    };

    animId = requestAnimationFrame(measureFPS);
    return () => cancelAnimationFrame(animId);
  }, [telescopeState.isLowPerformanceDevice]);

  // ── Simulation clock driver (Phase 25, rebuilt in Phase 29) ──
  // The continuous clock itself lives in engine/timeEngine (anchored to
  // performance.now(), so it flows smoothly and keeps counting in hidden
  // tabs). This interval merely SAMPLES it into the store ~1×/sec so React
  // UI (telemetry clock, horizon badges, motor pointing) updates at a sane
  // cadence — canvas/3D render loops read getSmoothSimTime() every frame
  // for judder-free drift.
  useEffect(() => {
    const id = window.setInterval(() => {
      useTelescopeStore.getState().syncSimTime();
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  // Keep the document's declared language in sync (Phase 28) — screen
  // readers and font/spell-check heuristics key off this, not just the
  // visible UI text.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // ── Menu dismissal: outside-click + Escape (Phase 26 fix 4d) ──
  useEffect(() => {
    if (!isMissionMenuOpen && !isTargetMenuOpen && !isEyepieceMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      // e.target can be the window itself (synthetic events) — only Nodes
      // can be containment-tested; anything else counts as "outside".
      const t = e.target instanceof Node ? e.target : null;
      if (t && (missionMenuRef.current?.contains(t) || targetMenuRef.current?.contains(t) || eyepieceMenuRef.current?.contains(t))) return;
      setIsMissionMenuOpen(false);
      setIsTargetMenuOpen(false);
      setIsEyepieceMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMissionMenuOpen(false);
        setIsTargetMenuOpen(false);
        setIsEyepieceMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMissionMenuOpen, isTargetMenuOpen, isEyepieceMenuOpen]);

  // Global Keyboard Listener for Instructor Dashboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        setIsInstructorMode(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // General Rules Evaluation & Mission Engine Integration
  useEffect(() => {
    if (!telescopeState || !telescopeState.activeProfile || !telescopeState.activeTarget) return;

    // 0. Curriculum: mark any lesson complete whose mission/module hook just fired
    evaluateLessonCompletion();

    // 1. Evaluate Legacy Guided-Workflow Mission (if active)
    const missionUpdate = evaluateMissionProgress(activeModule);
    if (missionUpdate) {
      setInstructorResponse(missionUpdate as any);
      return;
    }

    // 1b. Evaluate Rank Curriculum Mission (if active) — "Skywatcher"/"Observer"
    const rankMissionUpdate = evaluateRankMissionProgress();
    if (rankMissionUpdate) {
      setInstructorResponse(rankMissionUpdate as any);
      return;
    }

    // 2. Evaluate General Telescope State Rules

    const magnification = getMagnification(telescopeState.activeProfile.focalLength, telescopeState.eyepieceFocalLength);
    const evalResult = evaluateState({
      isDustCapOn: telescopeState.isDustCapOn,
      isSolarFilterAttached: telescopeState.isSolarFilterAttached,
      targetId: telescopeState.activeTarget.id,
      magnification,
      seeingQuality: telescopeState.seeingQuality,
      isAltTensionLocked: telescopeState.isAltTensionLocked,
      isMechanicallyBalanced: telescopeState.isMechanicallyBalanced,
      isCollimated: telescopeState.isCollimated,
      isMirrorCooled: telescopeState.isMirrorCooled,
      focuserPosition: telescopeState.focuserPosition,
      eyepieceFocalLength: telescopeState.eyepieceFocalLength,
      isBarlowActive: telescopeState.isBarlowActive,
                focusToleranceUnits: modeRules.focusToleranceUnits,
                enforceAtmosphericLimit: modeRules.atmosphericLimitEnforced
    });

    setInstructorResponse(evalResult.instructorResponse as any);
  }, [telescopeState, activeModule, missionState.currentStepIndex, progressState.logbookEntries.length]);

  // Initial welcome message
  useEffect(() => {
    if (!instructorResponse) {
      setInstructorResponse({
        title: 'Telescope Trainer',
        severity: 'info',
        message: {
          id: 'welcome',
          text: "Welcome, young sky-watcher! I'm here to guide you. Remember, an astronomer doesn't need to be a genius—only curious and patient.",
          emotion: 'encouraging',
          priority: 5,
        }
      } as any);
    }
  }, []);

  const handleModuleSwitch = (moduleId: ModuleId) => {
    if (moduleId === activeModule) return;
    setActiveModule(moduleId);
  };

  const startMission = (missionId: string) => {
    const missionDef = AVAILABLE_MISSIONS.find(m => m.id === missionId);
    missionState.startMission(missionId);
    setIsMissionMenuOpen(false);
    setInstructorResponse({
      title: `Mission Started: ${missionDef?.name || 'Observing Mission'}`,
      severity: 'warning',
      message: {
        id: 'mission-start',
        text: 'Mission activated. Complete the steps in the top-right HUD to earn your badge!',
        emotion: 'serious',
        priority: 10,
      }
    } as any);
  };

  // ── Rank Curriculum controls ──
  const activeRankMission = RANK_MISSIONS.find(m => m.id === missionState.activeRankMissionId) || null;

  const startRankMission = (missionId: string) => {
    const missionDef = RANK_MISSIONS.find(m => m.id === missionId);
    if (!missionDef) return;
    // Ensure the target for this mission is selected so students land in the right place
    telescopeState.setTarget(missionDef.targetId);
    missionState.startRankMission(missionId);
    setIsMissionMenuOpen(false);
    setInstructorResponse({
      title: `Mission Started: ${missionDef.title}`,
      severity: 'warning',
      message: {
        id: `rank-mission-start-${missionDef.id}`,
        text: missionDef.description,
        emotion: 'encouraging',
        priority: 10,
      }
    } as any);
  };

  // ── Textbook "Try it out" — routes a lesson's practical hook into the live sim ──
  const handleTryItOutLesson = (lesson: Lesson) => {
    setIsTextbookOpen(false);
    if (viewMode === 'observatory') setViewMode('split'); // ensure the 2D feed is visible
    if (lesson.targetId) telescopeState.setTarget(lesson.targetId);
    if (lesson.moduleId) setActiveModule(lesson.moduleId);
    if (lesson.missionId) startRankMission(lesson.missionId);
  };

  const handleAbandonRankMission = () => {
    if (activeRankMission) {
      setShowFieldNoteModal(true);
    } else {
      missionState.endRankMission();
    }
  };

  const submitFieldNote = (note: string) => {
    if (activeRankMission) {
      progressState.addLogbookEntry({
        id: `fieldnote-${activeRankMission.id}-${Date.now()}`,
        timestamp: Date.now(),
        targetId: activeRankMission.targetId,
        magnification: getMagnification(telescopeState.activeProfile.focalLength, telescopeState.eyepieceFocalLength, telescopeState.isBarlowActive),
        seeingQuality: telescopeState.seeingQuality,
        tags: ['Field Note', 'Abandoned', activeRankMission.rank === 'I' ? 'Rank I' : 'Rank II'],
        customNote: note || activeRankMission.fieldNotePrompt,
      });
    }
    setShowFieldNoteModal(false);
    missionState.endRankMission();
  };


  // ── Target selection via dropup, with live horizon awareness (Phase 25) ──
  const getTargetAltitudeNow = (target: Target): number | null => {
    if (target.type === 'terrestrial') return TERRESTRIAL_POINTING.alt; // ground-anchored, always up
    if (target.ra === undefined || target.dec === undefined) return null;
    const { observerLocation, simTime } = telescopeState;
    return convertEquatorialToHorizontal(
      target.ra, target.dec,
      observerLocation.latitude, observerLocation.longitude,
      new Date(simTime)
    ).altitude;
  };

  const handleSelectTarget = (targetId: string) => {
    const target = TARGETS[targetId];
    if (!target) return;
    const alt = getTargetAltitudeNow(target);
    const isBelowHorizon = alt !== null && alt < 0;
    // setTarget stores the true (possibly negative) ephemeris altitude; the
    // 3D mount's horizon clamp parks the tube at the 0° hard-stop.
    telescopeState.setTarget(targetId);
    setIsTargetMenuOpen(false);
    setSlewToast(
      isBelowHorizon
        ? `${target.name} is below the horizon — mount parked at the horizon stop. Advance sim time (+1 Hour) to bring it into view.`
        : `Slewing mount to ${target.name}...`
    );
    if (slewToastTimeoutRef.current) window.clearTimeout(slewToastTimeoutRef.current);
    slewToastTimeoutRef.current = window.setTimeout(() => setSlewToast(null), isBelowHorizon ? 4500 : 2200);
  };

  // ── Split-mode divider drag: adjusts the eyepiece panel between 30% and 70% ──
  const startDividerDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setIsDividerDragging(true);
    const onMove = (ev: PointerEvent) => {
      const row = mainRowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      setEyepiecePanelPct(Math.max(30, Math.min(70, pct)));
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setIsDividerDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  // ── Time-step cause-and-effect toast (Phase 26 fix 4e) ──
  const handleTimeStepFeedback = (hours: number) => {
    const s = useTelescopeStore.getState(); // fresh post-step state
    const timeStr = new Date(s.simTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    let targetBit = '';
    if (s.activeTarget) {
      const target = s.activeTarget;
      const alt = target.type === 'terrestrial'
        ? TERRESTRIAL_POINTING.alt
        : target.ra !== undefined && target.dec !== undefined
          ? convertEquatorialToHorizontal(target.ra, target.dec, s.observerLocation.latitude, s.observerLocation.longitude, new Date(s.simTime)).altitude
          : null;
      if (alt !== null) targetBit = ` · ${target.name} now at ${alt.toFixed(0)}°`;
    }
    setSlewToast(`Simulation time ${hours > 0 ? '+' : ''}${hours}h → ${timeStr}${targetBit}`);
    if (slewToastTimeoutRef.current) window.clearTimeout(slewToastTimeoutRef.current);
    slewToastTimeoutRef.current = window.setTimeout(() => setSlewToast(null), 3000);
  };

  const currentMeta = MODULE_META.find(m => m.id === activeModule)!;

  // ── Loading Screen ──
  if (!assetsLoaded) {
    return (
      <div className="min-h-screen h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center gap-6">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-slate-700 border-t-cyan-400 rounded-full animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Telescope className="w-8 h-8 text-cyan-400 opacity-70" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent mb-1">
            Telescope Trainer
          </p>
          <p className="text-sm text-slate-400 font-mono animate-pulse">{assetLoadMessage}</p>
        </div>
        <p className="text-xs text-slate-600 max-w-xs text-center">
          Fetching high-resolution astronomical textures from NASA / Wikimedia
        </p>
      </div>
    );
  }

  if (isInstructorMode) {
    return <InstructorDashboard onExit={() => setIsInstructorMode(false)} />;
  }

  return (
    <div className="min-h-screen h-screen bg-slate-950 text-slate-100 font-sans flex flex-col relative overflow-hidden">
      {/* ── Observatory 3D Background — fullscreen backdrop in Observatory mode.
          Split mode renders the scene in-flow inside the left pane instead, and
          Eyepiece mode unmounts the WebGL canvas entirely to save resources. ── */}
      {viewMode === 'observatory' && (
        <div className="absolute inset-0 z-0">
          <ObservatoryScene />
        </div>
      )}

      <DebugPanel />

      {/* ── TOP NAVIGATION BAR ── */}
      <nav className={`relative z-30 flex items-center justify-between px-4 py-2.5 border-b border-slate-800 shrink-0 ${
        viewMode === 'eyepiece' ? 'bg-slate-950/95' : 'backdrop-blur-md bg-slate-950/40'
      }`}>
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500/20 border border-cyan-500/30 p-1.5 rounded-lg">
            <Telescope className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h1 
              onDoubleClick={() => setIsInstructorMode(prev => !prev)}
              className="text-sm font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent leading-none cursor-pointer select-none"
            >
              Telescope Trainer
            </h1>
            <p className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Observatory Control v0.7</p>
          </div>
        </div>

        {/* Center: Active Telescope Profile indicator */}
        <div className="hidden md:flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-1.5">
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Scope:</span>
          <span className="text-xs font-bold text-cyan-300">{telescopeState.activeProfile.name}</span>
          <span className="text-[9px] text-slate-500">
            f/{telescopeState.activeProfile.focalRatio} · {telescopeState.activeProfile.aperture}mm
          </span>
        </div>

        {/* Right: View Mode + Mission + About */}
        <div className="flex items-center gap-2">
          {/* Global Simulation Mode pill (Phase 26) */}
          <div data-tour-id="tour-simulation-mode" className="flex items-center gap-0.5 bg-slate-800/80 border border-slate-700 rounded-lg p-0.5" title={t('tip.simulationMode')}>
            {([
              { id: 'fun', label: 'Fun', icon: <Sparkles className="w-3.5 h-3.5" /> },
              { id: 'easy', label: 'Easy', icon: <GraduationCap className="w-3.5 h-3.5" /> },
              { id: 'realistic', label: 'Real', icon: <FlaskConical className="w-3.5 h-3.5" /> },
            ] as { id: SimulationMode; label: string; icon: React.ReactNode }[]).map((m) => (
              <button
                key={m.id}
                onClick={() => telescopeState.setSimulationMode(m.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md font-bold uppercase tracking-widest text-[10px] transition-colors ${
                  telescopeState.simulationMode === m.id
                    ? 'bg-amber-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m.icon} <span className="hidden xl:inline">{m.label}</span>
              </button>
            ))}
          </div>

          {/* Language Toggle (Phase 28) — right next to the Global Simulation
              Mode pill, per spec. Swaps instantly: setLanguage just flips a
              store field, no reload. */}
          <div data-tour-id="tour-language" className="flex items-center gap-0.5 bg-slate-800/80 border border-emerald-700/60 rounded-lg p-0.5">
            {([
              { id: 'en', label: 'EN' },
              { id: 'hi', label: 'हिं' },
            ] as { id: 'en' | 'hi'; label: string }[]).map((l) => (
              <button
                key={l.id}
                onClick={() => telescopeState.setLanguage(l.id)}
                aria-pressed={language === l.id}
                className={`px-2.5 py-1 rounded-md font-bold uppercase tracking-widest text-[10px] transition-colors ${
                  language === l.id
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>

          {/* Tri-View Workspace Switch */}
          <div className="flex items-center gap-0.5 bg-slate-800/80 border border-slate-700 rounded-lg p-0.5">
            {([
              { id: 'eyepiece', label: 'Eyepiece', icon: <Crosshair className="w-3.5 h-3.5" /> },
              { id: 'split', label: 'Split', icon: <Columns2 className="w-3.5 h-3.5" /> },
              { id: 'observatory', label: 'Observatory', icon: <Telescope className="w-3.5 h-3.5" /> },
            ] as { id: ViewMode; label: string; icon: React.ReactNode }[]).map((mode) => (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md font-bold uppercase tracking-widest text-[10px] transition-colors ${
                  viewMode === mode.id
                    ? 'bg-cyan-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {mode.icon} <span className="hidden xl:inline">{mode.label}</span>
              </button>
            ))}
          </div>

          {/* Mission Button */}
          {!missionState.isActive && !activeRankMission ? (
            <div className="relative" ref={missionMenuRef}>
              <button
                onClick={() => setIsMissionMenuOpen(!isMissionMenuOpen)}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest text-[10px] shadow-lg transition-colors border border-indigo-400"
              >
                <Rocket className="w-3.5 h-3.5" /> Mission <ChevronDown className="w-3 h-3" />
              </button>
              {isMissionMenuOpen && (
                <div className="absolute top-full right-0 mt-2 bg-slate-900 border border-indigo-500/50 rounded-xl p-3 shadow-2xl min-w-[300px] max-h-[70vh] overflow-y-auto z-50">
                  {/* Rank Curriculum Tabs */}
                  <div className="flex items-center gap-2 mb-2">
                    <GraduationCap className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Rank Curriculum</span>
                  </div>
                  <div className="flex gap-1 mb-2 bg-slate-800 rounded-lg p-1">
                    <button
                      onClick={() => setRankMissionTab('I')}
                      className={`flex-1 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${rankMissionTab === 'I' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      Rank I · Skywatcher
                    </button>
                    <button
                      onClick={() => setRankMissionTab('II')}
                      className={`flex-1 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors ${rankMissionTab === 'II' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      Rank II · Observer
                    </button>
                  </div>
                  <div className="flex flex-col gap-1 mb-3">
                    {RANK_MISSIONS.filter(m => m.rank === rankMissionTab).map(m => (
                      <button
                        key={m.id}
                        onClick={() => startRankMission(m.id)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-amber-950/40 border border-transparent hover:border-amber-700/40 transition-colors flex flex-col gap-0.5"
                      >
                        <span className="text-xs font-bold text-amber-200">
                          {m.title.startsWith('Capstone') ? '🎖️ ' : '⭐ '}{m.title}
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase tracking-wide">{m.targetId}</span>
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-slate-800 pt-2 flex items-center gap-2 mb-1">
                    <Rocket className="w-3.5 h-3.5 text-indigo-400" />
                    <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Guided Workflows</span>
                  </div>
                  {AVAILABLE_MISSIONS.map(m => (
                    <button
                      key={m.id}
                      onClick={() => startMission(m.id)}
                      className="w-full text-left px-4 py-3 rounded-lg hover:bg-indigo-950/60 transition-colors flex flex-col gap-1"
                    >
                      <span className="text-sm font-bold text-indigo-300">{m.name}</span>
                      <span className="text-[10px] text-slate-400">{m.steps.length} steps</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeRankMission ? (
            <div className="flex items-center gap-2 bg-amber-950/60 border border-amber-500/40 rounded-lg px-3 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">
                {activeRankMission.title}
              </span>
              {missionState.activeRankMissionId === 'rank2_capstone_right_tool' && (
                <span className="text-[10px] text-amber-500">
                  {missionState.completedTargetIds.length}/3
                </span>
              )}
              <button
                onClick={handleAbandonRankMission}
                className="text-[10px] text-slate-500 hover:text-slate-300 ml-1"
              >
                ✕
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-indigo-950/60 border border-indigo-500/40 rounded-lg px-3 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">
                {AVAILABLE_MISSIONS.find(m => m.id === missionState.activeMissionId)?.name || 'Mission'}
              </span>
              <span className="text-[10px] text-indigo-500">
                {missionState.currentStepIndex}/{missionState.steps.length}
              </span>
              <button
                onClick={() => missionState.endMission()}
                className="text-[10px] text-slate-500 hover:text-slate-300 ml-1"
              >
                ✕
              </button>
            </div>
          )}


          {/* Textbook Button (Phase 31) */}
          <button
            onClick={() => setIsTextbookOpen(true)}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest text-[10px] shadow-lg transition-colors border border-emerald-400"
          >
            <BookMarked className="w-3.5 h-3.5" /> <span className="hidden xl:inline">{t('textbook.heading')}</span>
          </button>

          {/* Start Tour Button (Phase 30; first-visit prompt anchor in Phase 33) */}
          <button
            ref={startTourBtnRef}
            onClick={() => {
              setShowTourPrompt(false);
              try { localStorage.setItem('tourPrompted', '1'); } catch { /* best effort */ }
              telescopeState.startTour();
            }}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 border border-green-500 text-white px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest text-[10px] transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" /> <span className="hidden xl:inline">{t('tour.startTour')}</span>
          </button>

          {/* About Button */}
          <button
            onClick={() => setIsAboutOpen(true)}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest text-[10px] transition-colors"
          >
            <Info className="w-3.5 h-3.5" /> About
          </button>
          
          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg font-bold uppercase tracking-widest text-[10px] transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </nav>

      {/* Floating Instructor HUD */}
      <InstructorVoiceBox response={instructorResponse} />

      {/* Rank Curriculum Mission Panel (right side) — description + objectives */}
      {activeRankMission && (
        <div className="absolute top-16 right-4 z-40 w-80 bg-slate-900/95 backdrop-blur border border-amber-500/50 rounded-xl p-4 shadow-2xl max-h-[75vh] overflow-y-auto">
          <div className="flex items-center gap-2 mb-2">
            <GraduationCap className="w-4 h-4 text-amber-400" />
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
              Rank {activeRankMission.rank} · {activeRankMission.title}
            </h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed italic mb-3 whitespace-pre-line">
            {activeRankMission.description}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Objectives</p>
          <ul className="flex flex-col gap-1.5 mb-2">
            {activeRankMission.objectives.map((obj, i) => (
              <li key={i} className="flex items-start gap-2 text-[11px] text-slate-300">
                <Circle className="w-2.5 h-2.5 mt-0.5 text-amber-500 shrink-0" />
                <span>{obj}</span>
              </li>
            ))}
          </ul>
          {missionState.rankMissionStatus === 'success' && (
            <div className="mt-2 p-2 bg-emerald-900/40 border border-emerald-500/50 rounded text-center">
              <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Mission Complete! 🎉</p>
            </div>
          )}
        </div>
      )}

      {/* Mission Steps Panel (right side, expanded) */}
      {missionState.isActive && (

        <div className="absolute top-16 right-4 z-40 w-72 bg-slate-900/90 backdrop-blur border border-indigo-500/50 rounded-xl p-4 shadow-2xl">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-3 flex items-center justify-between">
            <span>Active Mission Steps</span>
          </h3>
          <div className="flex flex-col gap-2">
            {missionState.steps.map((step, idx) => {
              const isActiveStep = idx === missionState.currentStepIndex;
              const isPastStep = idx < missionState.currentStepIndex;
              if (!isActiveStep && !isPastStep && idx > missionState.currentStepIndex + 1) return null;

              return (
                <div key={step.id} className={`flex gap-3 items-start p-2 rounded border ${
                  isActiveStep ? 'bg-indigo-950/40 border-indigo-500/50' :
                  isPastStep ? 'bg-slate-800/30 border-transparent opacity-50' :
                  'border-transparent opacity-30'
                }`}>
                  <div className={`mt-0.5 shrink-0 ${isPastStep ? 'text-emerald-500' : isActiveStep ? 'text-indigo-400 animate-pulse' : 'text-slate-600'}`}>
                    {isPastStep ? <CheckCircle2 className="w-4 h-4" /> : <div className="w-4 h-4 rounded-full border-2 border-current" />}
                  </div>
                  <div>
                    <p className={`text-xs font-bold ${isActiveStep ? 'text-indigo-300' : 'text-slate-400'}`}>{step.title}</p>
                    {isActiveStep && <p className="text-[10px] text-slate-300 mt-1 leading-relaxed">{step.instruction}</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {missionState.currentStepIndex >= missionState.steps.length && (
            <div className="mt-3 p-2 bg-emerald-900/40 border border-emerald-500/50 rounded text-center">
              <p className="text-emerald-400 text-xs font-bold uppercase tracking-widest">Mission Complete! 🎉</p>
            </div>
          )}
        </div>
      )}

      {/* ── EYEPIECE MODE: pure legacy 2D workspace (WebGL canvas unmounted) ── */}
      {viewMode === 'eyepiece' && (
        <main className="flex-1 flex flex-col md:flex-row relative z-10 pb-48 min-h-0">
          <aside className="w-full md:w-72 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto bg-slate-950 border-r border-slate-800">
            <TelemetryPanel onTimeStep={handleTimeStepFeedback} />
            <div className="mt-auto hidden md:block">
              <p className="text-[10px] text-slate-500 text-center uppercase tracking-widest font-bold">
                {t(MODULE_LABEL_KEYS[currentMeta.id])}
              </p>
            </div>
          </aside>
          <section className="flex-1 relative bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black overflow-hidden flex items-center justify-center min-h-0">
            <ActiveModuleView activeModule={activeModule} />
          </section>
        </main>
      )}

      {/* ── OBSERVATORY MODE: pure fullscreen 3D — only telemetry floats over it ── */}
      {viewMode === 'observatory' && (
        <main className="flex-1 flex flex-col md:flex-row relative z-10 pb-48 min-h-0 pointer-events-none">
          <aside className="w-full md:w-72 p-4 flex flex-col gap-4 shrink-0 overflow-y-auto pointer-events-auto bg-slate-950/35 backdrop-blur-md">
            <TelemetryPanel translucent onTimeStep={handleTimeStepFeedback} />
            <div className="mt-auto hidden md:block">
              <p className="text-[10px] text-slate-500 text-center uppercase tracking-widest font-bold">
                Observatory View
              </p>
            </div>
          </aside>
        </main>
      )}

      {/* ── SPLIT MODE: 3D pane | draggable divider | 2D eyepiece pane ── */}
      {viewMode === 'split' && (
        <main
          ref={mainRowRef}
          className={`flex-1 flex flex-row relative z-10 pb-48 min-h-0 ${isDividerDragging ? 'select-none' : ''}`}
        >
          {/* 3D Observatory pane (in-flow — resizes live with the divider) */}
          <div className="relative flex-1 min-w-0 min-h-0">
            <ObservatoryScene />
            <div className="absolute top-0 left-0 bottom-0 w-60 p-3 overflow-y-auto bg-slate-950/35 backdrop-blur-md pointer-events-auto">
              <TelemetryPanel translucent onTimeStep={handleTimeStepFeedback} />
            </div>
          </div>

          {/* Draggable divider — adjusts the eyepiece panel between 30% and 70% */}
          <div
            onPointerDown={startDividerDrag}
            title="Drag to resize the eyepiece panel"
            className={`w-2 shrink-0 cursor-col-resize flex items-center justify-center transition-colors ${
              isDividerDragging ? 'bg-cyan-600/80' : 'bg-slate-800/80 hover:bg-cyan-700/60'
            }`}
          >
            <div className="w-0.5 h-10 bg-slate-400 rounded-full" />
          </div>

          {/* 2D eyepiece pane */}
          <section
            style={{ width: `${eyepiecePanelPct}%` }}
            className="shrink-0 min-h-0 bg-slate-950/90 border-l border-slate-800 flex flex-col"
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700/60 shrink-0 bg-slate-950/40">
              <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-300 flex items-center gap-1.5">
                <Crosshair className="w-3 h-3" /> Eyepiece Feed
              </span>
              <span className="flex items-center gap-1.5">
                {telescopeState.activeTarget && (getTargetAltitudeNow(telescopeState.activeTarget) ?? 1) < 0 && (
                  <span
                    title={t('tip.belowHorizon')}
                    className="text-[9px] font-bold uppercase tracking-wide text-amber-400 bg-amber-950/60 border border-amber-700/50 rounded px-1 py-0.5"
                  >
                    {t('common.belowHorizon')}
                  </span>
                )}
                <span className={`text-[10px] font-mono uppercase tracking-widest ${telescopeState.activeTarget ? 'text-slate-400' : 'text-amber-400'}`}>
                  {telescopeState.activeTarget?.name ?? t('common.manualSlew')}
                </span>
              </span>
            </div>
            <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center">
              <ActiveModuleView activeModule={activeModule} />
            </div>
          </section>
        </main>
      )}


      {/* First-visit tour prompt (Phase 33) — a one-shot floating nudge
          anchored under the Start Tour button. Never renders once the tour
          itself is running, and localStorage keeps it a one-time event. */}
      {showTourPrompt && telescopeState.tourStep === 0 && (() => {
        const TOAST_W = 264;
        const anchor = startTourBtnRef.current?.getBoundingClientRect() ?? null;
        const left = anchor
          ? Math.max(8, Math.min(anchor.left + anchor.width / 2 - TOAST_W / 2, window.innerWidth - TOAST_W - 8))
          : window.innerWidth - TOAST_W - 16;
        const top = anchor ? anchor.bottom + 12 : 64;
        const arrowLeft = anchor
          ? Math.max(14, Math.min(anchor.left + anchor.width / 2 - left - 6, TOAST_W - 26))
          : TOAST_W - 40;
        return (
          <div
            className="fixed z-[90] bg-slate-900/95 backdrop-blur-md border border-cyan-500/60 rounded-xl shadow-2xl p-3 flex flex-col gap-2 animate-[fadeIn_0.3s_ease-out]"
            style={{ top, left, width: TOAST_W }}
            role="status"
          >
            {/* Up-arrow pointing at the Start Tour button */}
            <div
              className="absolute -top-1.5 w-3 h-3 rotate-45 bg-slate-900 border-t border-l border-cyan-500/60"
              style={{ left: arrowLeft }}
            />
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-slate-200 leading-relaxed">
                <span className="font-bold text-cyan-300">{t('tour.promptTitle')}</span>{' '}
                {t('tour.promptBody')}
              </p>
              <button
                onClick={() => setShowTourPrompt(false)}
                className="shrink-0 p-0.5 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300 transition-colors"
                aria-label="Dismiss tour prompt"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              onClick={() => {
                setShowTourPrompt(false);
                telescopeState.startTour();
              }}
              className="self-start flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
            >
              <HelpCircle className="w-3 h-3" /> {t('tour.startTour')}
            </button>
          </div>
        );
      })()}

      {/* Slew-to-Target Toast — connects the footer's target switch to the 3D mount's physical movement */}
      {slewToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] bg-cyan-950/90 border border-cyan-500 text-cyan-100 px-4 py-2.5 rounded-lg shadow-2xl backdrop-blur-md flex items-center gap-2.5 pointer-events-none">
          <Telescope className="w-4 h-4 text-cyan-400 shrink-0 animate-pulse" />
          <p className="text-xs font-bold uppercase tracking-widest">{slewToast}</p>
        </div>
      )}

      {/* High Performance Toast */}
      {showHighPerfToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[100] bg-indigo-900/90 border border-indigo-500 text-indigo-100 px-4 py-3 rounded-lg shadow-2xl flex items-center gap-3">
          <Info className="w-5 h-5 text-indigo-400 shrink-0" />
          <p className="text-sm font-semibold max-w-sm">
            High-Performance Mode Enabled: Real-time optical blurs active. Turn off if the simulation stutters.
          </p>
          <button 
            onClick={() => setShowHighPerfToast(false)}
            className="p-1 hover:bg-indigo-800 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Modals */}
      {isFieldLogbookOpen && <FieldLogbookModal onClose={() => setIsFieldLogbookOpen(false)} />}
      {isAboutOpen && <AboutModal onClose={() => setIsAboutOpen(false)} />}

      {isCustomScopeModalOpen && <CustomTelescopeModal onClose={() => setIsCustomScopeModalOpen(false)} />}

      {showFieldNoteModal && activeRankMission && (
        <FieldNoteModal
          prompt={activeRankMission.fieldNotePrompt}
          missionTitle={activeRankMission.title}
          targetId={activeRankMission.targetId}
          onSubmit={submitFieldNote}
          onSkip={() => submitFieldNote('')}
        />
      )}


      {/* Observatory Control Desk (Bottom Footer) */}
      <footer className={`border-t border-slate-800 z-20 shrink-0 absolute bottom-0 w-full shadow-[0_-10px_30px_rgba(0,0,0,0.5)] ${
        viewMode === 'eyepiece' ? 'bg-slate-900' : 'bg-slate-900/50 backdrop-blur-md'
      }`}>

        {/* Logbook toggle tab */}
        <div className="absolute -top-12 right-4 z-30">
          <button
            onClick={() => setIsFieldLogbookOpen(true)}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-2 rounded-t-lg font-bold uppercase tracking-widest text-xs transition-colors shadow-lg border border-b-0 border-amber-500"
          >
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">{t('footer.logbookBadges')}</span>
          </button>
        </div>


        {/* Module Tab Bar — hidden in Observatory mode (no 2D module is visible there) */}
        {viewMode !== 'observatory' && (
        <div className="flex border-b border-slate-800">
          {MODULE_META.map((mod) => {
            const isActive = mod.id === activeModule;
            const completedId = mod.id === 'dobsonian' ? 'dobsonian_trainer' :
                              mod.id === 'astrophotography' ? 'astrophoto_trainer' : 'finderscope';
            const isCompleted = progressState.completedModules.includes(completedId);
            return (
              <button
                key={mod.id}
                onClick={() => handleModuleSwitch(mod.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-all border-b-2 ${
                  isActive
                    ? 'bg-slate-800/60 border-cyan-400 text-cyan-300'
                    : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/30'
                }`}
              >
                {mod.icon}
                <span className="hidden lg:inline">{t(MODULE_LABEL_KEYS[mod.id])}</span>
                {isCompleted && <span className="text-emerald-400 text-[10px]">✓</span>}
              </button>
            );
          })}
        </div>
        )}

        {/* Controls Row.
            Phase 33 overflow fix: the instrument cluster was `shrink-0`, so
            its one-line max-content width (which easily exceeds 1500px with
            the astro hint and Fun-mode Digital Zoom present) could never
            wrap — it squeezed the flex-1 Focuser bar to its minimum and ran
            the rightmost buttons off a 1920px viewport. The focuser now
            keeps a fixed, guaranteed width and the instrument cluster is
            the flexible (`flex-1 min-w-0`) member, so `flex-wrap` can
            actually engage and fold it onto extra rows instead. */}
        <div className="p-3 flex flex-col md:flex-row justify-between items-center gap-4">

          {/* Focuser Knob — Available in all modules */}
          <div data-tour-id="tour-focuser" className="flex flex-col items-center w-full md:w-64 lg:w-72 shrink-0">
            <label className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-1.5 flex justify-between w-full">
              <span>{t('footer.focuserKnob')}</span>
              <span className={Math.abs(telescopeState.focuserPosition - getPerfectFocusPoint(telescopeState.eyepieceFocalLength, telescopeState.isBarlowActive)) <= modeRules.focusToleranceUnits ? 'text-emerald-400' : 'text-amber-400'}>
                {Math.abs(telescopeState.focuserPosition - getPerfectFocusPoint(telescopeState.eyepieceFocalLength, telescopeState.isBarlowActive)) <= modeRules.focusToleranceUnits ? t('footer.perfectFocus') : t('footer.outOfFocus')}
              </span>
            </label>
            <div className="relative w-full flex items-center h-4">
              <div 
                 className="absolute top-1/2 w-1.5 h-4 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] rounded-full pointer-events-none z-10 transition-all duration-300 ease-out"
                 style={{ left: `${getPerfectFocusPoint(telescopeState.eyepieceFocalLength, telescopeState.isBarlowActive)}%`, transform: `translate(-50%, -50%)` }}
              />
              <input
                type="range" min="0" max="100" step="1"
                value={telescopeState.focuserPosition}
                onChange={(e) => telescopeState.setFocuserPosition(Number(e.target.value))}
                className="w-full accent-blue-500 absolute top-1/2 -translate-y-1/2 m-0"
              />
            </div>
          </div>

          {/* Module hints */}
          {activeModule === 'astrophotography' && (
            <div className="shrink min-w-0 max-w-[220px] text-center">
              <p className="text-[10px] font-bold text-amber-300 uppercase tracking-widest">
                {t('footer.astroHint')}
              </p>
            </div>
          )}

          {/* Instrument Controls */}
          <div className="flex gap-2 flex-wrap text-xs justify-center md:justify-end items-center flex-1 min-w-0">

            {/* ── Telescope Selector ── */}
            <div className="flex items-center gap-1">
              <div className="relative">
                <select
                  value={telescopeState.activeProfile.id}
                  onChange={(e) => telescopeState.setActiveProfile(e.target.value)}
                  className="appearance-none bg-slate-800 border border-slate-600 text-slate-200 text-[10px] font-bold rounded px-3 py-1 pr-7 cursor-pointer hover:bg-slate-700 transition-colors uppercase tracking-wide"
                >
                  {telescopeState.availableProfiles?.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
              </div>
              <button
                onClick={() => setIsCustomScopeModalOpen(true)}
                title={t('footer.addCustomTelescope')}
                className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 border border-amber-500 text-white text-[10px] font-bold uppercase tracking-wide transition-colors"
              >
                🔧 {t('footer.add')}
              </button>
            </div>

            <button
              data-tour-id="tour-dustcap"
              onClick={() => {
                telescopeState.toggleDustCap();
                if (telescopeState.isDustCapOn) {
                  telescopeState.setMirrorCooled(false);
                  setTimeout(() => telescopeState.setMirrorCooled(true), 2000);
                }
              }}
              className={`px-3 py-1 rounded border transition-colors ${telescopeState.isDustCapOn ? 'bg-red-950/80 border-red-500 text-red-200 shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-slate-800 border-slate-600'}`}
            >
              {t('footer.dustCap')}: {telescopeState.isDustCapOn ? t('common.on') : t('common.off')}
            </button>

            <button
              onClick={() => telescopeState.toggleSolarFilter()}
              className={`px-3 py-1 rounded border transition-colors ${telescopeState.isSolarFilterAttached ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-slate-800 border-slate-600'}`}
            >
              {t('footer.solarFilter')}: {telescopeState.isSolarFilterAttached ? t('common.on') : t('common.off')}
            </button>

            {/* ── Target Selector Dropup with live horizon states (Phase 25) ── */}
            <div className="relative" ref={targetMenuRef}>
              <button
                data-tour-id="tour-target"
                onClick={() => setIsTargetMenuOpen((o) => !o)}
                className="px-3 py-1 rounded border bg-slate-800 border-slate-600 hover:bg-slate-700 transition-colors flex items-center gap-1.5"
              >
                {t('common.target')}: {telescopeState.activeTarget?.name || t('footer.noneManual')}
                <ChevronDown className={`w-3 h-3 transition-transform ${isTargetMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isTargetMenuOpen && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[16rem] bg-slate-900 border border-slate-600 rounded-xl p-1.5 shadow-2xl z-50 flex flex-col gap-0.5">
                  {TARGET_MENU_ORDER.map((id) => {
                    const targetData = TARGETS[id];
                    const alt = getTargetAltitudeNow(targetData);
                    const below = alt !== null && alt < 0;
                    const isActive = telescopeState.activeTarget?.id === id;
                    return (
                      <button
                        key={id}
                        onClick={() => handleSelectTarget(id)}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg text-left transition-colors border ${
                          isActive ? 'bg-cyan-950/60 border-cyan-700/50' : 'hover:bg-slate-800 border-transparent'
                        }`}
                      >
                        <span className={`text-xs font-bold ${below ? 'text-slate-500' : 'text-slate-200'}`}>
                          {targetData.name}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {below && (
                            <span className="text-[9px] font-bold uppercase tracking-wide text-amber-400 bg-amber-950/60 border border-amber-700/50 rounded px-1 py-0.5">
                              {t('common.belowHorizon')}
                            </span>
                          )}
                          {alt !== null && (
                            <span className="text-[9px] font-mono text-slate-500">{alt.toFixed(0)}°</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Global Eyepiece Selector (Phase 27, P27.3) ──
                Instantly changes the True FOV/Magnification of the unified
                Main Eyepiece Feed, wherever it's showing (align/track/astro). */}
            <div className="relative" ref={eyepieceMenuRef}>
              <button
                data-tour-id="tour-eyepiece"
                onClick={() => setIsEyepieceMenuOpen((o) => !o)}
                title={t('tip.magnification')}
                className="px-3 py-1 rounded border bg-slate-800 border-slate-600 hover:bg-slate-700 transition-colors flex items-center gap-1.5"
              >
                {t('footer.eyepiece')}: {activeEyepieceForFooter.label}
                <ChevronDown className={`w-3 h-3 transition-transform ${isEyepieceMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {isEyepieceMenuOpen && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 min-w-[14rem] bg-slate-900 border border-slate-600 rounded-xl p-1.5 shadow-2xl z-50 flex flex-col gap-0.5">
                  {EYEPIECE_CATALOG.map((ep) => {
                    const isActive = telescopeState.activeEyepieceId === ep.id;
                    const mag = Math.round(getMagnification(telescopeState.activeProfile?.focalLength || 1200, ep.focalLengthMm, telescopeState.isBarlowActive));
                    const fov = getTrueFOV(ep.afovDeg, mag);
                    return (
                      <button
                        key={ep.id}
                        onClick={() => { telescopeState.setEyepiece(ep.id); setIsEyepieceMenuOpen(false); }}
                        className={`w-full flex items-center justify-between gap-3 px-3 py-1.5 rounded-lg text-left transition-colors border ${
                          isActive ? 'bg-cyan-950/60 border-cyan-700/50' : 'hover:bg-slate-800 border-transparent'
                        }`}
                      >
                        <span className="text-xs font-bold text-slate-200">{ep.label}</span>
                        <span className="text-[9px] font-mono text-slate-500">{mag}× · {fov.toFixed(2)}°</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 bg-slate-800 border border-slate-600 rounded px-3 py-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-300">
                {t('footer.seeingAntoniadi')}: {telescopeState.seeingQuality}
              </label>
              <input
                type="range" min="1" max="5" step="1"
                value={telescopeState.seeingQuality}
                onChange={(e) => telescopeState.setSeeingQuality(Number(e.target.value))}
                className="w-16 accent-amber-500"
                title="1 = Perfect, 5 = Terrible"
              />
            </div>

            <button
              title={t('tip.barlow')}
              onClick={() => telescopeState.toggleBarlow()}
              className={`px-3 py-1 rounded border transition-colors ${telescopeState.isBarlowActive ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'bg-slate-800 border-slate-600'}`}
            >
              {t('footer.barlow2x')}: {telescopeState.isBarlowActive ? t('common.on') : t('common.off')}
            </button>

            {/* Fun-mode Digital Zoom override (Phase 26) */}
            {modeRules.digitalZoomAvailable && (
              <button
                onClick={() => telescopeState.toggleDigitalZoom()}
                title={t('tip.digitalZoom')}
                className={`px-3 py-1 rounded border transition-colors ${
                  telescopeState.isDigitalZoomOn
                    ? 'bg-fuchsia-950/80 border-fuchsia-500 text-fuchsia-200 shadow-[0_0_10px_rgba(217,70,239,0.25)]'
                    : 'bg-slate-800 border-slate-600'
                }`}
              >
                🔍 {t('footer.digitalZoom')}: {telescopeState.isDigitalZoomOn ? '2×' : t('common.off')}
              </button>
            )}
          </div>
        </div>
      </footer>
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}

      {/* Textbook overlay (Phase 31) — a pure additive overlay like the modals
          above; never unmounts the 3D Observatory or 2D Live View canvases
          underneath, so it's safe to open over any of the three view modes. */}
      {isTextbookOpen && (
        <TextbookPanel onClose={() => setIsTextbookOpen(false)} onTryItOut={handleTryItOutLesson} />
      )}

      {/* Onboarding Tour overlay (Phase 30) — spotlights controls across the
          nav bar, footer, TelemetryPanel, and LiveViewPanel regardless of
          which of those actually rendered this pass. Its "Live View
          Canvases" step needs the 2D feeds mounted (unmounted in pure
          Observatory view), so it can request a compatible layout. */}
      <OnboardingTour
        areCanvasesVisible={viewMode !== 'observatory'}
        onRequestCanvasesVisible={() => setViewMode('split')}
      />
    </div>
  );
}

export default App;
