import React, { useEffect, useLayoutEffect, useState } from 'react';

/**
 * IntroMascot — Phase 45; completely rewritten Phase 46
 * ─────────────────────────────────────────────────────────────────
 * The Phase 45 version had the mascot sprint across the screen — playful,
 * but it read as a frantic bug rather than a welcome. This version is
 * static and elegant instead: a small refracting telescope fades in near
 * the center-left of the screen, aimed at the header's "Start Tour"
 * button, and fires a glowing beam of light straight at it. The button
 * itself pulses while the beam is connected, then everything (mascot,
 * beam, pulse) fades out together and unmounts for good.
 *
 * Runs once per page load (plain useState, deliberately NOT persisted —
 * a fresh visit/reload earns the greeting again) and never intercepts
 * clicks (pointer-events: none throughout, except the imperative
 * classList toggle on the REAL button, which is purely visual — no
 * handlers are attached or removed).
 *
 * The beam's landing point is the button's real measured position (not a
 * guessed screen fraction), so it still homes in correctly across
 * responsive layouts — same reasoning as Phase 45's run path.
 */

const FADE_IN_MS = 500;
const BEAM_DRAW_MS = 1100;
const HOLD_MS = 1400;
const FADE_OUT_MS = 500;
const TOTAL_MS = FADE_IN_MS + BEAM_DRAW_MS + HOLD_MS + FADE_OUT_MS; // 3500ms
const UNMOUNT_BUFFER_MS = 200;

// Fraction-of-duration keyframe stops for the group's overall fade.
const FADE_IN_PCT = (FADE_IN_MS / TOTAL_MS) * 100;
const HOLD_END_PCT = ((FADE_IN_MS + BEAM_DRAW_MS + HOLD_MS) / TOTAL_MS) * 100;

/** Class toggled directly on the real Start Tour button while the beam connects. */
const TARGET_PULSE_CLASS = 'intro-mascot-target-pulse';

interface IntroMascotProps {
  /** The element the beam aims at — its center is the beam's landing point. */
  targetRef: React.RefObject<HTMLElement | null>;
}

