// Audit probe: astronomy accuracy of the BRAHMAND engine vs reference algorithms.
import {
  getGalileanMoonPositions, getJulianDate, getMoonEquatorial, getSunEquatorial,
  convertEquatorialToHorizontalLST, getLocalSiderealTime, getParallacticAngleDeg,
  bennettRefractionDeg, convertHorizontalToEquatorial, convertEquatorialToHorizontal,
} from '../../src/engine/ephemerisMath';
import { TARGETS } from '../../src/data/bookContent';

const D = Math.PI / 180;
const norm = (x: number) => ((x % 360) + 360) % 360;
const w180 = (x: number) => ((x + 180) % 360 + 360) % 360 - 180;

// ── 1. Galilean moons: Meeus ch.44 low-accuracy method (X in Jupiter radii, + = west) ──
function meeusGalilean(jd: number): number[] {
  const d = jd - 2451545.0;
  const V = 172.74 + 0.00111588 * d;
  const M = 357.529 + 0.9856003 * d;
  const N = 20.020 + 0.0830853 * d + 0.329 * Math.sin(V * D);
  const J = 66.115 + 0.9025179 * d - 0.329 * Math.sin(V * D);
  const A = 1.915 * Math.sin(M * D) + 0.020 * Math.sin(2 * M * D);
  const B = 5.555 * Math.sin(N * D) + 0.168 * Math.sin(2 * N * D);
  const K = J + A - B;
  const R = 1.00014 - 0.01671 * Math.cos(M * D) - 0.00014 * Math.cos(2 * M * D);
  const r = 5.20872 - 0.25208 * Math.cos(N * D) - 0.00611 * Math.cos(2 * N * D);
  const delta = Math.sqrt(r * r + R * R - 2 * r * R * Math.cos(K * D));
  const psi = Math.asin((R / delta) * Math.sin(K * D)) / D;
  const t = d - delta / 173;
  const u1 = 163.8069 + 203.4058646 * t + psi - B;
  const u2 = 358.4140 + 101.2916335 * t + psi - B;
  const u3 = 5.7176 + 50.2345180 * t + psi - B;
  const u4 = 224.8092 + 21.4879800 * t + psi - B;
  const G = 331.18 + 50.310482 * t;
  const H = 87.45 + 21.569231 * t;
  const c1 = 0.473 * Math.sin(2 * (u1 - u2) * D);
  const c2 = 1.065 * Math.sin(2 * (u2 - u3) * D);
  const c3 = 0.165 * Math.sin(G * D);
  const c4 = 0.843 * Math.sin(H * D);
  const r1 = 5.9057 - 0.0244 * Math.cos(2 * (u1 - u2) * D);
  const r2 = 9.3966 - 0.0882 * Math.cos(2 * (u2 - u3) * D);
  const r3 = 14.9883 - 0.0216 * Math.cos(G * D);
  const r4 = 26.3627 - 0.1939 * Math.cos(H * D);
  return [
    r1 * Math.sin((u1 + c1) * D),
    r2 * Math.sin((u2 + c2) * D),
    r3 * Math.sin((u3 + c3) * D),
    r4 * Math.sin((u4 + c4) * D),
  ];
}

console.log('=== 1. Galilean moon offsets (Jupiter radii): engine vs Meeus ch.44 ===');
const names = ['Io', 'Europa', 'Ganymede', 'Callisto'];
let worst = [0, 0, 0, 0];
let worstFlipped = [0, 0, 0, 0];
const start = Date.UTC(2026, 10, 4, 18, 0, 0);
for (let i = 0; i < 400; i++) {
  const t = start + i * 0.37 * 86400000;
  const jd = getJulianDate(new Date(t));
  const eng = getGalileanMoonPositions(jd).map((m) => m.offsetJupiterRadii);
  const ref = meeusGalilean(jd);
  for (let k = 0; k < 4; k++) {
    worst[k] = Math.max(worst[k], Math.abs(eng[k] - ref[k]));
    worstFlipped[k] = Math.max(worstFlipped[k], Math.abs(eng[k] + ref[k]));
  }
}
for (let k = 0; k < 4; k++) {
  console.log(`${names[k].padEnd(9)} max |engine - meeus| = ${worst[k].toFixed(2)} R_J   (sign-flipped: ${worstFlipped[k].toFixed(2)} R_J)`);
}
for (const iso of ['2026-11-04T20:00:00Z', '2026-12-25T20:00:00Z', '2027-02-10T18:00:00Z']) {
  const jd = getJulianDate(new Date(iso));
  const eng = getGalileanMoonPositions(jd).map((m) => m.offsetJupiterRadii.toFixed(1));
  const ref = meeusGalilean(jd).map((x) => x.toFixed(1));
  console.log(`${iso}  engine [${eng.join(', ')}]   meeus(+W) [${ref.join(', ')}]`);
}
// What epoch would make the engine's L0 values right? Lieske E5 epoch is JD 2443000.5.
{
  const jd = getJulianDate(new Date('2026-11-04T20:00:00Z'));
  const shifted = getGalileanMoonPositions(jd - (2451545.0 - 2443000.5)).map((m) => m.offsetJupiterRadii.toFixed(1));
  console.log(`(engine with epoch moved to JD 2443000.5: [${shifted.join(', ')}])`);
}

