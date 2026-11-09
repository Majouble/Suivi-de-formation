#!/bin/sh
# Remet prod/ dans l'état d'une version publiée, sans toucher au développement.
# Usage, depuis la racine du dépôt :
#   sh outils/revenir-prod.sh          liste des versions publiées
#   sh outils/revenir-prod.sh 1.0.0    remet prod/ en 1.0.0
# Puis : git commit -m "Retour de prod à 1.0.0" && git push   (GitHub Pages suit en quelques minutes).
set -e
cd "$(dirname "$0")/.."
versions() { git log --format=%H -- prod/commun/version.js | while read -r c; do
  v=$(git show "$c:prod/commun/version.js" 2>/dev/null | sed -n 's/.*const VERSION = "\([0-9][0-9.]*\).*/\1/p'); [ -n "$v" ] && echo "$v $c"; done | awk '!vu[$1]++'; }
if [ -z "$1" ]; then echo "Versions publiées (la plus récente d'abord) :"; versions | awk '{print "  " $1 "  (" substr($2, 1, 7) ")"}'; exit 0; fi
v="${1#v}"
if git rev-parse -q --verify "refs/tags/v$v" >/dev/null; then ref="v$v"; else ref=$(versions | awk -v v="$v" '$1 == v { print $2; exit }'); fi
[ -n "$ref" ] || { echo "Version $v introuvable. Versions publiées :" >&2; versions | awk '{print "  " $1}' >&2; exit 1; }
git rm -rq --cached prod >/dev/null 2>&1 || true
rm -rf prod
git checkout "$ref" -- prod
echo "prod/ = $(sed -n 's/.*const VERSION = "\([^"]*\)".*/\1/p' prod/commun/version.js) — à valider : git commit -m \"Retour de prod à $v\" && git push"
