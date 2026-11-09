# Vérifie que chaque condition n'utilise que la syntaxe acceptée par les règles d'accès Grist
# (sous-ensemble Python : and/or/not, comparaisons simples, attributs, constantes, listes).
import ast, json, sys
OK_NODES = (ast.Expression, ast.BoolOp, ast.And, ast.Or, ast.UnaryOp, ast.Not, ast.Compare,
            ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Is, ast.IsNot, ast.In, ast.NotIn,
            ast.Name, ast.Load, ast.Constant, ast.Attribute, ast.List, ast.Tuple)
NAMES = {'user', 'rec', 'newRec', 'OWNER', 'EDITOR', 'VIEWER', 'True', 'False', 'None'}
bad = 0
for f in json.load(open(sys.argv[1])):
    try:
        tree = ast.parse(f, mode='eval')
        for n in ast.walk(tree):
            if not isinstance(n, OK_NODES): raise SyntaxError(f'noeud non supporté {type(n).__name__}')
            if isinstance(n, ast.Compare) and len(n.ops) != 1: raise SyntaxError('comparaison chaînée')
            if isinstance(n, ast.Name) and n.id not in NAMES: raise SyntaxError(f'nom inconnu {n.id}')
        print('OK  ', f)
    except SyntaxError as e:
        bad += 1; print('KO  ', f, '->', e)
print('formules invalides :', bad); sys.exit(1 if bad else 0)
