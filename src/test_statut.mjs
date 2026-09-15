// Vérifie la lecture du statut sans déployer : déduction de l'état à partir du texte du
// message, écriture sur changement seulement, battement, pannes d'amont, péremption.
//
// Usage : node src/test_statut.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const charge = async rel => {
  const source = readFileSync(path.join(racine, rel), 'utf8');
  return import('data:text/javascript;charset=utf-8,' + encodeURIComponent(source));
};

const collecteur = await charge('workers/statut/index.js');
const service = await charge('functions/api/statut.js');

// --- espace KV simulé --------------------------------------------------------
const kvFactice = () => {
  const boite = new Map();
  let ecritures = 0;
  return {
    boite,
    get ecritures() { return ecritures; },
    async get(k) { return boite.has(k) ? boite.get(k) : null; },
    async put(k, v) { ecritures++; boite.set(k, v); },
  };
};
const env = kv => ({ ETAT: kv, MODERATION_JETON: 'jeton-de-test' });

// --- amont simulé : on remplace fetch, la forme attendue est celle de WordPress ---------
const articleWP = (texte, date) => JSON.stringify([{
  title: { rendered: texte },
  excerpt: { rendered: '' },
  // WordPress rend date_gmt sans suffixe de fuseau ; le collecteur y ajoute le Z.
  date_gmt: date.toISOString().replace(/Z$/, ''),
}]);
const amontRend = corps => { globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => corps }); };
const amontRefuse = statut => { globalThis.fetch = async () => ({ ok: false, status: statut, text: async () => '' }); };
const amontTombe = () => { globalThis.fetch = async () => { throw new Error('ECONNRESET'); }; };

// --- petit harnais ----------------------------------------------------------
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

// ===========================================================================
console.log('\ndéduction de l\'état à partir du message');

const etat = t => collecteur.deduireEtat(t)?.etat ?? null;
const confiance = t => collecteur.deduireEtat(t)?.confiance ?? null;

// Le format annoncé par le diffuseur, dans ses variantes plausibles.
await verifie('« Pont Colbert ouvert » → ouvert', () => {
  egal(etat('Pont Colbert ouvert'), 'ouvert', 'état');
  egal(confiance('Pont Colbert ouvert'), 'entete', 'confiance');
});
await verifie('« Pont Colbert fermé » → fermé', () => egal(etat('Pont Colbert fermé'), 'ferme', 'état'));
await verifie('capitales et accents indifférents', () => egal(etat('PONT COLBERT FERME'), 'ferme', 'état'));
await verifie('tournure « est actuellement fermé »', () => egal(etat('Le pont Colbert est actuellement fermé'), 'ferme', 'état'));
await verifie('pictogramme de feu en tête', () => egal(etat('\u{1F7E2} Pont Colbert ouvert'), 'ouvert', 'état'));
await verifie('balisage HTML retiré', () => egal(etat('<p>Pont Colbert <strong>ouvert</strong></p>'), 'ouvert', 'état'));
await verifie('apostrophe typographique tolérée', () => egal(etat('Pont Colbert ouvert ’'), 'ouvert', 'état'));

// Ce qu'il ne faut SURTOUT pas prendre pour un état courant.
await verifie('« fermeture » n\'est pas « fermé »', () => egal(etat('Fermeture du pont pour travaux'), null, 'état'));
await verifie('« réouverture » n\'est pas « ouvert »', () => egal(etat('Réouverture du pont Colbert prévue en février'), null, 'état'));
await verifie('annonce au futur écartée', () => egal(etat('Le pont sera fermé demain de 8h à 10h'), null, 'état'));
await verifie('« jusqu\'à » écarte aussi', () => egal(etat('Circulation interrompue jusqu\'à nouvel ordre'), null, 'état'));
await verifie('les deux mots à la fois : on ne tranche pas', () => egal(etat('Pont fermé à la circulation, ouvert aux piétons'), null, 'état'));
await verifie('communiqué sans statut', () => egal(etat('Merci de votre patience pendant les travaux'), null, 'état'));
await verifie('texte vide', () => egal(etat(''), null, 'état'));
await verifie('texte absent', () => { egal(etat(null), null, 'null'); egal(etat(undefined), null, 'undefined'); });

// Un statut hors en-tête reste accepté, mais signalé comme moins sûr : le site peut
// choisir de ne montrer que « entete ».
await verifie('statut hors en-tête : confiance moindre', () => {
  egal(etat('Info trafic : le pont est ouvert'), 'ouvert', 'état');
  egal(confiance('Info trafic : le pont est ouvert'), 'mot', 'confiance');
});

// ===========================================================================
console.log('\ncollecte et écriture dans KV');

const T0 = new Date('2026-09-15T12:00:00Z');
const plus = (d, minutes) => new Date(d.getTime() + minutes * 60000);

await verifie('premier relevé : écrit', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', T0));
  const b = await collecteur.collecter(env(kv), T0);
  egal(b.ecrit, true, 'écrit');
  egal(b.motif, 'premier relevé', 'motif');
  egal(JSON.parse(kv.boite.get('statut')).etat, 'ouvert', 'état stocké');
});

await verifie('statut inchangé : aucune écriture', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', T0));
  await collecteur.collecter(env(kv), T0);
  const avant = kv.ecritures;
  // Dix passages de cron dans la demi-heure qui suit.
  for (let i = 1; i <= 10; i++) await collecteur.collecter(env(kv), plus(T0, i));
  egal(kv.ecritures - avant, 0, 'écritures supplémentaires');
});

