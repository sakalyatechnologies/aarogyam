// Brushing art per care band: an open mouth seen from the front (teeth built from the same crown
// outlines as the tooth art), a toothbrush, paste, a parent's hand for children and floss from teen.
import { smooth, ellipse, corner, lin, rad, L, r1, fp } from './geom.mjs';
import { crownNorm } from './tooth.mjs';

const BOX = [0, 0, 320, 220];
const CX = 160;
const OPENING = [corner([46, 114]), [72, 74], [112, 56], [160, 52], [208, 56], [248, 74], corner([274, 114]), [248, 152], [208, 172], [160, 177], [112, 172], [72, 152]];
const LIPS = [corner([20, 114]), [48, 62], [98, 32], [140, 28], [160, 37], [180, 28], [222, 32], [272, 62], corner([300, 114]), [272, 168], [222, 198], [160, 207], [98, 198], [48, 168]];

const SETS = {
  general_under_6: { upper: ['pu1', 'pu2', 'pu3', 'pu4', 'pu5'], lower: ['pl1', 'pl2', 'pl3', 'pl4', 'pl5'], k: 5.6, R: 19 },
  general_6_12: { upper: ['u1', 'u2', 'pu3', 'pu4', 'pu5', 'u6'], lower: ['l1', 'l2', 'pl3', 'pl4', 'pl5', 'l6'], mixed: true, k: 4.7, R: 24 },
  general_teen: { upper: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], lower: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'], k: 4.5, R: 25 },
  general_adult: { upper: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'], lower: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'], k: 4.5, R: 25 },
};

function fdiOf(type, upper, right) {
  const prim = type.startsWith('p');
  const pos = Number(type.at(-1));
  const q = upper ? (right ? 1 : 2) : (right ? 4 : 3);
  return (prim ? q + 4 : q) * 10 + pos;
}

function row(TYPES, set, upper) {
  const types = upper ? set.upper : set.lower;
  const out = {};
  const hl = [], sh = [];
  let s = 0;
  types.forEach((ty) => {
    const T = TYPES[ty], W = T.front.W, H = T.front.H;
    const mid = s + W / 2;
    s += W;
    const phi = Math.min(mid / set.R, 1.42);
    const depth = 1 - 0.2 * (1 - Math.cos(phi));
    const xOff = set.k * set.R * 0.98 * Math.sin(phi) * (1 - 0.08 * (1 - Math.cos(phi)));
    const wp = Math.max(0.28, Math.cos(phi)) * W * set.k * depth;
    const hp = H * set.k * depth * 0.95;
    const edge = upper ? 103 - 15 * (1 - Math.cos(phi)) : 124 + 13 * (1 - Math.cos(phi));
    const norm = crownNorm(T);
    for (const right of [true]) {
      const xc = CX + (right ? -xOff : xOff);
      const sx = right ? 1 : -1; // patient's right is the viewer's left; mesial faces the midline
      const pts = norm.map(([u, v, c]) => {
        const p = [xc + u * sx * (wp / 2), upper ? edge - v * hp : edge + v * hp];
        return c ? [p[0], p[1], c] : p;
      });
      const d = smooth(pts);
      out[fdiOf(ty, upper, right)] = d;
      const hy = upper ? edge - hp * 0.5 : edge + hp * 0.5;
      hl.push(ellipse(xc + sx * wp * 0.1, hy, wp * 0.14, hp * 0.26));
      sh.push(ellipse(xc - sx * wp * 0.42, hy, wp * 0.16, hp * 0.5));
    }
  });
  return { teeth: out, highlights: hl.join(''), shades: sh.join('') };
}

function gum(TYPES, set, upper, teeth) {
  // margin points left to right, scalloped around each crown's neck
  const items = Object.entries(teeth).map(([fdi, d]) => {
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
    return { fdi, x0: Math.min(...xs), x1: Math.max(...xs), neck: upper ? Math.min(...ys) : Math.max(...ys), h: Math.max(...ys) - Math.min(...ys) };
  });
  items.push(...items.map((t) => ({ ...t, x0: 2 * CX - t.x1, x1: 2 * CX - t.x0 })));
  items.sort((a, b) => a.x0 - b.x0);
  const pts = [];
  const sgn = upper ? 1 : -1;
  items.forEach((t, i) => {
    const cx = (t.x0 + t.x1) / 2, w = t.x1 - t.x0;
    if (i === 0) pts.push([t.x0 - 6, t.neck + sgn * t.h * 0.2]);
    pts.push([t.x0 + w * 0.12, t.neck + sgn * t.h * 0.17], [cx, t.neck + sgn * t.h * 0.07], [t.x1 - w * 0.12, t.neck + sgn * t.h * 0.17]);
    const nx = items[i + 1];
    pts.push([(t.x1 + (nx ? nx.x0 : t.x1 + 6)) / 2, t.neck + sgn * t.h * 0.33]);
  });
  const yEnd = upper ? 30 : 200;
  return smooth([corner([pts[0][0] - 10, yEnd]), corner([pts[0][0] - 10, pts[0][1]]), ...pts, corner([pts.at(-1)[0] + 10, pts.at(-1)[1]]), corner([pts.at(-1)[0] + 10, yEnd])]);
}

