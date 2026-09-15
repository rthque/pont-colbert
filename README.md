# Pont Colbert — horaires d'ouverture

Site d'une seule page qui affiche les créneaux d'ouverture du pont tournant Colbert
(Dieppe) en fonction de la marée, du **1er juillet 2026 au 31 décembre 2028**,
avec accès à la webcam du port en direct.

## Règles appliquées

En vigueur depuis juillet 2026 (capitainerie de Dieppe). Le pont n'est manœuvré
qu'en présence de navires.

| Type | Horaires |
|---|---|
| Sur marée | PM − 2 h · PM − 45 min · PM + 45 min |
| Heure fixe (quai de la Somme) | 07 h 30 · 18 h 30 |
| Exceptionnelles | 11 h 30 · 15 h 30 |

Un décompte placé sous la barre de date annonce le temps restant avant la prochaine
ouverture. Il vise toujours l'instant présent, quel que soit le jour consulté, et rappelle
donc l'heure visée sous le nombre — avec le jour lorsque le créneau tombe le lendemain.

**Seules les ouvertures possibles y entrent** : marée et heures fixes. Les exceptionnelles
en sont exclues — l'avis les réserve aux navires EMDT sous condition, un décompte vers
11 h 30 laisserait croire à une ouverture acquise. La pleine mer aussi, qui n'est pas une
manœuvre. Au-delà d'une heure les secondes disparaissent : elles n'apprennent rien et font
clignoter le bloc ; en dessous, elles deviennent l'information utile.

Les numéros de la capitainerie figurent en pied de page, appelables d'une touche depuis un
téléphone, et en format international dans la version anglaise.

## Données de marée

- **Jusqu'au 31/12/2026** : horaires officiels SHOM (via maree.shom.fr et maree.info,
  port de Dieppe), repris tels quels.
- **2027–2028** : prédiction par analyse harmonique (102 composantes) calée sur
  deux ans de hauteurs d'eau horaires SHOM (juillet 2024 → juillet 2026).

Précision vérifiée sur 318 pleines mers hors période d'entraînement (août–déc. 2026) :
**écart moyen ±2 min, maximum 7 min**, hauteurs à ±4 cm. Contre-épreuve sur dix
semaines tirées entre 2012 et 2024 (validation du cycle nodal de 18,6 ans) : 2 à 6 min.

Les coefficients 2027–2028 sont estimés par régression sur le marnage (±3), et
affichés avec le signe « ≈ ».

## Avis officiel

Le bouton « Règles » affiche l'avis aux usagers de la Capitainerie du port de Dieppe
(8 juillet 2026). Il est rendu en images, seul format qui s'affiche de façon fiable dans
une fenêtre sur tous les téléphones, avec le PDF d'origine en un lien et une version
texte repliable pour la lecture d'écran et le copier-coller.

Pour publier un nouvel avis :

```bash
python src/prepare_avis.py "chemin/vers/nouvel-avis.pdf"
node src/build.js
```

Si les créneaux eux-mêmes changent, penser à mettre à jour `eventsFor()` dans le gabarit
et la version texte de la fenêtre.

## Français et anglais

Un bouton posé sous la bascule de thème passe tout le site en anglais. Sans choix
mémorisé, la langue du navigateur décide : un équipage étranger arrive directement sur la
version anglaise, un navigateur français reste en français. Le choix est retenu dans le
stockage local.

Le bouton montre le drapeau de la langue vers laquelle il fait basculer. **Windows ne
fournit pas de glyphes de drapeaux** : la paire d'indicateurs régionaux y apparaît en deux
lettres encadrées. Le script mesure donc si les deux indicateurs se combinent en un seul
glyphe, et retombe sur « FR » / « EN » sinon. Le seuil est fixé à 1,5 fois la largeur d'un
indicateur seul : relevé sur Windows, la paire mesurait 13,9 px contre 13,3 px pour deux
indicateurs, soit 4 % d'écart — trop peu pour trancher avec un seuil à 2.

