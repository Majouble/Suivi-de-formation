# Suivi de formation — widgets Grist FPGC

## Contenu du dépôt

Les sept widgets en service viennent du document **« Suivi FPGC - v17 »**. Ils ont été extraits le 09/11/2026 du Custom Widget Builder, où ils sont actuellement installés : un widget par dossier, avec l'onglet HTML du builder dans le `.html` et l'onglet JavaScript dans le `.js`. Ces fichiers reproduisent le builder à l'identique et n'ont pas encore été adaptés pour être servis directement par GitHub Pages.

| Dossier | Page du document | Rôle |
|---|---|---|
| `accueil-espace/` | ▶ Page d'accueil | Présentation du document et sommaire des pages |
| `gestion-stage-fpgc/` | 🔎 Gestion des stages | Calendrier, création et gestion d'un stage (6 onglets) |
| `pilotage-academique/` | 📊 Tableau de bord académique | Indicateurs, carte et paramètres de l'académie |
| `formulaire-public/` | ✒ Formulaire d'inscription | Recrutement par lien Link Key, panneau « liens » pour le personnel |
| `espace-stagiaire/` | 💼 Espace stagiaire | Planning, sous-groupe et émargement du stagiaire |
| `enquete-satisfaction/` | ✅ Enquête de satisfaction | Questionnaire anonyme, résultats pour le personnel |
| `donnees-personnelles/` | 💾 Mentions RPGD | Mention d'information RGPD (HTML seul) |
| `gestion-acces.html` / `.js` (racine) | à créer | Application des règles d'accès (voir ci-dessous) |

Ne sont pas dans le dépôt :
- **Parcours stagiaire** : la page contient le modèle vide du builder ;
- **Pilotage et gestion des stages** : widget Markdown natif de Grist, son texte est stocké dans une table ;
- **pilotage national** : absent du document v17.

## Gestion des accès (`gestion-acces.html`)

Page Grist (Custom Widget) qui applique en un clic la configuration de référence des règles d'accès du document : attributs utilisateur, règles par table, colonnes pont. Avant d'appliquer, elle sauvegarde les règles en place, et elle permet de les restaurer.

### Installation dans Grist

1. Ajoutez une page au document, avec un widget **Custom** dont l'URL pointe vers `gestion-acces.html`, servi par GitHub Pages ou un autre hébergement.
2. Dans les réglages du widget, choisissez l'accès **« Accès complet au document »**.
3. Ouvrez la page avec un compte **propriétaire**. Grist ne communique les règles d'accès qu'aux propriétaires.

Commencez toujours par une **copie** du document de production.

### Paramètres

En tête de `gestion-acces.js` :

- `CLES_LIEN` : noms des paramètres Link Key ;
- `COLONNES_CAMARADE_VISIBLES` ;
- `TABLES_REFERENCE` : la configuration elle-même.

### Tests

```bash
npm install playwright      # si nécessaire
node tests/run-test.js      # faux Grist en mémoire, captures dans tests/resultats/
python3 tests/check_formulas.py tests/resultats/formules.json
```
