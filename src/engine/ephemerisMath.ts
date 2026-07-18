// ── Ephemeris Math: Equatorial (RA/Dec) → Horizontal (Alt/Az) ──
// Standard spherical astronomy formulas (Duffett-Smith / Meeus) used to
// drive the 3D telescope's physical Alt-Az pointing from a target's
// celestial coordinates, the observer's location, and the current time.

/** Julian Date for a given moment (defaults to now). */
export function getJulianDate(date: Date = new Date()): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Local Sidereal Time, in hours [0, 24), for a Julian Date and observer longitude (degrees, east-positive). */
export function getLocalSiderealTime(julianDate: number, longitudeDeg: number): number {
  const daysSinceJ2000 = julianDate - 2451545.0;
  const gmstDeg = normalizeDegrees(280.46061837 + 360.98564736629 * daysSinceJ2000);
  const lstDeg = normalizeDegrees(gmstDeg + longitudeDeg);
  return lstDeg / 15;
}

/**
 * Converts equatorial coordinates to local horizontal coordinates.
 * @param raHours Right Ascension, in hours [0, 24)
 * @param decDeg Declination, in degrees [-90, 90]
 * @param latDeg Observer latitude, in degrees
 * @param lonDeg Observer longitude, in degrees (east-positive)
 * @param time Moment to compute the position for
 */
export function convertEquatorialToHorizontal(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  time: Date = new Date()
): { altitude: number; azimuth: number } {
  const jd = getJulianDate(time);
  const lstHours = getLocalSiderealTime(jd, lonDeg);
  return convertEquatorialToHorizontalLST(raHours, decDeg, latDeg, lstHours);
}

/**
 * Same conversion, but with the Local Sidereal Time precomputed by the
 * caller (Phase 29). Rendering the whole star catalog needs this transform
 * per star per frame — the JD/LST derivation (with its Date allocation) is
 * identical for every star in a frame, so hoisting it out turns ~150 Date
 * constructions per frame into one.
 */
export function convertEquatorialToHorizontalLST(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lstHours: number
): { altitude: number; azimuth: number } {
  const hourAngleDeg = normalizeDegrees((lstHours - raHours) * 15);

  const latRad = degToRad(latDeg);
  const decRad = degToRad(decDeg);
  const haRad = degToRad(hourAngleDeg);

  const sinAlt = Math.sin(decRad) * Math.sin(latRad) + Math.cos(decRad) * Math.cos(latRad) * Math.cos(haRad);
  const altRad = Math.asin(clamp(sinAlt, -1, 1));

  const cosAz = (Math.sin(decRad) - Math.sin(altRad) * Math.sin(latRad)) / (Math.cos(altRad) * Math.cos(latRad));
  let azimuthDeg = radToDeg(Math.acos(clamp(cosAz, -1, 1)));

  // The acos above only resolves azimuth to [0, 180]; the hour angle's
  // sign disambiguates which side of North (east vs. west) it's on.
  if (Math.sin(haRad) > 0) {
    azimuthDeg = 360 - azimuthDeg;
  }

  return {
    altitude: radToDeg(altRad),
    azimuth: normalizeDegrees(azimuthDeg),
  };
}

/**
 * Inverse of the horizontal conversion: recovers the equatorial *mechanical*
 * coordinates (hour angle + declination) that an equatorial mount must dial
 * in to point at a given local Alt/Az direction. Drives the 3D GEM rig.
 * Verified by numeric roundtrip against convertEquatorialToHorizontal
 * (max error ~2e-9 deg over 5000 random pointings).
 * @returns hourAngle in degrees [0, 360), declination in degrees [-90, 90]
 */
export function convertHorizontalToEquatorial(
  altDeg: number,
  azDeg: number,
  latDeg: number
): { hourAngle: number; declination: number } {
  const altRad = degToRad(altDeg);
  const azRad = degToRad(azDeg);
  const latRad = degToRad(latDeg);

  const sinDec = Math.sin(altRad) * Math.sin(latRad) + Math.cos(altRad) * Math.cos(latRad) * Math.cos(azRad);
  const decRad = Math.asin(clamp(sinDec, -1, 1));

  const cosHa = (Math.sin(altRad) - Math.sin(latRad) * sinDec) / (Math.cos(latRad) * Math.cos(decRad));
  let hourAngleDeg = radToDeg(Math.acos(clamp(cosHa, -1, 1)));

  // Same disambiguation mirror as the forward transform: pointing east of
  // the meridian means the object hasn't crossed yet (negative hour angle).
  if (Math.sin(azRad) > 0) {
    hourAngleDeg = 360 - hourAngleDeg;
  }

  return {
    hourAngle: normalizeDegrees(hourAngleDeg),
    declination: radToDeg(decRad),
  };
}

