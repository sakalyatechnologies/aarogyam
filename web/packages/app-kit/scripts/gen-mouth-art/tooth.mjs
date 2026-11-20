// Builds one tooth type: shared crown/root geometry, then the front, section and top views.
import {
  MM, CEJ, r1, corner, noC, rev, clamp, ss, smooth, line, poly, ellipse, sample, rayHit, norm, offsetIn, capsule, blob,
  lin, rad, glow, L,
} from './geom.mjs';

const DEPTHS = ['enamel', 'dentin', 'near_pulp'];
const kind0 = (f) => f.kind;

// ---------- shared crown + root geometry ----------
function geometry(T) {
  const f = T.front;
  const W = (f.W * MM) / 2, CW = (f.cw * MM) / 2, H = f.H * MM, top = CEJ - H, dip = (f.dip ?? 0.7) * MM, bulge = (f.bulge ?? 0) * MM;
  const X = (u) => 50 + u * W, Y = (v) => top + v * H;
  // occlusal profile, distal -> mesial, as (u, v)
  let prof;
  if (f.kind === 'incisor') {
    const dr = f.dRound ?? 0.1;
    prof = [[-0.97, dr + 0.05], [-0.8, dr * 0.3], [-0.45, 0.012], [0, 0], [0.45, 0.006], [0.86, 0.008], [0.98, 0.045]];
    if (f.mamelon) prof.splice(2, 3, [-0.5, 0.012], [-0.25, 0.02], [0, 0.004], [0.25, 0.02], [0.5, 0.006]);
  } else if (f.kind === 'canine' || f.kind === 'premolar') {
    const t = f.tip ?? 0, c = f.kind === 'canine';
    prof = [[-0.97, c ? 0.34 : 0.28], [-0.6, c ? 0.19 : 0.14], [t - 0.2, 0.035], [t, 0], [t + 0.2, 0.03], [0.62, c ? 0.15 : 0.12], [0.97, c ? 0.28 : 0.24]];
  } else {
    const cs = f.cusps.slice().sort((a, b) => a.u - b.u);
    prof = [[-0.97, cs[0].d + 0.15]];
    cs.forEach((c, i) => {
      if (i > 0) { const p = cs[i - 1]; prof.push([(p.u + c.u) / 2, Math.max(p.d, c.d) + 0.075]); }
      prof.push([c.u - 0.12, c.d + 0.022], [c.u, c.d], [c.u + 0.12, c.d + 0.022]);
    });
    prof.push([0.97, cs.at(-1).d + 0.13]);
  }
  const cd = f.cd ?? (kind0(f) === 'molar' ? 0.32 : prof[0][1] + 0.1), cm = f.cm ?? (kind0(f) === 'molar' ? 0.3 : prof.at(-1)[1] + 0.1);
  const width = (v, c) => {
    const x = clamp((1 - v) / (1 - c), 0, 1);
    return CW + (W - CW) * Math.pow(Math.sin((x * Math.PI) / 2), 0.8) + bulge * Math.exp(-(((v - 0.84) / 0.09) ** 2));
  };
  const side = (sgn, c) => [0.9, 0.72, (0.72 + c) / 2].filter((v) => v > c + 0.04).map((v) => [50 + sgn * width(v, c), Y(v)]);
  const cornerD = [50 - CW, CEJ - dip], cornerM = [50 + CW, CEJ - dip];
  const arc = [corner(cornerD), ...side(-1, cd), [50 - W, Y(cd)], ...prof.map(([u, v]) => [X(u), Y(v)]), [50 + W, Y(cm)],
    ...rev(side(1, cm)), corner(cornerM)];
  const cejPts = [[50 + CW * 0.55, CEJ - dip * 0.35], [50, CEJ], [50 - CW * 0.55, CEJ - dip * 0.35]];
  const crown = smooth([...arc, ...cejPts]);

  // roots, mesial first
  const roots = f.roots.map((r) => ({ ...r })).sort((a, b) => b.u - a.u);
  const n = roots.length, furc = (f.furc ?? 3) * MM;
  roots.forEach((r) => {
    const Lr = r.len * MM;
    r.L = Lr; r.tf = n > 1 ? furc / Lr : 0;
    r.c = (t) => [50 + (n > 1 ? r.u * CW : 0) + (r.flare ?? 0) * MM * ss(r.tf * 0.5, 1, t) + (r.lean ?? 0) * MM * t * t, CEJ + t * Lr];
    r.hw = (t) => (n > 1 ? ((r.w ?? 2.6) * MM) / 2 : CW) * (1 - 0.8 * Math.pow(t, 1.3));
    r.ch = (t) => 0.38 * MM * (1 - 0.55 * t) + 0.25 + (n > 1 ? 0 : CW * 0.16 * (1 - t) ** 2);
  });
  const r0 = roots[0], rl = roots[n - 1];
  r0.extra = 50 + CW - (r0.c(0)[0] + r0.hw(0));
  rl.extra = rl.c(0)[0] - rl.hw(0) - (50 - CW);
  const edge = (r, t, sgn) => {
    const outer = (sgn > 0 && r === r0) || (sgn < 0 && r === rl);
    const ex = outer ? r.extra * (1 - ss(0, Math.max(r.tf, 0.25), t)) : 0;
    return [r.c(t)[0] + sgn * (r.hw(t) + ex), r.c(t)[1]];
  };
  const TS = [0.06, 0.16, 0.3, 0.46, 0.62, 0.78, 0.92];
  const rootArc = [];
  roots.forEach((r, i) => {
    const t0 = i === 0 ? 0 : r.tf;
    TS.filter((t) => t >= t0).forEach((t) => rootArc.push(edge(r, t, 1)));
    rootArc.push([r.c(1)[0], r.c(1)[1] + 0.6]);
    const t1 = i === n - 1 ? 0 : r.tf;
    rev(TS).filter((t) => t >= t1).forEach((t) => rootArc.push(edge(r, t, -1)));
    if (i < n - 1) {
      const nx = roots[i + 1];
      rootArc.push([(edge(r, r.tf, -1)[0] + edge(nx, nx.tf, 1)[0]) / 2, CEJ + furc * 0.86]);
    }
  });
  const tooth = smooth([noC(arc[0]), ...arc.slice(1, -1), noC(arc.at(-1)), ...rootArc]);
  const root = smooth([corner([cornerM[0], cornerM[1] - 4]), noC(cornerM), ...rootArc, noC(cornerD), corner([cornerD[0], cornerD[1] - 4])]);
  const toothPoly = sample([noC(arc[0]), ...arc.slice(1, -1), noC(arc.at(-1)), ...rootArc]);

  // enamel, DEJ, prep
  const kind = f.kind;
  const eT = (f.eT ?? (kind === 'molar' ? 2.2 : kind === 'incisor' ? 1.5 : 2)) * MM;
  const centre = [50, top + H * 0.62];
  const wOf = (p) => Math.pow(clamp((CEJ - dip * 0.5 - p[1]) / (H * 0.5), 0, 1), 0.7);
  const inner = arc.slice(1, -1);
  const relax = (pts, n = 3) => {
    let q = pts;
    for (let k = 0; k < n; k++) q = q.map((p, i) => (i === 0 || i === q.length - 1 ? p : [(q[i - 1][0] + 2 * p[0] + q[i + 1][0]) / 4, (q[i - 1][1] + 2 * p[1] + q[i + 1][1]) / 4]));
    return q;
  };
  const dej = relax([[cornerD[0] + 0.9, cornerD[1] - 1.2], ...offsetIn(inner, centre, (i, p) => eT * wOf(p) + 0.4), [cornerM[0] - 0.9, cornerM[1] - 1.2]]);
  const enamel = smooth([...arc, ...rev(dej)]);
  const prep = relax([[cornerD[0] + 0.6 * MM, cornerD[1] - 0.3 * MM], ...offsetIn(inner, centre, (i, p) => (0.6 + 1.1 * wOf(p)) * MM),
    [cornerM[0] - 0.6 * MM, cornerM[1] - 0.3 * MM]], 2);
  const crownShell = smooth([...arc, ...rev(prep)]);
  const prepTooth = smooth([corner(cornerD), ...prep, corner(cornerM), ...rootArc]);

  // pulp
  const isM = kind === 'molar';
  const roofDepth = (isM ? 0.6 : kind === 'premolar' ? 0.6 : kind === 'canine' ? 0.52 : 0.48) * H;
  const chH = CW * (isM ? 0.5 : 0.36);
  const roof = prof.filter(([u]) => Math.abs(u) <= 0.8).map(([u, v]) => [50 + u * W * (isM ? 0.56 : 0.5), Math.min(Y(v) + roofDepth, CEJ - 0.8 * MM)]);
  const roofTopY = Math.min(...roof.map((p) => p[1]));
  const wallM = [[50 + chH, roof.at(-1)[1] + 0.12 * H], [50 + chH * 0.9, CEJ - 0.1 * MM]];
  const wallD = [[50 - chH * 0.9, CEJ - 0.1 * MM], [50 - chH, roof[0][1] + 0.12 * H]];
  const tIn = (r) => (n > 1 ? Math.max(r.tf * 0.7, (1.6 * MM) / r.L) : 0.1);
  const CT = [0.1, 0.25, 0.42, 0.6, 0.78, 0.92];
  const pulpPts = [...wallM];
  roots.forEach((r, i) => {
    CT.filter((t) => t >= (i === 0 ? 0.1 : tIn(r))).forEach((t) => pulpPts.push([r.c(t)[0] + r.ch(t), r.c(t)[1]]));
    pulpPts.push([r.c(0.96)[0], r.c(0.96)[1]]);
    rev(CT).filter((t) => t >= (i === n - 1 ? 0.1 : tIn(r))).forEach((t) => pulpPts.push([r.c(t)[0] - r.ch(t), r.c(t)[1]]));
    if (i < n - 1) pulpPts.push([(r.c(0)[0] + roots[i + 1].c(0)[0]) / 2, CEJ + 1.1 * MM]);
  });
  pulpPts.push(...wallD, ...roof);
  const pulp = smooth(pulpPts);
  const pulpPoly = sample(pulpPts);
  const floorY = CEJ + (n > 1 ? 1.2 : 0.9) * MM;
  const chamber = smooth([...wallM, corner([50 + chH * 0.8, floorY]), corner([50 - chH * 0.8, floorY]), ...wallD, ...roof]);
  const gp = (t) => 0.4 * MM * (1 - 0.6 * t) + 0.2;
  const canals = roots.map((r) => {
    const ts = [tIn(r) * (n > 1 ? 1 : 1.2), 0.3, 0.5, 0.7, 0.88].filter((t, i) => i === 0 || t > tIn(r));
    return smooth([...ts.map((t) => [r.c(t)[0] + gp(t), r.c(t)[1]]), [r.c(0.95)[0], r.c(0.95)[1]], ...rev(ts).map((t) => [r.c(t)[0] - gp(t), r.c(t)[1]])]);
  }).join('');
  const file = line([[r0.c(0)[0], top - 3.4 * MM], [r0.c(0)[0], top + H * 0.5], r0.c(0.15), r0.c(0.4), r0.c(0.65), r0.c(0.9)]);
  const post = line([r0.c(0.02), r0.c(0.2), r0.c(0.42)]);
  const aT = W * (isM ? 0.42 : 0.34), aB = chH * 0.75, accBot = roofTopY + 0.6 * MM;
  const access = smooth([corner([50 - aT, top - 4]), corner([50 + aT, top - 4]), corner([50 + aB, accBot]), corner([50 - aB, accBot])]);
  const tmpY = top + (accBot - top) * 0.5;
  const temp = smooth([corner([50 - aT, top - 4]), corner([50 + aT, top - 4]), corner([50 + aT - (aT - aB) * 0.5, tmpY]), corner([50 - aT + (aT - aB) * 0.5, tmpY])]);

  // gum and bone lines
  const gumMid = CEJ - 0.6 * MM, papY = CEJ - dip - 2.6 * MM;
  const xl = Math.max(10, 50 - W - 2), xr = Math.min(90, 50 + W + 2);
  const gumMargin = [[3, papY + 3], [xl, papY], [50 - CW - 1, (papY + gumMid) / 2 + 3], [50 - CW * 0.55, gumMid - 0.6], [50, gumMid],
    [50 + CW * 0.55, gumMid - 0.6], [50 + CW + 1, (papY + gumMid) / 2 + 3], [xr, papY], [97, papY + 3]];
  const boneY = CEJ + 1.7 * MM;
  const maxApex = Math.max(...roots.map((r) => r.c(1)[1]));
  const bottom = Math.min(198, maxApex + 12);
  const socket = smooth([corner([50 + CW + 1.5, gumMid - 2]), [50 + CW, CEJ], ...rootArc, [50 - CW, CEJ], corner([50 - CW - 1.5, gumMid - 2])]);
  const ridge = smooth([corner([xl - 6, papY + 2]), [50 - CW * 0.7, gumMid - 2], [50, gumMid - 3], [50 + CW * 0.7, gumMid - 2], corner([xr + 6, papY + 2]),
    corner([xr + 6, boneY + 4]), corner([xl - 6, boneY + 4])]);
  const calcPts = gumMargin.slice(2, 7);
  const calculus = smooth([...calcPts.map((p, i) => [p[0], p[1] - (1.7 + 0.7 * Math.sin(i * 2.3 + 1)) * MM]), ...rev(calcPts).map((p) => [p[0], p[1] + 0.8])]);

  // caries and cavities (section + front share these coordinates)
  const dejPoly = sample(dej, false);
  const kS = clamp(f.W / 9, 0.55, 1);
  const P = (o, d, u, v) => [o[0] + d[0] * u - d[1] * v, o[1] + d[1] * u + d[0] * v];
  const notchU = isM ? prof.filter((p, i) => i > 0 && i < prof.length - 1).reduce((b, p) => (Math.abs(p[0]) < Math.abs(b[0]) && p[1] > 0.1 ? p : b), [0, 0]) : [f.tip ?? 0, 0];
  const origins = {
    O: { o: [X(notchU[0]), Y(notchU[1]) + 0.2], d: [0, 1] },
    M: { o: [50 + W * 0.985, Y(cm + 0.08)], d: norm([-1, 0.35]) },
    D: { o: [50 - W * 0.985, Y(cd + 0.08)], d: norm([1, 0.35]) },
  };
  const slots = {};
  for (const [S, { o, d }] of Object.entries(origins)) {
    const dE = Math.min(rayHit(o, d, dejPoly, false), eT * 1.4);
    let dP = rayHit(o, d, pulpPoly);
    if (!Number.isFinite(dP) || dP > dE + 6 * MM) dP = dE + 3 * MM;
    for (const depth of DEPTHS) {
      let pts;
      if (depth === 'enamel') {
        const A = dE * 0.78, w0 = 0.85 * MM * kS;
        pts = [P(o, d, -2.5, -w0), P(o, d, -2.5, w0), P(o, d, A * 0.5, w0 * 0.75), P(o, d, A, 0.6), P(o, d, A + 0.3, -0.2), P(o, d, A * 0.5, -w0 * 0.8)];
      } else {
        const near = depth === 'near_pulp';
        const A = near ? dP - 0.35 * MM : dE + (dP - dE) * 0.5;
        const op = (near ? 0.75 : 0.5) * MM * kS, e = (near ? 3.2 : 2.4) * MM * kS, w = (near ? 3.8 : 2.8) * MM * kS;
        pts = [P(o, d, -2.5, -op), P(o, d, -2.5, op), P(o, d, dE * 0.55, op * 0.95 + 0.4), P(o, d, dE - 0.5, e / 2), P(o, d, dE + 0.6 * MM, w / 2 + 0.5),
          P(o, d, dE + (A - dE) * 0.55, w * 0.3), P(o, d, A, 1.2), P(o, d, A + 0.5, -0.9), P(o, d, dE + (A - dE) * 0.55, -w * 0.34 - 0.5),
          P(o, d, dE + 0.6 * MM, -w / 2), P(o, d, dE - 0.5, -e / 2 - 0.4), P(o, d, dE * 0.55, -op * 0.9)];
      }
      slots[`car.${S}.${depth}`] = smooth(pts);
    }
  }
  const cavDepth = eT + 1 * MM;
  const ca = 1.3 * MM * kS;
  const cO = origins.O.o;
  slots['cav.O'] = smooth([corner([cO[0] - ca * 1.2, cO[1] - 6]), corner([cO[0] + ca * 1.2, cO[1] - 6]), [cO[0] + ca, cO[1] + cavDepth * 0.7], [cO[0] + ca * 0.5, cO[1] + cavDepth], [cO[0] - ca * 0.5, cO[1] + cavDepth], [cO[0] - ca, cO[1] + cavDepth * 0.7]]);
  const cavSide = (sgn, c) => {
    const yb = Y(Math.min(c + 0.42, 0.85)), xi = 50 + sgn * W * 0.12, xm = 50 + sgn * W * 0.55, fy = top + cavDepth + (isM ? 0.12 * H : 0.05 * H);
    return smooth([corner([50 + sgn * (W + 4), top - 6]), corner([xi, top - 6]), [xi + sgn * 0.5, fy], corner([xm, fy + 1]), [xm + sgn * 0.5, yb], corner([50 + sgn * (W + 4), yb + 1])]);
  };
  slots['cav.M'] = cavSide(1, cm);
  slots['cav.D'] = cavSide(-1, cd);

  // front-only marks
  const fB = [50 + W * 0.08, gumMid - 1.7 * MM];
  const FS = { B: [fB, [1.1, 0.7]], M: [[50 + W * 0.93, Y(cm + 0.12)], [0.8, 1.2]], D: [[50 - W * 0.93, Y(cd + 0.12)], [0.8, 1.2]], O: [[X(notchU[0]), Y(notchU[1]) + 1.5], [1, 0.7]] };
  const fsurf = {};
  for (const [S, [p, [rx, ry]]] of Object.entries(FS)) fsurf['fsurf.' + S] = [r1(p[0] - rx * MM * kS * 1.2), r1(p[1] - ry * MM * kS * 1.2), r1(2.4 * rx * MM * kS), r1(2.4 * ry * MM * kS)];
  slots['fcav.M'] = smooth([corner([50 + W + 3, Y(cm - 0.1)]), [50 + W * 0.62, Y(cm)], [50 + W * 0.55, Y(cm + 0.2)], [50 + W * 0.68, Y(cm + 0.42)], corner([50 + W + 3, Y(cm + 0.45)])]);
  slots['fcav.D'] = smooth([corner([50 - W - 3, Y(cd - 0.1)]), [50 - W * 0.62, Y(cd)], [50 - W * 0.55, Y(cd + 0.2)], [50 - W * 0.68, Y(cd + 0.42)], corner([50 - W - 3, Y(cd + 0.45)])]);
  fsurf['fcav.B'] = [r1(50 - CW * 0.75), r1(gumMid - 2.5 * MM), r1(CW * 1.5), r1(2.2 * MM)];
  fsurf['fcav.O'] = [r1(X(notchU[0]) - W * 0.32), r1(Y(notchU[1])), r1(W * 0.64), r1(2.4 * MM)];

  const apex = roots.map((r) => { const a = r.c(1); return [r1(a[0] - 3.6 * MM), r1(a[1] - 3.6 * MM), r1(7.2 * MM), r1(7.2 * MM)]; });
  const anchors = {
    crown: [r1(50 - W), r1(top), r1(2 * W), r1(H)],
    neck: [r1(50 - CW - MM), r1(gumMid - 2.2 * MM), r1(2 * CW + 2 * MM), r1(3 * MM)],
    implant: [r1(50 - 2.1 * MM), r1(CEJ + 0.8 * MM), r1(4.2 * MM), r1(Math.min(r0.len * 0.85, 11.5) * MM)],
    abut: [r1(50 - 1.7 * MM), r1(top + H * 0.32), r1(3.4 * MM), r1(CEJ + 0.8 * MM - (top + H * 0.32))],
    accessTop: [r1(r0.c(0)[0] - 1.4 * MM), r1(top - 7.6 * MM), r1(2.8 * MM), r1(4.4 * MM)],
    pocketM: [r1(50 + CW + 0.2), r1(gumMid - 0.6), 0, 0],
    pocketD: [r1(50 - CW - 0.2), r1(gumMid - 0.6), 0, 0],
    apex,
    ...fsurf,
  };
  Object.assign(slots, {
    crown, tooth, root, enamel, pulp, chamber, canals, file, post, access, temp, prep: line(prep), crownShell, prepTooth,
    socket, ridge, calculus, gumLine: line(gumMargin.slice(2, -2)),
  });
  return {
    f, W, CW, H, top, dip, X, Y, prof, arc, crown, tooth, root, enamel, dej, pulp, rootArc, roots, gumMargin, gumMid, papY,
    boneY, bottom, slots, anchors, kind, isM, cm, cd,
  };
}

