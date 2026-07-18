import React, { useEffect, useState } from 'react';
import { SIM_MODE_RULES } from '../../engine/simulationModes';
import { useTelescopeStore } from '../../store/useTelescopeStore';
import { useAlignmentStore } from '../../store/useAlignmentStore';
import { evaluateState } from '../../engine/rulesEngine';
import { getMagnification, getTrueFOV, getExitPupil, getRelativeBrightness } from '../../engine/opticalMath';

export const DebugPanel: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);
  const telescopeState = useTelescopeStore();
  const modeRules = SIM_MODE_RULES[telescopeState.simulationMode];
  const alignmentState = useAlignmentStore();
  const [fps, setFps] = useState(0);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        setIsVisible(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    let frameCount = 0;
    let lastTime = performance.now();
    let animationFrameId: number;

    const measureFPS = () => {
      const now = performance.now();
      frameCount++;
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
      }
      animationFrameId = requestAnimationFrame(measureFPS);
    };
    animationFrameId = requestAnimationFrame(measureFPS);
    
    return () => cancelAnimationFrame(animationFrameId);
  }, [isVisible]);

  if (!isVisible || !telescopeState || !telescopeState.activeProfile || !telescopeState.activeTarget) return null;

  const magnification = getMagnification(telescopeState.activeProfile.focalLength, telescopeState.eyepieceFocalLength);
  const exitPupil = getExitPupil(telescopeState.activeProfile.aperture, magnification);
  const trueFOV = getTrueFOV(50, magnification);
  const brightness = getRelativeBrightness(exitPupil);

  const ruleEval = evaluateState({
    isDustCapOn: telescopeState.isDustCapOn,
    isSolarFilterAttached: telescopeState.isSolarFilterAttached,
    targetId: telescopeState.activeTarget.id,
    magnification,
    seeingQuality: telescopeState.seeingQuality,
    isAltTensionLocked: telescopeState.isAltTensionLocked,
    isMechanicallyBalanced: telescopeState.isMechanicallyBalanced,
    isCollimated: telescopeState.isCollimated,
    isMirrorCooled: telescopeState.isMirrorCooled,
    focuserPosition: telescopeState.focuserPosition,
    eyepieceFocalLength: telescopeState.eyepieceFocalLength,
    isBarlowActive: telescopeState.isBarlowActive,
                focusToleranceUnits: modeRules.focusToleranceUnits,
                enforceAtmosphericLimit: modeRules.atmosphericLimitEnforced
  });

  return (
    <div className="fixed top-4 right-4 z-50 w-80 max-h-[90vh] overflow-y-auto bg-black/90 border border-green-500 rounded p-4 font-mono text-[10px] text-green-400 shadow-xl backdrop-blur-sm">
      <div className="flex justify-between items-center border-b border-green-800 pb-2 mb-2">
        <h3 className="font-bold text-sm">DEVELOPER TELEMETRY</h3>
        <span className="bg-green-900 text-green-100 px-2 py-0.5 rounded">{fps} FPS</span>
      </div>

      <div className="space-y-4">
        <section>
          <h4 className="text-green-600 font-bold mb-1 border-b border-green-900">OPTICAL MATH</h4>
          <div className="grid grid-cols-2 gap-1">
            <span>Magnification:</span><span>{magnification.toFixed(1)}X</span>
            <span>True FOV:</span><span>{(trueFOV * 60).toFixed(2)}'</span>
            <span>Exit Pupil:</span><span>{exitPupil.toFixed(2)} mm</span>
            <span>Brightness:</span><span>{((brightness / 49) * 100).toFixed(1)}%</span>
          </div>
        </section>

        <section>
          <h4 className="text-green-600 font-bold mb-1 border-b border-green-900">ALIGNMENT STORE</h4>
          <div className="grid grid-cols-2 gap-1">
            <span>Offset X:</span><span>{alignmentState.offsetX.toFixed(2)} px</span>
            <span>Offset Y:</span><span>{alignmentState.offsetY.toFixed(2)} px</span>
            <span>Velocity X:</span><span>{alignmentState.angularVelocityX.toFixed(2)}</span>
            <span>Velocity Y:</span><span>{alignmentState.angularVelocityY.toFixed(2)}</span>
            <span>Is Aligned:</span><span>{alignmentState.isAligned ? 'TRUE' : 'FALSE'}</span>
          </div>
        </section>

        <section>
          <h4 className="text-green-600 font-bold mb-1 border-b border-green-900">RULES ENGINE FLAGS</h4>
          <div className="grid grid-cols-2 gap-1">
            <span className={ruleEval.isBlackedOut ? 'text-red-400' : ''}>BlackedOut:</span><span>{ruleEval.isBlackedOut.toString()}</span>
            <span className={ruleEval.hasSolarHazard ? 'text-red-400 font-bold' : ''}>SolarHazard:</span><span>{ruleEval.hasSolarHazard.toString()}</span>
            <span className={ruleEval.isAtmosphericBlurActive ? 'text-orange-400' : ''}>AtmosBlur:</span><span>{ruleEval.isAtmosphericBlurActive.toString()}</span>
            <span className={ruleEval.isAltDrooping ? 'text-orange-400' : ''}>AltDrooping:</span><span>{ruleEval.isAltDrooping.toString()}</span>
          </div>
        </section>
        
        <section>
          <h4 className="text-green-600 font-bold mb-1 border-b border-green-900">ENVIRONMENT</h4>
          <div className="grid grid-cols-2 gap-1">
            <span>Target:</span><span>{telescopeState.activeTarget.id}</span>
            <span>Seeing:</span><span>{telescopeState.seeingQuality}/5</span>
            <span>Dust Cap:</span><span>{telescopeState.isDustCapOn.toString()}</span>
            <span>Solar Filter:</span><span>{telescopeState.isSolarFilterAttached.toString()}</span>
          </div>
        </section>
      </div>
    </div>
  );
};
