import React from 'react';
import { Lock, Unlock } from 'lucide-react';
import { useTelescopeStore } from '../../store/useTelescopeStore';

/**
 * ClutchToggles — Phase 47
 * ─────────────────────────────────────────────────────────────────
 * The "Lock Alt" / "Lock Az" clutch buttons, extracted from LiveViewPanel
 * (Phase 46) so ObservatoryScene can render the exact same control as a
 * floating overlay on the 3D view — dragging the tube happens there too,
 * and the locks used to only be reachable from the Eyepiece panel.
 *
 * Reads/writes useTelescopeStore directly via individual selectors (not a
 * whole-store subscription), so mounting this in two places never adds an
 * extra unrelated-state re-render to either host component.
 */

interface ClutchTogglesProps {
  /** Extra classes for the outer flex wrapper (layout only — buttons keep their own look). */
  className?: string;
}

export const ClutchToggles: React.FC<ClutchTogglesProps> = ({ className = '' }) => {
  const isAltLocked = useTelescopeStore((s) => s.isAltLocked);
  const isAzLocked = useTelescopeStore((s) => s.isAzLocked);
  const toggleAltLocked = useTelescopeStore((s) => s.toggleAltLocked);
  const toggleAzLocked = useTelescopeStore((s) => s.toggleAzLocked);

  return (
    <div className={`flex gap-1 ${className}`}>
      <button
        onClick={toggleAltLocked}
        aria-pressed={isAltLocked}
        title="Lock Altitude — 3D tube drag ignores vertical movement"
        className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${
          isAltLocked
            ? 'bg-amber-900/60 border-amber-500 text-amber-300'
            : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300'
        }`}
      >
        {isAltLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        Alt
      </button>
      <button
        onClick={toggleAzLocked}
        aria-pressed={isAzLocked}
        title="Lock Azimuth — 3D tube drag ignores horizontal movement"
        className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[9px] font-bold uppercase tracking-wider border transition-colors ${
          isAzLocked
            ? 'bg-amber-900/60 border-amber-500 text-amber-300'
            : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-300'
        }`}
      >
        {isAzLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
        Az
      </button>
    </div>
  );
};

export default ClutchToggles;
