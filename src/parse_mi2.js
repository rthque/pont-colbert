// Parse maree.info AJAX weekly payloads -> extremes with UTC timestamps
'use strict';
const fs = require('fs');
const path = require('path');
const sp = __dirname;
const dir = path.join(sp, 'mi2');

const byDate = new Map(); // 'YYYY-MM-DD' -> [{ms,h,high,coeff}]

for (const f of fs.readdirSync(dir).sort()) {
  let raw = fs.readFileSync(path.join(dir, f), 'latin1');
  const html = raw.replace(/\\"/g, '"').replace(/\\'/g, "'");
  const mDates = html.match(/Marees\.Dates = \[([0-9,]+)\]/);
  if (!mDates) { console.error('no Dates in', f); continue; }
  const dates = mDates[1].split(',').map(s => s.trim());
  const rowRe = /<tr class="MJ [^"]*" id="MareeJours_(\d+)" title="UTC\+(\d)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m, rows = 0;
  while ((m = rowRe.exec(html)) !== null) {
    const idx = +m[1], off = +m[2], row = m[3];
    const ymd = dates[idx];
    if (!ymd) continue;
    rows++;
    const dateStr = `${ymd.slice(0,4)}-${ymd.slice(4,6)}-${ymd.slice(6,8)}`;
    const tds = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(x => x[1]);
    if (tds.length < 3) { console.error('bad row', f, idx); continue; }
    const parseCol = td => td.split(/<br\s*\/?>/).map(cell => {
      const bold = /<b>/.test(cell);
      const txt = cell.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim();
      return { bold, txt };
    });
    const times = parseCol(tds[0]), heights = parseCol(tds[1]), coeffs = parseCol(tds[2]);
    const list = byDate.get(dateStr) || [];
    for (let i = 0; i < times.length; i++) {
      const tm = times[i].txt.match(/^(\d{2})h(\d{2})$/);
      if (!tm) continue;
      const hm = heights[i].txt.match(/^([\d]+),(\d+)m$/);
      if (!hm) { console.error('height?', f, idx, JSON.stringify(heights[i].txt)); continue; }
      const high = times[i].bold;
      const coeff = coeffs[i] && /^\d+$/.test(coeffs[i].txt) ? +coeffs[i].txt : null;
      const [Y, Mo, D] = dateStr.split('-').map(Number);
      const ms = Date.UTC(Y, Mo - 1, D, +tm[1] - off, +tm[2]);
      list.push({ ms, h: +(hm[1] + '.' + hm[2]), high, coeff });
    }
    if (!byDate.has(dateStr)) byDate.set(dateStr, list);
  }
  if (rows !== 7) console.error(f, 'rows=', rows);
}

const all = [...byDate.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
const flat = [];
for (const [d, list] of all) for (const e of list) flat.push(e);
flat.sort((a, b) => a.ms - b.ms);
const dedup = [];
for (const e of flat) {
  const last = dedup[dedup.length - 1];
  if (last && Math.abs(e.ms - last.ms) < 30 * 60000 && e.high === last.high) continue;
  dedup.push(e);
}
fs.writeFileSync(path.join(sp, 'mi_extremes.json'), JSON.stringify(dedup));
console.log('dates:', all.length, 'first:', all[0][0], 'last:', all[all.length-1][0], 'extremes:', dedup.length, 'highs:', dedup.filter(e=>e.high).length);
// continuity check: gap between consecutive extremes should be ~3-9h
let gaps = 0;
for (let i = 1; i < dedup.length; i++) {
  const dh = (dedup[i].ms - dedup[i-1].ms) / 3600000;
  if (dh > 9.5 || dh < 2.5) { gaps++; console.log('gap', dh.toFixed(1) + 'h before', new Date(dedup[i].ms).toISOString()); }
}
console.log('gap anomalies:', gaps);
console.log('DST window:', dedup.filter(e => e.ms > Date.UTC(2026,9,24,20) && e.ms < Date.UTC(2026,9,25,20)).map(e => new Date(e.ms).toISOString().slice(5,16) + (e.high?' PM':' BM')).join(' | '));
console.log('check 16/07 PMs:', dedup.filter(e => e.high && e.ms > Date.UTC(2026,6,15,20) && e.ms < Date.UTC(2026,6,16,22)).map(e => new Date(e.ms).toISOString() + ' ' + e.h + 'm c' + e.coeff).join(' | '));
