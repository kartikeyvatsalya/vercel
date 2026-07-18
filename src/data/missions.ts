import type { InstructorEmotion } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// RANK I & II MISSION DEFINITIONS — "Skywatcher" and "Observer"
//
// successCondition contract:
//   Evaluated as: new Function('telescope', 'math', successCondition)
//     telescope → useTelescopeStore.getState()
//     math      → import * as math from '../engine/opticalMath'
//   Must return boolean. Compiled ONCE at mission start, re-run on state change
//   (same call site as evaluateMissionProgress in App.tsx's useEffect).
//
// Design invariants (from the Educational Blueprint):
//   • Rank I checks are FORGIVING (±5 focus units). Capstones tighten (±4).
//   • Controls are only ever referenced AFTER the rank that unlocks them.
//   • Failure is never a dead end: fieldNotePrompt converts abandonment
//     into a Field Logbook entry ("failure is data").
// ─────────────────────────────────────────────────────────────────────────────

export interface RankMission {
  id: string;
  rank: 'I' | 'II';
  title: string;
  description: string;        // Voice: The Senior Observer. Warm, wry, never says "wrong."
  objectives: string[];
  targetId: 'moon' | 'saturn' | 'm42';
  successCondition: string;   // See contract above.
  fieldNotePrompt: string;    // Shown if the student exits without success.
  /** Optional emotional tag for the Instructor voice engine (future use). */
  voiceEmotion?: InstructorEmotion;
}

