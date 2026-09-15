// Isole, dans une capture de trafic, les requêtes Citykomi qui portent le statut du pont.
//
// À lancer sur ce que produisent HTTP Toolkit, les DevTools ou mitmproxy :
//
//   node src/citykomi_traces.mjs capture.har
//   node src/citykomi_traces.mjs flows.json --tout     # ne rien filtrer
//   node src/citykomi_traces.mjs capture.har --brut    # secrets en clair (voir plus bas)
//
// Formats acceptés : HAR (DevTools, HTTP Toolkit, « File > Export > HAR » de mitmweb) et
// tout JSON qui est un tableau d'objets { request, response }.
//
// CE QUI EST MASQUÉ, ET POURQUOI
// Le rapport est fait pour être recopié dans une conversation ou un ticket. Les en-têtes
// qui ressemblent à un jeton ou à un identifiant d'appareil y sont donc réduits à leur
// forme — type, longueur, empreinte courte — et jamais à leur valeur. Un jeton collé dans
// un fil de discussion est un jeton à révoquer. « --brut » lève le masque, pour un usage
// strictement local.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const fichier = args.find(a => !a.startsWith('--'));
const BRUT = args.includes('--brut');
const TOUT = args.includes('--tout');

if (!fichier) {
  console.error('usage : node src/citykomi_traces.mjs <capture.har|flows.json> [--tout] [--brut]');
  process.exit(2);
}

// Ce qui trahit un appel qui nous intéresse.
const HOTE_UTILE = /citykomi|obdo/i;
const CORPS_UTILE = /colbert|diffuseur|broadcaster|message/i;
const STATUT_UTILE = /\bouvert|\bferm[eé]/i;

// En-têtes porteurs d'identité. C'est aussi la liste qui sert à répondre à la question
// « cet appel est-il rejouable depuis un serveur, ou lié à un appareil ? ».
const ENTETES_SENSIBLES = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth[-_]?token|x-access[-_]?token|x-session[-_]?id|x-device[-_]?id|x-installation[-_]?id|x-client[-_]?id|x-user[-_]?id|token|apikey|api[-_]?key)$/i;

// ---------------------------------------------------------------------------
// Lecture des formats de capture
// ---------------------------------------------------------------------------

function corpsHAR(contenu) {
  if (!contenu || contenu.text == null) return '';
  if (contenu.encoding === 'base64') {
    try { return Buffer.from(contenu.text, 'base64').toString('utf8'); } catch { return ''; }
  }
  return contenu.text;
}

const entetesEnObjet = liste => {
  const o = {};
  for (const h of liste || []) if (h && h.name != null) o[String(h.name).toLowerCase()] = String(h.value ?? '');
  return o;
};

function charger(chemin) {
  const brut = readFileSync(chemin, 'utf8');
  let d;
  try { d = JSON.parse(brut); }
  catch (e) {
    // mitmproxy écrit par défaut un flux binaire, que JSON.parse ne peut pas lire. Le dire
    // franchement plutôt que de laisser une trace de pile.
    throw new Error(
      `${chemin} n'est pas du JSON (${e.message}).\n`
      + "  Un fichier mitmproxy « -w flows » est binaire : l'exporter en HAR depuis mitmweb\n"
      + '  (File > Export), ou relancer la capture avec HTTP Toolkit qui exporte en HAR.');
  }

  // HAR
  if (d && d.log && Array.isArray(d.log.entries)) {
    return d.log.entries.map(e => ({
      quand: e.startedDateTime || '',
      methode: e.request?.method || '?',
      url: e.request?.url || '',
      entetesReq: entetesEnObjet(e.request?.headers),
      corpsReq: e.request?.postData?.text || '',
      statut: e.response?.status ?? 0,
      entetesRep: entetesEnObjet(e.response?.headers),
      corpsRep: corpsHAR(e.response?.content),
    }));
  }

  // Tableau générique { request, response }
  if (Array.isArray(d)) {
    return d.map(e => ({
      quand: e.timestamp || e.startedDateTime || '',
      methode: e.request?.method || e.method || '?',
      url: e.request?.url || e.url || '',
      entetesReq: e.request?.headers || e.requestHeaders || {},
      corpsReq: e.request?.body || e.requestBody || '',
      statut: e.response?.status ?? e.status ?? 0,
      entetesRep: e.response?.headers || e.responseHeaders || {},
      corpsRep: e.response?.body || e.responseBody || '',
    }));
  }

  throw new Error('format non reconnu : ni HAR, ni tableau de requêtes');
}

