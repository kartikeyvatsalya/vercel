import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // ── WebGL stack in its own named chunk (Phase 59) ──
        // App.tsx loads ObservatoryScene through React.lazy, so Rollup already
        // splits the 3D code out of the entry bundle. Naming the chunk keeps
        // that split legible in the build output (and stable across refactors
        // of which component imports what), so a regression that drags three
        // back into the critical path is visible the moment it happens rather
        // than three phases later.
        // Function form rather than the {name: [...]} map: drei pulls in
        // three-stdlib and friends transitively, and a literal package list
        // would silently leave those in the entry bundle.
        manualChunks(id) {
          if (/node_modules[\\/](three|three-stdlib|@react-three)[\\/]/.test(id)) return 'three';
          return undefined;
        },
      },
    },
  },
})
