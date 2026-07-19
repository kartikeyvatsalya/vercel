import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Stars, PerspectiveCamera, Billboard } from '@react-three/drei';
import { Orbit, Eye, Telescope as TelescopeIcon } from 'lucide-react';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { convertHorizontalToEquatorial, convertEquatorialToHorizontal, getJulianDate, getLocalSiderealTime } from '../../engine/ephemerisMath';
import { TERRESTRIAL_POINTING, getBodyEquatorial } from '../../engine/skyGeometry';
import { EYEPIECE_CATALOG, DEFAULT_EYEPIECE_ID, getMagnification, getTrueFOV } from '../../engine/opticalMath';
import { getSmoothSimTime } from '../../engine/timeEngine';
import { getSkyState } from '../../engine/daylight';
import { STAR_CATALOG, STAR_TINT } from '../../engine/starCatalog';
import { TARGETS } from '../../data/bookContent';
import type { TelescopeProfile, Target } from '../../types';

/**
 * ObservatoryScene — Phase 23: Realistic Mount Engine; Phase 27, P27.6: 3D camera rig
 * ───────────────────────────────────────────────────────────────
 * This renderer *reads* pointing state (pointingAlt/pointingAz) from
 * useTelescopeStore and never mutates optics/rules state. The mount
 * geometry is procedurally selected from the active telescope profile:
 *
 *   mountType 'Equatorial'      → German equatorial: polar-tilted wedge,
 *                                 counterweight shaft, HA/Dec kinematics
 *   type 'Dobsonian'            → rocker box + side-board altitude cradle
 *   other Alt-Az                → tripod + fork yoke
 *
 * Pointing conventions (numerically verified, see eq_kinematics_check):
 *   world: +Y up, +Z = North (az 0°), +X = az 90°
 *   Alt-Az rig:  azGroup.rotation.y = az,  altGroup.rotation.x = −alt
 *   EQ rig:      polarTilt.rotation.x = −latitude,
 *                haGroup.rotation.z = hourAngle,
 *                decGroup.rotation.x = −(90° − declination)
 *   (tube forward = local +Z in every rig)
 *
 * Camera rig (P27.6): `cameraMode` picks which camera R3F actually renders
 * through, via drei's `<PerspectiveCamera makeDefault>` swap-on-mount:
 *   'orbit'        → today's OrbitControls, unchanged
 *   'skyGaze'       → camera fixed on the pad; SkyGazeControls maps pointer
 *                     drag to first-person pitch/yaw look-around
 *   'throughScope'  → a virtual camera parented INSIDE the active rig's tube
 *                     group, aimed down local +Z (the optical axis), FOV
 *                     locked to the active eyepiece's derived true FOV — it
 *                     inherits the tube's slew/tracking transform for free
 */

// Damping factor for the smooth "servo motor" slew feel.
const SLEW_DAMPING = 3.5;
// Degrees of mount motion per pixel of pointer drag.
const DRAG_SENSITIVITY = 0.25;
// Degrees of look-around per pixel of pointer drag in 'skyGaze' mode.
const LOOK_SENSITIVITY = 0.15;
// Radius (world units) at which target billboards sit on the sky dome —
// just inside the real-catalog star shell (47) and the decorative
// <Stars radius={50}> haze.
const SKY_TARGET_RADIUS = 45;
// Radius of the real-catalog starfield (Phase 29).
const CATALOG_STAR_RADIUS = 47;

// ── PBR Material Palette (Phase 32) ────────────────────────────────
// Prop bundles spread into meshStandardMaterial / meshPhysicalMaterial.
// clearcoat/transmission bundles REQUIRE meshPhysicalMaterial; the plain
// metal/roughness ones work on either. Every bundle carries its own
// envMapIntensity so the shared RoomEnvironment IBL (StudioEnvironment
// below) reads night-appropriately per surface — matte castings barely
// pick it up, lacquer and glass glint.

/** Automotive-style two-coat painted metal: the classic glossy OTA finish (SCT orange). */
const TUBE_GLOSS = { metalness: 0.75, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 } as const;
/** Pearl-white painted aluminum for the refractor tube — dielectric paint over metal, lacquered. */
const PEARL_PAINT = { metalness: 0.35, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.8 } as const;
/** Resin-and-tow weave under gloss lacquer; the procedural map supplies the twill pattern. */
const CARBON_WEAVE = { metalness: 0.15, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.8 } as const;
/** Heavy, light-eating matte casting — pier bases, counterweights. */
const CAST_IRON = { metalness: 0.72, roughness: 0.88, envMapIntensity: 0.35 } as const;
/** Satin powder-coated aluminum — tripod legs, yokes, EQ housings. */
const POWDER_COAT = { metalness: 0.35, roughness: 0.68, envMapIntensity: 0.5 } as const;
/** Black-anodized fittings — focusers, finders, bezels, rear cells. */
const ANODIZED_TRIM = { metalness: 0.85, roughness: 0.38, envMapIntensity: 0.7 } as const;
/** Bare polished steel — the EQ counterweight shaft. */
const POLISHED_STEEL = { metalness: 1, roughness: 0.18, envMapIntensity: 1 } as const;
/** Varnished baltic-birch plywood — the Dobsonian rocker (a Dob's mount IS wood; the
    cast-iron/powder-coat briefs apply to the metal mounts and the Dob's ground board). */
const PLYWOOD = { metalness: 0, roughness: 0.62, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.3 } as const;
/** Multicoated crown optical glass — SCT corrector plate, refractor objective.
    transmission renders the scene behind it (the dark baffled interior), which is
    exactly what a real corrector shows: black innards under glinting coatings. */
const OPTICAL_GLASS = {
  metalness: 0,
  roughness: 0.04,
  transmission: 0.92,
  ior: 1.52,
  thickness: 0.02,
  specularIntensity: 1,
  clearcoat: 0.6,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1,
} as const;

