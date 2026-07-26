import React, { useEffect, useState } from 'react';
import { Lock, RotateCcw, Shuffle, Star, Minus, Plus } from 'lucide-react';
import { useShallow } from '../../store/useShallowSelector';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { useCollimationStore, type MirrorId } from '../../store/useCollimationStore';
import {
  classifyCollimation,
  collimationToleranceArcmin,
  computeCollimationField,
  isSecondaryResolved,
  screwAngleRad,
  SCREW_DETENT_TURNS,
  type CollimationGrade,
} from '../../engine/collimation';
import { MIN_STAR_TEST_RADIUS_PX } from '../../engine/starTest';
import { STAR_BY_NAME } from '../../engine/starCatalog';
import { convertEquatorialToHorizontal } from '../../engine/ephemerisMath';
import { useTranslation, type TranslationKey } from '../../engine/i18n';
import { InfoTip } from '../ui/InfoTip';
import type { MirrorCell } from '../../types';

/**
 * CollimationPanel — Phase 57
 * ─────────────────────────────────────────────────────────────────
 * The bench half of the collimation mode: six screws, and an honest readout
 * of what they have done to the light. The eyepiece half (the defocused
 * donut with its decentred shadow) is drawn by the main feed itself, so the
 * student works exactly the way a real observer does — one hand on a screw,
 * one eye on the star, nothing in between.
 *
 * Two deliberate teaching decisions live here:
 *
 *  • The Primary tab is LOCKED until the secondary is square. Newtonian
 *    collimation is strictly ordered in the field, and a student who chases
 *    the primary through a crooked diagonal will find a false alignment that
 *    falls apart the moment anything moves (see collimation.isSecondaryResolved).
 *
 *  • What the panel tells you depends on the simulation mode. Realistic gets
 *    a three-state chip and nothing else — the same information a real
 *    observer has, which is "does the star look right yet." Easy gets a
 *    virtual Cheshire: a bullseye showing exactly which way the axis is off,
 *    the way the eyepiece-shaped tool in every collimation kit does.
 */

const PAD_SIZE_PX = 208;
const SCREW_CIRCLE_PX = 66;

/** Grade → chip styling. Deliberately traffic-light, read at a glance mid-adjustment. */
const GRADE_STYLE: Record<CollimationGrade, string> = {
  'diffraction-limited': 'bg-emerald-900/60 border-emerald-500 text-emerald-300',
  close: 'bg-amber-900/60 border-amber-500 text-amber-300',
  out: 'bg-red-900/60 border-red-500 text-red-300',
};

const GRADE_LABEL_KEYS: Record<CollimationGrade, TranslationKey> = {
  'diffraction-limited': 'collimation.diffractionLimited',
  close: 'collimation.close',
  out: 'collimation.out',
};

/**
 * How far off-centre the Cheshire's ring can swim before it pins to the edge:
 * eight tolerances of error fills the bullseye. Generous on purpose — the
 * widget must still move visibly when the student is already close, which is
 * exactly when they most need the feedback.
 */
const CHESHIRE_FULL_SCALE_TOLERANCES = 8;
const CHESHIRE_RADIUS_PX = 30;

/**
 * Virtual Cheshire eyepiece — the training-wheels readout. A real Cheshire
 * shows the reflected image of an illuminated ring against a crosshair; the
 * mirrors are square when the two are concentric. Same idea, driven straight
 * off the computed beam error rather than a simulated reflection.
 */
