// Assemble public/ : exactement ce qui doit être servi en ligne, et rien d'autre.
//
// Sert de commande de compilation à l'hébergeur, qui publie ensuite le dossier public/.
// Sans cette étape, un hébergeur qui publie « la racine du dépôt » met aussi en ligne
// .git/, src/ et README.md — c'est ce qui est arrivé au premier déploiement Cloudflare,
// où /.git/config répondait 200.
//
// Le dépôt garde malgré tout le site à sa racine : GitHub Pages ne sait servir que la
// racine ou docs/, et reste ainsi opérationnel comme hébergeur de secours.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'public');

const A_PUBLIER = ['index.html', 'assets', 'docs', '.nojekyll'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const nom of A_PUBLIER) {
  const source = path.join(root, nom);
  if (!fs.existsSync(source)) {
    throw new Error(`${nom} manquant — lancer d'abord : node src/build.js`);
  }
  fs.cpSync(source, path.join(out, nom), { recursive: true });
}

// La page doit être un document complet : servie sans balise viewport, elle s'afficherait
// en tout petit sur mobile. La vérification est ici parce que c'est le dernier point de
// passage avant la mise en ligne.
const page = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
for (const attendu of ['<!doctype html>', 'name="viewport"', '<link rel="canonical"']) {
  if (!page.includes(attendu)) {
    throw new Error(`public/index.html : ${attendu} manquant — relancer : node src/build.js`);
  }
}

// Rien d'autre ne doit avoir suivi.
const interdits = ['.git', 'src', 'README.md', 'CLES-ADMIN.txt'];
for (const nom of interdits) {
  if (fs.existsSync(path.join(out, nom))) {
    throw new Error(`public/${nom} ne doit pas être publié`);
  }
}

let fichiers = 0;
let octets = 0;
(function parcourir(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) parcourir(p);
    else { fichiers++; octets += fs.statSync(p).size; }
  }
})(out);

console.log(`public/ prêt : ${fichiers} fichiers, ${Math.round(octets / 1024)} Ko`);