await verifie('battement : réécrit au bout de 30 min', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', T0));
  await collecteur.collecter(env(kv), T0);
  egal((await collecteur.collecter(env(kv), plus(T0, 29))).ecrit, false, 'à 29 min');
  const b = await collecteur.collecter(env(kv), plus(T0, 30));
  egal(b.ecrit, true, 'à 30 min');
  egal(b.motif, 'battement', 'motif');
  egal(JSON.parse(kv.boite.get('statut')).verifieA, plus(T0, 30).toISOString(), 'verifieA rafraîchi');
});

await verifie('changement d\'état : écrit', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', T0));
  await collecteur.collecter(env(kv), T0);
  amontRend(articleWP('Pont Colbert fermé', plus(T0, 5)));
  const b = await collecteur.collecter(env(kv), plus(T0, 5));
  egal(b.motif, 'changement', 'motif');
  egal(JSON.parse(kv.boite.get('statut')).etat, 'ferme', 'état stocké');
});

await verifie('budget d\'écritures tenable sur 24 h', async () => {
  const kv = kvFactice();
  // 1 440 passages de cron, l'état ne changeant que 20 fois dans la journée.
  for (let m = 0; m < 1440; m++) {
    const change = m % 72 === 0;
    amontRend(articleWP(change && (m / 72) % 2 ? 'Pont Colbert fermé' : 'Pont Colbert ouvert',
      change ? plus(T0, m) : plus(T0, Math.floor(m / 72) * 72)));
    await collecteur.collecter(env(kv), plus(T0, m));
  }
  // Quota KV gratuit : 1 000 écritures par jour. On doit rester très en dessous.
  if (kv.ecritures > 120) throw new Error(`${kv.ecritures} écritures pour 1 440 passages`);
  console.log(`       (${kv.ecritures} écritures pour 1 440 passages de cron)`);
});

await verifie('amont en panne : rien n\'est touché', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', T0));
  await collecteur.collecter(env(kv), T0);
  const garde = kv.boite.get('statut');

  amontTombe();
  const b = await collecteur.collecter(env(kv), plus(T0, 1));
  egal(b.ecrit, false, 'écrit');
  if (!/amont indisponible/.test(b.motif)) throw new Error('motif : ' + b.motif);
  egal(kv.boite.get('statut'), garde, 'enregistrement intact');
});

await verifie('amont qui limite le débit (429) : on repasse plus tard', async () => {
  const kv = kvFactice();
  amontRefuse(429);
  const b = await collecteur.collecter(env(kv), T0);
  egal(b.ecrit, false, 'écrit');
  if (!/429/.test(b.motif)) throw new Error('motif : ' + b.motif);
});

await verifie('message trop ancien : pas de statut', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', new Date('2025-01-01T00:00:00Z')));
  const b = await collecteur.collecter(env(kv), T0);
  egal(b.ecrit, false, 'écrit');
  egal(b.motif, 'message trop ancien', 'motif');
});

await verifie('message sans statut : pas d\'écriture', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Réunion publique le 7 avril', T0));
  egal((await collecteur.collecter(env(kv), T0)).motif, 'message sans statut lisible', 'motif');
});

await verifie('sans espace KV lié : erreur explicite', async () => {
  amontRend(articleWP('Pont Colbert ouvert', T0));
  try { await collecteur.collecter({}, T0); throw new Error('aurait dû lever'); }
  catch (e) { if (!/ETAT/.test(e.message)) throw new Error('liaison non nommée : ' + e.message); }
});

// ===========================================================================
console.log('\nservice /api/statut');

const sert = async kv => (await service.onRequestGet({ env: env(kv) })).json();

await verifie('aucun relevé : état nul, non frais', async () => {
  const d = await sert(kvFactice());
  egal([d.etat, d.frais], [null, false], 'réponse');
});

await verifie('relevé frais : état servi', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', new Date()));
  await collecteur.collecter(env(kv));
  const d = await sert(kv);
  egal([d.etat, d.frais], ['ouvert', true], 'réponse');
});

await verifie('relevé périmé : rien n\'est affirmé', async () => {
  const kv = kvFactice();
  await kv.put('statut', JSON.stringify({
    etat: 'ouvert',
    depuis: '2026-09-15T00:00:00.000Z',
    // 40 minutes : au-delà du seuil de 35, battement compris.
    verifieA: new Date(Date.now() - 40 * 60000).toISOString(),
  }));
  const d = await sert(kv);
  egal([d.etat, d.frais, d.motif], [null, false, 'relevé périmé'], 'réponse');
});

await verifie('relevé illisible : pas de plantage', async () => {
  const kv = kvFactice();
  await kv.put('statut', '{ceci n\'est pas du json');
  const d = await sert(kv);
  egal([d.etat, d.frais], [null, false], 'réponse');
});

await verifie('sans espace KV lié : 503 nommant la liaison', async () => {
  const r = await service.onRequestGet({ env: {} });
  egal(r.status, 503, 'statut');
  if (!/ETAT/.test((await r.json()).erreur)) throw new Error('liaison manquante non nommée');
});

await verifie('la lecture ne provoque aucune écriture', async () => {
  const kv = kvFactice();
  amontRend(articleWP('Pont Colbert ouvert', new Date()));
  await collecteur.collecter(env(kv));
  const avant = kv.ecritures;
  for (let i = 0; i < 20; i++) await sert(kv);
  egal(kv.ecritures - avant, 0, 'écritures pendant 20 lectures');
});

console.log(echecs ? `\n${echecs} échec(s)` : '\ntout est vert');
process.exit(echecs ? 1 : 0);