Les drapeaux sont écrits en points de code et non en caractères : une paire d'indicateurs
régionaux traverse mal les éditeurs et les encodages.

Tout le texte visible vit dans le dictionnaire `TEXTES` du gabarit. Le balisage ne porte
que des clés :

| Attribut | Usage |
|---|---|
| `data-i18n` | texte simple |
| `data-i18n-html` | phrase contenant des balises |
| `data-i18n-aria` | libellé de lecteur d'écran |
| `data-i18n-alt` | texte alternatif d'image |

`appliquerLangue()` parcourt ces attributs, reconstruit les formats de date et d'heure,
puis réengendre la frise. Ajouter une phrase au site revient donc à poser une clé.
Certaines valeurs sont des fonctions, parce que l'accord au pluriel diffère d'une langue à
l'autre et qu'un « (s) » se voit.

Le format suit la langue : `14h05` et `9,67 m` en français, `14:05` et `9.67 m` en
anglais. L'heure reste locale française dans les deux cas — c'est celle du pont.

`build.js` relève toutes les clés employées dans le balisage et dans les appels `t("…")`,
et **refuse de construire si l'une manque dans l'une des deux langues**. Sans ce contrôle,
`t()` retomberait silencieusement sur le français : le défaut ne casserait rien, il se
verrait seulement à l'écran.

**Ce qui reste en français** : le PDF de l'avis et ses deux pages en images. C'est un
document officiel de la capitainerie ; le traduire en ferait une réécriture sans valeur
juridique. La version texte dépliable, elle, est traduite, et la version anglaise le
signale comme traduction de courtoisie.

## Fréquentation et suggestions

Deux compteurs — **visiteurs uniques** et **visites totales** — tenus par
`functions/api/frequentation.js` dans le même espace KV que les suggestions. Ils ont
remplacé le service tiers Abacus, qui comptait toute exécution de la page, donc aussi les
robots sachant rendre du JavaScript, et que quiconque connaissait l'adresse pouvait
incrémenter.

**Ce qui est conservé : deux entiers.** Aucune adresse IP n'est stockée ni journalisée.
Pour qu'un rechargement ne compte pas une visite de plus, une empreinte éphémère est
calculée à partir de l'adresse et du navigateur, salée par un sel aléatoire renouvelé
chaque jour et effacé au bout de 48 h ; l'empreinte elle-même expire en 30 minutes, durée
retenue pour une session. Ni cookie, ni identifiant persistant, donc pas de bandeau de
consentement.

Le filtrage des robots se fait des deux côtés :

| Où | Signal |
|---|---|
| Navigateur | `navigator.webdriver`, posé par les navigateurs pilotés par un automate |
| Navigateur | la visite n'est annoncée qu'après un geste, ou 2,5 s de présence à l'écran — un aperçu de lien charge et s'en va |
| Serveur | robots déclarés par Cloudflare, score de réputation |
| Serveur | agent absent, trop court, non conforme à un navigateur, ou se déclarant robot |
| Serveur | aucune langue annoncée |
| Serveur | `Sec-Fetch-Site` autre que `same-origin` : la balise n'est émise que par la page |

L'affichage, lui, est une lecture sans effet de bord : un robot voit les chiffres sans les
gonfler. Le filtrage ne peut pas être parfait — un moissonneur déterminé imite un
navigateur — mais il écarte le trafic automatique ordinaire, qui est l'essentiel du bruit.

Remise à zéro, avec le jeton de modération :

```bash
curl -X DELETE https://pont-colbert.fr/api/frequentation -H "Authorization: Bearer <MODERATION_JETON>"
```

Vérifier la fonction sans déployer :

```bash
node src/test_frequentation.mjs
```

Attention au quota : l'offre KV gratuite plafonne à 1 000 écritures par jour. Une visite
comptée en coûte deux, une visite écartée aucune.

