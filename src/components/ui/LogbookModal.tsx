import React, { useState } from 'react';
import { useProgressStore, type LogbookEntry } from '../../store/useProgressStore';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { getMagnification } from '../../engine/opticalMath';
import { X, BookOpen, Award, Lock, ChevronDown, ChevronUp, Save, Clock } from 'lucide-react';

interface LogbookModalProps {
  onClose: () => void;
}

const ACHIEVEMENTS = [
  { id: 'first_alignment', title: 'First Alignment', desc: 'Center the target in the finderscope' },
  { id: 'solar_safety_expert', title: 'Solar Safety Expert', desc: 'Identify and mitigate a solar hazard' },
  { id: 'night_sky_navigator', title: 'Night Sky Navigator', desc: 'Track a drifting target for 15 seconds' },
  { id: 'optics_master', title: 'Optics Master', desc: 'Test all eyepieces and observe atmospheric limits' },
  { id: 'master_astronomer', title: 'Master Astronomer', desc: 'Complete the Saturn Reconnaissance mission' },
  { id: 'deep_sky_astrophotographer', title: 'Deep Sky Astrophotographer', desc: 'Stack and calibrate the Orion Nebula' },
];

const QUICK_TAGS = [
  'Crisp Terminator',
  'Boiling Edge',
  'High Contrast',
  'Faint Detail',
  'Too Dim',
  'Perfect Focus',
  'Turbulent Sky'
];

export const LogbookModal: React.FC<LogbookModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'achievements' | 'logbook'>('achievements');
  const progressState = useProgressStore();
  const telescopeState = useTelescopeStore();
  
  // New Entry State
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isNoteExpanded, setIsNoteExpanded] = useState(false);
  const [customNote, setCustomNote] = useState('');

  const currentMag = getMagnification(
    telescopeState.activeProfile?.focalLength || 1200,
    telescopeState.eyepieceFocalLength
  );

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSaveObservation = () => {
    const entry: LogbookEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      targetId: telescopeState.activeTarget?.id || 'unknown',
      magnification: currentMag,
      seeingQuality: telescopeState.seeingQuality,
      tags: selectedTags,
      customNote: customNote.trim() || undefined,
    };
    progressState.addLogbookEntry(entry);
    setSelectedTags([]);
    setCustomNote('');
    setIsNoteExpanded(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 w-full max-w-4xl max-h-[90vh] rounded-2xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('achievements')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold uppercase tracking-widest text-xs transition-colors ${
                activeTab === 'achievements' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <Award className="w-4 h-4" /> Achievements
            </button>
            <button
              onClick={() => setActiveTab('logbook')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold uppercase tracking-widest text-xs transition-colors ${
                activeTab === 'logbook' ? 'bg-amber-950 text-amber-400 border border-amber-800' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              <BookOpen className="w-4 h-4" /> Field Logbook
            </button>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950/50">
          
          {/* TAB: Achievements */}
          {activeTab === 'achievements' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ACHIEVEMENTS.map(badge => {
                const isUnlocked = progressState.achievements.includes(badge.id);
                return (
                  <div 
                    key={badge.id} 
                    className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-500 ${
                      isUnlocked 
                        ? 'border-emerald-500/50 bg-emerald-950/20 shadow-[0_0_15px_rgba(16,185,129,0.15)]' 
                        : 'border-slate-800 bg-slate-900/50 opacity-60 grayscale'
                    }`}
                  >
                    <div className={`p-3 rounded-full shrink-0 ${isUnlocked ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      {isUnlocked ? <Award className="w-8 h-8" /> : <Lock className="w-8 h-8" />}
                    </div>
                    <div>
                      <h3 className={`font-bold text-lg ${isUnlocked ? 'text-emerald-300' : 'text-slate-400'}`}>
                        {badge.title}
                      </h3>
                      <p className="text-sm text-slate-500">{badge.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB: Logbook */}
          {activeTab === 'logbook' && (
            <div className="flex flex-col gap-6">
              
              {/* New Entry Form */}
              <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-lg">
                <h3 className="text-sm font-bold uppercase tracking-widest text-slate-300 mb-4 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-amber-500" /> Log Current Observation
                </h3>
                
                <div className="flex flex-wrap gap-4 mb-4 text-sm bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-slate-500 uppercase text-[10px] tracking-widest">Target:</span>
                    <span className="font-bold text-cyan-400">{telescopeState.activeTarget?.name || 'Unknown'}</span>
                  </div>
                  <div className="w-px bg-slate-700" />
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-slate-500 uppercase text-[10px] tracking-widest">Power:</span>
                    <span className="font-bold text-emerald-400">{currentMag}x</span>
                  </div>
                  <div className="w-px bg-slate-700" />
                  <div className="flex items-center gap-2 text-slate-300">
                    <span className="text-slate-500 uppercase text-[10px] tracking-widest">Seeing:</span>
                    <span className="font-bold text-amber-400">{telescopeState.seeingQuality}/5</span>
                  </div>
                </div>

                <div className="mb-4">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mb-2">Quick Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_TAGS.map(tag => {
                      const isActive = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                            isActive 
                              ? 'bg-amber-500/20 border-amber-500 text-amber-300' 
                              : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mb-4">
                  <button 
                    onClick={() => setIsNoteExpanded(!isNoteExpanded)}
                    className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    {isNoteExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    Add Field Notes (Optional)
                  </button>
                  {isNoteExpanded && (
                    <textarea
                      value={customNote}
                      onChange={(e) => setCustomNote(e.target.value)}
                      placeholder="Write your observational notes here..."
                      className="w-full mt-3 bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 min-h-[80px]"
                    />
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleSaveObservation}
                    className="flex items-center gap-2 px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg transition-colors shadow-lg shadow-amber-900/20"
                  >
                    <Save className="w-4 h-4" /> Save to Logbook
                  </button>
                </div>
              </div>

              {/* Past Entries */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 px-2">Past Entries</h3>
                {progressState.logbookEntries.length === 0 ? (
                  <p className="text-center text-sm text-slate-600 py-8 italic border border-dashed border-slate-800 rounded-xl">
                    Your logbook is empty. Record your first observation above!
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {progressState.logbookEntries.map(entry => (
                      <div key={entry.id} className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4 flex flex-col gap-3">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <h4 className="font-bold text-cyan-300 capitalize text-lg leading-none">{entry.targetId}</h4>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-700 text-slate-300">
                              {entry.magnification}x
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-700 text-slate-300">
                              Seeing: {entry.seeingQuality}/5
                            </span>
                          </div>
                          <span className="text-xs text-slate-500 flex items-center gap-1 font-mono">
                            <Clock className="w-3 h-3" />
                            {new Date(entry.timestamp).toLocaleString(undefined, {
                              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                            })}
                          </span>
                        </div>
                        
                        {entry.tags.length > 0 && (
                          <div className="flex gap-2 flex-wrap">
                            {entry.tags.map(tag => (
                              <span key={tag} className="text-[10px] uppercase tracking-wider text-amber-200 bg-amber-900/30 px-2 py-1 rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        {entry.customNote && (
                          <p className="text-sm text-slate-300 italic border-l-2 border-slate-600 pl-3">
                            "{entry.customNote}"
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
          
        </div>
      </div>
    </div>
  );
};
