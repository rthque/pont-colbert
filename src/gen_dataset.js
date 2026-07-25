// Generate final embedded dataset: exact 2026 (maree.info/SHOM) + harmonic 2027-2028
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harmonic.js');
const sp = __dirname;

const model = JSON.parse(fs.readFileSync(path.join(sp, 'model.json'), 'utf8'));
const mi = JSON.parse(fs.readFileSync(path.join(sp, 'mi_extremes.json'), 'utf8'));

// exact part: 2026-07-01 .. 2026-12-31
const exact = mi.filter(e => e.ms < Date.UTC(2027, 0, 1));

// coeff regression on 2026 data: coeff ~ a*range + b, range = PM height - mean(adjacent BM)
const pairs = [];
for (let i = 0; i < exact.length; i++) {
  const e = exact[i];
  if (!e.high || e.coeff == null) continue;
  const prev = exact[i - 1], next = exact[i + 1];
  const lows = [prev, next].filter(x => x && !x.high).map(x => x.h);
  if (!lows.length) continue;
  pairs.push([e.h - lows.reduce((a, b) => a + b) / lows.length, e.coeff]);
}
let sx = 0, sy = 0, sxx = 0, sxy = 0;
for (const [x, y] of pairs) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
const n = pairs.length;
const a = (n * sxy - sx * sy) / (n * sxx - sx * sx);
const b = (sy - a * sx) / n;
let s2 = 0, mxe = 0;
for (const [x, y] of pairs) { const r = a * x + b - y; s2 += r * r; if (Math.abs(r) > mxe) mxe = Math.abs(r); }
console.log(`coeff regression: c = ${a.toFixed(3)}*range + ${b.toFixed(2)}  (n=${n}, std=${Math.sqrt(s2 / n).toFixed(2)}, max=${mxe.toFixed(1)})`);

// predicted part: 2027-01-01 .. 2028-12-31 (+ margin into 2029-01-02 for slots crossing midnight)
const pred = H.extremes(model, Date.UTC(2026, 11, 31, 12), Date.UTC(2029, 0, 2, 12));
const predClip = pred.filter(e => e.ms >= Date.UTC(2027, 0, 1) && e.ms < Date.UTC(2029, 0, 2));
console.log('predicted extremes:', predClip.length, 'first:', new Date(predClip[0].ms).toISOString(), 'last:', new Date(predClip[predClip.length - 1].ms).toISOString());

// seam check around 2027-01-01: last exact vs prediction overlap
const seamAct = mi.filter(e => e.ms >= Date.UTC(2026, 11, 28) && e.ms < Date.UTC(2027, 0, 6));
const seamPred = H.extremes(model, Date.UTC(2026, 11, 27, 12), Date.UTC(2027, 0, 6, 12));
for (const s of seamAct) {
  let best = null, bd = Infinity;
  for (const p of seamPred) { if (p.high !== s.high) continue; const d = Math.abs(p.ms - s.ms); if (d < bd) { bd = d; best = p; } }
  if (best) console.log('seam', new Date(s.ms).toISOString().slice(0, 16), s.high ? 'PM' : 'BM',
    'dt=' + ((best.ms - s.ms) / 60000).toFixed(1) + 'min', 'dh=' + ((best.h - s.h) * 100).toFixed(0) + 'cm');
}

// assemble: [minutesUTC, cm, high, coeff (0 = none)]
function coeffFor(idx, arr) { // approx coeff for predicted highs
  const e = arr[idx];
  const lows = [arr[idx - 1], arr[idx + 1]].filter(x => x && !x.high).map(x => x.h);
  if (!lows.length) return 0;
  const c = Math.round(a * (e.h - lows.reduce((p, q) => p + q) / lows.length) + b);
  return Math.max(20, Math.min(120, c));
}
const rows = [];
for (const e of exact) rows.push([Math.round(e.ms / 60000), Math.round(e.h * 100), e.high ? 1 : 0, e.coeff || 0, 0]);
for (let i = 0; i < predClip.length; i++) {
  const e = predClip[i];
  rows.push([Math.round(e.ms / 60000), Math.round(e.h * 100), e.high ? 1 : 0, e.high ? coeffFor(i, predClip) : 0, 1]);
}
rows.sort((x, y) => x[0] - y[0]);
fs.writeFileSync(path.join(sp, 'dataset.json'), JSON.stringify(rows));
console.log('total rows:', rows.length, 'size:', fs.statSync(path.join(sp, 'dataset.json')).size, 'bytes');
// sanity: no gaps > 9.5h
let bad = 0;
for (let i = 1; i < rows.length; i++) { const dh = (rows[i][0] - rows[i - 1][0]) / 60; if (dh > 9.5 || dh < 2.5) { bad++; console.log('GAP', dh.toFixed(1), 'h before', new Date(rows[i][0] * 60000).toISOString()); } }
console.log('gap anomalies:', bad);
