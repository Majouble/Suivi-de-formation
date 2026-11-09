/*
 * Mise en forme des saisies et clés de comparaison pour la détection de doublons.
 *
 * Définit : window.NormalisationFPGC = {
 *             normaliserChamps(champs)   → copie de champs, chaque colonne connue mise en forme
 *             normaliserValeur(colonne, valeur)
 *             melValide(mel)             → vrai si l'adresse a une forme plausible
 *             cleMel(mel), cleIdentite(nom, prenom) → clés de comparaison (sans casse ni accents)
 *             doublonsCandidatures(candidatures) → Map id → { motif, autres: [ids] }
 *           }
 * Utilise : rien. Chargé avant le code du widget (../commun/normalisation.js).
 *           Également chargeable dans Node pour les tests (module.exports).
 *
 * Règles de mise en forme (colonnes de Candidats_du_stage / Annuaire_FPGC) :
 *   Nom                    MAJUSCULES, espaces superflus retirés           « de la fontaine » → « DE LA FONTAINE »
 *   Prenom                 Majuscule à chaque partie (espace, trait d'union, apostrophe)
 *                                                                          « jean-pierre » → « Jean-Pierre »
 *   Lieux (naissance, gare) idem, articles en minuscules                    « aix-en-provence » → « Aix-en-Provence »
 *   Mel                    minuscules, sans espaces
 *   Telephone_portable     chiffres groupés par deux pour un numéro français « +33612345678 » → « 06 12 34 56 78 »
 *   Vehicule_immatriculation  MAJUSCULES, format AA-123-AA quand il est reconnu
 *   Tailles, UAI           MAJUSCULES
 *   Textes libres          espaces superflus retirés, première lettre en majuscule
 * Une valeur vide, ou qui n'est pas du texte, est rendue telle quelle.
 */
(function (racine) {
  // Espaces multiples, insécables et tabulations ramenés à un espace simple.
  function nettoyer(texte) {
    return String(texte).replace(/[\s  ]+/g, ' ').trim();
  }

  function majuscules(texte) {
    return nettoyer(texte).toLocaleUpperCase('fr-FR');
  }

  // Majuscule au début de chaque partie séparée par un espace, un trait d'union ou une apostrophe.
  function majusculeParPartie(texte) {
    return nettoyer(texte)
      .toLocaleLowerCase('fr-FR')
      .replace(/(^|[\s\-'’])(\p{L})/gu, (tout, separateur, lettre) => separateur + lettre.toLocaleUpperCase('fr-FR'));
  }

  // Noms de lieux : comme ci-dessus, mais les articles et prépositions restent en minuscules
  // (sauf en tête) : « saint-germain-en-laye » → « Saint-Germain-en-Laye ».
  const PETITS_MOTS_LIEUX = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'lès', 'en', 'sur', 'sous', 'et', 'aux', 'au']);
  function lieu(texte) {
    let position = 0;
    return majusculeParPartie(texte).replace(/\p{L}+/gu, (mot) => {
      position += 1;
      const minuscule = mot.toLocaleLowerCase('fr-FR');
      return position > 1 && PETITS_MOTS_LIEUX.has(minuscule) ? minuscule : mot;
    });
  }

  function premiereMajuscule(texte) {
    const t = nettoyer(texte);
    return t ? t.charAt(0).toLocaleUpperCase('fr-FR') + t.slice(1) : t;
  }

  function mel(texte) {
    return String(texte).replace(/[\s  ]+/g, '').toLowerCase();
  }

  // Numéro français (10 chiffres commençant par 0, ou +33 / 0033 suivi de 9 chiffres) :
  // « 06 12 34 56 78 ». Tout autre numéro (étranger, incomplet) est seulement nettoyé.
  function telephone(texte) {
    const brut = nettoyer(texte);
    let chiffres = brut.replace(/[^\d+]/g, '');
    if (/^(\+33|0033)\d{9}$/.test(chiffres)) chiffres = '0' + chiffres.slice(-9);
    if (/^0\d{9}$/.test(chiffres)) return chiffres.replace(/(\d{2})(?=\d)/g, '$1 ');
    return brut;
  }

  // Immatriculation SIV (AA-123-AA), saisie avec ou sans séparateurs.
  function immatriculation(texte) {
    const t = majuscules(texte);
    const compact = t.replace(/[\s\-.]/g, '');
    const siv = compact.match(/^([A-Z]{2})(\d{3})([A-Z]{2})$/);
    return siv ? `${siv[1]}-${siv[2]}-${siv[3]}` : t;
  }

  const REGLE_PAR_COLONNE = {
    Nom: majuscules,
    Prenom: majusculeParPartie,
    Mel: mel,
    Telephone_portable: telephone,
    Lieu_de_naissance: lieu,
    Gare_arrivee: lieu,
    Vehicule_immatriculation: immatriculation,
    Taille_haut_treillis: majuscules,
    Taille_pantalon_treillis: majuscules,
    UAI_etablissement_d_affectation: majuscules,
    Grade_long: premiereMajuscule,
    Discipline_d_exercice: premiereMajuscule,
    Vehicule_marque_modele_couleur: premiereMajuscule,
    Regime_alimentaire: premiereMajuscule,
  };

  function normaliserValeur(colonne, valeur) {
    const regle = REGLE_PAR_COLONNE[colonne];
    if (!regle || typeof valeur !== 'string' || !valeur.trim()) return valeur;
    return regle(valeur);
  }

  function normaliserChamps(champs) {
    const resultat = {};
    for (const [colonne, valeur] of Object.entries(champs)) resultat[colonne] = normaliserValeur(colonne, valeur);
    return resultat;
  }

  function melValide(texte) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mel(texte || ''));
  }

  // Clés de comparaison : sans accents, sans casse, sans espaces ni ponctuation.
  function sansAccents(texte) {
    return String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function cleMel(texte) {
    return mel(texte || '');
  }
  function cleIdentite(nom, prenom) {
    const cle = (t) => sansAccents(t).toLowerCase().replace(/[^a-z]/g, '');
    const n = cle(nom);
    const p = cle(prenom);
    return n && p ? `${n}|${p}` : '';
  }

  // Doublons dans une liste de candidatures ({ id, Nom, Prenom, Mel }).
  // motif « même adresse mél » (quasi certain) ou « même nom et prénom » (homonyme possible).
  function doublonsCandidatures(candidatures) {
    const parCle = new Map();
    const ajouter = (cle, motif, id) => {
      if (!cle) return;
      const k = `${motif}#${cle}`;
      if (!parCle.has(k)) parCle.set(k, []);
      parCle.get(k).push(id);
    };
    for (const c of candidatures) {
      ajouter(cleMel(c.Mel), 'mel', c.id);
      ajouter(cleIdentite(c.Nom, c.Prenom), 'identite', c.id);
    }
    const resultat = new Map();
    for (const [k, ids] of parCle) {
      if (ids.length < 2) continue;
      const motif = k.startsWith('mel#') ? 'même adresse mél' : 'même nom et prénom';
      for (const id of ids) {
        const deja = resultat.get(id);
        // « même adresse mél » l'emporte sur « même nom et prénom » quand les deux s'appliquent.
        if (deja && deja.motif === 'même adresse mél') continue;
        resultat.set(id, { motif, autres: ids.filter((x) => x !== id) });
      }
    }
    return resultat;
  }

  const api = { normaliserChamps, normaliserValeur, melValide, cleMel, cleIdentite, doublonsCandidatures };
  racine.NormalisationFPGC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