// ---------- materials (front + section share coordinates) ----------
function materials(G) {
  const { top, H, bottom } = G;
  const cy0 = top, cy1 = CEJ;
  return [
    lin('porc', 0, cy0, 0, cy1, [[0, 'porcelainHi'], [0.3, 'porcelain'], [0.85, 'porcelain'], [1, 'porcelainNeck']]),
    lin('metal', 50 - G.W, cy0, 50 + G.W, cy1, [[0, '#E6E9EC'], [0.35, '#A9B0B7'], [0.6, '#D7DBDF'], [1, '#7D858D']]),
    lin('gold', 50 - G.W, cy0, 50 + G.W, cy1, [[0, '#F7E3A1'], [0.35, '#D9A93E'], [0.62, '#F2D27A'], [1, '#A8761F']]),
    lin('amal', 50 - G.W, cy0, 50 + G.W, cy0 + H, [[0, 'amalgamHi'], [0.35, 'amalgam'], [0.78, 'amalgamDeep'], [1, 'amalgam']]),
    lin('gp', 0, CEJ, 0, bottom - 10, [[0, 'gutta'], [1, 'guttaDeep']]),
    lin('clot', 0, CEJ - 6, 0, bottom - 10, [[0, '#B2333B'], [0.2, '#7E1720'], [1, '#56101A']]),
    lin('socketG', 0, CEJ - 6, 0, bottom - 10, [[0, '#C9545C'], [0.3, '#9C3440'], [1, '#6F2230']]),
    lin('calc', 0, CEJ - 4 * MM, 0, CEJ, [[0, '#D9C690'], [0.6, '#C2A35E'], [1, '#9C7B3C']]),
    glow('gloss', 50 + G.W * 0.3, top + H * 0.35, G.W * 0.5, 0.85, 1.6),
  ];
}

