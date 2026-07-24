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
    // Phase 47 perf fix: this runs unconditionally every frame from
    // LiveViewPanel's shared rAF loop. At rest (no thumbscrew held) the
    // velocities are both zero, so the computed offsets are identical to
    // the current ones — but `set()` still replaces the store's top-level
    // object and notifies every subscriber regardless, and LiveViewPanel
    // subscribes to this whole store with no selector. That forced a full
    // re-render of a very heavy component 60×/sec, forever, even with the
    // student just looking at the view. Skipping the no-op write when
    // nothing is actually turning fixes that without changing the result.
    if (angularVelocityX === 0 && angularVelocityY === 0) return;
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
