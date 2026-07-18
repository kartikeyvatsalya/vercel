import React, { useEffect, useState } from 'react';
import { useInstructorStore } from '../../store/useInstructorStore';
import { TARGETS } from '../../data/bookContent';
import { ShieldAlert, AlertTriangle, CheckCircle2, Lock, Target } from 'lucide-react';

export const InstructorDashboard: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const { students, startSimulation, stopSimulation, toggleStudentControls, areControlsLocked, forceSyncTarget } = useInstructorStore();
  const [syncTarget, setSyncTarget] = useState('moon');

  useEffect(() => {
    startSimulation();
    return () => stopSimulation();
  }, [startSimulation, stopSimulation]);

  return (
    <div className="min-h-screen h-screen bg-slate-950 text-slate-100 p-6 flex flex-col font-sans overflow-auto">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-slate-800 pb-4 gap-4">
        <div className="flex items-center gap-4">
          <button 
            onClick={onExit}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-4 py-2.5 rounded-lg font-bold uppercase text-xs tracking-widest border border-slate-700 transition-colors shadow-lg shrink-0"
          >
            ⬅️ Return to Simulator
          </button>
          <div>
            <h1 className="text-2xl font-bold text-cyan-400 uppercase tracking-widest leading-none mb-1">Observatory Instructor Dashboard</h1>
            <p className="text-sm text-slate-400">Classroom Telemetry & Override Commands</p>
          </div>
        </div>
        
        {/* God Mode Bar */}
        <div className="flex flex-wrap gap-4 items-center bg-slate-900 p-3 rounded-xl border border-slate-700 shrink-0">
          <button 
            onClick={toggleStudentControls}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold uppercase text-xs tracking-widest border transition-colors ${
              areControlsLocked 
                ? 'bg-emerald-900/50 hover:bg-emerald-800 text-emerald-200 border-emerald-500/50' 
                : 'bg-red-900/50 hover:bg-red-800 text-red-200 border-red-500/50'
            }`}
          >
            {areControlsLocked ? <Lock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
            {areControlsLocked ? '🔓 Unlock All Controls' : '🔒 Lock All Student Controls'}
          </button>
          
          <div className="flex items-center gap-2">
            <select 
              value={syncTarget}
              onChange={(e) => setSyncTarget(e.target.value)}
              className="bg-slate-800 text-slate-200 px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-widest border border-slate-600"
            >
              {Object.keys(TARGETS).map(k => (
                <option key={k} value={k}>{TARGETS[k as keyof typeof TARGETS].name}</option>
              ))}
            </select>
            <button 
              onClick={() => forceSyncTarget(syncTarget)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold uppercase text-xs tracking-widest transition-colors"
            >
              <Target className="w-4 h-4" /> Force Sync Target
            </button>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-20">
        {students.map(student => {
          const hasSafetyViolation = student.safetyViolations !== 'None';
          const isOutOfFocus = !student.isFocused;
          const isNominal = !hasSafetyViolation && !isOutOfFocus;

          return (
            <div 
              key={student.id} 
              className={`bg-slate-900 rounded-2xl p-5 border-2 transition-all ${
                hasSafetyViolation ? 'border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse' :
                isOutOfFocus ? 'border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]' :
                'border-slate-800'
              }`}
            >
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-white">{student.name}</h3>
                {hasSafetyViolation ? (
                  <ShieldAlert className="w-6 h-6 text-red-500" />
                ) : isOutOfFocus ? (
                  <AlertTriangle className="w-6 h-6 text-amber-500" />
                ) : (
                  <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                )}
              </div>
              
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-500 uppercase font-bold tracking-wider text-[10px]">Target</span>
                  <span className="text-cyan-300 font-medium">{TARGETS[student.activeTarget as keyof typeof TARGETS]?.name || student.activeTarget}</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-500 uppercase font-bold tracking-wider text-[10px]">Magnification</span>
                  <span className="text-slate-300 font-mono">{student.activeMagnification}x</span>
                </div>
                <div className="flex justify-between border-b border-slate-800 pb-2">
                  <span className="text-slate-500 uppercase font-bold tracking-wider text-[10px]">Focus</span>
                  <span className={student.isFocused ? 'text-emerald-400' : 'text-amber-400'}>{student.isFocused ? 'NOMINAL' : 'OUT OF FOCUS'}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span className="text-slate-500 uppercase font-bold tracking-wider text-[10px]">Status</span>
                  <span className={
                    student.safetyViolations === 'Solar Hazard' ? 'text-red-500 font-bold animate-pulse' :
                    student.safetyViolations === 'Dust Cap On' ? 'text-slate-400' :
                    isNominal ? 'text-emerald-500' : 'text-amber-500'
                  }>
                    {student.safetyViolations === 'None' ? (isNominal ? 'NOMINAL' : 'WARNING') : student.safetyViolations.toUpperCase()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </main>
      
      <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
        <div className="bg-slate-900/80 backdrop-blur text-slate-400 px-4 py-2 rounded-full text-xs font-mono border border-slate-800 shadow-lg pointer-events-auto">
          Press <strong className="text-white">Alt+I</strong> or double-click the Title to return
        </div>
      </div>
    </div>
  );
};