export const missions: RankMission[] = [

  // ═══════════════════════ RANK I — SKYWATCHER ═══════════════════════

  {
    id: 'rank1_first_light',
    rank: 'I',
    title: 'First Light',
    description:
      `Welcome, friend. Every telescope that has ever existed — from a child's ` +
      `first refractor to the great domes on the mountaintops — has a moment ` +
      `astronomers call "First Light": the very first time it truly sees the sky. ` +
      `Tonight is yours. The Moon is up and waiting. Don't worry about the knobs ` +
      `and numbers yet; there is only one that matters tonight. The focuser is ` +
      `like a water hose nozzle — twist it slowly until the spray becomes a ` +
      `single clean stream. When the Moon snaps from a white blur into mountains ` +
      `and craters... take a breath before you touch anything else. That's an order.`,
    objectives: [
      'Remove the dust cap. (A telescope with its cap on sees only its own dreams.)',
      'Point the telescope at the Moon.',
      'Turn the focuser slowly until the craters become sharp. Overshoot and come back — that is how it is done.',
      'Log what you saw in your Field Logbook. A sketch counts. A single honest sentence counts.',
    ],
    targetId: 'moon',
    successCondition: `
      // Forgiving Rank I tolerance: within ±5 of the dynamic perfect-focus point.
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
      return (
        telescope.activeTarget?.id === 'moon' &&
        telescope.isDustCapOn === false &&
        Math.abs(telescope.focuserPosition - focusTarget) <= 5
      );
    `,
    fieldNotePrompt:
      'No sharp Moon tonight — that happens to every observer alive. Write one line: what did the blur LOOK like? Rings? Fog? That detail is data for next time.',
  },

  {
    id: 'rank1_runaway_moon',
    rank: 'I',
    title: 'The Moon That Would Not Stay',
    description:
      `Something strange happened during your First Light, didn't it? You centred ` +
      `the Moon perfectly... and it crept away like a cat that heard the fridge open. ` +
      `Here is the secret: the Moon isn't running. YOU are — the whole Earth is ` +
      `turning under your feet. Tonight we fight back with geometry. Try this with ` +
      `your own hands first: look at a wall through a paper tube, then through a ` +
      `doorway. The doorway shows you more, yes? A gentler eyepiece gives your ` +
      `telescope a doorway instead of a tube — a wider field of view — so the Moon ` +
      `takes far longer to sneak out of it. Choose your eyepiece like you'd choose ` +
      `where to stand on a railway platform to watch a passing train.`,
    objectives: [
      'Point at the Moon with the dust cap off.',
      'Choose a LONGER focal length eyepiece to keep magnification modest (around 30–55×).',
      'Confirm your true field of view is wide — at least 0.9° of sky, nearly two full Moons across.',
      'Refocus. Every eyepiece change deserves a fresh focus. Build the habit now.',
    ],
    targetId: 'moon',
    successCondition: `
      const APPARENT_FOV = 50; // Standard Plössl, degrees
      const mag = math.getMagnification(
        telescope.activeProfile.focalLengthMm,
        telescope.eyepieceFocalLength,
        telescope.isBarlowActive
      );
      const tfov = math.getTrueFOV(APPARENT_FOV, mag);
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
      return (
        telescope.activeTarget?.id === 'moon' &&
        telescope.isDustCapOn === false &&
        mag >= 30 &&
        tfov >= 0.9 &&                                              // The real lesson: FOV is drift insurance
        Math.abs(telescope.focuserPosition - focusTarget) <= 5
      );
    `,
    fieldNotePrompt:
      'The Moon escaped again? Log which direction it drifted. Observers have used that exact note to find east for four hundred years.',
  },

  {
    id: 'rank1_wandering_star',
    rank: 'I',
    title: 'The Star That Isn\u2019t',
    description:
      `See that bright, steady "star" that doesn't twinkle like the others? The old ` +
      `sky-watchers of every land noticed these wanderers — in Sanskrit they are ` +
      `"graha." The Greeks said "planetes." Same discovery, same sky. Tonight you ` +
      `will settle the matter yourself, with better equipment than any of them had: ` +
      `point at it and add magnification. A true star stays a point of light no ` +
      `matter how hard you push — it is simply too far away. But if that light ` +
      `swells into a tiny disk... with RINGS... then, Observer, you have personally ` +
      `verified that it is a world. One warning: the atmosphere above you is a river ` +
      `of air. Push the magnification too far and you're just enlarging the river's ripples.`,
    objectives: [
      'Point at Saturn. Cap off — yes, I will keep checking.',
      'Use enough magnification to resolve the disk and rings (at least 50×).',
      'Stay UNDER the atmospheric ceiling — if the image starts to boil, ease back.',
      'Focus until the rings separate cleanly from the planet. Then just... look, for a while.',
    ],
    targetId: 'saturn',
    successCondition: `
      const mag = math.getMagnification(
        telescope.activeProfile.focalLengthMm,
        telescope.eyepieceFocalLength,
        telescope.isBarlowActive
      );
      const exitPupil = math.getExitPupil(telescope.activeProfile.apertureMm, mag);
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
      return (
        telescope.activeTarget?.id === 'saturn' &&
        telescope.isDustCapOn === false &&
        mag >= 50 &&
        !math.isAtmosphericLimitExceeded(mag, telescope.seeingQuality) &&
        !math.isExitPupilTooSmall(exitPupil) &&
        Math.abs(telescope.focuserPosition - focusTarget) <= 5
      );
    `,
    fieldNotePrompt:
      'Saturn kept its secrets tonight. Note the seeing conditions in your log — was the image boiling? The river of air runs rough some nights. It is not you.',
  },

  {
    id: 'rank1_capstone_moon_diary',
    rank: 'I',
    title: 'Capstone: The Moon Diary',
    description:
      `Time to graduate, Skywatcher. Anyone can glance at the Moon. An OBSERVER ` +
      `performs a complete, disciplined observation and records it so well that a ` +
      `stranger could repeat it. Tonight, everything you have learned runs as one ` +
      `smooth routine: prepare the instrument properly — cap off, mirror cooled to ` +
      `the night air (a warm mirror wobbles the view like heat shimmer over a ` +
      `summer road) — frame the whole Moon comfortably in your field, and focus ` +
      `like you mean it. Tighter tolerance tonight; you have earned a harder target. ` +
      `Then sketch her in your logbook. Return across several nights and watch her ` +
      `change shape — your diary will hold a rhythm humans have used to mark ` +
      `festivals and harvests for thousands of years. Now it marks your promotion.`,
    objectives: [
      'Prepare the instrument: dust cap off, mirror fully cooled.',
      'Select an eyepiece that frames the ENTIRE Moon with a little sky to spare (40–100×).',
      'Achieve critical focus — the tolerance is tighter tonight. Bracket it: overshoot, return, settle.',
      'Sketch the Moon in your Field Logbook. Label one crater. Any crater. Name it after your grandmother if you like — but note its position honestly.',
      'Repeat on at least 4 more nights to complete the Diary. (The Logbook is watching for the phase sequence.)',
    ],
    targetId: 'moon',
    successCondition: `
      // Per-night instrument check. The multi-night phase-sequence requirement is
      // validated by the Logbook engine (5 'moon' entries spanning >= 5 sim dates),
      // consistent with 'the Logbook levels up, not the player.'
      const APPARENT_FOV = 50;
      const MOON_DIAMETER_DEG = 0.5;
      const mag = math.getMagnification(
        telescope.activeProfile.focalLengthMm,
        telescope.eyepieceFocalLength,
        telescope.isBarlowActive
      );
      const tfov = math.getTrueFOV(APPARENT_FOV, mag);
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
      return (
        telescope.activeTarget?.id === 'moon' &&
        telescope.isDustCapOn === false &&
        telescope.isMirrorCooled === true &&
        mag >= 40 && mag <= 100 &&
        tfov >= MOON_DIAMETER_DEG * 1.3 &&                          // Whole Moon + breathing room
        Math.abs(telescope.focuserPosition - focusTarget) <= 4      // Capstone: tightened from 5 → 4
      );
    `,
    fieldNotePrompt:
      'A Diary with a gap is still a Diary. Log tonight as "clouded out" — every great observatory\u2019s archive is full of pages that say exactly that.',
  },

  // ═══════════════════════ RANK II — OBSERVER ═══════════════════════

  {
    id: 'rank2_bucket_in_rain',
    rank: 'II',
    title: 'A Bucket in the Rain',
    description:
      `Congratulations on the promotion, Observer. Now I can finally show you the ` +
      `faint things. Tonight's target is not a planet — it is a NURSERY, a cloud in ` +
      `Orion where stars are being born right now. But its light arrives as the ` +
      `gentlest drizzle. Think of a bucket in the monsoon rain: a wider bucket ` +
      `catches more rain in the same minute. Your telescope's aperture is exactly ` +
      `that bucket, and its width is the ONE thing no eyepiece, no trick, no amount ` +
      `of wishing can substitute for. Choose a wide instrument, keep the ` +
      `magnification gentle so the light stays concentrated, and let your bucket ` +
      `fill. When the nebula's wings appear out of the darkness, you will ` +
      `understand why astronomers argue about aperture the way farmers argue about rain.`,
    objectives: [
      'Select the Orion Nebula (M42).',
      'Choose a telescope with serious aperture — at least twice the light grasp of the 130mm baseline.',
      'Keep power LOW: a generous exit pupil (3–7mm) pours the faint light into your eye efficiently.',
      'Cap off, mirror cooled, critical focus. Faint light deserves your best habits.',
    ],
    targetId: 'm42',
    successCondition: `
      const mag = math.getMagnification(
        telescope.activeProfile.focalLengthMm,
        telescope.eyepieceFocalLength,
        telescope.isBarlowActive
      );
      const exitPupil = math.getExitPupil(telescope.activeProfile.apertureMm, mag);
      const lightGrasp = math.getApertureBrightnessMultiplier(telescope.activeProfile.apertureMm);
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
      return (
        telescope.activeTarget?.id === 'm42' &&
        telescope.isDustCapOn === false &&
        telescope.isMirrorCooled === true &&
        lightGrasp >= 2.0 &&                                        // The bucket must be wide (≈184mm+)
        exitPupil >= 3.0 && exitPupil <= 7.0 &&                     // Gentle power for faint drizzle
        Math.abs(telescope.focuserPosition - focusTarget) <= 5
      );
    `,
    fieldNotePrompt:
      'The nebula hid tonight. Log your aperture and exit pupil — when you find it later, comparing these numbers will teach you more than success would have.',
  },

  {
    id: 'rank2_paper_tube',
    rank: 'II',
    title: 'The Frame Maker',
    description:
      `You know how you pinch-zoom a photo on a phone? Zoom in and you see less of ` +
      `the scene, but bigger. Every eyepiece in your case is a different amount of ` +
      `pinch — and here is the equation hiding in your fingertips: telescope focal ` +
      `length divided by eyepiece focal length. That's it. That's the whole magic ` +
      `trick. Tonight's craft is FRAMING: choose the one eyepiece that makes the ` +
      `Moon fill your view like a portrait fills a frame — large enough to feel her ` +
      `presence, with just a sliver of black sky around the rim. Too wide and she's ` +
      `a coin on a table. Too tight and you've cropped off her chin. Photographers ` +
      `spend lifetimes on this judgment. You get one evening. I have complete confidence.`,
    objectives: [
      'Point at the Moon, cap off.',
      'Work the equation: pick the eyepiece whose true field is just wider than the Moon herself (0.55°–0.75°).',
      'Stay under the atmospheric ceiling — a perfectly framed boil is still a boil.',
      'Refocus after the eyepiece change. Always.',
    ],
    targetId: 'moon',
    successCondition: `
      const APPARENT_FOV = 50;
      const mag = math.getMagnification(
        telescope.activeProfile.focalLengthMm,
        telescope.eyepieceFocalLength,
        telescope.isBarlowActive
      );
      const tfov = math.getTrueFOV(APPARENT_FOV, mag);
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
      return (
        telescope.activeTarget?.id === 'moon' &&
        telescope.isDustCapOn === false &&
        tfov >= 0.55 && tfov <= 0.75 &&                             // Portrait framing: Moon (0.5°) + thin rim of sky
        !math.isAtmosphericLimitExceeded(mag, telescope.seeingQuality) &&
        Math.abs(telescope.focuserPosition - focusTarget) <= 5
      );
    `,
    fieldNotePrompt:
      'Framing is taste plus arithmetic. Log which eyepieces you tried and what each field felt like — too loose, too tight. That list IS the skill, half-built.',
  },

  {
    id: 'rank2_empty_magnification',
    rank: 'II',
    title: 'The Mush and the Magnifying Glass',
    description:
      `Tonight, Observer, I am going to let you make my favourite mistake. Take the ` +
      `Barlow lens — it doubles your magnification, and it is whispering to you that ` +
      `MORE POWER means MORE SATURN. Go on. Stack it with your shortest eyepiece. ` +
      `Push past every limit. I'll wait... ...See it? A big, dim, trembling mush. ` +
      `Here is why: hold a magnifying glass over a printed photograph and you don't ` +
      `see more of the scene — you see the printing dots. Your aperture captured a ` +
      `fixed amount of true detail, and no lens on Earth can invent more. We call it ` +
      `"empty magnification," and every astronomer who has ever lived has fallen for ` +
      `it exactly once. Now for the real skill: walk the power back DOWN until you ` +
      `find the sweet spot — the highest magnification the sky itself will honour tonight.`,
    objectives: [
      'Point at Saturn and engage the 2× Barlow with your shortest eyepiece. Witness the mush. This step is the curriculum.',
      'Now swap to longer eyepieces (keep the Barlow in) until the image sharpens: high power, but UNDER tonight\u2019s atmospheric ceiling.',
      'Land at 120× or more, with a healthy exit pupil — bright enough to actually see.',
      'Refocus — the Barlow shifts your focus point substantially. Feel where it moved.',
    ],
    targetId: 'saturn',
    successCondition: `
      // Success = the RECOVERY state: Barlow engaged, aggressive-but-honest power.
      // The 'witness the mush' step is telemetry, not a gate — the Diagnostic
      // evidence model logs any isAtmosphericLimitExceeded excursion this session.
      const mag = math.getMagnification(
        telescope.activeProfile.focalLengthMm,
        telescope.eyepieceFocalLength,
        telescope.isBarlowActive
      );
      const exitPupil = math.getExitPupil(telescope.activeProfile.apertureMm, mag);
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);
      return (
        telescope.activeTarget?.id === 'saturn' &&
        telescope.isDustCapOn === false &&
        telescope.isBarlowActive === true &&
        mag >= 120 &&
        !math.isAtmosphericLimitExceeded(mag, telescope.seeingQuality) &&
        !math.isExitPupilTooSmall(exitPupil) &&
        Math.abs(telescope.focuserPosition - focusTarget) <= 5
      );
    `,
    fieldNotePrompt:
      'Couldn\u2019t find the sweet spot? Log the seeing quality and the last magnification you tried. On a 1-out-of-5 night, even I settle for 50×. The sky sets the ceiling; we just find it.',
  },

  {
    id: 'rank2_capstone_right_tool',
    rank: 'II',
    title: 'Capstone: The Right Tool',
    description:
      `Final examination, Observer — though it won't feel like one, because there is ` +
      `no paper and the sky doesn't grade on a curve. Three targets, one night: the ` +
      `Moon, Saturn, and the Orion Nebula. Each demands a DIFFERENT instrument ` +
      `philosophy, and you now own all three: framing for the Moon, disciplined ` +
      `high power for Saturn, and a wide bucket with a gentle exit pupil for the ` +
      `nebula's drizzle. Configure, observe, and — this is the part that makes it ` +
      `mastery — write one sentence in your logbook for each, justifying your choice. ` +
      `Not for me. For the observer you will be in five years, reading back. Prepare ` +
      `the instrument fully each time: cooled, collimated, balanced. Tonight you ` +
      `stop borrowing my judgment and start using your own.`,
    objectives: [
      'Full preparation ritual for each target: cap off, mirror cooled, optics collimated, mount balanced.',
      'MOON — frame her like a portrait (true field 0.55°–0.8°).',
      'SATURN — highest honest power: 120×+, under the atmospheric ceiling, healthy exit pupil.',
      'ORION NEBULA (M42) — big aperture (2× baseline light grasp), exit pupil 3–7mm.',
      'Log all three with a one-sentence justification each. The Logbook completes the mission when all three entries exist.',
    ],
    targetId: 'm42',
    successCondition: `
      // Per-target 'rightness' evaluator. The mission engine must observe this
      // condition returning true once for EACH of the three targets within the
      // mission session (tracked via completedTargetIds on the mission state),
      // then verify three justified logbook entries. This single condition body
      // serves all three checks — the student's configuration judgment IS the exam.
      const APPARENT_FOV = 50;
      const mag = math.getMagnification(
        telescope.activeProfile.focalLengthMm,
        telescope.eyepieceFocalLength,
        telescope.isBarlowActive
      );
      const tfov = math.getTrueFOV(APPARENT_FOV, mag);
      const exitPupil = math.getExitPupil(telescope.activeProfile.apertureMm, mag);
      const lightGrasp = math.getApertureBrightnessMultiplier(telescope.activeProfile.apertureMm);
      const focusTarget = math.getPerfectFocusPoint(telescope.eyepieceFocalLength, telescope.isBarlowActive);

      const prepared =
        telescope.isDustCapOn === false &&
        telescope.isMirrorCooled === true &&
        telescope.isCollimated === true &&
        telescope.isMechanicallyBalanced === true &&
        Math.abs(telescope.focuserPosition - focusTarget) <= 4;     // Capstone tolerance

      if (!prepared) return false;

      switch (telescope.activeTarget?.id) {
        case 'moon':
          return tfov >= 0.55 && tfov <= 0.8;
        case 'saturn':
          return mag >= 120 &&
                 !math.isAtmosphericLimitExceeded(mag, telescope.seeingQuality) &&
                 !math.isExitPupilTooSmall(exitPupil);
        case 'm42':
          return lightGrasp >= 2.0 && exitPupil >= 3.0 && exitPupil <= 7.0;
        default:
          return false;
      }
    `,
    fieldNotePrompt:
      'Two out of three is not failure — it is a map of exactly where to point your practice. Log which target defeated you and your best guess why. That guess is the beginning of Rank III.',
  },
];