function brush(child) {
  const tufts = [];
  for (let x = -14; x <= 14; x += 3.5) tufts.push(`M${r1(x)} -5.5L${r1(x)} -15`);
  const head = smooth([corner([-17, 5]), [-18, 0], corner([-17, -5]), [0, -6], corner([16, -5]), [19, 0], corner([16, 5]), [0, 6]]);
  const handle = smooth([[16, -4], [30, -3], [44, -4.6], [64, -6.2], [96, -5.6], [124, -6.4], [140, -6], [146, -2], [146, 2], [140, 6], [124, 6.4], [96, 5.6], [64, 6.2], [44, 4.6], [30, 3], [16, 4]]);
  return {
    layers: [
      L('handle', handle, 'g:b_handle'),
      L('grip', smooth([[50, -4.4], [66, -5.2], [82, -4.6], [82, 4.6], [66, 5.2], [50, 4.4]]), child ? '#F2B4C6' : '#8FD8C8', { op: 0.95 }),
      L('handleShine', `M24 -2C50 -4 100 -3.6 140 -3.4`, null, { s: 'white', w: 1.4, op: 0.45 }),
      L('head', head, 'g:b_handle'),
      L('tufts', tufts.join(''), null, { s: '#F4FAF9', w: 2.4 }),
      L('tuftsBlue', tufts.filter((_, i) => i % 3 === 1).join(''), null, { s: '#7CC7E8', w: 2.4 }),
      L('tuftEnds', `M-15.5 -15.2L15.5 -15.2`, null, { s: '#DDEBEA', w: 0.8, op: 0.8 }),
    ],
  };
}

function paste(kind) {
  if (kind === 'smear') return [L('paste', smooth([[-9, -15.6], [0, -17.2], [9, -15.6], [9, -14.8], [0, -15.6], [-9, -14.8]]), 'g:b_paste')];
  return [
    L('paste', ellipse(0, -19.2, 5.6, 4.6), 'g:b_paste'),
    L('pasteStripe', `M-3.6 -20.6C-1 -22 1.4 -19.4 3.6 -20.4`, null, { s: '#5DB3DD', w: 1.1, op: 0.85 }),
  ];
}

function hand() {
  // a parent's hand round the handle: back of the hand and wrist behind, four fingers wrapped
  // under the handle and the thumb along the top
  const back = smooth([[86, -13], [104, -17], [124, -16], [138, -10], [146, 2], [142, 16], [126, 22], [104, 21], [88, 14]]);
  const arm = smooth([corner([132, -14]), [168, -24], [210, -30], corner([236, -26]), corner([236, 70]), [200, 58], [166, 38], corner([134, 20])]);
  const fingers = [90, 101.5, 113, 124].map((x, i) => smooth([[x - 5.4, -1], [x - 5.8, 8 + i], [x - 3.6, 13.5 + i], [x, 15 + i], [x + 3.6, 13.5 + i], [x + 5.8, 8 + i], [x + 5.4, -1]])).join('');
  const thumb = smooth([[70, -6.8], [74, -11.6], [90, -13.4], [108, -12.6], [114, -8.6], [104, -6], [86, -5.2]]);
  return [
    L('arm', arm, 'g:b_skin'),
    L('handBack', back, 'g:b_skin'),
    L('handBackEdge', back, null, { s: '#7A4529', w: 0.7, op: 0.4 }),
    L('fingers', fingers, 'g:b_skin'),
    L('fingerEdges', fingers, null, { s: '#7A4529', w: 0.8, op: 0.55 }),
    L('creases', [90, 101.5, 113, 124].map((x, i) => `M${x - 3.4} ${7 + i}C${x - 1} ${8 + i} ${x + 1} ${8 + i} ${x + 3.4} ${7 + i}`).join(''), null, { s: '#8A5235', w: 0.6, op: 0.5 }),
    L('thumb', thumb, 'g:b_skin'),
    L('thumbEdge', thumb, null, { s: '#7A4529', w: 0.7, op: 0.5 }),
    L('thumbNail', ellipse(74.6, -9.2, 3.6, 2.2), '#EBC3A6', { op: 0.95 }),
  ];
}

