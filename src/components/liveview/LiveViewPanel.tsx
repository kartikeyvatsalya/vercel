import React, { useEffect, useRef, useState } from 'react';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { useAlignmentStore } from '../../store/useAlignmentStore';
import { useProgressStore, type LogbookEntry } from '../../store/useProgressStore';
import { evaluateState, evaluateAstroPhotoRules } from '../../engine/rulesEngine';
import { getMagnification, getTrueFOV, FINDERSCOPE_MAG, FINDERSCOPE_APPARENT_FOV, EYEPIECE_CATALOG, DEFAULT_EYEPIECE_ID, getPerfectFocusPoint } from '../../engine/opticalMath';
import { calculateDsoSNR, calculatePlanetarySharpness } from '../../engine/astroMath';
import { SIM_MODE_RULES } from '../../engine/simulationModes';
import { computeSkyOffsetDeg, projectSkyOffsetPx, getDriftGentledSimTime } from '../../engine/skyGeometry';
import { renderOpticalView } from '../../engine/skyRenderer';
import { TARGETS } from '../../data/bookContent';
import { getSmoothSimTime, SIDEREAL_DEG_PER_SEC } from '../../engine/timeEngine';
import { getSkyState } from '../../engine/daylight';
import { convertEquatorialToHorizontal } from '../../engine/ephemerisMath';
import { useTranslation } from '../../engine/i18n';
import type { AlignmentDifficulty } from '../../store/useTelescopeStore';
import { InfoTip } from '../ui/InfoTip';
import {
  RotateCcw, RotateCw, Shuffle, Lock, Unlock, Camera, Layers, Zap, Moon, Crosshair,
  Target as TargetIcon, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
} from 'lucide-react';

/**
 * LiveViewPanel — Phase 27, P27.2–P27.4; Phase 29 kinematics & slew pad
 * ─────────────────────────────────────────────────────────────────
 * The unified "Main Eyepiece Feed" + "Finderscope Feed." Supersedes
 * FinderscopeGame/DobsonianTrainer/AstroPhotoTrainer's UI. The `mode` prop
 * is a lens on top of the SAME two feeds, not a separate screen:
 *   'align'            — finder alignment screws (ex-FinderscopeGame)
 *   'track'             — drag-to-track the real sky drift (ex-DobsonianTrainer)
 *   'astrophotography'  — exposure/stacking/calibration (ex-AstroPhotoTrainer)
 * (The 'optics' lens — ex-MagnificationSandbox — was retired in Phase 29;
 * the global footer Eyepiece selector covers that lesson from every mode.)
 *
 * Both canvases are driven by ONE shared rAF loop and call the SAME
 * renderOpticalView with the SAME evalResult/target/pointing, differing
 * only in role/trueFovDeg/axis fields — so manual slewing, simTime drift,
 * and motorized tracking update both feeds simultaneously by construction.
 * 'astrophotography' mode draws its exposure/stacking/calibration effects
 * as a post-process pass on the SAME main-feed canvas, on top of whatever
 * renderOpticalView already drew — it does not own a separate canvas.
 *
 * Phase 29: the loop samples engine/timeEngine's getSmoothSimTime() every
 * frame, so unmotored sky drift glides instead of jumping once a second,
 * and a hold-to-slew D-Pad drives the mount's real pointingAlt/Az.
 */

const MAIN_CANVAS_PX = 300;
const FINDER_CANVAS_PX = 250;

// Manual slew rate: fraction of the main feed's field of view per second —
// FOV-proportional so the pad feels equally responsive at 46× and 300×.
const SLEW_FOV_FRACTION_PER_SEC = 0.55;

// ── Dynamic Drag Sensitivity (Phase 30) ──
// handleTrackPointerMove's base fov/canvasPx conversion keeps 'track' mode's
// drag WYSIWYG (the target under your cursor tracks your cursor exactly
// 1:1 on screen) at ANY zoom level — by design, but it also means the FEEL
// of dragging never changes with magnification: a beginner's small,
// unavoidable hand tremor sweeps the same screen distance regardless of how
// tiny the true field is, so real-user testing found high power "too fast."
// This factor is layered on top of that WYSIWYG term, referenced against a
// typical low-power true FOV, so on-screen responsiveness ITSELF now scales
// with zoom: a wide field (like the finder's 7.5°) drags briskly, while a
// 4mm/Barlow's sub-degree field demands deliberate, "microscopically
// precise" mouse travel.
const DRAG_SENSITIVITY_REFERENCE_FOV_DEG = 1.0;
const DRAG_SENSITIVITY_MIN = 0.12;
const DRAG_SENSITIVITY_MAX = 3.0;

// ── Canvas render throttling (Phase 28) ──
// Minimum time between canvas redraws while nothing is visually changing
// (see `shouldDraw` in the render loop below). 200ms ≈ 5fps — imperceptible
// for a genuinely static scene, ~12× fewer expensive draw calls when idle.
const IDLE_REDRAW_INTERVAL_MS = 200;

// ── 'astrophotography' > 'planetary' live-composite softness (Phase 33) ──
// calculatePlanetarySharpness at the DEFAULT settings (50% cutoff, seeing 3)
// yields exactly 0.45 — that's the "clean" line. At or above it the live
// view renders sharp when focused; below it (lazy cutoffs in bad seeing)
// the composite visibly softens, teaching WHY lucky imaging selects frames.
const ASTRO_CLEAN_SHARPNESS = 0.45;

// ── The Universal Physical Sky (Phase 35) ──
// Every major catalog body, handed to renderOpticalView each frame so the
// feeds draw whatever physically falls in the field — independent of the UI
// target lock. Stable module-level reference: no per-frame allocation, and
// the render loop reads body data (never mutates), so sharing the catalog
// objects is safe.
const UNIVERSAL_SKY_BODIES = Object.values(TARGETS);

// ── Physical solar hazard radius (Phase 35) ── Angular distance from the
// LIVE Sun's center within which unfiltered optics are an eye hazard: half
// the finder's ~7.5° field (the widest optic bolted to the tube — if the
// Sun is anywhere in the finder, so is the danger) plus the solar radius.
const SUN_HAZARD_RADIUS_DEG = 4.0;

// ── 'track' mode constants (ported from DobsonianTrainer) ──
const TRACK_LOCK_DURATION_MS = 15_000;
// Proportional to the original 400px-canvas reticle (30px radius = 7.5%).
const TRACK_RETICLE_RADIUS_PX = MAIN_CANVAS_PX * 0.075;
// Mechanical-imbalance droop, expressed as a fraction of the current field
// per second (proportional to the original 25px/sec on a 400px field) so it
// feels equally urgent regardless of magnification.
const TRACK_DROOP_FRACTION_PER_SEC = 25 / 400;

interface LiveViewPanelProps {
  mode: 'align' | 'track' | 'astrophotography';
}

