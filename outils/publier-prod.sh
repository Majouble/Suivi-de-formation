#!/bin/sh
# Fige la version de développement (dossiers des widgets à la racine) dans prod/,
# l'adresse utilisée par le document Grist de production.
# Usage, depuis la racine du dépôt : sh outils/publier-prod.sh
set -e
cd "$(dirname "$0")/.."
WIDGETS="accueil-espace donnees-personnelles enquete-satisfaction espace-stagiaire formulaire-public gestion-acces gestion-stage-fpgc pilotage-academique"
version=$(sed -n 's/.*const VERSION = "\([^"]*\)".*/\1/p' commun/version.js)
[ -n "$version" ] || { echo "Version introuvable dans commun/version.js" >&2; exit 1; }
case "$version" in *alpha*|*beta*|*dev*) echo "Version « $version » : une version de test ne part pas en production." >&2; exit 1;; esac
rm -rf prod
mkdir prod
cp -R commun prod/
for w in $WIDGETS; do cp -R "$w" prod/; done
{
  echo "# Widgets FPGC — production ($version)"
  echo
  echo "Copie figée des dossiers de développement, produite par \`outils/publier-prod.sh\`."
  echo "Ne pas modifier ce dossier à la main : on modifie les dossiers à la racine, puis on republie."
} > prod/README.md
echo "prod/ = $version"
echo "Retour arrière possible ensuite : sh outils/revenir-prod.sh <version>"
