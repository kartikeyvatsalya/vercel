// ── Ephemeris Math: Equatorial (RA/Dec) → Horizontal (Alt/Az) ──
// Standard spherical astronomy formulas (Duffett-Smith / Meeus) used to
// drive the 3D telescope's physical Alt-Az pointing from a target's
// celestial coordinates, the observer's location, and the current time.

/** Julian Date for a given moment (defaults to now). */
export function getJulianDate(date: Date = new Date()): number {
  return date.getTime() / 86400000 + 2440587.5;
}

// ── ΔT: Terrestrial Time − Universal Time (Phase 59) ───────────────
// The solar and lunar series below are polynomials in TERRESTRIAL TIME, a
// uniform atomic timescale, while every clock in this app (and every
// `Date.now()` it is built on) reads UNIVERSAL TIME, which is tied to the
// Earth's slightly irregular rotation. The gap between them is ΔT — about
// 75 seconds in the 2020s, and hours once you drive the Time Machine back a
// few centuries. Feeding UT straight into a TT-based series was a silent
// position error: 75 s costs the Moon ~0.6 arcseconds today, which is
// nothing, but at 1600 CE ΔT is ~2 minutes and the error is a full arcminute
// on a body whose whole disk is only 30 of them.
//
// Sidereal time is deliberately NOT corrected — GMST is defined FROM UT1, so
// getLocalSiderealTime below must keep using the raw Julian Date.
//
// Polynomials: Espenak & Meeus, the standard NASA eclipse-canon fit. Accurate
// to a second or so across the modern era and to the right order of magnitude
// across the whole historical range the Time Machine can reach.

/** Approximate decimal year for a Julian Date — the argument every ΔT fit uses. */
function decimalYear(julianDate: number): number {
  const date = new Date((julianDate - 2440587.5) * 86400000);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const yearEnd = Date.UTC(date.getUTCFullYear() + 1, 0, 1);
  return date.getUTCFullYear() + (date.getTime() - yearStart) / (yearEnd - yearStart);
}

/**
 * ΔT = TT − UT, in seconds, for a Julian Date.
 *
 * Piecewise because the Earth's rotation is not a polynomial: the twentieth
 * century alone needed four separate fits, and 1941–1975 in particular runs
 * against the trend of everything either side of it. Outside 1900–2150 this
 * falls back to the secular parabola the whole canon is anchored on — coarse
 * (tens of seconds by 1800), but tens of seconds move the Moon by a handful of
 * arcseconds, an order of magnitude below the ~0.3° error of the lunar series
 * it feeds, so chasing more precision there would be false precision.
 *
 * Known limitation the other way: the 2005–2050 fit was made when the Earth
 * was still expected to keep slowing, and it now runs ~6 s ahead of observed
 * ΔT (75 s versus ~69 s in the mid-2020s). Six seconds is three arcseconds of
 * lunar motion — again far inside the series' own noise.
 */