Le bouton « Proposer une amélioration » dépose la proposition sur `/api/suggestions` et
affiche dans la même fenêtre les propositions déjà reçues. **Le site ne porte aucune
adresse de courriel** : `build.js` refuse toute sortie qui en contiendrait une, motif
générique à l'appui.

`functions/api/suggestions.js` est une fonction Cloudflare Pages adossée à un espace KV.
Elle doit rester dans `functions/` à la racine du dépôt : Pages les y cherche, et non dans
le répertoire de sortie du build. Tout tient dans une seule clé KV contenant un tableau
JSON — une lecture par affichage plutôt qu'une par proposition.

À configurer une fois dans le tableau de bord Pages :

| Réglage | Valeur |
|---|---|
| Liaison KV | nom de variable `SUGGESTIONS`, vers un espace KV dédié |
| Variable secrète | `MODERATION_JETON`, une chaîne aléatoire |

Sans la liaison KV, la fonction répond 503 avec un message explicite et la fenêtre affiche
« Les propositions ne sont pas consultables pour le moment » — le reste du site continue
de fonctionner.

Les propositions sont **publiques** : elles s'affichent pour tous les visiteurs. Le dépôt
est donc protégé par un champ leurre, des longueurs plafonnées, un refus des doublons
consécutifs et un plafond de 300 entrées ; le texte est rendu par `textContent`, jamais en
HTML. Aucune adresse IP ni empreinte de navigateur n'est conservée.

Pour supprimer une proposition, ouvrir une fois
`https://pont-colbert.fr/?moderation=<MODERATION_JETON>` : le jeton est retenu par le
navigateur, retiré de la barre d'adresse, et un bouton « Supprimer » apparaît sous chaque
entrée. Sans jeton valable, le serveur refuse.

Vérifier la fonction sans déployer :

```bash
node src/test_suggestions.mjs
```

## Statut en direct

Le pont est ouvert ou fermé ; Ports de Normandie l'annonce par le diffuseur Citykomi
« PONT COLBERT - DIEPPE ». Ce statut est republié ici en quasi-temps réel.

### La voie retenue

Trois voies étaient possibles : lire une source web (A), intercepter le trafic de
l'application (B), émuler Android et lire l'écran (C). **Seule A mérite d'être tentée**, et
tout est écrit pour elle. B et C demandent une machine allumée en permanence pour
republier ce qui est, de toute façon, une information publique ; C ajoute un émulateur et
de l'OCR, soit une chaîne fragile pour deux mots.

Citykomi annonce publiquement « des API pour connecter Citykomi à vos outils », sans
documentation ouverte. Deux pistes, donc, et la sonde tranche :

```bash
node src/sonde_statut.mjs          # --verbeux pour voir les corps de réponse
```

Elle interroge, dans l'ordre, l'API REST du site de Ports de Normandie, ses flux, ses pages
— où elle repère les adresses embarquées — puis les hôtes Citykomi plausibles, et classe ce
qui répond. Elle distingue aussi un réseau filtré d'un refus des sources : des hôtes sans
rapport qui répondent tous le même code ne se sont pas concertés. **Cette sonde n'a pas
encore été lancée depuis un réseau ordinaire** : elle l'a été depuis un conteneur dont les
sorties HTTPS sont filtrées, et n'a donc rien pu conclure.

Si aucune source ne porte le statut, alors seulement passer à B : capturer le trafic de
l'application avec mitmproxy, relever l'adresse appelée, et la donner à la sonde
(`--url`). Le collecteur ci-dessous n'a pas à changer pour autant.

### La chaîne

| Où | Quoi |
|---|---|
| `workers/statut/` | worker Cloudflare, Cron Trigger `* * * * *` : relève l'amont, écrit dans KV |
| espace KV `PONT_ETAT` | un seul enregistrement, sous la clé `statut` |
| `functions/api/statut.js` | sert l'enregistrement, en lecture seule, sur `/api/statut` |
| `functions/status.json.js` | la même réponse sous `/status.json` |
| `index.html` | affiche le statut sous la barre de date, et rien sans relevé frais |

