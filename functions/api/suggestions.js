// Recueil des suggestions d'amélioration, servi sur /api/suggestions.
//
// Le site n'a plus d'adresse de courriel : les propositions sont déposées ici et relues
// dans la fenêtre « Proposer une amélioration ». Rien ne sort du compte Cloudflare, et
// aucune donnée de connexion n'est conservée — ni adresse IP, ni empreinte de navigateur.
//
// Ce fichier doit rester à la racine du dépôt, dans functions/ : Cloudflare Pages y
// cherche les fonctions, pas dans le répertoire de sortie du build.
//
// À configurer une fois dans le tableau de bord Pages :
//   - un espace KV lié sous le nom SUGGESTIONS ;
//   - une variable secrète MODERATION_JETON, pour pouvoir supprimer une entrée.
//
// Tout tient dans une seule clé KV contenant un tableau JSON : une lecture par
// affichage, au lieu d'une par suggestion. Deux dépôts exactement simultanés pourraient
// se chevaucher ; sur un site de cette fréquentation le risque est théorique, et le prix
// à payer serait une base de données à administrer.

const CLE = 'suggestions';
const MAX_ENTREES = 300;
const MAX_TEXTE = 1200;
const MAX_QUI = 60;

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
  if (!brut) return [];
  try {
    const donnees = JSON.parse(brut);
    return Array.isArray(donnees) ? donnees : [];
  } catch {
    return []; // une valeur corrompue ne doit pas rendre la fenêtre inutilisable
  }
}

// Les sauts de ligne sont conservés, le reste des caractères de contrôle non : ils
// n'apportent rien et compliquent l'affichage. Le tri se fait par code de caractère
// plutôt que par expression régulière — une classe de contrôles est illisible, et se
// transporte mal d'un fichier à l'autre.
const lisible = c => {
  const n = c.charCodeAt(0);
  return c === '\n' || (n >= 32 && n !== 127);
};
const nettoie = t => t.split('').filter(lisible).join('').trim();

export async function onRequestGet({ env }) {
  try {
    const suggestions = await lire(espaceKV(env));
    return json({ suggestions });
  } catch (e) {
    return json({ erreur: e.message, suggestions: [] }, e.statut || 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const kv = espaceKV(env);

    let corps;
    try {
      corps = await request.json();
    } catch {
      return json({ erreur: 'requête illisible' }, 400);
    }

    // champ leurre : un humain ne le voit pas, les robots à formulaire le remplissent
    if (typeof corps.site === 'string' && corps.site.trim() !== '') {
      return json({ ok: true }, 202); // on acquiesce sans rien enregistrer
    }

    const texte = nettoie(String(corps.texte || ''));
    const qui = nettoie(String(corps.qui || '')).slice(0, MAX_QUI);

    if (texte.length < 3) return json({ erreur: 'suggestion trop courte' }, 400);
    if (texte.length > MAX_TEXTE) {
      return json({ erreur: `suggestion trop longue (${MAX_TEXTE} caractères maximum)` }, 400);
    }

    const suggestions = await lire(kv);

    // un même texte déposé deux fois de suite ne crée qu'une entrée
    if (suggestions.length && suggestions[0].texte === texte) {
      return json({ ok: true, suggestions });
    }

    suggestions.unshift({
      id: crypto.randomUUID(),
      quand: new Date().toISOString(),
      qui,
      texte,
    });
    suggestions.length = Math.min(suggestions.length, MAX_ENTREES);

    await kv.put(CLE, JSON.stringify(suggestions));
    return json({ ok: true, suggestions });
  } catch (e) {
    return json({ erreur: e.message }, e.statut || 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const kv = espaceKV(env);
    const attendu = env.MODERATION_JETON;
    if (!attendu) return json({ erreur: 'modération non configurée' }, 503);

    const fourni = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (fourni !== attendu) return json({ erreur: 'jeton refusé' }, 403);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ erreur: 'identifiant manquant' }, 400);

    const suggestions = await lire(kv);
    const restantes = suggestions.filter(s => s.id !== id);
    if (restantes.length !== suggestions.length) {
      await kv.put(CLE, JSON.stringify(restantes));
    }
    return json({ ok: true, suggestions: restantes });
  } catch (e) {
    return json({ erreur: e.message }, e.statut || 500);
  }
}
