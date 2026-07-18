import React from 'react';

/**
 * InfoTip — lightweight educational tooltip (Phase 26).
 * Pure React + Tailwind, no dependencies. Hover or keyboard-focus the
 * wrapped label to reveal a short, student-friendly explanation.
 *
 * The explanation dictionary itself lives in engine/i18n.ts's `tip.*`
 * namespace (Phase 28) so it can be looked up in the active language via
 * useTranslation() — pass `t('tip.magnification')` etc. as the `tip` prop.
 */

interface InfoTipProps {
  /** Explanation text — usually a t('tip.xxx') lookup. */
  tip: string;
  /** Which side the bubble opens toward (use 'bottom' near the top of the screen). */
  position?: 'top' | 'bottom';
  /** Show the dotted "this is explainable" underline affordance. */
  underline?: boolean;
  children: React.ReactNode;
}

export const InfoTip: React.FC<InfoTipProps> = ({ tip, position = 'top', underline = true, children }) => (
  <span className="group relative inline-flex items-center cursor-help" tabIndex={0}>
    <span className={underline ? 'border-b border-dotted border-slate-500/70' : ''}>{children}</span>
    <span
      role="tooltip"
      className={`pointer-events-none absolute left-1/2 -translate-x-1/2 z-[9999] w-56 rounded-lg border border-slate-600 bg-slate-950/95 px-3 py-2 text-left text-[10px] font-normal normal-case tracking-normal leading-relaxed text-slate-200 shadow-2xl opacity-0 transition-opacity duration-150 delay-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
        position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
      }`}
    >
      {tip}
    </span>
  </span>
);
