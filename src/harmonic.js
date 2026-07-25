// Harmonic tidal analysis & prediction for Dieppe — shared module
// Method: classical least-squares harmonic analysis (Schureman / IHO standard)
// h(t) = Z0 + sum_k f_k(t) * [X_k cos(theta_k) + Y_k sin(theta_k)],  theta_k = V_k(t) + u_k(t)
'use strict';

const D2R = Math.PI / 180;

// hours since 2000-01-01T00:00:00Z
function hoursJ2000(ms) { return (ms - Date.UTC(2000, 0, 1)) / 3600000; }

// Astronomical mean elements (degrees), T in Julian centuries since J2000.0 (2000-01-01T12:00Z)
function astro(tH) {
  const T = (tH - 12) / 876600;
  const s = 218.3164477 + 481267.88123421 * T - 0.0015786 * T * T;   // Moon mean longitude
  const h = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;         // Sun mean longitude
  const p = 83.3532465 + 4069.0137287 * T - 0.0103200 * T * T;       // Lunar perigee
  const N = 125.04452 - 1934.136261 * T + 0.0020708 * T * T;         // Lunar node
  const pp = 282.93768 + 1.71946 * T;                                 // Solar perigee
  const tau = 15 * tH + h - s;                                        // mean lunar time angle
  return { s, h, p, N, pp, tau };
}

// f,u families. u in degrees. N in degrees.
function nodalFactors(N) {
  const n = N * D2R;
  const c = Math.cos(n), c2 = Math.cos(2 * n), c3 = Math.cos(3 * n);
  const s1 = Math.sin(n), s2 = Math.sin(2 * n), s3 = Math.sin(3 * n);
  return {
    fMm: 1.0 - 0.1300 * c + 0.0013 * c2,          uMm: 0,
    fMf: 1.0429 + 0.4135 * c - 0.004 * c2,        uMf: -23.74 * s1 + 2.68 * s2 - 0.38 * s3,
    fO1: 1.0089 + 0.1871 * c - 0.0147 * c2 + 0.0014 * c3, uO1: 10.80 * s1 - 1.34 * s2 + 0.19 * s3,
    fK1: 1.0060 + 0.1150 * c - 0.0088 * c2 + 0.0006 * c3, uK1: -8.86 * s1 + 0.68 * s2 - 0.07 * s3,
    fJ1: 1.0129 + 0.1676 * c - 0.0170 * c2 + 0.0016 * c3, uJ1: -12.94 * s1 + 1.34 * s2 - 0.19 * s3,
    fOO1: 1.1027 + 0.6504 * c + 0.0317 * c2 - 0.0014 * c3, uOO1: -36.68 * s1 + 4.02 * s2 - 0.57 * s3,
    fM2: 1.0004 - 0.0373 * c + 0.0002 * c2,       uM2: -2.14 * s1,
    fK2: 1.0241 + 0.2863 * c + 0.0083 * c2 - 0.0015 * c3, uK2: -17.74 * s1 + 0.68 * s2 - 0.04 * s3,
  };
}

