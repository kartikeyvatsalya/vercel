import React from 'react';
import { useTelescopeStore, TERRESTRIAL_POINTING } from '../../store/useTelescopeStore';
import { useMissionStore } from '../../engine/missionEngine';
import { missions as RANK_MISSIONS } from '../../data/missions';
import { getMagnification, getTrueFOV, getExitPupil, getRelativeBrightness, getPerfectFocusPoint } from '../../engine/opticalMath';
import { convertEquatorialToHorizontal } from '../../engine/ephemerisMath';
import { SIM_MODE_RULES } from '../../engine/simulationModes';
import { CITIES } from '../../engine/constants';
import { useTranslation } from '../../engine/i18n';
import { InfoTip } from '../ui/InfoTip';
import { GraduationCap, Clock, Play, Pause, Moon, Sun, Crosshair } from 'lucide-react';

const TIME_RATES = [1, 10, 60];

interface TelemetryPanelProps {
  /** Renders with a translucent, blurred backdrop so a 3D scene can show through behind it. */
  translucent?: boolean;
  /** Called after a ±1 Hour step so the host can show cause-and-effect feedback. */
  onTimeStep?: (hours: number) => void;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({ translucent = false, onTimeStep }) => {
  const {
    activeProfile, activeTarget, eyepieceFocalLength, focuserPosition, isBarlowActive,
    observerLocation, simTime, timeRate, isTrackingMotorOn, simulationMode, isVirtualNight,
    stepSimTimeHours, resetSimTimeToNow, setTimeRate, toggleTrackingMotor, toggleVirtualNight, setObserverLocation,
    setTarget,
  } = useTelescopeStore();
  const modeRules = SIM_MODE_RULES[simulationMode];

  // Which catalog city (if any) matches the store's current observerLocation
  // (Phase 40) — the store itself only holds coordinates, not a place name,
  // so the dropdown's selected option is derived by matching against CITIES.
  const activeCity = CITIES.find(
    (c) => c.latitude === observerLocation.latitude && c.longitude === observerLocation.longitude
  );

  // Live altitude of the active target — surfaces below-horizon states (Phase 26 fix 4c)
  const activeTargetAlt = activeTarget
    ? activeTarget.type === 'terrestrial'
      ? TERRESTRIAL_POINTING.alt
      : activeTarget.ra !== undefined && activeTarget.dec !== undefined
        ? convertEquatorialToHorizontal(
            activeTarget.ra, activeTarget.dec,
            observerLocation.latitude, observerLocation.longitude,
            new Date(simTime)
          ).altitude
        : null
    : null;

  const handleStep = (hours: number) => {
    stepSimTimeHours(hours);
    onTimeStep?.(hours);
  };
  const missionState = useMissionStore();
  const { t } = useTranslation();

  if (!activeProfile) return null;

  const magnification = getMagnification(activeProfile.focalLength, eyepieceFocalLength);
  const exitPupil = getExitPupil(activeProfile.aperture, magnification);
  // Assuming a generic Plössl apparent FOV of 50 degrees for the sake of calculation
  const trueFOV = getTrueFOV(50, magnification);
  const brightness = getRelativeBrightness(exitPupil);
  const brightnessPercent = Math.round((brightness / 49.0) * 100); // normalized against a 7mm pupil max (7^2 = 49)

  // ── Rank Curriculum status readout ──
  const activeRankMission = RANK_MISSIONS.find(m => m.id === missionState.activeRankMissionId) || null;
  const focusTarget = getPerfectFocusPoint(eyepieceFocalLength, isBarlowActive);
  const focusDelta = Math.abs(focuserPosition - focusTarget);
  const onTarget = activeRankMission ? activeTarget?.id === activeRankMission.targetId : false;

  return (
    <div className={`border border-slate-700 rounded-lg p-4 text-xs font-mono text-cyan-400 w-full shadow-lg shadow-black/50 transition-colors duration-300 ${
      translucent ? 'bg-slate-900/50 backdrop-blur-md' : 'bg-slate-900'
    }`}>
      <h3 className="text-slate-300 font-bold mb-2 uppercase tracking-wider text-[10px]">{t('telemetry.heading')}</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!activeTarget}
          onClick={() => activeTarget && setTarget(activeTarget.id)}
          title={activeTarget ? t('tip.recenterTarget') : undefined}
          aria-label={activeTarget ? t('tip.recenterTarget') : undefined}
          className={`group flex flex-col items-start text-left rounded px-1 py-0.5 -mx-1 -my-0.5 transition-colors ${
            activeTarget ? 'hover:bg-slate-800/80 cursor-pointer' : 'cursor-default'
          }`}
        >
          <span className="text-slate-500 uppercase text-[9px] flex items-center gap-1">
            {t('common.target')}
            {activeTarget && (
              // Always visible (Phase 42): the hover-only affordance was
              // undiscoverable for beginners and invisible on touchscreens.
              <Crosshair className="w-2.5 h-2.5 text-cyan-400 group-hover:text-cyan-300 transition-colors" />
            )}
          </span>
          {/* Own line, full cell width (Phase 42.5) — sitting inline next to
              the RE-CENTER pill squeezed the name's available width and
              truncated ordinary names like "The Moon" mid-word. */}
          <span className={`w-full truncate ${activeTarget ? 'text-white group-hover:text-cyan-300 transition-colors' : 'text-amber-400'}`}>
            {activeTarget?.name ?? t('common.manualSlew')}
          </span>
          {activeTarget && (
            // Persistent text label, own line below the name (Phase 42.5) —
            // tight/small so it reads as a tag, not a second readout.
            <span className="mt-0.5 w-fit px-1 py-px rounded bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 text-[7px] font-bold uppercase tracking-wider leading-none flex items-center gap-0.5">
              <Crosshair className="w-2 h-2" />
              {t('telemetry.recenter')}
            </span>
          )}
          {activeTargetAlt !== null && (
            <span className={`text-[9px] font-mono ${activeTargetAlt < 0 ? 'text-amber-400 font-bold' : 'text-slate-500'}`}>
              {activeTargetAlt.toFixed(0)}°{activeTargetAlt < 0 ? ` · ${t('common.belowHorizon')}` : ` ${t('common.altitude')}`}
            </span>
          )}
        </button>
        <div className="flex flex-col">
          <span className="text-slate-500 uppercase text-[9px]">{t('telemetry.telescope')}</span>
          <span className="text-white truncate">{activeProfile.name}</span>
        </div>
        <div className="flex flex-col">
          <InfoTip tip={t('tip.magnification')}><span className="text-slate-500 uppercase text-[9px]">{t('telemetry.magnification')}</span></InfoTip>
          <span>{Math.round(magnification)}X</span>
        </div>
        <div className="flex flex-col">
          <InfoTip tip={t('tip.trueFov')}><span className="text-slate-500 uppercase text-[9px]">{t('telemetry.trueFov')}</span></InfoTip>
          <span>{trueFOV.toFixed(2)}°</span>
        </div>
        <div className="flex flex-col">
          <InfoTip tip={t('tip.exitPupil')}><span className="text-slate-500 uppercase text-[9px]">{t('telemetry.exitPupil')}</span></InfoTip>
          <span>{exitPupil.toFixed(1)} mm</span>
        </div>
        <div className="flex flex-col">
          <InfoTip tip={t('tip.brightness')}><span className="text-slate-500 uppercase text-[9px]">{t('telemetry.brightness')}</span></InfoTip>
          <span>{brightnessPercent}%</span>
        </div>
      </div>

      {/* ── Environment: observing site + simulation clock (Phase 25) ── */}
      <div data-tour-id="tour-time" className="mt-3 pt-3 border-t border-slate-800 flex flex-col gap-1.5">
        <InfoTip tip={t('tip.environment')} position="bottom"><span className="text-slate-500 uppercase text-[9px] flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {t('telemetry.environment')}
        </span></InfoTip>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-slate-500 uppercase text-[9px] shrink-0">{t('telemetry.location')}</span>
          <select
            value={activeCity?.id ?? ''}
            onChange={(e) => {
              const city = CITIES.find((c) => c.id === e.target.value);
              if (city) setObserverLocation({ latitude: city.latitude, longitude: city.longitude });
            }}
            aria-label="Observing location"
            className="bg-slate-800/80 border border-slate-700 rounded px-1.5 py-0.5 text-slate-200 text-[10px] font-mono cursor-pointer hover:bg-slate-700/80 focus:outline-none focus:ring-1 focus:ring-cyan-500/70 transition-colors"
          >
            {!activeCity && <option value="" disabled>Custom Location</option>}
            {CITIES.map((city) => (
              <option key={city.id} value={city.id}>{city.name}</option>
            ))}
          </select>
          <span className="text-slate-400 text-[9px] font-mono leading-tight">
            ({Math.abs(observerLocation.latitude).toFixed(2)}°{observerLocation.latitude >= 0 ? 'N' : 'S'}, {Math.abs(observerLocation.longitude).toFixed(2)}°{observerLocation.longitude >= 0 ? 'E' : 'W'})
          </span>
        </div>
        <span className="text-white text-[11px]">
          {new Date(simTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
          {' · '}
          {new Date(simTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
        </span>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => handleStep(-1)}
            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-slate-200 text-[9px] font-bold uppercase"
          >
            {t('telemetry.minusHour')}
          </button>
          <button
            onClick={() => handleStep(1)}
            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-slate-200 text-[9px] font-bold uppercase"
          >
            {t('telemetry.plusHour')}
          </button>
          {/* Present Time (Phase 39) — snap the clock back to the real "now." */}
          <button
            onClick={() => resetSimTimeToNow()}
            className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-slate-200 text-[9px] font-bold uppercase"
          >
            {t('telemetry.now')}
          </button>
          {/* Pause/Play (Phase 41) — a hard freeze (timeRate 0), distinct from
              the ×N speed cycle below: pausing stops the sky outright rather
              than just slowing it to 1×. */}
          <button
            onClick={() => setTimeRate(timeRate === 0 ? 1 : 0)}
            title={t('tip.pausePlay')}
            className={`px-1.5 py-0.5 border rounded text-[9px] font-bold uppercase flex items-center gap-0.5 ${
              timeRate === 0
                ? 'bg-amber-900/60 border-amber-500 text-amber-300'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
            }`}
          >
            {timeRate === 0 ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
            {timeRate === 0 ? t('telemetry.play') : t('telemetry.pause')}
          </button>
          <button
            onClick={() => setTimeRate(TIME_RATES[(TIME_RATES.indexOf(timeRate) + 1) % TIME_RATES.length])}
            title={t('tip.timeRate')}
            className={`px-1.5 py-0.5 border rounded text-[9px] font-bold uppercase flex items-center gap-0.5 ${
              timeRate > 1
                ? 'bg-indigo-900/60 border-indigo-500 text-indigo-200'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-200'
            }`}
          >
            <Play className="w-2.5 h-2.5" /> {timeRate}×
          </button>
          <button
            data-tour-id="tour-motor"
            onClick={() => toggleTrackingMotor()}
            title={t('tip.siderealMotor')}
            className={`px-1.5 py-0.5 border rounded text-[9px] font-bold uppercase ${
              isTrackingMotorOn
                ? 'bg-emerald-900/60 border-emerald-500 text-emerald-300'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-400'
            }`}
          >
            {t('telemetry.motor')} {isTrackingMotorOn ? t('common.on') : t('common.off')}
          </button>
          {/* ── Virtual Night (Phase 29) — forces a dark sky render so
              daytime students can still see stars. Visual-only override. */}
          <button
            onClick={() => toggleVirtualNight()}
            title={t('tip.virtualNight')}
            aria-pressed={isVirtualNight}
            className={`px-1.5 py-0.5 border rounded text-[9px] font-bold uppercase flex items-center gap-1 ${
              isVirtualNight
                ? 'bg-indigo-900/70 border-indigo-400 text-indigo-200 shadow-[0_0_8px_rgba(129,140,248,0.35)]'
                : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-slate-400'
            }`}
          >
            {isVirtualNight ? <Moon className="w-2.5 h-2.5" /> : <Sun className="w-2.5 h-2.5" />}
            {t('telemetry.virtualNight')}
          </button>
        </div>
      </div>

      {/* Rank Curriculum status readout */}
      {activeRankMission && (
        <div className="mt-3 pt-3 border-t border-slate-800">
          <div className="flex items-center gap-1.5 mb-2">
            <GraduationCap className="w-3 h-3 text-amber-400" />
            <span className="text-amber-400 uppercase text-[9px] font-bold tracking-widest truncate">
              {activeRankMission.title}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col">
              <span className="text-slate-500 uppercase text-[9px]">{t('telemetry.onTarget')}</span>
              <span className={onTarget ? 'text-emerald-400' : 'text-red-400'}>
                {onTarget ? t('telemetry.yesWithId', { id: activeRankMission.targetId }) : t('telemetry.noNeedId', { id: activeRankMission.targetId })}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-slate-500 uppercase text-[9px]">{t('telemetry.focusDelta')}</span>
              <span className={focusDelta <= modeRules.focusToleranceUnits ? 'text-emerald-400' : 'text-amber-400'}>
                {focusDelta.toFixed(1)} {t('telemetry.units')}
              </span>
            </div>
          </div>
          {missionState.activeRankMissionId === 'rank2_capstone_right_tool' && (
            <div className="mt-2 flex flex-col">
              <span className="text-slate-500 uppercase text-[9px]">{t('telemetry.capstoneTargets')}</span>
              <span className="text-indigo-300">{t('telemetry.configuredCount', { n: missionState.completedTargetIds.length })}</span>
            </div>
          )}
          {missionState.rankMissionStatus === 'success' && (
            <p className="mt-2 text-emerald-400 font-bold uppercase text-[10px] tracking-widest">{t('telemetry.missionComplete')}</p>
          )}
        </div>
      )}
    </div>
  );
};
