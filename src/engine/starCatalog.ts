/**
 * Star Catalog (Phase 29) — "Stellarium-lite".
 * ─────────────────────────────────────────────────────────────────
 * The ~150 brightest / most constellation-defining naked-eye stars, replacing
 * the old procedural random-hash starfields. Positions are J2000 catalog
 * values (RA in decimal HOURS, Dec in decimal degrees, V magnitude) — precise
 * to well under the eyepiece views' pixel scale. Every star brighter than
 * V ≈ 2.5 is included, plus fainter members that complete famous asterisms
 * (the Big Dipper, Cassiopeia's W, Orion's head & sword, the Teapot, the
 * Great Square) so real constellations are recognizable during manual slews.
 *
 * `spec` is the star's spectral class, used only for a subtle color tint —
 * Betelgeuse and Antares render amber, Rigel and Spica ice-blue.
 */

export type SpectralClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M';

export interface CatalogStar {
  name: string;
  /** J2000 right ascension, decimal hours [0, 24). */
  ra: number;
  /** J2000 declination, decimal degrees. */
  dec: number;
  /** Visual magnitude (lower = brighter). */
  mag: number;
  spec: SpectralClass;
}

/** Canvas/vertex tint per spectral class (approximate blackbody hues). */
export const STAR_TINT: Record<SpectralClass, string> = {
  O: '#b9ccff',
  B: '#cfdfff',
  A: '#e9efff',
  F: '#fbf6ea',
  G: '#fff3d1',
  K: '#ffd9a8',
  M: '#ffb27d',
};

/**
 * On-screen core radius (px) for a magnitude (Phase 42 — logarithmic bloom).
 * ─────────────────────────────────────────────────────────────────
 * Magnitude is already a logarithmic measure of flux (each +1 mag ≈ ×0.4
 * the light), and a star's rendered "size" in any real optic is its Airy
 * disk + atmospheric bloom, which grows with the LOG of its brightness —
 * so a linear `k − 0.35·mag` ramp made a −1.5-mag Sirius look barely larger
 * than a 3rd-mag filler star. Here the radius follows the fourth root of the
 * linear flux, r ∝ flux^0.25 = 10^(−0.1·mag): each magnitude step now scales
 * the star by a constant factor (×0.794), so brightness differences read as
 * the exponential size differences the eye actually sees at the eyepiece.
 * Anchored so a 0-mag star (Vega) ≈ 2.0px and clamped to a sane pinpoint
 * range; the diffuse glow around the core is layered on separately in the
 * renderer via a radial gradient.
 */
export function starRadiusPx(mag: number): number {
  const bloom = Math.pow(10, -0.1 * mag); // ∝ flux^0.25 — exponential in magnitude
  return Math.max(0.6, Math.min(5.5, 2.0 * bloom));
}