// ---------------------------------------------------------------------------
// Masquage
// ---------------------------------------------------------------------------

// Un JWT porte sa date d'expiration en clair dans sa charge utile. La lire répond à
// « combien de temps ce jeton vit-il ? » sans jamais divulguer la signature.
function litJWT(valeur) {
  const m = /([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})/.exec(valeur);
  if (!m) return null;
  try {
    const charge = JSON.parse(Buffer.from(m[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const s = n => (typeof charge[n] === 'number' ? new Date(charge[n] * 1000).toISOString() : null);
    const vie = (typeof charge.exp === 'number' && typeof charge.iat === 'number')
      ? Math.round((charge.exp - charge.iat) / 60) + ' min' : null;
    return { emis: s('iat'), expire: s('exp'), vie, champs: Object.keys(charge).join(', ') };
  } catch { return null; }
}

function masque(nom, valeur) {
  if (BRUT) return valeur;
  const v = String(valeur);
  const empreinte = createHash('sha256').update(v).digest('hex').slice(0, 8);
  const jwt = litJWT(v);
  const forme = jwt ? 'JWT' : /^Bearer\s/i.test(v) ? 'Bearer' : /^[0-9a-f-]{32,}$/i.test(v) ? 'hex/uuid' : 'opaque';
  return `«${forme}, ${v.length} car., empreinte ${empreinte}»`;
}

// ---------------------------------------------------------------------------
// Forme du JSON : d'où sortir la liste, le texte et la date
// ---------------------------------------------------------------------------

// Parcourt la réponse et propose les chemins pointés à recopier dans AMONT.champs.
// C'est l'étape qui rend le branchement mécanique : sans elle il faut lire le JSON à l'œil.
function proposeChamps(json) {
  const listes = [];
  (function marche(v, chemin, profondeur) {
    if (profondeur > 6 || v == null) return;
    if (Array.isArray(v)) {
      if (v.length && typeof v[0] === 'object') listes.push({ chemin: chemin || '[]', taille: v.length, premier: v[0] });
      return;
    }
    if (typeof v === 'object') for (const [k, sous] of Object.entries(v)) marche(sous, chemin ? chemin + '.' + k : k, profondeur + 1);
  })(json, '', 0);

  if (!listes.length) return null;
  // La liste la plus prometteuse est celle dont le premier élément porte du texte long.
  listes.sort((a, b) => scoreElement(b.premier) - scoreElement(a.premier));
  const { chemin, premier, taille } = listes[0];

  const textes = [], dates = [];
  (function champs(o, prefixe, profondeur) {
    if (profondeur > 3 || o == null || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o)) {
      const p = prefixe ? prefixe + '.' + k : k;
      if (typeof v === 'string') {
        if (/^\d{4}-\d{2}-\d{2}|GMT|\+\d{2}:\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) dates.push(p);
        else if (v.length >= 3) textes.push({ chemin: p, longueur: v.length, apercu: v.slice(0, 70) });
      } else if (typeof v === 'number' && v > 1e9 && v < 4e12) dates.push(p + '  (horodatage numérique)');
      else if (v && typeof v === 'object' && !Array.isArray(v)) champs(v, p, profondeur + 1);
    }
  })(premier, '', 0);

  textes.sort((a, b) => b.longueur - a.longueur);
  return { chemin, taille, textes: textes.slice(0, 6), dates: dates.slice(0, 4) };
}

const scoreElement = o => {
  const s = JSON.stringify(o || {});
  return (STATUT_UTILE.test(s) ? 100 : 0) + (/colbert/i.test(s) ? 100 : 0) + Math.min(s.length, 400) / 100;
};

// ---------------------------------------------------------------------------

let entrees;
try { entrees = charger(fichier); }
catch (e) { console.error('\n' + e.message + '\n'); process.exit(1); }

const retenues = TOUT ? entrees : entrees.filter(e =>
  HOTE_UTILE.test(e.url) || CORPS_UTILE.test(e.corpsRep || '') || STATUT_UTILE.test(e.corpsRep || ''));

console.log(`\n${entrees.length} requêtes dans ${fichier}, ${retenues.length} retenues\n`);
if (!retenues.length) {
  console.log('  Aucune requête ne mentionne Citykomi ni le pont.');
  console.log('  Relancer avec --tout pour tout lister, et vérifier que la capture a bien');
  console.log('  enregistré le trafic de l\'application (et non celui du seul navigateur).\n');
  process.exit(0);
}

// Note chaque appel, le meilleur en tête.
const note = e => {
  let n = 0;
  if (e.statut === 200) n += 2;
  if (/json/i.test(e.entetesRep['content-type'] || '')) n += 3;
  if (/colbert/i.test(e.corpsRep || '')) n += 6;
  if (STATUT_UTILE.test(e.corpsRep || '')) n += 4;
  if (HOTE_UTILE.test(e.url)) n += 2;
  return n;
};
retenues.sort((a, b) => note(b) - note(a));

for (const [i, e] of retenues.entries()) {
  const t = (e.entetesRep['content-type'] || '?').split(';')[0];
  console.log(`  [${String(i + 1).padStart(2)}] ${note(e).toString().padStart(2)} pts  ${e.methode.padEnd(5)} ${e.statut}  ${t.padEnd(18)} ${e.url.slice(0, 96)}`);
}

// --- le meilleur candidat, en détail ---------------------------------------
const gagnant = retenues[0];
console.log('\n=== candidat retenu ===\n');
console.log(`  ${gagnant.methode} ${gagnant.url}`);
console.log(`  réponse : HTTP ${gagnant.statut}, ${(gagnant.corpsRep || '').length} octets`);

const sensibles = Object.entries(gagnant.entetesReq).filter(([n]) => ENTETES_SENSIBLES.test(n));
console.log('\n  en-têtes porteurs d\'identité :');
if (!sensibles.length) {
  console.log('    aucun — l\'appel semble anonyme, donc rejouable depuis un serveur.');
} else {
  for (const [n, v] of sensibles) {
    console.log(`    ${n}: ${masque(n, v)}`);
    const jwt = litJWT(String(v));
    if (jwt) {
      console.log(`      JWT — émis ${jwt.emis || '?'}, expire ${jwt.expire || '?'}`
        + (jwt.vie ? `, durée de vie ${jwt.vie}` : ''));
      console.log(`      champs : ${jwt.champs}`);
    }
  }
  console.log('    → à confirmer : ces valeurs sont-elles acceptées depuis une autre adresse IP,');
  console.log('      et que répond le serveur une fois le jeton expiré ?');
}

if (gagnant.corpsReq) {
  console.log(`\n  corps de la requête (${gagnant.corpsReq.length} octets) :`);
  console.log('    ' + String(gagnant.corpsReq).slice(0, 300).replace(/\s+/g, ' '));
}

let json = null;
try { json = JSON.parse(gagnant.corpsRep); } catch { /* pas du JSON */ }

console.log('\n  réponse (extrait) :');
console.log('    ' + String(gagnant.corpsRep || '').slice(0, 500).replace(/\s+/g, ' ') + '…');

if (json) {
  const c = proposeChamps(json);
  if (c) {
    console.log(`\n  --- à recopier dans AMONT, workers/statut/index.js ---`);
    console.log(`  forme: 'json',`);
    console.log(`  url: '${gagnant.url}',`);
    console.log(`  champs: {`);
    console.log(`    liste: '${c.chemin}',          // ${c.taille} éléments`);
    if (c.textes.length) {
      console.log(`    texte: '${c.textes[0].chemin}',`);
      for (const t of c.textes.slice(1)) console.log(`    // autre texte possible : '${t.chemin}' — ${JSON.stringify(t.apercu)}`);
    } else console.log("    texte: '?',   // aucun champ texte évident");
    console.log(`    date: '${c.dates[0] || '?'}',`);
    console.log(`  },`);
  }
}

console.log('\n=== ce qu\'il est utile de transmettre ===\n');
console.log('  - la ligne « candidat retenu » ci-dessus (méthode + URL)');
console.log('  - les en-têtes porteurs d\'identité, sous la forme masquée telle quelle');
console.log('  - l\'extrait de réponse, si aucun nom de personne n\'y figure');
console.log('  - le bloc AMONT proposé');
console.log(BRUT
  ? '\n  ATTENTION : lancé avec --brut, la sortie contient des secrets en clair. Ne pas la coller ailleurs.\n'
  : '\n  Les valeurs de jetons sont masquées : cette sortie peut être recopiée telle quelle.\n');