// ── Procedural carbon-fiber twill (Phase 32) ───────────────────────
// A 2×2-twill weave baked once into a small CanvasTexture: alternating
// warp/weft cells shaded by a directional gradient so the tow sheen flips
// with fiber direction — reads as carbon fiber at any practical distance,
// with zero network fetches. Module-level singleton; lives for the app's
// lifetime like the glyph caches in engine/targetGlyphs.
let carbonFiberTexture: THREE.CanvasTexture | null = null;
function getCarbonFiberTexture(): THREE.CanvasTexture {
  if (carbonFiberTexture) return carbonFiberTexture;
  const cells = 8;
  const cellPx = 16;
  const size = cells * cellPx;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const x = col * cellPx;
      const y = row * cellPx;
      // 2×2 twill: tow direction flips on a diagonal stagger.
      const horizontal = Math.floor((row + col) / 2) % 2 === 0;
      const grad = horizontal
        ? ctx.createLinearGradient(x, y, x + cellPx, y)
        : ctx.createLinearGradient(x, y, x, y + cellPx);
      grad.addColorStop(0, horizontal ? '#454b54' : '#2a2e35');
      grad.addColorStop(0.5, horizontal ? '#31353d' : '#383d46');
      grad.addColorStop(1, horizontal ? '#23262c' : '#1e2126');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, cellPx, cellPx);
      // Faint tow-edge shadow line separating the bundles.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      if (horizontal) ctx.fillRect(x, y + cellPx - 1, cellPx, 1);
      else ctx.fillRect(x + cellPx - 1, y, 1, cellPx);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // Newtonian tube: circumference ≈ length ≈ 1 world unit, so a square
  // repeat keeps the weave cells square on the cylinder's UV wrap.
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  carbonFiberTexture = tex;
  return tex;
}

// ── Procedural studio environment (Phase 32) ───────────────────────
// PBR metals and glass are lit by reflection; without an environment map
// the upgraded materials would fall to near-black under the scene's mostly
// diffuse night lighting. three's RoomEnvironment is a fully procedural
// studio box (no HDR download) run through PMREM once at mount; per-bundle
// envMapIntensity above keeps the night mood (the sky/fog/points materials
// are non-PBR and ignore scene.environment entirely).
const StudioEnvironment: React.FC = () => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    return () => {
      scene.environment = null;
      envRT.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
};

type OtaKind = TelescopeProfile['type'];
type CameraMode = 'orbit' | 'skyGaze' | 'throughScope';

// ─── Manual Slewing: grab-the-tube drag (two-way binding) ────────
interface DragHandlers {
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOver: () => void;
  onPointerOut: () => void;
}

function useTubeDrag(onDragChange: (dragging: boolean) => void): DragHandlers {
  // Holds the teardown fn of the in-flight drag so unmount can't leak window listeners.
  const activeDragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => activeDragCleanupRef.current?.(), []);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation(); // don't let OrbitControls see this pointer-down
    if (activeDragCleanupRef.current) return; // one drag at a time
    onDragChange(true);
    document.body.style.cursor = 'grabbing';

    // Pin the drag to the pointer that started it (Phase 36) — on a
    // multi-touch iPad a second stray contact (a resting palm, a second
    // finger) fires its own pointermove on window and must not also steer
    // this drag; a mouse only ever has one active pointerId, so this is a
    // no-op on desktop.
    const activePointerId = e.nativeEvent.pointerId;
    let lastX = e.nativeEvent.clientX;
    let lastY = e.nativeEvent.clientY;
    let hasSlippedClutch = false;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== activePointerId) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      if (dx === 0 && dy === 0) return;
      lastX = ev.clientX;
      lastY = ev.clientY;

      const store = useTelescopeStore.getState();
      // ── Clutch physics (Phase 34) ── Grabbing the tube slips the clutch:
      // the sidereal motor disengages, but the mount does NOT forget the
      // target — it stays in the sky and streaks out of the field as you
      // pan away. (This used to clearTarget(), which blanked the target
      // from both 2D feeds; the motor snap-back that guarded against is
      // already impossible — setPointing moves a running motor's tracked
      // RA/Dec lock with the mount, Phase 26 audit fix 4a.)
      if (!hasSlippedClutch) {
        if (store.isTrackingMotorOn) store.toggleTrackingMotor();
        hasSlippedClutch = true;
      }
      // Drag right = azimuth clockwise, drag up = altitude up.
      store.setPointing(
        store.pointingAlt - dy * DRAG_SENSITIVITY,
        store.pointingAz + dx * DRAG_SENSITIVITY
      );
    };

    const endDrag = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== activePointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      activeDragCleanupRef.current = null;
      onDragChange(false);
      document.body.style.cursor = 'auto';
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    activeDragCleanupRef.current = endDrag;
  };

  const onPointerOver = () => {
    if (!activeDragCleanupRef.current) document.body.style.cursor = 'grab';
  };
  const onPointerOut = () => {
    if (!activeDragCleanupRef.current) document.body.style.cursor = 'auto';
  };

  return { onPointerDown, onPointerOver, onPointerOut };
}

// ─── Shared Alt-Az pointing loop (Dobsonian + fork rigs) ─────────
function useAltAzPointing(
  azimuthRef: React.RefObject<THREE.Group | null>,
  altitudeRef: React.RefObject<THREE.Group | null>
) {
  useFrame((_state, delta) => {
    const { pointingAlt, pointingAz } = useTelescopeStore.getState();
    // Mechanical horizon limit: the store may hold a sub-horizon ephemeris
    // altitude; the physical tube hard-stops at 0° (no ground clipping).
    const visualAlt = THREE.MathUtils.clamp(pointingAlt, 0, 90);

    if (azimuthRef.current) {
      azimuthRef.current.rotation.y = THREE.MathUtils.damp(
        azimuthRef.current.rotation.y,
        THREE.MathUtils.degToRad(pointingAz),
        SLEW_DAMPING,
        delta
      );
    }
    if (altitudeRef.current) {
      // rotation.x = −alt: 0° = tube horizontal (+Z), −90° = zenith.
      altitudeRef.current.rotation.x = THREE.MathUtils.damp(
        altitudeRef.current.rotation.x,
        -THREE.MathUtils.degToRad(visualAlt),
        SLEW_DAMPING,
        delta
      );
    }
  });
}

// ─── Optical Tube Assemblies (per profile type) ──────────────────

