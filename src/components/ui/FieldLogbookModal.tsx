import React, { useMemo, useState } from 'react';
import { useProgressStore, type LogbookEntry } from '../../store/useProgressStore';
import { TARGETS } from '../../data/bookContent';
import { missions as RANK_MISSIONS } from '../../data/missions';
import {
  X,
  Trophy,
  Lock,
  Camera,
  Rocket,
  Star,
  Aperture,
  Gauge,
  ImageOff,
  Zap,
  Layers,
  Clock,
  GraduationCap,
  NotebookPen,
  Orbit,
} from 'lucide-react';


interface FieldLogbookModalProps {
  onClose: () => void;
}

// ─── Badge Catalogue ────────────────────────────────────────────
// Mirrors the achievement ids unlocked by missionEngine.ts / LiveViewPanel.tsx
interface BadgeDef {
  id: string;
  title: string;
  desc: string;
  icon: React.ReactNode;
}

const MISSION_BADGES: BadgeDef[] = [
  { id: 'first_alignment', title: 'First Alignment', desc: 'Center the target in the finderscope', icon: <Star className="w-7 h-7" /> },
  { id: 'solar_safety_expert', title: 'Solar Safety Expert', desc: 'Identify and mitigate a solar hazard', icon: <Aperture className="w-7 h-7" /> },
  { id: 'night_sky_navigator', title: 'Night Sky Navigator', desc: 'Track a drifting target for 15 seconds', icon: <Gauge className="w-7 h-7" /> },
  { id: 'optics_master', title: 'Optics Master', desc: 'Test all eyepieces and observe atmospheric limits', icon: <Layers className="w-7 h-7" /> },
  { id: 'master_astronomer', title: 'Master Astronomer', desc: 'Complete the Saturn Reconnaissance mission', icon: <Rocket className="w-7 h-7" /> },
  { id: 'deep_sky_astrophotographer', title: 'Deep Sky Astrophotographer', desc: 'Stack and calibrate the Orion Nebula', icon: <Camera className="w-7 h-7" /> },
  { id: 'jovian_observer', title: 'Jovian Observer', desc: "Advance the clock on Jupiter and watch Galileo's moons orbit", icon: <Orbit className="w-7 h-7" /> },
];

// ─── Astrophotography Capture Parsing ──────────────────────────
// The astrophotography trainer persists graded captures as generic LogbookEntry
// records (tags + a free-text customNote). We defensively parse those back out
// into structured "capture cards" here, gracefully skipping anything malformed.
interface ParsedCapture {
  entry: LogbookEntry;
  targetName: string;
  category: 'Planetary' | 'Deep Sky';
  grade: string | null;
  exposure: string | null;
  iso: string | null;
  descriptiveTags: string[];
}

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function gradeColorClasses(grade: string | null): string {
  if (!grade) return 'bg-slate-700 text-slate-300';
  if (grade.startsWith('A')) return 'bg-emerald-600 text-white';
  if (grade === 'B') return 'bg-cyan-600 text-white';
  if (grade === 'C') return 'bg-amber-600 text-white';
  return 'bg-red-600 text-white';
}

/**
 * Safely converts a raw (possibly malformed) logbook entry into a
 * ParsedCapture, or returns null if it isn't a recognizable astrophotography
 * entry. This shields the UI from any future schema drift in useProgressStore.
 */
