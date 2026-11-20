// Shared unit-space shapes (100x100 box, mapped onto a tooth anchor) and the stage scenes.
// Scene layers reference tooth geometry by "@slot", shared shapes by "#shape". "{S}", "{D}" and "{M}"
// are filled at render time with the surface, decay depth and material paint.
import { MM, CEJ, smooth, line, poly, ellipse, corner, blob, lin, rad, L } from './geom.mjs';

export function buildShapes() {
  // threaded implant fixture, tapering toward the apex
  const L1 = [], R1 = [];
  for (let y = 4; y <= 92; y += 8) {
    const t = y / 100, hw = 34 - 12 * t * t;
    L1.push([50 - hw + 2, y], [50 - hw - 6, y + 3], [50 - hw + 2, y + 6]);
    R1.push([50 + hw - 2, y], [50 + hw + 6, y + 3], [50 + hw - 2, y + 6]);
  }
  const fixture = poly([[18, 0], [82, 0], ...R1, [62, 100], [38, 100], ...L1.reverse()]);
  let threads = '';
  for (let y = 7; y <= 95; y += 8) { const t = y / 100, hw = 34 - 12 * t * t; threads += `M${(50 - hw).toFixed(1)} ${y + 2}L${(50 + hw).toFixed(1)} ${y - 1}`; }
  return {
    d: {
      fixture,
      fixtureThreads: threads,
      fixtureTop: poly([[18, 0], [82, 0], [80, 5], [20, 5]]),
      abutment: smooth([corner([20, 100]), corner([80, 100]), [86, 84], corner([74, 74]), corner([68, 5]), corner([62, 0]), corner([38, 0]), corner([32, 5]), corner([26, 74]), [14, 84]]),
      fileHandle: smooth([corner([22, 70]), corner([78, 70]), corner([80, 8]), [70, 0], [30, 0], corner([20, 8])]) + poly([[38, 70], [62, 70], [60, 100], [40, 100]]),
      fileRidges: 'M24 20L76 20M24 34L76 34M24 48L76 48',
      arrowsH: poly([[0, 50], [18, 32], [18, 43], [82, 43], [82, 32], [100, 50], [82, 68], [82, 57], [18, 57], [18, 68]]),
      arrowsV: poly([[50, 0], [68, 18], [57, 18], [57, 82], [68, 82], [50, 100], [32, 82], [43, 82], [43, 18], [32, 18]]),
      crack: line([[58, -4], [52, 12], [61, 27], [49, 44], [56, 58], [44, 76], [49, 104]]) + line([[52, 42], [40, 50], [34, 62]]),
      halo: ellipse(50, 50, 50, 50),
      'car.enamel': blob(50, 50, 26, 24, 3, 0.2),
      'car.dentin': blob(50, 50, 46, 44, 5, 0.18),
      'car.near_pulp': blob(50, 50, 66, 62, 7, 0.16),
      cav: blob(50, 50, 48, 46, 9, 0.05),
      swelling: ellipse(50, 52, 30, 27),
      pus: ellipse(50, 50, 11, 10),
      drops: [20, 50, 80].map((x, i) => {
        const y = 30 + (i % 2) * 18;
        return `M${x} ${y - 16}C${x + 3} ${y - 8} ${x + 8} ${y - 2} ${x + 8} ${y + 4}C${x + 8} ${y + 9} ${x + 4} ${y + 12} ${x} ${y + 12}C${x - 4} ${y + 12} ${x - 8} ${y + 9} ${x - 8} ${y + 4}C${x - 8} ${y - 2} ${x - 3} ${y - 8} ${x} ${y - 16}Z`;
      }).join(''),
    },
    g: [
      lin('u_ti', 0, 0, 100, 0, [[0, '#6F777F'], [0.3, '#E3E7EA'], [0.55, '#B5BCC3'], [1, '#666E76']]),
      lin('u_zr', 0, 0, 100, 0, [[0, '#D9D6CF'], [0.35, '#FBFAF7'], [1, '#CFCBC2']]),
      lin('u_fileH', 0, 0, 100, 0, [[0, '#C9961A'], [0.35, '#F6D35B'], [1, '#B98512']]),
      rad('u_car', 50, 50, 50, [[0, 'caries'], [0.45, 'caries'], [0.72, 'cariesMid'], [0.9, 'cariesBrown', 0.85], [1, 'cariesHalo', 0.2]]),
      rad('u_carE', 50, 50, 50, [[0, 'cariesMid', 0.9], [0.55, 'cariesBrown', 0.8], [1, 'cariesHalo', 0.15]]),
      rad('u_carN', 50, 50, 50, [[0, '#6E6052'], [0.6, 'cariesNeutral'], [1, 'cariesHalo', 0.3]]),
      rad('u_halo', 50, 50, 50, [[0, '#3B1A12', 0.6], [0.6, '#5A2618', 0.35], [1, '#5A2618', 0]]),
      rad('u_swell', 50, 52, 30, [[0, '#E0636B', 0.95], [0.7, '#C7404F', 0.85], [1, '#C7404F', 0]]),
      rad('u_pus', 50, 50, 11, [[0, '#FFF1B8'], [0.6, '#F2D27A'], [1, '#D9A441', 0.6]]),
      lin('u_drop', 0, 0, 0, 100, [[0, '#E0404C'], [1, '#8E101C']]),
    ],
  };
}

