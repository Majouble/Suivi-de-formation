// Tests du module commun/normalisation.js — node tests/normalisation.test.js
const N = require('../commun/normalisation.js');

let echecs = 0;
function egal(obtenu, attendu, cas) {
  const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${cas}${ok ? '' : ` — obtenu ${JSON.stringify(obtenu)}, attendu ${JSON.stringify(attendu)}`}`);
  if (!ok) echecs += 1;
}

const v = N.normaliserValeur;
egal(v('Nom', '  de la  fontaine '), 'DE LA FONTAINE', 'nom en majuscules, espaces nettoyés');
egal(v('Nom', 'lefèvre'), 'LEFÈVRE', 'nom : accents conservés');
egal(v('Prenom', 'jean-pierre'), 'Jean-Pierre', 'prénom composé avec trait d\'union');
egal(v('Prenom', 'MARIE   anne'), 'Marie Anne', 'prénom composé avec espace');
egal(v('Prenom', "élodie"), 'Élodie', 'prénom commençant par une lettre accentuée');
egal(v('Lieu_de_naissance', "saint-étienne"), 'Saint-Étienne', 'lieu de naissance');
egal(v('Lieu_de_naissance', "l'haÿ-les-roses"), "L'Haÿ-les-Roses", 'lieu avec apostrophe et article');
egal(v('Lieu_de_naissance', 'SAINT-GERMAIN-EN-LAYE'), 'Saint-Germain-en-Laye', 'lieu : préposition en minuscules');
egal(v('Gare_arrivee', 'le mans'), 'Le Mans', 'lieu : article en tête conservé en majuscule');
egal(v('Lieu_de_naissance', 'la roche-sur-yon'), 'La Roche-sur-Yon', 'lieu : article en tête et préposition');
egal(v('Mel', ' Jean.Dupont@AC-Exemple.FR '), 'jean.dupont@ac-exemple.fr', 'mél en minuscules sans espaces');
egal(v('Telephone_portable', '+33612345678'), '06 12 34 56 78', 'téléphone +33');
egal(v('Telephone_portable', '06.12.34.56.78'), '06 12 34 56 78', 'téléphone avec points');
egal(v('Telephone_portable', '0033 7 12 34 56 78'), '07 12 34 56 78', 'téléphone 0033');
egal(v('Telephone_portable', '+44 7700 900123'), '+44 7700 900123', 'numéro étranger seulement nettoyé');
egal(v('Vehicule_immatriculation', 'ab 123 cd'), 'AB-123-CD', 'immatriculation SIV');
egal(v('Vehicule_immatriculation', '1234 ab 75'), '1234 AB 75', 'ancienne immatriculation en majuscules');
egal(v('Taille_haut_treillis', ' xl '), 'XL', 'taille en majuscules');
egal(v('Grade_long', '  personnel de direction   hors classe'), 'Personnel de direction hors classe', 'texte libre');
egal(v('Colonne_inconnue', '  tel quel '), '  tel quel ', 'colonne non concernée inchangée');
egal(v('Nom', ''), '', 'valeur vide inchangée');
egal(v('Besoin_hebergement', true), true, 'valeur non textuelle inchangée');

egal(N.melValide('a.b@ac-x.fr'), true, 'mél valide');
egal(N.melValide('a.b@ac-x'), false, 'mél sans domaine complet');
egal(N.melValide('a b@x.fr'), true, 'espaces retirés avant contrôle');
egal(N.melValide('pas un mel'), false, 'texte qui n\'est pas un mél');

egal(N.cleIdentite('Lefèvre', 'Jean-Pierre'), N.cleIdentite('LEFEVRE', 'jean pierre'), 'clé identité sans accents, casse ni ponctuation');
egal(N.cleIdentite('', 'Jean'), '', 'pas de clé identité sans nom');

const d = N.doublonsCandidatures([
  { id: 1, Nom: 'DUPONT', Prenom: 'Jean', Mel: 'jean.dupont@x.fr' },
  { id: 2, Nom: 'Dupont', Prenom: 'jean', Mel: 'Jean.Dupont@X.fr ' },
  { id: 3, Nom: 'Martin', Prenom: 'Léa', Mel: 'lea@x.fr' },
  { id: 4, Nom: 'MARTIN', Prenom: 'Lea', Mel: 'lea.martin@y.fr' },
  { id: 5, Nom: 'Durand', Prenom: 'Paul', Mel: '' },
  { id: 6, Nom: 'Bernard', Prenom: 'Zoé', Mel: '' },
]);
egal(d.get(1), { motif: 'même adresse mél', autres: [2] }, 'doublon par mél (casse différente)');
egal(d.get(2), { motif: 'même adresse mél', autres: [1] }, 'doublon réciproque');
egal(d.get(3), { motif: 'même nom et prénom', autres: [4] }, 'homonyme avec mél différent');
egal(d.has(5) || d.has(6), false, 'mél vides non comptés comme doublons');

console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent');
process.exit(echecs ? 1 : 0);