export function getDeltaTSeconds(julianDate: number): number {
  const y = decimalYear(julianDate);

  if (y >= 2005 && y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (y >= 1986 && y < 2005) {
    const t = y - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3
      + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (y >= 1961 && y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - (t * t * t) / 718;
  }
  if (y >= 1941 && y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - (t * t * t) / 233 + (t ** 4) / 2547;
  }
  if (y >= 1920 && y < 1941) {
    const t = y - 1920;
    return 21.20 + 0.84493 * t - 0.076100 * t * t + 0.0020936 * t * t * t;
  }
  if (y >= 1900 && y < 1920) {
    const t = y - 1900;
    return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4;
  }
  if (y >= 2050 && y < 2150) {
    return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
  }
  const u = (y - 1820) / 100;
  return -20 + 32 * u * u;
}

/** The Julian Date in Terrestrial Time, for the Sun/Moon series below. */
export function toTerrestrialTimeJD(julianDate: number): number {
  return julianDate + getDeltaTSeconds(julianDate) / 86400;
}

// ── Atmospheric refraction (Phase 59) ──────────────────────────────
// The atmosphere is a lens. Light from a low object bends downward on its way
// in, so the object APPEARS higher than it geometrically is — by about half a
// degree right at the horizon, which is more than the Sun's own diameter:
// the whole disk is already below the true horizon at the moment you watch it
// touch it. This is why sunset runs a couple of minutes late, and why a
// target the ephemeris puts at −0.4° is still in the eyepiece.
//
// Bennett's formula, the standard closed-form fit:
//     R (arcmin) = 1 / tan( h + 7.31 / (h + 4.4) )     [h in degrees]
// which yields the textbook 34.5′ at h = 0. Applied here to the geometric
// altitude (rather than iterating for the apparent one) — a well-worn
// simplification that is exact at the horizon and sub-arcsecond above ~15°.

/** Altitude below which the Bennett fit stops behaving; clamped, not extrapolated. */
const REFRACTION_MIN_ALT_DEG = -1.5;
/** …and below which the lift is faded out entirely — see bennettRefractionDeg. */
const REFRACTION_FADE_FLOOR_DEG = -3;
/** Hard ceiling — refraction never exceeds ~35′ in reality, and the fit diverges past its domain. */
const MAX_REFRACTION_DEG = 1;

/**
 * Refraction lift in DEGREES for a geometric altitude, fading to zero well
 * below the horizon.
 *
 * The fade is not cosmetic. Bennett's expression is only defined down to the
 * horizon and turns non-monotone a few degrees under it, but leaving a
 * constant clamped lift in place there would be worse than useless: the
 * DAYLIGHT engine reads the Sun's altitude straight off this transform, and a
 * frozen +0.94° would mean astronomical night (Sun at −18°) never quite
 * arrived and the faintest stars never reached full brightness. Below −3° a
 * body is unobservable and its refraction is meaningless, so the lift ramps
 * linearly to nothing across that last degree and a half — continuous, and
 * still monotone enough for removeRefraction's iteration to converge.
 */
export function bennettRefractionDeg(altitudeDeg: number): number {
  if (altitudeDeg <= REFRACTION_FADE_FLOOR_DEG) return 0;
  const h = Math.max(altitudeDeg, REFRACTION_MIN_ALT_DEG);
  const arcmin = 1 / Math.tan(degToRad(h + 7.31 / (h + 4.4)));
  const lift = clamp(arcmin / 60, 0, MAX_REFRACTION_DEG);
  if (altitudeDeg >= REFRACTION_MIN_ALT_DEG) return lift;
  const fade = (altitudeDeg - REFRACTION_FADE_FLOOR_DEG)
    / (REFRACTION_MIN_ALT_DEG - REFRACTION_FADE_FLOOR_DEG);
  return lift * fade;
}

/** Geometric altitude → apparent (refracted) altitude. */
export function applyRefraction(geometricAltDeg: number): number {
  return geometricAltDeg + bennettRefractionDeg(geometricAltDeg);
}

/**
 * Apparent altitude → geometric: the exact inverse of applyRefraction.
 *
 * By BISECTION rather than the obvious fixed-point iteration. Fixed point is
 * two lines and converges beautifully for most of the sky — and then loses a
 * tenth of a degree in the last two degrees above the horizon, where dR/dh is
 * steepest and the whole point of modelling refraction lies. Bisection has no
 * such regime: applyRefraction is strictly increasing everywhere (checked
 * numerically from −3° to the zenith), and the answer is always inside
 * [apparent − 1°, apparent], so twenty-four halvings pin it to under a
 * milliarcsecond regardless of altitude. It costs a couple of dozen tangents
 * a few times per frame — the mount pointing and one field-star anchor, not
 * per star — which is nothing.
 *
 * This closure matters: the EQ mount rig and the sidereal motor both derive
 * mechanical coordinates back out of a pointing through here, so a round trip
 * that drifted would show up as the mount slowly walking off its own target.
 */
export function removeRefraction(apparentAltDeg: number): number {
  let lo = apparentAltDeg - MAX_REFRACTION_DEG;
  let hi = apparentAltDeg;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (applyRefraction(mid) < apparentAltDeg) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Local Sidereal Time, in hours [0, 24), for a Julian Date and observer
 * longitude (degrees, east-positive).
 *
 * Phase 59: carries the T² and T³ terms of the IAU GMST expression, not just
 * the linear rate. They are nothing for tonight — but the Time Machine can
 * jump centuries, and the T² term grows as the SQUARE of that jump: 22
 * arcseconds of sky rotation by 1600 CE, more than the whole apparent
 * diameter of Uranus and a visible mis-placement in a sub-degree field.
 */
export function getLocalSiderealTime(julianDate: number, longitudeDeg: number): number {
  const daysSinceJ2000 = julianDate - 2451545.0;
  const T = daysSinceJ2000 / 36525; // Julian centuries of UT
  const gmstDeg = normalizeDegrees(
    280.46061837
    + 360.98564736629 * daysSinceJ2000
    + 0.000387933 * T * T
    - (T * T * T) / 38710000
  );
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
    // Phase 59: APPARENT altitude — what the eyepiece actually shows. This is
    // the single choke point every RA/Dec → Alt/Az path in the app runs
    // through (mount pointing, both 2D feeds, the 3D dome, the horizon chips),
    // so refracting here is what keeps all of them agreeing on one sky.
    altitude: applyRefraction(radToDeg(altRad)),
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
  // Phase 59: the caller hands us an APPARENT altitude (that is what the
  // forward transform, the mount pointing, and the user's own eyes all deal
  // in), but the spherical astronomy below is geometric. Undo the atmosphere
  // first, or the round trip stops closing and the EQ rig / sidereal motor
  // drift by up to half a degree near the horizon.
  const altRad = degToRad(removeRefraction(altDeg));
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
  // Phase 59: the series is a polynomial in Terrestrial Time; the caller's
  // Julian Date is UT. See getDeltaTSeconds for why the difference matters.
  const n = toTerrestrialTimeJD(julianDate) - 2451545.0;
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
 * Low-precision lunar ephemeris (Phase 42.8) — the Moon's geocentric RA/Dec
 * at a simulated epoch-ms, so the Moon ORBITS for real instead of sitting at
 * a static catalog snapshot (which made real-world phase math impossible:
 * the terminator could never match the calendar).
 *
 * Algorithm: the standard low-precision series from the Astronomical
 * Almanac ("Low-precision formulae for geocentric coordinates of the
 * Moon"), the same family of truncated ELP terms Meeus presents. Ecliptic
 * longitude λ carries the mean longitude plus the six largest periodic
 * terms (evection, yearly equation, variation, …); latitude β carries the
 * four largest. Stated accuracy ≈ 0.3° in λ and 0.2° in β for decades
 * around J2000 — a fraction of the Moon's own 0.5° disk, far below this
 * simulator's eyepiece pixel scale, and easily good enough for phase math
 * (a 0.3° position error shifts the illuminated fraction by well under 1%).
 *
 * The ecliptic → equatorial conversion uses the same obliquity model as
 * getSunEquatorial above, so Sun–Moon elongation (the phase driver) is
 * internally consistent between the two bodies.
 *
 * ── Topocentric parallax (Phase 59) ──
 * Pass `observer` and the result is TOPOCENTRIC — the Moon's position as seen
 * from a point on the Earth's SURFACE rather than from its centre. This is
 * the one body in the catalog where the distinction is glaring: everything
 * else is effectively at infinity, but the Moon is close enough that the
 * ~6378 km from the Earth's centre to your feet subtends up to 57 arcminutes
 * at it — a whole lunar diameter. A geocentric Moon sits visibly (and,
 * near the horizon, almost a disk's width) off from where a telescope
 * actually finds it. Omit `observer` for the geocentric position.
 * @returns ra in hours [0, 24), dec in degrees
 */
export function getMoonEquatorial(
  simTimeMs: number,
  observer?: ObserverGeodetic
): { ra: number; dec: number } {
  const jd = getJulianDate(new Date(simTimeMs));
  // Phase 59: the lunar series is in Terrestrial Time, like the solar one.
  const jdTT = toTerrestrialTimeJD(jd);
  const T = (jdTT - 2451545.0) / 36525; // Julian centuries since J2000.0

  // Geocentric ecliptic longitude (degrees): mean longitude + principal
  // periodic terms. Argument angles are in degrees.
  const lambdaDeg =
    218.32 + 481267.883 * T
    + 6.29 * Math.sin(degToRad(134.9 + 477198.85 * T))   // principal elliptic term
    - 1.27 * Math.sin(degToRad(259.2 - 413335.38 * T))   // evection
    + 0.66 * Math.sin(degToRad(235.7 + 890534.23 * T))   // variation
    + 0.21 * Math.sin(degToRad(269.9 + 954397.70 * T))   // second elliptic term
    - 0.19 * Math.sin(degToRad(357.5 + 35999.05 * T))    // yearly equation
    - 0.11 * Math.sin(degToRad(186.6 + 966404.05 * T));  // parallactic inequality family

  // Geocentric ecliptic latitude (degrees): principal inclination terms.
  const betaDeg =
    5.13 * Math.sin(degToRad(93.3 + 483202.03 * T))
    + 0.28 * Math.sin(degToRad(228.2 + 960400.87 * T))
    - 0.28 * Math.sin(degToRad(318.3 + 6003.18 * T))
    - 0.17 * Math.sin(degToRad(217.6 - 407332.20 * T));

  // Equatorial horizontal parallax π (degrees) — the companion series to λ and
  // β from the same Astronomical Almanac table. Ranges ~0.90°–1.02° (54′–61′)
  // over the Moon's eccentric orbit; this is the angle the topocentric
  // correction below is built on, and the reason perigee full moons sit
  // measurably further from where a geocentric ephemeris puts them.
  const parallaxDeg =
    0.9508
    + 0.0518 * Math.cos(degToRad(134.9 + 477198.85 * T))
    + 0.0095 * Math.cos(degToRad(259.2 - 413335.38 * T))
    + 0.0078 * Math.cos(degToRad(235.7 + 890534.23 * T))
    + 0.0028 * Math.cos(degToRad(269.9 + 954397.70 * T));

  const lambda = degToRad(normalizeDegrees(lambdaDeg));
  const beta = degToRad(betaDeg);
  // Same obliquity model as getSunEquatorial (n = days since J2000).
  const obliquityRad = degToRad(23.439 - 0.0000004 * (jdTT - 2451545.0));

  // Ecliptic → equatorial (standard rotation about the vernal equinox).
  const sinDec = clamp(
    Math.sin(beta) * Math.cos(obliquityRad) +
      Math.cos(beta) * Math.sin(obliquityRad) * Math.sin(lambda),
    -1,
    1
  );
  const raRad = Math.atan2(
    Math.sin(lambda) * Math.cos(obliquityRad) - Math.tan(beta) * Math.sin(obliquityRad),
    Math.cos(lambda)
  );

  const geocentric = {
    ra: normalizeDegrees(radToDeg(raRad)) / 15,
    dec: radToDeg(Math.asin(sinDec)),
  };

  if (!observer) return geocentric;
  return applyLunarParallax(geocentric, parallaxDeg, observer, jd);
}

/**
 * Observer's position on the Earth's surface — the extra information a
 * topocentric correction needs beyond the moment in time.
 */
export interface ObserverGeodetic {
  latitude: number;
  longitude: number;
  /** Height above sea level, metres. Optional: worth <1 arcsecond of parallax. */
  elevationM?: number;
}

/** Earth's equatorial radius, km — the baseline the lunar parallax is defined against. */
const EARTH_EQUATORIAL_RADIUS_KM = 6378.14;
/** Polar/equatorial radius ratio (WGS-84 flattening), for the geocentric-latitude fix. */
const EARTH_FLATTENING_RATIO = 0.99664719;

/**
 * Geocentric → topocentric equatorial coordinates (Meeus, Astronomical
 * Algorithms ch. 40). Shifts the Moon by the angle the observer's own offset
 * from the Earth's centre subtends at it: zero when the Moon is overhead,
 * maximal (the full ~57′ horizontal parallax) when it is on the horizon, and
 * always DOWNWARD — a body seen from the surface is always lower than a body
 * seen from the centre, which is precisely the opposite direction to the
 * refraction lift applied in convertEquatorialToHorizontalLST. The two are
 * genuinely separate effects of similar size and they partly cancel at the
 * horizon; carrying only one of them would be worse than carrying neither.
 *
 * ρ sin φ′ / ρ cos φ′ account for the Earth being an ellipsoid, so the
 * observer's geocentric latitude differs from the geodetic one they think in.
 */
function applyLunarParallax(
  geocentric: { ra: number; dec: number },
  parallaxDeg: number,
  observer: ObserverGeodetic,
  julianDate: number
): { ra: number; dec: number } {
  const latRad = degToRad(observer.latitude);
  const elevationRatio = (observer.elevationM ?? 0) / (EARTH_EQUATORIAL_RADIUS_KM * 1000);
  const u = Math.atan(EARTH_FLATTENING_RATIO * Math.tan(latRad));
  const rhoSinPhi = EARTH_FLATTENING_RATIO * Math.sin(u) + elevationRatio * Math.sin(latRad);
  const rhoCosPhi = Math.cos(u) + elevationRatio * Math.cos(latRad);

  const lstHours = getLocalSiderealTime(julianDate, observer.longitude);
  const haRad = degToRad(normalizeDegrees((lstHours - geocentric.ra) * 15));
  const decRad = degToRad(geocentric.dec);
  const sinParallax = Math.sin(degToRad(parallaxDeg));

  const denominator = Math.cos(decRad) - rhoCosPhi * sinParallax * Math.cos(haRad);
  const deltaRaRad = Math.atan2(-rhoCosPhi * sinParallax * Math.sin(haRad), denominator);
  const topoDecRad = Math.atan2(
    (Math.sin(decRad) - rhoSinPhi * sinParallax) * Math.cos(deltaRaRad),
    denominator
  );

  return {
    ra: ((geocentric.ra + radToDeg(deltaRaRad) / 15) % 24 + 24) % 24,
    dec: radToDeg(topoDecRad),
  };
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

/**
 * Lunar illuminated fraction (Phase 42; simplified Phase 42.5) — the sunlit
 * share of the Moon's disk, from the geocentric Sun–Moon elongation ψ (cos ψ
 * via the spherical law of cosines on both bodies' RA/Dec). Treating the Sun
 * as effectively at infinity (phase angle i ≈ 180° − ψ), the standard
 * k = (1 + cos i)/2 reduces to k = (1 − cos ψ)/2 — 0 at new (bodies together
 * in the sky), 1 at full (opposite), 0.5 at the quarters. Since Phase 42.8
 * the caller passes the Moon's LIVE RA/Dec from getMoonEquatorial (resolved
 * through skyGeometry.getBodyEquatorial), so the phase cycles on the true
 * ~29.5-day synodic month and matches the real-world calendar.
 *
 * This is deliberately frame-independent (a dot product of unit vectors
 * doesn't care about equatorial vs. horizontal coordinates). The terminator's
 * on-screen DIRECTION is a separate question the renderer answers directly
 * from both bodies' real Alt/Az (see skyRenderer.ts's Moon branch) using the
 * same (Δaz, −Δalt)→screen convention as every other body in that file,
 * rather than an equatorial position-angle formula here — Phase 42's first
 * attempt used Meeus' bright-limb position angle minus the parallactic
 * angle, which put the terminator's rotation at odds with the texture's own
 * `+parallacticRad` field-rotation (they'd spin in opposite directions as
 * the sky turned, instead of rigidly together).
 */
export function getLunarIlluminatedFraction(
  moonRaHours: number,
  moonDecDeg: number,
  time: Date
): number {
  const jd = getJulianDate(time);
  const sun = getSunEquatorial(jd);
  const raS = degToRad(sun.ra * 15);
  const decS = degToRad(sun.dec);
  const raM = degToRad(moonRaHours * 15);
  const decM = degToRad(moonDecDeg);
  const dRa = raS - raM;

  const cosPsi = clamp(
    Math.sin(decS) * Math.sin(decM) + Math.cos(decS) * Math.cos(decM) * Math.cos(dRa),
    -1,
    1
  );
  return (1 - cosPsi) / 2;
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

export function degToRad(deg: number): number {
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