function parseAstrophotoEntry(raw: unknown): ParsedCapture | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const entry = raw as Partial<LogbookEntry>;
    if (!entry.id || !Array.isArray(entry.tags)) return null;

    const tags = entry.tags.filter((t): t is string => typeof t === 'string');
    const isPlanetary = tags.includes('Planetary');
    const isDeepSky = tags.includes('Deep Sky');
    if (!isPlanetary && !isDeepSky) return null; // Not an astrophotography capture

    const note = safeString(entry.customNote);

    const gradeTag = tags.find((t) => t.startsWith('Grade:'));
    const grade = gradeTag ? gradeTag.replace('Grade:', '').trim() : null;

    const isoMatch = note.match(/ISO\s*(\d+)/i);
    const iso = isoMatch ? isoMatch[1] : null;

    let exposure: string | null = null;
    const subMatch = note.match(/(\d+)\s*[×x]\s*(\d+)\s*s/i);
    const framesMatch = note.match(/(\d+)\s*frames.*?top\s*(\d+)%/i);
    if (subMatch) {
      exposure = `${subMatch[1]} × ${subMatch[2]}s`;
    } else if (framesMatch) {
      exposure = `${framesMatch[1]} frames · top ${framesMatch[2]}%`;
    }

    const descriptiveTags = tags.filter(
      (t) =>
        !t.startsWith('Grade:') &&
        !['Planetary', 'Deep Sky', 'Lucky Imaging', 'DSO Stack'].includes(t)
    );

    const targetId = safeString(entry.targetId);
    const targetName = TARGETS[targetId]?.name || (targetId ? targetId.toUpperCase() : 'Unknown Target');

    return {
      entry: entry as LogbookEntry,
      targetName,
      category: isPlanetary ? 'Planetary' : 'Deep Sky',
      grade,
      exposure,
      iso,
      descriptiveTags,
    };
  } catch {
    // Any unexpected shape simply gets skipped — never crash the portfolio.
    return null;
  }
}

