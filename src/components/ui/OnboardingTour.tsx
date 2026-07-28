import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTelescopeStore, type TourTrack } from '../../store/useTelescopeStore';
import { useTranslation, type TranslationKey } from '../../engine/i18n';
import { X } from 'lucide-react';
import type { ModuleId } from '../../types';

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
 *
 * Phase 63: the card's "never leaves the viewport" guarantee no longer depends
 * on measuring the card at all. See the placement block below — `below` pins
 * the card's TOP to the target's bottom edge, `above` pins the card's BOTTOM to
 * the target's top edge (a CSS `bottom`, not a computed `top` derived from a
 * measured height), and the unanchored/welcome case centres by transform. In
 * every one of the three the card's `max-height` is the height of the band it
 * was pinned into, so its far edge is bounded by CSS whatever its content does.
 * The measured height now only chooses WHICH side of the target reads better —
 * a stale measurement can pick the worse side, but it can no longer push the
 * Skip/Next row off-screen, which is what Phase 62's `top`-clamp still allowed
 * whenever the measurement it clamped against was out of date.
 *
 * Phase 60: two TRACKS instead of one list. Phases 57–59 added a great deal of
 * real physics — a six-screw collimation bench, counterweight torque, sky
 * transparency, dark adaptation — and every bit of it was invisible: nothing
 * in the interface tells you the Collimation tab contains a star test, or that
 * the slider next to Seeing is measuring something else entirely. Bolting six
 * more steps onto the beginner walkthrough would have been the wrong fix: a
 * first-time user does not need to hear about RA-axis moments before they have
 * taken the dust cap off. So the advanced material is its own opt-in track,
 * reachable from Settings, with its own step numbering.
 */

interface TourStepConfig {
  tourId: string;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** This step's target element only exists when the 2D Live View canvases are mounted. */
  requiresCanvases?: boolean;
  /**
   * Switch the 2D workspace to this module before spotlighting (Phase 60).
   * The advanced track explains the collimation bench, whose screw pad and
   * star test only exist while that module is the active one — pointing at a
   * tab and saying "there is a bench behind this" is a strictly worse lesson
   * than opening it and showing them.
   */
  requiresModule?: ModuleId;
}

