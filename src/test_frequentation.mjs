// Vérifie les compteurs de fréquentation sans déployer : filtrage des robots, fenêtre de
// session, remise à zéro.
//
// Usage : node src/test_frequentation.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(racine, 'functions/api/frequentation.js'), 'utf8');
const api = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));

// --- espace KV simulé, avec expiration ---------------------------------------
const kvFactice = () => {
  const boite = new Map();
  return {
    boite,
    async get(k) {
      const e = boite.get(k);
      if (!e) return null;
      if (e.expire && e.expire <= Date.now()) { boite.delete(k); return null; }
      return e.valeur;
    },
    async put(k, valeur, opts = {}) {
      boite.set(k, { valeur, expire: opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0 });
    },
  };
};
const env = () => ({ SUGGESTIONS: kvFactice(), MODERATION_JETON: 'jeton-de-test' });

const UA_HUMAIN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// La fonction n'utilise que request.cf, request.headers.get et request.json : un objet
// simple suffit, et évite d'avoir à simuler la propriété cf sur un vrai Request.
function requete({ ua = UA_HUMAIN, langue = 'fr-FR,fr;q=0.9', origine = 'same-origin',
                   ip = '203.0.113.7', cf = {}, corps = {} } = {}) {
  const entetes = new Map();
  if (ua !== null) entetes.set('user-agent', ua);
  if (langue !== null) entetes.set('accept-language', langue);
  if (origine !== null) entetes.set('sec-fetch-site', origine);
  if (ip !== null) entetes.set('cf-connecting-ip', ip);
  return {
    cf,
    headers: { get: n => (entetes.has(n) ? entetes.get(n) : null) },
    json: async () => corps,
  };
}

const compte = (e, opts) => api.onRequestPost({ request: requete(opts), env: e });
const lire = e => api.onRequestGet({ env: e });

let echecs = 0;
async function verifie(intitule, fn) {
  try { await fn(); console.log('  ok   ' + intitule); }
  catch (err) { echecs++; console.log('  ECHEC ' + intitule + ' — ' + err.message); }
}
const egal = (obtenu, attendu, quoi) => {
  if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) {
    throw new Error(`${quoi} : ${JSON.stringify(obtenu)} au lieu de ${JSON.stringify(attendu)}`);
  }
};

console.log('fonction /api/frequentation');

await verifie('sans espace KV lié : 503 explicite', async () => {
  const r = await api.onRequestGet({ env: {} });
  egal(r.status, 503, 'statut');
  if (!/SUGGESTIONS/.test((await r.json()).erreur)) throw new Error('liaison manquante non nommée');
});

await verifie('au départ, tout est à zéro', async () => {
  const d = await (await lire(env())).json();
  egal([d.visites, d.visiteurs], [0, 0], 'compteurs');
});

await verifie('visiteur humain : visite et visiteur comptés', async () => {
  const e = env();
  const d = await (await compte(e, { corps: { nouveau: true } })).json();
  egal([d.visites, d.visiteurs, d.compte], [1, 1, true], 'compteurs');
});

await verifie('visiteur connu : la visite compte, pas le visiteur', async () => {
  const e = env();
  const d = await (await compte(e, { corps: { nouveau: false } })).json();
  egal([d.visites, d.visiteurs], [1, 0], 'compteurs');
});

await verifie('lecture seule : aucun effet sur les compteurs', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  await lire(e); await lire(e);
  const d = await (await lire(e)).json();
  egal([d.visites, d.visiteurs], [1, 1], 'compteurs');
});