/**
 * Absolute equatorial coordinates (RA/Dec) of an arbitrary horizontal
 * direction at a given moment: RA = LST − HA. Used by the sidereal tracking
 * motor to freeze the mount's current sky direction in the rotating frame.
 * @returns ra in hours [0, 24), dec in degrees
 */
export function convertHorizontalToRaDec(
  altDeg: number,
  azDeg: number,
  latDeg: number,
  lonDeg: number,
  time: Date
): { ra: number; dec: number } {
  const { hourAngle, declination } = convertHorizontalToEquatorial(altDeg, azDeg, latDeg);
  const lstHours = getLocalSiderealTime(getJulianDate(time), lonDeg);
  const raHours = (((lstHours - hourAngle / 15) % 24) + 24) % 24;
  return { ra: raHours, dec: declination };
}

/**
 * Low-precision solar ephemeris (Phase 29) — the Sun's RA/Dec at a given
 * moment, from the standard Astronomical Almanac approximation (accurate to
 * ~0.01°, valid for decades around J2000). Unlike the static mid-July
 * snapshot in the TARGETS catalog, this follows the ecliptic as simTime
 * advances, which is what drives the dynamic day/twilight/night sky.
 * @returns ra in hours [0, 24), dec in degrees
 */
export function getSunEquatorial(julianDate: number): { ra: number; dec: number } {
  const n = julianDate - 2451545.0;
  const meanLongitudeDeg = normalizeDegrees(280.46 + 0.9856474 * n);
  const meanAnomalyRad = degToRad(normalizeDegrees(357.528 + 0.9856003 * n));
  const eclipticLongitudeRad = degToRad(
    normalizeDegrees(
      meanLongitudeDeg + 1.915 * Math.sin(meanAnomalyRad) + 0.02 * Math.sin(2 * meanAnomalyRad)
    )
  );
  const obliquityRad = degToRad(23.439 - 0.0000004 * n);

  const raRad = Math.atan2(
    Math.cos(obliquityRad) * Math.sin(eclipticLongitudeRad),
    Math.cos(eclipticLongitudeRad)
  );
  const decRad = Math.asin(clamp(Math.sin(obliquityRad) * Math.sin(eclipticLongitudeRad), -1, 1));

  return {
    ra: normalizeDegrees(radToDeg(raRad)) / 15,
    dec: radToDeg(decRad),
  };
}

/** The Sun's altitude (degrees) above the observer's horizon at a simulated epoch-ms. */
export function getSunAltitudeDeg(latDeg: number, lonDeg: number, timeMs: number): number {
  const jd = getJulianDate(new Date(timeMs));
  const sun = getSunEquatorial(jd);
  const lst = getLocalSiderealTime(jd, lonDeg);
  return convertEquatorialToHorizontalLST(sun.ra, sun.dec, latDeg, lst).altitude;
}

/**
 * Parallactic angle (Phase 30) — the angle at the target between the
 * direction to the zenith and the direction to the celestial pole. On an
 * Alt-Az mount (no equatorial derotator), this is exactly how far the
 * apparent "up" direction of a celestial object has rotated in the
 * eyepiece — the real reason a planet or nebula's orientation visibly
 * spins over a Dobsonian observing session even though the object itself
 * isn't rotating any faster than usual.
 * Standard formula (Meeus, ch. 14):
 *   q = atan2(sin(HA), tan(lat)·cos(dec) − sin(dec)·cos(HA))
 * @returns degrees, range (−180, 180]
 */
export function getParallacticAngleDeg(
  raHours: number,
  decDeg: number,
  latDeg: number,
  lonDeg: number,
  time: Date = new Date()
): number {
  const lstHours = getLocalSiderealTime(getJulianDate(time), lonDeg);
  const haRad = degToRad(normalizeDegrees((lstHours - raHours) * 15));
  const latRad = degToRad(latDeg);
  const decRad = degToRad(decDeg);
  const y = Math.sin(haRad);
  const x = Math.tan(latRad) * Math.cos(decRad) - Math.sin(decRad) * Math.cos(haRad);
  return radToDeg(Math.atan2(y, x));
}