export const IntroMascot: React.FC<IntroMascotProps> = ({ targetRef }) => {
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const [done, setDone] = useState(false);

  useLayoutEffect(() => {
    const rect = targetRef.current?.getBoundingClientRect();
    setTarget(
      rect
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : { x: window.innerWidth - 60, y: 24 } // header's right side, if the button isn't found yet
    );
  }, [targetRef]);

  // Pulse the real button while the beam is connected, and guarantee it
  // never stays stuck glowing (cleanup runs on unmount too, not just the
  // natural end-of-timeline).
  useEffect(() => {
    const el = targetRef.current;
    const pulseOnAt = FADE_IN_MS + BEAM_DRAW_MS;
    const pulseOffAt = FADE_IN_MS + BEAM_DRAW_MS + HOLD_MS;
    const pulseOnTimer = window.setTimeout(() => el?.classList.add(TARGET_PULSE_CLASS), pulseOnAt);
    const pulseOffTimer = window.setTimeout(() => el?.classList.remove(TARGET_PULSE_CLASS), pulseOffAt);
    const doneTimer = window.setTimeout(() => setDone(true), TOTAL_MS + UNMOUNT_BUFFER_MS);
    return () => {
      window.clearTimeout(pulseOnTimer);
      window.clearTimeout(pulseOffTimer);
      window.clearTimeout(doneTimer);
      el?.classList.remove(TARGET_PULSE_CLASS);
    };
  }, [targetRef]);

  if (done || !target) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const originX = vw * 0.14;
  const originY = vh * 0.46;

  // Aim the tube (and the beam's origin) straight at the button.
  const angleRad = Math.atan2(target.y - originY, target.x - originX);
  const angleDeg = (angleRad * 180) / Math.PI;
  const lensX = originX + Math.cos(angleRad) * 58;
  const lensY = originY + Math.sin(angleRad) * 58;
  const beamLength = Math.hypot(target.x - lensX, target.y - lensY);

  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      <style>{`
        @keyframes introMascotFade {
          0% { opacity: 0; }
          ${FADE_IN_PCT.toFixed(2)}% { opacity: 1; }
          ${HOLD_END_PCT.toFixed(2)}% { opacity: 1; }
          100% { opacity: 0; }
        }
        .intro-mascot-fade {
          animation: introMascotFade ${TOTAL_MS}ms ease-in-out forwards;
        }
        @keyframes introMascotBeamDraw {
          to { stroke-dashoffset: 0; }
        }
        .intro-mascot-beam {
          stroke-dasharray: ${beamLength};
          stroke-dashoffset: ${beamLength};
          animation: introMascotBeamDraw ${BEAM_DRAW_MS}ms ${FADE_IN_MS}ms ease-out forwards;
        }
        @keyframes introMascotArrowIn {
          to { opacity: 0.9; }
        }
        .intro-mascot-arrow {
          opacity: 0;
          animation: introMascotArrowIn 200ms ${FADE_IN_MS + BEAM_DRAW_MS - 150}ms ease-out forwards;
        }
        @keyframes introMascotBreathe {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.95; transform: scale(1.15); }
        }
        .intro-mascot-lens-glow {
          transform-box: fill-box;
          transform-origin: center;
          animation: introMascotBreathe 1.6s ease-in-out infinite;
        }
        @keyframes introMascotTargetPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(125, 211, 252, 0); filter: brightness(1); }
          50% { box-shadow: 0 0 22px 6px rgba(125, 211, 252, 0.85); filter: brightness(1.25); }
        }
        .${TARGET_PULSE_CLASS} {
          animation: introMascotTargetPulse 0.9s ease-in-out infinite;
        }
      `}</style>

      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <g className="intro-mascot-fade">
          {/* soft grounding glow beneath the telescope — deliberately no
              legs, this version is a calm static illustration, not a
              running character. */}
          <ellipse cx={originX} cy={originY + 34} rx="46" ry="10" fill="rgba(125,211,252,0.16)" />

          {/* tube, aimed at the button */}
          <g transform={`translate(${originX}, ${originY}) rotate(${angleDeg})`}>
            <rect x="-16" y="-11" width="74" height="22" rx="11" fill="#eef2ff" stroke="#c7d2e8" strokeWidth="1.5" />
            <rect x="2" y="-8" width="6" height="16" rx="2" fill="#c7d2e8" />
            <rect x="-16" y="-4" width="10" height="8" rx="3" fill="#c7d2e8" />
          </g>

          {/* objective lens — the beam's origin, breathing gently */}
          <circle className="intro-mascot-lens-glow" cx={lensX} cy={lensY} r="17" fill="#7dd3fc" opacity="0.5" />
          <circle cx={lensX} cy={lensY} r="10" fill="#0a0e18" stroke="#7dd3fc" strokeWidth="2" />
          <circle cx={lensX} cy={lensY} r="4.5" fill="#bfe9ff" opacity="0.85" />

          {/* the beam: a soft blurred glow layer under a crisp bright core,
              both drawn via a stroke-dashoffset "growing line" animation */}
          <line
            x1={lensX} y1={lensY} x2={target.x} y2={target.y}
            stroke="#7dd3fc" strokeWidth="9" strokeLinecap="round" opacity="0.28"
            className="intro-mascot-beam" style={{ filter: 'blur(5px)' }}
          />
          <line
            x1={lensX} y1={lensY} x2={target.x} y2={target.y}
            stroke="#eaf8ff" strokeWidth="2.2" strokeLinecap="round" opacity="0.95"
            className="intro-mascot-beam"
          />

          {/* arrowhead at the button end, same heading as the beam */}
          <polygon
            className="intro-mascot-arrow"
            points="0,0 -14,-6 -9,0 -14,6"
            fill="#eaf8ff"
            transform={`translate(${target.x}, ${target.y}) rotate(${angleDeg})`}
          />
        </g>
      </svg>
    </div>
  );
};

export default IntroMascot;
