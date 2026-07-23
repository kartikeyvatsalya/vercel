import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { useTranslation, type TranslationKey } from '../../engine/i18n';
import { X } from 'lucide-react';

/**
 * OnboardingTour — Phase 30
 * ─────────────────────────────────────────────────────────────────
 * A lightweight, dependency-free step-by-step tour: no external library,
 * just a fixed-position spotlight (the classic "huge box-shadow around a
 * transparent hole" trick) plus a floating tooltip card. `tourStep` lives in
 * the store (0 = inactive, 1+ = which step); THIS component owns the step
 * count and copy, so the store never needs to know where the tour ends —
 * its "Finish" button calls `endTour()` directly on the last step instead
 * of `advanceTour()`.
 *
 * The steps point at DOM elements tagged `data-tour-id="..."` spread across
 * App.tsx (footer Dust Cap/Focuser/Target/Eyepiece controls), TelemetryPanel.tsx
 * (Time Controls block, Motor toggle), and LiveViewPanel.tsx (the Finderscope
 * and Main Eyepiece viewports) — this component doesn't know or care which
 * React tree they live in, it just measures whatever matches the selector.
 *
 * Phase 38: expanded from five steps into a true beginner walkthrough — a
 * beginner doesn't know a dust cap has to come off before ANYTHING is
 * visible, and conflated the wide-aiming Finderscope with the high-power
 * Main Eyepiece as "the two circles." Each now gets its own spotlighted step.
 */

interface TourStepConfig {
  tourId: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** This step's target element only exists when the 2D Live View canvases are mounted. */
  requiresCanvases?: boolean;
}

const TOUR_STEPS: TourStepConfig[] = [
  // Step 0 (Phase 41): a pure intro — `tour-welcome` deliberately matches no
  // data-tour-id in the DOM, so `rect` stays null and the tour renders it as
  // a centered, un-spotlighted card (see the `!rect` branches below) instead
  // of pointing at any one control.
  { tourId: 'tour-welcome', titleKey: 'tour.welcome.title', bodyKey: 'tour.welcome.body' },
  { tourId: 'tour-simulation-mode', titleKey: 'tour.simMode.title', bodyKey: 'tour.simMode.body' },
  { tourId: 'tour-language', titleKey: 'tour.language.title', bodyKey: 'tour.language.body' },
  { tourId: 'tour-dustcap', titleKey: 'tour.dustcap.title', bodyKey: 'tour.dustcap.body' },
  { tourId: 'tour-target', titleKey: 'tour.target.title', bodyKey: 'tour.target.body' },
  { tourId: 'tour-time', titleKey: 'tour.time.title', bodyKey: 'tour.time.body' },
  { tourId: 'tour-motor', titleKey: 'tour.motor.title', bodyKey: 'tour.motor.body' },
  { tourId: 'tour-finderscope', titleKey: 'tour.finderscope.title', bodyKey: 'tour.finderscope.body', requiresCanvases: true },
  { tourId: 'tour-main-eyepiece', titleKey: 'tour.mainEyepiece.title', bodyKey: 'tour.mainEyepiece.body', requiresCanvases: true },
  { tourId: 'tour-eyepiece', titleKey: 'tour.eyepiece.title', bodyKey: 'tour.eyepiece.body' },
  { tourId: 'tour-focuser', titleKey: 'tour.focuser.title', bodyKey: 'tour.focuser.body' },
];

// Recheck the spotlighted element's position on a light interval — footer
// dropups, mission panels, and responsive layout shifts can all move it in
// ways a single mount-time measurement or resize listener alone would miss.
const REMEASURE_INTERVAL_MS = 400;
const TOOLTIP_WIDTH_PX = 320;
// Step 0 (Phase 45): a deliberately bigger, bolder first impression — capped
// at Tailwind's `max-w-xl` (36rem) rather than the regular card's 320px.
const WELCOME_TOOLTIP_WIDTH_PX = 576;
const SPOTLIGHT_PAD_PX = 8;
// Phase 45: explicit floor gap between the tooltip card and the spotlighted
// element, on top of using the card's REAL measured height (not a guess) to
// decide where "outside the target" actually is — see the overlap-bug note
// on tooltipHeight below.
const TOOLTIP_TARGET_GAP_PX = 15;
// Best-effort card height before the first real measurement lands (mount,
// or the instant a step's content changes) — only used for one frame each
// time, since useLayoutEffect corrects it before the browser paints.
const FALLBACK_TOOLTIP_HEIGHT_PX = 190;

interface OnboardingTourProps {
  /** False only in pure Observatory view, where the 2D feeds are unmounted. */
  areCanvasesVisible: boolean;
  /** Switch to a layout where the 2D feeds exist — called when the tour reaches that step. */
  onRequestCanvasesVisible: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({ areCanvasesVisible, onRequestCanvasesVisible }) => {
  const tourStep = useTelescopeStore((s) => s.tourStep);
  const advanceTour = useTelescopeStore((s) => s.advanceTour);
  const endTour = useTelescopeStore((s) => s.endTour);
  const { t } = useTranslation();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(FALLBACK_TOOLTIP_HEIGHT_PX);

  const config = tourStep > 0 ? TOUR_STEPS[tourStep - 1] : null;
  const isWelcomeStep = tourStep === 1;

  useEffect(() => {
    if (config?.requiresCanvases && !areCanvasesVisible) {
      onRequestCanvasesVisible();
    }
  }, [config, areCanvasesVisible, onRequestCanvasesVisible]);

  useEffect(() => {
    if (!config) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour-id="${config.tourId}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    const intervalId = window.setInterval(measure, REMEASURE_INTERVAL_MS);
    window.addEventListener('resize', measure);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', measure);
    };
  }, [config]);

