import React, { useEffect, useState } from 'react';
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
 * The five steps point at DOM elements tagged `data-tour-id="..."` spread
 * across App.tsx (footer Target/Eyepiece selectors), TelemetryPanel.tsx
 * (Time Controls block, Motor toggle), and LiveViewPanel.tsx (the canvases
 * wrapper) — this component doesn't know or care which React tree they
 * live in, it just measures whatever matches the selector.
 */

interface TourStepConfig {
  tourId: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** This step's target element only exists when the 2D Live View canvases are mounted. */
  requiresCanvases?: boolean;
}

const TOUR_STEPS: TourStepConfig[] = [
  { tourId: 'tour-target', titleKey: 'tour.target.title', bodyKey: 'tour.target.body' },
  { tourId: 'tour-time', titleKey: 'tour.time.title', bodyKey: 'tour.time.body' },
  { tourId: 'tour-motor', titleKey: 'tour.motor.title', bodyKey: 'tour.motor.body' },
  { tourId: 'tour-eyepiece', titleKey: 'tour.eyepiece.title', bodyKey: 'tour.eyepiece.body' },
  { tourId: 'tour-canvases', titleKey: 'tour.canvases.title', bodyKey: 'tour.canvases.body', requiresCanvases: true },
];

// Recheck the spotlighted element's position on a light interval — footer
// dropups, mission panels, and responsive layout shifts can all move it in
// ways a single mount-time measurement or resize listener alone would miss.
const REMEASURE_INTERVAL_MS = 400;
const TOOLTIP_WIDTH_PX = 320;
const SPOTLIGHT_PAD_PX = 8;

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

  const config = tourStep > 0 ? TOUR_STEPS[tourStep - 1] : null;

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

  if (!config) return null;

  const isLastStep = tourStep >= TOUR_STEPS.length;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let tooltipTop: number;
  let tooltipLeft: number;
  if (rect) {
    const spaceBelow = viewportH - rect.bottom;
    const placeBelow = spaceBelow > 190 || rect.top < 190;
    tooltipTop = placeBelow ? rect.bottom + 14 : Math.max(14, rect.top - 174);
    tooltipLeft = Math.min(Math.max(14, rect.left + rect.width / 2 - TOOLTIP_WIDTH_PX / 2), viewportW - TOOLTIP_WIDTH_PX - 14);
  } else {
    // Target element not found (yet) — center the tooltip so the tour never
    // silently vanishes, e.g. the one-frame gap before onRequestCanvasesVisible lands.
    tooltipTop = viewportH / 2 - 90;
    tooltipLeft = viewportW / 2 - TOOLTIP_WIDTH_PX / 2;
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
        className="absolute pointer-events-auto bg-slate-900 border border-cyan-500/50 rounded-xl shadow-2xl p-4 flex flex-col gap-2.5 transition-all duration-300 ease-out"
        style={{ top: tooltipTop, left: tooltipLeft, width: TOOLTIP_WIDTH_PX }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-400">
            {t('tour.stepOf', { step: tourStep, total: TOUR_STEPS.length })}
          </span>
          <button onClick={endTour} className="text-slate-500 hover:text-slate-300" aria-label="Close tour">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <h3 className="text-sm font-bold text-white">{t(config.titleKey)}</h3>
        <p className="text-xs text-slate-300 leading-relaxed">{t(config.bodyKey)}</p>
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
