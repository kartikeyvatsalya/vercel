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

export interface TelescopeProfile {
  id: string;
  name: string;
  type: 'Dobsonian' | 'Newtonian EQ' | 'Refractor' | 'SCT' | 'Maksutov' | 'Binoculars' | 'Smart';
  aperture: number; // in mm (Do)
  focalLength: number; // in mm (Fo)
  focalRatio: number; // f/number
  centralObstruction: number; // percentage of aperture (for contrast/diffraction calculations)
  isInvertedView: boolean;
  hasGoTo: boolean;
  mountType: 'Alt-Az' | 'Equatorial';
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

/** The three practical 2D training modules — shared by App.tsx's module tab bar and the curriculum's "Try it out" routing (engine/curriculum.ts). */
export type ModuleId = 'finderscope' | 'dobsonian' | 'astrophotography';