// ---------- front view ----------
function front(G, T) {
  const { W, CW, H, top, crown, root, gumMargin, bottom, X, Y, kind, isM, prof } = G;
  const ant = kind === 'incisor' || kind === 'canine';
  const gum = smooth([corner([3, gumMargin[0][1]]), ...gumMargin.slice(1, -1), corner([97, gumMargin.at(-1)[1]]), [97, (CEJ + bottom) / 2], [97, bottom - 8],
    [96, bottom - 3], [92, bottom - 0.5], [50, bottom], [8, bottom - 0.5], [4, bottom - 3], [3, bottom - 8], [3, (CEJ + bottom) / 2]]);
  const lobesU = isM ? T.front.cusps.map((c) => c.u) : ant ? [-0.55, 0, 0.55] : [-0.5, 0.02, 0.5];
  const g = [
    lin('body', 0, top, 0, CEJ, ant ? [[0, 'tipTrans'], [0.1, 'enamelHi'], [0.42, 'enamel'], [0.8, 'neck'], [1, 'neckDeep']] : [[0, 'enamelHi'], [0.14, 'enamelHi'], [0.42, 'enamel'], [0.8, 'neck'], [1, 'neckDeep']]),
    lin('side', 50 - W, 0, 50 + W, 0, [[0, 'shadow', 0.55], [0.17, 'shadow', 0], [0.74, 'shadow', 0], [1, 'shadow', 0.62]]),
    ...lobesU.map((u, i) => glow('lobe' + i, X(u), top + H * 0.42, W * (isM ? 0.34 : 0.3), ant ? 0.2 : 0.32, isM ? 1.7 : 3)),
    rad('neckShade', 50, CEJ, CW * 1.1, [[0, 'neckDeep', 0.38], [1, 'neckDeep', 0]], 0.4),
    glow('specA', X(0.3), top + H * 0.36, W * 0.16, 0.8, ant ? 3.4 : 1.9), glow('specB', X(-0.42), top + H * 0.34, W * 0.11, 0.5, ant ? 3.4 : 1.8),
    lin('gum', 0, gumMargin[1][1] - 2, 0, bottom, [[0, 'gumLight'], [0.12, 'gum'], [0.5, 'gumMid'], [1, 'gumDeep']]),
    lin('rootGhost', 0, CEJ - 4, 0, bottom - 12, [[0, 'root', 0], [0.15, 'root'], [1, 'rootDeep']]),
    lin('gumSide', 3, 0, 97, 0, [[0, 'mucosa', 0.16], [0.2, 'mucosa', 0], [0.8, 'mucosa', 0], [1, 'mucosa', 0.2]]),
  ];
  if (ant) g.push(lin('trans', 0, top, 0, top + H * 0.2, [[0, 'translucent', 0.75], [0.45, 'translucent', 0.35], [1, 'translucent', 0]]));
  const layers = [
    L('enamel', crown, 'g:body'),
    ...lobesU.map((u, i) => L('lobe' + i, ellipse(X(u), top + H * 0.42, W * (isM ? 0.36 : 0.3), H * (isM ? 0.4 : 0.48)), 'g:lobe' + i, { clip: 'crown' })),
  ];
  if (ant) layers.push(L('translucency', poly([[50 - W - 2, top - 3], [50 + W + 2, top - 3], [50 + W + 2, top + H * 0.2], [50 - W - 2, top + H * 0.2]]), 'g:trans', { clip: 'crown' }));
  layers.push(L('enamelSide', crown, 'g:side'));
  if (isM) {
    const notches = prof.filter((p, i) => i > 1 && i < prof.length - 2 && p[1] > prof[i - 1][1] && p[1] > prof[i + 1][1]);
    const gr = notches.map(([u, v]) => line([[X(u), Y(v) + 0.4], [X(u) - 0.3, Y(v) + H * 0.22], [X(u) - 0.6, Y(v) + H * 0.38]])).join('');
    if (gr) {
      layers.push(L('grooveValley', gr, null, { s: 'shadow', w: 3, op: 0.13, clip: 'crown' }), L('fissures', gr, null, { s: 'fissure', w: 0.7, op: 0.55, clip: 'crown' }));
      layers.push(L('buccalPit', notches.map(([u, v]) => ellipse(X(u) - 0.6, Y(v) + H * 0.39, 0.8, 1.1)).join(''), 'fissure', { op: 0.5 }));
    }
    layers.push(L('cervicalRidge', ellipse(50, CEJ - H * 0.2, W * 0.9, H * 0.1), 'white', { op: 0.08, clip: 'crown' }));
  } else {
    layers.push(L('grooveValley', line([[X(-0.3), top + H * 0.12], [X(-0.28), top + H * 0.55]]) + line([[X(0.3), top + H * 0.12], [X(0.28), top + H * 0.55]]), null, { s: 'shadow', w: 3, op: 0.06, clip: 'crown' }));
  }
  if (kind === 'incisor') layers.push(L('incisalHalo', line(prof.slice(1, -1).map(([u, v]) => [X(u), Y(v) + 1.2])), null, { s: 'enamelHi', w: 0.8, op: 0.5, clip: 'crown' }));
  layers.push(
    L('neckShade', ellipse(50, CEJ, CW * 1.2, H * 0.22), 'g:neckShade', { clip: 'crown' }),
    L('specular', ellipse(X(0.3), top + H * 0.36, W * 0.17, H * (ant ? 0.32 : 0.16)), 'g:specA', { clip: 'crown' }),
    L('specular2', ellipse(X(-0.42), top + H * 0.34, W * 0.12, H * (ant ? 0.22 : 0.12)), 'g:specB', { clip: 'crown' }),
    L('crownEdge', crown, null, { s: 'shadow', w: 0.7, op: 0.5 }),
    L('gumShadow', line(gumMargin), null, { s: 'neckDeep', w: 4.5, op: 0.28, clip: 'crown' }),
    L('gum', gum, 'g:gum'),
    L('gumSide', gum, 'g:gumSide'),
    L('gumMargin', line(gumMargin.slice(2, -2)), null, { s: 'gumLight', w: 1.6, op: 0.85 }),
    L('rootGhost', root, 'g:rootGhost', { op: 0.36, clip: 'belowGum' }),
    L('rootGhostEdge', root, null, { s: 'rootDeep', w: 0.6, op: 0.22, clip: 'belowGum' }),
  );
  return { box: [0, r1(top - 8), 100, r1(bottom - top + 10)], g, clips: { crown, belowGum: gum, tooth: G.tooth }, layers };
}

