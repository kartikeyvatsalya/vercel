import type { TelescopeProfile } from '../types';

export const TELESCOPE_PROFILES: Record<string, TelescopeProfile> = {
  dobsonian8: {
    id: 'dobsonian8',
    name: '8" Dobsonian Reflector',
    type: 'Dobsonian',
    aperture: 200,       // 8 inches ~ 200mm
    focalLength: 1200,   // Typical f/6
    focalRatio: 6,
    centralObstruction: 25, // 25% by diameter
    isInvertedView: true,
    hasGoTo: false,
    mountType: 'Alt-Az',
  },
  refractor60: {
    id: 'refractor60',
    name: '60mm Beginner Refractor',
    type: 'Refractor',
    aperture: 60,
    focalLength: 700,
    focalRatio: 11.6,
    centralObstruction: 0,
    isInvertedView: false,
    hasGoTo: false,
    mountType: 'Alt-Az',
  },
  sct14: {
    id: 'sct14',
    name: '14" SCT Observatory Scope',
    type: 'SCT',
    aperture: 355,       // 14 inches ~ 355mm
    focalLength: 3910,   // f/11 standard SCT
    focalRatio: 11,
    centralObstruction: 33, // SCTs have larger central obstruction
    isInvertedView: false,
    hasGoTo: true,
    mountType: 'Equatorial',
  },
};

/** Ordered array for the UI selector — controls display order */
export const TELESCOPE_PROFILES_LIST = [
  TELESCOPE_PROFILES.dobsonian8,
  TELESCOPE_PROFILES.refractor60,
  TELESCOPE_PROFILES.sct14,
];

export interface ObservingCity {
  id: string;
  name: string;
  /** Degrees, north-positive. */
  latitude: number;
  /** Degrees, east-positive (matches ephemerisMath.ts's convention). */
  longitude: number;
}

/**
 * A few major cities for the observing-location selector (Settings ›
 * Observing Location). Jaipur's coordinates MUST exactly match
 * useTelescopeStore's DEFAULT_OBSERVER_LOCATION (26.9124, 75.7873) — the
 * app's default location and TelemetryPanel's displayed site name are both
 * derived by matching the store's observerLocation against this list.
 */
export const CITIES: ObservingCity[] = [
  { id: 'jaipur', name: 'Jaipur, India', latitude: 26.9124, longitude: 75.7873 },
  { id: 'newyork', name: 'New York, USA', latitude: 40.7128, longitude: -74.006 },
  { id: 'london', name: 'London, UK', latitude: 51.5074, longitude: -0.1278 },
  { id: 'sydney', name: 'Sydney, Australia', latitude: -33.8688, longitude: 151.2093 },
  { id: 'tokyo', name: 'Tokyo, Japan', latitude: 35.6762, longitude: 139.6503 },
];
