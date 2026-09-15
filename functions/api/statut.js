// Sert le statut du pont, sur /api/statut, en lecture seule.
//
// Le collecteur (workers/statut/) écrit dans KV une fois par minute au plus ; cette
// fonction ne fait que relire et dire si le relevé est encore frais. Aucune écriture, donc
// aucun quota consommé côté écritures, et un robot qui l'appelle ne coûte qu'une lecture.

const CLE = 'statut';

// Le collecteur rafraîchit l'enregistrement au moins toutes les 30 minutes, même sans
// changement. Au-delà de 35 — la marge couvre un cron en retard — le relevé n'atteste plus
// rien : le collecteur est arrêté, l'amont est en panne, ou le worker échoue. On préfère
// alors ne rien affirmer plutôt que d'afficher un état peut-être faux depuis des heures.
const PEREMPTION = 2100;

const json = (donnees, statut = 200, cache = 'public, max-age=30') => new Response(
  JSON.stringify(donnees),
  {
    status: statut,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // 30 secondes de cache au bord : le site interroge toutes les minutes et plusieurs
      // onglets peuvent être ouverts. Sans cela chaque onglet paierait une lecture KV, et
      // l'information ne serait pas plus fraîche pour autant — le cron ne va pas plus vite.
      'cache-control': cache,
    },
  });

function espaceKV(env) {
  if (!env || !env.ETAT) {
    throw Object.assign(new Error('espace KV ETAT non lié à ce projet'), { statut: 503 });
  }
  return env.ETAT;
}

export async function onRequestGet({ env }) {
  try {
    const brut = await espaceKV(env).get(CLE);
    if (!brut) {
      // Rien n'a encore été collecté. Ce n'est pas une erreur : c'est l'état du système
      // avant le premier passage du cron.
      return json({ etat: null, frais: false, motif: 'aucun relevé' });
    }

    let d;
    try { d = JSON.parse(brut); } catch { return json({ etat: null, frais: false, motif: 'relevé illisible' }); }

    const age = (Date.now() - new Date(d.verifieA).getTime()) / 1000;
    if (!Number.isFinite(age) || age > PEREMPTION) {
      // On rend quand même ce qu'on a, mais marqué non frais, et on dit depuis quand.
      // Le site n'affichera rien ; un humain qui ouvre l'adresse voit pourquoi.
      return json({ etat: null, frais: false, motif: 'relevé périmé', verifieA: d.verifieA ?? null });
    }

    return json({
      etat: d.etat ?? null,
      depuis: d.depuis ?? null,
      verifieA: d.verifieA ?? null,
      confiance: d.confiance ?? null,
      frais: true,
    });
  } catch (e) {
    return json({ erreur: e.message }, e.statut || 500, 'no-store');
  }
}