// ---------- section view ----------
let TEX_ID = '__TEX__';
function section(G) {
  const { W, CW, H, top, gumMargin, bottom, boneY, roots, dej, papY, gumMid } = G;
  const gm = gumMargin;
  const gumCut = smooth([corner([3, gm[0][1]]), ...gm.slice(1, -1), corner([97, gm.at(-1)[1]]), corner([97, boneY + 10]), [88, boneY + 7], [50, boneY + 9], [12, boneY + 7], corner([3, boneY + 10])]);
  const crest = [[3, boneY - 3], [Math.max(8, 50 - W - 4), boneY - 4.5], [50 - CW - 2, boneY], [50, boneY + 2], [50 + CW + 2, boneY], [Math.min(92, 50 + W + 4), boneY - 4.5], [97, boneY - 3]];
  const bone = smooth([corner(crest[0]), ...crest.slice(1, -1), corner(crest.at(-1)), [97, bottom - 8], [96, bottom - 3], [92, bottom - 0.5], [50, bottom], [8, bottom - 0.5], [4, bottom - 3], [3, bottom - 8]]);
  // tubules: S-curves from pulp roof to DEJ, short strokes in the roots
  let tub = '';
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, p = dej[Math.round(1 + t * (dej.length - 3))];
    const x0 = 50 + (t - 0.5) * CW * 1.0, y0 = top + H * 0.62 + Math.abs(t - 0.5) * H * 0.2;
    tub += line([[x0, y0], [x0 + (p[0] - x0) * 0.35 + 1.4, y0 + (p[1] - y0) * 0.35], [x0 + (p[0] - x0) * 0.7 - 1.4, y0 + (p[1] - y0) * 0.7], [p[0], p[1] + 0.6]]);
  }
  for (const r of roots) for (let t = 0.2; t < 0.85; t += 0.13) {
    const c = r.c(t), h = r.hw(t) * (r === roots[0] && roots.length > 1 ? 1 : 1);
    tub += line([[c[0] + r.ch(t) + 0.6, c[1]], [c[0] + h * 0.6, c[1] - 1], [c[0] + h * 0.9, c[1] - 1.8]]) + line([[c[0] - r.ch(t) - 0.6, c[1]], [c[0] - h * 0.6, c[1] - 1], [c[0] - h * 0.9, c[1] - 1.8]]);
  }
  const vessel = roots.map((r) => line([r.c(0.95), r.c(0.7), r.c(0.4), r.c(0.15), [r.c(0)[0], CEJ - 0.25 * H]])).join('') + line([[50 - CW * 0.4, CEJ - H * 0.22], [50, CEJ - H * 0.3], [50 + CW * 0.4, CEJ - H * 0.22]]);
  const g = [
    lin('gumCut', 0, papY, 0, boneY + 10, [[0, 'gumCut'], [0.55, 'gumCutDeep'], [0.8, 'gumCutDeep', 0.8], [1, 'gumCutDeep', 0]]),
    lin('bone', 0, boneY - 4, 0, 200, [[0, 'boneCortex'], [0.12, 'bone'], [1, 'boneDeep']]),
    lin('dentin', 0, top, 0, bottom - 15, [[0, 'dentin'], [0.45, 'dentin'], [1, 'dentinDeep']]),
    lin('enamelCut', 0, top, 0, CEJ, [[0, 'enamelCut'], [0.55, 'enamelCut'], [1, 'enamelCutDeep']]),
    rad('pulp', 50, CEJ - H * 0.1, CW * 1.2, [[0, 'pulp'], [0.7, 'pulpDeep'], [1, 'pulpDeep']], 3),
    glow('enamelSheen', 50 + W * 0.25, top + H * 0.12, W * 0.5, 0.5, 0.7),
    rad('pulpInf', 50, CEJ - H * 0.2, CW * 1.1, [[0, 'pulpInflamed'], [0.55, 'pulpInflamed'], [1, 'pulpInflamedDeep']], 3.2),
  ];
  const layers = [
    L('bone', bone, 'g:bone'),
    L('boneTexture', TEX_ID, 'boneHole', { op: 0.38, clip: 'bone' }),
    L('boneCrest', line(crest.slice(0, 3)) + line(crest.slice(4)), null, { s: 'boneCortex', w: 1.8, op: 0.9, clip: 'bone' }),
    L('laminaDura', G.slots.root, null, { s: 'boneCortex', w: 3.8, clip: 'bone' }),
    L('pdl', G.slots.root, null, { s: 'pdl', w: 1.7, op: 0.8, clip: 'bone' }),
    L('gum', gumCut, 'g:gumCut'),
    L('dentin', G.tooth, 'g:dentin'),
    L('tubules', tub, null, { s: 'dentinLine', w: 0.3, op: 0.22, clip: 'tooth' }),
    L('enamel', G.enamel, 'g:enamelCut'),
    L('enamelSheen', ellipse(50 + W * 0.25, top + H * 0.12, W * 0.9, H * 0.16), 'g:enamelSheen', { clip: 'enamel' }),
    L('dej', line(dej), null, { s: 'dentinDeep', w: 0.5, op: 0.45 }),
    L('pulp', G.pulp, 'g:pulp'),
    L('vessels', vessel, null, { s: 'vessel', w: 0.55, op: 0.6, clip: 'pulp' }),
    L('nerve', vessel, null, { s: 'nerve', w: 0.45, op: 0.7, clip: 'pulp' }),
    L('toothEdge', G.tooth, null, { s: 'shadow', w: 0.6, op: 0.45 }),
  ];
  void gumMid;
  return { box: [0, r1(top - 8), 100, r1(bottom - top + 10)], g, clips: { tooth: G.tooth, bone, enamel: G.enamel, pulp: G.pulp, crown: G.crown }, layers };
}

