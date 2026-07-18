import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
    }
  )
);
