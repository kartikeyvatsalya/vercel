import React, { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';

const MOBILE_BREAKPOINT_PX = 768;

/** Dismissing is intentionally in-memory only — a real mobile visitor should
 * see this again on their next visit, not have it silently suppress itself. */
export const MobileWarning: React.FC = () => {
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < MOBILE_BREAKPOINT_PX);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < MOBILE_BREAKPOINT_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!isNarrow || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950 p-6 text-center">
      <div className="max-w-xs flex flex-col items-center gap-4">
        <div className="bg-cyan-500/20 border border-cyan-500/30 p-3 rounded-xl">
          <Monitor className="w-8 h-8 text-cyan-400" />
        </div>
        <p className="text-sm font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
          Telescope Trainer
        </p>
        <p className="text-sm text-slate-300 leading-relaxed">
          For the best experience, please view this simulator on a desktop, laptop, or tablet.
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="mt-1 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-bold uppercase tracking-widest transition-colors"
        >
          Continue Anyway
        </button>
      </div>
    </div>
  );
};

export default MobileWarning;
