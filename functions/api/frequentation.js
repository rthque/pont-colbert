// Compteurs de fréquentation, servis sur /api/frequentation.
//
// Remplace le service tiers Abacus, qui comptait toute exécution de la page — donc aussi
// les robots capables de rendre du JavaScript — et que n'importe qui connaissant l'adresse
// pouvait incrémenter. Le comptage se fait désormais ici, dans le compte Cloudflare.
//
// Ce qui est conservé : deux entiers. Rien d'autre.
//
// Aucune adresse IP n'est stockée, ni journalisée. Pour éviter qu'un rechargement compte
// une visite de plus, une empreinte éphémère est calculée à partir de l'adresse et du
// navigateur, salée par un sel aléatoire renouvelé chaque jour et lui-même effacé au bout
// de 48 h. Passé ce délai l'empreinte n'est plus rattachable à quoi que ce soit, et elle
// expire de toute façon au bout de 30 minutes. C'est la durée retenue pour une session :
// deux consultations à une heure d'intervalle comptent pour deux visites, deux
// rechargements à une minute d'intervalle pour une seule.
//
// Le filtrage des robots ne peut pas être parfait — un moissonneur déterminé imite un
// navigateur. L'objectif est d'écarter le trafic automatique ordinaire, qui est l'essentiel
// du bruit : robots d'indexation, aperçus de liens des messageries, sondes de supervision,
// moissonneurs d'entraînement.

const CLE = 'compteurs';
const FENETRE_SESSION = 1800;   // 30 min : durée d'une session
const DUREE_SEL = 172800;       // 48 h : au-delà, les empreintes du jour sont irréversibles

// Agents qui se déclarent. Beaucoup de robots sont honnêtes sur ce point ; ceux qui ne le
// sont pas se font attraper par les autres contrôles.
const ROBOTS = new RegExp([
  'bot', 'crawl', 'spider', 'slurp', 'scrap', 'headless', 'phantom', 'puppeteer',
  'playwright', 'selenium', 'lighthouse', 'pagespeed', 'curl', 'wget', 'python',
  'java/', 'go-http', 'okhttp', 'axios', 'node-fetch', 'libwww', 'httpclient',
  'preview', 'fetcher', 'monitor', 'uptime', 'pingdom', 'statuscake', 'datadog',
  'facebookexternalhit', 'whatsapp', 'telegram', 'discord', 'slack', 'twitter',
  'linkedin', 'embedly', 'pinterest', 'skype', 'vkshare', 'redditbot',
].join('|'), 'i');

const json = (donnees, statut = 200) => new Response(JSON.stringify(donnees), {
  status: statut,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
});

function espaceKV(env) {
  if (!env || !env.SUGGESTIONS) {
    throw Object.assign(new Error('espace KV SUGGESTIONS non lié à ce projet'), { statut: 503 });
  }
  return env.SUGGESTIONS;
}

async function lire(kv) {
  const brut = await kv.get(CLE);
  if (!brut) return { visites: 0, visiteurs: 0 };
  try {
    const d = JSON.parse(brut);
    return {
      visites: Number.isFinite(d.visites) ? d.visites : 0,
      visiteurs: Number.isFinite(d.visiteurs) ? d.visiteurs : 0,
    };
  } catch {
    return { visites: 0, visiteurs: 0 };
  }
}

// Renvoie le motif du rejet, ou null si la requête ressemble à un vrai navigateur piloté
// par une personne.
function motifDeRejet(request) {
  const ua = request.headers.get('user-agent') || '';
  const cf = request.cf || {};

  // Cloudflare identifie lui-même les robots déclarés (indexeurs, sondes officielles).
  if (cf.verifiedBotCategory) return 'robot vérifié par Cloudflare';
  // Score de réputation, présent selon l'offre : 1 = robot certain, 99 = humain certain.
  if (typeof cf.botScore === 'number' && cf.botScore <= 30) return 'score de robot';

  if (ua.length < 20) return 'agent absent ou trop court';
  if (!/mozilla\//i.test(ua)) return 'agent non conforme à un navigateur';
  if (ROBOTS.test(ua)) return 'agent déclaré robot';

  // Un navigateur annonce toujours les langues acceptées ; les clients scriptés, rarement.
  if (!request.headers.get('accept-language')) return 'aucune langue annoncée';

  // La balise n'est émise que par le script de la page : le navigateur marque donc la
  // requête comme venant de sa propre origine. Un appel direct ne porte pas cet en-tête.
  if (request.headers.get('sec-fetch-site') !== 'same-origin') return 'appel hors page';

  return null;
}

async function empreinte(kv, request) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return null;

  const jour = new Date().toISOString().slice(0, 10);
  const cleSel = 'sel:' + jour;
  let sel = await kv.get(cleSel);
  if (!sel) {
    sel = crypto.randomUUID();
    await kv.put(cleSel, sel, { expirationTtl: DUREE_SEL });
  }

  const source = sel + '|' + ip + '|' + (request.headers.get('user-agent') || '');
  const condensat = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return 'vu:' + [...new Uint8Array(condensat)].slice(0, 16)
    .map(o => o.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet({ env }) {
  try {
    return json(await lire(espaceKV(env)));
  } catch (e) {
    return json({ erreur: e.message }, e.statut || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const kv = espaceKV(env);
    const compteurs = await lire(kv);

    const rejet = motifDeRejet(request);
    if (rejet) return json({ ...compteurs, compte: false, motif: rejet });

    const cle = await empreinte(kv, request);
    if (cle && await kv.get(cle)) {
      return json({ ...compteurs, compte: false, motif: 'session déjà comptée' });
    }

    let corps = {};
    try { corps = await request.json(); } catch { /* corps facultatif */ }

    compteurs.visites += 1;
    if (corps.nouveau === true) compteurs.visiteurs += 1;

    await kv.put(CLE, JSON.stringify(compteurs));
    if (cle) await kv.put(cle, '1', { expirationTtl: FENETRE_SESSION });

    return json({ ...compteurs, compte: true });
  } catch (e) {
    return json({ erreur: e.message }, e.statut || 500);
  }
}

// Remise à zéro, réservée au porteur du jeton de modération.
export async function onRequestDelete({ request, env }) {
  try {
    const kv = espaceKV(env);
    const attendu = env.MODERATION_JETON;
    if (!attendu) return json({ erreur: 'modération non configurée' }, 503);

    const fourni = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (fourni !== attendu) return json({ erreur: 'jeton refusé' }, 403);

    const remis = { visites: 0, visiteurs: 0 };
    await kv.put(CLE, JSON.stringify(remis));
    return json({ ...remis, ok: true });
  } catch (e) {
    return json({ erreur: e.message }, e.statut || 500);
  }
}
