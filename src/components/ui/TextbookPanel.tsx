import React from 'react';
import { useProgressStore } from '../../store/useProgressStore';
import { useTranslation } from '../../engine/i18n';
import { CURRICULUM, getLessonContent, type Lesson } from '../../engine/curriculum';
import { BookMarked, X, CheckCircle2, Circle, Rocket } from 'lucide-react';

interface TextbookPanelProps {
  onClose: () => void;
  onTryItOut: (lesson: Lesson) => void;
}

/** Splits on **bold** markers into alternating plain/bold segments — no markdown dependency, mirrors the rest of the app's dependency-free UI helpers. */
function renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode {
  return text.split('**').map((segment, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-${i}`} className="text-white font-semibold">
        {segment}
      </strong>
    ) : (
      segment
    )
  );
}

/**
 * TextbookPanel — Phase 31
 * A right-docked, scrollable overlay (not a full modal takeover) listing the
 * curriculum's lessons. Renders as a pure additive overlay like FieldLogbookModal/
 * AboutModal — it never unmounts the 3D Observatory or 2D Live View canvases
 * underneath, so it's safe to open over any of App.tsx's three view modes.
 */
export const TextbookPanel: React.FC<TextbookPanelProps> = ({ onClose, onTryItOut }) => {
  const { t, language } = useTranslation();
  const completedLessons = useProgressStore((s) => s.completedLessons);

  return (
    <div onClick={onClose} className="fixed inset-0 z-[9995] flex justify-end bg-slate-950/70 backdrop-blur-sm">
      <div
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-md bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-500/20 border border-emerald-500/40 p-2 rounded-xl">
              <BookMarked className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent leading-none">
                {t('textbook.heading')}
              </h2>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mt-0.5">
                {t('textbook.completedCount', { n: completedLessons.length, total: CURRICULUM.length })}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
            aria-label="Close Textbook"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lesson list */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {CURRICULUM.map((lesson, index) => {
            const content = getLessonContent(language, lesson);
            const isComplete = completedLessons.includes(lesson.id);
            return (
              <div
                key={lesson.id}
                className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition-colors ${
                  isComplete ? 'border-emerald-600/50 bg-emerald-950/10' : 'border-slate-800 bg-slate-800/30'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-slate-800 border border-slate-600 text-[11px] font-bold text-slate-300 flex items-center justify-center">
                      {index + 1}
                    </span>
                    <h3 className="text-sm font-bold text-white leading-snug">{content.title}</h3>
                  </div>
                  {isComplete ? (
                    <span title={t('textbook.completed')} className="shrink-0 text-emerald-400">
                      <CheckCircle2 className="w-5 h-5" />
                    </span>
                  ) : (
                    <span className="shrink-0 text-slate-700">
                      <Circle className="w-5 h-5" />
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-2.5">
                  {content.body.map((paragraph, pIdx) => (
                    <p key={pIdx} className="text-xs text-slate-300 leading-relaxed">
                      {renderInlineMarkdown(paragraph, `${lesson.id}-${pIdx}`)}
                    </p>
                  ))}
                </div>

                <button
                  onClick={() => onTryItOut(lesson)}
                  className="mt-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg font-bold uppercase tracking-widest text-[10px] transition-colors shadow-lg"
                >
                  <Rocket className="w-3.5 h-3.5" /> {t('textbook.tryItOut')}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TextbookPanel;