// ── 2. Lunar bright-limb direction on screen (zenith-up, +x = increasing azimuth) ──
console.log('\n=== 2. Moon bright-limb screen angle: engine formula vs vector truth ===');
const lat = 26.9124, lon = 75.7873;
function enu(alt: number, az: number) {
  return [Math.cos(alt * D) * Math.sin(az * D), Math.cos(alt * D) * Math.cos(az * D), Math.sin(alt * D)];
}
let n = 0, sumErr = 0, maxErr = 0, maxErrNoQ = 0, maxApproxOnly = 0;
for (let i = 0; i < 2000; i++) {
  const t = start + i * 0.0731 * 86400000;
  const jd = getJulianDate(new Date(t));
  const lst = getLocalSiderealTime(jd, lon);
  const moonEq = getMoonEquatorial(t, { latitude: lat, longitude: lon });
  const sunEq = getSunEquatorial(jd);
  const m = convertEquatorialToHorizontalLST(moonEq.ra, moonEq.dec, lat, lst);
  const s = convertEquatorialToHorizontalLST(sunEq.ra, sunEq.dec, lat, lst);
  if (m.altitude < 10) continue;
  const q = getParallacticAngleDeg(moonEq.ra, moonEq.dec, lat, lon, new Date(t)) * D;
  const dAlt = s.altitude - m.altitude;
  const dAz = w180(s.azimuth - m.azimuth);
  const engine = Math.atan2(-dAlt, dAz) + q;
  const engineNoQ = Math.atan2(-dAlt, dAz);
  // truth: tangent direction from Moon toward Sun, expressed on the screen basis
  const mv = enu(m.altitude, m.azimuth), sv = enu(s.altitude, s.azimuth);
  const dot = mv[0] * sv[0] + mv[1] * sv[1] + mv[2] * sv[2];
  const tv = [sv[0] - dot * mv[0], sv[1] - dot * mv[1], sv[2] - dot * mv[2]];
  const az = m.azimuth * D, al = m.altitude * D;
  const right = [Math.cos(az), -Math.sin(az), 0];
  const up = [-Math.sin(al) * Math.sin(az), -Math.sin(al) * Math.cos(az), Math.cos(al)];
  const tr = tv[0] * right[0] + tv[1] * right[1] + tv[2] * right[2];
  const tu = tv[0] * up[0] + tv[1] * up[1] + tv[2] * up[2];
  const truth = Math.atan2(-tu, tr);
  const err = Math.abs(w180((engine - truth) / D));
  const errNoQ = Math.abs(w180((engineNoQ - truth) / D));
  n++; sumErr += err; maxErr = Math.max(maxErr, err); maxErrNoQ = Math.max(maxErrNoQ, errNoQ);
  maxApproxOnly = Math.max(maxApproxOnly, errNoQ);
}
console.log(`samples (Moon above 10 deg): ${n}`);
console.log(`engine (atan2 + q): mean error ${(sumErr / n).toFixed(1)} deg, max ${maxErr.toFixed(1)} deg`);
console.log(`without the +q term:  max error ${maxErrNoQ.toFixed(1)} deg (raw alt/az difference approximation alone)`);

// ── 3. Equatorial mount: does the starfield rotate around a tracked target? ──
console.log('\n=== 3. Starfield rotation in the alt-az projection while tracking (SCT, EQ) ===');
{
  const ra = TARGETS.saturn.ra!, dec = TARGETS.saturn.dec!;
  const starRa = ra + 0.03, starDec = dec + 0.3; // a star ~0.5 deg away
  const t0 = Date.UTC(2026, 10, 4, 14, 0, 0); // evening in Jaipur (UTC+5:30)
  for (const hours of [0, 1, 2, 3]) {
    const t = t0 + hours * 3600000;
    const jd = getJulianDate(new Date(t));
    const lst = getLocalSiderealTime(jd, lon);
    const p = convertEquatorialToHorizontalLST(ra, dec, lat, lst);
    const st = convertEquatorialToHorizontalLST(starRa, starDec, lat, lst);
    const x = w180(st.azimuth - p.azimuth) * Math.cos(p.altitude * D);
    const y = -(st.altitude - p.altitude);
    console.log(`+${hours}h  Saturn alt ${p.altitude.toFixed(1)}  star position angle on screen ${(Math.atan2(y, x) / D).toFixed(1)} deg`);
  }
}