// Constituents: [name, n1..n6 Doodson (5-subtracted), phase90 (multiples of 90 deg), family]
// family selects f,u: '1'=unity, 'O1','K1','J1','OO1','M2','K2','Mm','Mf',
// compounds: 'M2xM2','M2xM2xM2','M2xM2xM2xM2','M2xK1','M2xM2xK1','M2xK2','MSf'
const CONSTITUENTS = [
  // long period
  ['Sa',    0, 0, 1, 0, 0, 0, 0, '1'],
  ['Ssa',   0, 0, 2, 0, 0, 0, 0, '1'],
  ['MSm',   0, 1,-2, 1, 0, 0, 0, 'Mm'],
  ['Mm',    0, 1, 0,-1, 0, 0, 0, 'Mm'],
  ['MSf',   0, 2,-2, 0, 0, 0, 0, 'MSf'],
  ['Mf',    0, 2, 0, 0, 0, 0, 0, 'Mf'],
  ['Mtm',   0, 3, 0,-1, 0, 0, 0, 'Mf'],
  // diurnal
  ['2Q1',   1,-3, 0, 2, 0, 0,  90, 'O1'],
  ['sigma1',1,-3, 2, 0, 0, 0,  90, 'O1'],
  ['Q1',    1,-2, 0, 1, 0, 0,  90, 'O1'],
  ['rho1',  1,-2, 2,-1, 0, 0,  90, 'O1'],
  ['O1',    1,-1, 0, 0, 0, 0,  90, 'O1'],
  ['chi1',  1, 0, 2,-1, 0, 0, -90, 'J1'],
  ['pi1',   1, 1,-3, 0, 0, 1,  90, '1'],
  ['P1',    1, 1,-2, 0, 0, 0,  90, '1'],
  ['S1',    1, 1,-1, 0, 0, 0,   0, '1'],
  ['K1',    1, 1, 0, 0, 0, 0, -90, 'K1'],
  ['J1',    1, 2, 0,-1, 0, 0, -90, 'J1'],
  ['OO1',   1, 3, 0, 0, 0, 0, -90, 'OO1'],
  // semidiurnal
  ['eps2',  2,-3, 2, 1, 0, 0, 0, 'M2'],
  ['2N2',   2,-2, 0, 2, 0, 0, 0, 'M2'],
  ['mu2',   2,-2, 2, 0, 0, 0, 0, 'M2'],
  ['N2',    2,-1, 0, 1, 0, 0, 0, 'M2'],
  ['nu2',   2,-1, 2,-1, 0, 0, 0, 'M2'],
  ['gamma2',2,-1, 2, 1, 0, 0, 180, 'M2'],
  ['MA2',   2, 0,-1, 0, 0, 0, 0, 'M2'],
  ['M2',    2, 0, 0, 0, 0, 0, 0, 'M2'],
  ['MB2',   2, 0, 1, 0, 0, 0, 0, 'M2'],
  ['MKS2',  2, 0, 2, 0, 0, 0, 0, 'M2xK2'],
  ['delta2',2, 1,-3, 1, 0, 1, 0, 'M2'],
  ['lambda2',2,1,-2, 1, 0, 0, 180, 'M2'],
  ['L2',    2, 1, 0,-1, 0, 0, 180, 'M2'],
  ['T2',    2, 2,-3, 0, 0, 1, 0, '1'],
  ['S2',    2, 2,-2, 0, 0, 0, 0, '1'],
  ['R2',    2, 2,-1, 0, 0,-1, 180, '1'],
  ['K2',    2, 2, 0, 0, 0, 0, 0, 'K2'],
  ['MSN2',  2, 3,-2,-1, 0, 0, 0, 'M2xM2u0'],
  ['KJ2',   2, 3, 0,-1, 0, 0, 0, 'K2'],
  ['2SM2',  2, 4,-4, 0, 0, 0, 0, 'M2'],
  // third-diurnal
  ['2MK3',  3,-1, 0, 0, 0, 0,  90, 'M2xM2xK1'],
  ['M3',    3, 0, 0, 0, 0, 0, 0, 'M2'],
  ['MK3',   3, 1, 0, 0, 0, 0, -90, 'M2xK1'],
  ['SK3',   3, 3,-2, 0, 0, 0, -90, 'K1'],
  // third-diurnal (solar-lunar extra)
  ['SO3',   3, 1,-2, 0, 0, 0,  90, 'O1'],
  // quarter-diurnal
  ['N4',    4,-2, 0, 2, 0, 0, 0, 'M2xM2'],
  ['3MS4',  4,-2, 2, 0, 0, 0, 0, 'M2xM2xM2'],
  ['MN4',   4,-1, 0, 1, 0, 0, 0, 'M2xM2'],
  ['M4',    4, 0, 0, 0, 0, 0, 0, 'M2xM2'],
  ['SN4',   4, 1,-2, 1, 0, 0, 0, 'M2'],
  ['MS4',   4, 2,-2, 0, 0, 0, 0, 'M2'],
  ['MK4',   4, 2, 0, 0, 0, 0, 0, 'M2xK2'],
  ['SK4',   4, 4,-2, 0, 0, 0, 0, 'K2'],
  ['S4',    4, 4,-4, 0, 0, 0, 0, '1'],
  // sixth-diurnal
  ['2MN6',  6,-1, 0, 1, 0, 0, 0, 'M2xM2xM2'],
  ['M6',    6, 0, 0, 0, 0, 0, 0, 'M2xM2xM2'],
  ['MSN6',  6, 1,-2, 1, 0, 0, 0, 'M2xM2'],
  ['2MS6',  6, 2,-2, 0, 0, 0, 0, 'M2xM2'],
  ['2MK6',  6, 2, 0, 0, 0, 0, 0, 'M2xM2xK2'],
  ['2SM6',  6, 4,-4, 0, 0, 0, 0, 'M2'],
  ['S6',    6, 6,-6, 0, 0, 0, 0, '1'],
  // eighth-diurnal
  ['3MN8',  8,-1, 0, 1, 0, 0, 0, 'M2xM2xM2xM2'],
  ['M8',    8, 0, 0, 0, 0, 0, 0, 'M2xM2xM2xM2'],
  ['3MS8',  8, 2,-2, 0, 0, 0, 0, 'M2xM2xM2'],
  ['2MS8',  8, 4,-4, 0, 0, 0, 0, 'M2xM2'],
];

