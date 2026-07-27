import React from 'react';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { useCollimationStore } from '../../store/useCollimationStore';
import { useMechanicsStore } from '../../store/useMechanicsStore';
import { SIM_MODE_RULES, type SimulationMode } from '../../engine/simulationModes';
import { Settings, X, Cpu, Activity, Gauge } from 'lucide-react';


export const SettingsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const telescopeState = useTelescopeStore();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/50">
          <div className="flex items-center gap-3 text-white">
            <Settings className="w-5 h-5 text-indigo-400" />
            <h2 className="font-bold text-lg tracking-wide uppercase">Simulator Settings</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-slate-700 rounded transition-colors text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex flex-col gap-6 text-sm">

          {/* ── Global Simulation Mode (Phase 26) ── */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Gauge className="w-4 h-4" /> Simulation Mode
            </h3>
            <div className="flex flex-col gap-2">
              {(Object.keys(SIM_MODE_RULES) as SimulationMode[]).map((mode) => {
                const rules = SIM_MODE_RULES[mode];
                const isActive = telescopeState.simulationMode === mode;
                return (
                  <button
                    key={mode}
                    onClick={() => telescopeState.setSimulationMode(mode)}
                    className={`text-left p-4 rounded-xl border transition-colors ${
                      isActive
                        ? 'bg-amber-950/40 border-amber-500/60'
                        : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-500'
                    }`}
                  >
                    <p className={`font-semibold mb-1 ${isActive ? 'text-amber-300' : 'text-slate-200'}`}>
                      {rules.label} {isActive && '✓'}
                    </p>
                    <p className="text-xs text-slate-400 leading-relaxed">{rules.description}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Graphics Settings */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Cpu className="w-4 h-4" /> Graphics & Performance
            </h3>
            
            <div className="flex items-center justify-between bg-slate-800/50 p-4 rounded-xl border border-slate-700/50">
              <div className="pr-4">
                <p className="font-semibold text-slate-200 mb-1">High-Performance Graphics</p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Enable expensive real-time optical blurs and continuous Canvas updates. Recommended for desktop PCs only.
                </p>
              </div>
              <button
                onClick={() => telescopeState.setHighPerformanceMode(!telescopeState.isHighPerformanceMode)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
                  telescopeState.isHighPerformanceMode ? 'bg-indigo-500' : 'bg-slate-600'
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  telescopeState.isHighPerformanceMode ? 'translate-x-6' : 'translate-x-1'
                }`} />
              </button>
            </div>
          </section>

          {/* Instructor Sabotage */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Activity className="w-4 h-4" /> Instructor Sabotage
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Phase 58: on an equatorial mount this now SLIDES THE
                  COUNTERWEIGHT rather than flipping a boolean — the balance
                  state is derived from the shaft position (see
                  useMechanicsStore), so a bare flag would produce a mount that
                  reports drooping while its weight sits visibly on the balance
                  point, and the next touch of the slider would silently undo
                  the sabotage anyway. An Alt-Az mount has no shaft to move, so
                  it keeps the original direct toggle. */}
              <button
                onClick={() => {
                  const mechanics = useMechanicsStore.getState();
                  if (telescopeState.activeProfile?.mountType === 'Equatorial') {
                    if (telescopeState.isMechanicallyBalanced) mechanics.unbalance();
                    else mechanics.autoBalance();
                  } else {
                    telescopeState.setMechanicallyBalanced(!telescopeState.isMechanicallyBalanced);
                  }
                }}
                className={`flex flex-col gap-1 p-3 rounded-xl border transition-all text-left ${
                  telescopeState.isMechanicallyBalanced
                    ? 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-800 text-slate-300'
                    : 'bg-amber-950/40 border-amber-500/50 text-amber-300 hover:bg-amber-900/40'
                }`}
              >
                <span className="font-semibold text-sm">Mechanical Balance</span>
                <span className="text-xs opacity-80">
                  {telescopeState.isMechanicallyBalanced ? 'Perfectly balanced' : 'Sabotaged: Tube is drooping'}
                </span>
              </button>

              {/* Phase 57: this toggle now moves the SCREWS, not just the
                  boolean. Since the Collimation module derives `isCollimated`
                  from the six screw positions, flipping the flag on its own
                  would produce a telescope that reports misalignment while
                  its star test draws a perfect donut — and the next screw
                  click would silently overwrite the sabotage anyway. */}
              <button
                onClick={() => {
                  const collimation = useCollimationStore.getState();
                  if (telescopeState.isCollimated) {
                    collimation.scramble('primary');
                  } else {
                    collimation.resetAll();
                  }
                }}
                className={`flex flex-col gap-1 p-3 rounded-xl border transition-all text-left ${
                  telescopeState.isCollimated 
                    ? 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-800 text-slate-300' 
                    : 'bg-red-950/40 border-red-500/50 text-red-300 hover:bg-red-900/40'
                }`}
              >
                <span className="font-semibold text-sm">Collimation</span>
                <span className="text-xs opacity-80">
                  {telescopeState.isCollimated ? 'Perfectly aligned' : 'Sabotaged: Mirrors are misaligned'}
                </span>
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
};
