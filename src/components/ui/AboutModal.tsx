import React from 'react';
import { Telescope, X, Crosshair, Move, Circle, Camera } from 'lucide-react';
import type { ModuleId } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// ABOUT MODAL — Phase 60
//
// Extracted verbatim-in-spirit from the inline `AboutModal` that lived in
// App.tsx. The move is not cosmetic: App.tsx is the one file every other agent
// and every feature phase has to touch, and an identity panel that nobody
// edits has no business inflating that diff surface. Same props, same visual
// language, so the wiring in App.tsx is a one-line swap.
//
// WHY THE MODULE LIST IS DUPLICATED HERE
// App.tsx owns `MODULE_META`, and App.tsx cannot be imported from (circular:
// App renders this modal). Hoisting MODULE_META into a shared data module was
// the tempting fix, but MODULE_META carries JSX icons sized for the footer tab
// bar and is coupled to App's layout; a shared module would freeze that
// coupling in place. The four entries below are therefore a deliberate copy —
// English, untranslated, and stable. If a fifth module ships, both lists move.
//
// WHY THIS PANEL IS ENGLISH-ONLY
// The rest of the app is bilingual (en / हिन्दी) through useTranslation, but
// catalog and identity content is deliberately left untranslated: the acronym
// only works in English, the organisation's name is a proper noun, and a
// half-translated credits block reads worse than an honest monolingual one.
// Do not add i18n keys here.
//
// WHY THE ACRONYM IS A PER-LETTER GRID AND NOT A SENTENCE
// "Bharat's Rural Astronomy and Holistic Minds Advancement for Nation's
// Development" as running prose is a mouthful nobody parses — the reader never
// sees that it spells the app's name. Splitting each word into a boxed initial
// + remainder makes the construction visible at a glance. Two columns on
// sm+ keeps the block from becoming an eight-row tower; it collapses to one
// column on narrow viewports rather than wrapping words mid-phrase. The grid
// is aria-hidden and paired with an sr-only full sentence, because a screen
// reader announcing "B — harat's" letter-by-letter is worse than useless.
//
// WHY THE SCROLL PLUMBING LOOKS FUSSY
// The old inline version had no height cap at all: on a short laptop viewport
// (or any phone in landscape) the Close button simply fell off the bottom of
// the screen with no way to reach it. The panel is now a flex column capped
// below the viewport, with a non-shrinking header and footer, so the Close
// button is ALWAYS reachable and only the body scrolls. `min-h-0` on the body
// is load-bearing — without it a flex child refuses to shrink below its
// content height and the overflow never engages.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The acronym, one entry per letter. `tail` holds the grammatical glue words
 * ("and", "for") that are NOT part of the acronym — rendered muted so a reader
 * can tell at a glance which words the initials actually come from.
 */
const ACRONYM: { letter: string; rest: string; tail?: string }[] = [
  { letter: 'B', rest: 'harat’s' },
  { letter: 'R', rest: 'ural' },
  { letter: 'A', rest: 'stronomy', tail: 'and' },
  { letter: 'H', rest: 'olistic' },
  { letter: 'M', rest: 'inds' },
  { letter: 'A', rest: 'dvancement', tail: 'for' },
  { letter: 'N', rest: 'ation’s' },
  { letter: 'D', rest: 'evelopment' },
];

const ACRONYM_SENTENCE =
  'BRAHMAND stands for Bharat’s Rural Astronomy and Holistic Minds Advancement for Nation’s Development.';

/** Mirror of App.tsx's MODULE_META — see the file header for why it is copied. */
const MODULES: { id: ModuleId; label: string; icon: React.ReactNode; description: string }[] = [
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
    id: 'collimation',
    label: 'Collimation',
    icon: <Circle className="w-4 h-4" />,
    description: 'Align the mirrors by star test until a defocused star is a clean, centred donut.',
  },
  {
    id: 'astrophotography',
    label: 'Astrophotography',
    icon: <Camera className="w-4 h-4" />,
    description: 'Capture deep-sky images with Lucky Imaging or DSO Stacking.',
  },
];

export const AboutModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
    <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="shrink-0 bg-gradient-to-r from-slate-800 to-slate-900 p-5 border-b border-slate-700 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-500/20 border border-cyan-500/40 p-2.5 rounded-xl">
            <Telescope className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold tracking-wide bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              BRAHMAND
            </h2>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
              v0.7.0 — Interactive Astronomy Simulator
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors text-slate-400 hover:text-white shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 max-h-[85vh] overflow-y-auto p-6 flex flex-col gap-5">
        {/* Acronym Block */}
        <div className="bg-gradient-to-br from-cyan-950/40 to-slate-900/60 border border-cyan-500/30 rounded-xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 mb-3">
            The Name
          </p>

          <p className="sr-only">{ACRONYM_SENTENCE}</p>

          <ul
            aria-hidden="true"
            className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-2"
          >
            {ACRONYM.map((w, i) => (
              <li key={`${w.letter}-${i}`} className="flex items-center gap-1.5">
                <span className="inline-flex items-center justify-center w-6 h-6 shrink-0 rounded-md bg-cyan-500/15 border border-cyan-500/40 font-mono text-sm font-bold text-cyan-300 leading-none">
                  {w.letter}
                </span>
                <span className="text-sm text-slate-200 leading-tight">
                  {w.rest}
                  {w.tail && <span className="text-slate-500 italic"> {w.tail}</span>}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-slate-400 text-sm mt-4 leading-relaxed">
            It is also the ordinary Hindi word for the cosmos —{' '}
            <span lang="hi" className="text-slate-200">ब्रह्मांड</span> — which is either a
            coincidence or the whole point.
          </p>
        </div>

        {/* Mission blurb */}
        <p className="text-slate-300 leading-relaxed">
          <strong className="text-white">BRAHMAND</strong> is one instrument in a wider effort
          to bring high-precision observational astronomy to rural and beginner students —
          students who may never have held a telescope, and who generally have a far better sky
          over their heads than any city observer. Every module runs on real optical and
          mechanical physics over a live digital twin of the night sky: the drift is sidereal,
          the view really does invert, and the collimation screws are as unforgiving as the ones
          on the actual tube. Learn the craft indoors, so that the first clear night outside is
          spent observing rather than fumbling.
        </p>

        {/* Origin Credit Block */}
        <div className="bg-gradient-to-br from-indigo-950/60 to-slate-900/60 border border-indigo-500/40 rounded-xl p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-3">Origin &amp; Credits</p>
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
            {MODULES.map(m => (
              <li key={m.id} className="flex items-center gap-2">
                <span className="text-cyan-400 shrink-0">{m.icon}</span>
                <span>
                  <strong className="text-white">{m.label}</strong> — {m.description}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="shrink-0 px-6 py-5 border-t border-slate-800">
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

export default AboutModal;