/** Fat Newtonian tube: shared by the Dobsonian rig and 'Newtonian EQ'.
    Phase 32: lacquered carbon-fiber wrap (procedural twill) + anodized fittings. */
const NewtonianTube: React.FC = () => (
  <group>
    <mesh castShadow position={[0, 0, 0.15]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.16, 0.16, 1.15, 24]} />
      <meshPhysicalMaterial color="#ffffff" map={getCarbonFiberTexture()} {...CARBON_WEAVE} />
    </mesh>
    {/* Mirror-cell end cap */}
    <mesh castShadow position={[0, 0, -0.44]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.165, 0.165, 0.07, 24]} />
      <meshStandardMaterial color="#1b1f27" {...ANODIZED_TRIM} />
    </mesh>
    {/* Focuser near the open end (Newtonians focus at the front) */}
    <mesh castShadow position={[0.16, 0.1, 0.38]} rotation={[0, 0, -Math.PI / 3]}>
      <cylinderGeometry args={[0.035, 0.035, 0.14, 12]} />
      <meshStandardMaterial color="#1b1f27" {...ANODIZED_TRIM} />
    </mesh>
    {/* Finderscope */}
    <mesh castShadow position={[-0.1, 0.16, 0.32]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.03, 0.03, 0.3, 10]} />
      <meshStandardMaterial color="#11131a" {...ANODIZED_TRIM} />
    </mesh>
  </group>
);

/** Long, slim refractor: pearl-white lacquered tube, dew shield, rear focuser +
    diagonal. Phase 32: a real multicoated objective lens (transmissive glass over
    a dark interior baffle) sits at the tube's front, recessed in the dew shield. */
const RefractorTube: React.FC = () => (
  <group>
    <mesh castShadow position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.055, 0.055, 1.3, 20]} />
      <meshPhysicalMaterial color="#e8ecf4" {...PEARL_PAINT} />
    </mesh>
    {/* Dew shield */}
    <mesh castShadow position={[0, 0, 0.75]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.075, 0.075, 0.28, 20]} />
      <meshStandardMaterial color="#232a3a" {...POWDER_COAT} />
    </mesh>
    {/* Interior baffle behind the objective — what you actually see through the
        glass is a blackened tube, not the white end cap of the tube cylinder. */}
    <mesh position={[0, 0, 0.695]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.054, 0.054, 0.01, 20]} />
      <meshStandardMaterial color="#0a0c12" roughness={0.95} metalness={0} />
    </mesh>
    {/* Objective lens: crown glass with a faint blue-violet coating cast.
        Sits at z=0.71, well behind the through-scope camera at z=1.05. */}
    <mesh position={[0, 0, 0.71]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.052, 0.052, 0.012, 20]} />
      <meshPhysicalMaterial color="#eef2ff" {...OPTICAL_GLASS} />
    </mesh>
    {/* Lens-cell retaining bezel */}
    <mesh position={[0, 0, 0.712]}>
      <torusGeometry args={[0.053, 0.006, 8, 24]} />
      <meshStandardMaterial color="#1b1f27" {...ANODIZED_TRIM} />
    </mesh>
    {/* Focuser drawtube */}
    <mesh position={[0, 0, -0.68]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.028, 0.028, 0.18, 12]} />
      <meshStandardMaterial color="#1b1f27" {...ANODIZED_TRIM} />
    </mesh>
    {/* Star diagonal + eyepiece angled back-up */}
    <mesh position={[0, 0.06, -0.76]} rotation={[Math.PI / 4, 0, 0]}>
      <cylinderGeometry args={[0.024, 0.024, 0.12, 10]} />
      <meshStandardMaterial color="#1b1f27" {...ANODIZED_TRIM} />
    </mesh>
  </group>
);

/** Short rear-cell SCT barrel: classic glossy-orange lacquer, tapered back.
    Phase 32: the fake solid "corrector ring" front cap became a real optical
    stack — dark interior baffle, central secondary-mirror housing, transmissive
    corrector plate, and an anodized retaining bezel. Through the glass you see
    the blackened innards and the secondary's obstruction dot, exactly like
    looking into a real SCT. All of it sits at z ≤ 0.29, safely behind the
    through-scope camera at z=1.05 (see the Phase 29 bugfix note below). */
