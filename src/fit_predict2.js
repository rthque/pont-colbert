// Fit v2: extended constituents + residual periodogram + far-year nodal backtest
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harmonic.js');
const sp = __dirname;

// ---- load training samples
const samples = [];
for (const f of fs.readdirSync(path.join(sp, 'wl')).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(sp, 'wl', f), 'utf8'));
  for (const [dateStr, arr] of Object.entries(data)) {
    const [Y, M, D] = dateStr.split('-').map(Number);
    for (const [hms, hgt] of arr) {
      const [hh, mm, ssec] = hms.split(':').map(Number);
      samples.push([Date.UTC(Y, M - 1, D, hh, mm, ssec), hgt]);
    }
  }
}
samples.sort((a, b) => a[0] - b[0]);
const S = [];
for (const s of samples) if (!S.length || s[0] > S[S.length - 1][0]) S.push(s);
console.log('samples:', S.length, 'constituents:', H.CONSTITUENTS.length);

// ---- fit
const model = H.fit(S);
let ss = 0, mx = 0;
const resid = new Array(S.length);
for (let i = 0; i < S.length; i++) {
  const r = H.predict(model, S[i][0]) - S[i][1];
  resid[i] = r; ss += r * r; if (Math.abs(r) > mx) mx = Math.abs(r);
}
console.log('training RMS =', (Math.sqrt(ss / S.length) * 100).toFixed(2), 'cm, max =', (mx * 100).toFixed(1), 'cm');

// ---- residual periodogram over Doodson candidate frequencies
if (process.argv.includes('--scan')) {
  // rates deg/hour
  const dTau = 14.4920521, dS = 0.5490165, dHh = 0.0410686, dP = 0.0046418, dPp = 0.0000020;
  const t0 = S[0][0];
  const tH = S.map(x => (x[0] - t0) / 3600000);
  const existing = H.CONSTITUENTS.map(c => c[1] * dTau + c[2] * dS + c[3] * dHh + c[4] * dP + c[6] * dPp);
  const found = [];
  for (let n1 = 0; n1 <= 8; n1++) for (let n2 = -5; n2 <= 5; n2++) for (let n3 = -5; n3 <= 5; n3++) for (let n4 = -2; n4 <= 2; n4++) {
    const freq = n1 * dTau + n2 * dS + n3 * dHh + n4 * dP;
    if (freq <= 0.001) continue;
    if (existing.some(e => Math.abs(e - freq) < 0.012)) continue;
    const w = freq * Math.PI / 180;
    let cs = 0, sn = 0;
    for (let i = 0; i < tH.length; i++) { const a = w * tH[i]; cs += resid[i] * Math.cos(a); sn += resid[i] * Math.sin(a); }
    const amp = 2 * Math.hypot(cs, sn) / tH.length;
    if (amp > 0.005) found.push([amp, n1, n2, n3, n4, freq]);
  }
  found.sort((a, b) => b[0] - a[0]);
  // dedupe near-equal freqs
  const seen = [];
  for (const f of found) {
    if (seen.some(s => Math.abs(s[5] - f[5]) < 0.012)) continue;
    seen.push(f);
    if (seen.length >= 25) break;
  }
  console.log('missing lines (amp cm | n1 n2 n3 n4 | deg/h):');
  for (const [amp, n1, n2, n3, n4, fr] of seen)
    console.log(` ${(amp * 100).toFixed(2)} | ${n1} ${n2} ${n3} ${n4} | ${fr.toFixed(4)}`);
}

// ---- validations vs SHOM hlt weeks (far years) and maree.info
function loadHlt(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  for (const [dateStr, arr] of Object.entries(data)) {
    const [Y, M, D] = dateStr.split('-').map(Number);
    for (const [type, hm, hgt] of arr) {
      if (type === 'tide.none') continue;
      const [hh, mm] = hm.split(':').map(Number);
      out.push({ ms: Date.UTC(Y, M - 1, D, hh, mm), h: +hgt, high: type === 'tide.high' });
    }
  }
  return out.sort((a, b) => a.ms - b.ms);
}
function stats(actual, predicted, label) {
  let n = 0, sdt = 0, sdt2 = 0, mdt = 0, sdh2 = 0, mdh = 0, miss = 0;
  for (const a of actual) {
    let best = null, bd = Infinity;
    for (const p of predicted) {
      if (p.high !== a.high) continue;
      const d = Math.abs(p.ms - a.ms);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > 90 * 60000) { miss++; continue; }
    const dt = (best.ms - a.ms) / 60000, dh = (best.h - a.h) * 100;
    n++; sdt += dt; sdt2 += dt * dt; sdh2 += dh * dh;
    if (Math.abs(dt) > Math.abs(mdt)) mdt = dt;
    if (Math.abs(dh) > Math.abs(mdh)) mdh = dh;
  }
  console.log(`${label}: n=${n} miss=${miss} dt(mean=${(sdt/n).toFixed(1)} RMS=${Math.sqrt(sdt2/n).toFixed(1)} max=${mdt.toFixed(0)} min) dh(RMS=${Math.sqrt(sdh2/n).toFixed(1)} max=${mdh.toFixed(0)} cm)`);
}
for (const f of fs.readdirSync(path.join(sp, 'val')).sort()) {
  const act = loadHlt(path.join(sp, 'val', f));
  const pred = H.extremes(model, act[0].ms - 8 * 3600000, act[act.length - 1].ms + 8 * 3600000);
  stats(act, pred, 'BACKTEST ' + f.replace('hlt_', '').replace('.json', ''));
}
const mi = JSON.parse(fs.readFileSync(path.join(sp, 'mi_extremes.json'), 'utf8'));
const trainEnd = S[S.length - 1][0];
const test = mi.filter(e => e.ms > trainEnd + 12 * 3600000 && e.ms < Date.UTC(2027, 0, 1));
const predF = H.extremes(model, trainEnd + 6 * 3600000, Date.UTC(2027, 0, 2));
stats(test.filter(e => e.high), predF, 'FORWARD 2026-07-22..12-31 highs');
stats(test.filter(e => !e.high), predF, 'FORWARD 2026-07-22..12-31 lows');

fs.writeFileSync(path.join(sp, 'model.json'), JSON.stringify(model));
