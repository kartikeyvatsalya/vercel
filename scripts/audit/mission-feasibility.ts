import { missions } from '../../src/data/missions';
import * as om from '../../src/engine/opticalMath';
import { TELESCOPE_PROFILES_LIST } from '../../src/engine/constants';
import { TARGETS } from '../../src/data/bookContent';
for (const m of missions) {
  const rows: string[] = [];
  for (const seeing of [1, 2, 3, 4, 5]) {
    const ok: string[] = [];
    for (const p of TELESCOPE_PROFILES_LIST) for (const ep of om.EYEPIECE_CATALOG) for (const barlow of [false, true]) {
      const targets = m.id === 'rank2_capstone_right_tool' ? ['moon', 'saturn', 'm42'] : [m.targetId];
      for (const tid of targets) {
        const view: any = {
          activeTarget: TARGETS[tid], activeProfile: { ...p, apertureMm: p.aperture, focalLengthMm: p.focalLength },
          activeEyepieceId: ep.id, eyepieceFocalLength: ep.focalLengthMm, isBarlowActive: barlow,
          isDustCapOn: false, isMirrorCooled: true, isCollimated: true, isMechanicallyBalanced: true,
          focuserPosition: om.getPerfectFocusPoint(ep.focalLengthMm, barlow), seeingQuality: seeing,
          isGoToSuppressed: false, targetOffsetDeg: 0,
        };
        if (m.successCondition(view, om)) ok.push(`${p.id}/${ep.id}${barlow ? '+B' : ''}${targets.length > 1 ? '@' + tid : ''}`);
      }
    }
    rows.push(`  seeing ${seeing}: ${ok.length ? ok.join(', ') : 'IMPOSSIBLE with built-in scopes'}`);
  }
  console.log(m.id); console.log(rows.join('\n'));
}