const SCTBarrel: React.FC = () => (
  <group>
    <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.17, 0.17, 0.52, 24]} />
      <meshPhysicalMaterial color="#d9782d" {...TUBE_GLOSS} />
    </mesh>
    {/* Interior baffle — the dark scene the corrector transmits. */}
    <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.168, 0.168, 0.02, 24]} />
      <meshStandardMaterial color="#07080c" roughness={0.95} metalness={0} />
    </mesh>
    {/* Secondary-mirror housing mounted in the corrector's center */}
    <mesh position={[0, 0, 0.265]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.048, 0.048, 0.04, 16]} />
      <meshStandardMaterial color="#14161c" {...ANODIZED_TRIM} />
    </mesh>
    {/* Corrector plate: thin multicoated glass with a faint green cast */}
    <mesh position={[0, 0, 0.285]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.162, 0.162, 0.01, 24]} />
      <meshPhysicalMaterial color="#f2f8f4" {...OPTICAL_GLASS} />
    </mesh>
    {/* Retaining bezel around the glass edge */}
    <mesh position={[0, 0, 0.285]}>
      <torusGeometry args={[0.166, 0.011, 8, 32]} />
      <meshStandardMaterial color="#1b1f27" {...ANODIZED_TRIM} />
    </mesh>
    {/* Rear cell, tapering backwards */}
    <mesh castShadow position={[0, 0, -0.3]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.155, 0.1, 0.1, 24]} />
      <meshStandardMaterial color="#1b1f27" {...ANODIZED_TRIM} />
    </mesh>
    {/* Visual back / focuser knob */}
    <mesh position={[0, 0, -0.38]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.03, 0.03, 0.08, 12]} />
      <meshStandardMaterial color="#11131a" {...ANODIZED_TRIM} />
    </mesh>
    {/* Finderscope */}
    <mesh castShadow position={[0.12, 0.14, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
      <cylinderGeometry args={[0.025, 0.025, 0.22, 10]} />
      <meshStandardMaterial color="#11131a" {...ANODIZED_TRIM} />
    </mesh>
  </group>
);

/** Picks the OTA silhouette for a profile type. */
const OpticalTube: React.FC<{ kind: OtaKind }> = ({ kind }) => {
  if (kind === 'Refractor') return <RefractorTube />;
  if (kind === 'Dobsonian' || kind === 'Newtonian EQ') return <NewtonianTube />;
  // SCT / Maksutov / Smart / Binoculars — compact catadioptric barrel
  return <SCTBarrel />;
};

// ─── Through-the-eyepiece virtual camera (P27.6; unblocked in Phase 29) ──
// Parented directly inside a tube group by the caller, so it inherits the
// tube's slew/tracking transform for free. Three.js cameras look down local
// −Z by default; tube-forward is +Z (see file header), hence the 180° yaw.
//
// BUGFIX (Phase 29): the camera used to sit at the tube group's ORIGIN —
// physically inside the OTA meshes. For the SCT barrel that meant staring
// point-blank into the back of the solid corrector-ring disk at z≈0.27
// (and for refractors, into the dew-shield cylinder) — the whole "Eyepiece
// camera renders black" bug. Now it rides at z=+1.05, just past the front
// aperture of every OTA silhouette (Newtonian front 0.73, refractor dew
// shield 0.89, SCT corrector 0.29), looking out at the open sky.
const THROUGH_SCOPE_CAMERA_Z = 1.05;

const ThroughScopeCamera: React.FC = () => {
  const activeProfile = useTelescopeStore((s) => s.activeProfile);
  const eyepieceFocalLength = useTelescopeStore((s) => s.eyepieceFocalLength);
  const activeEyepieceId = useTelescopeStore((s) => s.activeEyepieceId);
  const isBarlowActive = useTelescopeStore((s) => s.isBarlowActive);

  const activeEyepiece = EYEPIECE_CATALOG.find((e) => e.id === activeEyepieceId)
    ?? EYEPIECE_CATALOG.find((e) => e.id === DEFAULT_EYEPIECE_ID)!;
  const magnification = getMagnification(activeProfile.focalLength, eyepieceFocalLength, isBarlowActive);
  const trueFovDeg = THREE.MathUtils.clamp(getTrueFOV(activeEyepiece.afovDeg, magnification), 0.2, 150);

  return (
    <PerspectiveCamera
      makeDefault
      fov={trueFovDeg}
      near={0.1}
      position={[0, 0, THROUGH_SCOPE_CAMERA_Z]}
      rotation={[0, Math.PI, 0]}
    />
  );
};

// ─── First-person sky-gaze look-around (P27.6) ────────────────────
// Same hand-rolled pointer-drag idiom as useTubeDrag (stopPropagation first,
// window-level move/up listeners) but routed through R3F's own raycasting
// via a big invisible background sphere — clicking the tube hits the tube
// mesh first (nearer, so it wins and stops propagation here), clicking open
// sky hits this sphere, so tube-dragging and look-around can never both fire
// from the same pointer-down.
const SkyGazeControls: React.FC = () => {
  const { camera } = useThree();
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const dragRef = useRef<{ lastX: number; lastY: number } | null>(null);

  useEffect(() => {
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    yawRef.current = euler.y;
    pitchRef.current = euler.x;
  }, [camera]);

  useEffect(() => () => { document.body.style.cursor = 'auto'; }, []);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    // Pin the drag to the pointer that started it (Phase 36) — see the
    // matching comment in useTubeDrag above.
    const activePointerId = e.nativeEvent.pointerId;
    dragRef.current = { lastX: e.nativeEvent.clientX, lastY: e.nativeEvent.clientY };
    document.body.style.cursor = 'grabbing';

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current || ev.pointerId !== activePointerId) return;
      const dx = ev.clientX - dragRef.current.lastX;
      const dy = ev.clientY - dragRef.current.lastY;
      dragRef.current.lastX = ev.clientX;
      dragRef.current.lastY = ev.clientY;
      // Drag right = look right, drag up = look up (standard mouselook).
      yawRef.current -= THREE.MathUtils.degToRad(dx * LOOK_SENSITIVITY);
      pitchRef.current = THREE.MathUtils.clamp(
        pitchRef.current - THREE.MathUtils.degToRad(dy * LOOK_SENSITIVITY),
        -Math.PI / 2 + 0.02,
        Math.PI / 2 - 0.02
      );
    };
    const endDrag = (ev?: PointerEvent) => {
      if (ev && ev.pointerId !== activePointerId) return;
      dragRef.current = null;
      document.body.style.cursor = 'auto';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  };

  useFrame(() => {
    camera.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ'));
  });

  return (
    <mesh
      onPointerDown={onPointerDown}
      onPointerOver={() => { if (!dragRef.current) document.body.style.cursor = 'grab'; }}
      onPointerOut={() => { if (!dragRef.current) document.body.style.cursor = 'auto'; }}
    >
      <sphereGeometry args={[48, 16, 16]} />
      <meshBasicMaterial side={THREE.BackSide} transparent opacity={0} depthWrite={false} />
    </mesh>
  );
};

// ─── Sky-Dome Target Sprites (P27.6) ───────────────────────────────
// Billboard markers for the catalog's above-horizon targets, positioned by
// real Alt/Az unit vectors recomputed each frame — they render as direct
// scene children rather than nested inside SkyDome's latitude-tilt/LST-spin
// groups (either frame works; per-target Alt/Az keeps the active-marker and
// horizon-visibility logic simple).
function altAzToVector3(altDeg: number, azDeg: number, radius: number): THREE.Vector3 {
  const altRad = THREE.MathUtils.degToRad(altDeg);
  const azRad = THREE.MathUtils.degToRad(azDeg);
  return new THREE.Vector3(
    radius * Math.cos(altRad) * Math.sin(azRad),
    radius * Math.sin(altRad),
    radius * Math.cos(altRad) * Math.cos(azRad)
  );
}