// optional extra constituents discovered by residual scan (generic f=1,u=0)
try {
  const extra = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, 'extra.json'), 'utf8'));
  for (const e of extra) CONSTITUENTS.push([e[0], e[1], e[2], e[3], e[4], 0, e[5] || 0, 0, '1']);
} catch (err) { /* no extras */ }

function fu(family, nf) {
  switch (family) {
    case '1':  return [1, 0];
    case 'O1': return [nf.fO1, nf.uO1];
    case 'K1': return [nf.fK1, nf.uK1];
    case 'J1': return [nf.fJ1, nf.uJ1];
    case 'OO1':return [nf.fOO1, nf.uOO1];
    case 'M2': return [nf.fM2, nf.uM2];
    case 'K2': return [nf.fK2, nf.uK2];
    case 'Mm': return [nf.fMm, 0];
    case 'Mf': return [nf.fMf, nf.uMf];
    case 'MSf':return [nf.fM2, -nf.uM2];
    case 'M2xM2': return [nf.fM2 * nf.fM2, 2 * nf.uM2];
    case 'M2xM2u0': return [nf.fM2 * nf.fM2, 0];
    case 'M2xM2xM2': return [nf.fM2 ** 3, 3 * nf.uM2];
    case 'M2xM2xM2xM2': return [nf.fM2 ** 4, 4 * nf.uM2];
    case 'M2xK1': return [nf.fM2 * nf.fK1, nf.uM2 + nf.uK1];
    case 'M2xM2xK1': return [nf.fM2 * nf.fM2 * nf.fK1, 2 * nf.uM2 - nf.uK1];
    case 'M2xK2': return [nf.fM2 * nf.fK2, nf.uM2 + nf.uK2];
    case 'M2xM2xK2': return [nf.fM2 * nf.fM2 * nf.fK2, 2 * nf.uM2 + nf.uK2];
    default: throw new Error('family ' + family);
  }
}

