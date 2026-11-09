# Suivi de formation — widgets Grist FPGC

Widgets du document Grist de suivi des formations FPGC. Version en cours : voir `commun/version.js`. Elle est aussi affichée en bas à droite de chaque widget et dans la console du navigateur.

## Adresses

Les widgets sont servis par GitHub Pages. Dans Grist, chaque page est un widget **Custom** dont l'URL est l'une de celles-ci, avec l'accès **« Accès complet au document »** (sauf Données personnelles : « Aucun accès »).

| Widget | Page du document | Production (version figée) | Développement |
|---|---|---|---|
| Accueil | ▶ Page d'accueil | `…/prod/accueil-espace/` | `…/accueil-espace/` |
| Gestion des stages | 🔎 Gestion des stages | `…/prod/gestion-stage-fpgc/` | `…/gestion-stage-fpgc/` |
| Pilotage académique | 📊 Tableau de bord académique | `…/prod/pilotage-academique/` | `…/pilotage-academique/` |
| Formulaire de recrutement | ✒ Formulaire d'inscription | `…/prod/formulaire-public/` | `…/formulaire-public/` |
| Espace stagiaire | 💼 Espace stagiaire | `…/prod/espace-stagiaire/` | `…/espace-stagiaire/` |
| Enquête de satisfaction | ✅ Enquête de satisfaction | `…/prod/enquete-satisfaction/` | `…/enquete-satisfaction/` |
| Données personnelles | 💾 Mentions RPGD | `…/prod/donnees-personnelles/` | `…/donnees-personnelles/` |
| Gestion des accès | à créer (propriétaires) | `…/prod/gestion-acces/` | `…/gestion-acces/` |

`…` = `https://majouble.github.io/Suivi-de-formation`

Un document de production n'utilise que des adresses `…/prod/…`, et une copie de test les adresses de développement. Ne mélangez pas les deux dans un même document.

**Passage du builder à GitHub Pages.** Aujourd'hui, les widgets du document v17 tournent depuis le Custom Widget Builder. Pour basculer une page : menu du widget → *Widget options* → choisir **Custom URL** et coller l'adresse de production. Faites-le d'abord sur une copie du document. Les réglages enregistrés par un widget (options du widget, table `Parametres_widget`) ne changent pas.

## Organisation

```
accueil-espace/            un dossier par widget : index.html + son fichier .js
donnees-personnelles/      (index.html seul)
enquete-satisfaction/
espace-stagiaire/
formulaire-public/
gestion-acces/             application des règles d'accès (voir plus bas)
gestion-stage-fpgc/
pilotage-academique/
commun/version.js          numéro de version, chargé par tous les widgets
commun/normalisation.js    mise en forme des saisies (NOM, Prénom, mél, téléphone…) et détection des doublons,
                           chargé par le formulaire de recrutement et la gestion des stages
prod/                      copie figée pour la production — ne pas modifier à la main
outils/publier-prod.sh     fige le développement dans prod/
outils/revenir-prod.sh     remet prod/ dans l'état d'une version publiée
tests/                     faux Grist et scénarios du widget de gestion des accès
```

Origine : version 1.0.0 = code extrait du Custom Widget Builder du document « Suivi FPGC - v17 » le 09/11/2026, à l'identique. Seul ajout : le chargement de `commun/version.js`. Ne sont pas dans le dépôt : la page « Parcours stagiaire » (modèle vide du builder), la page « Pilotage et gestion des stages » (widget Markdown natif) et le pilotage national (absent du v17).

Pour revenir au builder, collez le contenu de `index.html` dans l'onglet HTML et celui du `.js` dans l'onglet JavaScript. Les balises `<script src=…>` relatives sont alors ignorées : le widget fonctionne, mais **sans les modules de `commun/`**. Il n'y a alors ni numéro de version, ni mise en forme des saisies, ni détection des doublons de candidatures.

## Mise en production

1. Dans `commun/version.js`, passer `VERSION` à un numéro sans `alpha` (par exemple `1.1.0 (jj/mm/aaaa)`).
2. `sh outils/publier-prod.sh` : `prod/` est recréé à partir des dossiers de développement. Le script refuse une version qui contient `alpha`, `beta` ou `dev`.
3. Valider et pousser. GitHub Pages publie en une à deux minutes.
4. Dans le document de production, vider le cache (Ctrl+F5) et vérifier le numéro de version en bas à droite.
5. Reprendre le développement avec une version de test (`1.1.1-alpha.1`…).

Retour arrière : `sh outils/revenir-prod.sh` liste les versions publiées, et `sh outils/revenir-prod.sh 1.0.0` remet `prod/` dans cet état.

## Gestion des accès (`gestion-acces/`)

Page réservée aux propriétaires. Elle applique en un clic la configuration de référence des règles d'accès du document : attributs utilisateur, règles par table, colonnes pont. Avant d'appliquer, elle sauvegarde les règles en place, et elle permet de les restaurer. La configuration de référence est décrite dans le document de projet `acces.md` et codée dans `TABLES_REFERENCE`, en tête de `gestion-acces.js`. Les autres paramètres sont aussi en tête du fichier : `TABLE_UTILISATEURS`, `COLONNE_ROLE`, `CLES_LIEN`, `COLONNES_CAMARADE_VISIBLES`.

Commencez toujours par une **copie** du document de production. Grist ne communique les règles d'accès qu'aux propriétaires.

### Tests

```bash
node tests/normalisation.test.js             # règles de mise en forme et de doublons
node tests/recrutement-doublons.test.js tests/resultats/document.json   # formulaire et gestion, faux Grist

npm install playwright                       # si nécessaire
node tests/run-test.js                       # scénarios sur un faux Grist, captures dans tests/resultats/
python3 tests/check_formulas.py tests/resultats/formules.json

# Vérifier le widget sur la structure d'un vrai document (copie en modèle, sans données) :
python3 tests/exporter-grist.py document.grist > tests/resultats/document.json
node tests/verifier-document.js tests/resultats/document.json
```