const CheshireBullseye: React.FC<{ errorArcmin: number; angleRad: number; toleranceArcmin: number; inTolerance: boolean }> = ({
  errorArcmin, angleRad, toleranceArcmin, inTolerance,
}) => {
  const fullScale = Math.max(1e-6, toleranceArcmin * CHESHIRE_FULL_SCALE_TOLERANCES);
  const displacement = Math.min(1, errorArcmin / fullScale) * CHESHIRE_RADIUS_PX;
  // Screen-space: canvas y grows downward, the error vector's does not.
  const ringX = 40 + Math.cos(angleRad) * displacement;
  const ringY = 40 - Math.sin(angleRad) * displacement;
  const ringColor = inTolerance ? '#34d399' : '#fbbf24';

  return (
    <svg width={80} height={80} viewBox="0 0 80 80" aria-hidden="true">
      <circle cx={40} cy={40} r={34} fill="rgba(2,6,23,0.85)" stroke="rgba(148,163,184,0.35)" strokeWidth={1} />
      {/* Tolerance target: land the ring inside this and the scope is done. */}
      <circle
        cx={40}
        cy={40}
        r={CHESHIRE_RADIUS_PX / CHESHIRE_FULL_SCALE_TOLERANCES}
        fill="none"
        stroke="rgba(52,211,153,0.55)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <line x1={40} y1={8} x2={40} y2={72} stroke="rgba(148,163,184,0.5)" strokeWidth={0.75} />
      <line x1={8} y1={40} x2={72} y2={40} stroke="rgba(148,163,184,0.5)" strokeWidth={0.75} />
      {/* The reflected ring itself. */}
      <circle cx={ringX} cy={ringY} r={9} fill="none" stroke={ringColor} strokeWidth={2} />
      <circle cx={ringX} cy={ringY} r={1.6} fill={ringColor} />
    </svg>
  );
};

/** One screw: its current position in turns, and a click each way. */
const ScrewControl: React.FC<{
  label: string;
  turns: number;
  onTurn: (detents: number) => void;
}> = ({ label, turns, onTurn }) => (
  <div className="flex flex-col items-center gap-0.5">
    <span className="text-[8px] font-mono uppercase tracking-widest text-slate-500">{label}</span>
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => onTurn(-1)}
        className="p-1 bg-slate-700 hover:bg-slate-600 active:bg-cyan-700 rounded text-white disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label={`Back ${label} out by one detent`}
      >
        <Minus className="w-3 h-3" />
      </button>
      <button
        onClick={() => onTurn(1)}
        className="p-1 bg-slate-700 hover:bg-slate-600 active:bg-cyan-700 rounded text-white disabled:opacity-30 disabled:cursor-not-allowed"
        aria-label={`Drive ${label} in by one detent`}
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
    {/* Detents, not turns: 1/24 of a turn is the unit the hand actually feels. */}
    <span className={`text-[9px] font-mono tabular-nums ${Math.abs(turns) < 1e-9 ? 'text-slate-500' : 'text-cyan-300'}`}>
      {turns >= 0 ? '+' : '−'}{Math.abs(Math.round(turns / SCREW_DETENT_TURNS))}
    </span>
  </div>
);

interface CollimationPanelProps {
  /**
   * Radius the defocused donut currently renders at in the main feed, px.
   * Supplied by LiveViewPanel (which owns the canvas size and true field)
   * so the bench can tell a student the one thing the screws can't fix:
   * that there is nothing to read yet, because the star is still a point.
   */
  starTestRadiusPx: number;
}

