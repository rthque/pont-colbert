// Collecteur du statut du pont Colbert : interroge l'amont une fois par minute, en déduit
// « ouvert » ou « fermé », et ne dépose dans KV que lorsque l'état change.
//
// Déclenché par un Cron Trigger Cloudflare (* * * * *). Le site lit ensuite le résultat
// par /api/statut, qui ne fait qu'une lecture.
//
// POURQUOI N'ÉCRIRE QUE SUR CHANGEMENT
// L'offre KV gratuite plafonne à 1 000 écritures par jour, et le cron s'exécute 1 440 fois.
// Écrire à chaque passage épuiserait le quota avant 17 h et emporterait au passage les
// compteurs de fréquentation s'ils partagent l'espace. On n'écrit donc que si l'état a
// bougé — quelques dizaines de fois par jour — plus un battement espacé, décrit plus bas.
//
// CE QUI EST CONSERVÉ
// Un seul enregistrement, sous la clé « statut » : l'état, l'horodatage du message d'amont,
// celui du dernier contrôle réussi, et la source. Aucune donnée de visiteur : ce worker ne
// voit jamais de visiteur, il ne parle qu'à l'amont.

const CLE = 'statut';

// Même inchangé, l'enregistrement est rafraîchi au moins toutes les 30 minutes. Sans ce
// battement, « verifieA » daterait du dernier changement d'état et le site ne pourrait pas
// distinguer « le pont est ouvert depuis ce matin » de « le collecteur est mort ce matin ».
// Coût : 48 écritures par jour au pire, quota négligeable.
const BATTEMENT = 1800;

// Un message plus vieux que cela ne décrit plus l'état courant : le diffuseur s'est tu, ou
// la saison est terminée. Mieux vaut ne rien affirmer.
const AGE_MAX = 30 * 24 * 3600;

// ---------------------------------------------------------------------------
// AMONT — à renseigner avec le résultat de la capture de trafic Citykomi
// ---------------------------------------------------------------------------
// Le statut est diffusé par Citykomi, qui ne documente pas d'API publique. Le point
// d'entrée se relève sur l'appareil, en interceptant le trafic de l'application, puis
// s'analyse avec :
//
//   node src/citykomi_traces.mjs capture.har
//
// qui imprime le bloc à recopier ici. La marche à suivre complète est au README,
// section « Statut en direct ».
//
// Trois formes sont prévues. 'json' est celle de Citykomi : on dit où trouver la liste,
// le texte et la date au moyen de chemins pointés. 'wordpress' et 'flux' restent
// disponibles si le statut finit par être publié sur une source web ordinaire.
//
// url reste vide tant que la capture n'a pas eu lieu : le collecteur échoue alors
// franchement, plutôt que d'interroger une adresse devinée.
const AMONT = {
  forme: 'json',
  url: '',

  // Exemple de ce qu'imprime citykomi_traces.mjs ; à remplacer par les vrais chemins.
  // « texte » accepte un chemin ou une liste de chemins.
  champs: { liste: 'data.messages', texte: ['title', 'body'], date: 'publishedAt' },

  // En-têtes exigés par l'amont, s'il en exige. Un appel anonyme n'en a pas besoin ; un
  // appel lié à un appareil en aura, et la question de sa durée de vie se posera alors —
  // voir le README.
  entetes: {},
};

const AGENT = 'pont-colbert.fr/statut (+https://pont-colbert.fr; 1 req/min)';

const DELAI = 10000;

// ---------------------------------------------------------------------------
// Lecture du texte
// ---------------------------------------------------------------------------