const BASIC_TOUR_STEPS: TourStepConfig[] = [
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

// ── Advanced track (Phase 60) ──────────────────────────────────────
// Ordered as a real observing session's preparation actually runs: get the
// mirrors square, get the mount balanced, then read the sky and your own eyes.
// The collimation pair is deliberately two steps — the bench (what you turn)
// and the eyepiece (what it does), because the entire skill is the loop
// between them and a single step spotlighting either half teaches neither.
const ADVANCED_TOUR_STEPS: TourStepConfig[] = [
  { tourId: 'tour-advanced-welcome', titleKey: 'tour.advWelcome.title', bodyKey: 'tour.advWelcome.body' },
  {
    tourId: 'tour-collimation-tab',
    titleKey: 'tour.collimationTab.title',
    bodyKey: 'tour.collimationTab.body',
    requiresCanvases: true,
    requiresModule: 'collimation',
  },
  {
    tourId: 'tour-main-eyepiece',
    titleKey: 'tour.starTest.title',
    bodyKey: 'tour.starTest.body',
    requiresCanvases: true,
    requiresModule: 'collimation',
  },
  { tourId: 'tour-balance', titleKey: 'tour.balance.title', bodyKey: 'tour.balance.body' },
  { tourId: 'tour-transparency', titleKey: 'tour.transparency.title', bodyKey: 'tour.transparency.body' },
  { tourId: 'tour-dark-adaptation', titleKey: 'tour.darkAdaptation.title', bodyKey: 'tour.darkAdaptation.body' },
];

const TOUR_TRACKS: Record<TourTrack, TourStepConfig[]> = {
  basic: BASIC_TOUR_STEPS,
  advanced: ADVANCED_TOUR_STEPS,
};

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
// time, since useLayoutEffect corrects it before the browser paints. Since
// Phase 63 this figure only steers the above/below preference, so being wrong
// costs a suboptimal side, never a clipped card.
const FALLBACK_TOOLTIP_HEIGHT_PX = 190;
// Breathing room kept between the card and the top/bottom viewport edges. Also
// the thickness subtracted from each candidate band, so a card pinned into a
// band and capped at that band's height physically cannot reach the edge.
const TOOLTIP_VIEWPORT_MARGIN_PX = 20;
// Left/right breathing room — Phase 38's original 14px side margins.
const TOOLTIP_EDGE_MARGIN_PX = 14;
// A band thinner than this can't show a header, a line of body and the
// Skip/Next row without being absurd. When NEITHER side of the target clears
// it — a target that fills the viewport, e.g. tour-main-eyepiece on a laptop —
// the card centres over the spotlight instead. Overlapping a spotlight that is
// not interactive during its own step has always been the better failure than
// a card the student can't read or click Next on.
const MIN_TOOLTIP_BAND_PX = 150;
// One duration for every property the card animates. `max-height` MUST share
// it with `top`/`bottom`: both endpoints of any move satisfy
// "pinned edge + max-height <= viewport - margin", and interpolating both
// under the same easing keeps every intermediate frame satisfying it too.
const TOOLTIP_TRANSITION_MS = 300;

/** Which edge of the card is pinned — see the placement block in the body. */
type TooltipAnchor = 'below' | 'above' | 'centered';

interface OnboardingTourProps {
  /** False only in pure Observatory view, where the 2D feeds are unmounted. */
  areCanvasesVisible: boolean;
  /** Switch to a layout where the 2D feeds exist — called when the tour reaches that step. */
  onRequestCanvasesVisible: () => void;
  /** Which 2D module tab is currently open (Phase 60). */
  activeModule: ModuleId;
  /** Open a specific module tab — called for steps that explain one (Phase 60). */
  onRequestModule: (moduleId: ModuleId) => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  areCanvasesVisible, onRequestCanvasesVisible, activeModule, onRequestModule,
}) => {
  const tourStep = useTelescopeStore((s) => s.tourStep);
  const tourTrack = useTelescopeStore((s) => s.tourTrack);
  const advanceTour = useTelescopeStore((s) => s.advanceTour);
  const endTour = useTelescopeStore((s) => s.endTour);
  const { t } = useTranslation();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipBodyRef = useRef<HTMLDivElement>(null);
  const [tooltipHeight, setTooltipHeight] = useState(FALLBACK_TOOLTIP_HEIGHT_PX);
  // Phase 63: the viewport lives in state rather than being read straight off
  // `window` during render. The old code read window.innerWidth/innerHeight
  // inline, which is only correct if something else forces a re-render on
  // resize — and on an UNANCHORED step (the welcome card, whose tourId matches
  // no element) nothing did: the 400ms remeasure kept calling setRect(null),
  // React bails on an identical state value, and the card went on using the
  // viewport height it was born with. Resize the window on step 1 and the
  // card's absolute `top` and its Phase 62 max-height were both stale — the
  // reported "the fix failed for the first two Advanced Tour cards."
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));

  const steps = TOUR_TRACKS[tourTrack] ?? BASIC_TOUR_STEPS;
  const config = tourStep > 0 ? steps[tourStep - 1] : null;
  const isWelcomeStep = tourStep === 1;

  useEffect(() => {
    if (config?.requiresCanvases && !areCanvasesVisible) {
      onRequestCanvasesVisible();
    }
  }, [config, areCanvasesVisible, onRequestCanvasesVisible]);

  useEffect(() => {
    if (config?.requiresModule && config.requiresModule !== activeModule) {
      onRequestModule(config.requiresModule);
    }
  }, [config, activeModule, onRequestModule]);

  // Viewport tracking (Phase 63). `visualViewport` matters on mobile, where the
  // URL bar collapsing changes the usable height without firing a window
  // resize — exactly the moment a centred card would drift off the bottom.
  // The same REMEASURE_INTERVAL_MS poll the spotlight rect already runs backs
  // both events up: the resize event is the one thing here we cannot verify in
  // every environment (some embedded/emulated viewports resize without ever
  // dispatching it), and a stale viewport height silently invalidates every
  // number below it. The poll is free — the setter bails on an equal value, so
  // a steady window costs one comparison per tick and zero re-renders.
  // Gated on the tour actually running: this component stays mounted for the
  // whole session (it returns null when tourStep is 0), and neither a timer nor
  // three listeners should outlive the thing they exist to position.
  const isTourActive = config !== null;
  useEffect(() => {
    if (!isTourActive) return;
    const sync = () => {
      setViewport((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev // identical — let React bail rather than re-render the overlay
          : { w: window.innerWidth, h: window.innerHeight }
      );
    };
    sync();
    const intervalId = window.setInterval(sync, REMEASURE_INTERVAL_MS);
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    window.visualViewport?.addEventListener('resize', sync);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
      window.visualViewport?.removeEventListener('resize', sync);
    };
  }, [isTourActive]);

  useEffect(() => {
    if (!config) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour-id="${config.tourId}"]`);
      const next = el ? el.getBoundingClientRect() : null;
      // Phase 63: only commit a genuinely different box. getBoundingClientRect
      // hands back a fresh object every call, so the old unconditional setRect
      // re-rendered this overlay (and re-ran the layout measurement below)
      // every REMEASURE_INTERVAL_MS for the entire tour, whether or not the
      // spotlighted control had moved a single pixel.
      setRect((prev) => {
        if (!prev || !next) return prev === next ? prev : next;
        const same =
          Math.abs(prev.top - next.top) < 0.5 &&
          Math.abs(prev.left - next.left) < 0.5 &&
          Math.abs(prev.width - next.width) < 0.5 &&
          Math.abs(prev.height - next.height) < 0.5;
        return same ? prev : next;
      });
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
  //
  // Phase 63: what's measured is the card's NATURAL height — its rendered
  // height plus whatever the scrolling body is currently hiding. Two reasons:
  //   • Feeding back a max-height-CLAMPED height would oscillate. The clamp
  //     comes from the band the card was placed in, the band comes from which
  //     side was chosen, and the side is chosen from this number: measure the
  //     clamped height and the card can shrink enough to "fit" the side it was
  //     just moved off, flip back, grow, and flip again forever.
  //   • Natural height depends only on the content and the card's width,
  //     neither of which placement touches — so this converges immediately.
  const measureTooltip = useCallback(() => {
    const card = tooltipRef.current;
    if (!card) return;
    const body = tooltipBodyRef.current;
    const hiddenByScroll = body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
    const natural = card.getBoundingClientRect().height + hiddenByScroll;
    // Sub-pixel churn from the browser's own rounding would otherwise
    // re-render the overlay on every ResizeObserver tick.
    setTooltipHeight((prev) => (Math.abs(prev - natural) < 1 ? prev : natural));
  }, []);

  // useLayoutEffect fires after the DOM paints new content but before the
  // browser shows it, so a step change's corrected height applies with no
  // visible flash.
  useLayoutEffect(() => {
    measureTooltip();
  }, [measureTooltip, config, isWelcomeStep]);

  // …and a ResizeObserver catches every LATER change the dependency array
  // above can't see: a webfont swapping in, the language toggle rewriting
  // every string mid-tour, or the card still animating toward its new width
  // when the layout effect ran. Phase 62's single measurement per step is the
  // reason a stale height could survive long enough to matter.
  useEffect(() => {
    const card = tooltipRef.current;
    if (!card || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measureTooltip());
    observer.observe(card);
    if (tooltipBodyRef.current) observer.observe(tooltipBodyRef.current);
    return () => observer.disconnect();
  }, [measureTooltip, config]);

  if (!config) return null;

  const isLastStep = tourStep >= steps.length;
  const { w: viewportW, h: viewportH } = viewport;
  // Mobile/tablet safety (Phase 38): shrink to fit rather than overflow a
  // narrow viewport — a fixed 320px card plus its 14px margins needs 348px,
  // wider than some phones in portrait. Never wider than TOOLTIP_WIDTH_PX
  // (or the deliberately bigger WELCOME_TOOLTIP_WIDTH_PX for step 0).
  const tooltipWidth = Math.min(
    isWelcomeStep ? WELCOME_TOOLTIP_WIDTH_PX : TOOLTIP_WIDTH_PX,
    viewportW - TOOLTIP_EDGE_MARGIN_PX * 2
  );

  // ── Placement (rewritten Phase 63) ───────────────────────────────
  // Pick a BAND to live in, pin the card to the band's target-facing edge, and
  // cap its height at the band. The far edge is then bounded by CSS, not by
  // arithmetic on a measured height, which is what makes this hold for the
  // unanchored welcome cards and for a card whose content changes after it was
  // positioned. `tooltipHeight` appears only in the fits/doesn't-fit test that
  // picks a side.
  const centeredMaxHeight = Math.max(
    MIN_TOOLTIP_BAND_PX,
    viewportH - TOOLTIP_VIEWPORT_MARGIN_PX * 2
  );
  let anchor: TooltipAnchor = 'centered';
  let bandHeight = centeredMaxHeight;
  // Unanchored steps (the two welcome cards, and the one-frame gap before
  // onRequestCanvasesVisible lands) sit dead centre horizontally.
  let tooltipLeft = (viewportW - tooltipWidth) / 2;

  // Where the card's pinned edge would land, then forced inside the margin box.
  // The clamp matters when the spotlighted control is itself partly or wholly
  // off-screen — a short viewport pushes footer controls below the fold, and on
  // a raw rect that produces a band measured from an edge nobody can see, which
  // then places a perfectly "in-band" card off the bottom.
  let pinnedEdge = 0; // 'below' → the card's top; 'above' → the card's bottom
  if (rect) {
    const belowTop = Math.min(
      Math.max(rect.bottom + TOOLTIP_TARGET_GAP_PX, TOOLTIP_VIEWPORT_MARGIN_PX),
      viewportH - TOOLTIP_VIEWPORT_MARGIN_PX
    );
    const aboveBottom = Math.max(
      Math.min(rect.top - TOOLTIP_TARGET_GAP_PX, viewportH - TOOLTIP_VIEWPORT_MARGIN_PX),
      TOOLTIP_VIEWPORT_MARGIN_PX
    );
    // Both are >= 0 by construction, so a band is never a negative height.
    const bandBelow = viewportH - TOOLTIP_VIEWPORT_MARGIN_PX - belowTop;
    const bandAbove = aboveBottom - TOOLTIP_VIEWPORT_MARGIN_PX;
    const wanted = Math.min(tooltipHeight, centeredMaxHeight);
    if (bandBelow >= wanted) {
      anchor = 'below';
      bandHeight = bandBelow;
      pinnedEdge = belowTop;
    } else if (bandAbove >= wanted) {
      anchor = 'above';
      bandHeight = bandAbove;
      pinnedEdge = aboveBottom;
    } else if (Math.max(bandBelow, bandAbove) >= MIN_TOOLTIP_BAND_PX) {
      // Neither side fits the whole card, but one is still workable — take the
      // roomier one and let the body scroll inside it.
      const preferBelow = bandBelow >= bandAbove;
      anchor = preferBelow ? 'below' : 'above';
      bandHeight = preferBelow ? bandBelow : bandAbove;
      pinnedEdge = preferBelow ? belowTop : aboveBottom;
    }
    // else: both bands are unusable — stay 'centered', overlapping the
    // spotlight (see MIN_TOOLTIP_BAND_PX).
    if (anchor !== 'centered') {
      tooltipLeft = Math.min(
        Math.max(TOOLTIP_EDGE_MARGIN_PX, rect.left + rect.width / 2 - tooltipWidth / 2),
        viewportW - tooltipWidth - TOOLTIP_EDGE_MARGIN_PX
      );
    }
  }

  const tooltipMaxHeight = Math.min(bandHeight, centeredMaxHeight);
  // Exactly one of top/bottom is a length in each mode; the other is `auto`,
  // and both are always written so a mode switch can't leave the previous
  // mode's offset behind. 'centered' uses a transform rather than
  // `top: 50% - height/2` for the same reason as the rest of this block: the
  // browser applies it to whatever the card's height turns out to be, so no
  // measurement can be stale.
  const anchorStyle: React.CSSProperties =
    anchor === 'below'
      ? { top: pinnedEdge, bottom: 'auto', transform: 'none' }
      : anchor === 'above'
        ? { top: 'auto', bottom: viewportH - pinnedEdge, transform: 'none' }
        : { top: '50%', bottom: 'auto', transform: 'translateY(-50%)' };

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
        className={`absolute pointer-events-auto bg-slate-900 border border-cyan-500/50 rounded-xl shadow-2xl flex flex-col gap-2.5 ${
          isWelcomeStep ? 'p-6' : 'p-4'
        }`}
        style={{
          ...anchorStyle,
          left: tooltipLeft,
          width: tooltipWidth,
          maxHeight: tooltipMaxHeight,
          // Phase 63: an explicit property list in place of `transition-all`.
          // `all` also animated width, padding and font-size, so for 300ms
          // after every step change the card was a half-resized hybrid of two
          // steps — and that hybrid was precisely what the old single
          // measurement measured. Position and the height cap animate; the
          // things the height is computed FROM snap, so the card is only ever
          // measured in a settled state.
          transition: `top ${TOOLTIP_TRANSITION_MS}ms ease-out, bottom ${TOOLTIP_TRANSITION_MS}ms ease-out, left ${TOOLTIP_TRANSITION_MS}ms ease-out, max-height ${TOOLTIP_TRANSITION_MS}ms ease-out`,
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-400">
            {tourTrack === 'advanced' && <span className="text-amber-400">{t('tour.advancedBadge')} · </span>}
            {t('tour.stepOf', { step: tourStep, total: steps.length })}
          </span>
          <button onClick={endTour} className="text-slate-500 hover:text-slate-300" aria-label="Close tour">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Step 0 (Phase 45): dramatically bigger type so the welcome card
            commands attention as a real first impression, not just another
            spotlighted tip. */}
        {/* Phase 62: min-h-0 lets this flex child shrink below its content's
            intrinsic size (the default `min-height: auto` would refuse to,
            and grow the card past maxHeight instead) — that's what hands
            overflow to this div's own scrollbar rather than the card's
            bottom edge. Header and footer sit outside it so Skip/Next stay
            pinned and visible no matter how long the body text runs. */}
        <div ref={tooltipBodyRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5">
          <h3 className={isWelcomeStep ? 'text-2xl font-bold text-white' : 'text-sm font-bold text-white'}>
            {t(config.titleKey)}
          </h3>
          <p className={isWelcomeStep ? 'text-lg text-slate-300 leading-relaxed' : 'text-xs text-slate-300 leading-relaxed'}>
            {t(config.bodyKey)}
          </p>
        </div>
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