// ---------- top (occlusal) view ----------
function top(T) {
  const t = T.top, Wt = (t.W * MM) / 2, Dt = (t.D * MM) / 2;
  const M = t.uv ? (p) => [50 + p[0] * Wt, 100 + p[1] * Dt, p[2]] : (p) => [50 + ((p[0] - 50) / 34) * Wt, 100 + ((p[1] - 100) / 33) * Dt, p[2]];
  const R = t.uv ? (r) => r * Math.min(Wt, Dt) : (r) => (r / 33.5) * Math.min(Wt, Dt);
  const P = (p) => { const q = M(p); return q[2] ? q : [q[0], q[1]]; };
  const outlinePts = t.outline.map(P);
  const outline = smooth(outlinePts);
  const cen = P(t.center);
  const cusps = t.cusps.map(([x, y, r]) => { const p = M([x, y]); return [p[0], p[1], R(r)]; });
  const gd = t.grooves.map((gp) => line(gp.map(P))).join('');
  const md = t.minor.map((gp) => line(gp.map(P))).join('');
  const xd = t.ext.map((gp) => line(gp.map(P))).join('');
  const rr = Math.max(Wt, Dt) * 1.08;
  const g = [
    rad('dome', 50, 100, rr, [[0, 'enamel'], [0.55, 'enamel'], [0.82, 'neck'], [1, 'neckDeep']]),
    rad('domeLight', 50 - Wt * 0.3, 100 - Dt * 0.4, rr * 0.92, [[0, 'white', 0.32], [1, 'white', 0]]),
    rad('rim', 50, 100, rr, [[0, 'shadow', 0], [0.78, 'shadow', 0], [1, 'shadow', 0.5]]),
    ...t.fossae.map(([x, y, rx, ry, op], i) => { const p = M([x, y]); return rad('fossa' + i, p[0], p[1], R(rx), [[0, 'shadow', op], [1, 'shadow', 0]], ry / rx); }),
    ...cusps.map(([x, y, r], i) => rad('cusp' + i, x - 1.5, y - 1.5, r, [[0, 'enamelHi', 0.95], [0.5, 'enamelHi', 0.45], [1, 'enamelHi', 0]])),
    ...cusps.map(([x, y, r], i) => rad('cuspSh' + i, x + 3, y + 3.2, r * 1.05, [[0, 'shadow', 0], [0.45, 'shadow', 0.15], [1, 'shadow', 0]])),
  ];
  const layers = [
    L('enamel', outline, 'g:dome'),
    L('domeLight', outline, 'g:domeLight'),
    ...t.fossae.map(([x, y, rx, ry], i) => { const p = M([x, y]); return L('fossa' + i, ellipse(p[0], p[1], R(rx), R(ry)), 'g:fossa' + i, { clip: 'crown' }); }),
    ...cusps.map(([x, y, r], i) => L('cuspSh' + i, ellipse(x + 3, y + 3.2, r * 1.05, r * 1.05), 'g:cuspSh' + i, { clip: 'crown' })),
    ...cusps.map(([x, y, r], i) => L('cusp' + i, ellipse(x - 1.5, y - 1.5, r, r), 'g:cusp' + i, { clip: 'crown' })),
  ];
  if (t.grooves.length) layers.push(L('triRidges', cusps.map(([x, y]) => line([[x, y], [x + (cen[0] - x) * 0.55, y + (cen[1] - y) * 0.55]])).join(''), null, { s: 'white', w: 3.2, op: 0.09 }));
  layers.push(L('marginalRidges', t.ridges.map((r) => line(r.map(P))).join(''), null, { s: 'white', w: 3, op: 0.14, clip: 'crown' }));
  if (t.edge) {
    const e = t.edge.map(P);
    layers.push(L('edgeShadow', line(e.map(([x, y]) => [x, y - 1.6])), null, { s: 'shadow', w: 2.2, op: 0.12, clip: 'crown' }),
      L('incisalEdge', line(e), null, { s: 'enamelHi', w: 1.3, op: 0.45, clip: 'crown' }));
  }
  layers.push(L('rim', outline, 'g:rim'));
  if (gd) layers.push(L('grooveValley', gd, null, { s: 'shadow', w: 6, op: 0.12, clip: 'crown' }), L('grooveValley2', gd + md, null, { s: 'shadow', w: 2.1, op: 0.18, clip: 'crown' }));
  if (xd) layers.push(L('grooveExt', xd, null, { s: 'shadow', w: 1.5, op: 0.18, clip: 'crown' }));
  if (gd) layers.push(L('fissures', gd + md, null, { s: 'fissure', w: 0.6, op: 0.55, clip: 'crown' }));
  if (t.pits.length) layers.push(L('pits', t.pits.map((p) => { const q = P(p); return ellipse(q[0], q[1], 1.1, 1); }).join(''), 'fissure', { op: 0.7 }));
  layers.push(L('glints', cusps.map(([x, y, r]) => ellipse(x - r * 0.22, y - r * 0.24, Math.max(0.8, r * 0.1), Math.max(0.5, r * 0.065))).join(''), 'white', { op: 0.35 }),
    L('crownEdge', outline, null, { s: 'shadow', w: 0.7, op: 0.5 }));

  // surface marks (caries per depth, cavity outlines for fillings)
  const xs = outlinePts.map((p) => p[0]), ys = outlinePts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const posterior = t.grooves.length > 0;
  const at = {
    O: cen, M: [x1 - (x1 - x0) * 0.12, cen[1]], D: [x0 + (x1 - x0) * 0.12, cen[1]], B: [50, y1 - (y1 - y0) * 0.11], L: [50, y0 + (y1 - y0) * 0.11],
  };
  const slots = { outline, grooves: gd + md };
  const anchors = {};
  const kS = clamp(t.W / 9, 0.55, 1);
  for (const [S, p] of Object.entries(at)) {
    const r = 1.3 * MM * kS, long = S === 'O' && posterior ? 1.7 : S === 'O' ? 2 : 1;
    const ry = S === 'O' && !posterior ? r * 0.45 : r * (S === 'M' || S === 'D' ? 1.1 : 0.8);
    anchors['surf.' + S] = [r1(p[0] - r * long), r1(p[1] - ry), r1(2 * r * long), r1(2 * ry)];
  }
  const hw = 0.85 * MM * kS;
  const centralGroove = t.grooves[0]?.map(P);
  slots['cav.O'] = posterior && centralGroove ? capsule(centralGroove.length > 3 ? centralGroove.slice(1, -1) : centralGroove, hw)
    : t.edge ? capsule(t.edge.map(P).map(([x, y]) => [x, y - 0.5]), hw * 0.7) : blob(cen[0], cen[1], hw * 1.5, hw, 2, 0.05);
  slots['cav.M'] = capsule([[cen[0], cen[1]], [x1 - (x1 - cen[0]) * 0.4, cen[1]], [x1 + 3, cen[1]]], hw * 1.2);
  slots['cav.D'] = capsule([[cen[0], cen[1]], [x0 + (cen[0] - x0) * 0.4, cen[1]], [x0 - 3, cen[1]]], hw * 1.2);
  const pad = 6;
  return {
    box: [r1(x0 - pad), r1(y0 - pad), r1(x1 - x0 + 2 * pad), r1(y1 - y0 + 2 * pad)],
    g, clips: { crown: outline }, layers, slots, anchors,
    mat: [
      rad('porc', 50, 100, rr, [[0, 'porcelainHi'], [0.5, 'porcelain'], [0.85, 'porcelain'], [1, 'porcelainNeck']]),
      rad('metal', 50 - Wt * 0.3, 100 - Dt * 0.3, rr * 1.2, [[0, '#EEF0F2'], [0.45, '#AEB5BC'], [1, '#6E767E']]),
      rad('gold', 50 - Wt * 0.3, 100 - Dt * 0.3, rr * 1.2, [[0, '#FBEDB8'], [0.45, '#DDAE45'], [1, '#9C6C1A']]),
      lin('amal', x0, y0, x1, y1, [[0, 'amalgamHi'], [0.4, 'amalgam'], [0.8, 'amalgamDeep'], [1, 'amalgam']]),
      glow('gloss', 50 - Wt * 0.25, 100 - Dt * 0.35, rr * 0.45, 0.75),
    ],
  };
}

export function buildTooth(key, T) {
  const G = geometry(T);
  const fr = front(G, T);
  const se = section(G);
  const tp = top(T);
  return {
    type: key, label: T.label, arch: T.arch, primary: !!T.primary,
    views: { front: fr, section: se, top: tp },
    geo: G.slots, anchors: G.anchors, mat: materials(G),
  };
}

// Crown outline normalised to u in [-1, 1] (mesial +) and v in [0, 1] (tip to CEJ), for the brushing art.
export function crownNorm(T) {
  const G = geometry(T);
  const pts = [...G.arc, [50 + G.CW * 0.55, CEJ - G.dip * 0.35], [50, CEJ], [50 - G.CW * 0.55, CEJ - G.dip * 0.35]];
  return pts.map((p) => [(p[0] - 50) / G.W, (p[1] - G.top) / G.H, p[2]]);
}