// Minuscules, accents retirés, apostrophes unifiées, espaces resserrés. Les messages
// arrivent tantôt en « fermé », tantôt en « FERME », tantôt avec une apostrophe
// typographique : on compare sur une forme unique plutôt que d'accumuler les variantes
// dans les expressions rationnelles.
function normalise(t) {
  return String(t == null ? '' : t)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Retire le balisage et rend les entités les plus courantes : l'amont peut servir de
// l'HTML (WordPress le fait toujours) là où on n'attend qu'une phrase.
function sansBalises(html) {
  return String(html == null ? '' : html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:#39|#8217|rsquo);/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Le format annoncé par le diffuseur : « Pont Colbert ouvert » / « Pont Colbert fermé ».
// On accepte les tournures voisines, et un éventuel pictogramme en tête (feu vert).
const ENTETE = /^(?:le\s+)?pont\s+colbert\s*[:\-]?\s*(?:est\s+)?(?:actuellement\s+)?(?:de\s+nouveau\s+)?(ouvert|ferme)\b/;

// « ouvert » et « fermé » seuls, en tant que mots. Le \b final est ce qui distingue
// « fermé » de « fermeture » et « ouvert » de « réouverture » : les substantifs
// appartiennent aux annonces, pas aux bulletins d'état.
const MOT_OUVERT = /\bouvert(?:e|s|es)?\b/;
const MOT_FERME = /\bferme(?:e|s|es)?\b/;

// Marqueurs de futur ou de conditionnel. « Le pont sera fermé demain de 8 h à 10 h » est
// une annonce : la republier comme état courant enverrait quelqu'un devant un pont ouvert,
// ou pire l'en éloignerait à tort.
const FUTUR = /\b(?:sera|seront|serait|va etre|vont etre|prevu|prevue|prevus|prevues|demain|des demain|a partir d|des le|jusqu'a|ce soir|cette nuit|la semaine prochaine|prochainement|annonce|annoncee|report|reportee)/;

// Rend { etat, confiance } ou null. Null est un résultat légitime et fréquent : le
// diffuseur publie aussi des communiqués, des travaux, des remerciements. Ne rien conclure
// vaut mieux que conclure de travers.
export function deduireEtat(texte) {
  const t = normalise(sansBalises(texte));
  if (!t) return null;

  // Un pictogramme en tête empêcherait l'ancrage ^ de mordre.
  const entete = ENTETE.exec(t.replace(/^[^a-z]+/, ''));
  if (entete) return { etat: entete[1] === 'ferme' ? 'ferme' : 'ouvert', confiance: 'entete' };

  // Hors en-tête reconnu, on n'accepte qu'un texte sans marqueur de futur portant l'un des
  // deux mots, et un seul. Les deux à la fois — « fermé à la circulation, ouvert aux
  // piétons » — ne se tranchent pas.
  if (FUTUR.test(t)) return null;
  const ouvert = MOT_OUVERT.test(t);
  const ferme = MOT_FERME.test(t);
  if (ouvert === ferme) return null;
  return { etat: ferme ? 'ferme' : 'ouvert', confiance: 'mot' };
}

// ---------------------------------------------------------------------------
// Adaptateurs d'amont : chacun rend { texte, date } du message le plus récent
// ---------------------------------------------------------------------------

function valeurAuChemin(racine, chemin) {
  if (chemin === '[]') return racine;
  let v = racine;
  for (const part of chemin.split('.')) {
    if (v == null) return null;
    v = v[part];
  }
  return v;
}

function versDate(brut) {
  if (brut == null) return null;
  // Un entier peut être en secondes ou en millisecondes : au-delà de l'an 2001 en
  // millisecondes, on tranche par l'ordre de grandeur.
  if (typeof brut === 'number') {
    const ms = brut > 1e11 ? brut : brut * 1000;
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  const d = new Date(brut);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ADAPTATEURS = {
  // WordPress rend un tableau d'articles, le plus récent en tête quand on trie par date.
  // date_gmt est préféré à date : celle-ci est exprimée dans le fuseau du site, sans
  // décalage explicite, donc ambiguë.
  wordpress(donnees) {
    if (!Array.isArray(donnees) || !donnees.length) return null;
    const a = donnees[0];
    const titre = sansBalises(a?.title?.rendered ?? '');
    const corps = sansBalises(a?.excerpt?.rendered ?? a?.content?.rendered ?? '');
    const brut = a?.date_gmt ? a.date_gmt + 'Z' : a?.date;
    return { texte: (titre + '. ' + corps).trim(), date: versDate(brut) };
  },

  // RSS et Atom, lus à l'expression rationnelle : le runtime Workers n'a pas d'analyseur
  // XML, et une dépendance pour extraire deux champs ne se justifie pas.
  flux(texte) {
    const bloc = /<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/i.exec(texte);
    if (!bloc) return null;
    const b = bloc[0];
    const champ = n => {
      const m = new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`, 'i').exec(b);
      return m ? sansBalises(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
    };
    const titre = champ('title');
    const desc = champ('description') || champ('summary') || champ('content');
    const brut = champ('pubDate') || champ('updated') || champ('published') || champ('date');
    return { texte: (titre + '. ' + desc).trim(), date: versDate(brut) };
  },

  // Forme libre, pilotée par AMONT.champs. C'est la voie pour Citykomi : une fois son
  // point d'entrée connu, il suffit de dire où lire la liste, le texte et la date.
  json(donnees) {
    const liste = valeurAuChemin(donnees, AMONT.champs.liste);
    const premier = Array.isArray(liste) ? liste[0] : liste;
    if (!premier) return null;
    // « texte » accepte un chemin ou plusieurs : le statut tient souvent dans le titre
    // (« Pont Colbert ouvert ») tandis que le corps ajoute la circonstance. Les concaténer
    // laisse l'en-tête en tête, là où la lecture l'attend.
    const morceaux = [].concat(AMONT.champs.texte)
      .map(c => sansBalises(valeurAuChemin(premier, c)))
      .filter(Boolean);
    return {
      texte: morceaux.join('. '),
      date: versDate(valeurAuChemin(premier, AMONT.champs.date)),
    };
  },
};

async function interrogerAmont() {
  const adaptateur = ADAPTATEURS[AMONT.forme];
  if (!adaptateur) throw new Error(`forme d'amont inconnue : ${AMONT.forme}`);
  // Sans adresse, on ne devine pas : le collecteur se tait et le site n'affiche rien.
  if (!AMONT.url) throw new Error('AMONT.url non renseigné — voir README, « Statut en direct »');

  const r = await fetch(AMONT.url, {
    headers: {
      'user-agent': AGENT,
      accept: AMONT.forme === 'flux'
        ? 'application/rss+xml, application/atom+xml, application/xml;q=0.9'
        : 'application/json',
      'accept-language': 'fr-FR,fr;q=0.9',
      ...AMONT.entetes,
    },
    // Le cron cadence déjà : un cache intermédiaire ne ferait que retarder l'information.
    cache: 'no-store',
    signal: AbortSignal.timeout(DELAI),
  });

  // 429 et 5xx ne sont pas des erreurs à contourner : on repasse dans une minute. Lever
  // ici laisse l'enregistrement en place, qui vieillira tout seul si la panne dure.
  if (!r.ok) throw new Error(`amont HTTP ${r.status}`);

  const brut = await r.text();
  const donnees = AMONT.forme === 'flux' ? brut : JSON.parse(brut);
  const message = adaptateur(donnees);
  if (!message) throw new Error('amont : aucun message exploitable');
  return message;
}

// ---------------------------------------------------------------------------
// Collecte
// ---------------------------------------------------------------------------

function espaceKV(env) {
  if (!env || !env.ETAT) {
    throw Object.assign(new Error('espace KV ETAT non lié à ce worker'), { statut: 503 });
  }
  return env.ETAT;
}

async function lireStatut(kv) {
  const brut = await kv.get(CLE);
  if (!brut) return null;
  try { return JSON.parse(brut); } catch { return null; }
}

export async function collecter(env, maintenant = new Date()) {
  const kv = espaceKV(env);
  const avant = await lireStatut(kv);

  let message;
  try {
    message = await interrogerAmont();
  } catch (e) {
    // Panne d'amont : on ne touche à rien. L'enregistrement garde son ancien « verifieA »,
    // franchit le seuil de péremption si la panne se prolonge, et /api/statut cesse alors
    // de l'affirmer. La reprise est la minute suivante, sans état à gérer.
    return { ecrit: false, motif: 'amont indisponible : ' + e.message };
  }

  const lu = deduireEtat(message.texte);
  if (!lu) return { ecrit: false, motif: 'message sans statut lisible' };

  if (message.date && (maintenant - message.date) / 1000 > AGE_MAX) {
    return { ecrit: false, motif: 'message trop ancien' };
  }

  const depuis = (message.date || maintenant).toISOString();
  const apres = {
    etat: lu.etat,
    depuis,
    verifieA: maintenant.toISOString(),
    confiance: lu.confiance,
    source: AMONT.url,
  };

  // Le changement se juge sur l'état et sur l'horodatage du message, jamais sur
  // « verifieA » — qui bouge à chaque passage et rendrait la comparaison toujours vraie.
  const inchange = avant && avant.etat === apres.etat && avant.depuis === apres.depuis;
  if (inchange) {
    const age = (maintenant - new Date(avant.verifieA)) / 1000;
    if (!(age >= BATTEMENT)) return { ecrit: false, motif: 'inchangé' };
    // Battement : on réécrit pour attester que le contrôle a bien lieu.
    await kv.put(CLE, JSON.stringify(apres));
    return { ecrit: true, motif: 'battement', etat: apres.etat };
  }

  await kv.put(CLE, JSON.stringify(apres));
  return { ecrit: true, motif: avant ? 'changement' : 'premier relevé', etat: apres.etat };
}

export default {
  // Cron Trigger : * * * * *
  async scheduled(evenement, env) {
    const bilan = await collecter(env);
    // Visible dans « wrangler tail » ; aucune écriture, donc aucun coût.
    console.log(JSON.stringify({ cron: evenement?.cron, ...bilan }));
  },

  // Déclenchement manuel, pour vérifier un déploiement sans attendre la minute suivante.
  // Réservé au porteur du jeton : sans cela, n'importe qui pourrait faire marteler l'amont.
  async fetch(request, env) {
    const attendu = env.MODERATION_JETON;
    const fourni = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!attendu || fourni !== attendu) {
      return new Response('jeton refusé\n', { status: 403 });
    }
    let bilan;
    try { bilan = await collecter(env); }
    catch (e) { bilan = { ecrit: false, motif: e.message }; }
    return new Response(JSON.stringify(bilan, null, 2) + '\n', {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  },
};