export const STAR_CATALOG: CatalogStar[] = [
  // ── The 25 brightest stars in the sky ──
  { name: 'Sirius', ra: 6.752, dec: -16.716, mag: -1.46, spec: 'A' },
  { name: 'Canopus', ra: 6.399, dec: -52.696, mag: -0.74, spec: 'F' },
  { name: 'Rigil Kentaurus', ra: 14.660, dec: -60.834, mag: -0.27, spec: 'G' },
  { name: 'Arcturus', ra: 14.261, dec: 19.182, mag: -0.05, spec: 'K' },
  { name: 'Vega', ra: 18.616, dec: 38.784, mag: 0.03, spec: 'A' },
  { name: 'Capella', ra: 5.278, dec: 45.998, mag: 0.08, spec: 'G' },
  { name: 'Rigel', ra: 5.242, dec: -8.202, mag: 0.13, spec: 'B' },
  { name: 'Procyon', ra: 7.655, dec: 5.225, mag: 0.34, spec: 'F' },
  { name: 'Achernar', ra: 1.629, dec: -57.237, mag: 0.46, spec: 'B' },
  { name: 'Betelgeuse', ra: 5.919, dec: 7.407, mag: 0.50, spec: 'M' },
  { name: 'Hadar', ra: 14.064, dec: -60.373, mag: 0.61, spec: 'B' },
  { name: 'Altair', ra: 19.846, dec: 8.868, mag: 0.77, spec: 'A' },
  { name: 'Acrux', ra: 12.443, dec: -63.099, mag: 0.76, spec: 'B' },
  { name: 'Aldebaran', ra: 4.599, dec: 16.509, mag: 0.86, spec: 'K' },
  { name: 'Antares', ra: 16.490, dec: -26.432, mag: 0.96, spec: 'M' },
  { name: 'Spica', ra: 13.420, dec: -11.161, mag: 0.97, spec: 'B' },
  { name: 'Pollux', ra: 7.755, dec: 28.026, mag: 1.14, spec: 'K' },
  { name: 'Fomalhaut', ra: 22.961, dec: -29.622, mag: 1.16, spec: 'A' },
  { name: 'Deneb', ra: 20.690, dec: 45.280, mag: 1.25, spec: 'A' },
  { name: 'Mimosa', ra: 12.795, dec: -59.689, mag: 1.25, spec: 'B' },
  { name: 'Regulus', ra: 10.140, dec: 11.967, mag: 1.35, spec: 'B' },
  { name: 'Adhara', ra: 6.977, dec: -28.972, mag: 1.50, spec: 'B' },
  { name: 'Castor', ra: 7.577, dec: 31.888, mag: 1.57, spec: 'A' },
  { name: 'Gacrux', ra: 12.519, dec: -57.113, mag: 1.63, spec: 'M' },
  { name: 'Shaula', ra: 17.560, dec: -37.104, mag: 1.63, spec: 'B' },

  // ── Second magnitude ──
  { name: 'Bellatrix', ra: 5.419, dec: 6.350, mag: 1.64, spec: 'B' },
  { name: 'Elnath', ra: 5.438, dec: 28.608, mag: 1.65, spec: 'B' },
  { name: 'Miaplacidus', ra: 9.220, dec: -69.717, mag: 1.69, spec: 'A' },
  { name: 'Alnilam', ra: 5.604, dec: -1.202, mag: 1.69, spec: 'B' },
  { name: 'Alnair', ra: 22.137, dec: -46.961, mag: 1.74, spec: 'B' },
  { name: 'Alnitak', ra: 5.679, dec: -1.943, mag: 1.77, spec: 'O' },
  { name: 'Alioth', ra: 12.900, dec: 55.960, mag: 1.77, spec: 'A' },
  { name: 'Dubhe', ra: 11.062, dec: 61.751, mag: 1.79, spec: 'K' },
  { name: 'Mirfak', ra: 3.405, dec: 49.861, mag: 1.80, spec: 'F' },
  { name: 'Regor', ra: 8.158, dec: -47.337, mag: 1.83, spec: 'O' },
  { name: 'Wezen', ra: 7.140, dec: -26.393, mag: 1.84, spec: 'F' },
  { name: 'Kaus Australis', ra: 18.403, dec: -34.385, mag: 1.85, spec: 'B' },
  { name: 'Avior', ra: 8.375, dec: -59.510, mag: 1.86, spec: 'K' },
  { name: 'Alkaid', ra: 13.792, dec: 49.313, mag: 1.86, spec: 'B' },
  { name: 'Sargas', ra: 17.622, dec: -42.998, mag: 1.87, spec: 'F' },
  { name: 'Menkalinan', ra: 5.992, dec: 44.947, mag: 1.90, spec: 'A' },
  { name: 'Atria', ra: 16.811, dec: -69.028, mag: 1.91, spec: 'K' },
  { name: 'Alhena', ra: 6.629, dec: 16.399, mag: 1.92, spec: 'A' },
  { name: 'Peacock', ra: 20.427, dec: -56.735, mag: 1.94, spec: 'B' },
  { name: 'Alsephina', ra: 8.745, dec: -54.709, mag: 1.96, spec: 'A' },
  { name: 'Mirzam', ra: 6.378, dec: -17.956, mag: 1.98, spec: 'B' },
  { name: 'Alphard', ra: 9.460, dec: -8.658, mag: 1.98, spec: 'K' },
  { name: 'Polaris', ra: 2.530, dec: 89.264, mag: 1.98, spec: 'F' },
  { name: 'Hamal', ra: 2.120, dec: 23.463, mag: 2.00, spec: 'K' },
  { name: 'Diphda', ra: 0.726, dec: -17.987, mag: 2.02, spec: 'K' },
  { name: 'Mizar', ra: 13.399, dec: 54.925, mag: 2.04, spec: 'A' },
  { name: 'Mirach', ra: 1.162, dec: 35.621, mag: 2.05, spec: 'M' },
  { name: 'Alpheratz', ra: 0.140, dec: 29.091, mag: 2.06, spec: 'B' },
  { name: 'Nunki', ra: 18.921, dec: -26.297, mag: 2.06, spec: 'B' },
  { name: 'Menkent', ra: 14.111, dec: -36.370, mag: 2.06, spec: 'K' },
  { name: 'Rasalhague', ra: 17.582, dec: 12.560, mag: 2.07, spec: 'A' },
  { name: 'Kochab', ra: 14.845, dec: 74.156, mag: 2.08, spec: 'K' },
  { name: 'Algieba', ra: 10.333, dec: 19.842, mag: 2.08, spec: 'K' },
  { name: 'Saiph', ra: 5.796, dec: -9.670, mag: 2.09, spec: 'B' },
  { name: 'Almach', ra: 2.065, dec: 42.330, mag: 2.10, spec: 'K' },
  { name: 'Tiaki', ra: 22.711, dec: -46.885, mag: 2.11, spec: 'M' },
  { name: 'Algol', ra: 3.136, dec: 40.956, mag: 2.12, spec: 'B' },
  { name: 'Denebola', ra: 11.818, dec: 14.572, mag: 2.14, spec: 'A' },
  { name: 'Muhlifain', ra: 12.692, dec: -48.960, mag: 2.17, spec: 'A' },
  { name: 'Naos', ra: 8.060, dec: -40.003, mag: 2.21, spec: 'O' },
  { name: 'Suhail', ra: 9.133, dec: -43.433, mag: 2.21, spec: 'K' },
  { name: 'Sadr', ra: 20.371, dec: 40.257, mag: 2.23, spec: 'F' },
  { name: 'Alphecca', ra: 15.578, dec: 26.715, mag: 2.23, spec: 'A' },
  { name: 'Eltanin', ra: 17.943, dec: 51.489, mag: 2.24, spec: 'K' },
  { name: 'Schedar', ra: 0.675, dec: 56.537, mag: 2.24, spec: 'K' },
  { name: 'Mintaka', ra: 5.533, dec: -0.299, mag: 2.25, spec: 'O' },
  { name: 'Aspidiske', ra: 9.285, dec: -59.275, mag: 2.26, spec: 'A' },
  { name: 'Caph', ra: 0.153, dec: 59.150, mag: 2.28, spec: 'F' },
  { name: 'Dschubba', ra: 16.006, dec: -22.622, mag: 2.29, spec: 'B' },
  { name: 'Larawag', ra: 16.836, dec: -34.293, mag: 2.29, spec: 'K' },
  { name: 'Alpha Lupi', ra: 14.699, dec: -47.388, mag: 2.30, spec: 'B' },
  { name: 'Epsilon Centauri', ra: 13.665, dec: -53.466, mag: 2.30, spec: 'B' },
  { name: 'Eta Centauri', ra: 14.597, dec: -42.158, mag: 2.33, spec: 'B' },
  { name: 'Izar', ra: 14.750, dec: 27.074, mag: 2.37, spec: 'K' },
  { name: 'Merak', ra: 11.031, dec: 56.382, mag: 2.37, spec: 'A' },
  { name: 'Enif', ra: 21.736, dec: 9.875, mag: 2.38, spec: 'K' },
  { name: 'Girtab', ra: 17.708, dec: -39.030, mag: 2.39, spec: 'B' },
  { name: 'Ankaa', ra: 0.438, dec: -42.306, mag: 2.40, spec: 'K' },
  { name: 'Phecda', ra: 11.897, dec: 53.695, mag: 2.44, spec: 'A' },
  { name: 'Sabik', ra: 17.173, dec: -15.725, mag: 2.43, spec: 'A' },
  { name: 'Scheat', ra: 23.063, dec: 28.083, mag: 2.42, spec: 'M' },
  { name: 'Aludra', ra: 7.401, dec: -29.303, mag: 2.45, spec: 'B' },
  { name: 'Alderamin', ra: 21.310, dec: 62.585, mag: 2.46, spec: 'A' },
  { name: 'Navi', ra: 0.945, dec: 60.717, mag: 2.47, spec: 'B' },
  { name: 'Markeb', ra: 9.369, dec: -55.011, mag: 2.47, spec: 'B' },
  { name: 'Aljanah', ra: 20.770, dec: 33.970, mag: 2.48, spec: 'K' },
  { name: 'Markab', ra: 23.079, dec: 15.205, mag: 2.49, spec: 'B' },

  // ── Constellation completers (recognizable asterisms) ──
  { name: 'Menkar', ra: 3.038, dec: 4.090, mag: 2.53, spec: 'M' },
  { name: 'Zeta Centauri', ra: 13.926, dec: -47.288, mag: 2.55, spec: 'B' },
  { name: 'Zosma', ra: 11.235, dec: 20.524, mag: 2.56, spec: 'A' },
  { name: 'Zeta Ophiuchi', ra: 16.619, dec: -10.567, mag: 2.57, spec: 'O' },
  { name: 'Arneb', ra: 5.545, dec: -17.822, mag: 2.58, spec: 'F' },
  { name: 'Delta Centauri', ra: 12.139, dec: -50.722, mag: 2.58, spec: 'B' },
  { name: 'Gienah', ra: 12.264, dec: -17.542, mag: 2.59, spec: 'B' },
  { name: 'Ascella', ra: 19.043, dec: -29.880, mag: 2.60, spec: 'A' },
  { name: 'Zubeneschamali', ra: 15.283, dec: -9.383, mag: 2.61, spec: 'B' },
  { name: 'Unukalhai', ra: 15.738, dec: 6.426, mag: 2.62, spec: 'K' },
  { name: 'Acrab', ra: 16.091, dec: -19.805, mag: 2.62, spec: 'B' },
  { name: 'Sheratan', ra: 1.911, dec: 20.808, mag: 2.64, spec: 'A' },
  { name: 'Phact', ra: 5.661, dec: -34.074, mag: 2.65, spec: 'B' },
  { name: 'Kraz', ra: 12.573, dec: -23.397, mag: 2.65, spec: 'G' },
  { name: 'Mahasim', ra: 5.995, dec: 37.213, mag: 2.65, spec: 'A' },
  { name: 'Ruchbah', ra: 1.430, dec: 60.235, mag: 2.68, spec: 'A' },
  { name: 'Muphrid', ra: 13.911, dec: 18.398, mag: 2.68, spec: 'G' },
  { name: 'Hassaleh', ra: 4.950, dec: 33.166, mag: 2.69, spec: 'K' },
  { name: 'Lesath', ra: 17.513, dec: -37.296, mag: 2.70, spec: 'B' },
  { name: 'Kaus Media', ra: 18.350, dec: -29.828, mag: 2.70, spec: 'K' },
  { name: 'Pi Puppis', ra: 7.285, dec: -37.098, mag: 2.71, spec: 'K' },
  { name: 'Tarazed', ra: 19.771, dec: 10.613, mag: 2.72, spec: 'K' },
  { name: 'Porrima', ra: 12.694, dec: -1.449, mag: 2.74, spec: 'F' },
  { name: 'Zubenelgenubi', ra: 14.848, dec: -16.042, mag: 2.75, spec: 'A' },
  { name: 'Theta Carinae', ra: 10.716, dec: -64.394, mag: 2.76, spec: 'B' },
  { name: 'Kornephoros', ra: 16.504, dec: 21.490, mag: 2.77, spec: 'G' },
  { name: 'Hatysa', ra: 5.590, dec: -5.910, mag: 2.77, spec: 'O' },
  { name: 'Rastaban', ra: 17.507, dec: 52.301, mag: 2.79, spec: 'G' },
  { name: 'Imai', ra: 12.252, dec: -58.749, mag: 2.79, spec: 'B' },
  { name: 'Cursa', ra: 5.131, dec: -5.086, mag: 2.79, spec: 'A' },
  { name: 'Kaus Borealis', ra: 18.466, dec: -25.421, mag: 2.81, spec: 'K' },
  { name: 'Tau Scorpii', ra: 16.598, dec: -28.216, mag: 2.82, spec: 'B' },
  { name: 'Beta Trianguli Australis', ra: 15.919, dec: -63.430, mag: 2.83, spec: 'F' },
  { name: 'Vindemiatrix', ra: 13.036, dec: 10.959, mag: 2.83, spec: 'G' },
  { name: 'Algenib', ra: 0.221, dec: 15.184, mag: 2.84, spec: 'B' },
  { name: 'Nihal', ra: 5.471, dec: -20.759, mag: 2.84, spec: 'G' },
  { name: 'Zeta Persei', ra: 3.902, dec: 31.884, mag: 2.85, spec: 'B' },
  { name: 'Tejat', ra: 6.383, dec: 22.514, mag: 2.87, spec: 'M' },
  { name: 'Alcyone', ra: 3.791, dec: 24.105, mag: 2.87, spec: 'B' },
  { name: 'Fawaris', ra: 19.749, dec: 45.131, mag: 2.87, spec: 'B' },
  { name: 'Sadalsuud', ra: 21.526, dec: -5.571, mag: 2.87, spec: 'G' },
  { name: 'Deneb Algedi', ra: 21.784, dec: -16.127, mag: 2.87, spec: 'A' },
  { name: 'Acamar', ra: 2.971, dec: -40.305, mag: 2.88, spec: 'A' },
  { name: 'Gomeisa', ra: 7.453, dec: 8.289, mag: 2.89, spec: 'B' },
  { name: 'Pi Scorpii', ra: 15.981, dec: -26.114, mag: 2.89, spec: 'B' },
  { name: 'Sadalmelik', ra: 22.096, dec: -0.320, mag: 2.94, spec: 'G' },
  { name: 'Algorab', ra: 12.498, dec: -16.515, mag: 2.95, spec: 'A' },
  { name: 'Upsilon Carinae', ra: 9.785, dec: -65.072, mag: 2.97, spec: 'A' },
  { name: 'Rasalas', ra: 9.764, dec: 23.774, mag: 2.98, spec: 'G' },
  { name: 'Seginus', ra: 14.535, dec: 38.308, mag: 3.03, spec: 'A' },
  { name: 'Pherkad', ra: 15.345, dec: 71.834, mag: 3.05, spec: 'A' },
  { name: 'Mebsuta', ra: 6.732, dec: 25.131, mag: 3.06, spec: 'G' },
  { name: 'Rasalgethi', ra: 17.244, dec: 14.390, mag: 3.08, spec: 'M' },
  { name: 'Albireo', ra: 19.512, dec: 27.960, mag: 3.18, spec: 'K' },
  { name: 'Megrez', ra: 12.257, dec: 57.033, mag: 3.31, spec: 'A' },
  { name: 'Segin', ra: 1.907, dec: 63.670, mag: 3.37, spec: 'B' },
  { name: 'Meissa', ra: 5.585, dec: 9.934, mag: 3.39, spec: 'O' },
];

