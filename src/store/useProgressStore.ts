import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createPersistStorage, isRecord, sanitizeNumber, sanitizeStringArray } from './persistGuards';

export interface LogbookEntry {
  id: string;
  timestamp: number;
  targetId: string;
  magnification: number;
  seeingQuality: number;
  tags: string[];
  customNote?: string;
}

interface ProgressState {
  achievements: string[];
  completedModules: string[];
  /** Curriculum lesson ids (engine/curriculum.ts) marked complete via their "Try it out" exercise. */
  completedLessons: string[];
  logbookEntries: LogbookEntry[];
  unlockAchievement: (id: string) => void;
  completeModule: (id: string) => void;
  completeLesson: (id: string) => void;
  addLogbookEntry: (entry: LogbookEntry) => void;
  resetProgress: () => void;
}

export const useProgressStore = create<ProgressState>()(
  persist(
    (set, get) => ({
      achievements: [],
      completedModules: [],
      completedLessons: [],
      logbookEntries: [],

      unlockAchievement: (id: string) => {
        const { achievements } = get();
        if (!achievements.includes(id)) {
          set({ achievements: [...achievements, id] });
        }
      },

      completeModule: (id: string) => {
        const { completedModules } = get();
        if (!completedModules.includes(id)) {
          set({ completedModules: [...completedModules, id] });
        }
      },

      completeLesson: (id: string) => {
        const { completedLessons } = get();
        if (!completedLessons.includes(id)) {
          set({ completedLessons: [...completedLessons, id] });
        }
      },

      addLogbookEntry: (entry: LogbookEntry) => {
        const { logbookEntries } = get();
        set({ logbookEntries: [entry, ...logbookEntries] });
      },

      resetProgress: () => set({ achievements: [], completedModules: [], completedLessons: [], logbookEntries: [] })
    }),
    {
      name: 'telescope-progress-storage', // name of item in localStorage
      // Written immediately (no coalescing): progress events are rare and
      // must survive an abrupt close. Deduped and exception-safe (Phase 66).
      storage: createPersistStorage<PersistedProgress>(),
      partialize: (state) => ({
        achievements: state.achievements,
        completedModules: state.completedModules,
        completedLessons: state.completedLessons,
        logbookEntries: state.logbookEntries,
      }),
      // ── Progress repair (Phase 66) ── Keep every valid achievement and
      // logbook entry; drop only records that cannot be shown or evaluated
      // (the mission engine reads entry.timestamp/targetId/tags directly).
      merge: (persistedState, currentState) => {
        const saved = isRecord(persistedState) ? persistedState : {};
        return {
          ...currentState,
          achievements: 'achievements' in saved ? sanitizeStringArray(saved.achievements) : currentState.achievements,
          completedModules: 'completedModules' in saved ? sanitizeStringArray(saved.completedModules) : currentState.completedModules,
          completedLessons: 'completedLessons' in saved ? sanitizeStringArray(saved.completedLessons) : currentState.completedLessons,
          logbookEntries: 'logbookEntries' in saved ? sanitizeLogbook(saved.logbookEntries) : currentState.logbookEntries,
        };
      },
    }
  )
);

type PersistedProgress = Pick<ProgressState, 'achievements' | 'completedModules' | 'completedLessons' | 'logbookEntries'>;

function sanitizeLogbook(value: unknown): LogbookEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: LogbookEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const { id, timestamp, targetId, customNote } = raw;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
    if (typeof targetId !== 'string' || !targetId) continue;
    seen.add(id);
    entries.push({
      id,
      timestamp,
      targetId,
      magnification: sanitizeNumber(raw.magnification, 0, 0, 100000),
      seeingQuality: sanitizeNumber(raw.seeingQuality, 3, 1, 5),
      tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
      ...(typeof customNote === 'string' ? { customNote } : {}),
    });
  }
  return entries;
}