const TARGET_MARKER_COLOR: Record<Target['type'], string> = {
  moon: '#e2e8f0',
  sun: '#fbbf24',
  planet: '#facc15',
  star: '#e2e8f0',
  nebula: '#c084fc',
  galaxy: '#c084fc',
  terrestrial: '#94a3b8',
};

const SkyTargetBillboard: React.FC<{ target: Target }> = ({ target }) => {
  const groupRef = useRef<THREE.Group>(null);
  const isActive = useTelescopeStore((s) => s.activeTarget?.id === target.id);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    // Phase 29: every-frame updates against the SMOOTH clock. The old 0.5s
    // throttle was invisible at orbit scale but produced whole-screen
    // saccades in the through-scope camera (0.13° FOV), where a half-second
    // of sidereal motion is several fields of view at 60× playback. Five
    // targets × one trig conversion is far too cheap to be worth that.
    const { observerLocation } = useTelescopeStore.getState();

    let alt: number;
    let az: number;
    if (target.type === 'terrestrial') {
      alt = TERRESTRIAL_POINTING.alt;
      az = TERRESTRIAL_POINTING.az;
    } else {
      // Phase 35: resolve through getBodyEquatorial so the dome billboard
      // and the 2D optical feeds agree on every body — the Sun in
      // particular rides the live solar ephemeris, matching the daylight.
      const smoothNow = getSmoothSimTime();
      const eq = getBodyEquatorial(target, smoothNow);
      if (!eq) {
        group.visible = false;
        return;
      }
      const pos = convertEquatorialToHorizontal(
        eq.ra, eq.dec,
        observerLocation.latitude, observerLocation.longitude,
        new Date(smoothNow)
      );
      alt = pos.altitude;
      az = pos.azimuth;
    }

    group.visible = alt > 0;
    if (alt > 0) {
      group.position.copy(altAzToVector3(alt, az, SKY_TARGET_RADIUS));
    }
  });

  return (
    <group ref={groupRef}>
      <Billboard>
        <mesh>
          <circleGeometry args={[isActive ? 0.55 : 0.35, 16]} />
          {/* fog={false}: the scene fog fully attenuates by 28 units and the
              sky shell sits at 45 — without this the markers fog to black
              (they're sky imagery, not scenery). Set at construction, never
              toggled, so no shader-recompile concerns. */}
          <meshBasicMaterial
            color={isActive ? '#22d3ee' : TARGET_MARKER_COLOR[target.type]}
            transparent
            opacity={isActive ? 0.95 : 0.7}
            fog={false}
          />
        </mesh>
      </Billboard>
    </group>
  );
};

const SkyTargets: React.FC = () => (
  <>
    {Object.values(TARGETS).map((t) => <SkyTargetBillboard key={t.id} target={t} />)}
  </>
);

// ─── Mount Assembly: Dobsonian rocker box (Alt-Az) ───────────────
const DobsonianAssembly: React.FC<{ drag: DragHandlers; cameraMode: CameraMode }> = ({ drag, cameraMode }) => {
  const azimuthRef = useRef<THREE.Group>(null);
  const altitudeRef = useRef<THREE.Group>(null);
  useAltAzPointing(azimuthRef, altitudeRef);

  return (
    <group>
      {/* Circular ground board — heavy matte casting under the wood rocker */}
      <mesh castShadow receiveShadow position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.5, 0.52, 0.06, 28]} />
        <meshStandardMaterial color="#23272e" {...CAST_IRON} />
      </mesh>

      {/* Rocker box — rotates in azimuth on the ground board; varnished plywood */}
      <group ref={azimuthRef} position={[0, 0.06, 0]}>
        <mesh castShadow receiveShadow position={[0, 0.06, 0]}>
          <boxGeometry args={[0.68, 0.12, 0.68]} />
          <meshPhysicalMaterial color="#6e4f30" {...PLYWOOD} />
        </mesh>
        {/* Altitude-cradle side boards */}
        <mesh castShadow position={[-0.31, 0.39, 0]}>
          <boxGeometry args={[0.06, 0.54, 0.5]} />
          <meshPhysicalMaterial color="#7a5836" {...PLYWOOD} />
        </mesh>
        <mesh castShadow position={[0.31, 0.39, 0]}>
          <boxGeometry args={[0.06, 0.54, 0.5]} />
          <meshPhysicalMaterial color="#7a5836" {...PLYWOOD} />
        </mesh>
        {/* Front board */}
        <mesh castShadow position={[0, 0.24, 0.31]}>
          <boxGeometry args={[0.56, 0.24, 0.06]} />
          <meshPhysicalMaterial color="#6e4f30" {...PLYWOOD} />
        </mesh>

        {/* Tube + altitude bearings pivot at the side-board tops */}
        <group ref={altitudeRef} position={[0, 0.66, 0]} {...drag}>
          <NewtonianTube />
          {cameraMode === 'throughScope' && <ThroughScopeCamera />}
          {/* Altitude bearing disks riding the cradle — semi-gloss laminate */}
          <mesh castShadow position={[-0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.13, 0.13, 0.12, 20]} />
            <meshStandardMaterial color="#23272e" {...ANODIZED_TRIM} />
          </mesh>
          <mesh castShadow position={[0.25, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.13, 0.13, 0.12, 20]} />
            <meshStandardMaterial color="#23272e" {...ANODIZED_TRIM} />
          </mesh>
        </group>
      </group>
    </group>
  );
};