// ── The Galilean Moons (Phase 32) ──────────────────────────────────
// Simplified circular-orbit ephemeris for Io, Europa, Ganymede, and
// Callisto. Each moon's mean orbital longitude advances uniformly at
// 360°/period from its true J2000.0 value (periods and epoch longitudes
// from the standard tables in Meeus, Astronomical Algorithms ch. 44), and
// the on-sky X offset is the edge-on projection a·sin(phase) — Earth sits
// within ~3° of Jupiter's equatorial plane, so the orbits genuinely are
// edge-on lines to us.
//
// Deliberate simplification: the rigorous method also corrects the phase
// for the Earth–Jupiter direction and light-travel time (several degrees).
// Skipping that means a given night's configuration won't match an
// almanac exactly, but every property this simulator teaches IS faithful:
// the four periods and their ratios, the relative spacing of the orbits,
// the sinusoidal swing between elongations, and disappearances behind the
// planet's disk.

export interface GalileanMoonSpec {
  id: 'io' | 'europa' | 'ganymede' | 'callisto';
  name: string;
  /** Sidereal orbital period, days. The mean motion is derived as 360°/period. */
  orbitalPeriodDays: number;
  /** Orbit radius in units of Jupiter's equatorial radius (71,492 km). */
  semiMajorAxisJupiterRadii: number;
  /** Mean orbital longitude at epoch J2000.0, degrees. */
  meanLongitudeJ2000Deg: number;
  /** Apparent visual magnitude near opposition — Ganymede is the brightest. */
  magnitude: number;
}

export const GALILEAN_MOONS: GalileanMoonSpec[] = [
  { id: 'io',       name: 'Io',       orbitalPeriodDays: 1.769138,  semiMajorAxisJupiterRadii: 5.90,  meanLongitudeJ2000Deg: 106.077, magnitude: 5.0 },
  { id: 'europa',   name: 'Europa',   orbitalPeriodDays: 3.551181,  semiMajorAxisJupiterRadii: 9.39,  meanLongitudeJ2000Deg: 175.732, magnitude: 5.3 },
  { id: 'ganymede', name: 'Ganymede', orbitalPeriodDays: 7.154553,  semiMajorAxisJupiterRadii: 14.97, meanLongitudeJ2000Deg: 120.559, magnitude: 4.6 },
  { id: 'callisto', name: 'Callisto', orbitalPeriodDays: 16.689018, semiMajorAxisJupiterRadii: 26.33, meanLongitudeJ2000Deg: 84.445,  magnitude: 5.7 },
];

export interface GalileanMoonState {
  id: GalileanMoonSpec['id'];
  name: string;
  magnitude: number;
  /** Orbital phase, degrees [0, 360). 0° = superior conjunction (far side, centered behind Jupiter). */
  phaseDeg: number;
  /**
   * Signed on-sky offset from Jupiter's center along the shared equatorial
   * plane, in Jupiter radii. The renderer maps this to its glyph-frame +x
   * axis; whatever field-rotation transform wraps the glyph orients it on-sky.
   */
  offsetJupiterRadii: number;
  /** Far half of the orbit — the moon passes behind the planet, not in front. */
  isBehindJupiter: boolean;
  /** Behind Jupiter AND within the disk (|offset| < 1 R_J): invisible, skip drawing. */
  isOcculted: boolean;
}

/** All four Galilean moons' orbital state at a Julian Date, innermost (Io) first. */
export function getGalileanMoonPositions(julianDate: number): GalileanMoonState[] {
  const daysSinceJ2000 = julianDate - 2451545.0;
  return GALILEAN_MOONS.map((moon) => {
    const meanMotionDegPerDay = 360 / moon.orbitalPeriodDays;
    const phaseDeg = normalizeDegrees(moon.meanLongitudeJ2000Deg + meanMotionDegPerDay * daysSinceJ2000);
    const phaseRad = degToRad(phaseDeg);
    const offsetJupiterRadii = moon.semiMajorAxisJupiterRadii * Math.sin(phaseRad);
    const isBehindJupiter = Math.cos(phaseRad) > 0;
    return {
      id: moon.id,
      name: moon.name,
      magnitude: moon.magnitude,
      phaseDeg,
      offsetJupiterRadii,
      isBehindJupiter,
      isOcculted: isBehindJupiter && Math.abs(offsetJupiterRadii) < 1,
    };
  });
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
