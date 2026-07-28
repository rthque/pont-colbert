// Vérifie la fonction de recueil des suggestions sans déployer.
//
// functions/api/suggestions.js est un module ES destiné à l'exécution Cloudflare ; le
// reste du dépôt est en CommonJS. Il est donc chargé ici depuis une adresse data:, ce qui
// lui conserve sa sémantique de module sans imposer un package.json à tout le dépôt.
//
// Usage : node src/test_suggestions.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(racine, 'functions/api/suggestions.js'), 'utf8');
const api = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));

// --- espace KV simulé -------------------------------------------------------
const kvFactice = () => {
  const boite = new Map();
  return { get: async k => (boite.has(k) ? boite.get(k) : null), put: async (k, v) => void boite.set(k, v) };
};
const env = () => ({ SUGGESTIONS: kvFactice(), MODERATION_JETON: 'jeton-de-test' });

const poste = (env, corps) => api.onRequestPost({
  request: new Request('https://exemple/api/suggestions', {
    method: 'POST', body: JSON.stringify(corps), headers: { 'content-type': 'application/json' }
  }),
  env
});
const supprime = (env, id, jeton) => api.onRequestDelete({
  request: new Request('https://exemple/api/suggestions?id=' + encodeURIComponent(id), {
    method: 'DELETE', headers: jeton ? { authorization: 'Bearer ' + jeton } : {}
  }),
  env
});

let echecs = 0;
async function verifie(intitule, fn) {
  try {
    await fn();
    console.log('  ok   ' + intitule);
  } catch (e) {
    echecs++;
    console.log('  ECHEC ' + intitule + ' — ' + e.message);
  }
}
const egal = (obtenu, attendu, quoi) => {
  const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
  if (a !== b) throw new Error(`${quoi} : ${a} au lieu de ${b}`);
};

console.log('fonction /api/suggestions');

await verifie('sans espace KV lié, message explicite et 503', async () => {
  const r = await api.onRequestGet({ env: {} });
  egal(r.status, 503, 'statut');
  const d = await r.json();
  if (!/SUGGESTIONS/.test(d.erreur)) throw new Error('le message ne nomme pas la liaison manquante');
  egal(d.suggestions, [], 'liste de repli');
});

await verifie('liste vide au départ', async () => {
  const r = await api.onRequestGet({ env: env() });
  egal(r.status, 200, 'statut');
  egal((await r.json()).suggestions, [], 'liste');
});

await verifie('dépôt puis relecture', async () => {
  const e = env();
  const r = await poste(e, { texte: 'Ajouter les coefficients de marée', qui: 'Jason / WC59' });
  egal(r.status, 200, 'statut');
  const relu = await (await api.onRequestGet({ env: e })).json();
  egal(relu.suggestions.length, 1, 'nombre');
  egal(relu.suggestions[0].texte, 'Ajouter les coefficients de marée', 'texte');
  egal(relu.suggestions[0].qui, 'Jason / WC59', 'auteur');
  if (!relu.suggestions[0].id || !relu.suggestions[0].quand) throw new Error('id ou date manquant');
});

await verifie('la plus récente en tête', async () => {
  const e = env();
  await poste(e, { texte: 'première proposition' });
  await poste(e, { texte: 'seconde proposition' });
  const d = await (await api.onRequestGet({ env: e })).json();
  egal(d.suggestions.map(s => s.texte), ['seconde proposition', 'première proposition'], 'ordre');
});

await verifie('leurre rempli : acquiescement sans enregistrement', async () => {
  const e = env();
  const r = await poste(e, { texte: 'publicité quelconque', site: 'http://spam' });
  egal(r.status, 202, 'statut');
  egal((await (await api.onRequestGet({ env: e })).json()).suggestions, [], 'liste restée vide');
});

await verifie('texte trop court refusé', async () => {
  egal((await poste(env(), { texte: 'ok' })).status, 400, 'statut');
});

await verifie('texte trop long refusé', async () => {
  const r = await poste(env(), { texte: 'a'.repeat(1201) });
  egal(r.status, 400, 'statut');
  if (!/1200/.test((await r.json()).erreur)) throw new Error('la limite n est pas rappelée');
});

await verifie('corps illisible refusé', async () => {
  const r = await api.onRequestPost({
    request: new Request('https://exemple/api/suggestions', { method: 'POST', body: 'pas du json' }),
    env: env()
  });
  egal(r.status, 400, 'statut');
});

await verifie('doublon consécutif ignoré', async () => {
  const e = env();
  await poste(e, { texte: 'même texte exactement' });
  await poste(e, { texte: 'même texte exactement' });
  egal((await (await api.onRequestGet({ env: e })).json()).suggestions.length, 1, 'nombre');
});

await verifie('sauts de ligne gardés, caractères de contrôle retirés', async () => {
  const e = env();
  await poste(e, { texte: 'ligne un\nligne deux' + String.fromCharCode(0, 7, 27) });
  const s = (await (await api.onRequestGet({ env: e })).json()).suggestions[0];
  egal(s.texte, 'ligne un\nligne deux', 'texte nettoyé');
});

await verifie('nom tronqué à 60 caractères', async () => {
  const e = env();
  await poste(e, { texte: 'une suggestion', qui: 'x'.repeat(200) });
  egal((await (await api.onRequestGet({ env: e })).json()).suggestions[0].qui.length, 60, 'longueur');
});

await verifie('plafond à 300 entrées', async () => {
  const e = env();
  for (let i = 0; i < 305; i++) await poste(e, { texte: 'proposition numéro ' + i });
  const d = await (await api.onRequestGet({ env: e })).json();
  egal(d.suggestions.length, 300, 'nombre');
  egal(d.suggestions[0].texte, 'proposition numéro 304', 'la plus récente conservée');
});

await verifie('suppression sans jeton refusée', async () => {
  const e = env();
  await poste(e, { texte: 'à conserver malgré tout' });
  const id = (await (await api.onRequestGet({ env: e })).json()).suggestions[0].id;
  egal((await supprime(e, id, null)).status, 403, 'statut sans jeton');
  egal((await supprime(e, id, 'mauvais-jeton')).status, 403, 'statut avec mauvais jeton');
  egal((await (await api.onRequestGet({ env: e })).json()).suggestions.length, 1, 'toujours là');
});

await verifie('suppression avec le bon jeton', async () => {
  const e = env();
  await poste(e, { texte: 'proposition à retirer' });
  const id = (await (await api.onRequestGet({ env: e })).json()).suggestions[0].id;
  const r = await supprime(e, id, 'jeton-de-test');
  egal(r.status, 200, 'statut');
  egal((await r.json()).suggestions, [], 'liste vidée');
});

await verifie('modération non configurée : 503, pas 403', async () => {
  const e = env();
  delete e.MODERATION_JETON;
  egal((await supprime(e, 'peu-importe', 'jeton-de-test')).status, 503, 'statut');
});

console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est vert');
process.exit(echecs ? 1 : 0);