Un worker séparé, et non une fonction Pages : **Pages ne sait pas déclencher de tâche
planifiée**, seuls les Workers ont des Cron Triggers. GitHub Actions ne convient pas non
plus — sa granularité est de cinq minutes, et ses exécutions sont retardées de dix à vingt
minutes aux heures chargées.

### Le quota commande l'écriture

Le cron s'exécute 1 440 fois par jour ; l'offre KV gratuite plafonne à 1 000 écritures. Une
écriture par passage serait donc épuisée avant 17 h. **On n'écrit que lorsque l'état
change**, plus un battement toutes les 30 minutes pour attester que le contrôle a bien
lieu : la simulation sur 24 h (`node src/test_statut.mjs`) relève 70 écritures pour 1 440
passages.

Ce battement est ce qui permet de distinguer « ouvert depuis ce matin » de « le collecteur
est mort ce matin ». Au-delà de 35 minutes sans relevé, `/api/statut` cesse d'affirmer quoi
que ce soit et le site n'affiche plus rien.

L'espace KV est **dédié**, et non celui des suggestions et des compteurs : les deux
plafonds d'écriture seraient sinon communs, et une journée de forte fréquentation — les
compteurs peuvent consommer jusqu'à 999 écritures — empêcherait le statut de s'enregistrer.

### Cas limites

| Situation | Ce qui se passe |
|---|---|
| Amont en panne, ou 429 | rien n'est écrit, l'enregistrement reste ; la reprise est la minute suivante |
| Panne prolongée | l'enregistrement se périme au bout de 35 min, le site cesse d'afficher |
| Statut inchangé | aucune écriture, sauf le battement des 30 min |
| Message sans statut lisible | rien n'est écrit — le diffuseur publie aussi des communiqués |
| « Fermeture du pont pour travaux » | ignoré : `fermeture` n'est pas `fermé` |
| « Le pont sera fermé demain » | ignoré : une annonce n'est pas un état courant |
| « fermé à la circulation, ouvert aux piétons » | ignoré : les deux mots, on ne tranche pas |
| Message vieux de plus de 30 jours | ignoré : le diffuseur s'est tu |
| Collecteur jamais déployé | `/api/statut` répond `etat: null`, le site n'affiche rien |

Le ton est délibérément prudent : ne rien dire coûte moins cher que d'annoncer un pont
ouvert qui ne l'est pas. Les messages hors format reconnu sont acceptés mais marqués
`confiance: "mot"` plutôt que `"entete"`, ce qui laisse la possibilité de ne montrer que
les seconds.

### Attention au sens des mots

Sur un pont tournant, **« ouvert » est ambigu** : ouvert aux navires veut dire coupé à la
route, et l'inverse. Le reste du site emploie « ouverture » au sens des navires ; les
libellés du bloc de statut, eux, sont écrits au sens du feu vert routier, d'après la
description des messages diffusés. **À confirmer sur de vrais messages avant la mise en
ligne.** Si le sens est inverse, il n'y a que les clés `etatOuvert` et `etatFerme` à
échanger dans les deux dictionnaires du gabarit ; rien d'autre n'en dépend.

### Déploiement

Une fois la sonde concluante, renseigner `AMONT` en tête de `workers/statut/index.js` :
`forme` vaut `wordpress`, `flux` ou `json` — cette dernière se pilote par des chemins
pointés, et c'est par là que passera Citykomi.

```bash
cd workers/statut
npx wrangler kv namespace create PONT_ETAT   # coller l'id rendu dans wrangler.toml
npx wrangler secret put MODERATION_JETON     # protège le déclenchement manuel
npx wrangler deploy
```