const PULP = ['pulp', 'vessels', 'nerve'];
const BODY = ['laminaDura', 'pdl', 'dentin', 'tubules', 'enamel', 'enamelSheen', 'dej', ...PULP, 'toothEdge'];

const remove = {
  view: 'section', hide: BODY, add: [
    L('socket', '@socket', 'g:socketG', { above: 'gum' }),
    L('liftDentin', '@tooth', 'g:dentin', { mv: [0.6, -5.5, -7] }),
    L('liftEnamel', '@enamel', 'g:enamelCut', { mv: [0.6, -5.5, -7] }),
    L('liftEdge', '@tooth', null, { s: 'shadow', w: 0.6, op: 0.5, mv: [0.6, -5.5, -7] }),
  ],
};
const healing = {
  view: 'section', hide: BODY, add: [
    L('clot', '@socket', 'g:clot', { above: 'gum' }),
    L('clotEdge', '@socket', null, { s: '#5E1018', w: 0.6, op: 0.6 }),
  ],
};
const healed = {
  view: 'section', hide: BODY, add: [
    L('healedBone', '@socket', 'bone', { op: 0.92, above: 'gum' }),
    L('healedEdge', '@socket', null, { s: 'boneCortex', w: 1, op: 0.8, dash: [2, 2] }),
    L('ridge', '@ridge', 'g:gumCut'),
  ],
};
const fixture = [
  L('fixture', '#fixture', 'g:u_ti', { at: 'implant', above: 'gum' }),
  L('fixtureThreads', '#fixtureThreads', null, { s: '#5E666E', w: 2.4, op: 0.5, at: 'implant' }),
];

