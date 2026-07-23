import React, { useLayoutEffect, useState } from 'react';

/**
 * IntroMascot — Phase 45
 * ─────────────────────────────────────────────────────────────────
 * A one-shot, purely decorative welcome animation: a small cartoon
 * telescope-on-legs runs in from the bottom-left, bounces across the
 * bottom of the screen, then curves up to the header's "Start Tour"
 * button and shrinks away. Runs once per page load (plain useState,
 * deliberately NOT persisted — a fresh visit/reload earns the greeting
 * again) and never intercepts clicks (pointer-events: none throughout).
 *
 * The run path is computed as fully-resolved pixel waypoints in JS (not
 * mixed vw/px CSS calc()) from the target button's real measured position
 * plus the viewport size, then baked into an injected <style> block's
 * @keyframes — this way the mascot actually homes in on wherever the
 * header button really sits (responsive layouts move it) instead of
 * guessing a fixed screen fraction.
 */

const RUN_DURATION_MS = 3500;
const UNMOUNT_DELAY_MS = 200; // small cushion past the CSS animation's own duration

// One entry per keyframe stop, paired 1:1 with KEYFRAME_PERCENTS below.
const KEYFRAME_PERCENTS = [0, 15, 30, 45, 62, 80, 94, 100];

interface Waypoint {
  x: number;
  y: number;
  rot: number;
  scale: number;
  opacity: number;
}

interface IntroMascotProps {
  /** The element to run toward — its center becomes the animation's landing point. */
  targetRef: React.RefObject<HTMLElement | null>;
}

export const IntroMascot: React.FC<IntroMascotProps> = ({ targetRef }) => {
  const [path, setPath] = useState<Waypoint[] | null>(null);
  const [done, setDone] = useState(false);

  useLayoutEffect(() => {
    const rect = targetRef.current?.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const target = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: vw - 60, y: 24 }; // header's right side, if the button isn't found yet

    const floorY = vh - 60;
    const hopY = vh - 76;
    const runEnd = { x: vw * 0.78, y: floorY - 4 };
    const arcMid = { x: (runEnd.x + target.x) / 2, y: (runEnd.y + target.y) / 2 - 20 };

    const wp = (x: number, y: number, rot: number, scale: number, opacity = 1): Waypoint => ({ x, y, rot, scale, opacity });
    setPath([
      wp(-80, floorY, 0, 1),                              // 0%  — off-screen bottom-left
      wp(vw * 0.18, hopY, -4, 1),                          // 15% — running, bounce up
      wp(vw * 0.38, floorY - 4, 3, 1),                     // 30% — bounce down
      wp(vw * 0.58, hopY, -4, 1),                          // 45% — bounce up
      wp(runEnd.x, runEnd.y, 3, 1),                        // 62% — end of the run across the bottom
      wp(arcMid.x, arcMid.y, -8, 0.92),                    // 80% — curving up toward the button
      wp(target.x - 8, target.y + 6, -3, 0.75),            // 94% — arriving, just short of the button
      wp(target.x - 35, target.y - 21, 0, 0.5, 0),         // 100% — settled on the button, shrunk + faded out
    ]);

    const timer = window.setTimeout(() => setDone(true), RUN_DURATION_MS + UNMOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [targetRef]);

  if (done || !path) return null;

  const w = 70;
  const h = 42;
  const keyframesCss = path
    .map((p, i) => `${KEYFRAME_PERCENTS[i]}% { transform: translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg) scale(${p.scale}); opacity: ${p.opacity}; }`)
    .join('\n');

  return (
    <div
      aria-hidden="true"
      style={{ position: 'fixed', top: 0, left: 0, width: w, height: h, zIndex: 9999, pointerEvents: 'none' }}
    >
      <style>{`
        @keyframes introMascotRun {
          ${keyframesCss}
        }
        @keyframes introMascotLegSwing {
          from { transform: rotate(-20deg); }
          to   { transform: rotate(20deg); }
        }
        .intro-mascot-body {
          animation: introMascotRun ${RUN_DURATION_MS}ms cubic-bezier(0.45, 0.05, 0.55, 0.95) forwards;
        }
        .intro-mascot-leg {
          transform-box: fill-box;
          transform-origin: top center;
          animation: introMascotLegSwing 0.26s ease-in-out infinite alternate;
        }
        .intro-mascot-leg-2 { animation-delay: 0.13s; }
      `}</style>
      <svg viewBox="0 0 100 60" width={w} height={h} className="intro-mascot-body" style={{ overflow: 'visible' }}>
        {/* speed lines, trailing the eyepiece end */}
        <line x1="4" y1="30" x2="16" y2="27" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <line x1="2" y1="38" x2="12" y2="36" stroke="#7dd3fc" strokeWidth="2" strokeLinecap="round" opacity="0.35" />

        {/* little legs */}
        <g className="intro-mascot-leg intro-mascot-leg-2">
          <polyline points="38,40 34,50 30,58" fill="none" stroke="#2a2a3a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="intro-mascot-leg">
          <polyline points="58,40 62,50 66,58" fill="none" stroke="#2a2a3a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* tube body, tilted as if looking up and running forward */}
        <rect x="18" y="14" width="58" height="20" rx="10" fill="#f0a84e" stroke="#c9832f" strokeWidth="1.5" transform="rotate(-12 47 24)" />
        <rect x="36" y="16" width="5" height="16" rx="2" fill="#c9832f" transform="rotate(-12 38.5 24)" />

        {/* objective lens, front/leading end */}
        <circle cx="79" cy="10" r="10" fill="#1c2333" stroke="#7dd3fc" strokeWidth="2" />
        <circle cx="79" cy="10" r="4.5" fill="#0a0e18" />
        <circle cx="76" cy="7" r="1.6" fill="#bfe9ff" opacity="0.8" />

        {/* eyepiece + a friendly little eye, trailing end */}
        <circle cx="19" cy="32" r="7.5" fill="#3a3a4a" stroke="#22303f" strokeWidth="1" />
        <circle cx="21" cy="30" r="3.4" fill="#ffffff" />
        <circle cx="22" cy="30" r="1.7" fill="#0a0e18" />
      </svg>
    </div>
  );
};

export default IntroMascot;
