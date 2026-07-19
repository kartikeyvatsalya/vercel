# BRAHMAND Physics Engine — Architecture Whitepaper

**The mathematics and architecture of a real-time telescope operations simulator.**

This document describes the physics core of BRAHMAND: how simulated time flows, how celestial coordinates become eyepiece pixels, why the view rotates on a Dobsonian but not on an equatorial mount, how the Galilean moons orbit, and how the "difficulty modes" bend time — never space — to stay honest. Every formula below is implemented in `src/engine/` as pure TypeScript functions with no React or store dependencies, and every simplification is deliberate and documented.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Timekeeping — the Smooth Clock](#2-timekeeping--the-smooth-clock)
3. [The Celestial Coordinate Pipeline](#3-the-celestial-coordinate-pipeline)
4. [The Daylight Model](#4-the-daylight-model)
5. [The Universal Sky Rendering Loop](#5-the-universal-sky-rendering-loop)
6. [Field Rotation — the Parallactic Angle](#6-field-rotation--the-parallactic-angle)
7. [The Galilean Moon Ephemeris](#7-the-galilean-moon-ephemeris)
8. [Time-Gentled Drift Mechanics](#8-time-gentled-drift-mechanics)
9. [Sidereal Tracking & the Mount Model](#9-sidereal-tracking--the-mount-model)
10. [Optical Mathematics](#10-optical-mathematics)
11. [Astrophotography Models](#11-astrophotography-models)
12. [Known Simplifications & Validity Domains](#12-known-simplifications--validity-domains)
13. [Source Map](#13-source-map)

---

## 1. System Architecture

The simulator is layered so that all physics is **pure and framework-free**, all state is **centralized and low-frequency**, and all rendering is **spec-driven**:

```
┌────────────────────────────── React UI layer ──────────────────────────────┐
│ App.tsx            module tabs, mission/curriculum evaluation,             │
│                    1 Hz clock→store sync                                   │
│ LiveViewPanel.tsx  ONE shared rAF loop → two 2D canvases                   │
│                    (Main Eyepiece Feed + Finderscope Feed)                 │
│ ObservatoryScene   React-Three-Fiber useFrame loops → 3D observatory,      │
│                    Dobsonian / German-equatorial rigs, sky dome            │
└───────────┬────────────────────────────────────────────────┬───────────────┘
            │ .getState() sampled inside render loops        │ pure calls
┌───────────▼─────────────────────┐        ┌─────────────────▼───────────────┐
│ Zustand stores (persisted)      │        │ src/engine/ (pure TypeScript)   │
│ useTelescopeStore — pointing,   │ ─────▶ │ timeEngine     ephemerisMath    │
│   optics, clock mirror, modes   │ calls  │ skyGeometry    skyRenderer      │
│ useAlignmentStore, useProgress… │        │ daylight       opticalMath      │
└─────────────────────────────────┘        │ astroMath      simulationModes  │
                                           └─────────────────────────────────┘
```

Three design rules keep the system coherent:

**1. One clock, one sky.** Every consumer — both 2D optical feeds, the 3D observatory, the safety interlock, the daylight engine — derives its view from the same continuous simulation clock and the same coordinate pipeline. There is no second copy of the sky anywhere.

**2. The renderer is a pure function of its spec.** `renderOpticalView(ctx, spec)` receives everything it needs (`OpticalViewSpec`) and touches no store. The Main Eyepiece Feed and the Finderscope Feed are the *same function* called with the same pointing and body list, differing only in `role`, field of view, and finder-only axis-error fields. Manual slews, drift, and motor tracking therefore update both feeds simultaneously *by construction*, not by synchronization.

**3. Render loops read stores imperatively.** The rAF loop calls `useTelescopeStore.getState()` *inside* the frame callback instead of closing over React-subscribed values. Zustand replaces the state object on every `set()`, so a subscribed effect would tear down and rebuild the loop on every frame; the imperative read makes the loop's `useEffect` dependency-free and stable.

---

## 2. Timekeeping — the Smooth Clock

*Implementation: `src/engine/timeEngine.ts`*

Simulated time is a continuous linear map from wall-clock time, defined by an anchor pair and a rate:

$$
t_{sim}(t_{real}) = A_{sim} + (t_{real} - A_{real}) \cdot r
$$

where $A_{sim}$ is a simulated epoch-ms anchor, $A_{real}$ its `performance.now()` counterpart, and $r \in \{1, 10, 60\}$ the playback rate. Render loops call `getSmoothSimTime()` every frame for millisecond-interpolated ephemeris positions.

**Why an anchor, not a tick.** An earlier design advanced `simTime` in discrete 1-second `setInterval` ticks; at high magnification the unmotored sky visibly *jumped* once per second. The anchor formulation makes drift a continuous function of real time — and because `performance.now()` keeps counting in hidden tabs, simulated time is already correct on the first frame after the user returns.

**The 1 Hz mirror.** React UI (the telemetry clock, horizon chips) doesn't need 60 updates per second. `App.tsx` samples the smooth clock into the Zustand store's `simTime` field once per second (`syncSimTime`); canvases and the 3D scene bypass the mirror entirely.

**Re-anchoring discipline.** Every discontinuous change re-anchors the engine at the exact moment of the change: boot, ±1 Hour steps, and playback-rate changes (`reanchorTimeEngine`). Re-anchoring on rate change matters: changing $r$ without moving the anchor would retroactively re-slope the *past*, teleporting the present.

The sky's angular rate is the sidereal rate, exported as a single constant:

$$
\omega_{sidereal} = 15.041°/\text{hour} \;\approx\; 4.178 \times 10^{-3}\,°/\text{s}
$$

---

## 3. The Celestial Coordinate Pipeline

*Implementation: `src/engine/ephemerisMath.ts` — standard spherical astronomy per Duffett-Smith and Meeus.*

### 3.1 Julian Date and Sidereal Time

The Unix epoch (1970-01-01 00:00 UTC) is JD 2440587.5, so:

$$
JD = \frac{t_{ms}}{86\,400\,000} + 2\,440\,587.5
$$

Greenwich Mean Sidereal Time uses the standard linear approximation on $d = JD - 2\,451\,545.0$ (days since J2000.0):

$$
GMST_{deg} = 280.46061837 + 360.98564736629\,d \pmod{360}
$$

Local Sidereal Time adds the observer's east-positive longitude: $LST = GMST + \lambda$. The dropped quadratic terms contribute ~0.0003° per decade — irrelevant at eyepiece scale.

### 3.2 Equatorial → Horizontal (the forward transform)

For a body at right ascension $\alpha$ and declination $\delta$, observed from latitude $\varphi$, the hour angle is $H = LST - \alpha$, and:

$$
\sin a = \sin\delta \sin\varphi + \cos\delta \cos\varphi \cos H
$$

$$
\cos A = \frac{\sin\delta - \sin a \sin\varphi}{\cos a \cos\varphi}
$$

Altitude $a$ comes from $\arcsin$ (argument clamped to $[-1,1]$ against floating-point drift). The $\arccos$ only resolves azimuth $A$ to $[0°, 180°]$; the hour angle's sign disambiguates east from west:

$$
\text{if } \sin H > 0 \text{ (west of meridian): } A \leftarrow 360° - A
$$

giving azimuth measured from North through East, the navigation convention.

**Performance note.** The JD → LST derivation (including a `Date` allocation) is identical for every star in a frame. `convertEquatorialToHorizontalLST` accepts a precomputed LST so the render loop hoists it: one derivation per frame instead of one per star (~150 named stars + hundreds of procedural field stars).

### 3.3 Horizontal → Equatorial (the inverse transform)

The mirror-image formulas recover $(H, \delta)$ from $(a, A)$:

$$
\sin\delta = \sin a \sin\varphi + \cos a \cos\varphi \cos A
\qquad
\cos H = \frac{\sin a - \sin\varphi \sin\delta}{\cos\varphi \cos\delta}
$$

with the same quadrant mirror ($\sin A > 0 \Rightarrow H \leftarrow 360° - H$), and $\alpha = LST - H$. This inverse is what makes two subsystems possible:

- **The sidereal tracking motor** freezes the mount's *current* sky direction in the rotating frame (§9).
- **The 3D German Equatorial rig** converts the commanded Alt/Az into the physical hour-angle and declination axis rotations a GEM must dial in.

The pair is numerically round-trip verified to ~2×10⁻⁹ degrees over 5,000 random pointings.

### 3.4 The Solar Ephemeris

The Sun is the only body with a *live* ephemeris (everything else is a catalog snapshot; see §12). The standard Astronomical Almanac low-precision series, accurate to ~0.01° for decades around J2000:

$$
\begin{aligned}
L &= 280.460° + 0.9856474\,n \quad\text{(mean longitude)}\\
g &= 357.528° + 0.9856003\,n \quad\text{(mean anomaly)}\\
\lambda_\odot &= L + 1.915°\sin g + 0.020°\sin 2g \quad\text{(ecliptic longitude)}\\
\varepsilon &= 23.439° - 4\times10^{-7}\,n \quad\text{(obliquity)}
\end{aligned}
$$

$$
\alpha_\odot = \operatorname{atan2}(\cos\varepsilon \sin\lambda_\odot,\; \cos\lambda_\odot)
\qquad
\delta_\odot = \arcsin(\sin\varepsilon \sin\lambda_\odot)
$$

with $n = JD - 2\,451\,545.0$. One resolver — `getBodyEquatorial` in `skyGeometry.ts` — routes every consumer (renderer, GoTo slews, safety interlock, daylight engine) through this same source, so the drawn Sun, the slewed-to Sun, the sky's brightness, and the hazard interlock can never disagree about where the Sun is.

---

## 4. The Daylight Model

*Implementation: `src/engine/daylight.ts`*

Atmospheric scattering is reduced to one input — the Sun's altitude — driving one shared ramp used by both 2D feeds *and* the 3D dome. The color stops follow the real twilight ladder:

| Sun altitude | Regime | Sky color anchor |
|---|---|---|
| ≥ +8° | Full daylight | Rayleigh blue `rgb(116,178,234)` |
| 0° | Sunrise/sunset | Warm wash `rgb(204,141,94)` |
| −6° | Civil twilight | Deep blue hour `rgb(52,62,110)` |
| −12° | Nautical twilight | `rgb(18,24,52)` |
| ≤ −18° | Astronomical night | Space black `rgb(5,5,16)` |

A scalar **darkness** $d \in [0,1]$ ramps linearly across the twilight ladder, $d = \min(1, -a_\odot / 18°)$ for $a_\odot < 0$, and gates *everything* that depends on a dark sky:

**Star visibility** — brighter stars pierce twilight first, exactly as in the real sky. A star of magnitude $m$ is drawn only if $m < 7.5\,d - 1.5$, with alpha scaled by both darkness and brightness. Sirius appears in civil dusk; magnitude-6 stars need astronomical night.

**Per-type daytime washout** — daylight visibility is decided by what the body *is*, because Rayleigh-scattered skylight washes out everything with lower surface brightness than the sky itself:

| Body type | Daytime visibility |
|---|---|
| Sun, terrestrial | 1 (the Sun *is* the daylight; scenery is front-lit) |
| Moon | $0.35 + 0.65\,d$ (a pale ghost at noon — real) |
| Planet | $\text{clamp}\big((d - 0.12)/0.45\big)$ (emerges through civil twilight) |
| Nebula / galaxy / star | $\text{clamp}\big((d - 0.45)/0.5\big)$ (needs genuinely dark skies) |

A body whose visibility rounds to zero is culled before any drawing work — Jupiter in a blue noon sky was pure fiction, and now simply isn't there.

**Virtual Night** — a classroom override that forces the effective sun altitude to −30° (safely past astronomical dusk) so daytime students still see stars. It changes the *effective* input to the model, not the model.

---

## 5. The Universal Sky Rendering Loop

*Implementation: `src/engine/skyRenderer.ts` (drawing), `src/engine/skyGeometry.ts` (projection), `src/components/liveview/LiveViewPanel.tsx` (the loop).*

### 5.1 The core principle: a physical universe, not a selected target

Early versions rendered only the UI-selected target. The Universal Sky refactor inverted this: **every catalog body is evaluated for physical visibility every frame**, regardless of what the UI has "locked." Pushing the tube off the Moon pans the Moon out of the field in rigid formation with the starfield — it doesn't erase it from the sky. The UI target lock still exists, but it now marks *which body runs on the drift-gentled clock* (§8) and anchors the defocus bokeh; it no longer gates rendering.

### 5.2 Frame anatomy

One `requestAnimationFrame` loop drives both canvases. Per frame:

1. **Sample time once** — `getSmoothSimTime(now)`, shared by every computation below.
2. **Derive pointing** — the store's Alt/Az, or (motor on) the tracked RA/Dec pushed through the forward transform at the same smooth time (§9).
3. **Physical solar-hazard check** — angular distance from the mount's pointing to the *live* Sun (§5.7).
4. **Evaluate the rules engine** — focus, collimation, dust cap, seeing, hazard flags → `evalResult`.
5. **Compute the gentled target clock** — `getDriftGentledSimTime` (§8).
6. **Sample the sky state** — sun altitude → background color + darkness, once, shared by both feeds.
7. **Render both feeds** — `renderOpticalView` with the same spec, differing only in role/FOV/finder-error.
8. **Post-process overlays** — mode lenses (tracking reticle, astrophotography exposure simulation) draw on top of the same canvas.

Within `renderOpticalView`, paint order is: dynamic sky background → constellation lines → procedural faint field stars → named catalog stars → **universal sky bodies** (far → near) → finder crosshair → circular field-stop mask → bezel. The field stop crops everything at the end, so no per-layer clipping is needed.

### 5.3 The projection model

The eyepiece view is a **flat Alt/Az tangent-plane approximation**: for a body at horizontal offset $(\Delta a, \Delta A)$ from the pointing center,

$$
x_{px} = \frac{\Delta A}{FOV_{true}} \cdot W
\qquad
y_{px} = -\frac{\Delta a}{FOV_{true}} \cdot W
$$

with azimuth deltas wrapped into $[-180°, 180°)$ so "358° away" reads as "−2° away." All layers — stars, lines, field stars, bodies — share this exact mapping, which is what makes the sky move as one rigid unit during slews. The deliberate simplification (no $\cos a$ scaling of azimuth spans; see §12) is invisible at eyepiece fields a few degrees wide and mid altitudes, which is where the simulator lives.

Rendered offsets are clamped to ±2000 px: beyond ~6 field-widths a body is simply out of view, and unbounded canvas coordinates would be numeric noise.

### 5.4 The cull ladder

The 60 fps guard is a strict **cheapest-test-first** ladder, run per body:

1. **Daylight washout** (a table lookup, §4) — a body dimmer than the day sky isn't there.
2. **One Alt/Az conversion** → below-horizon check (with −1° grace) → rectangular FOV bounds check.
3. Only *then* any texture, sprite, per-body trig (parallactic angle), or the Jovian ephemeris.

A culled body costs one coordinate conversion — the same as a single catalog star. Each body's cull radius covers its full *render* footprint, not just its disk: Jupiter's footprint is dominated by the Galilean moons (Callisto swings to ±26.33 Jupiter radii), so its cull radius is 27× its angular radius; everything else gets 2× for glow halos and ring tips. This is why the Moon keeps drawing while its center sits off-canvas at high power, and why Jupiter's moons never pop in at the field edge.

Bodies are painted far → near (M42 at 1,344 ly under the planets, the Moon over them, terrestrial scenery in front of everything) so overlaps occlude correctly.

### 5.5 The two-tier procedural starfield

The named catalog (~150 brightest stars) is correct for the naked eye but statistically empty at eyepiece scale — a 25 mm eyepiece on the 8″ Dobsonian sees ~1.3 square degrees, one named star per ~275. Real eyepieces show anonymous field stars everywhere, so the renderer synthesizes them **deterministically from the celestial sphere itself**:

- The sky is divided into fixed RA/Dec grid cells at two tiers:
  **Tier 0** — 4°×4° cells, 8 stars each, mag 4.8–7.5, active for fields ≤ 60° (the finder).
  **Tier 1** — 1°×1° cells, 14 stars each, mag 7.5–11.5, active only for fields ≤ 4° (eyepieces).
- Each cell seeds a mulberry32 PRNG from its wrapped, sky-fixed identity — $(r_i \cdot 73856093) \oplus (d_i \cdot 19349663) \oplus (tier \cdot 83492791)$, the classic spatial-hash primes — never from the FOV or frame. A cell's stars are therefore identical from every view, forever: each pseudo-star is *bolted to the celestial sphere*, pans 1:1 with the mount, and drifts at the true sidereal rate exactly like Vega.
- Magnitudes skew quadratically toward the faint end ($m = m_{max} - (m_{max}-m_{min})\,u^2$), mimicking real star counts climbing steeply with magnitude.
- Each star survives only if brighter than the active optic's limiting magnitude (§10) — which stars exist at all depends on the glass, exactly as at a real eyepiece.
- RA search widths widen by $1/\cos\delta$ toward the poles (floored at 0.15) so polar fields stay filled without cell-count blowup.

The tier bounds cap the worst case at roughly 1,500 hash-and-project operations per feed per frame (at the 4° tier boundary) — a few hundred microseconds of arithmetic.

### 5.6 Idle throttling

Physics and progress checks run every frame; *pixels* are pushed only when they'd change. The loop computes whether anything is visibly in motion:

- any active drag / D-pad slew / alignment-screw velocity,
- the mount's stored pointing changed since last frame (e.g. the 3D tube was grabbed),
- unmotored sky drift is fast enough to *look* choppy: the on-canvas drift rate
  $\left(\omega_{sidereal} \cdot r / FOV\right) \cdot W > 2\ \text{px/s}$
  (at 48× and 1× playback the Moon drifts ~1.2 px/s — the idle cadence renders that imperceptibly),
- an animated penalty (atmospheric jitter, mechanical droop) is active.

Otherwise the canvases redraw at a 200 ms idle cadence (~5 fps) — ~12× fewer full draws when the scene is at rest, which is most of a classroom session.

### 5.7 The physical solar-safety interlock

Because the Universal Sky draws the Sun wherever the tube crosses it, the safety system watches the mount's **physical pointing** against the **live solar ephemeris** — not the UI selection. If the angular distance $\sqrt{\Delta a^2 + \Delta A^2}$ to a risen Sun falls under 4.0° (half the finder's 7.5° field — the widest optic bolted to the tube — plus the solar radius), the rules engine raises the solar hazard: an unmissable full-canvas flash in the unfiltered main eyepiece. Slewing across the daytime sky *at* the Sun triggers it with no target selected at all, which is precisely the accident the interlock exists to teach.

### 5.8 Optical inversion

A Newtonian's mirror flips the *entire field* 180° — not just the target. For profiles with `isInvertedView`, the whole sky transform (stars and bodies as one unit) is rotated π around the canvas center before drawing, while the crosshair/bezel HUD stays screen-locked outside the transform. The finder, a straight-through refractor, never inverts — teaching students why the two views disagree.

---

## 6. Field Rotation — the Parallactic Angle

*Implementation: `getParallacticAngleDeg` in `src/engine/ephemerisMath.ts`; applied in `skyRenderer.drawUniversalSkyBodies`.*

### 6.1 What it is

An Alt-Az mount tracks in altitude and azimuth, but the sky rotates about the celestial pole. Even with perfect tracking, the *orientation* of every object slowly spins in the eyepiece over a Dobsonian session — Saturn's rings tilt, M42's wings wheel around. An equatorial mount rotates about an axis parallel to Earth's own, so it cancels this by mechanical design. The angle in question is the **parallactic angle** $q$: the angle at the object between the great circle toward the zenith and the great circle toward the celestial pole.

### 6.2 Derivation

Consider the astronomical triangle on the celestial sphere with vertices at the **pole** $P$, the **zenith** $Z$, and the **object** $X$:

- side $PZ = 90° - \varphi$ (colatitude),
- side $PX = 90° - \delta$ (codeclination),
- side $ZX = z$ (zenith distance),
- angle at $P$ = hour angle $H$,
- angle at $X$ = parallactic angle $q$.

Apply the four-parts (cotangent) formula to the consecutive parts $\big(q,\; PX,\; H,\; PZ\big)$, where $PX$ and $H$ are the inner side and inner angle:

$$
\cos(PX)\cos H = \sin(PX)\cot(PZ) - \sin H \cot q
$$

Substituting $\cos(90°-\delta) = \sin\delta$, $\sin(90°-\delta) = \cos\delta$, $\cot(90°-\varphi) = \tan\varphi$:

$$
\sin\delta \cos H = \cos\delta \tan\varphi - \sin H \cot q
$$

and solving for $q$:

$$
\boxed{\;q = \operatorname{atan2}\big(\sin H,\;\; \tan\varphi \cos\delta - \sin\delta \cos H\big)\;}
$$

— the Meeus (ch. 14) form implemented verbatim. Using `atan2` rather than `atan` preserves the full $(-180°, 180°]$ range, which matters: objects that culminate *north* of the zenith legitimately reach $|q| \to 180°$ (they cross the meridian "upside down" relative to pole-up).

### 6.3 Behavior

- **On the meridian** ($H = 0$, object south of zenith): $q = 0$ — zenith-up and pole-up coincide.
- **East of the meridian** (rising, $\sin H < 0$): $q < 0$; **west** (setting): $q > 0$. The orientation swings through zero at transit — fastest for objects passing near the zenith.
- The instantaneous field-rotation *rate* follows as $\dot q = \omega_{sidereal} \cos\varphi \cos A / \cos a$ — but the simulator never integrates a rate. It re-evaluates $q$ from the closed form every frame, so the rotation is exact by construction, including through the rapid zenith swing.

### 6.4 Implementation semantics

The angle depends only on the **body's own position** — not on pointing error, tracking state, or which feed is drawing. Both feeds are rigidly bolted to the same tube, so both apply the identical rotation: the canvas is rotated by $q$ about the body's center, the glyph (and, for Jupiter, its entire moon line — see §7) is painted inside that transform, and the transform is popped. Equatorial-mount profiles skip the rotation entirely ($q$ is applied only when `isAltAzMount`), and terrestrial targets — which have no equatorial anchor — are excluded naturally because their ephemeris resolver returns null.

This is the difference students see when they switch the 8″ Dobsonian for the 14″ SCT on its equatorial fork: same sky, same target, and the view stops rotating.

---

## 7. The Galilean Moon Ephemeris

*Implementation: `getGalileanMoonPositions` in `src/engine/ephemerisMath.ts`; rendered inside Jupiter's glyph pass in `skyRenderer.ts`.*

### 7.1 The model

Io, Europa, Ganymede, and Callisto are modeled on **circular, coplanar, edge-on orbits** — a deliberately simplified but structurally faithful ephemeris. Each moon's mean orbital longitude advances uniformly from its true J2000.0 value:

$$
L_i(t) = L_{i,0} + \frac{360°}{P_i}\,(JD - 2\,451\,545.0) \pmod{360°}
$$

with periods and epoch longitudes from the standard tables (Meeus ch. 44):

| Moon | $P$ (days) | $a$ ($R_J$) | $L_0$ (deg) | mag |
|---|---|---|---|---|
| Io | 1.769138 | 5.90 | 106.077 | 5.0 |
| Europa | 3.551181 | 9.39 | 175.732 | 5.3 |
| Ganymede | 7.154553 | 14.97 | 120.559 | 4.6 |
| Callisto | 16.689018 | 26.33 | 84.445 | 5.7 |

Earth sits within ~3° of Jupiter's equatorial plane, so the orbits genuinely are edge-on lines from here; the on-sky offset is the simple projection:

$$
x_i(t) = a_i \sin L_i(t) \quad [\text{in Jupiter radii}]
$$

with the phase convention $L = 0°$ at superior conjunction (far side, centered behind the disk). A moon is on the far half when $\cos L_i > 0$, and **occulted** — skipped entirely by the renderer — when additionally $|x_i| < 1\,R_J$ (behind the disk itself). On the near half it is drawn crossing in front, as a transiting moon is.

### 7.2 Structural fidelity — the Laplace resonance falls out

Because the periods are the true values, their *relationships* are automatic. The famous 1:2:4 Laplace resonance of the inner three is reproduced by the catalog constants to numerical dust: with mean motions $n_i = 360°/P_i$,

$$
n_{Io} - 3\,n_{Europa} + 2\,n_{Ganymede} \;=\; 203.489 - 304.124 + 100.635 \;\approx\; 2\times10^{-4}\ °/\text{day}
$$

A student who steps the clock and charts the configuration nightly is doing Galileo's January 1610 experiment — and every property the simulator teaches is faithful: the four periods and their ratios, the relative orbit spacing, the sinusoidal swing between elongations, and disappearances behind the disk.

### 7.3 Screen mapping

The renderer converts orbital offsets to pixels at true angular scale through the active optic:

$$
x_{px} = x_i \cdot \theta_{J}/2 \cdot \frac{W \cdot zoom}{FOV_{true}}
$$

where $\theta_J$ is Jupiter's angular diameter — one Jupiter radius on screen *is* the disk's rendered radius, so moon spacing is honest at every magnification. Moon dots take their radius from the shared stellar magnitude scale (floored for visibility). Critically, the moon line is painted **inside the parallactic-angle transform** (§6): on an Alt-Az mount the disk and its moons field-rotate as one rigid unit, exactly as they do in a real Dobsonian.

### 7.4 Deliberate omissions

The rigorous method (Meeus's full treatment) also corrects the phase for the Earth–Jupiter direction and light-travel time — several degrees of phase, meaning a given night's configuration here won't match an almanac exactly. Orbital inclinations, eccentricities, mutual events, and moon shadows on the disk are likewise omitted. These trades were made knowingly: the simulator teaches *structure and dynamics*, not almanac lookup (§12).

---

## 8. Time-Gentled Drift Mechanics

*Implementation: `getDriftGentledSimTime` in `src/engine/skyGeometry.ts`; anchor management in `useTelescopeStore`; per-mode rates in `simulationModes.ts`.*

### 8.1 The problem: scaling space conflates two motions

The simulator's difficulty modes gentle sky drift for beginners (Fun ×0, Easy ×0.35, Realistic ×1). The original implementation scaled the *rendered offset* — `projectSkyOffsetPx` multiplied the target's angular offset by the drift multiplier. That conflates two very different motions:

- the slow **passive drift** of an untracked sky — the thing Easy mode *should* gentle, and
- the student's own **deliberate slews** — which got scaled too.

The symptoms were exactly what the math predicts: in Fun mode (×0) a locked target sat pinned to the crosshair however far you slewed; in Easy (×0.35) the target visibly lagged the starfield in the finder. Space-scaling breaks the invariant that mount motion maps 1:1 onto the view.

### 8.2 The fix: gentle the clock, not the sky

The rendered offset of the locked target is

$$
\Delta(t) = \text{position}_{target}\big(t'\big) - \text{pointing}(t)
$$

and the gentling moves into the *target's ephemeris clock* $t'$:

$$
t' = t_{anchor} + (t - t_{anchor}) \cdot s
\qquad
s = \begin{cases}
1 & \text{motor on, or Realistic mode}\\
0.35 & \text{Easy, motor off}\\
0 & \text{Fun, motor off}
\end{cases}
$$

Because `pointing` enters the offset **unscaled**, every manual slew pans the target 1:1 against the mount in both feeds, always. Because the *target position* is evaluated at a clock running at rate $s$, the sky's own rotation is slowed to $s$ × true rate for that body. The starfield always runs on the true clock — the honesty anchor of the whole scheme.

When the tracking motor is on, gentling is bypassed ($t' = t$): the motor already cancels drift, and gentling a tracked clock would make the mount appear to drag the view off its own target.

### 8.3 Anchor management — no jumps, ever

The anchor $t_{anchor}$ is re-set at every event that changes the drift-fighting situation:

| Event | Why the anchor moves |
|---|---|
| Target lock (`setTarget`) | Fresh lock starts centered; gentling counts from this exact moment. |
| Motor engage / disengage | Passive drift starts (or stops) *now*; gentle only what accumulates from here. |
| ±1 Hour time steps | Deliberate time jumps must show their full, honest effect — the step lands un-gentled, then gentling resumes from the stepped-to moment. |
| Target release (`clearTarget`) | The freed body switches from the gentled clock to the starfield's true clock; anchoring at release makes $t' = t$ at that instant. |

The continuity argument is one line: at any re-anchor moment, $t' = t_{anchor} + 0 \cdot s = t$ — the gentled and true clocks momentarily coincide, so the body is painted in the same place before and after the switch. Gentling changes only the *derivative* ($dt'/dt = s$), never the position at the switch instant. Bodies therefore never visibly jump when locking, unlocking, or toggling the motor.

### 8.4 The honest tradeoff

Time-gentling is a pedagogy-over-physics compromise, confined and explicit: in Easy mode, a locked target drifts at 35% of the rate of the stars *behind it*. That relative motion is non-physical — but it is limited to the one locked body, it preserves every interactive behavior exactly (slews, finder divergence, tracking), and it is the difference between a 10-year-old completing the tracking lesson and giving up. Realistic mode sets $s = 1$ and the universe is whole again.

---

## 9. Sidereal Tracking & the Mount Model

*Implementation: `useTelescopeStore` (motor state machine), `LiveViewPanel` (smooth follow), `ObservatoryScene` (3D rigs).*

**Engage** — the motor captures the mount's current sky direction in the rotating frame: $(\alpha, \delta) = f^{-1}(a, A, \varphi, LST)$ via the inverse transform (§3.3). It does *not* capture the UI target — it captures where the tube physically points.

**Follow** — each frame, the render loop re-derives pointing from the captured $(\alpha, \delta)$ through the forward transform at the smooth clock. Celestial objects hold still in the eyepiece; anything ground-anchored (the terrestrial practice spire) correctly drifts *out* of a tracking view.

**Manual slew while tracking moves the lock** — `setPointing` under a running motor re-captures $(\alpha, \delta)$ at the new direction rather than fighting the student (without this, the next clock tick would snap the mount back).

**Time steps re-derive pointing** — a ±1 Hour step with the motor on keeps the mount glued to its captured RA/Dec (the sky moved; so does the tube), while with the motor off the mount is inert and the sky abandons it — each behavior falling out of the same two transforms.

In the 3D observatory, the same store pointing drives inverse kinematics per mount type: the Dobsonian rig rotates in altitude/azimuth directly, while the German Equatorial rig converts Alt/Az → (hour angle, declination) (§3.3) to pose its polar and declination axes — the visible, physical reason the two mounts move so differently for the same slew.

---

## 10. Optical Mathematics

*Implementation: `src/engine/opticalMath.ts`*

The optical chain is the standard amateur-astronomy formula set, applied end-to-end:

| Quantity | Formula | Notes |
|---|---|---|
| Magnification | $M = F_{scope} / f_{eyepiece}$ | ×2 with Barlow |
| True field of view | $FOV_{true} = AFOV / M$ | drives all sky projection |
| Exit pupil | $p = D / M$ | |
| Relative brightness | $\min(p, 7)^2$ | eye pupil caps at ~7 mm |
| Aperture brightness | $(D / 130)^2$ | normalized to a 130 mm baseline |
| Limiting magnitude | $7.5 + 5\log_{10}(D / 10\,\text{mm})$ | gates the procedural starfield |
| Dawes resolution | $116'' / D_{mm}$ | rendered as residual blur < 100 mm |

**Absolute angular scaling** is the renderer's foundation: a body's on-screen size is the strict ratio of its angular diameter to the current true field,

$$
\text{size}_{px} = \frac{\theta_{body}}{FOV_{true}} \cdot W
$$

so the Moon (0.51°) nearly fills a 0.55° field while Saturn (0.0125° ring-tip to ring-tip) stays a dot at the same magnification — the single most common beginner misconception, corrected by geometry rather than exhortation. (Floors of a few px keep bodies from vanishing entirely; Saturn's glyph draws rings at 2.2× its body scalar, so the body scalar is divided by 2.2 to make the *ring span* match the true angle.)

The same catalog drives consequences students feel: exit pupils under 0.5 mm dim and float; magnification beyond the seeing-dependent ceiling (300× in perfect seeing down to 50× in poor) triggers "empty magnification" blur; small apertures dim the starfield through the aperture-brightness multiplier and lose faint field stars through the limiting magnitude.

---

## 11. Astrophotography Models

*Implementation: `src/engine/astroMath.ts`*

Two compact models power the astrophotography module:

**Deep-sky stacking SNR** — signal integrates linearly with total exposure while noise adds in quadrature, giving the canonical $\text{SNR} \propto \sqrt{N \cdot t}$ behavior:

$$
\text{SNR} = \frac{S \cdot t \cdot N}{\sqrt{(S\,t + n_{thermal}\,t + n_{read}^2)\,N}}
$$

with thermal noise scaling with gain and read noise falling with gain (modern CMOS behavior) — so students discover that many sub-exposures beat one long one, and that ISO is a tradeoff rather than a volume knob.

**Lucky-imaging sharpness** — a 0–1 composite quality from the frame-cutoff percentage and seeing: keeping only the best frames of a high-speed capture sharpens the stack; lazy cutoffs in bad seeing visibly soften the live composite. The live view renders soft below the sharpness the default settings produce, teaching *why* planetary imagers throw frames away.

---

## 12. Known Simplifications & Validity Domains

Honest engineering means knowing where the model ends. Each simplification below is deliberate, bounded, and invisible within the simulator's teaching envelope:

| Simplification | Consequence | Why acceptable |
|---|---|---|
| Flat Alt/Az projection (no $\cos a$ azimuth scaling, no true tangent plane) | Azimuth spans stretch near the zenith; distortion grows with FOV and altitude | All layers share the mapping, so the sky stays internally rigid; at ≤ 7.5° fields and mid altitudes the error is small |
| Static J2000 catalog RA/Dec for all bodies except the Sun | Planets sit at their catalog snapshot positions; no precession, proper motion, or planetary motion along the ecliptic | The lessons are about *operating a telescope*, not almanac accuracy; the Sun — which drives daylight and safety — is live |
| Galilean phase not corrected for Earth–Jupiter geometry or light time | A given night's moon configuration won't match an almanac (offset by several degrees of phase) | Periods, ratios, spacings, elongations, and occultations — everything the lesson teaches — are exact |
| No atmospheric refraction | Objects near the horizon render at geometric altitude (real refraction lifts them ~0.5° at the horizon) | Below-horizon culling uses a −1° grace band; refraction matters most in the last degree, where nobody observes anyway |
| Circular, coplanar, edge-on Galilean orbits | No mutual events, no inclination wobble | Earth is within ~3° of Jupiter's equatorial plane — edge-on is the truth to first order |
| GMST linear term only | ~0.0003°/decade sidereal error | Orders of magnitude below eyepiece resolution |
| Time-gentled locked-target clock (Easy/Fun) | Locked target drifts slower than the starfield behind it | Explicit pedagogy tradeoff, §8.4; Realistic mode restores full physics |
| Terrestrial targets pinned at fixed Alt/Az | No parallax with observer location | They exist to teach finder alignment against something that *doesn't* move |

---

## 13. Source Map

| File | Role |
|---|---|
| `src/engine/timeEngine.ts` | Continuous anchored simulation clock; sidereal rate constant |
| `src/engine/ephemerisMath.ts` | JD, LST, forward/inverse Alt-Az transforms, solar ephemeris, parallactic angle, Galilean moon ephemeris |
| `src/engine/skyGeometry.ts` | Body ephemeris resolution, pointing-relative offsets, canvas projection, drift-gentled clock |
| `src/engine/skyRenderer.ts` | The universal optical-view renderer: starfield, procedural field stars, constellation lines, sky bodies, culling, inversion, HUD |
| `src/engine/daylight.ts` | Sun-altitude → sky color / darkness / star visibility ramps |
| `src/engine/opticalMath.ts` | Magnification, TFOV, exit pupil, brightness, limiting magnitude, Dawes, angular scaling |
| `src/engine/astroMath.ts` | DSO stacking SNR, lucky-imaging sharpness |
| `src/engine/simulationModes.ts` | The Fun / Easy / Realistic rule table (single source of difficulty truth) |
| `src/engine/starCatalog.ts` | ~150 brightest named stars + constellation line list |
| `src/engine/targetGlyphs.ts` | Procedural canvas art for each body (Moon, Jupiter + moons, Saturn, Sun, M42, spire) |
| `src/store/useTelescopeStore.ts` | Pointing, optics, clock mirror, motor state machine, drift anchor, persistence |
| `src/components/liveview/LiveViewPanel.tsx` | The one shared rAF loop; both optical feeds; mode overlay lenses |
| `src/components/canvas/ObservatoryScene.tsx` | R3F 3D observatory; Dobsonian & GEM inverse kinematics; sky dome |

---

*BRAHMAND Telescope Simulator — physics engine documentation. See [README.md](README.md) for project overview and setup.*
