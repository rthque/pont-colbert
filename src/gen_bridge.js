// Génère la silhouette SVG du pont Colbert : treillis bas, membrure sup. cambrée,
// panneaux à croix + fin treillis losangé, tablier + garde-corps, pivot central.
'use strict';
const fs = require('fs');

const X0 = 14, X1 = 186;           // emprise du tablier
const N = 11;                      // panneaux
const step = (X1 - X0) / N;
const yBot = 43;                   // membrure inférieure (tablier), droite
const yTopCenter = 21, yTopEnd = 33; // camber parabolique
const cx = (X0 + X1) / 2, half = (X1 - X0) / 2;

const pts = [];
for (let i = 0; i <= N; i++) {
  const x = X0 + i * step;
  const yTop = yTopCenter + (yTopEnd - yTopCenter) * Math.pow((x - cx) / half, 2);
  pts.push({ x: +x.toFixed(1), yTop: +yTop.toFixed(1) });
}
const r2 = n => +n.toFixed(1);

// membrures
const topChord = 'M' + pts.map(p => `${p.x} ${p.yTop}`).join(' L');
const botChord = `M${X0} ${yBot} H${X1}`;
// membrure sup. doublée (épaisseur industrielle)
const topChord2 = 'M' + pts.map(p => `${p.x} ${r2(p.yTop + 1.4)}`).join(' L');

// montants
let posts = '';
for (const p of pts) posts += `M${p.x} ${p.yTop} V${yBot} `;

// grandes croix de Saint-André par panneau
let crosses = '';
for (let i = 0; i < N; i++) {
  const a = pts[i], b = pts[i + 1];
  crosses += `M${a.x} ${a.yTop} L${b.x} ${yBot} `;   // haut-gauche -> bas-droite
  crosses += `M${a.x} ${yBot} L${b.x} ${b.yTop} `;   // bas-gauche -> haut-droite
}

// fin treillis losangé : petites diagonales secondaires (demi-mailles)
let lattice = '';
for (let i = 0; i < N; i++) {
  const a = pts[i], b = pts[i + 1];
  const mx = (a.x + b.x) / 2;
  const myTop = (a.yTop + b.yTop) / 2;
  const myMid = (myTop + yBot) / 2;
  // losanges : sommets milieu-haut, milieu-bas, centres de montants
  lattice += `M${r2(mx)} ${r2(a.yTop)} L${r2(b.x)} ${r2(myMid)} L${r2(mx)} ${yBot} L${a.x} ${r2(myMid)} Z `;
}

// tablier + garde-corps sous la membrure inférieure
let rail = `M${X0} ${yBot + 3} H${X1} `;
for (let x = X0; x <= X1; x += 4) rail += `M${r2(x)} ${yBot} V${yBot + 3} `;

// rivets aux nœuds
let rivets = '';
for (const p of pts) rivets += `<circle cx="${p.x}" cy="${r2(p.yTop - 0.6)}" r="0.6"/><circle cx="${p.x}" cy="${yBot}" r="0.6"/>`;

// pivot central (mécanisme de rotation, brique)
const pierX = cx;
const pier = `M${r2(pierX - 4)} ${yBot} L${r2(pierX - 2.5)} ${yBot + 6} L${r2(pierX + 2.5)} ${yBot + 6} L${r2(pierX + 4)} ${yBot} Z`;

// eau
let water = `M6 ${yBot + 8} `;
for (let x = 6; x <= 194; x += 8) water += `q4 -2 8 0 t8 0 `;

// flèche courbe de rotation au-dessus du centre
const arrow = `M${r2(cx - 20)} ${yTopCenter - 6} A22 9 0 0 1 ${r2(cx + 20)} ${yTopCenter - 6}`;
const arrowHead = `M${r2(cx + 20)} ${yTopCenter - 6} l-4.5 -2.4 M${r2(cx + 20)} ${yTopCenter - 6} l-5 2.2`;

const svg =
`<svg class="bridge" viewBox="0 0 200 58" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Silhouette du pont tournant Colbert, poutre en treillis à membrure cambrée">
  <g class="rot-arrow" stroke="var(--brick-line)" stroke-width="1.5" stroke-linecap="round">
    <path d="${arrow}"/>
    <path d="${arrowHead}"/>
  </g>
  <path class="lat" d="${lattice}" stroke="var(--steel-line)" stroke-width="0.35" opacity="0.55"/>
  <path class="cross" d="${crosses}" stroke="var(--truss-line)" stroke-width="0.7" opacity="0.9"/>
  <path class="post" d="${posts}" stroke="var(--truss-line)" stroke-width="0.9"/>
  <path class="chord" d="${topChord}" stroke="var(--truss-line)" stroke-width="1.7" stroke-linejoin="round"/>
  <path class="chord" d="${topChord2}" stroke="var(--truss-line)" stroke-width="0.7" opacity="0.7" stroke-linejoin="round"/>
  <path class="chord" d="${botChord}" stroke="var(--truss-line)" stroke-width="1.7"/>
  <path class="rail" d="${rail}" stroke="var(--steel-line)" stroke-width="0.5" opacity="0.8"/>
  <path class="pier" d="${pier}" fill="var(--brick-fill)" stroke="var(--brick-line)" stroke-width="0.8"/>
  <circle cx="${cx}" cy="${yBot}" r="2" fill="none" stroke="var(--brick-line)" stroke-width="1"/>
  <g fill="var(--truss-line)">${rivets}</g>
  <path class="water" d="${water}" stroke="var(--steel-line)" stroke-width="1" opacity="0.7"/>
</svg>`;

fs.writeFileSync(__dirname + '/bridge.svg.html', svg);
console.log('nodes:', pts.length, 'panels:', N);
console.log(svg.length, 'chars');