function floss() {
  return [
    L('floss', `M136 142C148 116 155 94 158.4 76C159.4 72 160.6 72 161.6 76C165 94 172 116 184 142`, null, { s: '#F7FBFF', w: 1.3 }),
    L('flossShine', `M136 142C148 116 155 94 158.4 76`, null, { s: '#9FD3EA', w: 0.5, op: 0.8 }),
    L('fingerL', smooth([[110, 170], [122, 148], [132, 138], [141, 140], [142, 150], [130, 170]]), 'g:b_skin'),
    L('fingerR', smooth([[210, 170], [198, 148], [188, 138], [179, 140], [178, 150], [190, 170]]), 'g:b_skin'),
    L('nails', ellipse(136, 141.5, 4, 2.6) + ellipse(184, 141.5, 4, 2.6), '#EBC3A6'),
  ];
}

export function buildBrushing(TYPES) {
  const out = {};
  for (const [band, set] of Object.entries(SETS)) {
    const child = band === 'general_under_6' || band === 'general_6_12';
    const up = row(TYPES, set, true), lo = row(TYPES, set, false);
    const opening = smooth(OPENING);
    const g = [
      rad('b_cavity', CX, 118, 120, [[0, '#4A1119'], [0.7, '#651E2A'], [1, '#86323E']], 0.55),
      lin('b_lip', 0, 26, 0, 208, [[0, '#B4676B'], [0.3, '#A85A60'], [0.5, '#8E4248'], [0.7, '#A4565C'], [1, '#C07479']]),
      rad('b_tongue', CX, 172, 86, [[0, '#E08A8F'], [0.7, '#C9636D'], [1, '#A84A56']], 0.34),
      lin('b_gumU', 0, 40, 0, 92, [[0, '#D9828C'], [0.6, '#EBA2A6'], [1, '#F5BBB7']]),
      lin('b_gumL', 0, 196, 0, 136, [[0, '#D9828C'], [0.6, '#EBA2A6'], [1, '#F5BBB7']]),
      lin('b_toothU', 0, 60, 0, 104, [[0, 'neck'], [0.35, 'enamel'], [0.82, 'enamelHi'], [1, 'tipTrans']]),
      lin('b_toothL', 0, 166, 0, 122, [[0, 'neck'], [0.35, 'enamel'], [0.82, 'enamelHi'], [1, 'tipTrans']]),
      lin('b_handle', 0, -7, 0, 7, [[0, '#2BA287'], [0.45, '#1E8A72'], [1, '#126653']]),
      lin('b_paste', 0, -24, 0, -14, [[0, '#FFFFFF'], [1, '#DDEFF7']]),
      lin('b_skin', 0, -26, 0, 60, [[0, '#D59A70'], [0.5, '#C2845A'], [1, '#A86B47']]),
      rad('b_lipShine', CX, 40, 60, [[0, 'white', 0.35], [1, 'white', 0]], 0.25),
    ];
    const lipsD = smooth(LIPS) + opening;
    // the area outside the mouth opening, wound opposite to the opening so nonzero leaves a hole
    const area = OPENING.reduce((a, p, i) => { const q = OPENING[(i + 1) % OPENING.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
    const rect = area > 0 ? 'M-40 -40L-40 260L360 260L360 -40Z' : 'M-40 -40L360 -40L360 260L-40 260Z';
    out[band] = {
      band, box: BOX, g,
      opening,
      outside: rect + opening,
      back: [L('cavity', opening, 'g:b_cavity'), L('tongue', ellipse(CX, 172, 86, 28), 'g:b_tongue', { clip: 'opening' })],
      upper: { ...up, fill: 'g:b_toothU', gum: gum(TYPES, set, true, up.teeth), gumFill: 'g:b_gumU' },
      lower: { ...lo, fill: 'g:b_toothL', gum: gum(TYPES, set, false, lo.teeth), gumFill: 'g:b_gumL' },
      front: [
        L('lips', lipsD, 'g:b_lip', { rule: 'evenodd' }),
        L('lipInner', opening, null, { s: '#7A343B', w: 2.2, op: 0.55 }),
        L('lipShine', ellipse(CX, 40, 70, 8) + ellipse(CX, 194, 60, 7), 'g:b_lipShine'),
        L('philtrum', `M150 31C154 34 158 36 160 37C162 36 166 34 170 31`, null, { s: '#7E3A40', w: 1, op: 0.4 }),
      ],
      brush: brush(child).layers,
      paste: paste(band === 'general_under_6' ? 'smear' : 'pea'),
      hand: child ? hand() : [],
      floss: child ? [] : floss(),
      brushScale: band === 'general_under_6' ? 1.1 : child ? 1.25 : 1.4,
    };
    void fp;
  }
  return out;
}