export const FieldLogbookModal: React.FC<FieldLogbookModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<'badges' | 'gallery' | 'curriculum'>('badges');
  const progressState = useProgressStore();

  // ── Data Safety Check: never trust the store shape blindly ──
  const earnedBadges: string[] = useMemo(() => {
    const raw = progressState.achievements;
    if (!Array.isArray(raw)) return [];
    return raw.filter((a): a is string => typeof a === 'string');
  }, [progressState.achievements]);

  const captures: ParsedCapture[] = useMemo(() => {
    const raw = progressState.logbookEntries;
    if (!Array.isArray(raw)) return [];
    return raw
      .map(parseAstrophotoEntry)
      .filter((c): c is ParsedCapture => c !== null);
  }, [progressState.logbookEntries]);

  // ── Rank Curriculum: field notes ("failure is data") ──
  const fieldNotes: LogbookEntry[] = useMemo(() => {
    const raw = progressState.logbookEntries;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is LogbookEntry => !!e && Array.isArray(e.tags) && e.tags.includes('Field Note')
    );
  }, [progressState.logbookEntries]);

  const rankIMissions = RANK_MISSIONS.filter(m => m.rank === 'I');
  const rankIIMissions = RANK_MISSIONS.filter(m => m.rank === 'II');


  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-slate-900 w-full max-w-5xl max-h-[90vh] rounded-2xl border border-slate-700 shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-950">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-amber-500/20 border border-amber-500/40 p-2 rounded-xl">
                <Trophy className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold bg-gradient-to-r from-amber-400 to-cyan-400 bg-clip-text text-transparent leading-none">
                  Field Logbook & Portfolio
                </h2>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mt-0.5">
                  {earnedBadges.length}/{MISSION_BADGES.length} Badges · {captures.length} Captures
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition-colors"
            aria-label="Close Field Logbook"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-4 pt-4 border-b border-slate-800 bg-slate-900/50">
          <button
            onClick={() => setActiveTab('badges')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-bold uppercase tracking-widest text-xs transition-colors ${
              activeTab === 'badges'
                ? 'bg-amber-950/60 text-amber-400 border border-amber-800 border-b-transparent'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Trophy className="w-4 h-4" /> Mission Badges
          </button>
          <button
            onClick={() => setActiveTab('gallery')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-bold uppercase tracking-widest text-xs transition-colors ${
              activeTab === 'gallery'
                ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-800 border-b-transparent'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <Camera className="w-4 h-4" /> Astrophotography Gallery
          </button>
          <button
            onClick={() => setActiveTab('curriculum')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg font-bold uppercase tracking-widest text-xs transition-colors ${
              activeTab === 'curriculum'
                ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800 border-b-transparent'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 border border-transparent'
            }`}
          >
            <GraduationCap className="w-4 h-4" /> Rank Curriculum
          </button>
        </div>


        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-950/50">

          {/* ── SECTION A: MISSION BADGES ── */}
          {activeTab === 'badges' && (
            <div className="flex flex-col gap-5">
              {earnedBadges.length === 0 && (
                <div className="flex flex-col items-center justify-center text-center gap-2 py-6 border border-dashed border-amber-800/40 bg-amber-950/10 rounded-2xl">
                  <Trophy className="w-8 h-8 text-amber-500/60" />
                  <p className="text-amber-200/80 text-sm font-semibold">
                    Complete observing missions to earn badges!
                  </p>
                  <p className="text-slate-500 text-xs max-w-sm">
                    Open the "Mission" menu in the top navigation bar and follow the guided steps.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {MISSION_BADGES.map((badge) => {
                  const isUnlocked = earnedBadges.includes(badge.id);
                  return (
                    <div
                      key={badge.id}
                      className={`relative flex flex-col items-center text-center gap-3 p-5 rounded-2xl border-2 transition-all duration-500 ${
                        isUnlocked
                          ? 'border-amber-500/50 bg-gradient-to-br from-amber-950/40 to-slate-900 shadow-[0_0_25px_rgba(245,158,11,0.15)]'
                          : 'border-slate-800 bg-slate-900/50 opacity-50 grayscale'
                      }`}
                    >
                      {isUnlocked && (
                        <span className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-widest text-amber-400/70">
                          Earned
                        </span>
                      )}
                      <div
                        className={`p-4 rounded-full ${
                          isUnlocked
                            ? 'bg-amber-500/20 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]'
                            : 'bg-slate-800 text-slate-500'
                        }`}
                      >
                        {isUnlocked ? badge.icon : <Lock className="w-7 h-7" />}
                      </div>
                      <div>
                        <h3 className={`font-bold text-base ${isUnlocked ? 'text-amber-300' : 'text-slate-400'}`}>
                          {badge.title}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{badge.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── SECTION B: ASTROPHOTOGRAPHY GALLERY ── */}
          {activeTab === 'gallery' && (
            <div>
              {captures.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center gap-3 py-16 border border-dashed border-slate-800 rounded-2xl">
                  <ImageOff className="w-10 h-10 text-slate-600" />
                  <p className="text-slate-500 text-sm max-w-sm">
                    No captures yet. Head to the Astrophotography module, stack an exposure, and your graded targets will appear here!
                  </p>
                </div>
              ) : (
                <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
                  {captures.map((cap) => {
                    const ts = cap.entry?.timestamp;
                    const timeLabel =
                      typeof ts === 'number'
                        ? new Date(ts).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })
                        : 'Unknown time';

                    return (
                      <div
                        key={cap.entry.id}
                        className="mb-4 break-inside-avoid bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden shadow-lg"
                      >
                        {/* Simulated capture thumbnail */}
                        <div
                          className={`h-24 flex items-center justify-center relative ${
                            cap.category === 'Planetary'
                              ? 'bg-gradient-to-br from-amber-900/60 via-slate-900 to-slate-950'
                              : 'bg-gradient-to-br from-indigo-900/60 via-slate-900 to-slate-950'
                          }`}
                        >
                          {cap.category === 'Planetary' ? (
                            <Zap className="w-8 h-8 text-amber-400/60" />
                          ) : (
                            <Layers className="w-8 h-8 text-indigo-400/60" />
                          )}
                          <span
                            className={`absolute top-2 right-2 px-2.5 py-0.5 rounded-full text-[10px] font-bold shadow ${gradeColorClasses(
                              cap.grade
                            )}`}
                          >
                            {cap.grade || 'N/A'}
                          </span>
                        </div>

                        <div className="p-4 flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className="font-bold text-cyan-300 text-base leading-none truncate">
                              {cap.targetName}
                            </h4>
                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                              {cap.category}
                            </span>
                          </div>

                          <div className="flex gap-3 text-[11px] text-slate-400 flex-wrap">
                            {cap.exposure && (
                              <span className="flex items-center gap-1">
                                <Aperture className="w-3 h-3 text-slate-500" /> {cap.exposure}
                              </span>
                            )}
                            {cap.iso && (
                              <span className="flex items-center gap-1">
                                <Gauge className="w-3 h-3 text-slate-500" /> ISO {cap.iso}
                              </span>
                            )}
                          </div>

                          {cap.descriptiveTags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {cap.descriptiveTags.map((tag) => (
                                <span
                                  key={tag}
                                  className="text-[9px] uppercase tracking-wider text-indigo-200 bg-indigo-900/30 px-2 py-0.5 rounded"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          <p className="text-[10px] text-slate-500 flex items-center gap-1 mt-1 font-mono">
                            <Clock className="w-3 h-3" /> {timeLabel}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── SECTION C: RANK CURRICULUM ── */}
          {activeTab === 'curriculum' && (
            <div className="flex flex-col gap-8">
              {/* Rank I */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <GraduationCap className="w-4 h-4 text-amber-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400">
                    Rank I · Skywatcher
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {rankIMissions.map((m) => {
                    const isUnlocked = earnedBadges.includes(m.id);
                    return (
                      <div
                        key={m.id}
                        className={`relative flex flex-col gap-2 p-4 rounded-xl border-2 transition-all duration-500 ${
                          isUnlocked
                            ? 'border-amber-500/50 bg-gradient-to-br from-amber-950/40 to-slate-900'
                            : 'border-slate-800 bg-slate-900/50 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-bold text-sm ${isUnlocked ? 'text-amber-300' : 'text-slate-400'}`}>
                            {m.title}
                          </span>
                          {isUnlocked ? (
                            <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                          ) : (
                            <Lock className="w-4 h-4 text-slate-600 shrink-0" />
                          )}
                        </div>
                        <span className="text-[9px] uppercase tracking-widest text-slate-500">{m.targetId}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Rank II */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <GraduationCap className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-400">
                    Rank II · Observer
                  </h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {rankIIMissions.map((m) => {
                    const isUnlocked = earnedBadges.includes(m.id);
                    return (
                      <div
                        key={m.id}
                        className={`relative flex flex-col gap-2 p-4 rounded-xl border-2 transition-all duration-500 ${
                          isUnlocked
                            ? 'border-indigo-500/50 bg-gradient-to-br from-indigo-950/40 to-slate-900'
                            : 'border-slate-800 bg-slate-900/50 opacity-60'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`font-bold text-sm ${isUnlocked ? 'text-indigo-300' : 'text-slate-400'}`}>
                            {m.title.startsWith('Capstone') ? '🎖️ ' : ''}{m.title}
                          </span>
                          {isUnlocked ? (
                            <Trophy className="w-4 h-4 text-indigo-400 shrink-0" />
                          ) : (
                            <Lock className="w-4 h-4 text-slate-600 shrink-0" />
                          )}
                        </div>
                        <span className="text-[9px] uppercase tracking-widest text-slate-500">{m.targetId}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Field Notes ("failure is data") */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <NotebookPen className="w-4 h-4 text-slate-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Field Notes ({fieldNotes.length})
                  </h3>
                </div>
                {fieldNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center gap-2 py-8 border border-dashed border-slate-800 rounded-2xl">
                    <NotebookPen className="w-7 h-7 text-slate-600" />
                    <p className="text-slate-500 text-xs max-w-sm">
                      Abandon a Rank Mission mid-observation and your honest note lands here. Failure is data.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {fieldNotes.map((note) => (
                      <div key={note.id} className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                            {TARGETS[note.targetId]?.name || note.targetId}
                          </span>
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(note.timestamp).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 italic leading-relaxed">{note.customNote}</p>
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


