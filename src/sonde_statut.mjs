// Sonde les sources possibles du statut du pont, et dit laquelle est exploitable.
//
// C'est l'étape A de la recherche : avant d'écrire le moindre collecteur, il faut savoir
// s'il existe une source web lisible sans authentification. Cette sonde interroge les
// candidats dans l'ordre de propreté décroissante et rend un classement.
//
// Elle ne modifie rien et ne dépose rien : elle lit, mesure, et affiche.
//
// Usage :
//   node src/sonde_statut.mjs              # tous les candidats
//   node src/sonde_statut.mjs --verbeux    # + un extrait du corps de chaque réponse
//   node src/sonde_statut.mjs --url <URL>  # un seul candidat, ajouté à la main
//
// À lancer depuis une machine ayant un accès réseau ordinaire. Un environnement dont les
// sorties HTTPS sont filtrées (bac à sable d'intégration continue, conteneur d'agent)
// renverra « injoignable » partout, ce qui ne dit rien de la source elle-même.

const VERBEUX = process.argv.includes('--verbeux');
const URL_UNIQUE = (() => {
  const i = process.argv.indexOf('--url');
  return i >= 0 ? process.argv[i + 1] : null;
})();

// Un agent qui se nomme : si l'exploitant du site veut savoir qui l'interroge, ou nous
// demander d'arrêter, il a de quoi. Un robot anonyme se fait bloquer, et il le mérite.
// Un en-tete HTTP ne transporte que des octets latin-1 : pas de tiret cadratin ni
// d'accent ici, sinon fetch refuse la requete avant meme de sortir sur le reseau.
const AGENT = 'pont-colbert.fr/sonde (+https://pont-colbert.fr; 1 req/min; statut du pont)';

const DELAI = 12000;

// Les candidats, du plus propre au moins propre.
//
// 1. Le site dédié de Ports de Normandie. S'il est bâti sur WordPress — ce qui est le cas
//    de la plupart des sites institutionnels français — son API REST est ouverte par
//    défaut et rend les actualités en JSON sans clé. C'est de loin la meilleure issue.
// 2. Les flux de syndication, qui existent souvent sans qu'on les annonce.
// 3. L'API Citykomi. Le fournisseur annonce publiquement « des API pour connecter
//    Citykomi à vos outils » ; reste à savoir si une lecture anonyme est permise. L'appli
//    ne demandant ni compte ni courriel, il est plausible qu'elle interroge son amont avec
//    un simple identifiant de diffuseur.
const CANDIDATS = [
  // --- Ports de Normandie : API REST WordPress ------------------------------
  { rang: 'A1', quoi: 'WP REST articles', url: 'https://pontcolbert.portsdenormandie.fr/wp-json/wp/v2/posts?per_page=5&orderby=date' },
  { rang: 'A1', quoi: 'WP REST racine', url: 'https://pontcolbert.portsdenormandie.fr/wp-json/' },
  { rang: 'A1', quoi: 'WP REST types', url: 'https://pontcolbert.portsdenormandie.fr/wp-json/wp/v2/types' },
  { rang: 'A1', quoi: 'WP REST (portail)', url: 'https://www.portsdenormandie.fr/wp-json/wp/v2/posts?per_page=5' },

  // --- Ports de Normandie : flux --------------------------------------------
  { rang: 'A2', quoi: 'flux racine', url: 'https://pontcolbert.portsdenormandie.fr/feed/' },
  { rang: 'A2', quoi: 'flux actualité', url: 'https://pontcolbert.portsdenormandie.fr/actualite/feed/' },
  { rang: 'A2', quoi: 'sitemap', url: 'https://pontcolbert.portsdenormandie.fr/sitemap_index.xml' },

  // --- Ports de Normandie : pages, à éplucher pour y trouver un embarqué -----
  { rang: 'A3', quoi: 'page mes-actualites', url: 'https://pontcolbert.portsdenormandie.fr/mes-actualites/' },
  { rang: 'A3', quoi: 'page actualite', url: 'https://pontcolbert.portsdenormandie.fr/actualite/' },
  { rang: 'A3', quoi: 'page accueil', url: 'https://pontcolbert.portsdenormandie.fr/' },

  // --- Citykomi -------------------------------------------------------------
  { rang: 'A4', quoi: 'citykomi racine API', url: 'https://api.citykomi.com/' },
  { rang: 'A4', quoi: 'citykomi /api', url: 'https://www.citykomi.com/api/' },
  { rang: 'A4', quoi: 'citykomi trouver-diffuseur', url: 'https://www.citykomi.com/trouver-un-diffuseur/' },
  { rang: 'A4', quoi: 'citykomi app', url: 'https://app.citykomi.com/' },
  { rang: 'A4', quoi: 'citykomi ws', url: 'https://ws.citykomi.com/' },
  { rang: 'A4', quoi: 'citykomi back', url: 'https://back.citykomi.com/' },
  { rang: 'A4', quoi: 'citykomi robots', url: 'https://www.citykomi.com/robots.txt' },
];

