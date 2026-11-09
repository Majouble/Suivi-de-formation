# Suivi de formation — widgets Grist FPGC

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