// ─── Mount Assembly: tripod + fork yoke (generic Alt-Az) ─────────
const AltAzForkAssembly: React.FC<{ ota: OtaKind; drag: DragHandlers; cameraMode: CameraMode }> = ({ ota, drag, cameraMode }) => {
  const azimuthRef = useRef<THREE.Group>(null);
  const altitudeRef = useRef<THREE.Group>(null);
  useAltAzPointing(azimuthRef, altitudeRef);

  return (
    <group>
      {/* Tripod legs — satin powder-coated aluminum */}
      {[0, 120, 240].map((deg) => (
        <group key={deg} rotation={[0, THREE.MathUtils.degToRad(deg), 0]}>
          <mesh castShadow position={[0, 0.38, 0.16]} rotation={[0.38, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.028, 0.8, 10]} />
            <meshStandardMaterial color="#3d4451" {...POWDER_COAT} />
          </mesh>
        </group>
      ))}
      {/* Head plate */}
      <mesh castShadow position={[0, 0.76, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 0.05, 16]} />
        <meshStandardMaterial color="#2b2f36" {...CAST_IRON} />
      </mesh>

      <group ref={azimuthRef} position={[0, 0.8, 0]}>
        {/* Yoke column + arms */}
        <mesh castShadow position={[0, 0.07, 0]}>
          <boxGeometry args={[0.16, 0.14, 0.16]} />
          <meshStandardMaterial color="#3d4451" {...POWDER_COAT} />
        </mesh>
        <mesh castShadow position={[-0.11, 0.3, 0]}>
          <boxGeometry args={[0.045, 0.36, 0.09]} />
          <meshStandardMaterial color="#3d4451" {...POWDER_COAT} />
        </mesh>
        <mesh castShadow position={[0.11, 0.3, 0]}>
          <boxGeometry args={[0.045, 0.36, 0.09]} />
          <meshStandardMaterial color="#3d4451" {...POWDER_COAT} />
        </mesh>

        <group ref={altitudeRef} position={[0, 0.44, 0]} {...drag}>
          <OpticalTube kind={ota} />
          {cameraMode === 'throughScope' && <ThroughScopeCamera />}
        </group>
      </group>
    </group>
  );
};

// ─── Mount Assembly: German equatorial on a polar wedge ──────────
const EquatorialAssembly: React.FC<{ ota: OtaKind; drag: DragHandlers; cameraMode: CameraMode }> = ({ ota, drag, cameraMode }) => {
  const haGroupRef = useRef<THREE.Group>(null);
  const decGroupRef = useRef<THREE.Group>(null);
  const latitude = useTelescopeStore((s) => s.observerLocation.latitude);

  useFrame((_state, delta) => {
    const { pointingAlt, pointingAz, observerLocation } = useTelescopeStore.getState();
    const visualAlt = THREE.MathUtils.clamp(pointingAlt, 0, 90); // horizon hard-stop
    const { hourAngle, declination } = convertHorizontalToEquatorial(
      visualAlt,
      pointingAz,
      observerLocation.latitude
    );

    if (haGroupRef.current) {
      haGroupRef.current.rotation.z = THREE.MathUtils.damp(
        haGroupRef.current.rotation.z,
        THREE.MathUtils.degToRad(hourAngle),
        SLEW_DAMPING,
        delta
      );
    }
    if (decGroupRef.current) {
      decGroupRef.current.rotation.x = THREE.MathUtils.damp(
        decGroupRef.current.rotation.x,
        -THREE.MathUtils.degToRad(90 - declination),
        SLEW_DAMPING,
        delta
      );
    }
  });

  return (
    <group>
      {/* Base plate + pier column — heavy cast iron */}
      <mesh castShadow receiveShadow position={[0, 0.035, 0]}>
        <cylinderGeometry args={[0.32, 0.36, 0.07, 20]} />
        <meshStandardMaterial color="#23272e" {...CAST_IRON} />
      </mesh>
      <mesh castShadow position={[0, 0.45, 0]}>
        <cylinderGeometry args={[0.085, 0.1, 0.78, 16]} />
        <meshStandardMaterial color="#2b2f36" {...CAST_IRON} />
      </mesh>
      {/* Wedge platform */}
      <mesh castShadow position={[0, 0.88, 0]}>
        <boxGeometry args={[0.26, 0.09, 0.26]} />
        <meshStandardMaterial color="#3d4451" {...POWDER_COAT} />
      </mesh>

      {/* Polar-tilted head: local +Z points at the celestial pole (alt = latitude) */}
      <group position={[0, 0.96, 0]} rotation={[-THREE.MathUtils.degToRad(latitude), 0, 0]}>
        {/* RA (polar) housing */}
        <mesh castShadow rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]}>
          <cylinderGeometry args={[0.1, 0.115, 0.44, 18]} />
          <meshStandardMaterial color="#3d4451" {...POWDER_COAT} />
        </mesh>

        {/* Hour-angle group: spins around the polar axis */}
        <group ref={haGroupRef} position={[0, 0, 0.26]}>
          {/* Declination housing (the dec axis runs along local X) */}
          <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.085, 0.085, 0.36, 16]} />
            <meshStandardMaterial color="#3d4451" {...POWDER_COAT} />
          </mesh>
          {/* Counterweight shaft (bare polished steel) + cast weight box */}
          <mesh castShadow rotation={[0, 0, Math.PI / 2]} position={[-0.42, 0, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.5, 10]} />
            <meshStandardMaterial color="#aeb6c2" {...POLISHED_STEEL} />
          </mesh>
          <mesh castShadow position={[-0.56, 0, 0]}>
            <boxGeometry args={[0.15, 0.17, 0.17]} />
            <meshStandardMaterial color="#23272e" {...CAST_IRON} />
          </mesh>

          {/* Declination group: OTA saddle rides the dec axis */}
          <group ref={decGroupRef} position={[0.24, 0, 0]} {...drag}>
            <mesh castShadow position={[0.05, 0, 0]}>
              <boxGeometry args={[0.07, 0.14, 0.34]} />
              <meshStandardMaterial color="#2b2f36" {...POWDER_COAT} />
            </mesh>
            <group position={[0.16, 0, 0]}>
              <OpticalTube kind={ota} />
              {cameraMode === 'throughScope' && <ThroughScopeCamera />}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
};

// ─── Profile-driven rig selection ────────────────────────────────
const TelescopeRig: React.FC<{ onTubeDragChange: (dragging: boolean) => void; cameraMode: CameraMode }> = ({
  onTubeDragChange, cameraMode,
}) => {
  const profile = useTelescopeStore((s) => s.activeProfile);
  const drag = useTubeDrag(onTubeDragChange);

  if (profile.mountType === 'Equatorial') {
    return <EquatorialAssembly ota={profile.type} drag={drag} cameraMode={cameraMode} />;
  }
  if (profile.type === 'Dobsonian') {
    return <DobsonianAssembly drag={drag} cameraMode={cameraMode} />;
  }
  return <AltAzForkAssembly ota={profile.type} drag={drag} cameraMode={cameraMode} />;
};

