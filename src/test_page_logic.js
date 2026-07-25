// Replicates the page's JS logic and checks reference dates
'use strict';
const fs = require('fs');
const TIDES = JSON.parse(fs.readFileSync(__dirname + '/dataset.json', 'utf8'));

const TZ = 'Europe/Paris';
const fmtKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtHM = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const hm = ms => fmtHM.format(ms).replace(':', 'h');
const keyOf = ms => fmtKey.format(ms);

const byDay = new Map();
for (const t of TIDES) {
  const k = keyOf(t[0] * 60000);
  if (!byDay.has(k)) byDay.set(k, []);
  byDay.get(k).push(t);
}
function localToUtc(dayStr, hh, mm) {
  const [Y, M, D] = dayStr.split('-').map(Number);
  for (const off of [1, 2, 0]) {
    const g = Date.UTC(Y, M - 1, D, hh - off, mm);
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(g);
    if (p === String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') && keyOf(g) === dayStr) return g;
  }
  return Date.UTC(Y, M - 1, D, hh - 1, mm);
}
function addDays(dayStr, n) {
  const [Y, M, D] = dayStr.split('-').map(Number);
  const d = new Date(Date.UTC(Y, M - 1, D, 12));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function highsAround(dayStr) {
  const out = [];
  for (const k of [addDays(dayStr, -1), dayStr, addDays(dayStr, 1)])
    for (const t of (byDay.get(k) || [])) if (t[2]) out.push(t);
  return out;
}
function eventsFor(dayStr) {
  const evs = [];
  for (const t of highsAround(dayStr)) {
    const pmMs = t[0] * 60000;
    for (const [off, label] of [[-120, 'PM-2h'], [-45, 'PM-45'], [45, 'PM+45']]) {
      const ms = pmMs + off * 60000;
      if (keyOf(ms) !== dayStr) continue;
      evs.push({ ms, kind: label });
    }
    if (keyOf(pmMs) === dayStr) evs.push({ ms: pmMs, kind: 'PM', h: t[1] / 100, coeff: t[3], pred: t[4] });
  }
  for (const [hh, mm, kind] of [[7, 30, 'FIXE'], [18, 30, 'FIXE'], [11, 30, 'EXC'], [15, 30, 'EXC']])
    evs.push({ ms: localToUtc(dayStr, hh, mm), kind });
  evs.sort((a, b) => a.ms - b.ms);
  return evs;
}
function show(dayStr) {
  console.log('---', dayStr);
  for (const e of eventsFor(dayStr))
    console.log(' ', hm(e.ms).padStart(5), e.kind.padEnd(6), e.h ? e.h.toFixed(2) + 'm coeff=' + (e.pred ? '≈' : '') + (e.coeff || '-') : '');
}
// Reference: screenshot day (expects PM 14h05, slots 12h05 13h20 14h50)
show('2026-07-16');
// DST autumn switch
show('2026-10-25');
// far predictions
show('2027-06-15');
show('2028-12-31');
// range edges
console.log('first day events:', eventsFor('2026-07-01').length, '| last day events:', eventsFor('2028-12-31').length);
// full sweep: every day in range must have >=1 PM slot set and no crash
let days = 0, noPm = [];
for (let k = '2026-07-01'; k <= '2028-12-31'; k = addDays(k, 1)) {
  const evs = eventsFor(k);
  days++;
  if (!evs.some(e => e.kind === 'PM')) noPm.push(k);
}
console.log('days swept:', days, 'days without PM row:', noPm.length, noPm.slice(0, 5));
