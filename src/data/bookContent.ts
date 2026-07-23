import type { Target } from '../types';


export const TARGETS: Record<string, Target> = {
  moon: {
    id: 'moon',
    name: 'The Moon',
    distance: '384,400 km',
    magnitude: -12.74,
    angularSize: 31, // ~31 arcminutes
    angularDiameterDeg: 0.51,
    type: 'moon',
    surfaceTextureUrl: '/textures/moon.jpg', // Placeholder path
    rotationPeriod: 27.3, // days
    seasonVisibility: ['spring', 'summer', 'autumn', 'winter'],
    bestMagnification: 100, // Good for craters along the terminator
    difficulty: 'Beginner',
    // Phase 42.8: the Moon now ORBITS — skyGeometry.getBodyEquatorial
    // intercepts id 'moon' and resolves the live low-precision lunar
    // ephemeris (ephemerisMath.getMoonEquatorial) instead of these values.
    // They remain only as a legacy snapshot/fallback shape for the Target
    // type; nothing renders from them anymore.
    ra: 10.0,
    dec: 15.0,
  },
  sun: {
    id: 'sun',
    name: 'The Sun',
    distance: '150 million km (1 AU)',
    magnitude: -26.74,
    angularSize: 32,
    angularDiameterDeg: 0.53,
    type: 'sun',
    surfaceTextureUrl: '/textures/sun.jpg',
    seasonVisibility: ['spring', 'summer', 'autumn', 'winter'],
    bestMagnification: 50,
    difficulty: 'Expert',
    // Mid-July snapshot — the Sun moves ~1°/day along the ecliptic, so this
    // is approximate; a real solar ephemeris would derive it from the date.
    ra: 7.55,
    dec: 21.8,
  },
  saturn: {
    id: 'saturn',
    name: 'Saturn',
    distance: '1.4 billion km',
    magnitude: 0.46,
    angularSize: 18, // without rings
    angularDiameterDeg: 0.0125, // ring-tip to ring-tip
    type: 'planet',
    surfaceTextureUrl: '/textures/saturn.jpg',
    rotationPeriod: 0.44,
    seasonVisibility: ['summer', 'autumn'],
    bestMagnification: 150,
    difficulty: 'Intermediate',
    // Saturn drifts slowly through the zodiac (~29.5yr orbit); this is an
    // approximate current-epoch snapshot, not a live planetary ephemeris.
    ra: 23.67,
    dec: -6.5,
  },
  jupiter: {
    id: 'jupiter',
    name: 'Jupiter',
    distance: '778 million km (5.2 AU)',
    magnitude: -2.7,
    angularSize: 0.78, // ~47 arcseconds near opposition
    angularDiameterDeg: 0.013, // disk only — the Galilean moons extend far beyond (Callisto to ~26 R_J)
    type: 'planet',
    surfaceTextureUrl: '/textures/jupiter.jpg',
    rotationPeriod: 0.41,
    seasonVisibility: ['autumn', 'winter'],
    bestMagnification: 180,
    difficulty: 'Beginner',
    // Approximate 2024–25 opposition snapshot (Taurus, near Aldebaran) —
    // Jupiter drifts ~one zodiac constellation per year, and its true
    // mid-2026 position sits within days of solar conjunction (unobservable),
    // so this recent placement keeps the Jovian-system lesson in a night sky
    // that shares the field with M42 and the winter constellation lines.
    ra: 4.6,
    dec: 21.5,
  },
  spire: {
    id: 'spire',
    name: 'Distant Tower',
    distance: '2.5 km',
    magnitude: 0,
    angularSize: 120, // Huge because it's terrestrial
    angularDiameterDeg: 2.0,
    type: 'terrestrial',
    surfaceTextureUrl: '/textures/tower.jpg',
    seasonVisibility: ['spring', 'summer', 'autumn', 'winter'],
    bestMagnification: 40,
    difficulty: 'Beginner',
  },
  m42: {
    id: 'm42',
    name: 'Orion Nebula (M42)',
    distance: '1,344 light-years',
    magnitude: 4.0,
    angularSize: 65, // ~65 arcminutes across
    angularDiameterDeg: 1.0,
    type: 'nebula',
    surfaceTextureUrl: '/textures/m42.jpg',
    seasonVisibility: ['autumn', 'winter'],
    bestMagnification: 40,
    difficulty: 'Beginner',
    // J2000 catalog coordinates — M42 is a deep-sky object, so these are fixed.
    ra: 5.5881,
    dec: -5.3911,
  }
};

export const INSTRUCTOR_STRINGS = {
  welcome: "Welcome, young sky-watcher! I'm here to guide you. Remember, an astronomer doesn't need to be a genius—only curious and patient.",
  dustCapWarning: "The universe is dark, but not that dark! Check the front of the telescope tube and remove the dust cap.",
  solarHazard: "SAFETY OVERRIDE! Unfiltered sunlight detected! In real life, viewing the Sun without a solar filter causes instant, permanent blindness and destroys optics.",
  overMagnification: "Notice how the image is boiling and blurry? The atmosphere is too turbulent tonight for such high magnification. Switch to a lower power eyepiece!",
  altDroop: "Whoops! Gravity is pulling the nose down. Tighten the side tension knobs on the rocker box.",
  goodFocus: "Excellent focus! Look at those sharp details. The stars should look like tiny pinpricks, not blurry donuts.",
  alignmentSuccess: "Perfect! Your finderscope is now perfectly aligned with the main telescope. You're ready to hunt for deep sky objects!"
};