/** Fast name lookup for constellation-line rendering — built once at module load. */
export const STAR_BY_NAME: Map<string, CatalogStar> = new Map(STAR_CATALOG.map((s) => [s.name, s]));

/**
 * Constellation Lines (Phase 30) — pairs of star NAMES (not array indices,
 * so this list survives the catalog above being reordered or extended)
 * connected by a faint line whenever both stars are drawn. Every name here
 * is verified to exist in STAR_CATALOG above.
 */
export const CONSTELLATION_LINES: [string, string][] = [
  // ── Ursa Major: the Big Dipper ──
  ['Dubhe', 'Merak'],
  ['Merak', 'Phecda'],
  ['Phecda', 'Megrez'],
  ['Megrez', 'Dubhe'],
  ['Megrez', 'Alioth'],
  ['Alioth', 'Mizar'],
  ['Mizar', 'Alkaid'],

  // ── Orion: shoulders, belt, feet ──
  ['Betelgeuse', 'Bellatrix'],
  ['Bellatrix', 'Mintaka'],
  ['Betelgeuse', 'Alnitak'],
  ['Mintaka', 'Alnilam'],
  ['Alnilam', 'Alnitak'],
  ['Mintaka', 'Rigel'],
  ['Alnitak', 'Saiph'],

  // ── Cassiopeia: the "W" ──
  ['Caph', 'Schedar'],
  ['Schedar', 'Navi'],
  ['Navi', 'Ruchbah'],
  ['Ruchbah', 'Segin'],

  // ── Crux: the Southern Cross (two crossing lines, not a closed loop) ──
  ['Gacrux', 'Acrux'],
  ['Mimosa', 'Imai'],

  // ── Scorpius: head, heart, curling tail ──
  ['Dschubba', 'Acrab'],
  ['Dschubba', 'Antares'],
  ['Antares', 'Tau Scorpii'],
  ['Tau Scorpii', 'Sargas'],
  ['Sargas', 'Shaula'],
  ['Shaula', 'Lesath'],

  // ── Sagittarius: the Teapot ──
  ['Kaus Borealis', 'Kaus Media'],
  ['Kaus Media', 'Kaus Australis'],
  ['Kaus Borealis', 'Nunki'],
  ['Nunki', 'Ascella'],
  ['Kaus Australis', 'Ascella'],

  // ── Leo: heart → neck → back → tail ──
  ['Regulus', 'Algieba'],
  ['Algieba', 'Zosma'],
  ['Zosma', 'Denebola'],
];
