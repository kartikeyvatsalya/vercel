import { create } from 'zustand';

export interface Student {
  id: string;
  name: string;
  activeTarget: string;
  activeMagnification: number;
  isFocused: boolean;
  safetyViolations: 'None' | 'Dust Cap On' | 'Solar Hazard';
}

interface InstructorState {
  students: Student[];
  isSimulationRunning: boolean;
  areControlsLocked: boolean;
  startSimulation: () => void;
  stopSimulation: () => void;
  toggleStudentControls: () => void;
  forceSyncTarget: (targetId: string) => void;
}

const INITIAL_STUDENTS: Student[] = [
  { id: '1', name: 'Student A', activeTarget: 'moon', activeMagnification: 48, isFocused: true, safetyViolations: 'None' },
  { id: '2', name: 'Student B', activeTarget: 'saturn', activeMagnification: 120, isFocused: false, safetyViolations: 'None' }, // Out of focus
  { id: '3', name: 'Student C', activeTarget: 'm42', activeMagnification: 48, isFocused: true, safetyViolations: 'Dust Cap On' }, // Dust cap on
  { id: '4', name: 'Student D', activeTarget: 'sun', activeMagnification: 48, isFocused: true, safetyViolations: 'Solar Hazard' }, // Solar Hazard
  { id: '5', name: 'Student E', activeTarget: 'spire', activeMagnification: 120, isFocused: true, safetyViolations: 'None' },
];

let simInterval: number | null = null;

export const useInstructorStore = create<InstructorState>((set, get) => ({
  students: INITIAL_STUDENTS,
  isSimulationRunning: false,
  areControlsLocked: false,

  startSimulation: () => {
    if (get().isSimulationRunning) return;
    set({ isSimulationRunning: true });

    simInterval = window.setInterval(() => {
      set((state) => ({
        students: state.students.map(student => {
          // Slightly randomize state occasionally to simulate live activity
          if (Math.random() > 0.8) {
            return {
              ...student,
              isFocused: Math.random() > 0.3,
            };
          }
          return student;
        })
      }));
    }, 10000);
  },

  stopSimulation: () => {
    if (simInterval) clearInterval(simInterval);
    set({ isSimulationRunning: false });
  },

  toggleStudentControls: () => {
    const isLocked = !get().areControlsLocked;
    set({ areControlsLocked: isLocked });
    // Simulated broadcast
    console.log(`Broadcast: ${isLocked ? 'LOCK_CONTROLS' : 'UNLOCK_CONTROLS'}`);
  },

  forceSyncTarget: (targetId: string) => {
    // Simulated broadcast
    console.log(`Broadcast: SYNC_TARGET -> ${targetId}`);
    set((state) => ({
      students: state.students.map(s => ({ ...s, activeTarget: targetId, safetyViolations: 'None', isFocused: true }))
    }));
    alert(`Broadcast sent: All students synced to ${targetId}.`);
  }
}));
