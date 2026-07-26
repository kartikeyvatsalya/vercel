import type { ReactElement } from 'react';

export interface TelescopeModule {
  id: string;
  title: string;
  learningObjectives: string[];
  completionCriteria: { [key: string]: boolean | number };
  render: () => ReactElement;
  update: (deltaTime: number) => void;
  reset: () => void;
}


export interface Target {
  id: string;
  name: string;
  distance: string;
  magnitude: number;
  angularSize: number; // in arcminutes (legacy display field)
  /** Accurate angular diameter in degrees, used for strict eyepiece scaling
   *  (Moon ≈ 0.51°, Saturn incl. rings ≈ 0.0125°). Optional because targets
   *  persisted in older localStorage snapshots predate this field. */
  angularDiameterDeg?: number;
  type: 'planet' | 'moon' | 'star' | 'nebula' | 'galaxy' | 'sun' | 'terrestrial';
  surfaceTextureUrl: string;
  rotationPeriod?: number;
  /** J2000 Right Ascension, in hours [0, 24). Omitted for terrestrial targets. */
  ra?: number;
  /** J2000 Declination, in degrees [-90, 90]. Omitted for terrestrial targets. */
  dec?: number;
  seasonVisibility: ('spring' | 'summer' | 'autumn' | 'winter')[];
  bestMagnification: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Expert';
}

/**
 * One adjustable mirror cell — the three-screw mount a primary or secondary
 * mirror actually sits in (Phase 57). Every field is a physical property of
 * the hardware, so engine/collimation.ts can derive tilt/piston from raw
 * screw turns without knowing which telescope it's looking at.
 */
export interface MirrorCell {
  /** Radius (mm) of the bolt circle the three collimation screws sit on. */
  screwCircleRadiusMm: number;
  /** Axial travel (mm) the cell moves at one screw per full 360° turn — the thread pitch. */
  threadPitchMm: number;
  /** Clock angle (deg, CCW from screen-right) of screw #1; screws #2/#3 follow at +120°/+240°. */
  screwPhaseDeg: number;
  /**
   * Angular gain from MIRROR tilt to OUTGOING BEAM deviation. A plain
   * reflection doubles the angle, so a flat (Newtonian primary or diagonal)
   * is 2. A Cassegrain's convex secondary additionally amplifies by its own
   * magnification — hence an SCT secondary's ~10, and why SCT collimation is
   * done in tiny fractions of a turn while a Dob's primary tolerates whole ones.
   */
  beamDeviationGain: number;
  /**
   * Focal-plane shift per mm of COMMON-MODE cell travel (all three screws
   * turned equally). A rigidly translated Newtonian primary carries its own
   * focal plane with it (1); a Cassegrain secondary is a focus amplifier and
   * moves the back focus many times its own travel.
   */
  pistonFocusGain: number;
}

/**
 * Which of a telescope's mirrors the user can actually reach with a hex key.
 * Absent entirely on instruments with nothing user-adjustable (a sealed
 * refractor doublet); `primary` absent on an SCT, whose primary is factory-set.
 */
export interface CollimationSpec {
  primary?: MirrorCell;
  secondary?: MirrorCell;
}

export interface TelescopeProfile {
  id: string;
  name: string;
  type: 'Dobsonian' | 'Newtonian EQ' | 'Refractor' | 'SCT' | 'Maksutov' | 'Binoculars' | 'Smart';
  aperture: number; // in mm (Do)
  focalLength: number; // in mm (Fo)
  focalRatio: number; // f/number
  centralObstruction: number; // percentage of aperture (for contrast/diffraction calculations)
  /**
   * Two physically distinct effects, often conflated: a straight-through
   * Newtonian/Dobsonian (two mirror reflections) rotates the WHOLE field
   * 180° ('inverted'); a refractor/SCT used with a star diagonal (one
   * extra reflection) mirrors it left-right only ('mirrored'), which is
   * NOT the same transform. 'correct' is a true erect image (e.g. a
   * prism-erected spotting scope or binoculars).
   */
  viewOrientation: 'correct' | 'inverted' | 'mirrored';
  hasGoTo: boolean;
  mountType: 'Alt-Az' | 'Equatorial';
  /**
   * Which mirror cells this instrument exposes for collimation (Phase 57).
   * Optional because a sealed refractor genuinely has none, and because
   * user-built custom profiles predate the field.
   */
  collimation?: CollimationSpec;
}

/** Shared emotion vocabulary for the Instructor voice engine. */
export type InstructorEmotion = 'encouraging' | 'urgent' | 'neutral' | 'celebratory' | 'warning' | 'serious';


export interface VoiceMessage {
  id: string;
  text: string;
  emotion: InstructorEmotion;
  priority: number; // 1 = immediate override (safety), 5 = casual hint
  playAudio?: boolean;
}

export interface InstructorResponse {
  title: string;
  message: VoiceMessage;
  hint?: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  nextAction?: string;
}

/** The four practical 2D training modules — shared by App.tsx's module tab bar and the curriculum's "Try it out" routing (engine/curriculum.ts). */
export type ModuleId = 'finderscope' | 'dobsonian' | 'collimation' | 'astrophotography';