export const CollimationPanel: React.FC<CollimationPanelProps> = ({ starTestRadiusPx }) => {
  const { t } = useTranslation();
  const [activeMirror, setActiveMirror] = useState<MirrorId>('secondary');

  const telescope = useTelescopeStore(useShallow((state) => ({
    activeProfile: state.activeProfile,
    simulationMode: state.simulationMode,
    observerLocation: state.observerLocation,
    simTime: state.simTime,
    setPointing: state.setPointing,
    clearTarget: state.clearTarget,
  })));
  const collimation = useCollimationStore(useShallow((state) => ({
    primaryScrews: state.primaryScrews,
    secondaryScrews: state.secondaryScrews,
    turnScrew: state.turnScrew,
    resetMirror: state.resetMirror,
    scramble: state.scramble,
  })));

  // Swapping telescopes re-scores the SAME screw positions: a different cell
  // geometry and a different focal ratio mean a different tolerance, so a
  // set of screws that condemned the Dob may be fine on the SCT (and a
  // refractor has no cells at all). Republish the verdict on every change of
  // instrument, since nothing else will until the next screw click.
  const profileId = telescope.activeProfile?.id;
  useEffect(() => {
    useCollimationStore.getState().syncCollimationStatus();
  }, [profileId]);

  const profile = telescope.activeProfile;
  const spec = profile?.collimation;
  const field = computeCollimationField(collimation.primaryScrews, collimation.secondaryScrews, spec);
  const toleranceArcmin = profile ? collimationToleranceArcmin(profile) : Infinity;
  const grade = classifyCollimation(field.errorArcmin, toleranceArcmin);
  const secondaryResolved = !spec?.secondary || isSecondaryResolved(field.secondaryArcmin, toleranceArcmin);

  // Fun mode gets the same guided readout as Easy — it is the mode for
  // students who want to see the idea work, not to be graded on it.
  const isRealistic = telescope.simulationMode === 'realistic';

  // A crooked secondary vignettes the light cone the primary works through,
  // so the primary tab stays shut until the diagonal is square (real
  // procedure, not an artificial gate — see the header comment).
  const primaryLocked = !!spec?.primary && !secondaryResolved;
  const effectiveMirror: MirrorId = activeMirror === 'primary' && primaryLocked ? 'secondary' : activeMirror;
  const cell: MirrorCell | undefined = effectiveMirror === 'primary' ? spec?.primary : spec?.secondary;
  const screws = effectiveMirror === 'primary' ? collimation.primaryScrews : collimation.secondaryScrews;

  /**
   * Polaris is the classical star-test target for a reason worth teaching:
   * at Dec +89° it barely moves, so an undriven mount holds it in the field
   * for as long as the adjustment takes. Drops the target lock first — this
   * is a bare pointing, not an observation of a catalogued body.
   */
  const slewToPolaris = () => {
    const polaris = STAR_BY_NAME.get('Polaris');
    if (!polaris) return;
    const pos = convertEquatorialToHorizontal(
      polaris.ra, polaris.dec,
      telescope.observerLocation.latitude, telescope.observerLocation.longitude,
      new Date(telescope.simTime)
    );
    telescope.clearTarget();
    telescope.setPointing(pos.altitude, pos.azimuth);
  };

  if (!spec?.primary && !spec?.secondary) {
    return (
      <div className="mt-14 flex flex-col items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-xl p-4 w-full max-w-sm">
        <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400">{t('collimation.title')}</span>
        <p className="text-xs text-slate-400 text-center leading-relaxed">{t('collimation.notAdjustable')}</p>
      </div>
    );
  }

  return (
    <div className="mt-14 flex flex-col items-center gap-3 bg-slate-800/80 border border-slate-700 rounded-xl p-3 w-full max-w-sm">
      {/* ── Cell tabs ── */}
      <div className="flex gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-700 w-full">
        <button
          onClick={() => setActiveMirror('secondary')}
          disabled={!spec?.secondary}
          className={`flex-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            effectiveMirror === 'secondary' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          {t('collimation.secondary')}
        </button>
        <button
          onClick={() => setActiveMirror('primary')}
          disabled={!spec?.primary || primaryLocked}
          title={primaryLocked ? t('collimation.primaryLocked') : undefined}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
            effectiveMirror === 'primary' ? 'bg-cyan-600 text-white shadow' : 'text-slate-400 hover:text-white'
          }`}
        >
          {primaryLocked && <Lock className="w-3 h-3" />}
          {t('collimation.primary')}
        </button>
      </div>

      {primaryLocked && (
        <p className="text-[10px] text-amber-300/90 text-center leading-relaxed">{t('collimation.primaryLocked')}</p>
      )}

      {/* ── The screw pad ── three controls at the cell's true 120° spacing,
          laid out from the SAME screwAngleRad the physics uses, so the button
          the student presses is geometrically the screw the math turns. */}
      <div className="relative" style={{ width: PAD_SIZE_PX, height: PAD_SIZE_PX }}>
        <div className="absolute inset-6 rounded-full border border-dashed border-slate-700" />
        <div className="absolute inset-0 flex items-center justify-center">
          {isRealistic ? (
            <div className={`px-2.5 py-1.5 rounded-lg border text-[9px] font-bold uppercase tracking-widest text-center ${GRADE_STYLE[grade]}`}>
              {t(GRADE_LABEL_KEYS[grade])}
            </div>
          ) : (
            <CheshireBullseye
              errorArcmin={field.errorArcmin}
              angleRad={field.angleRad}
              toleranceArcmin={toleranceArcmin}
              inTolerance={grade === 'diffraction-limited'}
            />
          )}
        </div>

        {cell && [0, 1, 2].map((i) => {
          const angle = screwAngleRad(cell, i);
          const left = PAD_SIZE_PX / 2 + Math.cos(angle) * SCREW_CIRCLE_PX;
          const top = PAD_SIZE_PX / 2 - Math.sin(angle) * SCREW_CIRCLE_PX;
          return (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left, top }}
            >
              <ScrewControl
                label={t('collimation.screw', { n: i + 1 })}
                turns={screws[i]}
                onTurn={(detents) => collimation.turnScrew(effectiveMirror, i, detents)}
              />
            </div>
          );
        })}
      </div>

      {/* ── Numeric readout ── Realistic hides the error itself (a real
          observer has no arcmin display at the eyepiece) but always shows the
          focus shift, which is a mechanical fact you can feel on the knob. */}
      <div className="flex items-center gap-3 text-[10px] font-mono">
        {!isRealistic && (
          <InfoTip tip={t('tip.collimationError')}>
            <span className="text-slate-400">
              {t('collimation.fieldError')}{' '}
              <span className={grade === 'diffraction-limited' ? 'text-emerald-400' : grade === 'close' ? 'text-amber-400' : 'text-red-400'}>
                {field.errorArcmin.toFixed(1)}′
              </span>
            </span>
          </InfoTip>
        )}
        <span className="text-slate-400">
          {t('collimation.focusShift')}{' '}
          <span className={Math.abs(field.pistonMm) < 0.05 ? 'text-slate-500' : 'text-cyan-300'}>
            {field.pistonMm >= 0 ? '+' : '−'}{Math.abs(field.pistonMm).toFixed(2)}mm
          </span>
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={slewToPolaris}
          className="flex items-center gap-1 px-2 py-1 bg-indigo-700 hover:bg-indigo-600 rounded text-white text-[10px] font-bold uppercase tracking-wide"
        >
          <Star className="w-3 h-3" /> {t('collimation.slewPolaris')}
        </button>
        <button
          onClick={() => collimation.resetMirror(effectiveMirror)}
          className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-white text-[10px] font-bold uppercase tracking-wide"
        >
          <RotateCcw className="w-3 h-3" /> {t('collimation.reset')}
        </button>
        <button
          onClick={() => collimation.scramble(effectiveMirror)}
          className="flex items-center gap-1 px-2 py-1 bg-amber-700 hover:bg-amber-600 rounded text-white text-[10px] font-bold uppercase tracking-wide"
        >
          <Shuffle className="w-3 h-3" /> {t('liveview.scramble')}
        </button>
      </div>

      {/* Coaching, in priority order: you can't read a donut you haven't
          opened yet, so that instruction outranks everything else. */}
      <p className="text-[10px] text-slate-400 text-center leading-relaxed">
        {starTestRadiusPx < MIN_STAR_TEST_RADIUS_PX
          ? t('collimation.openDonutHint')
          : isRealistic ? t('collimation.starTestHint') : t('collimation.cheshireHint')}
      </p>
    </div>
  );
};