// ─── Ground / Observing Pad ──────────────────────────────────────
const ObservatoryGround: React.FC = () => (
  <group>
    {/* Grass field — envMapIntensity pinned low so the Phase 32 studio IBL
        can't lift the night ground out of its moody black-green */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
      <planeGeometry args={[60, 60]} />
      <meshStandardMaterial color="#152014" roughness={1} envMapIntensity={0.1} />
    </mesh>
    {/* Faint survey grid to ground the instrument's scale */}
    <gridHelper args={[40, 40, '#233246', '#0d1420']} position={[0, 0.005, 0]} />
    {/* Concrete observing pad + boundary ring */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.01, 0]}>
      <circleGeometry args={[2.2, 32]} />
      <meshStandardMaterial color="#5a5c60" roughness={0.9} envMapIntensity={0.15} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[2.05, 2.2, 48]} />
      <meshStandardMaterial color="#42474e" roughness={0.85} envMapIntensity={0.15} />
    </mesh>
  </group>
);

// ─── Dynamic Sky Dome (Phase 25; real catalog + daylight in Phase 29) ──
// The sky is rigged like the real celestial sphere: tilted so its rotation
// axis points at the celestial pole (altitude = observer latitude), then
// spun about that axis by the Local Sidereal Time. Stepping +1 Hour visibly
// turns the whole dome ~15°.
//
// Phase 29 replaces "decorative random stars only" with the REAL catalog:
// each star sits at its J2000 equatorial unit vector
//   e = (cosδ·sinα, cosδ·cosα, sinδ)   (α = RA as an angle, δ = Dec)
// and the rig applies R_x(−latitude)·R_z(+LST)·e, which reproduces
// convertEquatorialToHorizontal exactly (checked against the meridian,
// rising-east, and pole cases) — so the 3D dome, the 2D feeds, and the
// telemetry all agree on where every star is. The drei <Stars> shell stays
// as a faint deep-sky haze behind the catalog, night-only.
const SkyDome: React.FC = () => {
  const spinRef = useRef<THREE.Group>(null);
  const decorRef = useRef<THREE.Group>(null);
  const brightMatRef = useRef<THREE.PointsMaterial>(null);
  const faintMatRef = useRef<THREE.PointsMaterial>(null);
  const latitude = useTelescopeStore((s) => s.observerLocation.latitude);

  // Build the catalog point clouds once (two size classes so first-magnitude
  // stars visibly outrank the rest at a glance).
  const { brightGeom, faintGeom } = useMemo(() => {
    const build = (stars: typeof STAR_CATALOG) => {
      const positions: number[] = [];
      const colors: number[] = [];
      const tint = new THREE.Color();
      for (const star of stars) {
        const raRad = THREE.MathUtils.degToRad(star.ra * 15);
        const decRad = THREE.MathUtils.degToRad(star.dec);
        positions.push(
          CATALOG_STAR_RADIUS * Math.cos(decRad) * Math.sin(raRad),
          CATALOG_STAR_RADIUS * Math.cos(decRad) * Math.cos(raRad),
          CATALOG_STAR_RADIUS * Math.sin(decRad)
        );
        tint.set(STAR_TINT[star.spec]);
        const intensity = THREE.MathUtils.clamp(1.25 - 0.16 * star.mag, 0.22, 1);
        colors.push(tint.r * intensity, tint.g * intensity, tint.b * intensity);
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return geom;
    };
    return {
      brightGeom: build(STAR_CATALOG.filter((s) => s.mag < 1.3)),
      faintGeom: build(STAR_CATALOG.filter((s) => s.mag >= 1.3)),
    };
  }, []);

  useFrame(() => {
    const { observerLocation, isVirtualNight } = useTelescopeStore.getState();
    const simTimeSmooth = getSmoothSimTime();
    const lstHours = getLocalSiderealTime(getJulianDate(new Date(simTimeSmooth)), observerLocation.longitude);
    if (spinRef.current) {
      // +LST (not −): required by the equatorial mapping above. The old
      // −LST spin was purely cosmetic (random stars can spin either way).
      spinRef.current.rotation.z = THREE.MathUtils.degToRad(lstHours * 15);
    }
    // Daylight fade: stars dissolve through twilight exactly like the 2D feeds.
    const sky = getSkyState(observerLocation.latitude, observerLocation.longitude, simTimeSmooth, isVirtualNight);
    if (brightMatRef.current) brightMatRef.current.opacity = sky.darkness;
    if (faintMatRef.current) faintMatRef.current.opacity = sky.darkness * 0.9;
    if (decorRef.current) decorRef.current.visible = sky.darkness > 0.25;
  });

  return (
    <group rotation={[-THREE.MathUtils.degToRad(latitude), 0, 0]}>
      <group ref={spinRef}>
        {/* Real star catalog (Phase 29) — actual constellations, correct
            alt/az at all times. fog={false}: sky imagery must not be eaten
            by the ground-haze fog (full by 28 units; the shell is at 47). */}
        <points geometry={brightGeom}>
          <pointsMaterial
            ref={brightMatRef}
            size={3.2}
            sizeAttenuation={false}
            vertexColors
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            fog={false}
          />
        </points>
        <points geometry={faintGeom}>
          <pointsMaterial
            ref={faintMatRef}
            size={1.8}
            sizeAttenuation={false}
            vertexColors
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            fog={false}
          />
        </points>
        {/* Decorative deep-sky haze — thousands of anonymous faint points
            behind the catalog; hidden once twilight brightens. */}
        <group ref={decorRef}>
          <Stars radius={50} depth={30} count={2500} factor={3} fade speed={0.5} />
        </group>
      </group>
    </group>
  );
};

// ─── Dynamic Daylight (Phase 29) ─────────────────────────────────
// Drives the scene's background and fog colors from the Sun's altitude (or
// the Virtual Night override) every frame, so the 3D observatory tracks the
// same day → twilight → night ramp as the 2D eyepiece canvases. Mutates the
// existing THREE.Color instances in place — no React re-renders involved.
const DynamicSkyColor: React.FC = () => {
  const scene = useThree((s) => s.scene);
  useFrame(() => {
    const { observerLocation, isVirtualNight } = useTelescopeStore.getState();
    const sky = getSkyState(
      observerLocation.latitude, observerLocation.longitude,
      getSmoothSimTime(), isVirtualNight
    );
    if (scene.background instanceof THREE.Color) scene.background.set(sky.skyColor);
    if (scene.fog) scene.fog.color.set(sky.skyColor);
  });
  return null;
};

// ─── Lighting Rig ─────────────────────────────────────────────────
const ObservatoryLighting: React.FC = () => (
  <>
    {/* Strong ambient fill — lifts the dark primitive meshes out of the black sky */}
    <ambientLight intensity={1.5} color="#9fb0cc" />
    {/* Moonlight: cool directional key light with shadows */}
    <directionalLight
      position={[5, 8, 3]}
      intensity={1.6}
      color="#cfe0ff"
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-near={0.5}
      shadow-camera-far={30}
      shadow-camera-left={-8}
      shadow-camera-right={8}
      shadow-camera-top={8}
      shadow-camera-bottom={-8}
    />
    {/* Instrument accent: warm-white point light aimed at the telescope for
        specular highlights and volumetric depth on the metallic tube.
        (Physical light units: intensity is candela, hence the large value.) */}
    <pointLight position={[1.8, 2.6, 1.6]} intensity={20} distance={15} decay={2} color="#dbe9ff" />
    {/* Rim light for separation from the sky */}
    <hemisphereLight color="#3a4d7a" groundColor="#0a0a0f" intensity={0.45} />
  </>
);

// ─── Camera Mode Toggle (P27.6) — HTML overlay, outside the Canvas ────
const CAMERA_MODE_META: { id: CameraMode; label: string; icon: React.ReactNode }[] = [
  { id: 'orbit', label: 'Orbit', icon: <Orbit className="w-3.5 h-3.5" /> },
  { id: 'skyGaze', label: 'Sky Gaze', icon: <Eye className="w-3.5 h-3.5" /> },
  { id: 'throughScope', label: 'Eyepiece', icon: <TelescopeIcon className="w-3.5 h-3.5" /> },
];

const CameraModeToggle: React.FC<{ cameraMode: CameraMode; onChange: (mode: CameraMode) => void }> = ({ cameraMode, onChange }) => (
  <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 bg-slate-800/80 border border-slate-700 rounded-lg p-0.5 pointer-events-auto">
    {CAMERA_MODE_META.map((m) => (
      <button
        key={m.id}
        onClick={() => onChange(m.id)}
        title={`Switch to ${m.label} camera`}
        className={`flex items-center gap-1 px-2 py-1 rounded-md font-bold uppercase tracking-widest text-[9px] transition-colors ${
          cameraMode === m.id ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {m.icon} <span className="hidden lg:inline">{m.label}</span>
      </button>
    ))}
  </div>
);

// ─── Public Component ────────────────────────────────────────────
interface ObservatorySceneProps {
  /** Allow the host layout to disable orbit controls (e.g. background mode). */
  interactive?: boolean;
}

export const ObservatoryScene: React.FC<ObservatorySceneProps> = ({ interactive = true }) => {
  // True while the user is dragging the telescope tube. OrbitControls must be
  // frozen during the drag so aiming the instrument doesn't also spin the camera.
  const [isTubeDragging, setIsTubeDragging] = useState(false);
  // Which camera drives the Canvas — see the file header for what each does.
  // Internal state (not lifted to App.tsx): only reachable via the toggle
  // below, which itself only renders when `interactive`, so a non-interactive
  // background mount never leaves 'orbit'.
  const [cameraMode, setCameraMode] = useState<CameraMode>('orbit');

  return (
    <div className="relative w-full h-full">
      <Canvas
        shadows
        // Phase 30: pulled in from [3.5, 2.2, 4.5] (~20% closer to the
        // orbit target) so the instrument doesn't read as "too small" on
        // first load — same viewing angle, just a tighter default frame.
        // Still safely within OrbitControls' [1.2, 12] distance bounds.
        camera={{ position: [2.8, 1.9, 3.6], fov: 45 }}
        className="w-full h-full"
      >
        <color attach="background" args={['#04050a']} />
        <fog attach="fog" args={['#04050a', 8, 28]} />
        {/* Recolors the background/fog above per-frame from the Sun's altitude */}
        <DynamicSkyColor />
        {/* Procedural IBL for the Phase 32 PBR materials — see StudioEnvironment */}
        <StudioEnvironment />

        <ObservatoryLighting />
        <ObservatoryGround />
        <TelescopeRig onTubeDragChange={setIsTubeDragging} cameraMode={cameraMode} />

        {/* Night sky backdrop — rotates with Local Sidereal Time (Phase 25) */}
        <SkyDome />
        {/* Above-horizon catalog targets, positioned by real Alt/Az (P27.6) */}
        <SkyTargets />

        {interactive && cameraMode === 'orbit' && (
          <OrbitControls
            // Full spherical freedom above the ground plane (Phase 26):
            // 0.02 rad shy of the exact zenith (gimbal singularity) down to
            // 0.02 rad above the horizon. With the orbit target at y=0.7 the
            // camera stays above ground even at minimum distance, and pan
            // stays disabled so the target can never sink underground.
            enabled={!isTubeDragging}
            target={[0, 0.7, 0]}
            enablePan={false}
            minDistance={1.2}
            maxDistance={12}
            minPolarAngle={0.02}
            maxPolarAngle={Math.PI / 2 - 0.02}
          />
        )}
        {interactive && cameraMode === 'skyGaze' && <SkyGazeControls />}
        {/* 'throughScope' mounts its <PerspectiveCamera makeDefault> inside
            the active rig itself (see TelescopeRig above) so it inherits the
            tube's own transform instead of needing a second copy of the
            slew/tracking math here. */}
      </Canvas>

      {interactive && <CameraModeToggle cameraMode={cameraMode} onChange={setCameraMode} />}
    </div>
  );
};

export default ObservatoryScene;
