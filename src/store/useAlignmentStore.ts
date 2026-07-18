import { create } from 'zustand';

interface AlignmentState {
  offsetX: number; // Finderscope X misalignment in pixels/arcminutes
  offsetY: number; // Finderscope Y misalignment
  angularVelocityX: number; // Speed of thumbscrew turning
  angularVelocityY: number;
  isAligned: boolean;
  
  // Actions
  setOffsets: (x: number, y: number) => void;
  setAngularVelocity: (vx: number, vy: number) => void;
  updateOffsets: (deltaTime: number) => void;
  checkAlignment: (threshold: number) => void;
}

export const useAlignmentStore = create<AlignmentState>((set, get) => ({
  offsetX: 45, // Initial randomized misalignment
  offsetY: -30,
  angularVelocityX: 0,
  angularVelocityY: 0,
  isAligned: false,

  setOffsets: (x, y) => set({ offsetX: x, offsetY: y }),
  
  setAngularVelocity: (vx, vy) => set({ angularVelocityX: vx, angularVelocityY: vy }),
  
  updateOffsets: (deltaTime) => {
    const { offsetX, offsetY, angularVelocityX, angularVelocityY } = get();
    // Delta time in seconds. Velocity in units per second.
    const newX = offsetX + angularVelocityX * (deltaTime / 1000);
    const newY = offsetY + angularVelocityY * (deltaTime / 1000);
    set({ offsetX: newX, offsetY: newY });
  },

  checkAlignment: (threshold) => {
    const { offsetX, offsetY, isAligned } = get();
    const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
    if (distance < threshold && !isAligned) {
      set({ isAligned: true });
    } else if (distance >= threshold && isAligned) {
      set({ isAligned: false });
    }
  }
}));