export function buildStages() {
  const caries = [
    L('cariesHalo', '@car.{S}.{D}', null, { s: 'cariesBrown', w: 2.4, op: 0.45, clip: 'tooth' }),
    L('cariesLesion', '@car.{S}.{D}', 'caries', { clip: 'tooth' }),
    L('cariesRim', '@car.{S}.{D}', null, { s: 'cariesMid', w: 0.8, op: 0.8, clip: 'tooth' }),
  ];
  const crownOn = [
    L('crownShell', '@crownShell', '{M}', { above: 'dej' }),
    L('crownGloss', '@crownShell', 'g:gloss', { op: 0.6 }),
    L('cementLine', '@prep', null, { s: 'cement', w: 0.6, op: 0.8 }),
  ];
  return {
    root_canal: {
      steps: ['access_clean', 'dressing', 'obturation', 'crown'],
      scenes: {
        access_clean: { view: 'section', grow: 7, hide: PULP, add: [
          L('chamberVoid', '@chamber', 'canalVoid', { above: 'dej' }),
          L('canalVoid', '@canals', 'canalVoid'),
          L('accessVoid', '@access', 'canalVoid', { clip: 'tooth' }),
          L('voidEdge', '@chamber', null, { s: 'dentinDeep', w: 0.5, op: 0.5 }),
          L('file', '@file', null, { s: 'steel', w: 1.3 }),
          L('fileTwist', '@file', null, { s: 'white', w: 0.5, op: 0.6, dash: [1.2, 1.2] }),
          L('fileGrip', '#fileHandle', 'g:u_fileH', { at: 'accessTop' }),
          L('fileGripRidges', '#fileRidges', null, { s: '#A87A10', w: 3, op: 0.6, at: 'accessTop' }),
        ] },
        dressing: { view: 'section', hide: PULP, add: [
          L('medChamber', '@chamber', 'calcium_hydroxide', { above: 'dej' }),
          L('medCanals', '@canals', 'calcium_hydroxide'),
          L('medAccess', '@access', 'calcium_hydroxide', { clip: 'tooth' }),
          L('medEdge', '@chamber', null, { s: 'dentinDeep', w: 0.5, op: 0.4 }),
          L('tempFilling', '@temp', 'temporary', { clip: 'tooth' }),
          L('tempEdge', '@temp', null, { s: '#8C7E6C', w: 0.6, op: 0.7, clip: 'tooth' }),
        ] },
        obturation: { view: 'section', hide: PULP, add: [
          L('core', '@chamber', 'core', { above: 'dej' }),
          L('coreEdge', '@chamber', null, { s: 'compositeEdge', w: 0.4, op: 0.4 }),
          L('gutta', '@canals', 'g:gp'),
          L('seal', '@access', 'composite', { clip: 'tooth' }),
          L('sealEdge', '@access', null, { s: 'compositeEdge', w: 0.45, op: 0.45, clip: 'tooth' }),
        ] },
        crown: { view: 'section', hide: ['enamel', 'enamelSheen', ...PULP], add: [
          L('core', '@chamber', 'core', { above: 'dej' }),
          L('gutta', '@canals', 'g:gp'),
          ...crownOn,
        ] },
      },
    },
    filling: {
      steps: ['decay', 'cleaned', 'filled'],
      scenes: {
        decay: { view: 'section', add: caries },
        cleaned: { view: 'section', add: [
          L('cavity', '@cav.{S}', 'canalVoid', { clip: 'tooth' }),
          L('cavityWall', '@cav.{S}', null, { s: 'dentinDeep', w: 0.8, op: 0.6, clip: 'tooth' }),
        ] },
        filled: { view: 'section', add: [
          L('filling', '@cav.{S}', '{M}', { clip: 'tooth' }),
          L('fillingMargin', '@cav.{S}', null, { s: 'compositeEdge', w: 0.5, op: 0.5, clip: 'tooth' }),
        ] },
      },
    },
    extraction: { steps: ['remove', 'socket_healing'], scenes: { remove, socket_healing: healing, healed } },
    wisdom_extraction: {
      steps: ['position', 'remove', 'socket_healing'],
      scenes: { position: { view: 'section', mode: 'eruption', add: [] }, remove, socket_healing: healing, healed },
      backdrop: {
        box: [0, 0, 192, 200],
        g: [lin('w_gum', 0, CEJ - 8, 0, CEJ + 24, [[0, 'gumCut'], [0.55, 'gumCutDeep'], [0.85, 'gumCutDeep', 0.8], [1, 'gumCutDeep', 0]]),
          lin('w_bone', 0, CEJ + 6, 0, 200, [[0, 'boneCortex'], [0.12, 'bone'], [1, 'boneDeep']])],
        layers: [
          L('bone', `M2 ${CEJ + 10.5}C40 ${CEJ + 8} 70 ${CEJ + 12} 96 ${CEJ + 11}C130 ${CEJ + 10} 160 ${CEJ + 9} 190 ${CEJ + 11}L190 193C190 196 188 198 184 198L8 198C4 198 2 196 2 193Z`, 'g:w_bone'),
          L('boneTexture', '@tex', 'boneHole', { op: 0.38, clip: 'wbone' }),
          L('boneTexture2', '@tex', 'boneHole', { op: 0.38, clip: 'wbone', tr: [1, 0, 0, 1, 92, 0] }),
          L('gum', `M2 ${CEJ - 4}C30 ${CEJ - 6} 60 ${CEJ - 5} 96 ${CEJ - 6}C130 ${CEJ - 7} 160 ${CEJ - 5} 190 ${CEJ - 4}L190 ${CEJ + 26}L2 ${CEJ + 26}Z`, 'g:w_gum'),
        ],
        clips: { wbone: `M2 ${CEJ + 10.5}L190 ${CEJ + 10.5}L190 198L2 198Z` },
        neighborX: 92,
        // eruption: drop in mm; angulation: rotation in degrees (positive tips the crown mesially)
        drop: { erupted: 0, partial: 3.4, impacted: 6.4, unerupted: 8.2 },
        angle: { vertical: 0, mesioangular: 42, distoangular: -26, horizontal: 86 },
      },
    },
    crown: {
      steps: ['prep', 'crown'],
      scenes: {
        prep: { view: 'section', hide: ['dentin', 'enamel', 'enamelSheen', 'dej', 'tubules', 'toothEdge'], add: [
          L('prepTooth', '@prepTooth', 'g:dentin', { above: 'gum' }),
          L('prepEdge', '@prepTooth', null, { s: 'shadow', w: 0.6, op: 0.45, above: 'nerve' }),
          L('originalOutline', '@crown', null, { s: 'shadow', w: 0.6, op: 0.4, dash: [2, 1.6] }),
        ] },
        crown: { view: 'section', hide: ['enamel', 'enamelSheen'], add: crownOn },
      },
    },
    scaling: {
      steps: ['calculus', 'clean'],
      scenes: {
        calculus: { view: 'front', add: [
          L('calculus', '@calculus', 'g:calc', { above: 'crownEdge' }),
          L('calculusEdge', '@calculus', null, { s: '#8E7440', w: 0.5, op: 0.6 }),
          L('gumInflamed', '@gumLine', null, { s: 'gumInflamed', w: 2.4, op: 0.75, above: 'gumMargin' }),
        ] },
        clean: { view: 'front', add: [
          L('polish', '@crown', 'g:gloss', { op: 0.45, above: 'specular2' }),
          L('gumHealthy', '@gumLine', null, { s: 'gumLight', w: 2, op: 0.9, above: 'gumMargin' }),
        ] },
      },
    },
    implant: {
      steps: ['post', 'abutment', 'crown'],
      scenes: {
        post: { view: 'section', hide: BODY, add: [...healed.add.slice(0, 1), ...fixture, healed.add[2]] },
        abutment: { view: 'section', hide: BODY, add: [...healed.add.slice(0, 1), ...fixture, healed.add[2], L('abutment', '#abutment', 'g:u_ti', { at: 'abut' })] },
        crown: { view: 'section', hide: BODY, add: [...healed.add.slice(0, 1), ...fixture, healed.add[2], L('abutment', '#abutment', 'g:u_ti', { at: 'abut' }),
          L('implantCrown', '@crown', '{M}'), L('implantGloss', '@crown', 'g:gloss', { op: 0.6 }), L('implantCrownEdge', '@crown', null, { s: 'shadow', w: 0.6, op: 0.45 })] },
      },
    },
    sealant: {
      steps: ['fissures', 'sealed'],
      scenes: {
        fissures: { view: 'top', add: [L('stain', '@grooves', null, { s: 'fissureStain', w: 0.9, op: 0.6, clip: 'crown', above: 'fissures' })] },
        sealed: { view: 'top', add: [
          L('sealant', '@grooves', null, { s: 'resin', w: 4.2, op: 0.62, clip: 'crown', above: 'fissures' }),
          L('sealantGloss', '@grooves', null, { s: 'white', w: 1.4, op: 0.45, clip: 'crown' }),
        ] },
      },
    },
  };
}
void MM;
