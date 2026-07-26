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

## Fréquentation et suggestions

Deux compteurs publics, servis par [Abacus](https://abacus.jasoncameron.dev) (gratuit,
sans inscription) dans l'espace `pont-colbert-dieppe` : `visites` est incrémenté à chaque
ouverture de la page, `visiteurs` une seule fois par navigateur, au moyen d'un témoin
dans le stockage local. Si le service ne répond pas, le bloc reste masqué plutôt que
d'afficher un compteur cassé. Les clés d'administration permettant de remettre les
compteurs à zéro sont dans `CLES-ADMIN.txt`, exclu du dépôt.

Le bouton « Proposer une amélioration » compose un courriel prérempli. L'adresse est
assemblée à l'exécution et n'apparaît donc pas en clair dans le source de la page.

## Structure

```
index.html          le site
assets/             photos du héro (jour et nuit), deux largeurs chacune
docs/               avis officiel de la capitainerie : PDF et pages en images
src/
  pont_colbert_template.html  gabarit : styles, mise en page, logique d'affichage
  prepare_photo.py            recadre une photo et produit les largeurs voulues
  prepare_avis.py             copie l'avis PDF et en rend les pages en images
  dataset.json                marées 2026-2028 : [minutesUTC, hauteurCm, pleineMer, coeff, prédit]
  build.js                    assemble gabarit + photo + données, ajoute l'en-tête HTML → index.html
  harmonic.js                 analyse et prédiction harmonique de la marée
  fit_predict2.js             ajuste le modèle sur les données SHOM et le valide
  gen_dataset.js              produit dataset.json (données exactes + prédictions)
  gen_bridge.js               produit le dessin du pont
  parse_mi2.js                extrait les marées officielles des pages maree.info
  test_page_logic.js          vérifie la logique des créneaux sur les 915 jours
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
incrustée (le titre de la photo de nuit, la légende de la carte postale). Les fichiers
sont nommés d'après leur largeur réelle — jamais d'agrandissement — et le build les
découvre dans `assets/` pour en tirer un `srcset` exact.
Nécessite Pillow : `python -m pip install --user pillow`.

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

Le site n'a aucune étape de compilation côté hébergeur : les fichiers du dépôt sont servis
tels quels. Réglages Cloudflare Pages : préréglage *None*, commande de compilation vide,
répertoire de sortie `/`. Toutes les adresses internes sont relatives, le site fonctionne
donc aussi bien à la racine d'un domaine que dans un sous-répertoire.

L'adresse de référence est déclarée une seule fois, par la constante `SITE` en tête de
`build.js` : elle alimente la balise `canonical`, les métadonnées de partage et le lien
vers le PDF de l'avis dans la version Artifact. Changer d'adresse revient à modifier cette
ligne puis à relancer le build.

## Avertissement

Outil indicatif. La capitainerie de Dieppe reste seule décisionnaire des ouvertures
effectives (VHF canal 12). Heures locales France (Europe/Paris).
