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

const SIZES = '(max-width: 600px) 100vw, 560px';

// Adresse publique de référence. Le site est servi par deux hébergeurs à partir du même
// dépôt ; celui-ci est désigné comme canonique pour que les moteurs de recherche et les
// aperçus de partage n'en retiennent qu'un. Terminer par une barre oblique.
const SITE = 'https://pont-colbert.fr/';

// Les variantes sont découvertes dans assets/ : leur nom porte la largeur réelle,
// produite par prepare_photo.py, ce qui garantit un srcset exact.
function variantes(prefixe) {
  const dir = path.join(root, 'assets');
  const trouvees = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .map(f => {
      const m = f.match(new RegExp(`^${prefixe}-(\\d+)\\.jpg$`));
      return m ? { rel: `assets/${f}`, largeur: +m[1] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.largeur - b.largeur);
  if (!trouvees.length) {
    throw new Error(`aucune photo ${prefixe}-*.jpg dans assets/ — lancer : python src/prepare_photo.py <source> --nom ${prefixe}`);
  }
  return trouvees;
}

// Dimensions réelles d'un JPEG, lues dans son marqueur SOF.
function dimensions(rel) {
  const buf = fs.readFileSync(path.join(root, rel));
  let i = 2; // après le marqueur de début d'image
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marqueur = buf[i + 1];
    const porteLesDimensions = marqueur >= 0xC0 && marqueur <= 0xCF
      && ![0xC4, 0xC8, 0xCC].includes(marqueur);
    if (porteLesDimensions) {
      return { hauteur: buf.readUInt16BE(i + 5), largeur: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error(`${rel} : dimensions JPEG introuvables`);
}

const NUIT = variantes('pont-nuit');
const JOUR = variantes('pont-jour');

// Les deux photos sont cadrées à l'identique, et le héro compte là-dessus : object-fit:
// cover recadre selon le rapport de l'image, si bien que deux rapports différents font
// sauter le pont d'une position à l'autre au changement de thème, d'un écart qui varie
// avec la taille de l'écran. La contrainte est vérifiée ici plutôt que constatée à l'œil.
if (NUIT.length !== JOUR.length) {
  throw new Error(`photos : ${NUIT.length} variantes de nuit contre ${JOUR.length} de jour`);
}
NUIT.forEach((nuit, i) => {
  const jour = JOUR[i];
  const dn = dimensions(nuit.rel);
  const dj = dimensions(jour.rel);
  if (dn.largeur !== dj.largeur || dn.hauteur !== dj.hauteur) {
    throw new Error(
      `cadrage : ${nuit.rel} fait ${dn.largeur}x${dn.hauteur} et ${jour.rel} ${dj.largeur}x${dj.hauteur} — ` +
      'les deux photos doivent avoir exactement les mêmes dimensions'
    );
  }
});
const plusGrande = v => v[v.length - 1].rel;
const plusPetite = v => v[0].rel;
const srcset = v => v.map(x => `${x.rel} ${x.largeur}w`).join(', ');

let html = fs.readFileSync(path.join(src, 'pont_colbert_template.html'), 'utf8');
const data = fs.readFileSync(path.join(src, 'dataset.json'), 'utf8');

if (!html.includes('/*__DATA__*/[]')) throw new Error('gabarit : repère __DATA__ introuvable');
for (const marker of ['__PHOTO_DATA__', '__AVIS_PAGE1__', '__AVIS_PAGE2__', '__AVIS_PDF__']) {
  if (!html.includes(marker)) throw new Error(`gabarit : repère ${marker} introuvable`);
}

html = html.replace('/*__DATA__*/[]', data);

// --- avis officiel de la capitainerie, affiché derrière le bouton « Règles » ---
const AVIS_PDF = 'docs/avis-ouverture-pont-colbert.pdf';
const AVIS_PAGES = ['docs/avis-page-1.jpg', 'docs/avis-page-2.jpg'];
for (const rel of [AVIS_PDF, ...AVIS_PAGES]) {
  if (!fs.existsSync(path.join(root, rel))) {
    throw new Error(`${rel} manquant — relancer : python src/prepare_avis.py "<avis.pdf>"`);
  }
}

// --- photos du héro : pont illuminé la nuit, carte postale ancienne le jour ---
const dataUri = rel => `data:image/jpeg;base64,${fs.readFileSync(path.join(root, rel)).toString('base64')}`;

if (fragmentOnly) {
  // l'hébergeur d'Artifacts n'accepte aucun fichier joint : photos et pages de l'avis
  // sont intégrées, en largeur réduite pour que la page reste raisonnable. Le PDF, lui,
  // ne peut pas l'être : le lien pointe vers le site publié.
  html = html
    .replace('__PHOTO_DATA__',
      `data-nuit="${dataUri(plusPetite(NUIT))}" data-jour="${dataUri(plusPetite(JOUR))}"`)
    .replace('__AVIS_PAGE1__', dataUri(AVIS_PAGES[0]))
    .replace('__AVIS_PAGE2__', dataUri(AVIS_PAGES[1]))
    .replace('__AVIS_PDF__', SITE + AVIS_PDF);
} else {
  const attr = (nom, v) => `data-${nom}="${plusGrande(v)}"` +
    (v.length > 1 ? ` data-${nom}-srcset="${srcset(v)}"` : '');
  html = html
    .replace('__PHOTO_DATA__', `${attr('nuit', NUIT)} ${attr('jour', JOUR)}`)
    .replace('__AVIS_PAGE1__', AVIS_PAGES[0])
    .replace('__AVIS_PAGE2__', AVIS_PAGES[1])
    .replace('__AVIS_PDF__', AVIS_PDF);
}

if (/__(DATA|PHOTO_DATA|AVIS_PAGE1|AVIS_PAGE2|AVIS_PDF)__/.test(html)) throw new Error('un repère est resté dans la sortie');
// les dimensions déclarées réservent la place du héro avant le chargement : fausses,
// la page sursaute au premier affichage
const balise = html.match(/<img[^>]*class="hero-photo"[^>]*>/);
if (!balise) throw new Error('gabarit : la photo du héro est introuvable');
const reelles = dimensions(plusGrande(NUIT));
if (!balise[0].includes(`width="${reelles.largeur}"`) || !balise[0].includes(`height="${reelles.hauteur}"`)) {
  throw new Error(`gabarit : déclarer la photo du héro en ${reelles.largeur}x${reelles.hauteur}`);
}

// --- cohérence des traductions ---
// t() retombe sur le français quand une clé manque en anglais : le défaut ne casse rien,
// il se voit seulement à l'écran, sous la forme d'une phrase française au milieu de
// l'anglais. Autant l'attraper ici.
function blocAccolades(source, ancre) {
  const depart = source.indexOf(ancre);
  if (depart < 0) throw new Error(`gabarit : ${ancre.trim()} introuvable`);
  let profondeur = 0, debut = -1;
  for (let i = depart; i < source.length; i++) {
    if (source[i] === '{') { if (debut < 0) debut = i; profondeur++; }
    else if (source[i] === '}' && --profondeur === 0) return source.slice(debut, i + 1);
  }
  throw new Error(`gabarit : bloc ${ancre.trim()} non refermé`);
}

const LANGUES = { français: blocAccolades(html, '  fr: {'), anglais: blocAccolades(html, '  en: {') };
const clesUtilisees = new Set();
for (const m of html.matchAll(/data-i18n(?:-html|-aria|-alt)?="([^"]+)"/g)) clesUtilisees.add(m[1]);
for (const m of html.matchAll(/\bt\("([A-Za-z0-9]+)"/g)) clesUtilisees.add(m[1]);
if (clesUtilisees.size < 40) throw new Error(`traductions : ${clesUtilisees.size} clés seulement, extraction douteuse`);
for (const cle of clesUtilisees) {
  for (const [langue, bloc] of Object.entries(LANGUES)) {
    if (!new RegExp(`(^|[\\s{,])${cle}\\s*:`).test(bloc)) {
      throw new Error(`traduction : la clé « ${cle} » manque en ${langue}`);
    }
  }
}

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
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}${plusGrande(NUIT)}">
<link rel="canonical" href="${SITE}">
<script>
/* Résout le thème avant tout rendu, puis ne précharge que la photo réellement
   affichée. Un préchargement conditionné par media suivrait la préférence du
   système et téléchargerait la mauvaise photo quand un thème est forcé. */
(function () {
  try {
    var t = null;
    try { t = localStorage.getItem('pc-theme'); } catch (e) {}
    if (t === 'light' || t === 'dark') {
      document.documentElement.dataset.theme = t;
    } else {
      t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    var clair = t === 'light';
    var l = document.createElement('link');
    l.rel = 'preload';
    l.as = 'image';
    l.href = clair ? '${plusGrande(JOUR)}' : '${plusGrande(NUIT)}';
    l.setAttribute('imagesrcset', clair
      ? '${srcset(JOUR)}'
      : '${srcset(NUIT)}');
    l.setAttribute('imagesizes', '${SIZES}');
    document.head.appendChild(l);
  } catch (e) { /* sans script : pas de préchargement, la photo se charge normalement */ }
})();
</script>
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
  plusGrande(NUIT), plusGrande(JOUR), AVIS_PDF, AVIS_PAGES[0],
  `<link rel="canonical" href="${SITE}">`,
  'id="themeBtn"', 'id="suggestBtn"', 'id="stats"', '</body>', '</html>']) {
  if (!doc.includes(needed)) throw new Error(`sortie : ${needed} manquant`);
}
// La page ne doit porter aucune adresse de courriel : les suggestions passent par
// /api/suggestions et se relisent sur place. Les motifs restent volontairement génériques
// — y inscrire l'adresse à proscrire reviendrait à la publier dans un dépôt public.
for (const interdit of [/mailto:/i, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/]) {
  const trouve = doc.match(interdit);
  if (trouve) throw new Error(`sortie : « ${trouve[0]} » ne doit pas figurer dans la page`);
}

if ((doc.match(/<html/g) || []).length !== 1) throw new Error('sortie : <html> en double');
if ((doc.match(/<body/g) || []).length !== 1) throw new Error('sortie : <body> en double');
// aucune adresse de photo ne doit être atteignable par l'analyseur spéculatif
if (/<img[^>]*class="hero-photo"[^>]*\ssrc=/.test(doc)) throw new Error('sortie : la photo du héro ne doit pas porter de src statique');
if (/<img[^>]*class="hero-photo"[^>]*\ssrcset=/.test(doc)) throw new Error('sortie : la photo du héro ne doit pas porter de srcset statique');

console.log('index.html reconstruit :', Math.round(fs.statSync(out).size / 1024),
  'Ko | viewport OK | 2 photos liées | bascule de thème');