// theta_k(t) and f_k(t) for all constituents at time tH (hours since 2000-01-01Z)
function basis(tH) {
  const a = astro(tH);
  const nf = nodalFactors(a.N);
  const out = new Array(CONSTITUENTS.length);
  for (let k = 0; k < CONSTITUENTS.length; k++) {
    const C = CONSTITUENTS[k];
    const V = C[1] * a.tau + C[2] * a.s + C[3] * a.h + C[4] * a.p + C[5] * (-a.N) + C[6] * a.pp + C[7];
    const [f, u] = fu(C[8], nf);
    out[k] = [f, (V + u) * D2R];
  }
  return out;
}

// Solve A x = b via Gaussian elimination with partial pivoting
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let mx = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[mx][i])) mx = r;
    [A[i], A[mx]] = [A[mx], A[i]]; [b[i], b[mx]] = [b[mx], b[i]];
    const piv = A[i][i];
    for (let r = i + 1; r < n; r++) {
      const m = A[r][i] / piv; if (m === 0) continue;
      for (let cc = i; cc < n; cc++) A[r][cc] -= m * A[i][cc];
      b[r] -= m * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i];
    for (let cc = i + 1; cc < n; cc++) sum -= A[i][cc] * x[cc];
    x[i] = sum / A[i][i];
  }
  return x;
}

// Fit: samples = [[ms, height], ...]  -> model {Z0, coef:[[X,Y],...]}
function fit(samples) {
  const nc = CONSTITUENTS.length;
  const dim = 1 + 2 * nc;
  const ATA = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const ATb = new Array(dim).fill(0);
  const row = new Array(dim);
  for (const [ms, hgt] of samples) {
    const tH = hoursJ2000(ms);
    const B = basis(tH);
    row[0] = 1;
    for (let k = 0; k < nc; k++) {
      const [f, th] = B[k];
      row[1 + 2 * k] = f * Math.cos(th);
      row[2 + 2 * k] = f * Math.sin(th);
    }
    for (let i = 0; i < dim; i++) {
      const ri = row[i];
      ATb[i] += ri * hgt;
      const Ai = ATA[i];
      for (let j = i; j < dim; j++) Ai[j] += ri * row[j];
    }
  }
  for (let i = 0; i < dim; i++) for (let j = 0; j < i; j++) ATA[i][j] = ATA[j][i];
  const x = solve(ATA, ATb);
  return { Z0: x[0], coef: Array.from({ length: nc }, (_, k) => [x[1 + 2 * k], x[2 + 2 * k]]) };
}

function predict(model, ms) {
  const B = basis(hoursJ2000(ms));
  let h = model.Z0;
  for (let k = 0; k < model.coef.length; k++) {
    const [f, th] = B[k];
    h += f * (model.coef[k][0] * Math.cos(th) + model.coef[k][1] * Math.sin(th));
  }
  return h;
}

// Find tide extremes between msStart and msEnd. Returns [{ms, h, high:bool}]
function extremes(model, msStart, msEnd) {
  const step = 6 * 60000; // 6 min scan
  const out = [];
  let prev = predict(model, msStart - step), cur = predict(model, msStart);
  for (let ms = msStart + step; ms <= msEnd + step; ms += step) {
    const next = predict(model, ms);
    if ((cur > prev && cur >= next) || (cur < prev && cur <= next)) {
      const high = cur > prev;
      // refine: golden/parabolic on fine grid +-6min at 5s resolution via 3-point parabola iterations
      let t0 = ms - 2 * step, t1 = ms; // bracket around ms-step
      let bt = ms - step, bh = cur;
      for (let iter = 0; iter < 3; iter++) {
        const dt = (t1 - t0) / 20;
        for (let t = t0; t <= t1; t += dt) {
          const v = predict(model, t);
          if ((high && v > bh) || (!high && v < bh)) { bh = v; bt = t; }
        }
        t0 = bt - dt; t1 = bt + dt;
      }
      out.push({ ms: bt, h: bh, high });
    }
    prev = cur; cur = next;
  }
  return out;
}

module.exports = { CONSTITUENTS, fit, predict, extremes, basis, hoursJ2000 };
