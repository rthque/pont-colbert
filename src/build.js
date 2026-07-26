// Reconstruit index.html à partir du gabarit, de la photo du héro et des données de marée.
//
// Usage :
//   node src/build.js              → index.html, document complet, photo en fichier séparé
//   node src/build.js --fragment   → src/artifact.html, sans <html>/<head>, photo en base64
//
// Le gabarit est un fragment (il commence par <title>) : c'est le format attendu par
// l'hébergeur d'Artifacts, qui ajoute lui-même l'enveloppe HTML et n'accepte aucun
// fichier joint — d'où la photo intégrée en base64 dans ce mode. Servi tel quel par un
// hébergeur classique, ce fragment n'aurait pas de balise viewport et les mobiles le
// rendraient sur 980 px de large puis dézoomeraient : d'où l'enveloppe ajoutée ici.
'use strict';
const fs = require('fs');
const path = require('path');

const src = __dirname;
const root = path.join(src, '..');
const fragmentOnly = process.argv.includes('--fragment');

const NUIT_LARGE = 'assets/pont-nuit-1200.jpg';
const NUIT_SMALL = 'assets/pont-nuit-760.jpg';
const JOUR_LARGE = 'assets/pont-jour-1200.jpg';
const JOUR_SMALL = 'assets/pont-jour-760.jpg';
const SIZES = '(max-width: 600px) 100vw, 560px';

let html = fs.readFileSync(path.join(src, 'pont_colbert_template.html'), 'utf8');
const data = fs.readFileSync(path.join(src, 'dataset.json'), 'utf8');

if (!html.includes('/*__DATA__*/[]')) throw new Error('gabarit : repère __DATA__ introuvable');
for (const marker of ['__PHOTO_SRC__', '__PHOTO_SRCSET__', '__PHOTO_JOUR_SRCSET__']) {
  if (!html.includes(marker)) throw new Error(`gabarit : repère ${marker} introuvable`);
}

html = html.replace('/*__DATA__*/[]', data);

// --- photos du héro : pont illuminé la nuit, carte postale ancienne le jour ---
for (const rel of [NUIT_LARGE, NUIT_SMALL, JOUR_LARGE, JOUR_SMALL]) {
  if (!fs.existsSync(path.join(root, rel))) {
    throw new Error(`${rel} manquant — relancer : python src/prepare_photo.py <source> --nom <préfixe>`);
  }
}
const dataUri = rel => `data:image/jpeg;base64,${fs.readFileSync(path.join(root, rel)).toString('base64')}`;

if (fragmentOnly) {
  // l'hébergeur d'Artifacts n'accepte aucun fichier joint : les deux photos sont
  // intégrées, en largeur réduite pour que la page reste raisonnable.
  html = html
    .replace('__PHOTO_SRC__', dataUri(NUIT_SMALL))
    .replace(' __PHOTO_SRCSET__', '')
    .replace('__PHOTO_JOUR_SRCSET__', `srcset="${dataUri(JOUR_SMALL)}"`);
} else {
  html = html
    .replace('__PHOTO_SRC__', NUIT_LARGE)
    .replace('__PHOTO_SRCSET__', `srcset="${NUIT_SMALL} 760w, ${NUIT_LARGE} 1195w" sizes="${SIZES}"`)
    .replace('__PHOTO_JOUR_SRCSET__', `srcset="${JOUR_SMALL} 760w, ${JOUR_LARGE} 1200w" sizes="${SIZES}"`);
}

if (/__(DATA|PHOTO_SRC|PHOTO_SRCSET|PHOTO_JOUR_SRCSET)__/.test(html)) throw new Error('un repère est resté dans la sortie');
const opens = (html.match(/<svg/g) || []).length;
const closes = (html.match(/<\/svg>/g) || []).length;
if (opens !== closes) throw new Error(`balises <svg> déséquilibrées : ${opens}/${closes}`);

if (fragmentOnly) {
  const out = path.join(src, 'artifact.html');
  fs.writeFileSync(out, html);
  console.log('artifact.html (fragment, photo intégrée) :', Math.round(fs.statSync(out).size / 1024), 'Ko');
  return;
}

// --- enveloppe : document autonome pour un hébergement classique ---

const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
if (!titleMatch) throw new Error('gabarit : <title> introuvable');
const title = titleMatch[1].trim();
let body = html.replace(/<title>[\s\S]*?<\/title>\s*/, '');

// le <style> initial remonte dans <head> ; le reste devient le corps de page
const styleMatch = body.match(/^\s*<style>[\s\S]*?<\/style>/);
if (!styleMatch) throw new Error('gabarit : bloc <style> initial introuvable');
const style = styleMatch[0].trim();
body = body.slice(styleMatch[0].length).trim();

const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E" +
  "%3Crect width='64' height='64' rx='12' fill='%23003366'/%3E" +
  "%3Cpath d='M7 45h50M7 36q25-16 50 0M15 36v9M25 30v15M39 30v15M49 36v9' " +
  "stroke='%23F5F0E8' stroke-width='2.6' fill='none' stroke-linecap='round'/%3E" +
  "%3Ccircle cx='32' cy='45' r='4' fill='%23C44A2A'/%3E%3C/svg%3E";

const description =
  "Créneaux d'ouverture du pont tournant Colbert à Dieppe selon la marée, " +
  "du 1er juillet 2026 au 31 décembre 2028, avec webcam du port en direct.";

const doc = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F5F0E8">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#112233">
<meta name="apple-mobile-web-app-title" content="Pont Colbert">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:image" content="${NUIT_LARGE}">
<link rel="preload" as="image" media="(prefers-color-scheme: dark)" href="${NUIT_LARGE}" imagesrcset="${NUIT_SMALL} 760w, ${NUIT_LARGE} 1195w" imagesizes="${SIZES}">
<link rel="preload" as="image" media="(prefers-color-scheme: light)" href="${JOUR_LARGE}" imagesrcset="${JOUR_SMALL} 760w, ${JOUR_LARGE} 1200w" imagesizes="${SIZES}">
<link rel="icon" href="${favicon}">
<link rel="apple-touch-icon" href="${favicon}">
${style}
</head>
<body>
${body}
</body>
</html>
`;

const out = path.join(root, 'index.html');
fs.writeFileSync(out, doc);

// vérifications de sortie
for (const needed of ['<!doctype html>', 'name="viewport"', '<meta charset="utf-8">',
  NUIT_LARGE, JOUR_LARGE, 'id="themeBtn"', '</body>', '</html>']) {
  if (!doc.includes(needed)) throw new Error(`sortie : ${needed} manquant`);
}
if ((doc.match(/<html/g) || []).length !== 1) throw new Error('sortie : <html> en double');
if ((doc.match(/<body/g) || []).length !== 1) throw new Error('sortie : <body> en double');
if ((doc.match(/<picture>/g) || []).length !== 1) throw new Error('sortie : <picture> attendu une seule fois');

console.log('index.html reconstruit :', Math.round(fs.statSync(out).size / 1024),
  'Ko | viewport OK | 2 photos liées | bascule de thème');