Puis, dans le tableau de bord Pages du site, lier le **même** espace KV sous le nom de
variable `ETAT`, afin que `/api/statut` le lise.

Vérifier sans attendre la minute suivante, et suivre le cron :

```bash
curl -X POST https://pont-colbert-statut.<compte>.workers.dev \
  -H "Authorization: Bearer <MODERATION_JETON>"
npx wrangler tail
curl -s https://pont-colbert.fr/api/statut
```

Vérifier la chaîne sans déployer :

```bash
node src/test_statut.mjs
```

## Structure

```
index.html          le site
assets/             photos du héro (jour et nuit), deux largeurs chacune
docs/               avis officiel de la capitainerie : PDF et pages en images
functions/
  api/suggestions.js   recueil des propositions (fonction Pages + espace KV)
  api/frequentation.js compteurs de visites, robots écartés
  api/statut.js        statut courant du pont, en lecture seule
  status.json.js       la même réponse, sous /status.json
workers/
  statut/index.js      collecteur : relève l'amont chaque minute, écrit sur changement
  statut/wrangler.toml cron et liaison KV
src/
  pont_colbert_template.html  gabarit : styles, mise en page, logique d'affichage
  prepare_photo.py            recadre une photo et produit les largeurs voulues
  efface_titre.py             reconstruit le ciel sous le titre incrusté de la photo de nuit
  prepare_avis.py             copie l'avis PDF et en rend les pages en images
  publish.js                  assemble public/ : les seuls fichiers à mettre en ligne
  dataset.json                marées 2026-2028 : [minutesUTC, hauteurCm, pleineMer, coeff, prédit]
  build.js                    assemble gabarit + photo + données, ajoute l'en-tête HTML → index.html
  harmonic.js                 analyse et prédiction harmonique de la marée
  fit_predict2.js             ajuste le modèle sur les données SHOM et le valide
  gen_dataset.js              produit dataset.json (données exactes + prédictions)
  gen_bridge.js               produit le dessin du pont
  parse_mi2.js                extrait les marées officielles des pages maree.info
  test_page_logic.js          vérifie la logique des créneaux sur les 915 jours
  test_suggestions.mjs        vérifie la fonction de recueil, sans déployer
  test_frequentation.mjs      vérifie les compteurs et le filtrage des robots
  sonde_statut.mjs            cherche une source web portant le statut du pont (étape A)
  test_statut.mjs             vérifie la lecture du statut, l'écriture et la péremption
  model.json, extra.json      coefficients du modèle harmonique ajusté
  bridge.svg.html, gen_bridge.js   ancienne silhouette dessinée du pont, conservée
                                   pour mémoire ; plus utilisée depuis le héro photo
```

## Photos du héro

Deux photos, choisies selon le thème : le pont illuminé la nuit en thème sombre, une vue
de jour en thème clair. Un bouton soleil/lune posé sur la photo force un thème et
mémorise le choix ; sans choix, la préférence du système s'applique.

La vue de jour actuelle est une image de synthèse produite par un générateur d'images.
Elle représente un lieu réel : si le site doit faire foi, mieux vaut la remplacer par une
photographie authentique.

Les adresses des photos vivent dans des attributs `data` et sont posées par script avant
la première peinture. C'est délibéré : l'analyseur spéculatif du navigateur lit le HTML
brut avant l'exécution des scripts, et téléchargerait donc la photo correspondant à la
préférence du système même lorsqu'un thème contraire est mémorisé. Le build refuse toute
sortie où la photo du héro porterait un `src` ou un `srcset` statique.

Pour remplacer une photo :

```bash
python src/prepare_photo.py chemin/vers/photo.jpg --nom pont-jour --largeurs 800
node src/build.js
```

`--nom` vaut `pont-jour` ou `pont-nuit`. `--haut` et `--bas` retirent une bande de texte
incrustée. Les fichiers sont nommés d'après leur largeur réelle — jamais d'agrandissement
— et le build les découvre dans `assets/` pour en tirer un `srcset` exact.
Nécessite Pillow : `python -m pip install --user pillow`.

