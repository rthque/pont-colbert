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

## Structure

```
index.html          le site complet (autonome, aucune dépendance externe)
src/
  pont_colbert_template.html  gabarit : styles, mise en page, logique d'affichage
  bridge.svg.html             silhouette du pont (treillis, pivot, flèche de rotation)
  dataset.json                marées 2026-2028 : [minutesUTC, hauteurCm, pleineMer, coeff, prédit]
  build.js                    assemble gabarit + pont + données, ajoute l'en-tête HTML → index.html
  harmonic.js                 analyse et prédiction harmonique de la marée
  fit_predict2.js             ajuste le modèle sur les données SHOM et le valide
  gen_dataset.js              produit dataset.json (données exactes + prédictions)
  gen_bridge.js               produit le dessin du pont
  parse_mi2.js                extrait les marées officielles des pages maree.info
  test_page_logic.js          vérifie la logique des créneaux sur les 915 jours
  model.json, extra.json      coefficients du modèle harmonique ajusté
```

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

## Avertissement

Outil indicatif. La capitainerie de Dieppe reste seule décisionnaire des ouvertures
effectives (VHF canal 12). Heures locales France (Europe/Paris).
