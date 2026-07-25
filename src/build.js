// Reconstruit index.html à partir du gabarit, du dessin du pont et des données de marée.
// Usage : node src/build.js
'use strict';
const fs = require('fs');
const path = require('path');

const src = __dirname;
const root = path.join(src, '..');

let html = fs.readFileSync(path.join(src, 'pont_colbert_template.html'), 'utf8');
const bridge = fs.readFileSync(path.join(src, 'bridge.svg.html'), 'utf8');
const data = fs.readFileSync(path.join(src, 'dataset.json'), 'utf8');

if (!html.includes('<!--__BRIDGE__-->')) throw new Error('gabarit : repère __BRIDGE__ introuvable');
if (!html.includes('/*__DATA__*/[]')) throw new Error('gabarit : repère __DATA__ introuvable');

html = html.replace('<!--__BRIDGE__-->', bridge).replace('/*__DATA__*/[]', data);

if (/__(DATA|BRIDGE)__/.test(html)) throw new Error('un repère est resté dans la sortie');
const opens = (html.match(/<svg/g) || []).length;
const closes = (html.match(/<\/svg>/g) || []).length;
if (opens !== closes) throw new Error(`balises <svg> déséquilibrées : ${opens}/${closes}`);

const out = path.join(root, 'index.html');
fs.writeFileSync(out, html);
console.log('index.html reconstruit :', fs.statSync(out).size, 'octets |', opens, 'SVG');