**Les deux photos doivent avoir exactement les mêmes dimensions** (aujourd'hui 1195x896 et
760x570). `object-fit: cover` recadre selon le rapport de l'image : deux rapports
différents font sauter le pont d'une position à l'autre au changement de thème, d'un écart
qui varie en plus avec la taille de l'écran. `build.js` lit les dimensions dans les
fichiers et refuse de construire si elles diffèrent.

C'est cette contrainte qui interdit de rogner le titre incrusté en haut de la photo
nocturne : le rogner emporterait le front de mer, joli de nuit, et changerait le rapport.
Le titre est donc reconstruit plutôt que rogné :

```bash
python src/efface_titre.py chemin/vers/photo-nuit-originale.jpg -s propre.jpg
python src/prepare_photo.py propre.jpg --nom pont-nuit --largeurs 1195 760
```

`efface_titre.py` repère les pixels qui s'écartent du ciel local puis rebouche la zone en
résolvant une équation de Laplace, les pixels conservés servant de conditions aux limites.
Les repères de la photo actuelle sont dans le fichier : texte sur les lignes 87 à 108,
toits à partir de la ligne 109. Nécessite NumPy : `python -m pip install --user numpy`.

## Modifier le site

Après une modification du gabarit ou du dessin :

```bash
node src/build.js
```

Le gabarit est un fragment (il commence par `<title>`) : `build.js` l'enveloppe dans un
document complet avec `<meta name="viewport">`, sans quoi les mobiles affichent la page
en tout petit. L'option `--fragment` produit à la place `src/artifact.html`, format
attendu par l'hébergeur d'Artifacts qui ajoute lui-même son enveloppe.

Vérifier la logique des créneaux :

```bash
node src/test_page_logic.js
```

Puis publier :

```bash
git add -A && git commit -m "Description de la modification" && git push
```

Le site en ligne se met à jour tout seul une minute après.

## Hébergement

Le dépôt est publié par deux hébergeurs qui suivent tous deux la branche `main` et
redéploient à chaque `git push` :

| Hébergeur | Adresse | Rôle |
|---|---|---|
| Cloudflare Pages | https://pont-colbert.pages.dev | adresse de référence |
| GitHub Pages | https://rthque.github.io/pont-colbert/ | secours |

Réglages Cloudflare : préréglage *None*, commande de compilation `node src/publish.js`,
répertoire de sortie `public`.

`src/publish.js` assemble le dossier `public/` avec les seuls fichiers à servir —
`index.html`, `assets/`, `docs/` — et échoue si autre chose s'y glisse. Publier la racine
du dépôt telle quelle mettrait aussi en ligne `.git/`, `src/` et `README.md` : c'est ce
qu'a fait le premier déploiement Cloudflare, où `/.git/config` répondait 200.

GitHub Pages, lui, ne sait servir que la racine ou `docs/` : le site reste donc également
à la racine du dépôt, d'où la duplication apparente. Toutes les adresses internes sont
relatives, le site fonctionne aussi bien à la racine d'un domaine que dans un
sous-répertoire.

Attention au moment de créer le projet Cloudflare : le bouton d'importation d'un dépôt
mène à **Workers**, qui publie sur `*.workers.dev`. Pour une adresse en `*.pages.dev`, il
faut passer explicitement par l'onglet **Pages** puis *Connect to Git*.

L'adresse de référence est déclarée une seule fois, par la constante `SITE` en tête de
`build.js` : elle alimente la balise `canonical`, les métadonnées de partage et le lien
vers le PDF de l'avis dans la version Artifact. Changer d'adresse revient à modifier cette
ligne puis à relancer le build.

## Avertissement

Outil indicatif. La capitainerie de Dieppe reste seule décisionnaire des ouvertures
effectives (VHF canal 12). Heures locales France (Europe/Paris).