const REJETS = [
  ['agent déclaré robot', { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }],
  ['aperçu de lien', { ua: 'Mozilla/5.0 (compatible; facebookexternalhit/1.1)' }],
  ['moissonneur d IA', { ua: 'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)' }],
  ['navigateur sans interface', { ua: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/126.0.0.0 Safari/537.36' }],
  ['client en ligne de commande', { ua: 'curl/8.4.0' }],
  ['bibliothèque Python', { ua: 'python-requests/2.31.0' }],
  ['agent absent', { ua: null }],
  ['agent trop court', { ua: 'Mozilla/5.0' }],
  ['aucune langue annoncée', { langue: null }],
  ['appel direct, hors page', { origine: null }],
  ['appel depuis un autre site', { origine: 'cross-site' }],
  ['robot vérifié par Cloudflare', { cf: { verifiedBotCategory: 'Search Engine Crawler' } }],
  ['score de robot bas', { cf: { botScore: 3 } }],
];
for (const [intitule, opts] of REJETS) {
  await verifie('écarté : ' + intitule, async () => {
    const e = env();
    const d = await (await compte(e, { ...opts, corps: { nouveau: true } })).json();
    egal([d.visites, d.visiteurs, d.compte], [0, 0, false], 'compteurs');
    if (!d.motif) throw new Error('aucun motif de rejet renvoyé');
  });
}

await verifie('un robot voit quand même les chiffres', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  const d = await (await compte(e, { ua: 'curl/8.4.0', ip: '198.51.100.9' })).json();
  egal([d.visites, d.visiteurs], [1, 1], 'chiffres renvoyés malgré le rejet');
});

await verifie('score élevé accepté', async () => {
  const e = env();
  const d = await (await compte(e, { cf: { botScore: 92 }, corps: { nouveau: true } })).json();
  egal(d.compte, true, 'comptée');
});

await verifie('rechargement dans la fenêtre de session : une seule visite', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  const d = await (await compte(e, { corps: { nouveau: true } })).json();
  egal([d.visites, d.visiteurs, d.compte], [1, 1, false], 'compteurs');
  egal(d.motif, 'session déjà comptée', 'motif');
});

await verifie('une autre adresse compte séparément', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  const d = await (await compte(e, { ip: '198.51.100.42', corps: { nouveau: true } })).json();
  egal([d.visites, d.visiteurs], [2, 2], 'compteurs');
});

await verifie('un autre navigateur, même adresse, compte séparément', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  const autre = UA_HUMAIN.replace('iPhone OS 17_5', 'iPhone OS 16_2');
  const d = await (await compte(e, { ua: autre, corps: { nouveau: true } })).json();
  egal(d.visites, 2, 'visites');
});

await verifie('aucune adresse IP conservée dans le stockage', async () => {
  const e = env();
  await compte(e, { ip: '203.0.113.77', corps: { nouveau: true } });
  const contenu = JSON.stringify([...e.SUGGESTIONS.boite.entries()]);
  if (contenu.includes('203.0.113.77')) throw new Error('une adresse IP figure dans le stockage');
  const cles = [...e.SUGGESTIONS.boite.keys()];
  if (!cles.some(k => k.startsWith('vu:'))) throw new Error('empreinte de session absente');
  if (!cles.some(k => k.startsWith('sel:'))) throw new Error('sel du jour absent');
});

await verifie('le sel du jour expire, les empreintes aussi', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  const sel = [...e.SUGGESTIONS.boite.entries()].find(([k]) => k.startsWith('sel:'))[1];
  const vu = [...e.SUGGESTIONS.boite.entries()].find(([k]) => k.startsWith('vu:'))[1];
  if (!sel.expire) throw new Error('le sel ne porte pas d expiration');
  if (!vu.expire) throw new Error('l empreinte ne porte pas d expiration');
  if (vu.expire >= sel.expire) throw new Error('l empreinte devrait expirer avant le sel');
});

await verifie('remise à zéro refusée sans jeton', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  const r = await api.onRequestDelete({ request: requete({ ip: null }), env: e });
  egal(r.status, 403, 'statut');
  egal((await (await lire(e)).json()).visites, 1, 'compteur intact');
});

await verifie('remise à zéro avec le bon jeton', async () => {
  const e = env();
  await compte(e, { corps: { nouveau: true } });
  const req = requete();
  req.headers = { get: n => (n === 'authorization' ? 'Bearer jeton-de-test' : null) };
  const r = await api.onRequestDelete({ request: req, env: e });
  egal(r.status, 200, 'statut');
  egal((await (await lire(e)).json()), { visites: 0, visiteurs: 0 }, 'compteurs remis à zéro');
});

console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est vert');
process.exit(echecs ? 1 : 0);