// ── 4. Static planet coordinates vs a Keplerian ephemeris (JPL approx elements, 1800-2050) ──
console.log('\n=== 4. Planet positions: static catalog vs Keplerian ephemeris ===');
type El = [number, number, number, number, number, number, number, number, number, number, number, number];
// a, e, I, L, long.peri, long.node  and their rates per century (JPL Standish table 1)
const EL: Record<string, El> = {
  earth: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0, 0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  jupiter: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, -0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  saturn: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, -0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
};
function helio(name: string, T: number) {
  const e0 = EL[name];
  const a = e0[0] + e0[6] * T, e = e0[1] + e0[7] * T, I = e0[2] + e0[8] * T;
  const L = e0[3] + e0[9] * T, wbar = e0[4] + e0[10] * T, node = e0[5] + e0[11] * T;
  const w = wbar - node;
  let M = norm(L - wbar); if (M > 180) M -= 360;
  let E = M + (e / D) * Math.sin(M * D);
  for (let k = 0; k < 10; k++) E = E - (E - (e / D) * Math.sin(E * D) - M) / (1 - e * Math.cos(E * D));
  const xp = a * (Math.cos(E * D) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E * D);
  const cw = Math.cos(w * D), sw = Math.sin(w * D), cO = Math.cos(node * D), sO = Math.sin(node * D), cI = Math.cos(I * D), sI = Math.sin(I * D);
  return [
    (cw * cO - sw * sO * cI) * xp + (-sw * cO - cw * sO * cI) * yp,
    (cw * sO + sw * cO * cI) * xp + (-sw * sO + cw * cO * cI) * yp,
    (sw * sI) * xp + (cw * sI) * yp,
  ];
}
function geoRaDec(name: string, t: number) {
  const T = (getJulianDate(new Date(t)) - 2451545.0) / 36525;
  const p = helio(name, T), ea = helio('earth', T);
  const x = p[0] - ea[0], y = p[1] - ea[1], z = p[2] - ea[2];
  const eps = 23.43928 * D;
  const xe = x, ye = y * Math.cos(eps) - z * Math.sin(eps), ze = y * Math.sin(eps) + z * Math.cos(eps);
  return { ra: norm(Math.atan2(ye, xe) / D) / 15, dec: Math.atan2(ze, Math.hypot(xe, ye)) / D };
}
function sep(ra1: number, d1: number, ra2: number, d2: number) {
  const c = Math.sin(d1 * D) * Math.sin(d2 * D) + Math.cos(d1 * D) * Math.cos(d2 * D) * Math.cos((ra1 - ra2) * 15 * D);
  return Math.acos(Math.max(-1, Math.min(1, c))) / D;
}
for (const iso of ['2026-11-04T00:00:00Z', '2027-03-01T00:00:00Z', '2027-11-01T00:00:00Z']) {
  const t = Date.parse(iso);
  for (const pl of ['jupiter', 'saturn'] as const) {
    const g = geoRaDec(pl, t);
    const cat = TARGETS[pl];
    const sunEq = getSunEquatorial(getJulianDate(new Date(t)));
    console.log(`${iso.slice(0, 10)} ${pl.padEnd(8)} true RA ${g.ra.toFixed(2)}h Dec ${g.dec.toFixed(1)}  | catalog RA ${cat.ra}h Dec ${cat.dec}  | error ${sep(g.ra, g.dec, cat.ra!, cat.dec!).toFixed(1)} deg | true elongation from Sun ${sep(g.ra, g.dec, sunEq.ra, sunEq.dec).toFixed(0)} deg`);
  }
}

// ── 5. Refraction: Bennett applied to GEOMETRIC altitude vs Saemundsson ──
console.log('\n=== 5. Refraction formula ===');
for (const h of [0, 0.5, 1, 2, 5, 10, 20, 45]) {
  const bennett = bennettRefractionDeg(h) * 60;
  const saem = 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * D);
  console.log(`true alt ${String(h).padStart(4)}: engine lift ${bennett.toFixed(2)}'  Saemundsson ${saem.toFixed(2)}'  diff ${(bennett - saem).toFixed(2)}'`);
}

// ── 6. Degenerate inputs ──
console.log('\n=== 6. Degenerate inputs ===');
console.log('alt/az of a body at the zenith:', JSON.stringify(convertEquatorialToHorizontalLST(0, lat, lat, 0)));
console.log('pole observer (lat 90):', JSON.stringify(convertEquatorialToHorizontalLST(3, 40, 90, 1)));
console.log('inverse at alt 90:', JSON.stringify(convertHorizontalToEquatorial(90, 0, lat)));
console.log('round trip at alt 89.999:', JSON.stringify(convertHorizontalToEquatorial(89.999, 123, lat)));
const tt = Date.UTC(2026, 10, 4, 15);
const eq = { ra: 5.5, dec: -5 };
const hz = convertEquatorialToHorizontal(eq.ra, eq.dec, lat, lon, new Date(tt));
console.log('forward', JSON.stringify(hz));
