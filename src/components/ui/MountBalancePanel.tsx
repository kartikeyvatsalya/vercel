import React, { useMemo } from 'react';
import { Scale, Minus, Plus, Crosshair } from 'lucide-react';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { useMechanicsStore, getMechanicsReadout } from '../../store/useMechanicsStore';
import { useTranslation, type TranslationKey } from '../../engine/i18n';
import { InfoTip } from './InfoTip';
import type { BalanceVerdict } from '../../engine/mechanics';

/**
 * MountBalancePanel — Phase 58
 * ─────────────────────────────────────────────────────────────────
 * The counterweight bench. One slider, one number, and the 3D weight on the
 * shaft moving with it — because the whole lesson is that balance is a LEVER,
 * not a switch: the same weight balances one telescope and wrecks another,
 * and the only thing you get to change is where it sits.
 *
 * The torque readout is deliberately signed and named ("+2.4 N·m · Nose
 * heavy") rather than reduced to a pass/fail light. The two failure modes
 * look different at the eyepiece — a nose-heavy tube sinks, a
 * counterweight-heavy one climbs — and an observer who can read the sign off
 * the drift knows which way to slide the weight without touching a slider.
 */

/** One click of the ◀ ▶ nudges, as a fraction of the shaft's travel. */
const NUDGE_STEP = 0.01;
/** Slider granularity — ~1.2mm on the shaft, finer than the balance tolerance. */
const SLIDER_STEP = 0.005;

const VERDICT_STYLE: Record<BalanceVerdict, string> = {
  balanced: 'text-emerald-400',
  'nose-heavy': 'text-amber-400',
  'counterweight-heavy': 'text-amber-400',
};

const VERDICT_LABEL_KEYS: Record<BalanceVerdict, TranslationKey> = {
  balanced: 'balance.balanced',
  'nose-heavy': 'balance.noseHeavy',
  'counterweight-heavy': 'balance.counterweightHeavy',
};

export const MountBalancePanel: React.FC = () => {
  const { t } = useTranslation();
  const counterweightPosition = useMechanicsStore((s) => s.counterweightPosition);
  const setCounterweightPosition = useMechanicsStore((s) => s.setCounterweightPosition);
  const nudgeCounterweight = useMechanicsStore((s) => s.nudgeCounterweight);
  const autoBalance = useMechanicsStore((s) => s.autoBalance);
  // getMechanicsReadout is a plain derivation off both stores (see
  // useMechanicsStore) and subscribes to nothing itself, so the two things it
  // actually depends on have to be subscribed here: where the weight sits, and
  // which telescope is hanging off the other end of the axis.
  const activeProfile = useTelescopeStore((s) => s.activeProfile);
  const readout = useMemo(getMechanicsReadout, [counterweightPosition, activeProfile]);

  return (
    <div className="mt-3 pt-3 border-t border-slate-800 flex flex-col gap-1.5">
      <InfoTip tip={t('tip.raTorque')} position="bottom">
        <span className="text-slate-500 uppercase text-[9px] flex items-center gap-1">
          <Scale className="w-2.5 h-2.5" /> {t('balance.heading')}
        </span>
      </InfoTip>

      {!readout.hasCounterweight ? (
        <p className="text-[9px] text-slate-500 leading-relaxed">{t('balance.noShaft')}</p>
      ) : (
        <>
          <div className="flex flex-col">
            <span className="text-slate-500 uppercase text-[9px]">{t('balance.raTorque')}</span>
            <span className={`font-mono ${VERDICT_STYLE[readout.verdict]}`}>
              {readout.netTorqueNm >= 0 ? '+' : '−'}{Math.abs(readout.netTorqueNm).toFixed(1)} N·m
              {' · '}
              {t(VERDICT_LABEL_KEYS[readout.verdict])}
            </span>
          </div>

          {/* The lever itself, in the plainest possible terms: two masses, two
              distances. This is the equation the slider is solving. */}
          <p className="text-[9px] font-mono text-slate-500 leading-relaxed">
            {t('balance.otaLine', {
              mass: readout.otaMassKg.toFixed(1),
              arm: readout.otaLeverArmM.toFixed(2),
            })}
            <br />
            {t('balance.cwLine', {
              mass: readout.counterweightMassKg.toFixed(1),
              arm: readout.counterweightLeverArmM.toFixed(2),
            })}
          </p>

          <div className="relative w-full">
            {/* Where the weight WOULD balance — the same green target marker
                idiom the focuser bar uses for perfect focus. */}
            <div
              className="absolute top-1/2 w-1 h-3 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] rounded-full pointer-events-none z-10"
              style={{ left: `${readout.balancePosition * 100}%`, transform: 'translate(-50%, -50%)' }}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={SLIDER_STEP}
              value={counterweightPosition}
              onChange={(e) => setCounterweightPosition(Number(e.target.value))}
              aria-label="Counterweight position along the shaft"
              className="w-full accent-cyan-500 relative"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => nudgeCounterweight(-NUDGE_STEP)}
              title={t('balance.slideIn')}
              aria-label={t('balance.slideIn')}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-slate-200"
            >
              <Minus className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={() => nudgeCounterweight(NUDGE_STEP)}
              title={t('balance.slideOut')}
              aria-label={t('balance.slideOut')}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-slate-200"
            >
              <Plus className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={() => autoBalance()}
              className="ml-auto flex items-center gap-1 px-1.5 py-0.5 bg-emerald-900/60 hover:bg-emerald-800/70 border border-emerald-600 rounded text-emerald-200 text-[9px] font-bold uppercase tracking-widest"
            >
              <Crosshair className="w-2.5 h-2.5" /> {t('balance.autoBalance')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