export const LiveViewPanel: React.FC<LiveViewPanelProps> = ({ mode }) => {
  const telescopeState = useTelescopeStore();
  const alignmentState = useAlignmentStore();
  const progressState = useProgressStore();
  const { t } = useTranslation();
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const finderCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastMainFilterRef = useRef('');

  // 'track' mode: drag-to-slew + 15s reticle-lock state (persists across
  // mode switches since LiveViewPanel is a single reconciled instance —
  // see App.tsx's ActiveModuleView for why that matters).
  const trackDragRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const trackLockTimerRef = useRef(0);
  const trackCompletedRef = useRef(false);

  // ── Slew D-Pad (Phase 29) ── Direction currently held, in mount-frame
  // sign convention (+dAlt = up, +dAz = clockwise/east). Applied inside the
  // shared rAF loop with real elapsed time, so holding a button glides the
  // mount smoothly instead of stepping it per click.
  const slewDirRef = useRef({ dAlt: 0, dAz: 0 });

  // ── 'astrophotography' mode state (ported from AstroPhotoTrainer, P27.4) ──
  // Local (not a store slice) so it persists across a quick peek at another
  // tab exactly like 'track' mode's lock timer does, since LiveViewPanel is
  // one reconciled instance — see App.tsx's ActiveModuleView.
  const [astroMode, setAstroMode] = useState<'planetary' | 'dso'>('planetary');
  const [isBahtinovMaskOn, setIsBahtinovMaskOn] = useState(false);
  const [planetaryExposureMs, setPlanetaryExposureMs] = useState(30);
  const [frameCutoff, setFrameCutoff] = useState(50);
  const [totalFrames] = useState(500);
  const [isRecording, setIsRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [dsoSubExposureSec, setDsoSubExposureSec] = useState(30);
  const [dsoSubCount, setDsoSubCount] = useState(1);
  const [dsoIso, setDsoIso] = useState(800);
  const [trackingLock, setTrackingLock] = useState(false);
  const [darkFrameCount, setDarkFrameCount] = useState(0);
  const [hasDarksApplied, setHasDarksApplied] = useState(false);
  const [isCapturingDso, setIsCapturingDso] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [lastGrade, setLastGrade] = useState<string | null>(null);
  const [astroInstructor, setAstroInstructor] = useState<string | null>(null);

  // Global difficulty knobs (Phase 26) — drift, lock threshold, zoom, blur.
  const modeRules = SIM_MODE_RULES[telescopeState.simulationMode];

  // Global Eyepiece Selector (Phase 27, P27.3) — drives the Main Eyepiece
  // Feed's true FOV in every mode.
  const activeEyepiece = EYEPIECE_CATALOG.find((e) => e.id === telescopeState.activeEyepieceId)
    ?? EYEPIECE_CATALOG.find((e) => e.id === DEFAULT_EYEPIECE_ID)!;

  // ── AUTHENTIC ALIGNMENT PROTOCOL (Phase 25/26) ──
  // Real-world order of operations: FIRST center a prominent target in the
  // main eyepiece (slew the mount), and only THEN touch the finder's screws.
  // The screws stay locked until the mount actually points at the target.
  // The offset is measured at the same drift-gentled ephemeris time the
  // feeds render with (Phase 33), so display and lock always agree.
  const mainMagnification = getMagnification(
    telescopeState.activeProfile?.focalLength || 1200,
    telescopeState.eyepieceFocalLength,
    telescopeState.isBarlowActive
  );
  const mainFovDeg = getTrueFOV(activeEyepiece.afovDeg, mainMagnification);
  const currentSkyOffset = telescopeState.activeTarget
    ? computeSkyOffsetDeg(
        telescopeState.activeTarget,
        telescopeState.pointingAlt,
        telescopeState.pointingAz,
        telescopeState.observerLocation.latitude,
        telescopeState.observerLocation.longitude,
        getDriftGentledSimTime(
          telescopeState.simTime,
          telescopeState.driftAnchorSimTime,
          modeRules.driftMultiplier,
          telescopeState.isTrackingMotorOn
        )
      )
    : null;
  const offsetMagnitudeDeg =
    currentSkyOffset ? Math.hypot(currentSkyOffset.dAlt, currentSkyOffset.dAz) : 0;
  const isAlignmentUnlocked =
    !!telescopeState.activeTarget &&
    offsetMagnitudeDeg < Math.max(0.3, mainFovDeg * modeRules.alignmentLockThresholdFovFraction);

  // ── 'astrophotography' mode: instructor rule evaluation on settings change ──
  useEffect(() => {
    if (mode !== 'astrophotography') return;
    const targetId = telescopeState.activeTarget?.id || 'saturn';
    const evalResult = evaluateAstroPhotoRules({
      mode: astroMode,
      targetId,
      exposureMs: astroMode === 'planetary' ? planetaryExposureMs : undefined,
      frameCutoff: astroMode === 'planetary' ? frameCutoff : undefined,
      subExposures: astroMode === 'dso' ? dsoSubCount : undefined,
      subExposureTimeSec: astroMode === 'dso' ? dsoSubExposureSec : undefined,
      trackingLocked: trackingLock,
      hasDarkFrames: darkFrameCount > 0,
      darkFrameCount,
      iso: dsoIso,
    });
    setAstroInstructor(evalResult.instructorResponse?.message?.text || null);
  }, [mode, astroMode, planetaryExposureMs, frameCutoff, dsoSubExposureSec, dsoSubCount, dsoIso, trackingLock, darkFrameCount, telescopeState.activeTarget]);

  // Reset capture/calibration state when switching between planetary and DSO.
  useEffect(() => {
    setLastGrade(null);
    setHasRecording(false);
    setDarkFrameCount(0);
    setHasDarksApplied(false);
  }, [astroMode]);

  // Shared render loop for both feeds
  //
  // ── Phase 28 performance fix ──────────────────────────────────────
  // This used to depend on `[alignmentState, telescopeState, progressState, ...]`
  // directly. `alignmentState.updateOffsets(deltaTime)` — called on every
  // single frame below — always produces a NEW useAlignmentStore reference
  // (Zustand replaces the state object on every `set()`, even when the
  // computed values are unchanged), which made this effect's dependency
  // change on every rendered frame: React tore the whole rAF loop down and
  // rebuilt it (new closure, new requestAnimationFrame) 60×/sec, forever,
  // even at complete rest. Fixed the same way ObservatoryScene.tsx's
  // useFrame loops already do it: read the stores fresh via `.getState()`
  // INSIDE the loop (actions are stable references, so this needs no
  // dependency at all) instead of closing over the React-subscribed values.
  useEffect(() => {
    let animationId: number;
    let lastTime = performance.now();
    let lastDrawTime = 0;
    // Raw STORE pointing from the previous frame (Phase 32) — detects mount
    // motion this loop didn't cause itself, i.e. the 3D grab-the-tube drag in
    // ObservatoryScene. Deliberately the store fields, not the motor-derived
    // `pointing` below: with the motor on that derivation moves every frame
    // by construction (while the rendered field stays still), which would
    // defeat the idle throttle permanently.
    let lastStoreAlt = NaN;
    let lastStoreAz = NaN;

    const render = () => {
      const now = performance.now();
      const deltaTime = now - lastTime;
      lastTime = now;

      const telescope = useTelescopeStore.getState();
      const alignment = useAlignmentStore.getState();
      const progress = useProgressStore.getState();

      // Update alignment state physics
      alignment.updateOffsets(deltaTime);
      alignment.checkAlignment(modeRules.alignmentSnapPx);

      // ── Slew D-Pad (Phase 29): apply the held direction as a smooth,
      // FOV-proportional angular velocity on the REAL mount pointing. Both
      // feeds (and the 3D tube) follow automatically — they all read the
      // same pointingAlt/Az.
      const slewDir = slewDirRef.current;
      if (slewDir.dAlt !== 0 || slewDir.dAz !== 0) {
        const fovNow = getTrueFOV(
          activeEyepiece.afovDeg,
          getMagnification(telescope.activeProfile?.focalLength || 1200, telescope.eyepieceFocalLength, telescope.isBarlowActive)
        );
        const degPerSec = Math.max(0.05, fovNow * SLEW_FOV_FRACTION_PER_SEC);
        const step = degPerSec * (deltaTime / 1000);
        telescope.setPointing(
          telescope.pointingAlt + slewDir.dAlt * step,
          telescope.pointingAz + slewDir.dAz * step
        );
      }

      const activeTarget = telescope.activeTarget;
      const activeProfile = telescope.activeProfile;

      if (activeProfile) {
        const magnification = getMagnification(activeProfile.focalLength, telescope.eyepieceFocalLength, telescope.isBarlowActive);
        const observer = telescope.observerLocation;

        // ── Smooth Relativistic Drift (Phase 29) ──
        // Millisecond-interpolated simulation time from the time engine —
        // the store's 1 Hz simTime mirror is only for React UI. Everything
        // this loop draws derives from THIS value, so drift glides.
        const simTimeSmooth = getSmoothSimTime(now);

        // With the sidereal motor engaged, derive the mount's pointing from
        // the tracked RA/Dec at the SAME smooth time — the store's 1 Hz
        // pointing snapshot would otherwise make the field wobble against
        // the smoothly-drifting starfield.
        let pointing = { alt: telescope.pointingAlt, az: telescope.pointingAz };
        if (telescope.isTrackingMotorOn && telescope.trackedEquatorial) {
          const p = convertEquatorialToHorizontal(
            telescope.trackedEquatorial.ra, telescope.trackedEquatorial.dec,
            observer.latitude, observer.longitude,
            new Date(simTimeSmooth)
          );
          pointing = { alt: p.altitude, az: p.azimuth };
        }

        // ── Physical solar-pointing hazard (Phase 35) ── The universal sky
        // draws the Sun wherever the tube crosses it, target lock or not —
        // so the safety interlock watches the mount's PHYSICAL pointing
        // against the LIVE solar ephemeris (computeSkyOffsetDeg resolves the
        // Sun through getBodyEquatorial), not just the UI selection. Only an
        // actually-risen Sun (same −1° grace as the render cull) is a hazard.
        const sunOffset = computeSkyOffsetDeg(
          TARGETS.sun, pointing.alt, pointing.az,
          observer.latitude, observer.longitude, simTimeSmooth
        );
        const isPhysicallyPointedAtSun = !!sunOffset
          && pointing.alt + sunOffset.dAlt > -1
          && Math.hypot(sunOffset.dAlt, sunOffset.dAz) < SUN_HAZARD_RADIUS_DEG;

        const evalResult = evaluateState({
          isDustCapOn: telescope.isDustCapOn,
          isSolarFilterAttached: telescope.isSolarFilterAttached,
          targetId: activeTarget?.id || 'saturn',
          magnification,
          seeingQuality: telescope.seeingQuality,
          isAltTensionLocked: telescope.isAltTensionLocked,
          isMechanicallyBalanced: telescope.isMechanicallyBalanced,
          isCollimated: telescope.isCollimated,
          isMirrorCooled: telescope.isMirrorCooled,
          focuserPosition: telescope.focuserPosition,
          eyepieceFocalLength: telescope.eyepieceFocalLength,
          isBarlowActive: telescope.isBarlowActive,
          focusToleranceUnits: modeRules.focusToleranceUnits,
          enforceAtmosphericLimit: modeRules.atmosphericLimitEnforced,
          isPhysicallyPointedAtSun,
        });

        const finderFovDeg = getTrueFOV(FINDERSCOPE_APPARENT_FOV, FINDERSCOPE_MAG);
        const digitalZoom = telescope.isDigitalZoomOn && modeRules.digitalZoomAvailable ? 2 : 1;

        // ── Drift gentling in time (Phase 33) ── The LOCKED TARGET's
        // ephemeris clock runs at the mode's driftMultiplier rate (motor off
        // only), so Easy/Fun gentle passive drift while every manual slew
        // still pans the target 1:1 against the raw mount pointing in BOTH
        // feeds — the starfield always uses the true simTimeSmooth.
        const targetSimTime = getDriftGentledSimTime(
          simTimeSmooth,
          telescope.driftAnchorSimTime,
          modeRules.driftMultiplier,
          telescope.isTrackingMotorOn
        );

        // ── Dynamic Daylight (Phase 29) ── One sun-altitude sample shared
        // by both feeds this frame (Virtual Night override included).
        const sky = getSkyState(observer.latitude, observer.longitude, simTimeSmooth, telescope.isVirtualNight);

        const mainTrueFovDeg = getTrueFOV(activeEyepiece.afovDeg, magnification);
        // Set inside the 'astrophotography' > 'planetary' overlay below;
        // read afterward by the filter computation, which lives outside the
        // `if (ctx)` block the overlay itself runs in.
        let astroSharpness = 1;

        // ── Canvas Render Throttling (Phase 28, reworked for Phase 29) ──
        // Skip the expensive renderOpticalView + overlay draw calls when
        // nothing on screen would actually change. "The sky is moving" is
        // now a RATE question, not a target question: the real starfield
        // drifts whenever the motor is off, but below ~2 px/sec on the main
        // canvas the 5 fps idle cadence renders it imperceptibly smoothly
        // anyway (wide fields, 1× time). Only when apparent motion is fast
        // enough to look choppy (high power, or 10×/60× playback) does the
        // loop hold the full frame rate. Physics and achievement checks
        // above/below this point still run every frame — only the
        // pixel-pushing itself is throttled.
        const isDragging = trackDragRef.current.active || alignment.angularVelocityX !== 0 || alignment.angularVelocityY !== 0
          || slewDir.dAlt !== 0 || slewDir.dAz !== 0;
        // Mount moved since last frame (3D tube drag / any external
        // setPointing) — the starfield must pan at full framerate, exactly
        // like the local drag paths above. With the motor engaged the store
        // pointing only refreshes at App.tsx's ~1 Hz sync, so this adds a
        // negligible one redraw per second there.
        const pointingMoved = telescope.pointingAlt !== lastStoreAlt || telescope.pointingAz !== lastStoreAz;
        lastStoreAlt = telescope.pointingAlt;
        lastStoreAz = telescope.pointingAz;
        const mainDriftPxPerSec = mainTrueFovDeg > 0
          ? (SIDEREAL_DEG_PER_SEC * telescope.timeRate / mainTrueFovDeg) * MAIN_CANVAS_PX
          : 0;
        const skyVisiblyMoving = !telescope.isTrackingMotorOn && mainDriftPxPerSec > 2;
        const isTrackEngaged = mode === 'track' && !!activeTarget && !trackCompletedRef.current;
        const needsLiveRedraw =
          isDragging || pointingMoved || skyVisiblyMoving || evalResult.isAtmosphericBlurActive || evalResult.isAltDrooping || isTrackEngaged;
        const shouldDraw = needsLiveRedraw || (now - lastDrawTime) >= IDLE_REDRAW_INTERVAL_MS;

        if (shouldDraw) {
          lastDrawTime = now;

          const mainCanvas = mainCanvasRef.current;
          if (mainCanvas) {
            const ctx = mainCanvas.getContext('2d');
            if (ctx) {
              renderOpticalView(ctx, {
                role: 'main',
                viewportPx: mainCanvas.width,
                trueFovDeg: mainTrueFovDeg,
                pointing,
                rotate180: activeProfile.isInvertedView,
                targetSimTime,
                digitalZoom,
                evalResult,
                isHighPerformanceMode: telescope.isHighPerformanceMode,
                aperture: activeProfile.aperture,
                target: activeTarget ?? null,
                skyBodies: UNIVERSAL_SKY_BODIES,
                assets: telescope.loadedAssets,
                observer,
                simTime: simTimeSmooth,
                now,
                sunAltDeg: sky.sunAltDeg,
                isAltAzMount: activeProfile.mountType !== 'Equatorial',
              });

              // ── 'track' mode overlay: mechanical droop + reticle + lock timer ──
              // Ported from DobsonianTrainer, now driving REAL pointingAlt/Az
              // (via setPointing) instead of a private pixel accumulator, so it
              // shares the exact same ephemeris drift as every other mode.
              if (mode === 'track' && activeTarget) {
                if (!telescope.isMechanicallyBalanced) {
                  telescope.setPointing(
                    telescope.pointingAlt - mainTrueFovDeg * TRACK_DROOP_FRACTION_PER_SEC * (deltaTime / 1000),
                    telescope.pointingAz
                  );
                }

                // Same gentled clock as the render — the reticle judges the
                // target exactly where the student sees it.
                const trackSkyOffset = computeSkyOffsetDeg(
                  activeTarget, pointing.alt, pointing.az,
                  observer.latitude, observer.longitude, targetSimTime
                );
                const { px, py } = projectSkyOffsetPx(trackSkyOffset, mainTrueFovDeg, mainCanvas.width);
                const dist = Math.hypot(px, py);
                const isInReticle = dist < TRACK_RETICLE_RADIUS_PX;
                const cx = mainCanvas.width / 2;
                const cy = mainCanvas.height / 2;

                // Reticle ring
                ctx.beginPath();
                ctx.arc(cx, cy, TRACK_RETICLE_RADIUS_PX, 0, Math.PI * 2);
                ctx.strokeStyle = isInReticle ? 'rgba(0, 255, 0, 0.6)' : 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 4]);
                ctx.stroke();
                ctx.setLineDash([]);

                // Center cross
                ctx.beginPath();
                ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
                ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
                ctx.strokeStyle = isInReticle ? 'rgba(0, 255, 0, 0.5)' : 'rgba(255, 255, 255, 0.2)';
                ctx.lineWidth = 1;
                ctx.stroke();

                // Lock timer
                if (!trackCompletedRef.current) {
                  if (isInReticle) {
                    trackLockTimerRef.current += deltaTime;
                    if (trackLockTimerRef.current >= TRACK_LOCK_DURATION_MS) {
                      trackCompletedRef.current = true;
                      progress.unlockAchievement('night_sky_navigator');
                      progress.completeModule('dobsonian_trainer');
                    }
                  } else {
                    trackLockTimerRef.current = 0;
                  }

                  const lockProgress = Math.min(trackLockTimerRef.current / TRACK_LOCK_DURATION_MS, 1);
                  if (lockProgress > 0) {
                    ctx.beginPath();
                    ctx.arc(cx, cy, TRACK_RETICLE_RADIUS_PX + 6, -Math.PI / 2, -Math.PI / 2 + lockProgress * Math.PI * 2);
                    ctx.strokeStyle = `rgba(0, 255, 100, ${0.5 + lockProgress * 0.5})`;
                    ctx.shadowColor = '#00ff66';
                    ctx.shadowBlur = 8;
                    ctx.lineWidth = 3;
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                  }

                  const secondsLeft = Math.max(0, (TRACK_LOCK_DURATION_MS - trackLockTimerRef.current) / 1000);
                  ctx.font = 'bold 12px monospace';
                  ctx.textAlign = 'center';
                  ctx.fillStyle = isInReticle ? '#00ff66' : 'rgba(255,255,255,0.4)';
                  ctx.fillText(isInReticle ? `${secondsLeft.toFixed(1)}s` : 'CENTRE TARGET', cx, cy + TRACK_RETICLE_RADIUS_PX + 24);
                } else {
                  ctx.font = 'bold 14px sans-serif';
                  ctx.textAlign = 'center';
                  ctx.shadowColor = '#00ff66';
                  ctx.shadowBlur = 15;
                  ctx.fillStyle = '#00ff66';
                  ctx.fillText('TRACKING LOCKED', cx, cy - TRACK_RETICLE_RADIUS_PX - 18);
                  ctx.font = 'bold 10px sans-serif';
                  ctx.fillText('Night Sky Navigator 🏆', cx, cy - TRACK_RETICLE_RADIUS_PX - 4);
                  ctx.shadowBlur = 0;
                }

                // Instructional hint
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                const hintText = activeTarget.type === 'terrestrial'
                  ? (activeProfile.isInvertedView ? 'INVERTED VIEW — terrestrial objects appear upside-down!' : 'Terrestrial objects appear right-side up on this scope.')
                  : (activeProfile.isInvertedView ? 'INVERTED VIEW — drag OPPOSITE to your instinct to track' : 'Drag to track — this scope shows a natural, non-inverted view');
                ctx.fillText(hintText, cx, 20);

                if (dist > (mainCanvas.width / 2 - 5) * 0.8) {
                  ctx.font = 'bold 12px sans-serif';
                  ctx.fillStyle = '#ff4444';
                  ctx.fillText('TARGET LEAVING FIELD!', cx, mainCanvas.height - 16);
                }
              }

              // ── 'astrophotography' mode overlay: a POST-PROCESS pass on top of
              // the exact same renderOpticalView output every other mode shares
              // (ported from AstroPhotoTrainer, P27.4) — no siloed canvas, no
              // duplicated target renderers. Aperture brightness and defocus
              // bokeh are already baked into the base render above; this layer
              // only adds exposure/stacking/calibration-driven effects on top.
              if (mode === 'astrophotography' && activeTarget && !evalResult.isBlackedOut && !evalResult.hasSolarHazard) {
                const targetId = activeTarget.id;

                if (astroMode === 'planetary') {
                  astroSharpness = calculatePlanetarySharpness(frameCutoff, telescope.seeingQuality);

                  ctx.save();
                  ctx.fillStyle = 'rgba(0,0,0,0.6)';
                  ctx.fillRect(10, mainCanvas.height - 30, 120, 18);
                  ctx.fillStyle = astroSharpness > 0.7 ? '#00ff88' : astroSharpness > 0.4 ? '#ffcc00' : '#ff4444';
                  ctx.fillRect(12, mainCanvas.height - 28, 116 * astroSharpness, 14);
                  ctx.font = '9px monospace'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
                  ctx.fillText(`SHARPNESS ${Math.round(astroSharpness * 100)}%`, 14, mainCanvas.height - 18);
                  ctx.restore();
                } else {
                  const isStackedView = lastGrade !== null && !isCapturingDso;
                  const liveViewSnr = calculateDsoSNR(1, dsoSubExposureSec, dsoIso) * 1.5;
                  const snr = isStackedView ? calculateDsoSNR(dsoSubCount, dsoSubExposureSec, dsoIso) : liveViewSnr;
                  const visibility = Math.min(1, snr / 30);
                  const isTrailing = !trackingLock && dsoSubExposureSec > 2;

                  // Untracked subs smear into star trails — ghost the frame
                  // that's already on the canvas a few times at a small offset
                  // (a real post-process: re-composite the rendered bitmap,
                  // not a from-scratch redraw).
                  if (isTrailing) {
                    ctx.save();
                    ctx.globalAlpha = 0.35;
                    for (let i = 1; i <= 4; i++) {
                      ctx.drawImage(mainCanvas, i * 1.5, i * 0.4);
                    }
                    ctx.restore();
                  }

                  // "Developing out of the noise": veil the already-rendered
                  // target with a black overlay that fades as SNR climbs —
                  // generalizes AstroPhotoTrainer's old per-target SNR alpha
                  // to whatever renderOpticalView drew, faint objects included.
                  ctx.save();
                  ctx.fillStyle = '#020206';
                  ctx.globalAlpha = Math.max(0, 1 - visibility);
                  ctx.fillRect(0, 0, mainCanvas.width, mainCanvas.height);
                  ctx.restore();

                  if (!hasDarksApplied && dsoSubCount >= 3) {
                    ctx.save();
                    ctx.globalAlpha = Math.min(1, dsoSubCount / 10) * 0.9;
                    for (let i = 0; i < 24; i++) {
                      const hx = (i * 137.5) % mainCanvas.width;
                      const hy = (i * 97.3) % mainCanvas.height;
                      ctx.fillStyle = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff'][i % 4];
                      ctx.fillRect(hx, hy, 2, 2);
                    }
                    ctx.restore();
                  }

                  ctx.save();
                  ctx.fillStyle = 'rgba(0,0,0,0.6)';
                  ctx.fillRect(10, mainCanvas.height - 30, 140, 18);
                  ctx.fillStyle = snr > 20 ? '#00ff88' : snr > 10 ? '#ffcc00' : '#ff4444';
                  ctx.fillRect(12, mainCanvas.height - 28, Math.min(136, 136 * (snr / 35)), 14);
                  ctx.font = '9px monospace'; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
                  ctx.fillText(`SNR ${snr.toFixed(1)} dB`, 14, mainCanvas.height - 18);
                  ctx.restore();
                }

                if (isBahtinovMaskOn && targetId !== 'sun' && targetId !== 'moon') {
                  const perfectFocusPoint = getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
                  const defocusSigned = telescope.focuserPosition - perfectFocusPoint;
                  ctx.save();
                  ctx.translate(mainCanvas.width / 2, mainCanvas.height / 2);
                  ctx.globalCompositeOperation = 'screen';
                  ctx.strokeStyle = 'rgba(255, 100, 100, 0.8)';
                  ctx.lineWidth = 2;
                  ctx.shadowBlur = 10;
                  ctx.shadowColor = 'rgba(255, 100, 100, 1)';
                  ctx.beginPath();
                  ctx.moveTo(-110, -75); ctx.lineTo(110, 75);
                  ctx.moveTo(-110, 75); ctx.lineTo(110, -75);
                  ctx.stroke();
                  const shift = defocusSigned * 3.5;
                  ctx.strokeStyle = 'rgba(100, 255, 100, 0.9)';
                  ctx.shadowColor = 'rgba(100, 255, 100, 1)';
                  ctx.beginPath();
                  ctx.moveTo(shift, -110); ctx.lineTo(shift, 110);
                  ctx.stroke();
                  ctx.restore();
                }

                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(mainCanvas.width / 3, 0); ctx.lineTo(mainCanvas.width / 3, mainCanvas.height);
                ctx.moveTo(mainCanvas.width * 2 / 3, 0); ctx.lineTo(mainCanvas.width * 2 / 3, mainCanvas.height);
                ctx.moveTo(0, mainCanvas.height / 3); ctx.lineTo(mainCanvas.width, mainCanvas.height / 3);
                ctx.moveTo(0, mainCanvas.height * 2 / 3); ctx.lineTo(mainCanvas.width, mainCanvas.height * 2 / 3);
                ctx.stroke();
                ctx.restore();

                ctx.save();
                ctx.font = '10px monospace';
                ctx.fillStyle = '#00ff00';
                ctx.textAlign = 'left';
                ctx.fillText(astroMode === 'planetary' ? 'LUCKY IMG' : 'DSO STACK', 10, 18);
                ctx.fillText(astroMode === 'planetary' ? `CUT ${frameCutoff}%` : `SUBS ${dsoSubCount}×${dsoSubExposureSec}s`, 10, 32);
                ctx.textAlign = 'right';
                ctx.fillStyle = (astroMode === 'dso' && trackingLock) || astroMode === 'planetary' ? '#00ff00' : '#ff0000';
                ctx.fillText(astroMode === 'dso' ? `TRK ${trackingLock ? 'ON' : 'OFF'}` : 'FPS 60', mainCanvas.width - 10, 18);
                if (astroMode === 'dso') {
                  ctx.fillStyle = hasDarksApplied ? '#00ff00' : darkFrameCount > 0 ? '#ffcc00' : '#ff4444';
                  ctx.fillText(hasDarksApplied ? 'CAL ✓' : darkFrameCount > 0 ? `DARKS: ${darkFrameCount}` : 'NO CAL', mainCanvas.width - 10, 32);
                }
                ctx.restore();

                if (lastGrade) {
                  ctx.save();
                  ctx.font = 'bold 20px sans-serif';
                  ctx.textAlign = 'left';
                  ctx.fillStyle = lastGrade.startsWith('A') ? '#34d399' : lastGrade === 'B' ? '#22d3ee' : '#f87171';
                  ctx.shadowColor = 'rgba(0,0,0,0.8)';
                  ctx.shadowBlur = 6;
                  ctx.fillText(lastGrade, 14, 56);
                  ctx.shadowBlur = 0;
                  ctx.restore();
                }
              }
            }
            // Defocus blur on the canvas DOM element (screen-space, separate from
            // the in-context blur applied during drawing). Set imperatively so it
            // stays in lockstep with the rAF-drawn content instead of React's
            // (much less frequent) render cycle; skip redundant writes. In
            // 'astrophotography' > 'planetary', a genuinely POOR stack also
            // adds softness here — the ONE place aperture/defocus/lucky-imaging
            // blur all combine, instead of each mode reimplementing its own.
            //
            // Phase 33 fix: this used to be (1 − sharpness) × 4, which blurred
            // the live planet at ALL times — even at perfect focus with sane
            // settings (default 50% cutoff in average seeing ⇒ sharpness 0.45
            // ⇒ a permanent 2.2px smear). Softness now only kicks in BELOW the
            // sharpness the default settings achieve: a focused planet renders
            // crisp, and only genuinely bad frame selection (cutoff → 100% in
            // poor seeing) degrades the live composite. Stack quality above
            // that line is still fully graded via the SHARPNESS bar + capture.
            const astroBlurPx = mode === 'astrophotography' && astroMode === 'planetary'
              ? Math.max(0, ASTRO_CLEAN_SHARPNESS - astroSharpness) * 6
              : 0;
            const defocusBlurPx = evalResult.isDefocused ? evalResult.defocusAmount * 0.5 : 0;
            const totalBlurPx = defocusBlurPx + astroBlurPx;
            // > 0.05 (not > 0): float residue from the sharpness subtraction
            // (e.g. 3e-16) must resolve to a true 'none', both for the
            // skip-redundant-writes fast path and for an honestly crisp view.
            const filterStr = totalBlurPx > 0.05 ? `blur(${totalBlurPx}px)` : 'none';
            if (filterStr !== lastMainFilterRef.current) {
              mainCanvas.style.filter = filterStr;
              lastMainFilterRef.current = filterStr;
            }
          }

          const finderCanvas = finderCanvasRef.current;
          if (finderCanvas) {
            const ctx = finderCanvas.getContext('2d');
            if (ctx) {
              renderOpticalView(ctx, {
                role: 'finder',
                viewportPx: finderCanvas.width,
                trueFovDeg: finderFovDeg,
                pointing,
                axisErrorDeg: telescope.finderscopeError,
                legacyAlignmentOffsetPx: { x: alignment.offsetX, y: alignment.offsetY },
                isCrosshairAligned: alignment.isAligned,
                targetSimTime,
                evalResult,
                isHighPerformanceMode: telescope.isHighPerformanceMode,
                aperture: activeProfile.aperture,
                target: activeTarget ?? null,
                skyBodies: UNIVERSAL_SKY_BODIES,
                assets: telescope.loadedAssets,
                observer,
                simTime: simTimeSmooth,
                now,
                sunAltDeg: sky.sunAltDeg,
                isAltAzMount: activeProfile.mountType !== 'Equatorial',
              });
            }
          }
        }

        if (alignment.isAligned) {
          progress.unlockAchievement('first_alignment');
        }
      }

      animationId = requestAnimationFrame(render);
    };
    animationId = requestAnimationFrame(render);

    return () => cancelAnimationFrame(animationId);
  }, [
    modeRules, mode, activeEyepiece,
    astroMode, isBahtinovMaskOn, frameCutoff, dsoSubExposureSec, dsoSubCount, dsoIso,
    trackingLock, darkFrameCount, hasDarksApplied, isCapturingDso, lastGrade,
  ]);

  // Thumbscrew Controls (legacy px-based nudge, unchanged from FinderscopeGame)
  const createThumbscrewHandlers = (axis: 'X' | 'Y', direction: number) => {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        if (axis === 'X') {
           alignmentState.setAngularVelocity(direction * 15, alignmentState.angularVelocityY);
        } else {
           alignmentState.setAngularVelocity(alignmentState.angularVelocityX, direction * 15);
        }
      },
      onPointerUp: (e: React.PointerEvent) => {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        if (axis === 'X') {
           alignmentState.setAngularVelocity(0, alignmentState.angularVelocityY);
        } else {
           alignmentState.setAngularVelocity(alignmentState.angularVelocityX, 0);
        }
      },
      onPointerLeave: () => {
        if (axis === 'X') {
           alignmentState.setAngularVelocity(0, alignmentState.angularVelocityY);
        } else {
           alignmentState.setAngularVelocity(alignmentState.angularVelocityX, 0);
        }
      }
    };
  };

  // ── Slew D-Pad handlers (Phase 29) ── Mount-frame semantics, like a real
  // GoTo hand controller: ▲ = altitude up, ▶ = azimuth clockwise. The held
  // direction is applied inside the shared rAF loop (real elapsed time), and
  // released on up/leave/cancel so a dragged-away pointer can't leave the
  // mount creeping forever.
  const createSlewHandlers = (dAlt: number, dAz: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      // Engage the slew FIRST — setPointerCapture can throw for edge-case
      // pointers (stale/synthetic ids) and must never cancel the slew.
      slewDirRef.current = { dAlt, dAz };
      try {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } catch { /* capture is a nicety (keeps the hold if the pointer wanders); losing it is fine */ }
    },
    onPointerUp: (e: React.PointerEvent) => {
      slewDirRef.current = { dAlt: 0, dAz: 0 };
      try {
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch { /* never held */ }
    },
    onPointerLeave: () => { slewDirRef.current = { dAlt: 0, dAz: 0 }; },
    onPointerCancel: () => { slewDirRef.current = { dAlt: 0, dAz: 0 }; },
  });

  // ── 'track' mode: drag-to-slew the MAIN feed (ported from DobsonianTrainer) ──
  // Calls setPointing directly — NOT clearTarget — so the target stays locked
  // and the student is fighting real ephemeris drift, not manually slewing away.
  // The inversion sign flips with the ACTIVE PROFILE's isInvertedView (a real
  // refractor drags naturally; only a Newtonian/Dobsonian feels "backwards" —
  // the old DobsonianTrainer always inverted regardless of profile, a latent
  // inaccuracy this fixes).
  const handleTrackPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    trackDragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY };
  };
  const handleTrackPointerMove = (e: React.PointerEvent) => {
    if (!trackDragRef.current.active) return;
    const dx = e.clientX - trackDragRef.current.lastX;
    const dy = e.clientY - trackDragRef.current.lastY;
    trackDragRef.current.lastX = e.clientX;
    trackDragRef.current.lastY = e.clientY;
    if (dx === 0 && dy === 0) return;

    const store = useTelescopeStore.getState();
    const mag = getMagnification(store.activeProfile?.focalLength || 1200, store.eyepieceFocalLength, store.isBarlowActive);
    const fov = getTrueFOV(activeEyepiece.afovDeg, mag);
    // WYSIWYG term: converts pixel motion into the angular motion that
    // keeps the RENDERED target under the cursor (see skyGeometry's inverse
    // fov/viewport mapping) — by itself this makes on-screen sensitivity a
    // constant 1:1 at any zoom. dragSensitivity below is what actually
    // varies the on-screen FEEL with magnification (see the Phase 30
    // comment on its constants, above).
    const degPerPx = fov / MAIN_CANVAS_PX;
    const dragSensitivity = Math.max(
      DRAG_SENSITIVITY_MIN,
      Math.min(DRAG_SENSITIVITY_MAX, fov / DRAG_SENSITIVITY_REFERENCE_FOV_DEG)
    );
    const invert = store.activeProfile?.isInvertedView ?? false;
    const azSign = invert ? 1 : -1;
    const altSign = invert ? -1 : 1;

    store.setPointing(
      store.pointingAlt + altSign * dy * degPerPx * dragSensitivity,
      store.pointingAz + azSign * dx * degPerPx * dragSensitivity
    );
  };
  const handleTrackPointerUp = (e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    trackDragRef.current.active = false;
  };

  // ── 'astrophotography' mode: capture/grading handlers (ported from
  // AstroPhotoTrainer, P27.4). Logbook tags/grade strings and achievement
  // calls are preserved EXACTLY — missionEngine.ts's saturn_recon/orion_dso
  // steps string-match these tags, so any change here would silently break
  // mission validation.
  const handlePlanetaryCapture = () => {
    if (!hasRecording) return;
    setIsCapturing(true);
    setTimeout(() => {
      const currentDefocus = Math.abs(telescopeState.focuserPosition - getPerfectFocusPoint(telescopeState.eyepieceFocalLength, telescopeState.isBarlowActive));
      const sharpness = calculatePlanetarySharpness(frameCutoff, telescopeState.seeingQuality);
      let grade: string;
      const tags: string[] = ['Planetary', 'Lucky Imaging'];

      if (currentDefocus > 2) {
        grade = 'F'; tags.push('Grade: F', 'Out of Focus');
        setAstroInstructor("Your exposure settings were good, but the telescope was out of focus! In astrophotography, even a tiny focus error ruins the image. Adjust the focuser knob to exactly 50 and try again.");
      } else {
        if (sharpness >= 0.85) { grade = 'A+'; tags.push('Grade: A+', 'Cassini Division Visible'); }
        else if (sharpness >= 0.7) { grade = 'A'; tags.push('Grade: A', 'Clean Stack'); }
        else if (sharpness >= 0.55) { grade = 'B'; tags.push('Grade: B'); }
        else if (sharpness >= 0.35) { grade = 'C'; tags.push('Grade: C', 'Atmospheric Blur'); }
        else { grade = 'F'; tags.push('Grade: F', 'Too Many Bad Frames'); }
        if (frameCutoff <= 20) tags.push('Lucky ≤20%');
      }

      const entry: LogbookEntry = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        targetId: telescopeState.activeTarget?.id || 'saturn',
        magnification: 1,
        seeingQuality: telescopeState.seeingQuality,
        tags,
        customNote: `Planetary Lucky Imaging: ${totalFrames} frames, top ${frameCutoff}% stacked. Sharpness: ${Math.round(sharpness * 100)}%. Grade: ${grade}`,
      };
      progressState.addLogbookEntry(entry);
      progressState.completeModule('astrophoto_trainer');
      setLastGrade(grade);
      setIsCapturing(false);
    }, 600);
  };

  const handleRecordVideo = () => {
    setIsRecording(true);
    setTimeout(() => {
      setIsRecording(false);
      setHasRecording(true);
    }, 1500);
  };

  const handleDsoCapture = () => {
    setIsCapturingDso(true);
    setTimeout(() => {
      const currentDefocus = Math.abs(telescopeState.focuserPosition - getPerfectFocusPoint(telescopeState.eyepieceFocalLength, telescopeState.isBarlowActive));
      const snr = calculateDsoSNR(dsoSubCount, dsoSubExposureSec, dsoIso);
      const isTrailing = !trackingLock && dsoSubExposureSec > 2;
      let grade: string;
      const tags: string[] = ['Deep Sky', 'DSO Stack'];

      let score = Math.min(100, snr * 3);
      if (isTrailing) { score -= 40; tags.push('Star Trailed'); }
      if (!hasDarksApplied && dsoSubCount >= 3) { score -= 20; tags.push('Hot Pixels'); }
      if (hasDarksApplied) tags.push('Dark Calibrated');

      if (currentDefocus > 2) {
        grade = 'F'; tags.push('Grade: F', 'Out of Focus');
        setAstroInstructor("Your exposure settings were good, but the telescope was out of focus! In astrophotography, even a tiny focus error ruins the image. Adjust the focuser knob to exactly 50 and try again.");
      } else {
        if (score >= 90) { grade = 'A+'; tags.push('Grade: A+', 'Publication Quality'); }
        else if (score >= 75) { grade = 'A'; tags.push('Grade: A', 'Clean Integration'); }
        else if (score >= 60) { grade = 'B'; tags.push('Grade: B'); }
        else if (score >= 40) { grade = 'C'; tags.push('Grade: C'); }
        else { grade = 'F'; tags.push('Grade: F', 'Needs Work'); }
      }

      const entry: LogbookEntry = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        targetId: telescopeState.activeTarget?.id || 'm42',
        magnification: 1,
        seeingQuality: telescopeState.seeingQuality,
        tags,
        customNote: `DSO Stack: ${dsoSubCount}×${dsoSubExposureSec}s at ISO ${dsoIso}. SNR: ${snr.toFixed(1)}. Tracking: ${trackingLock ? 'ON' : 'OFF'}. Darks: ${hasDarksApplied ? 'Applied' : 'None'}. Grade: ${grade}`,
      };
      progressState.addLogbookEntry(entry);
      progressState.completeModule('astrophoto_trainer');

      if (hasDarksApplied && grade !== 'F') {
        progressState.unlockAchievement('deep_sky_astrophotographer');
      }

      setLastGrade(grade);
      setIsCapturingDso(false);
    }, 800);
  };

  const handleCaptureDarks = () => {
    if (!telescopeState.isDustCapOn) {
      setAstroInstructor("Put the Dust Cap ON first! Dark frames must be taken with no light entering the telescope, matching the same exposure time.");
      return;
    }
    setDarkFrameCount((prev) => prev + 5);
  };

  const handleApplyCalibration = () => {
    if (darkFrameCount >= 5) {
      setHasDarksApplied(true);
      setAstroInstructor("Dark frame calibration applied! The thermal hot pixels have been subtracted from your integration. Your image is now cleaner.");
    }
  };

  return (
    <div data-tour-id="tour-canvases" className="flex flex-col md:flex-row gap-6 p-4 justify-center items-center h-full">
      {/* Main Eyepiece Viewport */}
      <div className="flex flex-col items-center">
        <h3 className="text-white font-semibold mb-2 tracking-wide font-mono uppercase">{t('liveview.mainEyepiece')}</h3>
        <div className="relative">
          <canvas
            ref={mainCanvasRef}
            width={MAIN_CANVAS_PX}
            height={MAIN_CANVAS_PX}
            className={`bg-black rounded-full shadow-2xl border-4 border-slate-800 ${mode === 'track' ? 'cursor-grab active:cursor-grabbing touch-none' : ''}`}
            onPointerDown={mode === 'track' ? handleTrackPointerDown : undefined}
            onPointerMove={mode === 'track' ? handleTrackPointerMove : undefined}
            onPointerUp={mode === 'track' ? handleTrackPointerUp : undefined}
            onPointerLeave={mode === 'track' ? handleTrackPointerUp : undefined}
          />

          {/* ── Slew D-Pad (Phase 29) — hold to drive the mount; both feeds
              (and the 3D tube) shift together since they share pointingAlt/Az. */}
          <div
            title={t('tip.slewPad')}
            className="absolute right-0 bottom-0 grid grid-cols-3 grid-rows-3 gap-0.5 bg-slate-900/85 border border-slate-700 rounded-xl p-1 shadow-xl backdrop-blur-sm"
          >
            <div />
            <button
              {...createSlewHandlers(1, 0)}
              className="p-1.5 bg-slate-700 hover:bg-slate-600 active:bg-cyan-700 rounded text-white touch-none"
              aria-label="Slew up"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <div />
            <button
              {...createSlewHandlers(0, -1)}
              className="p-1.5 bg-slate-700 hover:bg-slate-600 active:bg-cyan-700 rounded text-white touch-none"
              aria-label="Slew left"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center justify-center">
              <span className="text-[7px] font-mono font-bold text-slate-500 uppercase tracking-wider">{t('liveview.slew')}</span>
            </div>
            <button
              {...createSlewHandlers(0, 1)}
              className="p-1.5 bg-slate-700 hover:bg-slate-600 active:bg-cyan-700 rounded text-white touch-none"
              aria-label="Slew right"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <div />
            <button
              {...createSlewHandlers(-1, 0)}
              className="p-1.5 bg-slate-700 hover:bg-slate-600 active:bg-cyan-700 rounded text-white touch-none"
              aria-label="Slew down"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <div />
          </div>
        </div>
      </div>

      {/* Finderscope Viewport */}
      <div className="flex flex-col items-center">
        <h3 className="text-white font-semibold mb-2 tracking-wide font-mono uppercase">{t('liveview.finderscope')}</h3>
        <div className="relative">
          <canvas
            ref={finderCanvasRef}
            width={FINDER_CANVAS_PX}
            height={FINDER_CANVAS_PX}
            className="bg-black rounded-full shadow-2xl border-4 border-slate-800"
          />

          {/* Virtual Thumbscrews — locked until the mount points at the target */}
          <div className="absolute -right-8 top-1/2 -translate-y-1/2 flex flex-col gap-2 bg-slate-800 p-2 rounded-xl">
            <span className="text-[10px] text-center font-mono text-slate-400">{t('common.alt')}</span>
            <button
              disabled={!isAlignmentUnlocked}
              className="p-3 bg-slate-700 active:bg-slate-600 rounded-full text-white touch-none disabled:opacity-30 disabled:cursor-not-allowed"
              {...createThumbscrewHandlers('Y', -1)}
              aria-label="Adjust Alt Up"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              disabled={!isAlignmentUnlocked}
              className="p-3 bg-slate-700 active:bg-slate-600 rounded-full text-white touch-none disabled:opacity-30 disabled:cursor-not-allowed"
              {...createThumbscrewHandlers('Y', 1)}
              aria-label="Adjust Alt Down"
            >
              <RotateCw className="w-5 h-5" />
            </button>
          </div>

          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex gap-2 bg-slate-800 p-2 rounded-xl">
             <span className="text-[10px] self-center font-mono text-slate-400 mr-2">{t('common.az')}</span>
            <button
              disabled={!isAlignmentUnlocked}
              className="p-3 bg-slate-700 active:bg-slate-600 rounded-full text-white touch-none disabled:opacity-30 disabled:cursor-not-allowed"
              {...createThumbscrewHandlers('X', -1)}
              aria-label="Adjust Azimuth Left"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
            <button
              disabled={!isAlignmentUnlocked}
              className="p-3 bg-slate-700 active:bg-slate-600 rounded-full text-white touch-none disabled:opacity-30 disabled:cursor-not-allowed"
              {...createThumbscrewHandlers('X', 1)}
              aria-label="Adjust Azimuth Right"
            >
              <RotateCw className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Finder Alignment Screws (angular error) — Phase 24/25 ──
            Nudges zero out finderscopeError; Scramble misaligns it per difficulty.
            Screws stay LOCKED until the main eyepiece is centered on a target.
            'align'-mode only — track/astro get their own caption panel below. */}
        {mode === 'align' && (
        <div className="mt-14 flex flex-col items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-xl p-2.5">
          <div className="flex items-center gap-2">
            <InfoTip tip={t('tip.finderError')}>
              <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{t('liveview.finderErrorLabel')}</span>
            </InfoTip>
            <span className={`text-[10px] font-mono ${
              Math.hypot(telescopeState.finderscopeError.deltaAlt, telescopeState.finderscopeError.deltaAz) < 0.05
                ? 'text-emerald-400' : 'text-amber-400'
            }`}>
              Δalt {telescopeState.finderscopeError.deltaAlt.toFixed(2)}° · Δaz {telescopeState.finderscopeError.deltaAz.toFixed(2)}°
            </span>
          </div>
          <InfoTip tip={t('tip.alignmentLock')} underline={false}>
            <span className={`flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wide ${
              isAlignmentUnlocked ? 'text-emerald-400' : 'text-slate-500'
            }`}>
              {isAlignmentUnlocked ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
              {isAlignmentUnlocked
                ? t('liveview.targetCentered')
                : t('liveview.centerToUnlock')}
            </span>
          </InfoTip>
          <div className="flex items-center gap-1.5">
            <button
              disabled={!isAlignmentUnlocked}
              onClick={() => telescopeState.adjustFinderscope(0.1, 0)}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Finder screw Alt up"
            >▲</button>
            <button
              disabled={!isAlignmentUnlocked}
              onClick={() => telescopeState.adjustFinderscope(-0.1, 0)}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Finder screw Alt down"
            >▼</button>
            <button
              disabled={!isAlignmentUnlocked}
              onClick={() => telescopeState.adjustFinderscope(0, -0.1)}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Finder screw Az left"
            >◀</button>
            <button
              disabled={!isAlignmentUnlocked}
              onClick={() => telescopeState.adjustFinderscope(0, 0.1)}
              className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white text-xs disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Finder screw Az right"
            >▶</button>
            <select
              value={telescopeState.alignmentDifficulty}
              onChange={(e) => telescopeState.setAlignmentDifficulty(e.target.value as AlignmentDifficulty)}
              className="bg-slate-700 text-slate-200 text-[10px] font-bold uppercase rounded px-1.5 py-1 cursor-pointer"
              aria-label="Alignment difficulty"
            >
              <option value="auto">{t('liveview.difficultyAuto')}</option>
              <option value="easy">{t('liveview.difficultyEasy')}</option>
              <option value="medium">{t('liveview.difficultyMedium')}</option>
              <option value="realistic">{t('liveview.difficultyRealistic')}</option>
            </select>
            <button
              onClick={() => telescopeState.scrambleFinderscope()}
              disabled={modeRules.finderErrorForcedZero}
              title={modeRules.finderErrorForcedZero ? 'Fun mode keeps the finder perfectly aligned' : 'Randomly misalign the finder for practice'}
              className="flex items-center gap-1 px-2 py-1 bg-amber-700 hover:bg-amber-600 rounded text-white text-[10px] font-bold uppercase tracking-wide disabled:opacity-30 disabled:cursor-not-allowed"
              aria-label="Scramble finder alignment"
            >
              <Shuffle className="w-3 h-3" /> {t('liveview.scramble')}
            </button>
          </div>
        </div>
        )}

        {/* 'track' mode caption — reticle/timer/hints render ON the canvas itself */}
        {mode === 'track' && (
          <p className="mt-14 text-xs text-slate-400 max-w-xs text-center leading-relaxed">
            {t('liveview.trackIntro')}
            {' '}
            {telescopeState.activeProfile?.isInvertedView ? t('liveview.trackInvertedNote') : t('liveview.trackNaturalNote')}
            {' '}{t('liveview.trackHoldInstruction')}
          </p>
        )}

        {/* 'astrophotography' mode caption — exposure/stacking/calibration desk.
            Reticle/HUD/grade badge render ON the main canvas itself (see the
            shared render loop above). */}
        {mode === 'astrophotography' && (
          <div className="mt-14 flex flex-col items-center gap-3 bg-slate-800/80 border border-slate-700 rounded-xl p-3 w-full max-w-sm">
            <div className="flex gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-700 w-full">
              <button
                onClick={() => setAstroMode('planetary')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${
                  astroMode === 'planetary' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" /> {t('liveview.planetary')}
              </button>
              <button
                onClick={() => setAstroMode('dso')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${
                  astroMode === 'dso' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="w-3.5 h-3.5" /> {t('liveview.deepSky')}
              </button>
            </div>

            <button
              onClick={() => setIsBahtinovMaskOn(!isBahtinovMaskOn)}
              className={`self-end flex items-center gap-1.5 py-1 px-2.5 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all border ${
                isBahtinovMaskOn ? 'bg-emerald-900/50 border-emerald-500 text-emerald-400' : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <Crosshair className="w-3 h-3" /> {t('liveview.bahtinov')}: {isBahtinovMaskOn ? t('common.on') : t('common.off')}
            </button>

            {astroInstructor && (
              <div className="w-full bg-indigo-950/50 border border-indigo-500/30 rounded-lg p-2.5 text-[10px] text-indigo-200 leading-relaxed">
                💡 {astroInstructor}
              </div>
            )}

            {astroMode === 'planetary' ? (
              <div className="flex flex-col gap-3 w-full">
                <div>
                  <label className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-1 flex justify-between">
                    <span>{t('liveview.frameExposure')}</span>
                    <span className="text-amber-400 font-mono">{planetaryExposureMs}ms</span>
                  </label>
                  <input type="range" min="5" max="500" step="5" value={planetaryExposureMs}
                    onChange={(e) => setPlanetaryExposureMs(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-1 flex justify-between">
                    <span>{t('liveview.stackCutoff')}</span>
                    <span className="text-cyan-400 font-mono">{t('liveview.topPct', { pct: frameCutoff })}</span>
                  </label>
                  <input type="range" min="5" max="100" step="5" value={frameCutoff}
                    onChange={(e) => setFrameCutoff(Number(e.target.value))}
                    className="w-full accent-cyan-500"
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={handleRecordVideo} disabled={isRecording || hasRecording}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold uppercase tracking-widest text-[9px] border transition-all ${
                      hasRecording ? 'bg-emerald-900/50 border-emerald-500 text-emerald-400' : 'bg-slate-900 border-slate-600 text-slate-300 hover:bg-slate-700'
                    } disabled:opacity-50`}>
                    {hasRecording ? t('liveview.captured') : isRecording ? t('liveview.recording') : t('liveview.recordN', { n: totalFrames })}
                  </button>
                  <button onClick={handlePlanetaryCapture} disabled={!hasRecording || isCapturing}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-bold uppercase tracking-widest text-[9px] bg-gradient-to-r from-amber-600 to-amber-500 text-white shadow hover:from-amber-500 hover:to-amber-400 disabled:opacity-40 transition-all active:scale-95">
                    <Camera className="w-3.5 h-3.5" /> {t('liveview.stackAndGrade')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3 w-full">
                <div>
                  <label className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-1 flex justify-between">
                    <span>{t('liveview.subExposure')}</span>
                    <span className="text-indigo-400 font-mono">{dsoSubExposureSec}s</span>
                  </label>
                  <input type="range" min="5" max="120" step="5" value={dsoSubExposureSec}
                    onChange={(e) => { setDsoSubExposureSec(Number(e.target.value)); setLastGrade(null); setHasDarksApplied(false); }}
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-1 flex justify-between">
                    <span>{t('liveview.subExposuresN')}</span>
                    <span className="text-indigo-400 font-mono">{dsoSubCount}</span>
                  </label>
                  <input type="range" min="1" max="30" step="1" value={dsoSubCount}
                    onChange={(e) => { setDsoSubCount(Number(e.target.value)); setLastGrade(null); }}
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mb-1 flex justify-between">
                    <span>{t('liveview.isoGain')}</span>
                    <span className="text-emerald-400 font-mono">{dsoIso}</span>
                  </label>
                  <input type="range" min="100" max="6400" step="100" value={dsoIso}
                    onChange={(e) => { setDsoIso(Number(e.target.value)); setLastGrade(null); setHasDarksApplied(false); }}
                    className="w-full accent-emerald-500"
                  />
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <button onClick={() => setTrackingLock(!trackingLock)}
                    className={`flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg font-bold uppercase tracking-widest text-[9px] border transition-colors ${
                      trackingLock ? 'bg-emerald-900/50 border-emerald-500 text-emerald-400' : 'bg-slate-900 border-slate-600 text-slate-400 hover:bg-slate-700'
                    }`}>
                    <TargetIcon className="w-3.5 h-3.5" /> {trackingLock ? t('liveview.trackingLocked') : t('liveview.trackingOff')}
                  </button>
                  <button onClick={handleCaptureDarks}
                    className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg font-bold uppercase tracking-widest text-[9px] bg-slate-900 border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors">
                    <Moon className="w-3.5 h-3.5" /> {darkFrameCount > 0 ? t('liveview.darksN', { n: darkFrameCount }) : t('liveview.darks')}
                  </button>
                  {darkFrameCount >= 5 && !hasDarksApplied && (
                    <button onClick={handleApplyCalibration}
                      className="flex items-center gap-1.5 py-1.5 px-2.5 rounded-lg font-bold uppercase tracking-widest text-[9px] bg-indigo-800 border border-indigo-500 text-indigo-200 hover:bg-indigo-700 transition-colors animate-pulse">
                      {t('liveview.applyCalibration')}
                    </button>
                  )}
                </div>
                <button onClick={handleDsoCapture} disabled={isCapturingDso || dsoSubCount < 1}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg font-bold uppercase tracking-widest text-[10px] bg-gradient-to-r from-indigo-600 to-indigo-500 text-white shadow hover:from-indigo-500 hover:to-indigo-400 disabled:opacity-40 transition-all active:scale-95">
                  <Camera className="w-4 h-4" /> {t('liveview.stackSubsAndGrade', { n: dsoSubCount })}
                </button>
              </div>
            )}

            <p className="text-[9px] text-slate-500 text-center leading-relaxed">
              {astroMode === 'planetary' ? t('liveview.planetaryFooterHint') : t('liveview.dsoFooterHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LiveViewPanel;