// Mots qui trahissent une source utile. « colbert » d'abord : une réponse qui ne parle pas
// du pont ne nous sert à rien, même si elle est en JSON et répond 200.
const INDICES = [
  ['colbert', /colbert/i],
  ['ouvert/fermé', /\bouvert|\bferm[eé]/i],
  ['citykomi', /citykomi/i],
  ['diffuseur', /diffuseur/i],
];

// Repère, dans un corps HTML ou JS, les adresses qui ressemblent à un point d'entrée de
// données. C'est ce qui permet de trouver un embarqué sans ouvrir l'outil de développement
// du navigateur : si la page appelle une API, l'adresse est presque toujours en clair.
function endpointsProbables(corps) {
  const trouves = new Set();
  const motifs = [
    /https?:\/\/[^\s"'<>()]*citykomi[^\s"'<>()]*/gi,
    /https?:\/\/[^\s"'<>()]*\/(?:api|wp-json|rest|graphql|feed)\b[^\s"'<>()]*/gi,
    /<iframe[^>]+src=["']([^"']+)["']/gi,
  ];
  for (const m of motifs) {
    for (const trouve of corps.matchAll(m)) {
      const adresse = (trouve[1] || trouve[0]).replace(/\\\//g, '/');
      if (adresse.length < 300) trouves.add(adresse);
    }
  }
  return [...trouves];
}

async function sonder(c) {
  const debut = Date.now();
  try {
    const r = await fetch(c.url, {
      headers: {
        'user-agent': AGENT,
        // Demander du JSON en premier : certains serveurs servent le JSON à qui le
        // demande, et l'HTML à tout le monde.
        accept: 'application/json;q=1.0, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
        'accept-language': 'fr-FR,fr;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(DELAI),
    });
    const corps = await r.text();
    const type = (r.headers.get('content-type') || '').split(';')[0] || '?';

    let json = null;
    if (/json/.test(type)) { try { json = JSON.parse(corps); } catch { /* annoncé JSON, ne l'est pas */ } }

    return {
      ...c,
      ms: Date.now() - debut,
      statut: r.status,
      type,
      octets: corps.length,
      json,
      indices: INDICES.filter(([, m]) => m.test(corps)).map(([nom]) => nom),
      endpoints: endpointsProbables(corps),
      corps,
    };
  } catch (e) {
    return { ...c, ms: Date.now() - debut, statut: 0, erreur: e.message || String(e) };
  }
}

// Une source n'est exploitable que si elle répond, rend une structure lisible, et parle
// bien du pont. Les trois à la fois.
function note(r) {
  if (r.statut !== 200) return 0;
  let n = 1;
  if (r.json) n += 3;                              // structuré : pas de grattage d'HTML
  else if (/xml/.test(r.type)) n += 2;             // flux : lisible, un peu moins net
  if (r.indices.includes('colbert')) n += 3;       // parle du pont
  if (r.indices.includes('ouvert/fermé')) n += 2;  // porte un statut
  return n;
}

const cibles = URL_UNIQUE
  ? [{ rang: '--', quoi: 'fourni à la main', url: URL_UNIQUE }]
  : CANDIDATS;

console.log(`sonde de ${cibles.length} candidat(s) — ${new Date().toISOString()}\n`);

const resultats = [];
for (const c of cibles) {
  const r = await sonder(c);
  resultats.push(r);

  const etat = r.statut === 0 ? `injoignable (${r.erreur})` : `HTTP ${r.statut}`;
  const detail = r.statut === 200
    ? `${r.type} ${(r.octets / 1024).toFixed(1)} Ko` + (r.indices.length ? ` — ${r.indices.join(', ')}` : '')
    : '';
  console.log(`  [${r.rang}] ${r.quoi.padEnd(26)} ${etat.padEnd(34)} ${detail}`);

  if (r.endpoints?.length) {
    for (const e of r.endpoints.slice(0, 6)) console.log(`        ↳ ${e}`);
  }
  if (VERBEUX && r.corps) {
    console.log('        ' + r.corps.slice(0, 400).replace(/\s+/g, ' ') + '…');
  }

  // Une pause entre deux appels : rien ne presse, et marteler un site institutionnel
  // pour le sonder serait le meilleur moyen de se faire bloquer l'adresse.
  await new Promise(t => setTimeout(t, 400));
}

const classes = resultats.filter(r => note(r) > 0).sort((a, b) => note(b) - note(a));

console.log('\n--- classement ---');
if (!classes.length) {
  console.log('  aucun candidat exploitable.');

  // Avant d'incriminer les sources, vérifier le réseau local. Des hôtes sans rapport —
  // Ports de Normandie, Citykomi, jusqu'au robots.txt — qui répondent tous le même code
  // ne se sont pas concertés : c'est un filtrage en sortie de cette machine. Sans ce
  // contrôle on conclurait à tort que l'étape A est morte, et on partirait émuler Android
  // pour rien.
  // On raisonne sur le code dominant et non sur l'unanimité : un hôte candidat qui
  // n'existe pas échoue autrement que les autres (DNS, pas HTTP) et suffirait à masquer
  // le motif.
  const parCode = new Map();
  for (const r of resultats) parCode.set(r.statut, (parCode.get(r.statut) || 0) + 1);
  const [dominant, combien] = [...parCode].sort((a, b) => b[1] - a[1])[0];
  const hotesDominants = new Set(
    resultats.filter(r => r.statut === dominant).map(r => new URL(r.url).host));

  if (combien >= resultats.length * (2 / 3) && hotesDominants.size > 1) {
    const libelle = dominant === 0 ? 'injoignable' : 'HTTP ' + dominant;
    console.log(`  ${combien} candidats sur ${resultats.length}, répartis sur `
      + `${hotesDominants.size} hôtes sans rapport, répondent « ${libelle} » :`);
    console.log('  c\'est le réseau de CETTE machine qui filtre, pas les sources.');
    console.log('  Relancer depuis un poste à accès ordinaire avant de conclure quoi que ce soit.');
  } else {
    console.log('  Les sources répondent mais aucune ne porte le statut.');
    console.log('  Relancer avec --verbeux, puis passer à l\'étape B (interception du trafic).');
  }
} else {
  for (const r of classes.slice(0, 6)) {
    console.log(`  ${note(r)} pts  [${r.rang}] ${r.quoi} — ${r.url}`);
  }
  const gagnant = classes[0];
  if (note(gagnant) >= 7) {
    console.log(`\n  → source retenue : ${gagnant.url}`);
    console.log('    Elle répond, est structurée et parle du pont. Brancher l\'adaptateur sur celle-ci.');
  } else {
    console.log('\n  → rien de concluant : une source répond, mais aucune ne porte le statut du pont.');
    console.log('    Relancer avec --verbeux, puis --url sur les adresses signalées par « ↳ ».');
  }
}

// Ce que le collecteur attend en retour, pour mémoire : un état et un horodatage.
console.log('\nUne fois la source connue : renseigner AMONT dans workers/statut/index.js.');