  // Phase 45: measure the card's REAL rendered height whenever its content
  // changes (a new step's title/body, or the welcome step's much-bigger
  // fonts). The old "above the target" placement subtracted a hard-coded
  // 174px guess — whenever a step's actual wrapped text ran taller than
  // that (longer body copy, or a narrow viewport wrapping more lines), the
  // card's real bottom edge landed BELOW rect.top and covered the very
  // button it was explaining (the reported Finderscope/Dust Cap overlap).
  // useLayoutEffect fires after the DOM paints new content but before the
  // browser shows it, so the corrected height applies with no visible flash.
  useLayoutEffect(() => {
    if (tooltipRef.current) {
      setTooltipHeight(tooltipRef.current.getBoundingClientRect().height);
    }
  }, [config, isWelcomeStep]);

  if (!config) return null;

  const isLastStep = tourStep >= TOUR_STEPS.length;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  // Mobile/tablet safety (Phase 38): shrink to fit rather than overflow a
  // narrow viewport — a fixed 320px card plus its 14px margins needs 348px,
  // wider than some phones in portrait. Never wider than TOOLTIP_WIDTH_PX
  // (or the deliberately bigger WELCOME_TOOLTIP_WIDTH_PX for step 0).
  const tooltipWidth = Math.min(isWelcomeStep ? WELCOME_TOOLTIP_WIDTH_PX : TOOLTIP_WIDTH_PX, viewportW - 28);

  let tooltipTop: number;
  let tooltipLeft: number;
  if (rect) {
    const spaceBelow = viewportH - rect.bottom;
    const roomNeeded = tooltipHeight + TOOLTIP_TARGET_GAP_PX;
    const placeBelow = spaceBelow > roomNeeded || rect.top < roomNeeded;
    // Phase 45: both branches now float a full TOOLTIP_TARGET_GAP_PX outside
    // the spotlighted element, sized off the card's ACTUAL measured height
    // rather than a guess — the card can never overlap its own target.
    tooltipTop = placeBelow
      ? rect.bottom + TOOLTIP_TARGET_GAP_PX
      : Math.max(TOOLTIP_TARGET_GAP_PX, rect.top - tooltipHeight - TOOLTIP_TARGET_GAP_PX);
    tooltipLeft = Math.min(Math.max(14, rect.left + rect.width / 2 - tooltipWidth / 2), viewportW - tooltipWidth - 14);
  } else {
    // Target element not found (yet) — center the tooltip so the tour never
    // silently vanishes, e.g. the one-frame gap before onRequestCanvasesVisible lands.
    tooltipTop = viewportH / 2 - tooltipHeight / 2;
    tooltipLeft = viewportW / 2 - tooltipWidth / 2;
  }

  return (
    <div className="fixed inset-0 z-[9996] pointer-events-none">
      {rect ? (
        <div
          className="absolute rounded-xl transition-all duration-300 ease-out"
          style={{
            top: rect.top - SPOTLIGHT_PAD_PX,
            left: rect.left - SPOTLIGHT_PAD_PX,
            width: rect.width + SPOTLIGHT_PAD_PX * 2,
            height: rect.height + SPOTLIGHT_PAD_PX * 2,
            boxShadow: '0 0 0 9999px rgba(2, 6, 23, 0.78)',
            outline: '2px solid rgba(34, 211, 238, 0.9)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-950/78" />
      )}

      <div
        ref={tooltipRef}
        className={`absolute pointer-events-auto bg-slate-900 border border-cyan-500/50 rounded-xl shadow-2xl flex flex-col gap-2.5 transition-all duration-300 ease-out ${
          isWelcomeStep ? 'p-6' : 'p-4'
        }`}
        style={{ top: tooltipTop, left: tooltipLeft, width: tooltipWidth }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-400">
            {t('tour.stepOf', { step: tourStep, total: TOUR_STEPS.length })}
          </span>
          <button onClick={endTour} className="text-slate-500 hover:text-slate-300" aria-label="Close tour">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Step 0 (Phase 45): dramatically bigger type so the welcome card
            commands attention as a real first impression, not just another
            spotlighted tip. */}
        <h3 className={isWelcomeStep ? 'text-2xl font-bold text-white' : 'text-sm font-bold text-white'}>
          {t(config.titleKey)}
        </h3>
        <p className={isWelcomeStep ? 'text-lg text-slate-300 leading-relaxed' : 'text-xs text-slate-300 leading-relaxed'}>
          {t(config.bodyKey)}
        </p>
        <div className="flex items-center justify-between mt-1">
          <button
            onClick={endTour}
            className="text-[10px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300"
          >
            {t('tour.skip')}
          </button>
          <button
            onClick={isLastStep ? endTour : advanceTour}
            className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
          >
            {isLastStep ? t('tour.finish') : t('tour.next')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingTour;
