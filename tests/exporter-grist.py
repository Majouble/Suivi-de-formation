# Exporte la structure d'un fichier .grist (tables, colonnes, règles d'accès) au format du faux
# Grist des tests (tests/mock-grist.js), pour vérifier gestion-acces sur un document réel.
# Les lignes des tables métier ne sont PAS exportées : seules les tables vides sont créées.
#
# Usage : python3 tests/exporter-grist.py document.grist > tests/resultats/document.json
import json, sqlite3, sys

base = sqlite3.connect(f'file:{sys.argv[1]}?mode=ro', uri=True)
base.row_factory = sqlite3.Row

def lignes(requete):
    return [dict(r) for r in base.execute(requete)]

doc = {
    '_grist_Tables': lignes('select id, tableId, summarySourceTable from _grist_Tables'),
    '_grist_Tables_column': lignes('select id, parentId, colId, type, isFormula, formula from _grist_Tables_column'),
    '_grist_ACLResources': lignes('select id, tableId, colIds from _grist_ACLResources'),
    '_grist_ACLRules': lignes('select id, resource, aclFormula, permissionsText, rulePos, memo, userAttributes from _grist_ACLRules'),
}
for t in doc['_grist_Tables']:
    if not t['summarySourceTable']:
        doc[t['tableId']] = []
json.dump(doc, sys.stdout, ensure_ascii=False)
