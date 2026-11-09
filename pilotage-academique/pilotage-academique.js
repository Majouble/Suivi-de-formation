/* Pilotage FPGC — widget « Pilotage académique »
 * Widget commun à toutes les académies (même code, une académie ne voit que ses propres
 * données via les règles ACL — voir acl-academies.md §20). Remplace l'onglet « Tableau de
 * bord » et l'écran « Paramètres » du portail Gestion de stage FPGC (voir spec.md, Session
 * 2026-08-25).
 */

grist.ready({ requiredAccess: 'full' });

/* ---------------------------------------------------------------------- */
/* Constantes                                                              */
/* ---------------------------------------------------------------------- */

const ETAB_NATIONAL_TABLE = 'Etablissements_education_nationale';
const OVERRIDES_TABLE = 'Cibles_fonction_overrides';

// 48e échange : les circonscriptions d'inspection du 1er degré (IEN) sont déjà des lignes de
// l'Annuaire de l'éducation nationale, avec leur propre UAI et leur propre latitude/longitude —
// identifiées par cette valeur exacte de `Libelle_nature` (vérifiée en conditions réelles sur
// l'API, 1 531 lignes nationales, DOM-TOM compris — voir processus-gestion-stage.md). Elles sont
// donc déjà rapatriées par le bouton d'actualisation existant (aucun filtre Type_etablissement sur
// l'appel API), à condition d'ajouter Libelle_nature à la copie locale (voir
// upsertEtablissementsLocaux) pour pouvoir les distinguer des deux autres natures administratives
// qui partagent le même Type_etablissement = 'Service Administratif' (services DSDEN, directions
// départementales) — celles-ci ne doivent PAS apparaître sur la carte.
const CIRCONSCRIPTION_NATURE = 'CIRCONSCRIPTIONS INSPECTION EDUC NAT';

// 48e échange : fond de carte IGN Géoplateforme (WMTS, keyless, sans limite de débit contrairement
// aux API de géocodage/routage de la même plateforme) — Web Mercator (pyramide PM), pas EPSG:2154
// (Lambert-93), qui ne couvre pas les académies d'outre-mer. Voir processus-gestion-stage.md,
// 48e échange, pour la comparaison des options envisagées.
const IGN_WMTS_URL = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
  + '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM'
  + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png';

const TABLES = [
  'Reference', 'BD_Stages2', 'Candidats_du_stage', 'Administration_et_logistique',
  'Preferences_tableau_bord', 'Objectifs_previsionnels',
  // 46e échange : consultée pour la « Cible auto » (numérateur — personnels déjà consolidés dans
  // l'annuaire FPGC, tous établissements/années confondus, filtrés par académie d'affectation) et
  // pour la modale de détail par établissement (clic sur un point de la carte).
  'Annuaire_FPGC',
  // 47e échange : remplace les appels API en direct (comptage d'établissements, géolocalisation)
  // par la lecture d'une copie locale, actualisée académie par académie via le bouton de
  // l'onglet Paramètres (voir refreshEtablissementsAcademie) — voir processus-gestion-stage.md.
  ETAB_NATIONAL_TABLE, OVERRIDES_TABLE,
];

const COLS = 4;
// 55e échange : 8 -> 11, pour laisser la place aux 3 nouveaux blocs fixes de tableau de bord
// (repartitionFonction/progressionAnnuelle/tauxParDepartement, voir BLOCK_DEFS/PRESET_A plus bas),
// placés sous les blocs existants (jusqu'à la rangée 11 dans PRESET_A) — sans ce relèvement, le
// glisser-déposer/redimensionnement clavier (clamp sur VISIBLE_ROWS, voir commitMove/commitResize)
// aurait interdit de déplacer un bloc jusque dans ces nouvelles rangées, alors même qu'elles sont
// occupées dès le préréglage par défaut. La rangée 7 est laissée volontairement libre sous
// prevStages/prevPersonnels (rangée 6) : ces deux blocs peuvent être agrandis à 2 rangées (voir le
// palier « agrandi » de renderBlockBody) sans chevaucher aussitôt repartitionFonction/
// progressionAnnuelle, qui démarrent donc à la rangée 8 plutôt que 7.
const VISIBLE_ROWS = 11;

// 47e échange : l'annuaire de l'éducation nationale (data.gouv.fr) n'est plus interrogé en direct
// depuis chaque navigateur pour la géolocalisation et le comptage d'établissements — il est
// actualisé, académie par académie, dans la table locale Etablissements_education_nationale (bouton
// « Actualiser » de l'onglet Paramètres, voir refreshEtablissementsAcademie ci-dessous), puis toute
// lecture (carte, cible auto) se fait de façon synchrone sur cette copie locale via fetchTable —
// même mécanisme que toutes les autres tables du widget. CORS confirmé en conditions réelles
// (widget Grist déployé, 47e échange) pour l'appel du bouton d'actualisation lui-même.
const ETAB_API_BASE = 'https://tabular-api.data.gouv.fr/api/resources/b22f04bf-64a8-495d-b8bb-d84dbc4c7983/data/';
const ETAB_API_PAGE_SIZE = 50; // plafond confirmé en conditions réelles (47e échange)
const ETAB_API_MAX_PAGES = 400; // garde-fou (200 établissements/académie en moyenne à page_size=50 ; large marge)
const UAI_REGEX = /^[0-9]{7}[A-Z]$/;

// Dimensions utilisées pour calculer, à partir du seul rowSpan d'un bloc (donc sans mesure DOM),
// combien de lignes de contenu tiennent dans l'espace disponible — voir "Contenu adaptatif des
// blocs" plus bas. Reprend les constantes déjà utilisées pour le glisser-déposer (grid-auto-rows,
// gap) plutôt que de les redéfinir séparément.
const ROW_UNIT_PX = 100; // .dashboard-grid { grid-auto-rows: 100px }
const ROW_GAP_PX = 14; // .dashboard-grid { gap: 14px }
const BLOCK_PAD_V_PX = 28; // .dash-block { padding: 14px 16px } — 14 haut + 14 bas
const BLOCK_HEAD_H_PX = 34; // .dash-block-head, estimation prudente (titre + marge, poignées en mode édition)
// Hauteurs de ligne mesurées dans Chromium (Playwright) plutôt qu'estimées à la main — une
// sous-estimation aurait laissé passer des lignes qui débordent réellement, une surestimation
// est sans risque (juste un peu plus prudente qu'il ne faut).
const REPERE_ROW_H_PX = 48;
// 55e échange : retrait de la fonctionnalité Croisements, remplacée par 3 blocs fixes (voir plus
// bas) — CX_ROW_H_PX (hauteur de ligne de l'ancien bloc de croisement) ne servait qu'à son
// plafonnement adaptatif (computeCappedRows), retirée avec lui.
const NOTE_H_PX = 20;
const CARTE_MAP_MIN_PX = 70;
const CARTE_CAPTION_H_PX = 24;
// 52e échange : CARTE_TABLE_HEAD_H_PX/CARTE_TABLE_ROW_H_PX retirées avec le tableau HTML sous la
// carte (voir carteTableRows, supprimée — remplacé par les filtres du bouton « Filtres », voir
// openCarteFiltersModal) — CARTE_MAP_MIN_PX/CARTE_CAPTION_H_PX restent utiles pour hasCaptionRoom
// (place de la légende textuelle sous la carte, inchangée).

const BLOCK_DEFS = [
  { key: 'kpi', title: 'Chiffres clés', desc: 'Cartes de synthèse en tête de tableau de bord (stages, personnels, satisfaction, réponse).' },
  { key: 'reperes', title: 'Tableau de repères de pilotage', desc: 'Indicateurs avec code couleur bon / à surveiller / critique.' },
  // 51e échange : la carte montre désormais tous les établissements réels de l'académie (annuaire
  // national local), pas seulement ceux ayant déjà une candidature — voir computeData/etabs.
  { key: 'carte', title: 'Carte des établissements', desc: "Tous les établissements de l'académie ; mise en évidence de ceux avec du personnel formé (annuaire FPGC)." },
  { key: 'prevStages', title: 'Stages — prévisionnel', desc: 'Stages prévus vs réalisés pour l’année scolaire en cours.' },
  { key: 'prevPersonnels', title: 'Personnels à former — prévisionnel', desc: 'Personnels à former prévus vs formés pour l’année scolaire en cours.' },
  // 55e échange : 3 nouveaux blocs fixes de tableau de bord, remplaçant la fonctionnalité
  // « Croisements à effectuer » retirée ce même échange (voir DIMENSIONS/MESURES/computeCroisement,
  // supprimés) — voir renderBlockBody pour le détail de chaque visualisation SVG.
  { key: 'repartitionFonction', title: 'Répartition des formés par fonction', desc: 'Anneau de répartition des personnels formés (annuaire FPGC) par fonction.' },
  { key: 'progressionAnnuelle', title: 'Progression annuelle', desc: 'Stages réalisés et personnels formés, par année scolaire (toutes années confondues).' },
  { key: 'tauxParDepartement', title: 'Taux de formation par département', desc: 'Taux de couverture (personnels formés / cible automatique) par département de l’académie.' },
];
const DEFAULT_CHECKS = {
  kpi: true, reperes: true, carte: true, prevStages: true, prevPersonnels: true,
  repartitionFonction: true, progressionAnnuelle: true, tauxParDepartement: true,
};

const PRESET_A = [
  // « kpi » démarre sur 2 rangées plutôt qu'une seule (41e échange) : à 1 rangée, la grille de
  // 4 tuiles (libellé + valeur + repère) n'avait tout simplement pas la place de s'afficher en
  // entier — masquée jusqu'ici par la barre de défilement du bloc plutôt que réellement visible.
  // Voir aussi le plafonnement par palier (« kpiTier ») qui prend le relais si l'utilisateur
  // réduit quand même ce bloc.
  { id: 'kpi', col: 1, row: 1, colSpan: 4, rowSpan: 2 },
  { id: 'reperes', col: 1, row: 3, colSpan: 2, rowSpan: 3 },
  { id: 'carte', col: 3, row: 3, colSpan: 2, rowSpan: 3 },
  { id: 'prevStages', col: 1, row: 6, colSpan: 2, rowSpan: 1 },
  { id: 'prevPersonnels', col: 3, row: 6, colSpan: 2, rowSpan: 1 },
  // 55e échange : nouvelles rangées sous le prévisionnel — anneau et progression annuelle côte à
  // côte (2 colonnes chacun), puis le graphique par département sur toute la largeur en dessous
  // (davantage de barres potentielles, un par département de l'académie). Rangée 7 laissée libre
  // (voir commentaire sur VISIBLE_ROWS) pour ne pas bloquer l'agrandissement du prévisionnel.
  { id: 'repartitionFonction', col: 1, row: 8, colSpan: 2, rowSpan: 2 },
  { id: 'progressionAnnuelle', col: 3, row: 8, colSpan: 2, rowSpan: 2 },
  { id: 'tauxParDepartement', col: 1, row: 10, colSpan: 4, rowSpan: 2 },
];

// 55e échange : DIMENSIONS/MESURES (et la fonctionnalité « Croisements à effectuer » qu'elles
// alimentaient) sont retirées — remplacées par les 3 blocs fixes ci-dessus (voir BLOCK_DEFS). Voir
// aussi state.croisements/dimension/mesure, computeCroisement, syncBlocksWithChecks,
// loadPrefsIntoState, savePrefs, renderParametresTab et bindEvents pour les autres suppressions
// liées à ce même retrait.

/* ---------------------------------------------------------------------- */
/* État                                                                    */
/* ---------------------------------------------------------------------- */

const DB = {};
const state = {
  options: {},
  academieId: null,
  academieNom: '—',
  aclScoped: true,
  prefRow: null,
  tab: 'tableau', // 'tableau' | 'parametres'
  editMode: false,
  blocks: [],
  checks: Object.assign({}, DEFAULT_CHECKS),
  // 55e échange : retrait de la fonctionnalité Croisements, remplacée par 3 blocs fixes (voir plus
  // bas) — state.croisements/dimension/mesure (état de l'ancienne carte « Croisements à
  // effectuer ») ne servent plus à rien.
  focusedId: null,
  dirty: false,
  // 48e échange : dernière position (centre/zoom) de la carte Leaflet, capturée avant chaque
  // reconstruction de #main et restaurée après — voir leafletMap ci-dessus et mountCarteLeaflet.
  // null tant que la carte n'a jamais été affichée : dans ce cas, pré-positionnement sur le
  // territoire de l'académie connectée (voir academieGeoBounds).
  mapView: null,
  // 52e échange : même mécanique que mapView, mais pour l'instance Leaflet INDÉPENDANTE de la
  // modale plein écran (voir openCarteExpandModal/mountCarteLeaflet, opts.isExpanded) — deux cartes,
  // deux positions de vue distinctes, pour ne pas resynchroniser malgré elle le pan/zoom de l'une
  // sur l'autre à chaque render().
  mapViewExpanded: null,
  // 52e échange : la carte plein écran (bouton « Agrandir », voir renderTableauTab) doit être
  // remontée après CHAQUE render() tant que la modale reste ouverte (comme leafletMap/mapView pour
  // la carte compacte) — ce booléen piloté par openCarteExpandModal/closeCarteExpandModal indique à
  // render() s'il doit le faire. Non persisté : une modale plein écran ne doit jamais rester
  // « ouverte » après un rechargement du widget.
  carteExpanded: false,
  // 50e échange : circonscriptions décochées dans la modale de filtre du bloc carte — un Set d'UAI
  // de circonscription. 52e échange : cette modale (désormais « Filtres », voir
  // openCarteFiltersModal) fusionne ce filtre historique avec les nouveaux filtres type/secteur/
  // tutelle ci-dessous — reste géré séparément (state.hiddenCirconscriptions) plutôt que fondu dans
  // mapFilters, car sa sémantique diffère : un Set d'identités précises (UAI) rattachées à la carte
  // du jour, pas un choix parmi un petit nombre de catégories fixes connues à l'avance. Réglage de
  // confort d'affichage propre à la session du navigateur, pas une préférence persistée dans
  // Preferences_tableau_bord (contrairement à BlocsJSON/DispositionJSON/CroisementsJSON) : se
  // réinitialise à un rechargement, comme un filtre de vue plutôt qu'une disposition.
  hiddenCirconscriptions: new Set(),
  // 52e échange : filtres d'affichage de la carte des établissements — demande explicite (trop de
  // points à l'échelle académique, carte illisible). Multi-choix (Set), PAS un filtre qui s'élargit
  // comme Secteur_cible/Tutelle_cible de l'onglet Cible auto (voir secteurKeyOf/tutelleKeyOf) : les
  // deux mécanismes ont une sémantique différente (celui-ci décide quels points la carte MONTRE
  // parmi ceux déjà dans le périmètre Cible auto, celui-là décide quels établissements FONT PARTIE
  // de ce périmètre) — d'où isTutelleMen, dédiée à cet usage plutôt que la réutilisation directe de
  // matchesTutelle. Même traitement que hiddenCirconscriptions : non persisté, réinitialisé au
  // rechargement. Toutes les valeurs cochées par défaut (aucun établissement filtré à l'ouverture).
  mapFilters: {
    types: new Set(['Ecole', 'Collège', 'Lycée']),
    secteurs: new Set(['Public', 'Privé']),
    tutelles: new Set(['MEN', 'Autres']),
    // 53e échange : nouvelle section « Personnel formé » de la modale « Filtres » (demande d'ajout,
    // pas un bug) — même modèle que les 3 Set ci-dessus (multi-choix, toutes les valeurs cochées par
    // défaut). Une circonscription n'a pas de notion de « personnel formé » (voir etabPasseFiltres,
    // FONCTIONS_SANS_CIBLE) : elle n'est jamais concernée par ce filtre, comme pour les 3 autres.
    statutFormes: new Set(['formes', 'non_formes']),
  },
};
let flashTimer = null;
let optionsReady;

// 48e échange : instance Leaflet de la carte des établissements. render() reconstruit
// systématiquement le HTML de #main (mécanisme existant, nécessaire au dimensionnement adaptatif
// des blocs — voir plus bas) : le conteneur DOM de la carte est donc lui aussi détruit à chaque
// rendu, et l'instance Leaflet doit être recréée après coup (mountCarteLeaflet, appelée depuis
// render()). Pour ne pas perdre le pan/zoom de l'utilisateur à chaque rendu déclenché par une
// action sans rapport (changement d'onglet, ajustement de cible, redimensionnement d'un autre
// bloc...), la position de vue est capturée avant destruction et restaurée après recréation —
// voir state.mapView plus bas. Un vrai réusinage qui ferait persister l'instance Leaflet
// elle-même à travers les rendus serait plus propre mais suppose de sortir la carte du mécanisme
// de reconstruction synchrone de #main — hors périmètre de cette livraison.
let leafletMap = null;
// 52e échange : seconde instance Leaflet, indépendante de leafletMap ci-dessus, pour la modale
// plein écran de la carte (bouton « Agrandir », voir openCarteExpandModal/mountCarteLeaflet,
// opts.isExpanded) — même traitement à chaque render() (capture de vue, destruction, remontage),
// mais uniquement tant que state.carteExpanded reste vrai (modale ouverte).
let leafletMapExpanded = null;

// 47e échange : plus de cache réseau côté widget — la géolocalisation vient directement de la
// table locale Etablissements_education_nationale (voir etabNationalByUai ci-dessous), lue comme
// n'importe quelle autre table du document.

/* ---------------------------------------------------------------------- */
/* 46e échange — « Cible auto » : établissements réels (dénominateur) de   */
/* l'Annuaire de l'éducation nationale, comptés par département/type/      */
/* secteur via le même jeu de données que la géolocalisation ci-dessus     */
/* (meta.total renvoyé même à page_size=1 — un comptage complet en une     */
/* seule requête légère par combinaison, jamais besoin de récupérer les    */
/* lignes elles-mêmes). Voir processus-gestion-stage.md pour le détail de  */
/* la vérification de ce mécanisme (requêtes réelles menées avant          */
/* d'écrire ce code) et la discussion de faisabilité qui l'a précédé.      */
/* ---------------------------------------------------------------------- */

// Types d'établissement comptés (valeurs exactes attendues par l'API, vérifiées en conditions
// réelles) — Ecole = 1er degré, Collège/Lycée = 2nd degré (regroupement demandé par l'utilisateur).
const TYPES_ETABLISSEMENT = ['Ecole', 'Collège', 'Lycée'];
const NIVEAU_OF_TYPE = { Ecole: '1er degré', Collège: '2nd degré', Lycée: '2nd degré' };

// Règle de cible par fonction (46e échange) : 1 poste cible par établissement du type concerné et
// par fonction listée — règle par défaut proposée par l'assistant et validée par l'utilisateur
// (« 1 poste cible par établissement concerné »). Autre : aucune cible calculable depuis l'annuaire
// de l'éducation (pas de notion d'établissement dédié) — son effectif formé reste affiché, mais sans
// cible (voir renderFonctionRows).
// 56e échange : « Adjoint gestionnaire » est renommé « Secrétaire général » (même poste — décision
// administrative, pas un nouveau poste) — la fonction « Secrétaire général » qui existait par
// ailleurs jusqu'ici (voir FONCTIONS_SANS_CIBLE) est fusionnée dans ce renommage : elle GARDE la
// cible automatique par établissement qu'avait « Adjoint gestionnaire », elle ne redevient pas une
// fonction sans cible. Voir normalizeFonction ci-dessous pour la compatibilité avec les données déjà
// saisies sous l'ancien libellé.
const FONCTION_CIBLE_PAR_TYPE = {
  Ecole: ["Directeur d'école"],
  Collège: ['Principal', 'Principal adjoint', 'Secrétaire général'],
  Lycée: ['Proviseur', 'Proviseur adjoint', 'Secrétaire général'],
};
const FONCTIONS_SANS_CIBLE = ['Autre'];

// 56e échange : « Adjoint gestionnaire » est renommé « Secrétaire général » (même poste). Une ligne
// Annuaire_FPGC/Cibles_fonction_overrides déjà saisie avant ce renommage peut encore porter
// littéralement l'ancien libellé — un simple changement de liste déroulante Grist ne migre jamais
// les valeurs déjà stockées. Cette normalisation évite qu'une personne/un ajustement déjà enregistré
// sous l'ancien nom disparaisse silencieusement des totaux dès ce tour.
function normalizeFonction(f) {
  const v = String(f || '').trim();
  return v === 'Adjoint gestionnaire' ? 'Secrétaire général' : v;
}

// 55e échange : ordre FIXE des fonctions pour le bloc donut « Répartition des formés par fonction »
// (voir computeData/renderRepartitionFonctionChart) — jamais recalé par rang/valeur (règle catégorielle
// de la compétence dataviz : « color follows the entity, never its rank »). Copie exacte de l'ordre
// du champ « Fonction » du formulaire de recrutement (voir QUESTIONS_RECRUTEMENT dans
// gestion-stage-fpgc.js/formulaire-public.js, optionsChoix de la question 'fonction').
// 56e échange : 8 -> 7 entrées — « Adjoint gestionnaire » et « Secrétaire général » fusionnés (voir
// FONCTION_CIBLE_PAR_TYPE/FONCTIONS_SANS_CIBLE ci-dessus), l'ancien doublon est retiré.
const FONCTION_ORDRE = [
  'Proviseur', 'Proviseur adjoint', 'Principal', 'Principal adjoint',
  "Directeur d'école", 'Secrétaire général', 'Autre',
];
// 55e échange : palette catégorielle fixe (une teinte par fonction dans l'ordre ci-dessus) — reprise
// telle quelle de la palette de référence de la compétence dataviz (references/palette.md), validée
// avec scripts/validate_palette.js AVANT tout usage.
// 56e échange : FONCTION_ORDRE passe de 8 à 7 entrées (fusion Adjoint gestionnaire/Secrétaire
// général) — retirer une couleur d'un ensemble déjà validé ne peut pas dégrader les distances CVD/
// contraste des couleurs restantes ; les 7 premières teintes déjà choisies au 55e échange sont donc
// revalidées telles quelles (voir pilotage-academique.html, --fonction-color-0..6) :
//   node validate_palette.js "#2a78d6,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7" --mode light
//     -> ALL CHECKS PASS (WARN contraste sur 3 teintes — vert/orange/rose — sous 3:1 sur le fond
//        clair : mitigé par la légende, toujours affichée avec valeur numérique en clair, jamais la
//        seule couleur pour porter l'information — voir renderRepartitionFonctionChart).
//   node validate_palette.js "#3987e5,#d95926,#199e70,#c98500,#d55181,#008300,#9085e9" --mode dark --surface "#1a1a19"
//     -> ALL CHECKS PASS (contraste >= 3:1 sur les 7 teintes).
// Les valeurs elles-mêmes (light/dark) sont posées en variables CSS --fonction-color-0..6 dans
// pilotage-academique.html (mode sombre = ses propres valeurs validées, jamais une simple inversion).
// --fonction-color-7 (8e teinte, portait l'ancien « Autre ») reste définie sans dommage — plus
// jamais indexée, FONCTION_ORDRE.length valant désormais 7 (voir renderRepartitionFonctionChart, qui
// n'indexe jamais au-delà de FONCTION_ORDRE.length - 1).

// 54e échange : Reference.Departements contient en réalité, en conditions réelles, des libellés
// lisibles par département du type "02 - Aisne, 60 - Oise, 80 - Somme" (code + tiret + nom) — pas de
// simples codes à 3 chiffres séparés par espace comme supposé jusqu'ici. L'ancien découpage
// (`split(/[,;\s]+/)`) coupait AUSSI sur les espaces internes de chaque libellé, explosant "02 -
// Aisne" en 3 pseudo-codes : "02" (le bon), "-" (le tiret, devenu "00-" après padStart(3,'0') — IDENTIQUE
// pour tous les départements, d'où la ligne fantôme répétée « département 00- »), et "Aisne" (le nom,
// déjà >= 3 caractères donc inchangé par padStart — d'où la ligne fantôme « département Aisne »).
// Chaque pseudo-code produisait sa propre ligne dans la table « Cible auto par établissement »
// (computeCibleAutoData, `rows = depts.map(...)`, non dédupliqué), d'où 3 lignes par département.
//
// Correctif, robuste aux DEUX formats possibles : on découpe D'ABORD par virgule/point-virgule (un
// département par segment) — jamais par espace à ce stade, pour ne pas couper "02 - Aisne" en
// morceaux — puis, à l'intérieur de chaque segment, on repère le CODE par motif (2 ou 3 chiffres, ou
// "2A"/"2B" pour la Corse) plutôt que par position. Ça extrait correctement le code que le segment
// soit "02 - Aisne", "02" seul, ou même plusieurs codes bruts space-séparés dans un unique segment
// sans virgule (ex. "02 60 80", l'ancien format supposé — jamais formellement invalidé, pourrait
// exister ailleurs : le `/g` global sur le motif retrouve alors chaque code du segment). Le
// comportement de sortie (liste de codes à 3 caractères) ne change pas — seule l'extraction en amont
// est corrigée ; voir pilotage-smoketest.js pour la vérification de non-régression sur l'ancien
// format bare-code (ex. Departements: '021').
function departementsOfAcademie(acadRow) {
  const raw = acadRow ? String(acadRow.Departements || '') : '';
  const codes = [];
  raw.split(/[,;]+/).forEach((segment) => {
    const matches = segment.match(/\b(2[AB]|\d{2,3})\b/gi) || [];
    matches.forEach((m) => codes.push(m.toUpperCase()));
  });
  return codes.filter(Boolean).map((s) => s.padStart(3, '0'));
}

function secteurKeyOf(prefRow) {
  return (prefRow && prefRow.Secteur_cible === 'Public et privé sous contrat') ? 'public_prive' : 'public';
}

// 47e échange : même mécanique que Secteur_cible (filtre qui s'élargit, pas un choix exclusif —
// tranché par AskUserQuestion, « Filtre qui s'élargit (comme le secteur) »).
function tutelleKeyOf(prefRow) {
  return (prefRow && prefRow.Tutelle_cible === 'Toutes tutelles (Éducation nationale et autres ministères)') ? 'toutes' : 'education_nationale';
}

function stripAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// Le champ API `Type_contrat_prive` vaut « SANS OBJET » pour le public (vérifié en conditions
// réelles, 47e échange) et une vraie valeur de contrat pour un établissement privé sous contrat —
// reste à confirmer la valeur exacte portée par un établissement privé HORS contrat (jamais observée
// en conditions réelles faute d'avoir croisé ce cas précis lors du test) : on part de l'hypothèse la
// plus prudente, qu'elle est elle aussi non vide et différente de « SANS OBJET », donc distinguable.
function estSousContratPrive(r) {
  const v = String((r && r.Type_contrat_prive) || '').trim();
  return v !== '' && v.toUpperCase() !== 'SANS OBJET';
}

function matchesSecteur(r, secteurKey) {
  if (secteurKey === 'public_prive') return r.Statut_public_prive === 'Public' || (r.Statut_public_prive === 'Privé' && estSousContratPrive(r));
  return r.Statut_public_prive === 'Public';
}

// Un `Ministere_tutelle` vide (jamais observé en conditions réelles à ce stade, mais l'API ne
// garantit rien) est traité comme Éducation nationale — l'hypothèse la plus sûre pour ne pas exclure
// à tort un établissement du filtre de base par défaut d'une valeur manquante.
function matchesTutelle(r, tutelleKey) {
  if (tutelleKey === 'toutes') return true;
  const t = stripAccents((r && r.Ministere_tutelle) || '').toUpperCase();
  return t === '' || t.indexOf('EDUCATION NATIONALE') !== -1;
}

// 52e échange : catégorisation MEN/Autres tutelles pour le filtre d'affichage de la carte (voir
// state.mapFilters/etabPasseFiltres) — réplique exactement la même règle que matchesTutelle
// (valeur vide ou contenant EDUCATION NATIONALE, accents supprimés/majuscules -> MEN, tout le reste
// -> Autres) mais renvoie un booléen dédié plutôt que de réutiliser matchesTutelle telle quelle :
// celle-ci répond à une question différente (« ce périmètre Cible auto élargi inclut-il tout, ou
// seulement l'Éducation nationale ? »), pas « à quelle catégorie ce point de carte appartient-il
// pour un filtre multi-choix ? » — les deux sémantiques ne doivent pas être mélangées.
function isTutelleMen(r) {
  const t = stripAccents((r && r.Ministere_tutelle) || '').toUpperCase();
  return t === '' || t.indexOf('EDUCATION NATIONALE') !== -1;
}

// 52e échange : filtre d'affichage de la carte des établissements (state.mapFilters) — une
// circonscription reste toujours affichée ici (gérée uniquement par sa propre section de la
// modale « Filtres », voir openCarteFiltersModal) ; pour un établissement, un champ vide/inconnu ne
// doit jamais le faire disparaître silencieusement — seule une valeur reconnue et absente du Set
// correspondant l'exclut. Utilisée à la fois par mountCarteLeaflet (points réellement affichés) et
// par renderBlockBody('carte') (comptage « X sur Y établissements affichés » de la légende) : les
// deux doivent raconter exactement la même histoire.
function etabPasseFiltres(e) {
  if (e.isCirconscription) return true;
  if (e.type && !state.mapFilters.types.has(e.type)) return false;
  if (e.secteur && !state.mapFilters.secteurs.has(e.secteur)) return false;
  if (!state.mapFilters.tutelles.has(e.tutelleMen ? 'MEN' : 'Autres')) return false;
  // 53e échange : nouveau filtre « établissements formés uniquement / pas formés » (state.mapFilters.
  // statutFormes) — une circonscription passe toujours (return true tout en haut, avant ce test),
  // aucune notion de personnel formé pour ce type.
  if (!state.mapFilters.statutFormes.has(e.formes ? 'formes' : 'non_formes')) return false;
  return true;
}

// Index UAI normalisé -> ligne locale, reconstruit à chaque calcul (la table n'est jamais assez
// grande — une académie à la fois — pour justifier un cache invalidé à la main).
function etabNationalByUai() {
  const map = new Map();
  T(ETAB_NATIONAL_TABLE).forEach((r) => { const uai = normalizeUai(r.UAI); if (uai) map.set(uai, r); });
  return map;
}

// 51e échange : normalisation « libre » d'un nom d'établissement (casse/accents/ponctuation
// ignorés) — sert uniquement de repli quand aucun UAI n'est exploitable (voir
// resolveEtabForPersonnel), jamais pour la correspondance UAI elle-même qui reste exacte.
function normalizeNomEtab(s) {
  return stripAccents(String(s || '').trim().toUpperCase()).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// 53e échange : les trois comptages qui filtrent Annuaire_FPGC par académie d'affectation
// comparaient auparavant `(r.Academie_d_affectation || '').trim()` au nom exact de l'académie par
// ÉGALITÉ STRICTE de chaîne, sans normaliser accents/casse/espaces — alors que
// personnelsFormesPourEtab (qui affiche correctement la personne dans la modale par établissement au
// clic sur un point de la carte) ne fait AUCUNE comparaison d'académie, seulement une résolution
// d'établissement par UAI/nom. Résultat signalé par l'utilisateur : une fiche annuaire correctement
// renseignée avec une Fonction restait invisible dans « Personnels formés » (et partout ailleurs où
// la comparaison stricte était utilisée) dès que la valeur saisie différait ne serait-ce que par la
// casse/les accents/un espace du nom exact utilisé ailleurs, tout en restant visible dans la modale
// par établissement. Réutilise normalizeNomEtab (déjà écrite pour un besoin de tolérance similaire,
// casse/accents/ponctuation ignorés) plutôt qu'une nouvelle logique de normalisation.
function matchesAcademieAffectation(r, academieNom) {
  return normalizeNomEtab(r && r.Academie_d_affectation) === normalizeNomEtab(academieNom);
}

// Index nom normalisé -> lignes locales de l'annuaire national, optionnellement restreint à une
// académie (recommandé pour le repli de resolveEtabForPersonnel : un nom d'établissement générique
// comme « École primaire » existe dans plusieurs académies, la restriction limite les collisions).
// Une clé peut porter plusieurs lignes (nom partagé par plusieurs établissements) — resolveEtabForPersonnel
// ne s'en sert que si la clé désigne un établissement UNIQUE, pour ne jamais deviner.
function etabNationalByNom(codeAcademique) {
  const map = new Map();
  T(ETAB_NATIONAL_TABLE).forEach((r) => {
    if (codeAcademique && (r.Code_academie || '').trim() !== codeAcademique) return;
    const key = normalizeNomEtab(r.Nom_etablissement);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return map;
}

// 51e échange : la quasi-totalité des lignes historiques d'Annuaire_FPGC n'ont jamais eu de code
// UAI renseigné (migration 45e échange : 0 ligne sur 11 857 routée vers l'UAI, voir
// processus-gestion-stage.md) — une logique qui exige un UAI valide pour rattacher un personnel à
// un établissement écarte donc presque tout l'annuaire existant. resolveEtabForPersonnel tente
// d'abord l'UAI (fiable, cf. normalizeUai), puis un repli par nom normalisé contre l'annuaire
// national local — seulement quand ce nom désigne un établissement UNIQUE dans l'index (byNom),
// sinon la correspondance serait trop incertaine pour être utilisée silencieusement. Ne devine
// jamais par proximité de texte : un personnel qui ne peut être rattaché par aucune de ces deux voies
// reste explicitement « non rattaché » (voir annuaireFormesParDepartement, computeData) plutôt que
// d'être compté au mauvais endroit ou silencieusement ignoré.
function resolveEtabForPersonnel(r, byUai, byNom) {
  const uai = normalizeUai(r.UAI_etablissement_d_affectation);
  if (uai && byUai.has(uai)) return byUai.get(uai);
  const key = normalizeNomEtab(r.Nom_etablissement_d_affectation);
  if (!key) return null;
  const candidats = byNom.get(key);
  return (candidats && candidats.length === 1) ? candidats[0] : null;
}

/* ---------------------------------------------------------------------- */
/* Accès aux données Grist                                                 */
/* ---------------------------------------------------------------------- */

function T(tableId) { return (DB[tableId] && DB[tableId].rows) || []; }
function byId(tableId, rowId) { return DB[tableId] && DB[tableId].byId.get(rowId); }

async function loadTable(tableId) {
  const data = await grist.docApi.fetchTable(tableId);
  const cols = Object.keys(data).filter((k) => k !== 'id');
  const rows = data.id.map((id, i) => {
    const row = { id };
    cols.forEach((c) => { row[c] = data[c][i]; });
    return row;
  });
  DB[tableId] = { rows, byId: new Map(rows.map((r) => [r.id, r])) };
  return DB[tableId];
}

async function loadAll() {
  const results = await Promise.allSettled(TABLES.map((t) => loadTable(t)));
  const failed = [];
  results.forEach((r, i) => { if (r.status === 'rejected') failed.push(TABLES[i] + ' : ' + (r.reason && r.reason.message ? r.reason.message : String(r.reason))); });
  if (failed.length) throw new Error(failed.join(' — '));
}

/* ---------------------------------------------------------------------- */
/* Aides diverses                                                          */
/* ---------------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s === null || s === undefined || s === false ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// FPGC-03 (audit sécurité) : allow-list stricte pour toute couleur réinjectée dans un attribut
// style — Couleur_circonscription est une colonne Grist ordinaire, modifiable hors de l'UI du
// widget (édition directe de la table, API), donc jamais fiable telle quelle. On la valide une
// fois, au plus près de la lecture (upsertEtablissementsLocaux), pour que tous les usages en aval
// (marqueur carte, légende) héritent d'une valeur déjà sûre.
const HEX_COLOR_RE = /^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
function safeColor(c) {
  return typeof c === 'string' && HEX_COLOR_RE.test(c.trim()) ? c.trim() : null;
}

function statusFromTaux(t) {
  if (t === null || t === undefined) return 'neutre';
  if (t >= 90) return 'bon';
  if (t >= 70) return 'surveiller';
  return 'critique';
}
function statusLabel(s) {
  return s === 'bon' ? 'Bon' : (s === 'surveiller' ? 'À surveiller' : (s === 'critique' ? 'Critique' : '—'));
}
function pct(a, b) {
  if (!b) return null;
  return Math.round((a / b) * 100);
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clonePreset(p) { return p.map((b) => Object.assign({}, b)); }

// FPGC-03 (audit sécurité) : DispositionJSON est une colonne Grist (JSON libre), pas un canal
// interne — un écrivain direct (API, édition de cellule) peut y placer n'importe quelle valeur
// pour col/row/colSpan/rowSpan, qui sont ensuite concaténées telles quelles dans un attribut
// style="grid-column:…" (renderTableauTab). On force donc chaque coordonnée à un entier borné aux
// dimensions réelles de la grille avant de l'accepter dans state.blocks ; toute entrée dont l'id
// n'est pas une chaîne est rejetée (elle ne correspondrait de toute façon à aucun BLOCK_DEFS).
function sanitizeGridBlocks(blocks) {
  const toSafeInt = (v, lo, hi, fallback) => {
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? clamp(n, lo, hi) : fallback;
  };
  return blocks
    .filter((b) => b && typeof b === 'object' && typeof b.id === 'string')
    .map((b) => ({
      id: b.id,
      col: toSafeInt(b.col, 1, COLS, 1),
      row: toSafeInt(b.row, 1, VISIBLE_ROWS, 1),
      colSpan: toSafeInt(b.colSpan, 1, COLS, 1),
      rowSpan: toSafeInt(b.rowSpan, 1, VISIBLE_ROWS, 1),
    }));
}

// 54e échange : séparateur de milliers façon française (espace fine/insécable), pour la seule tuile
// « Personnels formés » du tableau de bord (voir computeKpis) — nouveau format demandé par
// l'utilisateur ("1 050 / 20 003"). N'est utilisé NULLE PART ailleurs dans ce fichier : aucune autre
// valeur affichée aujourd'hui n'utilise de séparateur de milliers, cette convention existante reste
// inchangée en dehors de cette tuile précise.
function formatNombreFr(n) {
  return Number(n || 0).toLocaleString('fr-FR');
}

/* ---------------------------------------------------------------------- */
/* Contenu adaptatif des blocs                                             */
/* ---------------------------------------------------------------------- */
// Un bloc redimensionné (glisser-déposer, flèches Maj) doit toujours tenir dans sa nouvelle
// taille sans barre de défilement (demande explicite de l'utilisateur, 41e échange). Comme le
// bloc n'est jamais mesuré dans le DOM après rendu (render() est synchrone et reconstruit tout
// le HTML), la hauteur de contenu disponible est calculée analytiquement à partir du seul
// rowSpan — sur le même principe que le calcul de `rowUnit` déjà utilisé pour le glisser-déposer
// plus bas. Le contenu à taille fixe (KPI, prévisionnel) s'appuie sur flexbox (CSS) pour occuper
// tout l'espace ; le contenu de longueur variable (repères, croisements, tableau
// d'établissements) est plafonné ici à ce qui tient réellement, avec une note « + N » explicite
// plutôt qu'un débordement scrollable.
function blockContentHeightPx(rowSpan) {
  const total = rowSpan * ROW_UNIT_PX + Math.max(0, rowSpan - 1) * ROW_GAP_PX;
  return Math.max(0, total - BLOCK_PAD_V_PX - BLOCK_HEAD_H_PX);
}

// Calcule combien d'éléments d'une liste de hauteur de ligne fixe peuvent s'afficher sans
// dépasser l'espace disponible, en réservant si besoin la place d'une note de troncature.
// Ne renvoie jamais 0 si `totalCount > 0` (au moins un élément reste visible, quitte à ce que
// la note « + N » ne s'affiche pas faute de place — préférable à une liste qui semble vide).
function computeCappedRows(rowSpan, rowHeightPx, totalCount, reservedPx, noteHeightPx) {
  if (totalCount <= 0) return { maxRows: 0, showNote: false };
  const contentPx = blockContentHeightPx(rowSpan);
  const budget = Math.max(0, contentPx - (reservedPx || 0));
  if (Math.floor(budget / rowHeightPx) >= totalCount) return { maxRows: totalCount, showNote: false };
  const rowsWithNote = Math.floor((budget - (noteHeightPx || 0)) / rowHeightPx);
  if (rowsWithNote >= 1) return { maxRows: clamp(rowsWithNote, 1, totalCount), showNote: true };
  // Même une seule ligne ne tient pas confortablement à cette taille : on en affiche quand même
  // une (jamais un bloc qui semble vide), mais on renonce à la note « + N » — elle-même n'aurait
  // clairement pas de place, mieux vaut ne pas la rendre que la laisser invisiblement rognée.
  return { maxRows: 1, showNote: false };
}

// 52e échange : carteTableRows (calcul du nombre de lignes du tableau HTML sous la carte) est
// retirée avec ce tableau lui-même — remplacé par les filtres du bouton « Filtres », voir
// renderBlockBody('carte')/openCarteFiltersModal. La carte elle-même continue de se dimensionner
// par flexbox (flex:1), inchangé.

// Le bloc « Chiffres clés » n'est pas une liste (toujours 4 tuiles) : plutôt que plafonner un
// nombre de lignes, on réduit le contenu de chaque tuile par palier (libellé+valeur+repère ->
// valeur+libellé -> valeur seule) selon la place réellement disponible, pour ne jamais dépendre
// d'un défilement pour lire un chiffre.
function kpiTier(rowSpan) {
  const contentPx = blockContentHeightPx(rowSpan);
  if (contentPx >= 78) return 'full';
  if (contentPx >= 50) return 'compact';
  return 'mini';
}
function rectsOverlap(a, b) {
  return !(a.col + a.colSpan - 1 < b.col || b.col + b.colSpan - 1 < a.col || a.row + a.rowSpan - 1 < b.row || b.row + b.rowSpan - 1 < a.row);
}

// 55e échange : généralisation de l'ancienne currentAnneeScolaire() (qui n'acceptait aucun
// paramètre, `new Date()` en dur) — même règle exacte (mois >= 8 -> année-année+1, sinon
// année-1—année), appliquée à un epoch Unix donné plutôt qu'à l'instant présent. Sert au bloc
// « Progression annuelle » (voir computeData), qui doit dériver l'année scolaire de la date de
// chaque stage (Date_de_debut_de_session), pas seulement de l'année courante.
function anneeScolaireDeEpoch(epoch) {
  if (epoch === null || epoch === undefined || epoch === '') return null;
  const d = new Date(epoch * 1000);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1-12
  return (m >= 8) ? (y + '-' + (y + 1)) : ((y - 1) + '-' + y);
}

function currentAnneeScolaire() {
  return anneeScolaireDeEpoch(Date.now() / 1000);
}

function trimestreLabel(epoch) {
  if (!epoch) return '—';
  const d = new Date(epoch * 1000);
  const m = d.getMonth() + 1;
  if (m >= 9 && m <= 12) return '1er trimestre (sept.-déc.)';
  if (m >= 1 && m <= 3) return '2e trimestre (janv.-mars)';
  return '3e trimestre (avril-août)';
}

// Un champ « UAI ou nom » (voir QUESTIONS_RECRUTEMENT dans gestion-stage-fpgc.js) n'est en
// réalité un vrai code UAI que s'il respecte le format officiel (7 chiffres + 1 lettre
// majuscule) — sinon c'est un nom libre saisi par l'équipe, qu'on ne peut pas géolocaliser de
// façon fiable (aucune tentative d'appariement approximatif par nom : trop de risque de placer
// un établissement au mauvais endroit).
function normalizeUai(s) {
  const v = String(s || '').trim().toUpperCase();
  return UAI_REGEX.test(v) ? v : null;
}

// 47e échange : géolocalisation lue directement depuis Etablissements_education_nationale (table
// locale, actualisée par académie via le bouton de l'onglet Paramètres) — voir etabNationalByUai
// et son utilisation dans computeData ci-dessous. Plus de requête réseau ni de cache navigateur ici.

// 48e échange : l'ancienne projection équirectangulaire maison (chaque axe normalisé sur l'étendue
// des établissements géolocalisés, sans fond de carte — 42e échange) est retirée au profit d'un
// vrai fond de carte Leaflet + IGN Géoplateforme, qui place chaque point à ses vraies coordonnées
// géographiques — voir mountCarteLeaflet plus bas. Voir processus-gestion-stage.md, 48e échange,
// pour la discussion complète (pourquoi EPSG:2154 a été écarté, statut de Proj4Leaflet, etc.).

// Étendue géographique de l'académie connectée — toutes les lignes géolocalisées de
// Etablissements_education_nationale pour cette académie (établissements ET circonscriptions),
// pas seulement celles qui ont des candidatures (d.etabs, beaucoup plus restreint et pas
// représentatif du territoire réel de l'académie). Sert à pré-positionner la carte (fitBounds)
// tant que l'utilisateur n'a pas déjà déplacé la vue lui-même (voir state.mapView).
function academieGeoBounds() {
  const acadRow = state.academieId ? byId('Reference', state.academieId) : null;
  const code = acadRow ? String(acadRow.Code_academique || '').trim() : '';
  if (!code) return null;
  const bounds = T(ETAB_NATIONAL_TABLE)
    .filter((r) => r.Actif && (r.Code_academie || '').trim() === code
      && typeof r.Latitude === 'number' && typeof r.Longitude === 'number')
    .map((r) => [r.Latitude, r.Longitude]);
  return bounds.length ? bounds : null;
}

// 48e échange : montage/remontage de la carte Leaflet dans le conteneur reconstruit par render()
// (voir la note sur leafletMap plus haut). Sans effet si l'onglet affiché n'a pas ce conteneur
// (#carteLeafletHost — bloc « carte » décoché ou onglet différent), ou si le script Leaflet n'a
// pas pu se charger (pas de réseau vers le CDN) : dans ce cas la légende sous la carte reste seule
// visible, sans erreur bloquante.
// 52e échange : généralisée pour monter soit la carte compacte du bloc tableau de bord (opts par
// défaut), soit une seconde instance Leaflet INDÉPENDANTE pour la modale plein écran (bouton
// « Agrandir », voir openCarteExpandModal) — mêmes marqueurs, même bouton « Filtres », sans dupliquer
// cette construction. `viewKey` distingue quelle clé de state (mapView / mapViewExpanded) porte la
// position de vue de CETTE instance, pour que les deux cartes gardent chacune leur propre pan/zoom.
function mountCarteLeaflet(d, opts) {
  opts = opts || {};
  const hostId = opts.hostId || 'carteLeafletHost';
  const isExpanded = !!opts.isExpanded;
  const viewKey = isExpanded ? 'mapViewExpanded' : 'mapView';
  const host = document.getElementById(hostId);
  if (!host || typeof L === 'undefined') return;
  // 50e échange : une circonscription décochée dans la modale de filtre (state.hiddenCirconscriptions)
  // masque ses écoles sur la carte — seuls les établissements effectivement rattachés à une
  // circonscription (circUai non vide, en pratique le 1er degré) sont concernés par ce filtre ; un
  // établissement du 2nd degré, sans circonscription, reste toujours affiché.
  // 52e échange : + etabPasseFiltres(e), pour les nouveaux filtres type/secteur/tutelle (voir
  // state.mapFilters/openCarteFiltersModal) — même liste de points que celle comptée par la légende
  // (renderBlockBody('carte')), pour que les deux racontent toujours la même histoire.
  const withGeo = d.etabs.filter((e) => e.geoStatus === 'resolu'
    && !(e.circUai && state.hiddenCirconscriptions.has(e.circUai))
    && etabPasseFiltres(e));
  // 52e échange : variable locale plutôt qu'affectation directe à la variable de module (leafletMap
  // ou leafletMapExpanded selon isExpanded, décidée à la toute fin de la fonction) — évite de
  // dupliquer toute la construction des marqueurs entre les deux instances.
  const map = L.map(host, { attributionControl: false, zoomControl: true });
  L.tileLayer(IGN_WMTS_URL, {
    minZoom: 3, maxZoom: 19,
    attribution: 'Fond de carte : IGN-F/Géoportail (Géoplateforme)',
  }).addTo(map);
  L.control.attribution({ prefix: false }).addTo(map);

  const candidatBounds = [];
  withGeo.forEach((e) => {
    // 51e échange : la carte affiche désormais tous les établissements de l'académie (voir
    // computeData), pas seulement ceux ayant une candidature — l'ancien encodage primaire (couleur
    // bon/surveiller/critique selon le taux de candidatures formées) n'a donc plus de sens pour un
    // établissement sans aucune candidature. Encodage retenu (proposition, l'utilisateur ayant
    // laissé le choix ouvert — voir processus-gestion-stage.md, 51e échange) : un point vert
    // (« forme ») dès qu'au moins un personnel de l'annuaire FPGC est rattaché à l'établissement,
    // un point neutre sinon — binaire plutôt que gradué, l'annuaire FPGC ne portant pas de notion
    // de cible chiffrée par établissement en dehors de l'onglet Cible auto (qui reste l'écran de
    // référence pour le suivi quantitatif). Les circonscriptions gardent leur marqueur carré dédié,
    // inchangé depuis le 48e/50e échange.
    const cls = e.isCirconscription ? 'circonscription' : (e.formes ? 'forme' : 'neutre');
    // 50e échange : encodage de l'identité de circonscription (couleur cartographique, voir
    // assignCirconscriptionColors dans upsertEtablissementsLocaux) en SECONDAIRE d'un marqueur
    // d'école — le contour (border-color) plutôt que le remplissage, qui reste réservé au statut
    // personnel-formé/neutre ci-dessus. Pour le marqueur d'une circonscription elle-même (carré),
    // c'est l'inverse : la couleur de circonscription EST le remplissage, l'identité est ici
    // l'encodage primaire. Repli sur le rendu neutre existant (--accent, contour blanc) si la
    // couleur n'est pas encore connue (annuaire de l'académie jamais actualisé depuis l'ajout de
    // Couleur_circonscription).
    const styleParts = [];
    if (e.isCirconscription && e.circCouleur) styleParts.push('background:' + e.circCouleur);
    else if (!e.isCirconscription && e.circCouleur) styleParts.push('border-color:' + e.circCouleur);
    const styleAttr = styleParts.length ? (' style="' + styleParts.join(';') + '"') : '';
    // data-lat/data-lon : pas utilisés pour l'affichage (Leaflet positionne le marqueur lui-même) —
    // exposent la position géographique réelle sur l'élément DOM du point, pour permettre à
    // pilotage-smoketest.js de vérifier la géolocalisation sans dépendre des coordonnées écran
    // (qui varient avec le pan/zoom, contrairement à l'ancien positionnement en pourcentage fixe).
    // data-circ-uai/data-circ-couleur : idem, pour vérifier l'attribution de couleur par
    // circonscription sans dépendre du rendu visuel (voir pilotage-smoketest.js, 50e échange).
    // data-formes : idem, pour vérifier l'encodage personnel-formé sans dépendre du rendu.
    // data-uai (51e échange) : identifie l'établissement du point indépendamment de son ordre de
    // tri/insertion — permet à pilotage-smoketest.js de cibler un établissement précis (ex.
    // `[data-uai="0210001A"]`) plutôt que de dépendre de la position du point dans le DOM, qui
    // varie désormais avec le tri par nombre de personnels formés (voir computeData).
    const icon = L.divIcon({
      className: '',
      html: '<div class="map-dot ' + cls + '"' + styleAttr + ' data-lat="' + e.geo.lat + '" data-lon="' + e.geo.lon
        + '" data-circ-uai="' + escapeHtml(e.circUai || '') + '" data-circ-couleur="' + escapeHtml(e.circCouleur || '')
        + '" data-formes="' + e.formes + '" data-uai="' + escapeHtml(e.uai || '') + '"></div>',
      iconSize: [13, 13], iconAnchor: [6.5, 6.5],
    });
    const marker = L.marker([e.geo.lat, e.geo.lon], { icon, title: e.nom, keyboard: true });
    // 53e échange : retrait de la mention de la circonscription de rattachement dans l'infobulle
    // (demande explicite — l'appartenance à une circonscription reste visible par la couleur du
    // contour, voir plus haut, jamais par ce texte) et de la mention « aucun personnel formé »
    // (l'utilisateur déduit déjà cette information de la couleur du point, vert vs gris) — seule
    // l'indication du nombre reste, quand il est non nul (information non déductible de la seule
    // couleur, contrairement à sa simple présence/absence).
    const formesSuffix = (!e.isCirconscription && e.formes) ? (' — ' + e.formes + ' personnel(s) formé(s)') : '';
    marker.bindTooltip(escapeHtml(e.nom) + formesSuffix, { direction: 'top' });
    marker.on('click', () => openEtabPersonnelModal({ nom: e.nom, uai: e.uai || null }));
    marker.addTo(map);
    candidatBounds.push([e.geo.lat, e.geo.lon]);
  });

  // 50e échange : bouton — vrai contrôle Leaflet (comme l'attribution ci-dessus) plutôt qu'un
  // élément HTML statique du bloc, pour rester correctement positionné et cliquable au-dessus du
  // fond de carte sans consommer de hauteur dans le calcul adaptatif du bloc
  // (blockContentHeightPx) ; L.DomEvent.disableClickPropagation évite qu'un clic sur le bouton ne
  // soit interprété comme un clic sur la carte (déplacement/zoom).
  // 52e échange : bouton renommé « Filtres » (fusion de l'ancien filtre par circonscription avec
  // les nouveaux filtres type/secteur/tutelle, voir openCarteFiltersModal) et désormais TOUJOURS
  // présent — l'ancienne condition `if (d.circonscriptions.length)` n'a plus lieu d'être : les
  // filtres type/secteur/tutelle restent pertinents même pour une académie sans aucune
  // circonscription géolocalisée. Id distinct selon l'instance (compacte/plein écran) pour que les
  // tests puissent s'y raccrocher sans ambiguïté quand les deux cartes coexistent dans le DOM.
  const FiltreCarteControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function onAdd() {
      const btn = L.DomUtil.create('button', 'map-filter-btn');
      btn.type = 'button';
      btn.id = isExpanded ? 'btnOuvrirFiltresCarteExpand' : 'btnOuvrirFiltresCarte';
      btn.title = 'Filtrer les établissements affichés sur la carte';
      btn.textContent = 'Filtres';
      L.DomEvent.disableClickPropagation(btn);
      btn.onclick = () => openCarteFiltersModal(d);
      return btn;
    },
  });
  new FiltreCarteControl().addTo(map);

  if (state[viewKey]) {
    map.setView(state[viewKey].center, state[viewKey].zoom);
  } else {
    // Pré-positionnement demandé explicitement (48e échange) : sur le territoire réel de
    // l'académie connectée (tous les établissements/circonscriptions géolocalisés de l'annuaire
    // national local), pas seulement ceux qui ont déjà des candidatures — repli sur ces derniers
    // si l'annuaire de l'académie n'a jamais été actualisé, puis sur une vue France entière.
    const acadBounds = academieGeoBounds();
    if (acadBounds) map.fitBounds(acadBounds, { padding: [24, 24] });
    else if (candidatBounds.length) map.fitBounds(candidatBounds, { padding: [24, 24] });
    else map.setView([46.6, 2.3], 5);
  }
  // 52e échange : la variable de module n'est affectée qu'à la toute fin — voir la note en tête de
  // fonction.
  if (isExpanded) leafletMapExpanded = map; else leafletMap = map;
}

/* ---------------------------------------------------------------------- */
/* Résolution de l'académie courante                                      */
/* ---------------------------------------------------------------------- */

function resolveAcademie() {
  const prefRows = T('Preferences_tableau_bord');
  if (prefRows.length === 1) {
    state.aclScoped = true;
    state.prefRow = prefRows[0];
    state.academieId = prefRows[0].Academie;
  } else if (prefRows.length > 1) {
    // Les règles ACL d'acl-academies.md §20 ne sont pas (encore) appliquées sur ce document
    // (ou ce compte a un accès National/Owner qui voit tout) : repli sur un réglage de
    // confort manuel, sur le même principe que « Mon académie » dans gestion-stage-fpgc.js —
    // ce n'est qu'une commodité d'aperçu, la vraie barrière reste la règle ACL.
    state.aclScoped = false;
    const wanted = state.options.myAcademieId || prefRows[0].Academie;
    state.prefRow = prefRows.find((r) => r.Academie === wanted) || prefRows[0];
    state.academieId = state.prefRow.Academie;
  } else {
    state.aclScoped = false;
    state.prefRow = null;
    state.academieId = null;
  }
  const acadRow = state.academieId ? byId('Reference', state.academieId) : null;
  state.academieNom = acadRow ? acadRow.Academie : '—';
}

// 55e échange : retrait de la fonctionnalité Croisements, remplacée par 3 blocs fixes (voir plus
// bas) — cette fonction ne prend plus de 3e paramètre `croisements` (ni la branche spéciale
// `cx:`/le filtre correspondant, ni la boucle qui ajoutait un bloc par croisement). Une entrée
// `cx:xxx` qui traînerait encore dans une disposition persistée d'un test antérieur disparaît
// désormais silencieusement de `list` (checks['cx:xxx'] vaut toujours `undefined`), sans traitement
// particulier à écrire pour ce cas.
function syncBlocksWithChecks(blocks, checks) {
  let list = blocks.filter((b) => !!checks[b.id]);
  BLOCK_DEFS.forEach((def) => {
    if (checks[def.key] && !list.some((b) => b.id === def.key)) {
      const presetEntry = PRESET_A.filter((p) => p.id === def.key)[0];
      const maxRow = list.reduce((m, b) => Math.max(m, b.row + b.rowSpan - 1), 0);
      list.push(presetEntry ? Object.assign({}, presetEntry) : { id: def.key, col: 1, row: maxRow + 1, colSpan: 2, rowSpan: 1 });
    }
  });
  return list;
}

function loadPrefsIntoState() {
  const row = state.prefRow;
  let checks = Object.assign({}, DEFAULT_CHECKS);
  let blocks = clonePreset(PRESET_A);
  if (row) {
    if (row.BlocsJSON) { try { const c = JSON.parse(row.BlocsJSON); if (c && typeof c === 'object') checks = Object.assign({}, DEFAULT_CHECKS, c); } catch (e) { /* JSON invalide -> défaut */ } }
    // 55e échange : retrait de la fonctionnalité Croisements, remplacée par 3 blocs fixes (voir
    // plus bas) — CroisementsJSON n'est plus jamais lue ici (colonne Grist volontairement
    // conservée, une ligne Preferences_tableau_bord existante peut continuer à la porter avec une
    // ancienne valeur, jamais retirée par la force — voir modele-de-donnees.md).
    if (row.DispositionJSON) { try { const d = JSON.parse(row.DispositionJSON); if (Array.isArray(d) && d.length) blocks = sanitizeGridBlocks(d); } catch (e) { /* défaut : préréglage A */ } }
  }
  state.checks = checks;
  state.blocks = syncBlocksWithChecks(blocks, checks);
  // 46e échange : réglage secteur de la « Cible auto », propre à l'académie (comme BlocsJSON etc.) —
  // 'Public' par défaut sur les 33 lignes pré-remplies (voir modele-de-donnees.md, migration v14).
  state.secteurKey = secteurKeyOf(row);
  // 47e échange : même mécanique pour la tutelle — 'Éducation nationale' par défaut sur les 33 lignes.
  state.tutelleKey = tutelleKeyOf(row);
}

/* ---------------------------------------------------------------------- */
/* Calcul des données affichées                                           */
/* ---------------------------------------------------------------------- */

function computeData() {
  const acadId = state.academieId;
  const annee = currentAnneeScolaire();
  const stages = T('BD_Stages2').filter((s) => s.Academie_de_formation === acadId);
  const stageIds = new Set(stages.map((s) => s.id));
  const stagesClotures = stages.filter((s) => s.Statut_du_stage === 'Clôturé');
  const candidats = T('Candidats_du_stage').filter((c) => stageIds.has(c.Stage));
  const formes = candidats.filter((c) => c.Statut === 'Formé');
  const enAttente = candidats.filter((c) => c.Statut === "Liste d'attente");
  const admin = T('Administration_et_logistique').filter((a) => stageIds.has(a.Reference_de_stage));
  const reponses = admin.filter((a) => a.Taux_de_reponse !== null && a.Taux_de_reponse !== undefined && a.Taux_de_reponse !== '');
  const tauxReponseMoyen = reponses.length ? Math.round(reponses.reduce((s, a) => s + Number(a.Taux_de_reponse || 0), 0) / reponses.length) : null;
  const satisfRows = admin.filter((a) => a.Note_de_satisfaction_moyenne);
  const satisfMoyenne = satisfRows.length ? (satisfRows.reduce((s, a) => s + Number(a.Note_de_satisfaction_moyenne || 0), 0) / satisfRows.length) : null;

  const objectif = T('Objectifs_previsionnels').filter((o) => o.Academie === acadId && o.Annee === annee)[0] || null;
  const stagesPrevu = objectif ? Number(objectif.Stages_prevus || 0) : 0;
  const persPrevu = objectif ? Number(objectif.Personnels_a_former_prevus || 0) : 0;

  const now = new Date();
  const curTrimestre = trimestreLabel(Math.floor(now.getTime() / 1000));
  const stagesProgrammesTrimestre = stages.filter((s) => trimestreLabel(s.Date_de_debut_de_session) === curTrimestre).length;

  // 51e échange : la carte affichait auparavant uniquement les établissements ayant déjà une
  // candidature enregistrée (via Candidats_du_stage) — une académie sans candidature (ou dont les
  // candidatures ne sont pas encore transférées) affichait donc une carte vide, signalé comme un
  // défaut (voir processus-gestion-stage.md, 51e échange). La liste vient désormais de l'annuaire
  // national local (etablissementsLocauxAcademie, déjà utilisé par l'onglet Cible auto), filtrée
  // par les mêmes critères secteur/tutelle que cet onglet : TOUS les établissements réels de
  // l'académie sont représentés, avec ou sans candidature. Le statut mis en évidence (couleur du
  // point) code désormais la présence de personnel formé (Annuaire_FPGC), pas l'avancement d'une
  // candidature — voir mountCarteLeaflet et la légende de renderBlockBody('carte').
  const acadRow = acadId ? byId('Reference', acadId) : null;
  const depts = departementsOfAcademie(acadRow);
  const codeAcademique = acadRow ? String(acadRow.Code_academique || '').trim() : '';
  const deptSet = new Set(depts);
  const etabsJamaisActualise = !!codeAcademique && !T(ETAB_NATIONAL_TABLE).some((r) => (r.Code_academie || '').trim() === codeAcademique);
  const localEtabs = depts.length ? etablissementsLocauxAcademie(codeAcademique, deptSet, state.secteurKey, state.tutelleKey) : [];

  // Personnel formé par établissement : résolution UAI d'abord, repli par nom sinon (voir
  // resolveEtabForPersonnel) — même logique que annuaireFormesParDepartement/computeFonctionCibleData,
  // pour que la carte, le tableau « Cible auto » et la modale par établissement racontent tous la
  // même histoire à partir du même annuaire. etabNationalByNom est restreint à l'académie courante
  // pour limiter le risque de collision entre deux établissements homonymes d'académies différentes.
  const byUaiForFormes = etabNationalByUai();
  const byNomForFormes = etabNationalByNom(codeAcademique);
  const formesParUai = new Map();
  T('Annuaire_FPGC').forEach((r) => {
    // 53e échange : voir matchesAcademieAffectation — comparaison tolérante à la casse/aux accents/
    // aux espaces, remplace l'ancienne égalité stricte de chaîne qui ratait ce genre de variation.
    if (!matchesAcademieAffectation(r, state.academieNom)) return;
    const etabRow = resolveEtabForPersonnel(r, byUaiForFormes, byNomForFormes);
    const uai = etabRow ? normalizeUai(etabRow.UAI) : null;
    if (!uai) return;
    formesParUai.set(uai, (formesParUai.get(uai) || 0) + 1);
  });

  const etabs = localEtabs
    .map((r) => {
      const uai = normalizeUai(r.UAI);
      // 48e échange : une circonscription (UAI administratif plutôt qu'un vrai établissement — voir
      // CIRCONSCRIPTION_NATURE) reste géolocalisée via la même table ; seul cet indicateur change
      // l'affichage (marqueur distinct sur la carte, pas de section « ajustements de cible » dans la
      // modale — voir mountCarteLeaflet et openEtabPersonnelModal).
      const isCirconscription = (r.Libelle_nature || '').trim().toUpperCase() === CIRCONSCRIPTION_NATURE;
      const hasCoords = typeof r.Latitude === 'number' && typeof r.Longitude === 'number';
      const geoStatus = hasCoords ? 'resolu' : 'sans_coordonnees';
      const geo = hasCoords ? { lat: r.Latitude, lon: r.Longitude } : null;
      // 50e échange : couleur/nom de circonscription lus directement depuis la copie locale
      // (colonnes écrites par upsertEtablissementsLocaux — voir assignCirconscriptionColors),
      // jamais recalculés côté affichage : la couleur doit rester la même que celle vue par un
      // utilisateur qui consulterait la table Grist directement (filtre, mise en forme
      // conditionnelle), pas une valeur recalculée à la volée qui pourrait diverger.
      return {
        nom: r.Nom_etablissement || uai || '(établissement sans nom)',
        uai,
        geo, geoStatus, isCirconscription,
        circUai: r.UAI_circonscription || '',
        circNom: r.Nom_circonscription || '',
        circCouleur: safeColor(r.Couleur_circonscription) || '',
        // 51e échange : nombre de personnels formés (Annuaire_FPGC) rattachés à cet établissement —
        // remplace l'ancien couple formés/total issu des candidatures (voir mountCarteLeaflet,
        // renderBlockBody('carte')).
        formes: uai ? (formesParUai.get(uai) || 0) : 0,
        // 52e échange : champs consommés par le filtre d'affichage de la carte (state.mapFilters,
        // voir etabPasseFiltres) — Type_etablissement/Statut_public_prive lus tels quels (mêmes
        // valeurs que TYPES_ETABLISSEMENT/matchesSecteur), tutelleMen pré-calculée une fois ici
        // plutôt qu'à chaque évaluation du filtre.
        type: r.Type_etablissement || '',
        secteur: r.Statut_public_prive || '',
        tutelleMen: isTutelleMen(r),
      };
    })
    // Établissements avec du personnel formé d'abord — ordre stable côté modale de détail par
    // établissement (openEtabPersonnelModal) et côté carte (ordre d'ajout des marqueurs).
    .sort((a, b) => (b.formes - a.formes) || a.nom.localeCompare(b.nom, 'fr'));

  // 53e échange (suite) : deux établissements peuvent partager EXACTEMENT les mêmes coordonnées —
  // cas des « cités scolaires » (par exemple un collège et un lycée sur un même site physique),
  // chacun étant une structure administrative distincte avec son propre UAI mais géocodée au même
  // point par l'annuaire national. Sur la carte Leaflet (voir mountCarteLeaflet), cela produit deux
  // marqueurs parfaitement superposés : seul celui rendu en dernier (au-dessus) reste cliquable,
  // l'autre devient inaccessible au clic bien que ses données restent par ailleurs correctement
  // comptées en agrégat (légende, filtres, Cible auto — tous inchangés ici, ce post-traitement ne
  // touche QUE lat/lon, uniquement pour l'affichage carte). Correction : un léger décalage en
  // cercle autour du point d'origine, réparti entre les établissements du groupe. Décalage
  // DÉTERMINISTE (jamais Math.random()) — décision explicite de l'utilisateur : le même
  // établissement (même UAI) doit toujours recevoir le même décalage d'un rendu à l'autre, faute de
  // quoi un point « sauterait » visuellement à chaque rafraîchissement sans raison fonctionnelle.
  // Le rang dans le groupe est donc dérivé d'un tri stable par UAI (donnée stable de
  // l'établissement), jamais d'un tirage aléatoire.
  const JITTER_RAYON_DEG = 0.00015; // ~15-17 m selon la latitude — sépare visuellement deux
  // marqueurs sans déplacer perceptiblement l'établissement à l'échelle académique.
  const groupesCoordsPartagees = new Map();
  etabs.forEach((e) => {
    if (e.geoStatus !== 'resolu') return;
    const cle = e.geo.lat.toFixed(6) + '|' + e.geo.lon.toFixed(6);
    if (!groupesCoordsPartagees.has(cle)) groupesCoordsPartagees.set(cle, []);
    groupesCoordsPartagees.get(cle).push(e);
  });
  groupesCoordsPartagees.forEach((groupe) => {
    if (groupe.length < 2) return; // point non partagé : jamais touché (ni lat/lon, ni latOriginal/lonOriginal).
    const trie = groupe.slice().sort((a, b) => (a.uai || '').localeCompare(b.uai || ''));
    const n = trie.length;
    trie.forEach((e, i) => {
      const latOrigine = e.geo.lat;
      const lonOrigine = e.geo.lon;
      // Position réelle conservée sur l'entrée (uniquement pour les entrées effectivement
      // décalées) — un futur usage (tooltip, export, debug) peut encore y accéder au besoin.
      e.latOriginal = latOrigine;
      e.lonOriginal = lonOrigine;
      const angle = i * (2 * Math.PI / n);
      // L'entrée d'index 0 reçoit elle aussi un décalage (pas de traitement spécial « le premier
      // reste en place ») — volontaire, pour qu'aucun élément du groupe ne reste « prioritaire »
      // sans raison fonctionnelle.
      const lat = latOrigine + JITTER_RAYON_DEG * Math.cos(angle);
      // Correction de longitude par le cosinus de la latitude : un degré de longitude représente
      // une distance plus courte en s'éloignant de l'équateur — sans cette correction le décalage
      // serait visuellement anisotrope (ellipse plutôt que cercle).
      const lon = lonOrigine + (JITTER_RAYON_DEG * Math.sin(angle)) / Math.cos((latOrigine * Math.PI) / 180);
      e.geo = { lat, lon };
    });
  });

  // 50e échange : liste des circonscriptions distinctes parmi les établissements affichés
  // ci-dessus, pour la légende/le filtre du bloc carte — voir renderBlockBody('carte') et
  // mountCarteLeaflet. Triée par nom pour un affichage stable dans la légende (l'ordre
  // d'attribution des couleurs, lui, reste par département/UAI — voir assignCirconscriptionColors
  // — les deux tris n'ont pas à coïncider).
  const circMap = new Map();
  etabs.forEach((e) => {
    if (e.circUai && !circMap.has(e.circUai)) circMap.set(e.circUai, { uai: e.circUai, nom: e.circNom || e.circUai, couleur: e.circCouleur || '#999999' });
  });
  const circonscriptions = Array.from(circMap.values()).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

  // 54e échange : la tuile « Personnels formés » du tableau de bord confondait deux mécanismes de
  // suivi sans rapport, tous deux nommés « personnels formés »/« personnels prévus » — d.personnelsFormes
  // ci-dessus (candidatures Candidats_du_stage au statut « Formé », rattachées aux stages internes de
  // l'académie/année courante) et d.personnelsPrevu (objectif prévisionnel saisi à la main dans
  // Objectifs_previsionnels), qui n'ont AUCUN lien avec l'annuaire Annuaire_FPGC de l'onglet « Cible
  // auto » — d'où le signalement utilisateur : remplir une fiche Annuaire_FPGC ne faisait jamais
  // bouger cette tuile. computeCibleAutoData()/computeFonctionCibleData() sont des `function`
  // déclarées plus bas dans ce fichier (hoisting JS — appelables ici sans souci d'ordre) : on les
  // invoque pour obtenir le même total « formés »/« cible » que celui déjà correct sur l'onglet Cible
  // auto (fonctions avec ET sans cible confondues pour le numérateur ; seules les lignes à cible non
  // nulle pour le dénominateur, cette valeur intégrant déjà nativement les ajustements par
  // établissement de Cibles_fonction_overrides — voir computeFonctionCibleData, réutilisée telle
  // quelle, sans réimplémenter cette logique). Ces deux nouveaux champs alimentent UNIQUEMENT la
  // tuile « Personnels formés » de computeKpis (voir plus bas) — d.personnelsFormes/d.personnelsPrevu
  // eux-mêmes restent inchangés et continuent d'alimenter computeReperes (« Écart prévisionnel /
  // réalisé — personnels à former »), un KPI distinct et volontairement différent.
  const cibleAutoPourKpi = computeCibleAutoData();
  const fonctionCiblePourKpi = computeFonctionCibleData(cibleAutoPourKpi);
  // 55e échange : correctif double comptage — voir computeFonctionCibleData, Adjoint gestionnaire
  // partagé entre Collège et Lycée. `fonctionCiblePourKpi.rows` construit une ligne PAR COMBINAISON
  // (type d'établissement × fonction) — FONCTION_CIBLE_PAR_TYPE liste 'Adjoint gestionnaire' à la
  // fois pour Collège ET pour Lycée, donc 2 lignes portent chacune le MÊME total académique de
  // formés pour cette fonction (formesParFonction n'est calculé qu'une fois, par nom de fonction,
  // indépendamment du type) — sommer `r.formes` sur `rows` comptait donc deux fois tout « Adjoint
  // gestionnaire » formé. `parFonction` (une entrée par nom de fonction, sans doublon par
  // construction) est la bonne base de sommation pour un total « personnels formés » académie
  // entière. `cible` (le dénominateur), lui, n'a PAS ce problème : il est calculé indépendamment
  // par type à partir d'établissements disjoints (un établissement Collège n'est jamais aussi
  // compté côté Lycée) — reste donc sommé sur `rows`, inchangé.
  const personnelsFormesCibleAuto = fonctionCiblePourKpi.parFonction.reduce((s, r) => s + (r.formes || 0), 0);
  const personnelsACibleAuto = fonctionCiblePourKpi.rows.reduce((s, r) => s + (r.cible === null ? 0 : r.cible), 0);

  // 55e échange : d.repartitionFonction — donnée du bloc donut « Répartition des formés par
  // fonction » (voir renderRepartitionFonctionChart). Une entrée par fonction ayant au moins 1
  // personne formée (les fonctions à 0 formé ne sont pas dessinées), ordonnée selon l'ordre FIXE
  // FONCTION_ORDRE (jamais par valeur décroissante — règle catégorielle de la compétence dataviz).
  // Une fonction absente de FONCTION_ORDRE (donnée inattendue, jamais observée en conditions
  // réelles) est reléguée en fin de liste plutôt que silencieusement ignorée.
  const repartitionFonction = fonctionCiblePourKpi.parFonction
    .filter((r) => r.formes > 0)
    .slice()
    .sort((a, b) => {
      const ia = FONCTION_ORDRE.indexOf(a.fonction);
      const ib = FONCTION_ORDRE.indexOf(b.fonction);
      return (ia === -1 ? FONCTION_ORDRE.length : ia) - (ib === -1 ? FONCTION_ORDRE.length : ib);
    });

  // 55e échange : d.progressionAnnuelle — donnée du bloc combiné « Progression annuelle » (voir
  // renderProgressionAnnuelleChart), une ligne par année scolaire présente parmi les stages de cette
  // académie (`stages`, déjà filtré par académie ci-dessus, TOUTES années confondues — contrairement
  // au reste de ce fichier qui ne porte que sur `annee` = currentAnneeScolaire()). Même logique
  // exacte que stagesRealises/personnelsFormes ci-dessus (Statut_du_stage === 'Clôturé' /
  // Candidats_du_stage.Statut === 'Formé'), simplement étendue à toutes les années plutôt qu'une
  // seule — `candidats` est déjà l'ensemble des candidatures rattachées aux stages de cette académie
  // (stageIds), toutes années confondues, réutilisé tel quel.
  const stageAnneeScolaire = new Map();
  stages.forEach((s) => { stageAnneeScolaire.set(s.id, anneeScolaireDeEpoch(s.Date_de_debut_de_session)); });
  const statsParAnneeScolaire = new Map();
  stages.forEach((s) => {
    const a = stageAnneeScolaire.get(s.id);
    if (!a) return;
    if (!statsParAnneeScolaire.has(a)) statsParAnneeScolaire.set(a, { stagesRealises: 0, personnesFormees: 0 });
    if (s.Statut_du_stage === 'Clôturé') statsParAnneeScolaire.get(a).stagesRealises += 1;
  });
  candidats.forEach((c) => {
    const a = stageAnneeScolaire.get(c.Stage);
    if (!a || !statsParAnneeScolaire.has(a)) return;
    if (c.Statut === 'Formé') statsParAnneeScolaire.get(a).personnesFormees += 1;
  });
  // Tri chronologique croissant sur l'étiquette elle-même — un tri de chaîne classique suffit tant
  // que les années sont sur 4 chiffres ("2023-2024" précède bien "2024-2025" alphabétiquement).
  const progressionAnnuelle = Array.from(statsParAnneeScolaire.entries())
    .map(([anneeLabel, v]) => ({ annee: anneeLabel, stagesRealises: v.stagesRealises, personnesFormees: v.personnesFormees }))
    .sort((a, b) => (a.annee < b.annee ? -1 : (a.annee > b.annee ? 1 : 0)));

  return {
    annee, stages, candidats, admin,
    stagesRealises: stagesClotures.length, stagesTotal: stages.length, stagesPrevu,
    personnelsFormes: formes.length, personnelsPrevu: persPrevu,
    personnelsFormesCibleAuto, personnelsACibleAuto,
    tauxReponseMoyen, satisfMoyenne,
    candidatsEnAttente: enAttente.length,
    stagesProgrammesTrimestre,
    etabs,
    circonscriptions,
    // 51e échange : distinguent, pour la légende du bloc carte, « aucun établissement à afficher »
    // de ses deux causes possibles — voir renderBlockBody('carte').
    etabsDeptsManquants: !depts.length,
    etabsJamaisActualise,
    // 55e échange : cibleAuto/fonctionCible calculés une seule fois ci-dessus, exposés ici pour être
    // réutilisés par renderCibleTab(d) et le nouveau bloc « Taux de formation par département »
    // (tauxParDepartement) sans les recalculer une 2e/3e fois par rendu.
    cibleAuto: cibleAutoPourKpi,
    fonctionCible: fonctionCiblePourKpi,
    repartitionFonction,
    progressionAnnuelle,
  };
}

/* ---------------------------------------------------------------------- */
/* 46e échange — Cible auto par établissement                            */
/* ---------------------------------------------------------------------- */

// Numérateur : personnels déjà consolidés dans Annuaire_FPGC (transferToAnnuaire les y place au
// moment de leur qualification — toute ligne de cette table compte donc comme « formée »), filtrés
// sur l'académie d'affectation courante puis regroupés par département.
//
// 51e échange : le département venait auparavant des 3 premiers caractères du code UAI saisi sur
// la ligne d'annuaire — or la migration du 45e échange a laissé 0 ligne sur 11 857 avec un UAI
// renseigné (9 371 avec seulement un nom, 2 486 sans rien), si bien que la quasi-totalité de
// l'annuaire existant ne comptait jamais ici (signalé par l'utilisateur : « Personnels formés » à
// zéro même après avoir complété une fiche existante). Le département vient désormais de
// l'établissement résolu par resolveEtabForPersonnel (UAI, puis repli par nom — voir plus haut),
// via sa colonne Code_departement dans l'annuaire national local. Les lignes qui ne peuvent être
// rattachées par aucune des deux voies sont comptées à part (`nonRattaches`) plutôt que d'être
// silencieusement ignorées — voir computeCibleAutoData, qui les expose dans son résumé.
function annuaireFormesParDepartement(academieNom, codeAcademique) {
  const byUai = etabNationalByUai();
  const byNom = etabNationalByNom(codeAcademique);
  const parDept = new Map();
  const nonRattaches = [];
  T('Annuaire_FPGC').forEach((r) => {
    // 53e échange : voir matchesAcademieAffectation — comparaison tolérante à la casse/aux accents/
    // aux espaces, remplace l'ancienne égalité stricte de chaîne qui ratait ce genre de variation.
    if (!matchesAcademieAffectation(r, academieNom)) return;
    const etabRow = resolveEtabForPersonnel(r, byUai, byNom);
    const dept = etabRow ? String(etabRow.Code_departement || '').trim() : '';
    if (!dept) { nonRattaches.push(r); return; }
    if (!parDept.has(dept)) parDept.set(dept, []);
    parDept.get(dept).push(r);
  });
  return { parDept, nonRattaches };
}

// 47e échange : le dénominateur (établissements réels) vient de la copie locale
// Etablissements_education_nationale, filtrée par département/secteur/tutelle — plus d'appel
// réseau ni d'état « en attente » : la lecture est synchrone, comme pour toute autre table Grist.
// `jamaisActualise` distingue « aucun établissement dans cette académie » (le vrai cas 0) de
// « l'annuaire de cette académie n'a jamais été actualisé » (voir le bouton de l'onglet Paramètres).
function etablissementsLocauxAcademie(codeAcademique, deptSet, secteurKey, tutelleKey) {
  return T(ETAB_NATIONAL_TABLE).filter((r) => {
    if (!r.Actif) return false;
    if (!deptSet.has((r.Code_departement || '').trim())) return false;
    return matchesSecteur(r, secteurKey) && matchesTutelle(r, tutelleKey);
  });
}

function computeCibleAutoData() {
  const acadRow = state.academieId ? byId('Reference', state.academieId) : null;
  const depts = departementsOfAcademie(acadRow);
  const secteurKey = state.secteurKey;
  const tutelleKey = state.tutelleKey;
  const codeAcademique = acadRow ? String(acadRow.Code_academique || '').trim() : '';
  if (!depts.length) return { depts: [], rows: [], totalEtabs: 0, totalFormes: 0, nonRattachesFormes: 0, secteurKey, tutelleKey, codeAcademique, jamaisActualise: false, localEtabs: [] };
  const jamaisActualise = !!codeAcademique && !T(ETAB_NATIONAL_TABLE).some((r) => (r.Code_academie || '').trim() === codeAcademique);
  const deptSet = new Set(depts);
  const localEtabs = etablissementsLocauxAcademie(codeAcademique, deptSet, secteurKey, tutelleKey);
  const { parDept: formesParDept, nonRattaches } = annuaireFormesParDepartement(state.academieNom, codeAcademique);
  // 55e échange : ajustements par établissement (Cibles_fonction_overrides) calculés UNE FOIS avant
  // la boucle sur les départements ci-dessous, plutôt que redemandés à chaque département — sert au
  // nouveau champ `cible` par département (voir plus bas), pour le bloc « Taux de formation par
  // département » (renderTauxParDepartementChart) et la tuile KPI « Cible auto » du tableau de bord.
  const overridesPourCibleDept = overridesByKeyForAcademie(state.academieId);
  const rows = depts.map((dept) => {
    const rowsDept = localEtabs.filter((r) => (r.Code_departement || '').trim() === dept);
    const total1er = rowsDept.filter((r) => r.Type_etablissement === 'Ecole').length;
    const total2nd = rowsDept.filter((r) => r.Type_etablissement === 'Collège' || r.Type_etablissement === 'Lycée').length;
    const formes = (formesParDept.get(dept) || []).length;
    const libelleRow = rowsDept.filter((r) => r.Libelle_departement)[0];
    // 55e échange : cible du département = somme, pour chaque établissement de ce département, du
    // nombre de postes cibles pour les fonctions de son type (FONCTION_CIBLE_PAR_TYPE), en tenant
    // compte des ajustements par établissement — même règle exacte que computeFonctionCibleData
    // (« 1 poste cible par établissement et par fonction du type concerné, sauf ajustement »),
    // appliquée établissement par établissement plutôt qu'agrégée par fonction académie entière.
    const cible = rowsDept.reduce((sum, e) => {
      const fonctions = FONCTION_CIBLE_PAR_TYPE[e.Type_etablissement] || [];
      const uai = normalizeUai(e.UAI);
      return sum + fonctions.reduce((s2, fonction) => {
        const ov = uai ? overridesPourCibleDept.get(uai + '|' + fonction) : null;
        return s2 + (ov ? Number(ov.Cible || 0) : 1);
      }, 0);
    }, 0);
    return {
      dept, libelle: libelleRow ? libelleRow.Libelle_departement : null,
      total1erDegre: total1er, total2ndDegre: total2nd, totalEtabs: total1er + total2nd,
      formes, cible,
    };
  });
  const totalEtabs = rows.reduce((s, r) => s + r.totalEtabs, 0);
  const totalFormes = rows.reduce((s, r) => s + r.formes, 0);
  // 51e échange : personnels de l'annuaire de cette académie qu'aucune des deux résolutions
  // (UAI, puis nom) n'a pu rattacher à un établissement du périmètre actuel — surfacé plutôt que
  // silencieusement absent des totaux ci-dessus, voir renderCibleTab.
  return { depts, rows, totalEtabs, totalFormes, nonRattachesFormes: nonRattaches.length, secteurKey, tutelleKey, codeAcademique, jamaisActualise, localEtabs };
}

// Ventilation par fonction (46e échange), étendue au 47e échange pour honorer les ajustements par
// établissement de Cibles_fonction_overrides : la cible par défaut reste 1 poste/établissement,
// mais chaque établissement peut porter une valeur absolue différente pour une fonction donnée
// (« Valeur absolue », tranché par AskUserQuestion) — formés = personnes d'Annuaire_FPGC de cette
// académie avec cette Fonction, tous départements de l'académie confondus (Autre : formés affichés,
// cible « — », voir FONCTIONS_SANS_CIBLE ; 56e échange, Secrétaire général a désormais une cible,
// voir FONCTION_CIBLE_PAR_TYPE).
function overridesByKeyForAcademie(academieId) {
  const map = new Map();
  T(OVERRIDES_TABLE).forEach((o) => {
    if (o.Academie !== academieId) return;
    const uai = normalizeUai(o.UAI_etablissement);
    // 56e échange : normalizeFonction — une ligne Cibles_fonction_overrides déjà saisie avant le
    // renommage peut encore porter littéralement « Adjoint gestionnaire » ; sans cette
    // normalisation, la clé de cette Map (uai + '|' + fonction) ne correspondrait jamais à celle
    // recherchée par computeCibleAutoData/computeFonctionCibleData (qui utilisent désormais
    // 'Secrétaire général', voir FONCTION_CIBLE_PAR_TYPE) et l'ajustement disparaîtrait
    // silencieusement.
    const fonction = normalizeFonction(o.Fonction);
    if (!uai || !fonction) return;
    map.set(uai + '|' + fonction, o);
  });
  return map;
}

// 51e échange : ce comptage exigeait auparavant un UAI valide ET dans un département de
// l'académie (`deptSet.has(uai.slice(0,3))`) — or la quasi-totalité des lignes historiques
// d'Annuaire_FPGC n'ont jamais eu d'UAI renseigné (migration 45e échange : 0/11 857), donc ajouter
// une Fonction à une personne déjà présente dans l'annuaire ne faisait jamais passer ce filtre
// (signalé par l'utilisateur). Ce compteur n'a en réalité besoin que de l'académie d'affectation et
// d'une Fonction non vide — le rattachement précis à un établissement (UAI ou nom) ne sert qu'au
// détail par établissement (voir computeData, annuaireFormesParDepartement), pas à ce total par
// fonction, académie entière.
function computeFonctionCibleData(cibleAuto) {
  if (!cibleAuto.depts.length) return { rows: [], parFonction: [], jamaisActualise: cibleAuto.jamaisActualise };
  const formesParFonction = new Map();
  T('Annuaire_FPGC').forEach((r) => {
    // 53e échange : voir matchesAcademieAffectation — comparaison tolérante à la casse/aux accents/
    // aux espaces, remplace l'ancienne égalité stricte de chaîne qui ratait ce genre de variation
    // (cause confirmée du signalement utilisateur : « Personnels formés » ne se mettant pas à jour).
    if (!matchesAcademieAffectation(r, state.academieNom)) return;
    // 56e échange : normalizeFonction — une ligne Annuaire_FPGC déjà saisie avant le renommage
    // « Adjoint gestionnaire » -> « Secrétaire général » peut encore porter littéralement l'ancien
    // libellé ; sans cette normalisation, elle formerait sa propre entrée distincte dans cette Map
    // au lieu d'être comptée avec le reste de « Secrétaire général » (numérateur de la tuile
    // « Personnels formés », ligne du tableau « Cible auto » et segment du bloc donut, voir
    // computeData).
    const fonction = normalizeFonction(r.Fonction);
    if (!fonction) return;
    formesParFonction.set(fonction, (formesParFonction.get(fonction) || 0) + 1);
  });
  const overrides = overridesByKeyForAcademie(state.academieId);
  const rows = [];
  TYPES_ETABLISSEMENT.forEach((type) => {
    const etabsOfType = cibleAuto.localEtabs.filter((r) => r.Type_etablissement === type);
    (FONCTION_CIBLE_PAR_TYPE[type] || []).forEach((fonction) => {
      let cible = 0;
      let ajustes = 0;
      etabsOfType.forEach((e) => {
        const uai = normalizeUai(e.UAI);
        const ov = uai ? overrides.get(uai + '|' + fonction) : null;
        if (ov) { cible += Number(ov.Cible || 0); ajustes += 1; } else cible += 1;
      });
      rows.push({ type, fonction, cible, formes: formesParFonction.get(fonction) || 0, ajustes });
    });
  });
  FONCTIONS_SANS_CIBLE.forEach((fonction) => {
    const formes = formesParFonction.get(fonction) || 0;
    if (formes) rows.push({ type: null, fonction, cible: null, formes, ajustes: 0 });
  });
  // 55e échange : `formesParFonction` (un total par nom de fonction, déjà sans doublon par
  // construction — une seule Map, indépendante du type d'établissement) est désormais EXPOSÉE dans
  // la valeur de retour, en plus de `rows` — voir computeData (correctif du double comptage de
  // personnelsFormesCibleAuto, une fonction comme « Adjoint gestionnaire » produisant 2 lignes dans
  // `rows`, une par type d'établissement Collège/Lycée, portant chacune le MÊME total) et
  // renderRepartitionFonctionChart (bloc donut « Répartition des formés par fonction »).
  const parFonction = Array.from(formesParFonction.entries()).map(([fonction, formes]) => ({ fonction, formes }));
  return { rows, parFonction, jamaisActualise: cibleAuto.jamaisActualise };
}

function computeKpis(d) {
  const tS = pct(d.stagesRealises, d.stagesPrevu);
  // 54e échange : la tuile « Personnels formés » utilise désormais le total de l'onglet Cible auto
  // (d.personnelsFormesCibleAuto/d.personnelsACibleAuto, voir computeData) — plus le mécanisme
  // Candidats_du_stage/Objectifs_previsionnels (d.personnelsFormes/d.personnelsPrevu), qui reste en
  // revanche inchangé pour computeReperes juste en dessous (KPI distinct, volontairement différent).
  const tCA = pct(d.personnelsFormesCibleAuto, d.personnelsACibleAuto);
  return [
    { label: 'Stages clôturés', value: d.stagesRealises + (d.stagesPrevu ? ' / ' + d.stagesPrevu : ''), sub: d.stagesPrevu ? (tS + ' % du prévisionnel') : 'Aucun objectif renseigné', subClass: d.stagesPrevu ? statusFromTaux(tS) : 'neutre' },
    { label: 'Personnels formés', value: formatNombreFr(d.personnelsFormesCibleAuto) + ' / ' + formatNombreFr(d.personnelsACibleAuto), sub: d.personnelsACibleAuto ? (tCA + ' % de la cible automatique') : 'Cible automatique non calculable', subClass: d.personnelsACibleAuto ? statusFromTaux(tCA) : 'neutre' },
    { label: 'Taux de réponse enquêtes', value: d.tauxReponseMoyen === null ? '—' : d.tauxReponseMoyen + ' %', sub: d.tauxReponseMoyen === null ? 'Aucune donnée' : statusLabel(statusFromTaux(d.tauxReponseMoyen)), subClass: d.tauxReponseMoyen === null ? 'neutre' : statusFromTaux(d.tauxReponseMoyen) },
    { label: 'Satisfaction moyenne', value: d.satisfMoyenne === null ? '—' : d.satisfMoyenne.toFixed(1) + ' / 5', sub: 'Enquêtes de fin de stage', subClass: 'neutre' },
  ];
}

function computeReperes(d) {
  const tS = pct(d.stagesRealises, d.stagesPrevu);
  const tP = pct(d.personnelsFormes, d.personnelsPrevu);
  const attStatus = d.candidatsEnAttente <= 2 ? 'bon' : (d.candidatsEnAttente <= 6 ? 'surveiller' : 'critique');
  const reponseStatus = d.tauxReponseMoyen === null ? 'neutre' : statusFromTaux(d.tauxReponseMoyen);
  return [
    { label: 'Taux de réponse aux enquêtes de satisfaction', note: 'Seuil : bon ≥ 70 %', value: d.tauxReponseMoyen === null ? '—' : d.tauxReponseMoyen + ' %', statusClass: reponseStatus, statusLabel: statusLabel(reponseStatus) },
    { label: "Candidatures en liste d'attente", note: 'Seuil : critique > 6', value: String(d.candidatsEnAttente), statusClass: attStatus, statusLabel: statusLabel(attStatus) },
    { label: 'Écart prévisionnel / réalisé — stages', note: d.stagesPrevu ? (tS + ' % de réalisation') : 'Aucun objectif renseigné', value: d.stagesPrevu ? (Math.max(0, d.stagesPrevu - d.stagesRealises) + ' restants') : '—', statusClass: d.stagesPrevu ? statusFromTaux(tS) : 'neutre', statusLabel: d.stagesPrevu ? statusLabel(statusFromTaux(tS)) : '—' },
    { label: 'Écart prévisionnel / réalisé — personnels à former', note: d.personnelsPrevu ? (tP + ' % de réalisation') : 'Aucun objectif renseigné', value: d.personnelsPrevu ? (Math.max(0, d.personnelsPrevu - d.personnelsFormes) + ' restants') : '—', statusClass: d.personnelsPrevu ? statusFromTaux(tP) : 'neutre', statusLabel: d.personnelsPrevu ? statusLabel(statusFromTaux(tP)) : '—' },
    { label: 'Stages programmés ce trimestre', note: 'Toutes catégories confondues', value: String(d.stagesProgrammesTrimestre), statusClass: d.stagesProgrammesTrimestre > 0 ? 'bon' : 'surveiller', statusLabel: statusLabel(d.stagesProgrammesTrimestre > 0 ? 'bon' : 'surveiller') },
  ];
}

// 55e échange : retrait de la fonctionnalité Croisements, remplacée par 3 blocs fixes (voir plus
// bas) — computeCroisement (calcul d'un croisement dimension × mesure choisi par l'utilisateur)
// n'a plus d'appelant.

/* ---------------------------------------------------------------------- */
/* 55e échange, remplacée au 61e échange — 3 blocs fixes de tableau de     */
/* bord. Rendus jusqu'ici en SVG inline fait main (seule dépendance de     */
/* graphique du widget étant Leaflet, pour la carte) ; remplacés au 61e    */
/* échange par Chart.js (demande explicite), désormais seconde dépendance  */
/* CDN du widget — voir pilotage-academique.html pour le tag <script> et   */
/* processus-gestion-stage.md, 61e échange, pour la discussion complète.   */
/* Design préservé à l'identique (compétence dataviz) : palette            */
/* catégorielle fixe validée par scripts/validate_palette.js (voir         */
/* FONCTION_ORDRE plus haut), aucun double axe Y, légende HTML toujours    */
/* présente dès 2 séries avec libellé ET valeur en clair (jamais la seule  */
/* couleur), étiquette de valeur au bout de chaque barre et au dernier     */
/* point de chaque courbe. Les couleurs, définies en variables CSS (mode   */
/* clair/sombre géré par le CSS existant), sont résolues en JS via         */
/* cssVar() — un canvas ne sait pas interpréter var(--x) lui-même.         */
/* Dégradation gracieuse si le CDN Chart.js ne charge pas : voir           */
/* `typeof Chart === 'undefined'` dans mountCharts, même principe que      */
/* mountCarteLeaflet pour Leaflet — non vérifiable dans le bac à sable de  */
/* test Playwright pour la même raison réseau (voir CHART_SKIP_REASON      */
/* dans pilotage-smoketest.js) ; en revanche les fonctions pures           */
/* chartConfigXxx ci-dessous (qui ne touchent jamais `Chart`) restent      */
/* entièrement vérifiables — c'est délibérément pour cela qu'elles sont    */
/* séparées de mountCharts, qui seul appelle `new Chart(...)`.             */
/* ---------------------------------------------------------------------- */

// Résout une variable CSS custom property en couleur concrète — nécessaire pour Chart.js, qui
// dessine sur un <canvas> et ne peut donc pas interpréter une chaîne "var(--x)" comme le ferait un
// attribut de présentation SVG/CSS. Lu sur documentElement (les tokens sont définis sur :root et
// @media (prefers-color-scheme: dark) — voir pilotage-academique.html) : reflète toujours le thème
// actif au moment de l'appel.
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Couleur catégorielle d'une fonction, même règle FONCTION_ORDRE/repli que dans les légendes
// existantes (index -1 ou hors liste -> dernière teinte de la palette).
function fonctionColorVar(fonction) {
  const idx = FONCTION_ORDRE.indexOf(fonction);
  return cssVar('--fonction-color-' + (idx === -1 ? (FONCTION_ORDRE.length - 1) : idx));
}

// Couleur de statut (bon/surveiller/critique/neutre) — mêmes jetons --ok/--warn/--danger/
// --text-muted que statusFromTaux/statusLabel utilisent déjà ailleurs dans ce widget (badges,
// repere-dot, map-dot) : pas une nouvelle échelle de couleur introduite pour Chart.js.
function statusColorVar(status) {
  if (status === 'bon') return cssVar('--ok');
  if (status === 'surveiller') return cssVar('--warn');
  if (status === 'critique') return cssVar('--danger');
  return cssVar('--text-muted');
}

// Plugin Chart.js : texte central du donut (total + libellé), dans le trou de l'anneau — Chart.js
// n'a pas de fonctionnalité native pour ça (contrairement au <text> qu'on pouvait placer librement
// dans le SVG fait main). N'agit que si options.plugins.centerText est fourni par le graphique
// courant (voir chartConfigRepartitionFonction) — sans effet sur les 2 autres graphiques.
const CENTER_TEXT_PLUGIN = {
  id: 'centerText',
  afterDraw(chart) {
    const opts = chart.config.options.plugins && chart.config.options.plugins.centerText;
    if (!opts) return;
    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cssVar('--text') || '#1e1e28';
    ctx.font = "700 17px 'IBM Plex Mono', ui-monospace, monospace";
    ctx.fillText(String(opts.total), cx, cy - 7);
    ctx.fillStyle = cssVar('--text-muted') || '#5d5d6b';
    ctx.font = "7px 'Work Sans', system-ui, sans-serif";
    ctx.fillText(opts.label || '', cx, cy + 8);
    ctx.restore();
  },
};

// Plugin Chart.js : étiquettes de valeur réelle — « value at the tip » sur chaque barre, « value at
// the end » (dernier point seulement, jamais un nombre par point) sur une courbe — spec de marque de
// la compétence dataviz, reprise à l'identique du SVG fait main. Chaque dataset porte ses propres
// `_raw` (valeurs réelles, potentiellement différentes des valeurs indexées/normalisées tracées —
// voir chartConfigProgressionAnnuelle) et `_labelFormatter` ; un dataset qui n'en porte pas
// (répartitionFonction, qui utilise son propre plugin centerText) est ignoré silencieusement.
const VALUE_LABELS_PLUGIN = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    chart.data.datasets.forEach((ds, dsIndex) => {
      if (!ds._raw || !ds._labelFormatter) return;
      const meta = chart.getDatasetMeta(dsIndex);
      if (meta.hidden) return;
      ctx.save();
      ctx.textAlign = 'center';
      if (ds.type === 'line') {
        if (ds._lastOnly) {
          const i = meta.data.length - 1;
          if (i >= 0) {
            const pt = meta.data[i];
            ctx.fillStyle = cssVar('--text') || '#1e1e28';
            ctx.font = "700 7.5px 'Work Sans', system-ui, sans-serif";
            ctx.textAlign = 'left';
            ctx.fillText(ds._labelFormatter(ds._raw[i]), pt.x + 5, pt.y - 5);
          }
        }
      } else {
        ctx.fillStyle = cssVar('--text-muted') || '#5d5d6b';
        ctx.font = "7px 'Work Sans', system-ui, sans-serif";
        meta.data.forEach((bar, i) => {
          ctx.fillText(ds._labelFormatter(ds._raw[i]), bar.x, bar.y - 4);
        });
      }
      ctx.restore();
    });
  },
};

// Enregistrement global des 2 plugins ci-dessus — sans effet sur un graphique qui ne renseigne pas
// leurs options/champs (voir les gardes en tête de chaque plugin), donc sûr à enregistrer une seule
// fois pour les 3 graphiques du widget. Gardé par `typeof Chart !== 'undefined'`, comme tout usage
// de Chart.js dans ce fichier (voir mountCharts) — absent si le CDN n'a pas pu charger.
if (typeof Chart !== 'undefined') {
  Chart.register(CENTER_TEXT_PLUGIN, VALUE_LABELS_PLUGIN);
}

// C1 — bloc « Répartition des formés par fonction » (anneau/donut). `rows` : d.repartitionFonction
// (voir computeData), déjà filtré aux fonctions avec >= 1 formé et ordonné selon FONCTION_ORDRE
// (ordre FIXE, jamais recalé par valeur — règle catégorielle de la compétence dataviz : « color
// follows the entity, never its rank »). Fonction PURE (ne touche jamais `Chart`) : construit
// seulement l'objet de config, testable même quand Chart.js n'est pas chargé — voir la note en tête
// de fichier. Le rendu effectif (new Chart(...)) est délégué à mountCharts.
function chartConfigRepartitionFonction(rows) {
  const total = rows.reduce((s, r) => s + r.formes, 0);
  return {
    type: 'doughnut',
    data: {
      labels: rows.map((r) => r.fonction),
      datasets: [{
        data: rows.map((r) => r.formes),
        backgroundColor: rows.map((r) => fonctionColorVar(r.fonction)),
        // 2px de séparation entre segments (règle des « spacers » de la compétence dataviz) :
        // approximée ici par une bordure de la couleur de la surface du bloc plutôt qu'un
        // stroke-dasharray comme dans l'ancien SVG — même effet visuel de coupure entre segments.
        borderColor: cssVar('--surface') || '#ffffff',
        borderWidth: 2,
        hoverOffset: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        // Légende HTML custom dédiée (voir renderRepartitionFonctionChart) — jamais la légende
        // intégrée de Chart.js, pour garder la valeur absolue en clair à côté de chaque libellé
        // (règle de la compétence dataviz : jamais la seule couleur pour porter l'information).
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.label + ' : ' + ctx.parsed + (total ? ' (' + Math.round((ctx.parsed / total) * 100) + ' %)' : ''),
          },
        },
        centerText: { total: total, label: 'formé(s)' },
      },
    },
  };
}

// Légende du donut — identique à l'ancienne légende SVG (libellé + valeur absolue par fonction).
function legendRepartitionFonctionHtml(rows) {
  return '<ul class="viz-legend">' + rows.map((r) => {
    const idx = FONCTION_ORDRE.indexOf(r.fonction);
    const colorClass = 'fonction-color-' + (idx === -1 ? (FONCTION_ORDRE.length - 1) : idx);
    return '<li><span class="viz-swatch ' + colorClass + '"></span>'
      + '<span class="viz-legend-label">' + escapeHtml(r.fonction) + '</span>'
      + '<span class="viz-legend-value">' + r.formes + '</span></li>';
  }).join('') + '</ul>';
}

// Bloc HTML complet (conteneur + <canvas> + légende) — même structure/classes que l'ancien wrapper
// SVG (voir la note « position: relative » ajoutée sur .viz-donut-svg dans pilotage-academique.html,
// requise par le redimensionnement responsive de Chart.js).
function renderRepartitionFonctionChart(rows) {
  const canvasHtml = '<canvas id="chartRepartitionFonction" role="img" '
    + 'aria-label="Répartition des personnels formés par fonction"></canvas>';
  return '<div class="viz-donut-wrap"><div class="viz-donut-svg">' + canvasHtml + '</div>'
    + '<div class="viz-legend-wrap">' + legendRepartitionFonctionHtml(rows) + '</div></div>';
}

// C2 — bloc « Progression annuelle » (histogramme + courbe combinés). `rows` : d.progressionAnnuelle
// (voir computeData), une ligne par année scolaire, triée chronologiquement.
//
// Choix de mesure barres/courbe : stages réalisés en barres, personnels formés en courbe — les
// stages (dénominateur d'un décompte d'événements discrets, un par session) se prêtent mieux à une
// colonne ; les personnels formés (un flux cumulé de personnes) se lisent bien en tendance. Le choix
// inverse serait tout aussi défendable, celui-ci est documenté ici pour la traçabilité.
//
// Double axe Y : ÉCARTÉ (voir references/anti-patterns.md et choosing-a-form.md de la compétence
// dataviz — « Dual-axis charts », le mistake #1 le plus fréquent : deux échelles superposées
// inventent une corrélation qui n'est pas dans la donnée). Les deux séries sont indexées sur leur
// PROPRE maximum affiché (0-100 % de ce maximum), sur UN SEUL axe partagé (Chart.js `y`, un seul
// `scales.y`), plutôt que sur la valeur de la première année (« =100 au point de départ », la
// variante la plus classique suggérée par la compétence) : une année scolaire peut légitimement
// compter 0 stage clôturé, ce qui rendrait cette indexation-là indéfinie si elle tombait sur la
// première année de la série. Chaque mesure garde sa valeur brute en clair (étiquette sur chaque
// barre — « value at the tip », spec de marque bar — et valeur au bout de la courbe — « value at the
// end », spec de marque line, dessinées par VALUE_LABELS_PLUGIN à partir des `_raw`/
// `_labelFormatter` ci-dessous — les DONNÉES TRACÉES restent les pourcentages indexés, jamais les
// valeurs réelles) : jamais un pourcentage seul sans le nombre réel derrière (le tooltip lit lui
// aussi `_raw`, jamais la valeur indexée). Légende HTML custom obligatoire (2 séries), avec une note
// explicite sur la courbe indexée (pas de sous-entendu de comparabilité directe avec l'échelle des
// barres) — jamais la légende intégrée de Chart.js, trop courte pour cette note.
function chartConfigProgressionAnnuelle(rows) {
  const stagesMax = Math.max(1, ...rows.map((r) => r.stagesRealises));
  const personnesMax = Math.max(1, ...rows.map((r) => r.personnesFormees));
  // "2023-2024" -> "2023-24" (2 derniers chiffres), compact et lisible — même abréviation que l'ancien SVG.
  const labels = rows.map((r) => r.annee.replace(/-\d{2}(\d{2})$/, '-$1'));
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Stages réalisés',
          data: rows.map((r) => (r.stagesRealises / stagesMax) * 100),
          backgroundColor: fonctionColorVar(FONCTION_ORDRE[0]),
          borderRadius: 3,
          borderSkipped: false,
          maxBarThickness: 24,
          _raw: rows.map((r) => r.stagesRealises),
          _labelFormatter: (v) => String(v),
        },
        {
          type: 'line',
          label: 'Personnels formés',
          data: rows.map((r) => (r.personnesFormees / personnesMax) * 100),
          borderColor: fonctionColorVar(FONCTION_ORDRE[1]),
          backgroundColor: fonctionColorVar(FONCTION_ORDRE[1]),
          pointRadius: 4,
          pointBackgroundColor: fonctionColorVar(FONCTION_ORDRE[1]),
          pointBorderColor: cssVar('--surface') || '#ffffff',
          pointBorderWidth: 2,
          borderWidth: 2,
          tension: 0,
          _raw: rows.map((r) => r.personnesFormees),
          _labelFormatter: (v) => String(v),
          // « Lines -> value at the end » (spec de marque de la compétence dataviz) : seule la
          // dernière valeur est étiquetée directement sur la courbe (jamais un nombre par point).
          _lastOnly: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false }, ticks: { color: cssVar('--text-muted'), font: { size: 9 } } },
        y: {
          min: 0, max: 100,
          ticks: { stepSize: 50, color: cssVar('--text-muted'), font: { size: 9 }, callback: (v) => v + ' %' },
          grid: { color: cssVar('--border') },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.dataset.label + ' : ' + ctx.dataset._raw[ctx.dataIndex],
          },
        },
      },
    },
  };
}

function legendProgressionAnnuelleHtml() {
  return '<ul class="viz-legend viz-legend-row">'
    + '<li><span class="viz-swatch fonction-color-0"></span><span class="viz-legend-label">Stages réalisés</span></li>'
    + '<li><span class="viz-swatch fonction-color-1"></span><span class="viz-legend-label">Personnels formés (courbe indexée sur son propre maximum affiché — non comparable en valeur absolue à l’échelle des barres ; valeurs réelles en clair sur le graphique)</span></li>'
    + '</ul>';
}

function renderProgressionAnnuelleChart() {
  const canvasHtml = '<canvas id="chartProgressionAnnuelle" role="img" '
    + 'aria-label="Progression annuelle — stages réalisés et personnels formés"></canvas>';
  return '<div class="viz-combo-wrap"><div class="viz-combo-svg">' + canvasHtml + '</div>' + legendProgressionAnnuelleHtml() + '</div>';
}

// C3 — bloc « Taux de formation par département » (barres). `rows` : d.cibleAuto.rows (voir
// computeCibleAutoData, étendu 55e échange avec le champ `cible`), une ligne par département.
//
// Tri retenu : par taux CROISSANT (département le moins couvert en premier), pas alphabétique ni
// décroissant — un tableau de pilotage doit faire ressortir en premier les départements qui ont le
// plus besoin d'attention, cohérent avec le reste du widget (repères de pilotage, codes couleur
// bon/à surveiller/critique). Couleur de barre : statusFromTaux (même fonction, mêmes seuils que
// partout ailleurs dans ce widget) — pas une nouvelle échelle de couleur.
function sortedTauxParDepartement(rows) {
  return rows.map((r) => Object.assign({}, r, { taux: pct(r.formes, r.cible) }))
    .sort((a, b) => {
      // Un département sans cible calculable (cible = 0, taux null) apparaît en tête, à égalité
      // avec un taux de 0 % — dans les deux cas, rien n'est couvert.
      const ta = a.taux === null ? -1 : a.taux;
      const tb = b.taux === null ? -1 : b.taux;
      return ta - tb;
    });
}

function chartConfigTauxParDepartement(rows) {
  const sorted = sortedTauxParDepartement(rows);
  return {
    type: 'bar',
    data: {
      labels: sorted.map((r) => r.dept),
      datasets: [{
        data: sorted.map((r) => (r.taux === null ? 0 : clamp(r.taux, 0, 100))),
        backgroundColor: sorted.map((r) => statusColorVar(statusFromTaux(r.taux))),
        borderRadius: 3,
        borderSkipped: false,
        maxBarThickness: 28,
        _raw: sorted.map((r) => r.taux),
        _labelFormatter: (v) => (v === null ? '—' : v + ' %'),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 14 } }, // place pour l'étiquette de valeur au-dessus de chaque barre
      scales: {
        x: { grid: { display: false }, ticks: { color: cssVar('--text-muted'), font: { size: 9 } } },
        y: { display: false, min: 0, max: 100 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const ds = ctx.dataset;
              const t = ds._raw[ctx.dataIndex];
              return (t === null ? '—' : t + ' %') + ' (' + sorted[ctx.dataIndex].formes + ' / ' + sorted[ctx.dataIndex].cible + ')';
            },
          },
        },
      },
    },
  };
}

function legendTauxParDepartementHtml() {
  return '<ul class="viz-legend viz-legend-row">'
    + '<li><span class="viz-swatch viz-status-bon"></span><span class="viz-legend-label">' + escapeHtml(statusLabel('bon')) + '</span></li>'
    + '<li><span class="viz-swatch viz-status-surveiller"></span><span class="viz-legend-label">' + escapeHtml(statusLabel('surveiller')) + '</span></li>'
    + '<li><span class="viz-swatch viz-status-critique"></span><span class="viz-legend-label">' + escapeHtml(statusLabel('critique')) + '</span></li>'
    + '</ul>';
}

// Bloc HTML complet. 61e échange : contrairement aux deux graphiques précédents, le <canvas> est ici
// enveloppé dans .viz-canvas-inner à largeur FIXE (même calcul que l'ancien viewBox SVG —
// Math.max(160, n*56) — plutôt que la largeur du bloc) à l'intérieur du conteneur défilant
// .viz-bardept-svg (overflow-x: auto, inchangé) : au-delà d'un certain nombre de départements, les
// barres restent d'une largeur lisible et le bloc défile horizontalement, plutôt que de laisser
// Chart.js les comprimer indéfiniment pour tenir dans la largeur disponible.
function renderTauxParDepartementChart(rows) {
  const n = rows.length;
  const innerWidth = Math.max(160, n * 56);
  const canvasHtml = '<div class="viz-canvas-inner" style="width:' + innerWidth + 'px;">'
    + '<canvas id="chartTauxParDepartement" role="img" aria-label="Taux de formation par département"></canvas>'
    + '</div>';
  return '<div class="viz-combo-wrap viz-bardept-wrap"><div class="viz-combo-svg viz-bardept-svg">' + canvasHtml + '</div>' + legendTauxParDepartementHtml() + '</div>';
}

// 61e échange — cycle de vie des 3 instances Chart.js ci-dessus, même principe que
// leafletMap/leafletMapExpanded (voir plus haut) : render() reconstruit systématiquement le HTML de
// #main, donc les <canvas> sont détruits et recréés à chaque rendu — une instance Chart.js ne peut
// pas être « mise à jour en place » sur un canvas qui n'existe plus, elle doit être .destroy()ée
// avant la reconstruction puis recréée après (mountCharts, appelée depuis render() comme
// mountCarteLeaflet). Contrairement à la carte, ces 3 graphiques n'ont pas de position/zoom
// utilisateur à préserver d'un rendu à l'autre — rien d'équivalent à state.mapView ici.
const charts = { repartitionFonction: null, progressionAnnuelle: null, tauxParDepartement: null };

function destroyCharts() {
  Object.keys(charts).forEach((key) => {
    if (charts[key]) {
      try { charts[key].destroy(); } catch (e) { /* déjà détruite/jamais montée */ }
      charts[key] = null;
    }
  });
}

// Recrée les instances Chart.js sur les <canvas> fraîchement posés dans le DOM par render(). Sans
// effet si Chart.js n'a pas pu charger (typeof Chart === 'undefined' — même garde que
// mountCarteLeaflet pour `L`, dégradation gracieuse déjà pratiquée pour Leaflet dans ce widget) ; un
// bloc dont l'état est vide (voir renderBlockBody) n'a pas de <canvas> dans le DOM — getElementById
// renvoie alors null et ce graphique est simplement ignoré, sans erreur.
function mountCharts(d) {
  if (typeof Chart === 'undefined') return;
  const specs = [
    {
      key: 'repartitionFonction',
      canvasId: 'chartRepartitionFonction',
      ready: d.repartitionFonction.length > 0,
      config: () => chartConfigRepartitionFonction(d.repartitionFonction),
    },
    {
      key: 'progressionAnnuelle',
      canvasId: 'chartProgressionAnnuelle',
      ready: d.progressionAnnuelle.filter((a) => a.stagesRealises > 0 || a.personnesFormees > 0).length >= 2,
      config: () => chartConfigProgressionAnnuelle(d.progressionAnnuelle),
    },
    {
      key: 'tauxParDepartement',
      canvasId: 'chartTauxParDepartement',
      ready: !d.etabsJamaisActualise && d.cibleAuto.rows.length > 0,
      config: () => chartConfigTauxParDepartement(d.cibleAuto.rows),
    },
  ];
  specs.forEach((s) => {
    if (!s.ready) return;
    const canvas = document.getElementById(s.canvasId);
    if (!canvas) return;
    charts[s.key] = new Chart(canvas.getContext('2d'), s.config());
  });
}

/* ---------------------------------------------------------------------- */
/* Rendu : bloc individuel du tableau de bord                             */
/* ---------------------------------------------------------------------- */

function renderBlockBody(blockId, d, rowSpan) {
  if (blockId === 'kpi') {
    const kpis = computeKpis(d);
    const tier = kpiTier(rowSpan);
    return '<div class="kpi-row">' + kpis.map((k) => (
      '<div class="kpi-tile">'
      + (tier !== 'mini' ? '<div class="kpi-tile-label">' + escapeHtml(k.label) + '</div>' : '')
      + '<div class="kpi-tile-value">' + escapeHtml(k.value) + '</div>'
      + (tier === 'full' ? '<div class="kpi-tile-sub ' + k.subClass + '">' + escapeHtml(k.sub) + '</div>' : '')
      + '</div>'
    )).join('') + '</div>';
  }
  if (blockId === 'reperes') {
    const reperes = computeReperes(d);
    const { maxRows, showNote } = computeCappedRows(rowSpan, REPERE_ROW_H_PX, reperes.length, 0, NOTE_H_PX);
    const visible = reperes.slice(0, maxRows);
    return visible.map((r) => (
      '<div class="repere-row"><span class="repere-dot ' + r.statusClass + '"></span>'
      + '<div class="repere-text"><div class="repere-label">' + escapeHtml(r.label) + '</div><div class="repere-note">' + escapeHtml(r.note) + '</div></div>'
      + '<span class="mono repere-note" style="margin-right:4px;">' + escapeHtml(r.value) + '</span>'
      + '<span class="badge ' + r.statusClass + '">' + escapeHtml(r.statusLabel) + '</span></div>'
    )).join('')
      + (showNote ? '<div class="list-truncated-note">+ ' + (reperes.length - maxRows) + ' repère(s) non affiché(s) — agrandissez ce bloc pour les voir.</div>' : '');
  }
  if (blockId === 'carte') {
    // 51e échange : d.etabs vient désormais de l'annuaire national local de l'académie (tous les
    // établissements réels, pas seulement ceux ayant une candidature — voir computeData) ; seuls
    // ceux ayant des coordonnées reçoivent un point (mélanger position réelle et schématique sur
    // la même carte serait trompeur). Les autres sont comptés dans la légende.
    // 48e échange : le placement lui-même (fond de carte IGN Géoplateforme, marqueurs) est délégué
    // à Leaflet — voir mountCarteLeaflet, appelée depuis render() une fois ce HTML posé dans le
    // DOM (#carteLeafletHost doit exister avant de créer l'instance L.map).
    // 52e échange : le tableau HTML sous la carte (établissement + nombre de personnels formés) est
    // retiré — devenu inutile une fois les filtres d'affichage (type/secteur/tutelle/
    // circonscription, bouton « Filtres ») disponibles pour réduire le nombre de points affichés à
    // l'échelle académique ; la carte (et ses info-bulles) redevient la seule vue, avec une légende
    // qui rappelle désormais aussi combien d'établissements géolocalisés sont réellement affichés
    // quand un filtre est actif (voir etabPasseFiltres, appliquée ici avec exactement la même
    // logique que dans mountCarteLeaflet, pour que la légende et la carte racontent la même chose).
    const withGeo = d.etabs.filter((e) => e.geoStatus === 'resolu');
    const sansCoordonnees = d.etabs.filter((e) => e.geoStatus === 'sans_coordonnees');
    // En dessous de ce seuil, même la légende sous la carte n'a plus de place : on ne rend que
    // la carte elle-même (avec ses info-bulles au survol) plutôt que du texte qui serait de
    // toute façon rogné par le overflow:hidden du bloc.
    const hasCaptionRoom = blockContentHeightPx(rowSpan) >= (CARTE_MAP_MIN_PX + CARTE_CAPTION_H_PX);
    // 51e échange : la carte peut désormais être vide pour deux raisons distinctes, les mêmes que
    // l'onglet Cible auto (voir computeCibleAutoData/renderCibleTab) — colonne « Departements » non
    // renseignée pour l'académie, ou annuaire national jamais actualisé (bouton Paramètres). Un
    // troisième cas résiduel (aucun établissement ne correspond au secteur/à la tutelle choisis)
    // reste possible mais rare.
    if (!d.etabs.length) {
      const mapHtml = '<div class="mini-map" id="carteLeafletHost"></div>';
      if (!hasCaptionRoom) return mapHtml;
      let msg;
      if (d.etabsDeptsManquants) msg = 'Aucun département renseigné pour cette académie (table Référence, colonne « Departements ») — voir modele-de-donnees.md.';
      else if (d.etabsJamaisActualise) msg = 'L’annuaire national des établissements n’a jamais été actualisé pour votre académie — voir l’onglet Paramètres.';
      else msg = 'Aucun établissement ne correspond au secteur/à la tutelle actuellement sélectionnés (voir onglet Cible auto).';
      return mapHtml + '<p class="empty-state">' + escapeHtml(msg) + '</p>';
    }
    // 52e échange : établissements géolocalisés qui passent les filtres actuellement actifs
    // (type/secteur/tutelle + circonscriptions décochées) — sert uniquement à la légende ci-dessous,
    // jamais à la construction des points eux-mêmes (voir mountCarteLeaflet).
    const visibles = withGeo.filter((e) => etabPasseFiltres(e) && !(e.circUai && state.hiddenCirconscriptions.has(e.circUai)));
    let caption = '';
    if (sansCoordonnees.length && withGeo.length) caption = sansCoordonnees.length + ' établissement(s) sans coordonnées connues — non représenté(s) sur la carte.';
    else if (sansCoordonnees.length && !withGeo.length) caption = 'Aucun établissement géolocalisable pour l’instant — coordonnées absentes.';
    if (withGeo.length) {
      // 52e échange : rappel du nombre d'établissements affichés une fois un filtre actif — reprend
      // la place laissée par l'ancienne note de troncature du tableau (« + N établissement(s) »),
      // pour la même raison : expliquer pourquoi la carte montre moins de points que le total.
      const filterNote = visibles.length < withGeo.length
        ? (visibles.length + ' sur ' + withGeo.length + ' établissements affichés (filtres actifs). ')
        : '';
      // 51e échange : la légende principale décrit les deux encodages superposés sur la carte —
      // le vert (personnel formé rattaché, voir mountCarteLeaflet) et la couleur de circonscription
      // (identité, inchangée depuis le 50e échange) — jamais la couleur seule pour cette dernière
      // (voir assignCirconscriptionColors pour la limite de daltonisme assumée).
      caption = (caption ? caption + ' ' : '') + filterNote
        + 'Point vert = personnel formé rattaché (annuaire FPGC). Carré coloré = circonscription du 1er degré (voir bouton « Filtres »).';
    }
    return '<div class="mini-map" id="carteLeafletHost"></div>'
      + (hasCaptionRoom ? '<div class="map-caption">' + escapeHtml(caption) + '</div>' : '');
  }
  if (blockId === 'prevStages') {
    const p = d.stagesPrevu ? clamp(pct(d.stagesRealises, d.stagesPrevu), 0, 100) : 0;
    // Sous ce seuil, chiffres + barre à eux seuls remplissent déjà le bloc — la note en dessous
    // est la ligne la moins essentielle, donc celle qu'on masque plutôt que de la rogner.
    const showNote = blockContentHeightPx(rowSpan) >= 50;
    return '<div class="prev-figures"><span class="prev-big">' + d.stagesRealises + '</span><span class="prev-muted">/ ' + (d.stagesPrevu || '—') + ' stages prévus (' + escapeHtml(d.annee) + ')</span></div>'
      + '<div class="prev-track"><div class="prev-fill ' + (d.stagesPrevu ? statusFromTaux(pct(d.stagesRealises, d.stagesPrevu)) : 'neutre') + '" style="width:' + p + '%"></div></div>'
      + (showNote ? ('<div class="prev-note">' + (d.stagesPrevu ? (Math.max(0, d.stagesPrevu - d.stagesRealises) + ' stage(s) restant à réaliser sur l’année scolaire') : 'Objectif prévisionnel non renseigné pour ' + escapeHtml(d.annee)) + '</div>') : '');
  }
  if (blockId === 'prevPersonnels') {
    const p = d.personnelsPrevu ? clamp(pct(d.personnelsFormes, d.personnelsPrevu), 0, 100) : 0;
    const showNote = blockContentHeightPx(rowSpan) >= 50;
    return '<div class="prev-figures"><span class="prev-big">' + d.personnelsFormes + '</span><span class="prev-muted">/ ' + (d.personnelsPrevu || '—') + ' personnels prévus (' + escapeHtml(d.annee) + ')</span></div>'
      + '<div class="prev-track"><div class="prev-fill ' + (d.personnelsPrevu ? statusFromTaux(pct(d.personnelsFormes, d.personnelsPrevu)) : 'neutre') + '" style="width:' + p + '%"></div></div>'
      + (showNote ? ('<div class="prev-note">' + (d.personnelsPrevu ? (Math.max(0, d.personnelsPrevu - d.personnelsFormes) + ' personnel(s) restant à former sur l’année scolaire') : 'Objectif prévisionnel non renseigné pour ' + escapeHtml(d.annee)) + '</div>') : '');
  }
  // 55e échange : 3 nouveaux blocs fixes, remplaçant la fonctionnalité Croisements retirée ce même
  // échange (voir plus haut) — chacun en SVG inline fait main (voir la note en tête de fichier sur
  // le choix du SVG plutôt qu'une bibliothèque de graphiques), avec un état vide propre plutôt qu'un
  // graphique cassé/vide silencieux quand les données manquent.
  if (blockId === 'repartitionFonction') {
    if (!d.repartitionFonction.length) return '<p class="empty-state">Aucun personnel formé pour l’instant (annuaire FPGC) — rien à répartir par fonction.</p>';
    return renderRepartitionFonctionChart(d.repartitionFonction);
  }
  if (blockId === 'progressionAnnuelle') {
    const anneesAvecSignal = d.progressionAnnuelle.filter((a) => a.stagesRealises > 0 || a.personnesFormees > 0);
    if (anneesAvecSignal.length < 2) return '<p class="empty-state">Pas assez d’années scolaires avec au moins un stage clôturé ou une personne formée pour tracer une progression (2 minimum).</p>';
    return renderProgressionAnnuelleChart(d.progressionAnnuelle);
  }
  if (blockId === 'tauxParDepartement') {
    if (d.etabsJamaisActualise) return '<p class="empty-state">L’annuaire national des établissements n’a jamais été actualisé pour votre académie — voir l’onglet Paramètres.</p>';
    if (!d.cibleAuto.rows.length) return '<p class="empty-state">Aucun département renseigné pour cette académie (table Référence, colonne « Departements »).</p>';
    return renderTauxParDepartementChart(d.cibleAuto.rows);
  }
  return '';
}

function blockTitle(blockId) {
  const def = BLOCK_DEFS.filter((b) => b.key === blockId)[0];
  return def ? def.title : blockId;
}

/* ---------------------------------------------------------------------- */
/* Rendu : onglet Tableau de bord (grille libre)                          */
/* ---------------------------------------------------------------------- */

function renderTableauTab(d) {
  const editMode = state.editMode;
  let cells = '';
  for (let r = 1; r <= VISIBLE_ROWS; r++) for (let c = 1; c <= COLS; c++) cells += '<div class="grid-cell" style="grid-column:' + c + '; grid-row:' + r + ';"></div>';

  const blocksHtml = state.blocks.map((b) => {
    const centerContent = (b.id === 'prevStages' || b.id === 'prevPersonnels');
    return '<div class="dash-block editable" data-block-id="' + escapeHtml(b.id) + '" '
      + 'style="grid-column:' + b.col + ' / span ' + b.colSpan + '; grid-row:' + b.row + ' / span ' + b.rowSpan + ';" '
      + 'tabindex="' + (editMode ? '0' : '-1') + '">'
      + '<div class="dash-block-head"><span class="dash-block-title">' + escapeHtml(blockTitle(b.id)) + '</span>'
      + '<div class="dash-block-actions">'
      // 55e échange : retrait de la fonctionnalité Croisements, remplacée par 3 blocs fixes (voir
      // plus haut) — le bouton `cx-remove`/`data-remove-cx` (isCx) n'a plus lieu d'être, un bloc
      // fixe ne se « retire » que depuis Paramètres (case à cocher), comme tous les autres blocs.
      // 52e échange : bouton « Agrandir » du bloc carte UNIQUEMENT — toujours visible (contrairement
      // à la poignée de glisser-déposer ci-dessous, réservée au mode édition) puisqu'il ouvre une
      // vue en lecture, pas un outil de réagencement de la grille — voir openCarteExpandModal.
      + (b.id === 'carte' ? '<button type="button" class="carte-expand-btn" data-expand-carte title="Agrandir la carte">⛶</button>' : '')
      + '<span class="drag-handle" data-drag-handle title="Déplacer">⠿</span>'
      + '</div></div>'
      + '<div class="dash-block-body' + (centerContent ? ' center-content' : '') + '">' + renderBlockBody(b.id, d, b.rowSpan) + '</div>'
      + '<span class="resize-handle" data-resize-handle title="Redimensionner">⤡</span>'
      + (editMode && state.focusedId === b.id ? '<div class="kbd-hint">Flèches : déplacer · Maj+flèches : redimensionner</div>' : '')
      + '</div>';
  }).join('');

  return '<div class="toolbar">'
    + '<div class="toolbar-left">'
    + '<button type="button" class="btn ' + (editMode ? 'btn-primary' : 'btn-secondary') + '" id="btnToggleEdit">' + (editMode ? 'Terminer la personnalisation' : 'Personnaliser la disposition') + '</button>'
    + '</div>'
    + (editMode ? '<div class="toolbar-hint">Glissez un bloc par sa poignée ⠿, ou sélectionnez-le puis utilisez les flèches (Maj + flèches pour redimensionner).</div>' : '')
    + '</div>'
    + '<div class="content"><div class="dashboard-grid ' + (editMode ? 'editing' : '') + '" id="dashGrid">' + cells + blocksHtml + '</div></div>';
}

/* ---------------------------------------------------------------------- */
/* Rendu : onglet Paramètres                                              */
/* ---------------------------------------------------------------------- */

// 47e échange : statut + bouton d'actualisation de l'annuaire national des établissements, propre
// à l'académie courante (voir refreshEtablissementsAcademie).
function renderEtabRefreshCard() {
  const acadRow = state.academieId ? byId('Reference', state.academieId) : null;
  const code = acadRow ? String(acadRow.Code_academique || '').trim() : '';
  const rows = code ? T(ETAB_NATIONAL_TABLE).filter((r) => (r.Code_academie || '').trim() === code) : [];
  const actifs = rows.filter((r) => r.Actif);
  let statusHtml;
  if (!code) {
    statusHtml = '<p class="empty-state">Code académique introuvable (Reference.Code_academique) — actualisation impossible pour cette académie.</p>';
  } else if (!rows.length) {
    statusHtml = '<p class="empty-state">Jamais actualisé pour cette académie.</p>';
  } else {
    const maxModifie = rows.reduce((m, r) => Math.max(m, Number(r.Modifie_le || 0)), 0);
    const dateStr = maxModifie ? new Date(maxModifie * 1000).toLocaleString('fr-FR') : '—';
    statusHtml = '<p class="refresh-status">' + actifs.length + ' établissement(s) actif(s)'
      + (rows.length > actifs.length ? ' (' + (rows.length - actifs.length) + ' inactif(s), non supprimé(s))' : '')
      + ' — dernière actualisation : ' + escapeHtml(dateStr) + '.</p>';
  }
  return '<div class="card"><h3>Annuaire national des établissements</h3>'
    + '<div class="card-sub">Alimente la carte des établissements et la cible automatique (onglet Cible auto) à partir de l’Annuaire de l’éducation nationale (data.gouv.fr), limité à votre académie. À actualiser périodiquement — pas de rafraîchissement automatique.</div>'
    + statusHtml
    + '<button type="button" class="btn btn-secondary" id="btnRefreshEtablissements"' + (code ? '' : ' disabled') + '>Actualiser les établissements de mon académie</button>'
    + '<p class="refresh-progress" id="refreshEtabProgress" hidden></p>'
    + '</div>';
}

// 55e échange : retrait de la fonctionnalité Croisements — la carte « Croisements à effectuer »
// (dimension/mesure, bouton « + Ajouter », liste des croisements existants) est retirée entièrement
// de cet onglet, remplacée par les 3 nouveaux blocs fixes de tableau de bord (voir BLOCK_DEFS), qui
// apparaissent désormais simplement dans la liste « Blocs affichés » ci-dessous comme n'importe quel
// autre bloc.
// 64e échange — écran de saisie de l'objectif prévisionnel (Stages_prevus/Personnels_a_former_prevus,
// table Objectifs_previsionnels). Jusqu'ici cette table n'avait aucun écran d'écriture dans aucun
// widget — elle était uniquement lue (voir computeData(), plus haut) — d'où la question de
// l'utilisateur : « Je ne trouve pas où est saisi le prévisionnel dans le widget. » Il n'y avait
// effectivement rien à trouver, ce n'est pas ajouté maintenant. Volontairement limité à l'année
// scolaire COURANTE (`d.annee` = currentAnneeScolaire()) — c'est la seule année que le reste du
// widget lit ou affiche nulle part ailleurs (KPI, repères, bloc « Prévisionnel »), donc la seule
// qu'il est utile de pouvoir éditer ici pour l'instant. Une académie qui voudrait planifier l'année
// scolaire suivante avant qu'elle ne commence (dès août) devrait attendre le changement d'année
// scolaire calculé par anneeScolaireDeEpoch — pas traité ici, hors périmètre de la demande.
function renderObjectifCard(d) {
  const stagesVal = d.stagesPrevu ? String(d.stagesPrevu) : '';
  const persVal = d.personnelsPrevu ? String(d.personnelsPrevu) : '';
  return '<div class="card"><h3>Objectif prévisionnel — ' + escapeHtml(d.annee) + '</h3>'
    + '<div class="card-sub">Les chiffres que votre académie se fixe pour cette année scolaire, comparés au réalisé dans le bloc « Prévisionnel » du tableau de bord et dans les repères de pilotage. Laissez un champ à 0 (ou vide) pour repasser à « Aucun objectif renseigné ».</div>'
    + '<div class="objectif-form">'
    + '<label class="objectif-field"><span>Stages prévus</span><input type="number" id="objectifStagesInput" min="0" step="1" value="' + escapeHtml(stagesVal) + '" placeholder="0"></label>'
    + '<label class="objectif-field"><span>Personnels à former prévus</span><input type="number" id="objectifPersonnelsInput" min="0" step="1" value="' + escapeHtml(persVal) + '" placeholder="0"></label>'
    + '<button type="button" class="btn btn-secondary" id="btnSaveObjectif">Enregistrer l’objectif</button>'
    + '</div></div>';
}

function renderParametresTab(d) {
  const blocksHtml = BLOCK_DEFS.map((b) => (
    '<div class="block-row"><input type="checkbox" class="block-check" data-block-check="' + b.key + '" ' + (state.checks[b.key] ? 'checked' : '') + '>'
    + '<div class="block-text"><div class="block-label">' + escapeHtml(b.title) + '</div><div class="block-desc">' + escapeHtml(b.desc) + '</div></div></div>'
  )).join('');

  return '<div class="content">'
    + '<div class="card"><h3>Blocs affichés</h3><div class="card-sub">Activez ou désactivez individuellement chaque bloc du tableau de bord de votre académie.</div>' + blocksHtml + '</div>'
    + renderObjectifCard(d)
    + renderEtabRefreshCard()
    + '<div class="card save-bar"><div class="save-note">Ces réglages sont propres à votre académie et s’appliquent dès l’enregistrement, pour tous les utilisateurs de votre académie.</div>'
    + '<button type="button" class="btn btn-primary" id="btnSavePrefs">Enregistrer les préférences de l’académie</button></div>'
    + '</div>';
}

/* ---------------------------------------------------------------------- */
/* Rendu : onglet Cible auto (46e échange)                                */
/* ---------------------------------------------------------------------- */

function deptLabel(row) { return row.libelle ? (row.libelle + ' (' + row.dept + ')') : ('Département ' + row.dept); }

function renderCibleDeptRows(cibleAuto) {
  const rows = cibleAuto.rows.map((r) => (
    '<tr><td>' + escapeHtml(deptLabel(r)) + '</td>'
    + '<td class="num">' + r.total1erDegre + '</td>'
    + '<td class="num">' + r.total2ndDegre + '</td>'
    + '<td class="num">' + r.totalEtabs + '</td>'
    + '<td class="num">' + r.formes + '</td>'
    + '<td><span class="badge ' + statusFromTaux(r.totalEtabs ? pct(r.formes, r.totalEtabs) : null) + '">' + (r.totalEtabs ? pct(r.formes, r.totalEtabs) + ' %' : '—') + '</span></td></tr>'
  )).join('');
  return '<div class="etab-table-wrap"><table class="etab-table"><thead><tr>'
    + '<th>Département</th><th style="text-align:right">Écoles (1er degré)</th><th style="text-align:right">Collèges + lycées (2nd degré)</th>'
    + '<th style="text-align:right">Total établissements</th><th style="text-align:right">Personnels formés</th><th>Couverture</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function renderFonctionRows(fonctionData) {
  if (!fonctionData.rows.length) return '<p class="empty-state">Aucune donnée de fonction pour l’instant — le champ « Fonction » du formulaire de recrutement vient d’être introduit (46e échange), les fiches existantes ne le portent pas encore.</p>';
  const rows = fonctionData.rows.map((r) => (
    '<tr><td>' + escapeHtml(r.type || '—') + '</td><td>' + escapeHtml(r.fonction) + '</td>'
    + '<td class="num">' + (r.cible === null ? '—' : r.cible) + (r.ajustes ? ' <span class="ajuste-note">(' + r.ajustes + ' ajusté(s))</span>' : '') + '</td>'
    + '<td class="num">' + r.formes + '</td>'
    + '<td class="num">' + (r.cible === null ? '—' : Math.max(0, r.cible - r.formes)) + '</td></tr>'
  )).join('');
  return '<div class="etab-table-wrap"><table class="etab-table"><thead><tr>'
    + '<th>Type d’établissement</th><th>Fonction</th><th style="text-align:right">Cible</th><th style="text-align:right">Formés</th><th style="text-align:right">Restant</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// 47e échange : écran d'ajustement par établissement — la cible par défaut (1 poste/fonction)
// peut être remplacée par une valeur absolue pour un établissement précis (ex. un 2e adjoint
// gestionnaire), voir Cibles_fonction_overrides. La liste déroulante d'établissements ne propose
// que ceux actuellement dans le périmètre secteur/tutelle choisi (cibleAuto.localEtabs).
function renderAjustementsCard(cibleAuto) {
  const overridesList = T(OVERRIDES_TABLE).filter((o) => o.Academie === state.academieId)
    .sort((a, b) => (a.Nom_etablissement || '').localeCompare(b.Nom_etablissement || '', 'fr'));
  const etabOptions = cibleAuto.localEtabs.slice()
    .sort((a, b) => (a.Nom_etablissement || '').localeCompare(b.Nom_etablissement || '', 'fr'))
    .map((e) => '<option value="' + escapeHtml(e.UAI) + '">' + escapeHtml(e.Nom_etablissement || e.UAI) + ' — ' + escapeHtml(e.Type_etablissement || '') + '</option>')
    .join('');
  const rows = overridesList.length
    ? overridesList.map((o) => (
      '<tr><td>' + escapeHtml(o.Nom_etablissement || o.UAI_etablissement) + '</td>'
      // 56e échange : normalizeFonction à l'affichage — un ajustement déjà saisi avant le renommage
      // afficherait sinon littéralement l'ancien libellé « Adjoint gestionnaire ».
      + '<td>' + escapeHtml(normalizeFonction(o.Fonction)) + '</td>'
      + '<td class="num">' + (o.Cible === null || o.Cible === undefined ? '—' : o.Cible) + '</td>'
      + '<td>' + escapeHtml(o.Commentaire || '') + '</td>'
      + '<td><button type="button" class="croisement-remove" data-remove-override="' + o.id + '" title="Retirer cet ajustement (rétablit la cible par défaut de 1)">×</button></td></tr>'
    )).join('')
    : '<tr><td colspan="5" class="empty-state">Aucun ajustement enregistré — chaque établissement compte pour 1 poste cible par fonction, par défaut.</td></tr>';
  return '<div class="card"><h3>Ajustements par établissement</h3>'
    + '<div class="card-sub">Remplace, établissement par établissement, la cible par défaut (1 poste par fonction) par une valeur absolue — par exemple un 2<sup>e</sup> adjoint gestionnaire dans un grand établissement. Retirer un ajustement rétablit la valeur par défaut.</div>'
    + '<div class="ajustement-form">'
    + '<select id="ajustementEtabSelect"><option value="">Établissement…</option>' + etabOptions + '</select>'
    + '<select id="ajustementFonctionSelect"><option value="">Fonction…</option></select>'
    + '<input type="number" id="ajustementCibleInput" min="0" step="1" placeholder="Cible">'
    + '<input type="text" id="ajustementCommentaireInput" placeholder="Commentaire (facultatif)">'
    + '<button type="button" class="btn btn-secondary" id="btnAjouterAjustement">Enregistrer</button>'
    + '</div>'
    + '<div class="etab-table-wrap"><table class="etab-table"><thead><tr><th>Établissement</th><th>Fonction</th><th style="text-align:right">Cible</th><th>Commentaire</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '</div>';
}

// 55e échange : accepte désormais `d` (déjà calculé par render(), voir computeData) pour réutiliser
// d.cibleAuto/d.fonctionCible plutôt que de les recalculer une 2e fois ici (computeCibleAutoData()/
// computeFonctionCibleData() étaient auparavant appelées séparément, une fois dans computeData()
// pour la tuile KPI « Personnels formés », une fois ici pour cet onglet — même calcul, même
// académie, même réglages secteur/tutelle, aucune raison de le faire deux fois par rendu).
function renderCibleTab(d) {
  if (!d.cibleAuto.depts.length) {
    return '<div class="content"><div class="card"><h3>Cible automatique par établissement</h3>'
      + '<p class="empty-state">Aucun département renseigné pour cette académie dans la table Référence (colonne « Departements ») — la cible automatique ne peut pas être calculée tant que cette colonne n’est pas peuplée. Voir modele-de-donnees.md.</p></div></div>';
  }
  const cibleAuto = d.cibleAuto;
  const secteurSelect = '<select id="secteurCibleSelect">'
    + '<option value="Public"' + (state.secteurKey === 'public' ? ' selected' : '') + '>Public uniquement</option>'
    + '<option value="Public et privé sous contrat"' + (state.secteurKey === 'public_prive' ? ' selected' : '') + '>Public et privé sous contrat</option>'
    + '</select>';
  const tutelleSelect = '<select id="tutelleCibleSelect">'
    + '<option value="Éducation nationale"' + (state.tutelleKey === 'education_nationale' ? ' selected' : '') + '>Éducation nationale</option>'
    + '<option value="Toutes tutelles (Éducation nationale et autres ministères)"' + (state.tutelleKey === 'toutes' ? ' selected' : '') + '>Toutes tutelles (Éducation nationale et autres ministères)</option>'
    + '</select>';
  const toolbar = '<div class="cible-toolbar"><label for="secteurCibleSelect">Secteur pris en compte</label>' + secteurSelect
    + '<label for="tutelleCibleSelect">Tutelle prise en compte</label>' + tutelleSelect + '</div>';

  if (cibleAuto.jamaisActualise) {
    return '<div class="content"><div class="card"><h3>Cible automatique par établissement</h3>' + toolbar
      + '<p class="empty-state">L’annuaire national des établissements n’a jamais été actualisé pour votre académie — '
      + '<button type="button" class="btn btn-secondary btn-small" id="btnGoToParametres">Actualiser depuis Paramètres</button></p></div></div>';
  }

  const summary = '<div class="cible-summary">'
    + '<div class="cible-summary-tile"><div class="num-big">' + cibleAuto.totalFormes + ' / ' + cibleAuto.totalEtabs + '</div><div class="num-label">Établissements couverts (académie)</div></div>'
    + '<div class="cible-summary-tile"><div class="num-big">' + (cibleAuto.totalEtabs ? pct(cibleAuto.totalFormes, cibleAuto.totalEtabs) + ' %' : '—') + '</div><div class="num-label">Taux de couverture</div></div>'
    + '</div>'
    // 51e échange : personnels de l'annuaire de cette académie qu'aucune résolution (UAI, puis nom)
    // n'a pu rattacher à un établissement du périmètre actuel — affiché plutôt que silencieusement
    // absent du total ci-dessus (voir annuaireFormesParDepartement / computeCibleAutoData).
    + (cibleAuto.nonRattachesFormes ? '<p class="card-sub">' + cibleAuto.nonRattachesFormes + ' personnel(s) formé(s) de l’annuaire non rattaché(s) à un établissement identifié (UAI absent et nom non reconnu) — non compté(s) ci-dessus par département.</p>' : '');

  const fonctionData = d.fonctionCible;

  return '<div class="content">'
    + '<div class="card"><h3>Cible automatique par établissement</h3>'
    + '<div class="card-sub">Dénominateur : établissements réels de votre académie (annuaire national actualisé depuis Paramètres). Numérateur : personnels déjà consolidés dans l’annuaire FPGC. Cible retenue : 1 personne formée par établissement.</div>'
    + toolbar + summary + renderCibleDeptRows(cibleAuto)
    + '</div>'
    + '<div class="card"><h3>Ventilation par fonction</h3>'
    + '<div class="card-sub">Cible : 1 poste par établissement du type concerné et par fonction (règle par défaut, ajustable ci-dessous). Autre : pas de cible calculable depuis l’annuaire de l’éducation.</div>'
    + renderFonctionRows(fonctionData)
    + '</div>'
    + renderAjustementsCard(cibleAuto)
    + '</div>';
}

/* ---------------------------------------------------------------------- */
/* Modale — personnels formés pour un établissement (clic sur la carte)   */
/* ---------------------------------------------------------------------- */

// 51e échange : utilise désormais resolveEtabForPersonnel (UAI, puis repli par nom normalisé) au
// lieu d'une comparaison de nom exacte (sensible à la casse/aux accents) — cohérent avec
// computeData/annuaireFormesParDepartement, pour que la modale affiche les mêmes personnes que
// celles comptées ailleurs pour cet établissement.
function personnelsFormesPourEtab(etab) {
  const uai = etab.uai ? normalizeUai(etab.uai) : null;
  if (!uai) {
    // Repli si jamais appelée sans UAI (ne devrait plus arriver : tous les établissements affichés
    // sur la carte/le tableau viennent désormais de l'annuaire national, donc ont un UAI — voir
    // computeData).
    const key = normalizeNomEtab(etab.nom);
    return key ? T('Annuaire_FPGC').filter((r) => normalizeNomEtab(r.Nom_etablissement_d_affectation) === key) : [];
  }
  const acadRow = state.academieId ? byId('Reference', state.academieId) : null;
  const codeAcademique = acadRow ? String(acadRow.Code_academique || '').trim() : '';
  const byUai = etabNationalByUai();
  const byNom = etabNationalByNom(codeAcademique);
  return T('Annuaire_FPGC').filter((r) => {
    const resolved = resolveEtabForPersonnel(r, byUai, byNom);
    return !!resolved && normalizeUai(resolved.UAI) === uai;
  });
}

function closeEtabPersonnelModal() {
  const host = document.getElementById('etabPersonnelModal');
  if (host) host.innerHTML = '';
}

// 48e échange : extension de la modale (mock-up validé — voir processus-gestion-stage.md) avec
// une section « Ajustements de cible », réutilisant saveAjustement/removeAjustement déjà écrites
// pour l'écran dédié de l'onglet Cible auto (renderAjustementsCard) — l'un n'exclut pas l'autre,
// les deux points d'entrée restent disponibles. N'apparaît que pour un établissement dont le type
// porte une cible par fonction (FONCTION_CIBLE_PAR_TYPE) — jamais pour une circonscription
// (aucune notion de cible par fonction définie pour ce type à ce stade, voir CIRCONSCRIPTION_NATURE)
// ni pour un établissement dont l'UAI n'a encore pas de ligne locale (annuaire jamais actualisé).
function openEtabPersonnelModal(etab) {
  const personnes = personnelsFormesPourEtab(etab);
  const host = document.getElementById('etabPersonnelModal');
  if (!host) return;
  const uai = etab.uai ? normalizeUai(etab.uai) : null;
  const etabRow = uai ? T(ETAB_NATIONAL_TABLE).filter((r) => normalizeUai(r.UAI) === uai)[0] : null;
  const isCirconscription = !!(etabRow && (etabRow.Libelle_nature || '').trim().toUpperCase() === CIRCONSCRIPTION_NATURE);
  const fonctionsCible = (etabRow && !isCirconscription && FONCTION_CIBLE_PAR_TYPE[etabRow.Type_etablissement]) || [];
  const canAjuster = !!(uai && fonctionsCible.length);

  let statHtml = '';
  if (canAjuster) {
    const overridesEtab = T(OVERRIDES_TABLE).filter((o) => o.Academie === state.academieId && normalizeUai(o.UAI_etablissement) === uai);
    const cibleTotal = fonctionsCible.reduce((sum, f) => {
      // 56e échange : normalizeFonction — un ajustement déjà saisi avant le renommage peut encore
      // porter littéralement « Adjoint gestionnaire » ; sans cette normalisation, il ne
      // correspondrait plus jamais à `f` (toujours le libellé actuel, ex. 'Secrétaire général', issu
      // de FONCTION_CIBLE_PAR_TYPE) et la cible calculée ici (stat-callout de la modale) redeviendrait
      // 1 par défaut au lieu de la valeur ajustée.
      const ov = overridesEtab.filter((o) => normalizeFonction(o.Fonction) === f)[0];
      return sum + (ov ? Number(ov.Cible || 0) : 1);
    }, 0);
    statHtml = '<div class="stat-callout"><span class="stat-value">' + personnes.length + ' / ' + cibleTotal + '</span>'
      + '<span class="stat-label">personnels formés (cible actuelle)</span></div>';
  }

  const rows = personnes.length
    ? personnes.map((p) => (
      '<tr><td>' + escapeHtml((p.Prenom || '') + ' ' + (p.Nom || '')) + '</td>'
      // 56e échange : normalizeFonction à l'affichage — un personnel déjà consolidé avant le
      // renommage afficherait sinon littéralement l'ancien libellé « Adjoint gestionnaire ».
      + '<td>' + escapeHtml(p.Fonction ? normalizeFonction(p.Fonction) : '—') + '</td>'
      + '<td>' + escapeHtml([p.Grade_long, p.Discipline_d_exercice].filter(Boolean).join(' — ') || '—') + '</td></tr>'
    )).join('')
    : '<tr><td colspan="3" class="empty-state">Aucun personnel consolidé dans l’annuaire FPGC pour cet établissement pour l’instant.</td></tr>';

  let ajustHtml = '';
  if (canAjuster) {
    const overridesList = T(OVERRIDES_TABLE).filter((o) => o.Academie === state.academieId && normalizeUai(o.UAI_etablissement) === uai)
      // 56e échange : tri sur le libellé normalisé — un ajustement encore saisi sous l'ancien
      // libellé « Adjoint gestionnaire » se trie ainsi avec le reste de « Secrétaire général »
      // plutôt que d'apparaître isolément sous « A ».
      .sort((a, b) => normalizeFonction(a.Fonction).localeCompare(normalizeFonction(b.Fonction), 'fr'));
    const fonctionOptions = fonctionsCible.map((f) => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>').join('');
    const ovRows = overridesList.length
      ? overridesList.map((o) => (
        // 56e échange : normalizeFonction à l'affichage — voir le tri ci-dessus.
        '<tr><td>' + escapeHtml(normalizeFonction(o.Fonction)) + '</td>'
        + '<td class="num">' + (o.Cible === null || o.Cible === undefined ? '—' : o.Cible) + '</td>'
        + '<td>' + escapeHtml(o.Commentaire || '') + '</td>'
        + '<td><button type="button" class="croisement-remove" data-modal-remove-override="' + o.id + '" title="Retirer cet ajustement (rétablit la cible par défaut de 1)">×</button></td></tr>'
      )).join('')
      : '<tr><td colspan="4" class="empty-state">Aucun ajustement pour cet établissement — compte pour 1 poste cible par fonction, par défaut.</td></tr>';
    ajustHtml = '<p class="modal-section-title">Ajustements de cible pour cet établissement</p>'
      + '<div class="card-sub">Remplace la cible par défaut (1 poste par fonction) par une valeur absolue, pour cet établissement précis.</div>'
      + '<div class="ajustement-form">'
      + '<select id="modalAjustFonction" aria-label="Fonction"><option value="">Fonction…</option>' + fonctionOptions + '</select>'
      + '<input type="number" id="modalAjustCible" aria-label="Cible" min="0" step="1" placeholder="Cible">'
      + '<input type="text" id="modalAjustCommentaire" aria-label="Commentaire (facultatif)" placeholder="Commentaire (facultatif)">'
      + '<button type="button" class="btn btn-secondary" id="modalBtnAjouterAjustement">Enregistrer</button>'
      + '</div>'
      + '<div class="etab-table-wrap"><table class="etab-table"><thead><tr><th>Fonction</th><th style="text-align:right">Cible</th><th>Commentaire</th><th></th></tr></thead><tbody>' + ovRows + '</tbody></table></div>';
  }

  host.innerHTML = '<div class="modal-backdrop" id="etabPersonnelBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="etabPersonnelTitle">'
    + '<h2 id="etabPersonnelTitle">' + escapeHtml(etab.nom) + '</h2>'
    + (isCirconscription ? '<p class="modal-sub">Circonscription d’inspection du 1er degré</p>' : '')
    + statHtml
    + '<p class="modal-section-title first">Personnel formé</p>'
    + '<div class="etab-table-wrap"><table class="etab-table"><thead><tr><th>Nom</th><th>Fonction</th><th>Grade / discipline</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + ajustHtml
    + '<div class="modal-actions"><button type="button" class="btn btn-secondary" id="etabPersonnelClose">Fermer</button></div>'
    + '</div></div>';
  document.getElementById('etabPersonnelClose').onclick = closeEtabPersonnelModal;
  document.getElementById('etabPersonnelBackdrop').addEventListener('click', (e) => { if (e.target.id === 'etabPersonnelBackdrop') closeEtabPersonnelModal(); });

  if (canAjuster) {
    const btn = document.getElementById('modalBtnAjouterAjustement');
    if (btn) btn.onclick = async () => {
      const fonction = document.getElementById('modalAjustFonction').value;
      const cible = document.getElementById('modalAjustCible').value;
      const commentaire = document.getElementById('modalAjustCommentaire').value;
      // saveAjustement recharge OVERRIDES_TABLE et appelle render() en interne (voir plus bas) —
      // la modale, hébergée hors de #main, n'est pas détruite par ce render() ; on la rafraîchit
      // nous-mêmes juste après pour refléter l'ajustement tout juste enregistré.
      await saveAjustement(uai, fonction, cible, commentaire);
      openEtabPersonnelModal(etab);
    };
    host.querySelectorAll('[data-modal-remove-override]').forEach((el) => {
      el.onclick = async () => {
        await removeAjustement(Number(el.getAttribute('data-modal-remove-override')));
        openEtabPersonnelModal(etab);
      };
    });
  }
}

function closeCarteFiltersModal() {
  const host = document.getElementById('carteFiltersModal');
  if (host) host.innerHTML = '';
}

// 52e échange : fusion de l'ancienne modale « Filtrer par circonscription » (50e échange,
// openCirconscriptionFilterModal) avec de nouveaux filtres d'affichage de la carte — demande
// explicite (trop de points à l'échelle académique, carte illisible). Un seul bouton Leaflet
// (« Filtres », voir mountCarteLeaflet) ouvre désormais cette modale à 4 sections : type
// d'établissement, secteur, tutelle (multi-choix sur state.mapFilters, toutes cochées par défaut,
// jamais un filtre qui s'élargit comme Secteur_cible/Tutelle_cible de l'onglet Cible auto — voir
// isTutelleMen), puis — reprise à l'identique — la circonscription (state.hiddenCirconscriptions).
// Chaque case des 3 premières sections applique aussitôt son changement puis render(), exactement
// comme les cases de circonscription existantes ; le compte affiché à côté de chaque libellé porte
// sur d.etabs tel quel, indépendamment de l'état actuel des cases (même principe que le compte par
// circonscription ci-dessous).
function openCarteFiltersModal(d) {
  const host = document.getElementById('carteFiltersModal');
  if (!host) return;

  const typeRows = TYPES_ETABLISSEMENT.map((t) => {
    const count = d.etabs.filter((e) => e.type === t).length;
    const checked = state.mapFilters.types.has(t);
    return '<label class="filter-row"><input type="checkbox" data-filter-type="' + escapeHtml(t) + '" ' + (checked ? 'checked' : '') + '>'
      + '<span class="filter-label">' + escapeHtml(t) + '</span>'
      + '<span class="filter-count">' + count + ' étab.</span></label>';
  }).join('');

  const SECTEURS = ['Public', 'Privé'];
  const secteurRows = SECTEURS.map((s) => {
    const count = d.etabs.filter((e) => e.secteur === s).length;
    const checked = state.mapFilters.secteurs.has(s);
    return '<label class="filter-row"><input type="checkbox" data-filter-secteur="' + escapeHtml(s) + '" ' + (checked ? 'checked' : '') + '>'
      + '<span class="filter-label">' + escapeHtml(s) + '</span>'
      + '<span class="filter-count">' + count + ' étab.</span></label>';
  }).join('');

  const TUTELLES = [{ key: 'MEN', label: 'Éducation nationale' }, { key: 'Autres', label: 'Autres tutelles' }];
  const tutelleRows = TUTELLES.map((t) => {
    const count = d.etabs.filter((e) => (e.tutelleMen ? 'MEN' : 'Autres') === t.key).length;
    const checked = state.mapFilters.tutelles.has(t.key);
    return '<label class="filter-row"><input type="checkbox" data-filter-tutelle="' + t.key + '" ' + (checked ? 'checked' : '') + '>'
      + '<span class="filter-label">' + escapeHtml(t.label) + '</span>'
      + '<span class="filter-count">' + count + ' étab.</span></label>';
  }).join('');

  // 53e échange : 5e section, entre Tutelle et Circonscriptions — demande d'ajout (pas un bug),
  // exactement sur le même modèle que les 3 sections ci-dessus (une checkbox par option, comptage
  // affiché indépendamment de l'état actuel des cases, toutes cochées par défaut, onchange met à
  // jour l'état puis appelle render()). Les circonscriptions ne sont pas comptées ici (voir
  // etabPasseFiltres) — pas de notion de personnel formé pour ce type.
  const STATUT_FORMES = [{ key: 'formes', label: 'Avec personnel formé' }, { key: 'non_formes', label: 'Sans personnel formé' }];
  const statutFormesRows = STATUT_FORMES.map((s) => {
    const count = d.etabs.filter((e) => !e.isCirconscription && ((e.formes ? 'formes' : 'non_formes') === s.key)).length;
    const checked = state.mapFilters.statutFormes.has(s.key);
    return '<label class="filter-row"><input type="checkbox" data-filter-formes="' + s.key + '" ' + (checked ? 'checked' : '') + '>'
      + '<span class="filter-label">' + escapeHtml(s.label) + '</span>'
      + '<span class="filter-count">' + count + ' étab.</span></label>';
  }).join('');

  // 50e échange (contenu inchangé, seuls les ids ont changé — voir la 4e section ci-dessous) : une
  // ligne par circonscription réellement présente parmi les établissements actuellement affichés
  // (d.circonscriptions, calculée dans computeData). N'apparaît que s'il y en a au moins une.
  const circRows = d.circonscriptions.map((c) => {
    const count = d.etabs.filter((e) => e.circUai === c.uai).length;
    const checked = !state.hiddenCirconscriptions.has(c.uai);
    return '<label class="circ-filter-row"><input type="checkbox" data-circ-filter="' + escapeHtml(c.uai) + '" ' + (checked ? 'checked' : '') + '>'
      + '<span class="circ-swatch" style="background:' + escapeHtml(c.couleur) + '"></span>'
      + '<span class="circ-nom">' + escapeHtml(c.nom) + '</span>'
      + '<span class="circ-count">' + count + ' étab.</span></label>';
  }).join('');
  const circSection = d.circonscriptions.length
    ? '<p class="modal-section-title">Circonscriptions</p>'
      + '<p class="modal-sub">Décochez une circonscription pour masquer ses écoles sur la carte. La couleur affichée ici est celle utilisée sur la carte (contour des points, remplissage des carrés) — voir modele-de-donnees.md pour la méthode d’attribution (identité nominale, jamais un indicateur de performance).</p>'
      + circRows
      + '<div class="modal-actions" style="justify-content:flex-start;">'
      + '<button type="button" class="btn btn-secondary btn-small" id="carteFiltersCircAll">Tout afficher</button>'
      + '<button type="button" class="btn btn-secondary btn-small" id="carteFiltersCircNone">Tout masquer</button>'
      + '</div>'
    : '';

  host.innerHTML = '<div class="modal-backdrop" id="carteFiltersBackdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="carteFiltersTitle">'
    + '<h2 id="carteFiltersTitle">Filtres de la carte</h2>'
    + '<p class="modal-sub">Réduisez le nombre d’établissements affichés sur la carte — utile à l’échelle académique.</p>'
    + '<p class="modal-section-title first">Type d’établissement</p>' + typeRows
    + '<p class="modal-section-title">Secteur</p>' + secteurRows
    + '<p class="modal-section-title">Tutelle</p>' + tutelleRows
    + '<p class="modal-section-title">Personnel formé</p>' + statutFormesRows
    + circSection
    + '<div class="modal-actions">'
    + '<button type="button" class="btn btn-secondary" id="carteFiltersClose">Fermer</button>'
    + '</div></div></div>';

  document.getElementById('carteFiltersClose').onclick = closeCarteFiltersModal;
  document.getElementById('carteFiltersBackdrop').addEventListener('click', (e) => { if (e.target.id === 'carteFiltersBackdrop') closeCarteFiltersModal(); });

  host.querySelectorAll('[data-filter-type]').forEach((el) => {
    el.onchange = () => {
      const t = el.getAttribute('data-filter-type');
      if (el.checked) state.mapFilters.types.add(t); else state.mapFilters.types.delete(t);
      render();
    };
  });
  host.querySelectorAll('[data-filter-secteur]').forEach((el) => {
    el.onchange = () => {
      const s = el.getAttribute('data-filter-secteur');
      if (el.checked) state.mapFilters.secteurs.add(s); else state.mapFilters.secteurs.delete(s);
      render();
    };
  });
  host.querySelectorAll('[data-filter-tutelle]').forEach((el) => {
    el.onchange = () => {
      const t = el.getAttribute('data-filter-tutelle');
      if (el.checked) state.mapFilters.tutelles.add(t); else state.mapFilters.tutelles.delete(t);
      render();
    };
  });
  // 53e échange : même câblage que les 3 sections existantes ci-dessus.
  host.querySelectorAll('[data-filter-formes]').forEach((el) => {
    el.onchange = () => {
      const k = el.getAttribute('data-filter-formes');
      if (el.checked) state.mapFilters.statutFormes.add(k); else state.mapFilters.statutFormes.delete(k);
      render();
    };
  });
  host.querySelectorAll('[data-circ-filter]').forEach((el) => {
    el.onchange = () => {
      const uai = el.getAttribute('data-circ-filter');
      if (el.checked) state.hiddenCirconscriptions.delete(uai);
      else state.hiddenCirconscriptions.add(uai);
      render();
    };
  });
  const btnCircAll = document.getElementById('carteFiltersCircAll');
  if (btnCircAll) btnCircAll.onclick = () => {
    d.circonscriptions.forEach((c) => state.hiddenCirconscriptions.delete(c.uai));
    render();
    openCarteFiltersModal(d);
  };
  const btnCircNone = document.getElementById('carteFiltersCircNone');
  if (btnCircNone) btnCircNone.onclick = () => {
    d.circonscriptions.forEach((c) => state.hiddenCirconscriptions.add(c.uai));
    render();
    openCarteFiltersModal(d);
  };
}

// 52e échange : modale plein écran de la carte (bouton « Agrandir », voir renderTableauTab) — une
// seconde instance Leaflet, INDÉPENDANTE de celle du bloc compact (voir mountCarteLeaflet,
// opts.isExpanded), montée directement ici (pas via render()) au moment de l'ouverture ; les
// ouvertures suivantes du même état (filtre changé pendant que la modale est ouverte, par exemple)
// sont prises en charge par render() lui-même tant que state.carteExpanded reste vrai — voir
// render() plus bas. Le bouton « Filtres » de cette carte agrandie est le même mécanisme que celui
// de la carte compacte (openCarteFiltersModal), les deux cartes filtrant les mêmes données d.
function openCarteExpandModal(d) {
  const host = document.getElementById('carteExpandModal');
  if (!host) return;
  state.carteExpanded = true;
  host.innerHTML = '<div class="modal-backdrop wide" id="carteExpandBackdrop">'
    + '<div class="modal carte-expand" role="dialog" aria-modal="true" aria-labelledby="carteExpandTitle">'
    + '<div class="modal-actions" style="justify-content:space-between; margin:0 0 8px;">'
    + '<h2 id="carteExpandTitle" style="margin:0;">Carte des établissements</h2>'
    + '<button type="button" class="btn btn-secondary" id="carteExpandClose">Fermer</button>'
    + '</div>'
    + '<div class="carte-expand-map-wrap"><div class="mini-map" id="carteLeafletHostExpand"></div></div>'
    + '</div></div>';
  document.getElementById('carteExpandClose').onclick = closeCarteExpandModal;
  document.getElementById('carteExpandBackdrop').addEventListener('click', (e) => { if (e.target.id === 'carteExpandBackdrop') closeCarteExpandModal(); });
  mountCarteLeaflet(d, { hostId: 'carteLeafletHostExpand', isExpanded: true });
  // 53e échange (bug 1c) : la modale plein écran vient d'être insérée dans le DOM — Leaflet, monté
  // juste au-dessus dans un conteneur qui n'avait pas encore ses dimensions finales à ce moment
  // précis, peut se dimensionner incorrectement au tout premier rendu. invalidateSize() au prochain
  // repaint (requestAnimationFrame) est l'appel standard recommandé par Leaflet dans ce cas. Garde
  // contre une instance détruite entre-temps par un re-render (fermeture de la modale) : on vérifie
  // que la variable de module existe encore avant d'appeler invalidateSize dessus.
  requestAnimationFrame(() => { if (leafletMapExpanded) leafletMapExpanded.invalidateSize(); });
}

function closeCarteExpandModal() {
  const host = document.getElementById('carteExpandModal');
  if (leafletMapExpanded) { leafletMapExpanded.remove(); leafletMapExpanded = null; }
  if (host) host.innerHTML = '';
  state.carteExpanded = false;
}

/* ---------------------------------------------------------------------- */
/* Rendu global                                                            */
/* ---------------------------------------------------------------------- */

function render() {
  document.getElementById('appName').textContent = 'Pilotage FPGC — académie ' + state.academieNom;
  document.getElementById('topbarSub').textContent = state.tab === 'tableau' ? 'Tableau de bord de pilotage' : (state.tab === 'cible' ? 'Cible automatique par établissement' : 'Paramètres du tableau de bord');
  document.getElementById('btnTabTableau').className = 'tab-btn' + (state.tab === 'tableau' ? ' active' : '');
  document.getElementById('btnTabCible').className = 'tab-btn' + (state.tab === 'cible' ? ' active' : '');
  document.getElementById('btnTabParametres').className = 'tab-btn' + (state.tab === 'parametres' ? ' active' : '');

  const devBanner = document.getElementById('devBanner');
  if (!state.aclScoped) {
    const options = T('Reference').filter((r) => r.Academie);
    devBanner.hidden = false;
    devBanner.innerHTML = '<span>Règles ACL non appliquées sur ce document (ou accès National/Owner) — académie choisie manuellement, à titre de confort d’aperçu uniquement (voir acl-academies.md §20).</span>'
      + '<select id="devAcademieSelect">' + options.map((r) => '<option value="' + r.id + '" ' + (r.id === state.academieId ? 'selected' : '') + '>' + escapeHtml(r.Academie) + '</option>').join('') + '</select>';
  } else {
    devBanner.hidden = true;
    devBanner.innerHTML = '';
  }

  // 48e échange : la carte Leaflet vit dans un conteneur qui va être détruit par la reconstruction
  // de #main ci-dessous (voir la note sur leafletMap plus haut) — capturer sa position avant, pour
  // la restaurer après recréation dans mountCarteLeaflet, plutôt que de perdre le pan/zoom de
  // l'utilisateur à chaque rendu déclenché par ailleurs (changement d'onglet, ajustement de cible…).
  if (leafletMap) {
    try { state.mapView = { center: leafletMap.getCenter(), zoom: leafletMap.getZoom() }; } catch (e) { /* jamais rendue — pas de vue à capturer */ }
    leafletMap.remove();
    leafletMap = null;
  }
  // 52e échange : même traitement pour la seconde instance Leaflet de la modale plein écran — voir
  // leafletMapExpanded/state.mapViewExpanded plus haut. Contrairement à #carteLeafletHost (dans
  // #main, toujours détruit ci-dessous), #carteLeafletHostExpand vit dans #carteExpandModal (hors
  // #main) : il survit à la reconstruction, mais l'instance Leaflet elle-même doit quand même être
  // recréée dedans (mêmes marqueurs/filtres à jour) — voir plus bas, après bindEvents.
  if (leafletMapExpanded) {
    try { state.mapViewExpanded = { center: leafletMapExpanded.getCenter(), zoom: leafletMapExpanded.getZoom() }; } catch (e) { /* jamais rendue — pas de vue à capturer */ }
    leafletMapExpanded.remove();
    leafletMapExpanded = null;
  }
  // 61e échange : mêmes contraintes que ci-dessus pour les 3 graphiques Chart.js du tableau de bord
  // — leurs <canvas> vivent dans #main, détruits par la reconstruction juste en dessous ; voir
  // destroyCharts/mountCharts pour le détail du cycle de vie.
  destroyCharts();

  const main = document.getElementById('main');
  let d = null;
  if (!state.academieId) {
    main.innerHTML = '<div class="content"><p class="empty-state">Aucune académie déterminée — vérifiez la table Preferences_tableau_bord et les règles ACL.</p></div>';
  } else {
    d = computeData();
    main.innerHTML = state.tab === 'tableau' ? renderTableauTab(d) : (state.tab === 'cible' ? renderCibleTab(d) : renderParametresTab(d));
  }
  bindEvents(d);
  if (d) {
    mountCarteLeaflet(d, { hostId: 'carteLeafletHost' });
    // 53e échange (bug 1c) : même raison qu'openCarteExpandModal ci-dessus — #carteLeafletHost vient
    // d'être (re)créé par la reconstruction de #main juste au-dessus ; invalidateSize() au prochain
    // repaint évite un dimensionnement interne erroné au premier rendu. Garde contre une instance
    // détruite entre-temps (un nouveau render() a pu tourner avant que ce callback ne s'exécute).
    requestAnimationFrame(() => { if (leafletMap) leafletMap.invalidateSize(); });
    // 61e échange : montage des 3 graphiques Chart.js une fois #main reconstruit ci-dessus — mêmes
    // conditions que mountCarteLeaflet (uniquement si `d` existe, donc pas sur l'écran « aucune
    // académie déterminée »), mais sans dépendance à l'onglet affiché : mountCharts est sans effet
    // sur un canvas absent du DOM (onglet Cible auto/Paramètres, ou bloc masqué du tableau de bord).
    mountCharts(d);
  }
  // 52e échange : remonte la carte plein écran si sa modale est ouverte (state.carteExpanded) — son
  // hôte survit à la reconstruction de #main (voir plus haut) mais l'instance Leaflet, détruite
  // ci-dessus, doit être recréée pour refléter un filtre/une circonscription tout juste changé(e).
  if (d && state.carteExpanded && document.getElementById('carteLeafletHostExpand')) {
    mountCarteLeaflet(d, { hostId: 'carteLeafletHostExpand', isExpanded: true });
    // 53e échange (bug 1c) : idem, pour cette seconde instance.
    requestAnimationFrame(() => { if (leafletMapExpanded) leafletMapExpanded.invalidateSize(); });
  }
}

/* ---------------------------------------------------------------------- */
/* Écriture des préférences                                               */
/* ---------------------------------------------------------------------- */

async function savePrefs() {
  if (!state.prefRow) { flashError('Impossible d’enregistrer', new Error('Aucune ligne Preferences_tableau_bord pour cette académie.')); return; }
  try {
    await grist.docApi.applyUserActions([[
      'UpdateRecord', 'Preferences_tableau_bord', state.prefRow.id,
      {
        BlocsJSON: JSON.stringify(state.checks),
        DispositionJSON: JSON.stringify(state.blocks),
        // 55e échange : retrait de la fonctionnalité Croisements — CroisementsJSON n'est plus jamais
        // écrite ici (colonne Grist volontairement conservée côté schéma, jamais retirée par la
        // force — voir loadPrefsIntoState).
        Modifie_le: Math.floor(Date.now() / 1000),
      },
    ]]);
    state.dirty = false;
    showFlash('Préférences enregistrées pour l’académie ' + state.academieNom + '.', 'ok');
    await loadTable('Preferences_tableau_bord');
    state.prefRow = byId('Preferences_tableau_bord', state.prefRow.id) || state.prefRow;
  } catch (err) {
    flashError('Erreur lors de l’enregistrement des préférences', err);
  }
}

// Réglage secteur de la « Cible auto » (46e échange) : appliqué immédiatement au changement de
// sélecteur (contrairement à BlocsJSON/DispositionJSON/CroisementsJSON, qui n'attendent qu'un
// « Enregistrer les préférences » explicite) — un réglage de filtre plutôt qu'une disposition,
// mieux vaut qu'il s'applique tout de suite pour tous les utilisateurs de l'académie.
async function saveSecteurCible(secteurLabel) {
  if (!state.prefRow) { flashError('Impossible d’enregistrer', new Error('Aucune ligne Preferences_tableau_bord pour cette académie.')); return; }
  try {
    await grist.docApi.applyUserActions([[
      'UpdateRecord', 'Preferences_tableau_bord', state.prefRow.id, { Secteur_cible: secteurLabel },
    ]]);
    await loadTable('Preferences_tableau_bord');
    state.prefRow = byId('Preferences_tableau_bord', state.prefRow.id) || state.prefRow;
    state.secteurKey = secteurKeyOf(state.prefRow);
    render();
  } catch (err) {
    flashError('Erreur lors de l’enregistrement du secteur', err);
  }
}

// 47e échange : même mécanique, pour Tutelle_cible (filtre qui s'élargit — voir tutelleKeyOf).
async function saveTutelleCible(tutelleLabel) {
  if (!state.prefRow) { flashError('Impossible d’enregistrer', new Error('Aucune ligne Preferences_tableau_bord pour cette académie.')); return; }
  try {
    await grist.docApi.applyUserActions([[
      'UpdateRecord', 'Preferences_tableau_bord', state.prefRow.id, { Tutelle_cible: tutelleLabel },
    ]]);
    await loadTable('Preferences_tableau_bord');
    state.prefRow = byId('Preferences_tableau_bord', state.prefRow.id) || state.prefRow;
    state.tutelleKey = tutelleKeyOf(state.prefRow);
    render();
  } catch (err) {
    flashError('Erreur lors de l’enregistrement de la tutelle', err);
  }
}

// 47e échange — actualisation de l'annuaire national des établissements (bouton de l'onglet
// Paramètres) : pagine tabular-api.data.gouv.fr filtré sur le Code_academie de l'académie
// courante (Reference.Code_academique — vérifié en conditions réelles, voir
// processus-gestion-stage.md), puis upsert par UAI dans Etablissements_education_nationale.
// Un établissement déjà enregistré pour cette académie mais absent de la réponse fraîche est
// marqué Actif=false plutôt que supprimé (ne casse jamais une référence existante, ex. un
// ajustement Cibles_fonction_overrides pointant sur son UAI).
async function fetchEtablissementsAcademieFromApi(codeAcademique, onProgress) {
  const rows = [];
  let url = ETAB_API_BASE + '?Code_academie__exact=' + encodeURIComponent(codeAcademique) + '&page_size=' + ETAB_API_PAGE_SIZE;
  let page = 0;
  let total = null;
  while (url) {
    page += 1;
    if (page > ETAB_API_MAX_PAGES) throw new Error('Arrêt de sécurité après ' + ETAB_API_MAX_PAGES + ' pages — réponse anormalement volumineuse.');
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    total = (json.meta && typeof json.meta.total === 'number') ? json.meta.total : total;
    (json.data || []).forEach((r) => rows.push(r));
    if (onProgress) onProgress(rows.length, total, page);
    url = (json.links && json.links.next) ? json.links.next : null;
  }
  return rows;
}

// 50e échange — couleur cartographique par circonscription (production, plus le tableau pastel
// ponctuel du 49e échange) : encodage d'IDENTITÉ nominale (jamais une magnitude), donc teinte
// tournante par angle d'or (137,508°/circonscription — même principe que le rendu « couleurs
// aléatoires » de QGIS pour les symbologies catégorisées, la référence pour ce cas d'usage à
// cardinalité ouverte ; une palette catégorielle fixe à 8 teintes n'est pas dimensionnée pour ça,
// voir dataviz skill) plutôt qu'une palette catégorielle fixe. Saturation/luminosité HSL constantes
// (S=68 %, L=48 %) choisies pour la lisibilité d'un marqueur de carte sur le fond IGN PLANIGNV2 —
// plus saturées et plus sombres que les tons pastel de l'export Excel du 49e échange, qui visaient
// un fond de cellule de tableur avec du texte noir dessus, pas un point de carte — et surtout
// gardées IDENTIQUES pour toutes les circonscriptions : aucune ne doit paraître plus « importante »
// qu'une autre par luminosité. Portée de l'attribution : l'académie (pas le département, pas le
// national) — l'utilisateur de ce widget ne voit jamais qu'une seule académie à la fois, c'est donc
// à cette échelle que deux circonscriptions ne doivent jamais recevoir la même couleur ; un angle de
// départ dérivé d'un hash du code académique évite que deux académies voisines démarrent sur la
// même teinte (sans effet sur la séparation interne, l'incrément reste l'angle d'or).
// Limite assumée et documentée (processus-gestion-stage.md, 50e échange) : au-delà d'une poignée de
// circonscriptions simultanées, l'angle d'or ne peut plus garantir une séparation perceptuelle
// suffisante pour CHAQUE paire vis-à-vis d'un daltonisme donné (impossible à cette cardinalité,
// quelle que soit la méthode) — la couleur n'est donc jamais la seule clé d'identification : nom
// affiché en infobulle et dans la légende/le filtre du bloc carte (voir mountCarteLeaflet).
const CIRC_HUE_STEP_DEG = 137.508;
const CIRC_SATURATION_PCT = 68;
const CIRC_LIGHTNESS_PCT = 48;

function hashSeedAngle(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function hslToHex(h, s, l) {
  const sf = s / 100; const lf = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sf * Math.min(lf, 1 - lf);
  const f = (n) => lf - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
}

// circonscriptions : tableau de { uai, codeDepartement } (nom non nécessaire ici). Ordre de tri
// fixe (département puis UAI) pour que deux actualisations successives de la même académie ne
// redistribuent pas les couleurs sans raison si l'API renvoie ses pages dans un ordre différent —
// seul un changement réel de l'ensemble des circonscriptions (création/fermeture, rare) décale les
// indices suivants. Renvoie une Map UAI circonscription -> couleur hexadécimale.
function assignCirconscriptionColors(codeAcademique, circonscriptions) {
  const seed = hashSeedAngle(codeAcademique);
  const sorted = circonscriptions.slice().sort((a, b) => (
    (a.codeDepartement || '').localeCompare(b.codeDepartement || '')
    || (a.uai || '').localeCompare(b.uai || '')
  ));
  const colorByUai = new Map();
  sorted.forEach((c, i) => {
    const hue = (seed + i * CIRC_HUE_STEP_DEG) % 360;
    colorByUai.set(c.uai, hslToHex(hue, CIRC_SATURATION_PCT, CIRC_LIGHTNESS_PCT));
  });
  return colorByUai;
}

async function upsertEtablissementsLocaux(codeAcademique, apiRows) {
  await loadTable(ETAB_NATIONAL_TABLE); // copie fraîche avant de comparer, pour ne jamais écraser une actualisation concurrente
  const existing = T(ETAB_NATIONAL_TABLE).filter((r) => (r.Code_academie || '').trim() === codeAcademique);
  const existingByUai = new Map(existing.map((r) => [(r.UAI || '').trim().toUpperCase(), r]));
  const seenUai = new Set();
  const now = Math.floor(Date.now() / 1000);
  const addActions = [];
  const updateActions = [];

  // 50e échange — 1er passage : recenser toutes les circonscriptions présentes dans ce lot (celles
  // référencées par une école via code_circonscription, ET celles qui sont elles-mêmes une ligne
  // Type_etablissement = 'Service Administratif' / Libelle_nature = CIRCONSCRIPTION_NATURE, au cas
  // où l'API ne renseignerait pas code_circonscription sur la ligne de la circonscription
  // elle-même), pour leur attribuer une couleur avant le 2e passage qui construit `fields`.
  const circMap = new Map(); // UAI circonscription -> { uai, nom, codeDepartement }
  apiRows.forEach((r) => {
    const codeCirc = String(r.code_circonscription || r.Code_circonscription || '').trim().toUpperCase();
    const nomCirc = r.nom_circonscription || r.Nom_circonscription || '';
    if (codeCirc) {
      if (!circMap.has(codeCirc)) {
        circMap.set(codeCirc, { uai: codeCirc, nom: nomCirc, codeDepartement: String(r.Code_departement || '').trim() });
      } else if (nomCirc && !circMap.get(codeCirc).nom) {
        circMap.get(codeCirc).nom = nomCirc;
      }
    }
    const natureRow = (r.libelle_nature || r.Libelle_nature || '').trim().toUpperCase();
    if (natureRow === CIRCONSCRIPTION_NATURE) {
      const ownUai = String(r.Identifiant_de_l_etablissement || '').trim().toUpperCase();
      if (ownUai && !circMap.has(ownUai)) {
        circMap.set(ownUai, { uai: ownUai, nom: r.Nom_etablissement || '', codeDepartement: String(r.Code_departement || '').trim() });
      }
    }
  });
  const colorByCircUai = assignCirconscriptionColors(codeAcademique, Array.from(circMap.values()));

  apiRows.forEach((r) => {
    const uai = String(r.Identifiant_de_l_etablissement || '').trim().toUpperCase();
    if (!uai) return;
    seenUai.add(uai);
    // 50e échange : rattachement à une circonscription — code_circonscription pour une école ; à
    // défaut (ligne de la circonscription elle-même, si l'API ne se référence pas elle-même), son
    // propre UAI. Voir circMap ci-dessus pour le nom et la couleur associés.
    const codeCirc = String(r.code_circonscription || r.Code_circonscription || '').trim().toUpperCase();
    const natureThisRow = (r.libelle_nature || r.Libelle_nature || '').trim().toUpperCase();
    const effectiveCircUai = codeCirc || (natureThisRow === CIRCONSCRIPTION_NATURE ? uai : '');
    const circInfo = effectiveCircUai ? circMap.get(effectiveCircUai) : null;
    const effectiveCircNom = circInfo ? (circInfo.nom || (natureThisRow === CIRCONSCRIPTION_NATURE ? (r.Nom_etablissement || '') : '')) : '';
    const fields = {
      UAI: uai,
      Nom_etablissement: r.Nom_etablissement || '',
      Type_etablissement: r.Type_etablissement || '',
      Statut_public_prive: r.Statut_public_prive || '',
      Type_contrat_prive: r.Type_contrat_prive || '',
      Ministere_tutelle: r.ministere_tutelle || r.Ministere_tutelle || '',
      Statut: r.etat || r.Etat || '',
      // 48e échange : distingue les circonscriptions d'inspection (CIRCONSCRIPTION_NATURE) des deux
      // autres natures administratives qui partagent le même Type_etablissement = 'Service
      // Administratif' (services DSDEN, directions départementales) — voir mountCarteLeaflet et
      // openEtabPersonnelModal. Nouvelle colonne côté Grist, voir modele-de-donnees.md.
      Libelle_nature: r.libelle_nature || r.Libelle_nature || '',
      Code_departement: String(r.Code_departement || '').trim(),
      Libelle_departement: r.Libelle_departement || '',
      Code_academie: String(r.Code_academie || codeAcademique || '').trim(),
      Libelle_academie: r.Libelle_academie || '',
      Latitude: typeof r.latitude === 'number' ? r.latitude : null,
      Longitude: typeof r.longitude === 'number' ? r.longitude : null,
      Modifie_le: now,
      Actif: true,
      // 50e échange : voir assignCirconscriptionColors ci-dessus pour la méthode de calcul de la
      // couleur (cartographique, pas pastel-tableur) et modele-de-donnees.md pour le détail complet.
      UAI_circonscription: effectiveCircUai,
      Nom_circonscription: effectiveCircNom,
      Couleur_circonscription: effectiveCircUai ? (colorByCircUai.get(effectiveCircUai) || '') : '',
    };
    const existingRow = existingByUai.get(uai);
    if (existingRow) updateActions.push(['UpdateRecord', ETAB_NATIONAL_TABLE, existingRow.id, fields]);
    else addActions.push(['AddRecord', ETAB_NATIONAL_TABLE, null, fields]);
  });
  const toDeactivate = existing.filter((r) => r.Actif && !seenUai.has((r.UAI || '').trim().toUpperCase()));
  const deactivateActions = toDeactivate.map((r) => ['UpdateRecord', ETAB_NATIONAL_TABLE, r.id, { Actif: false, Modifie_le: now }]);

  const BATCH = 300; // évite une action utilisateur Grist démesurément grosse pour une grosse académie
  const allActions = addActions.concat(updateActions).concat(deactivateActions);
  for (let i = 0; i < allActions.length; i += BATCH) {
    await grist.docApi.applyUserActions(allActions.slice(i, i + BATCH));
  }
  await loadTable(ETAB_NATIONAL_TABLE);
  return { added: addActions.length, updated: updateActions.length, markedInactive: deactivateActions.length };
}

let etabRefreshInProgress = false;

async function refreshEtablissementsAcademie(btnEl, progressEl) {
  if (etabRefreshInProgress) return;
  const acadRow = state.academieId ? byId('Reference', state.academieId) : null;
  const code = acadRow ? String(acadRow.Code_academique || '').trim() : '';
  if (!code) { flashError('Actualisation impossible', new Error('Code académique introuvable pour cette académie (colonne Reference.Code_academique).')); return; }
  etabRefreshInProgress = true;
  if (btnEl) btnEl.disabled = true;
  if (progressEl) { progressEl.hidden = false; progressEl.textContent = 'Démarrage…'; }
  try {
    const apiRows = await fetchEtablissementsAcademieFromApi(code, (n, total) => {
      if (progressEl) progressEl.textContent = 'Récupération en cours… ' + n + (total !== null ? ' / ' + total : '') + ' établissement(s).';
    });
    if (progressEl) progressEl.textContent = 'Écriture dans le document…';
    const summary = await upsertEtablissementsLocaux(code, apiRows);
    showFlash('Annuaire actualisé pour ' + state.academieNom + ' : ' + summary.added + ' ajouté(s), ' + summary.updated + ' mis à jour, ' + summary.markedInactive + ' marqué(s) inactif(s).', 'ok');
    render();
  } catch (err) {
    flashError('Échec de l’actualisation de l’annuaire des établissements', err);
    if (progressEl) progressEl.hidden = true;
  } finally {
    etabRefreshInProgress = false;
    if (btnEl) btnEl.disabled = false;
  }
}

// 47e échange — écran d'ajustement (Cible auto) : une ligne par couple établissement × fonction,
// upsert par (Academie, UAI_etablissement, Fonction) puisque Grist n'a pas de contrainte d'unicité
// native (même convention que partout ailleurs dans ce projet).
async function saveAjustement(uaiRaw, fonction, cibleRaw, commentaire) {
  const uai = normalizeUai(uaiRaw);
  if (!uai) { flashError('Ajustement impossible', new Error('Choisissez un établissement.')); return; }
  if (!fonction) { flashError('Ajustement impossible', new Error('Choisissez une fonction.')); return; }
  const cible = Number(cibleRaw);
  if (!Number.isFinite(cible) || cible < 0) { flashError('Ajustement impossible', new Error('La cible doit être un nombre entier positif ou nul.')); return; }
  try {
    const etab = T(ETAB_NATIONAL_TABLE).filter((r) => normalizeUai(r.UAI) === uai)[0];
    // 56e échange : normalizeFonction(o.Fonction) — `fonction` (paramètre) vient toujours d'un
    // <select> peuplé depuis FONCTION_CIBLE_PAR_TYPE, donc toujours le libellé actuel (ex.
    // 'Secrétaire général'). Sans normaliser la valeur déjà stockée, un ajustement existant saisi
    // sous l'ancien libellé « Adjoint gestionnaire » ne serait jamais retrouvé ici : on créerait un
    // second AddRecord au lieu de mettre à jour l'ajustement existant.
    const existing = T(OVERRIDES_TABLE).filter((o) => o.Academie === state.academieId && normalizeUai(o.UAI_etablissement) === uai && normalizeFonction(o.Fonction) === fonction)[0];
    const fields = {
      Academie: state.academieId,
      UAI_etablissement: uai,
      Nom_etablissement: etab ? etab.Nom_etablissement : '',
      Fonction: fonction,
      Cible: Math.round(cible),
      Commentaire: commentaire || '',
    };
    if (existing) await grist.docApi.applyUserActions([['UpdateRecord', OVERRIDES_TABLE, existing.id, fields]]);
    else await grist.docApi.applyUserActions([['AddRecord', OVERRIDES_TABLE, null, fields]]);
    await loadTable(OVERRIDES_TABLE);
    showFlash('Ajustement enregistré pour ' + (etab ? etab.Nom_etablissement : uai) + '.', 'ok');
    render();
  } catch (err) {
    flashError('Erreur lors de l’enregistrement de l’ajustement', err);
  }
}

async function removeAjustement(id) {
  try {
    await grist.docApi.applyUserActions([['RemoveRecord', OVERRIDES_TABLE, id]]);
    await loadTable(OVERRIDES_TABLE);
    showFlash('Ajustement retiré — cible par défaut (1 poste) rétablie.', 'ok');
    render();
  } catch (err) {
    flashError('Erreur lors de la suppression de l’ajustement', err);
  }
}

// 64e échange — voir la note complète au-dessus de renderObjectifCard(). Upsert par (Academie,
// Annee), même principe que saveAjustement()/OVERRIDES_TABLE ci-dessus (Grist n'a pas de contrainte
// d'unicité native). Un champ laissé vide est envoyé comme 0 plutôt que par un RemoveRecord séparé :
// le reste du widget (computeData(), tous les blocs « Prévisionnel ») traite déjà 0 exactement comme
// « aucun objectif renseigné » (vérifié par grep sur d.stagesPrevu/d.personnelsPrevu, toujours
// utilisés en contexte booléen) — pas besoin d'un second chemin pour obtenir le même résultat affiché.
async function saveObjectifPrevisionnel(stagesRaw, persRaw) {
  const stages = Number(stagesRaw || 0);
  const pers = Number(persRaw || 0);
  if (!Number.isFinite(stages) || stages < 0 || !Number.isFinite(pers) || pers < 0) {
    flashError('Objectif invalide', new Error('Les deux valeurs doivent être des nombres entiers positifs ou nuls.'));
    return;
  }
  const annee = currentAnneeScolaire();
  try {
    const existing = T('Objectifs_previsionnels').filter((o) => o.Academie === state.academieId && o.Annee === annee)[0];
    const fields = { Academie: state.academieId, Annee: annee, Stages_prevus: Math.round(stages), Personnels_a_former_prevus: Math.round(pers) };
    if (existing) await grist.docApi.applyUserActions([['UpdateRecord', 'Objectifs_previsionnels', existing.id, fields]]);
    else await grist.docApi.applyUserActions([['AddRecord', 'Objectifs_previsionnels', null, fields]]);
    await loadTable('Objectifs_previsionnels');
    showFlash('Objectif prévisionnel enregistré pour ' + annee + '.', 'ok');
    render();
  } catch (err) {
    flashError('Erreur lors de l’enregistrement de l’objectif prévisionnel', err);
  }
}

/* ---------------------------------------------------------------------- */
/* Glisser-déposer libre + clavier (grille de la disposition)             */
/* ---------------------------------------------------------------------- */

function commitMove(id, newCol, newRow) {
  const blocks = state.blocks.map((b) => Object.assign({}, b));
  const moving = blocks.filter((b) => b.id === id)[0];
  if (!moving) return;
  newCol = clamp(newCol, 1, COLS - moving.colSpan + 1);
  newRow = clamp(newRow, 1, VISIBLE_ROWS - moving.rowSpan + 1);
  const targetRect = { col: newCol, row: newRow, colSpan: moving.colSpan, rowSpan: moving.rowSpan };
  const origCol = moving.col, origRow = moving.row;
  let swapWith = null;
  for (const b of blocks) { if (b.id !== id && rectsOverlap(targetRect, b)) { swapWith = b; break; } }
  moving.col = newCol; moving.row = newRow;
  if (swapWith) { swapWith.col = origCol; swapWith.row = origRow; }
  state.blocks = blocks;
  state.dirty = true;
  render();
}

function commitResize(id, newColSpan, newRowSpan) {
  const blocks = state.blocks.map((b) => Object.assign({}, b));
  const target = blocks.filter((b) => b.id === id)[0];
  if (!target) return;
  const others = blocks.filter((b) => b.id !== id);
  const wantedColSpan = clamp(newColSpan, 1, COLS - target.col + 1);
  const wantedRowSpan = clamp(newRowSpan, 1, VISIBLE_ROWS - target.row + 1);
  const overlapsAny = (colSpan, rowSpan) => others.some((b) => rectsOverlap({ col: target.col, row: target.row, colSpan, rowSpan }, b));
  // Un agrandissement ne doit jamais faire apparaître un bloc par-dessus un autre déjà en place
  // (contrairement à commitMove, qui échange explicitement deux blocs) — on réduit donc la
  // demande au plus grand format qui reste sans chevauchement, plutôt que de laisser deux cartes
  // se superposer visuellement (disposition non harmonieuse signalée par l'utilisateur, 41e
  // échange).
  let rowSpan = wantedRowSpan;
  while (rowSpan > 1 && overlapsAny(wantedColSpan, rowSpan)) rowSpan--;
  let colSpan = wantedColSpan;
  while (colSpan > 1 && overlapsAny(colSpan, rowSpan)) colSpan--;
  if (overlapsAny(colSpan, rowSpan)) { colSpan = target.colSpan; rowSpan = target.rowSpan; }
  target.colSpan = colSpan;
  target.rowSpan = rowSpan;
  state.blocks = blocks;
  state.dirty = true;
  render();
}

let dragCtx = null;
let resizeCtx = null;

function onDragPointerMove(e) {
  if (!dragCtx) return;
  const rect = dragCtx.gridRect;
  const colW = rect.width / COLS;
  let col = Math.floor((e.clientX - rect.left) / colW) + 1;
  let row = Math.floor((e.clientY - rect.top) / dragCtx.rowUnit) + 1;
  col = clamp(col, 1, COLS - dragCtx.colSpan + 1);
  row = clamp(row, 1, VISIBLE_ROWS - dragCtx.rowSpan + 1);
  dragCtx.previewCol = col; dragCtx.previewRow = row;
  dragCtx.el.style.gridColumn = col + ' / span ' + dragCtx.colSpan;
  dragCtx.el.style.gridRow = row + ' / span ' + dragCtx.rowSpan;
  dragCtx.el.classList.add('is-active-drag');
}
function onDragPointerUp() {
  document.removeEventListener('pointermove', onDragPointerMove);
  document.removeEventListener('pointerup', onDragPointerUp);
  if (dragCtx) { const { id, previewCol, previewRow } = dragCtx; dragCtx = null; commitMove(id, previewCol, previewRow); }
}

function onResizePointerMove(e) {
  if (!resizeCtx) return;
  const rect = resizeCtx.gridRect;
  const colW = rect.width / COLS;
  let col = Math.floor((e.clientX - rect.left) / colW) + 1;
  let row = Math.floor((e.clientY - rect.top) / resizeCtx.rowUnit) + 1;
  const colSpan = clamp(col - resizeCtx.col + 1, 1, COLS - resizeCtx.col + 1);
  const rowSpan = clamp(row - resizeCtx.row + 1, 1, VISIBLE_ROWS - resizeCtx.row + 1);
  resizeCtx.previewColSpan = colSpan; resizeCtx.previewRowSpan = rowSpan;
  resizeCtx.el.style.gridColumn = resizeCtx.col + ' / span ' + colSpan;
  resizeCtx.el.style.gridRow = resizeCtx.row + ' / span ' + rowSpan;
  resizeCtx.el.classList.add('is-active-drag');
}
function onResizePointerUp() {
  document.removeEventListener('pointermove', onResizePointerMove);
  document.removeEventListener('pointerup', onResizePointerUp);
  if (resizeCtx) { const { id, previewColSpan, previewRowSpan } = resizeCtx; resizeCtx = null; commitResize(id, previewColSpan, previewRowSpan); }
}

const KEY_DELTA = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

// 52e échange : accepte désormais `d` (les données déjà calculées par render()) pour pouvoir câbler
// le bouton « Agrandir » du bloc carte (data-expand-carte -> openCarteExpandModal(d)) sans recalculer
// computeData() une seconde fois — un seul point d'appel (render(), juste avant mountCarteLeaflet),
// adapté en conséquence.
function bindEvents(d) {
  const btnTableau = document.getElementById('btnTabTableau');
  const btnCible = document.getElementById('btnTabCible');
  const btnParametres = document.getElementById('btnTabParametres');
  if (btnTableau) btnTableau.onclick = () => { state.tab = 'tableau'; render(); };
  if (btnCible) btnCible.onclick = () => { state.tab = 'cible'; render(); };
  if (btnParametres) btnParametres.onclick = () => { state.tab = 'parametres'; render(); };

  const devSelect = document.getElementById('devAcademieSelect');
  if (devSelect) devSelect.onchange = async (e) => {
    const acadId = Number(e.target.value);
    await grist.setOption('myAcademieId', acadId);
    state.options.myAcademieId = acadId;
    resolveAcademie();
    loadPrefsIntoState();
    render();
  };

  if (state.tab === 'tableau') {
    const btnToggleEdit = document.getElementById('btnToggleEdit');
    if (btnToggleEdit) btnToggleEdit.onclick = () => { state.editMode = !state.editMode; state.focusedId = null; render(); };

    const grid = document.getElementById('dashGrid');
    if (grid) {
      grid.querySelectorAll('.dash-block').forEach((el) => {
        const id = el.getAttribute('data-block-id');
        const handle = el.querySelector('[data-drag-handle]');
        const resizeHandle = el.querySelector('[data-resize-handle]');
        // 55e échange : retrait de la fonctionnalité Croisements — plus de bouton
        // `[data-remove-cx]` à câbler ici (voir renderTableauTab).
        if (handle) handle.addEventListener('pointerdown', (e) => {
          if (!state.editMode) return;
          e.preventDefault();
          const b = state.blocks.filter((x) => x.id === id)[0];
          dragCtx = { id, el, gridRect: grid.getBoundingClientRect(), rowUnit: el.parentElement.getBoundingClientRect().height ? (grid.getBoundingClientRect().height / VISIBLE_ROWS) : 114, colSpan: b.colSpan, rowSpan: b.rowSpan, previewCol: b.col, previewRow: b.row };
          // rowUnit calculé plus fiablement à partir de la grille elle-même (voir hauteur de ligne CSS + gap)
          dragCtx.rowUnit = (grid.getBoundingClientRect().height + 14) / VISIBLE_ROWS;
          state.focusedId = id;
          document.addEventListener('pointermove', onDragPointerMove);
          document.addEventListener('pointerup', onDragPointerUp);
        });
        if (resizeHandle) resizeHandle.addEventListener('pointerdown', (e) => {
          if (!state.editMode) return;
          e.preventDefault(); e.stopPropagation();
          const b = state.blocks.filter((x) => x.id === id)[0];
          resizeCtx = { id, el, gridRect: grid.getBoundingClientRect(), rowUnit: (grid.getBoundingClientRect().height + 14) / VISIBLE_ROWS, col: b.col, row: b.row, previewColSpan: b.colSpan, previewRowSpan: b.rowSpan };
          state.focusedId = id;
          document.addEventListener('pointermove', onResizePointerMove);
          document.addEventListener('pointerup', onResizePointerUp);
        });
        el.addEventListener('keydown', (e) => {
          if (!state.editMode) return;
          const delta = KEY_DELTA[e.key];
          if (!delta) return;
          e.preventDefault();
          state.focusedId = id;
          const b = state.blocks.filter((x) => x.id === id)[0];
          if (e.shiftKey) commitResize(id, b.colSpan + delta[0], b.rowSpan + delta[1]);
          else commitMove(id, b.col + delta[0], b.row + delta[1]);
        });
      });
    }
    // 52e échange : bouton « Agrandir » du bloc carte (data-expand-carte, voir renderTableauTab) ->
    // modale plein écran (openCarteExpandModal) ; n'existe dans le DOM que si le bloc carte est
    // affiché (voir syncBlocksWithChecks/state.checks), d'où le querySelector défensif plutôt qu'un
    // id direct. Remplace le binding `.etab-row-clickable[data-etab-nom]` du tableau d'établissements
    // (46e échange), retiré avec ce tableau lui-même (voir renderBlockBody('carte')).
    const btnExpandCarte = document.querySelector('[data-expand-carte]');
    if (btnExpandCarte) btnExpandCarte.onclick = () => openCarteExpandModal(d);
  } else if (state.tab === 'cible') {
    const secteurSelect = document.getElementById('secteurCibleSelect');
    if (secteurSelect) secteurSelect.onchange = (e) => { saveSecteurCible(e.target.value); };
    const tutelleSelect = document.getElementById('tutelleCibleSelect');
    if (tutelleSelect) tutelleSelect.onchange = (e) => { saveTutelleCible(e.target.value); };
    const btnGoToParametres = document.getElementById('btnGoToParametres');
    if (btnGoToParametres) btnGoToParametres.onclick = () => { state.tab = 'parametres'; render(); };

    // 47e échange : formulaire d'ajustement par établissement — la liste des fonctions proposées
    // dépend du type de l'établissement choisi (FONCTION_CIBLE_PAR_TYPE).
    const ajustEtabSelect = document.getElementById('ajustementEtabSelect');
    const ajustFonctionSelect = document.getElementById('ajustementFonctionSelect');
    if (ajustEtabSelect && ajustFonctionSelect) {
      ajustEtabSelect.onchange = () => {
        const uai = ajustEtabSelect.value;
        const etab = uai ? T(ETAB_NATIONAL_TABLE).filter((r) => r.UAI === uai)[0] : null;
        const fonctions = etab ? (FONCTION_CIBLE_PAR_TYPE[etab.Type_etablissement] || []) : [];
        ajustFonctionSelect.innerHTML = '<option value="">Fonction…</option>'
          + fonctions.map((f) => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>').join('');
      };
    }
    const btnAjouterAjustement = document.getElementById('btnAjouterAjustement');
    if (btnAjouterAjustement) btnAjouterAjustement.onclick = () => {
      const uai = document.getElementById('ajustementEtabSelect').value;
      const fonction = document.getElementById('ajustementFonctionSelect').value;
      const cible = document.getElementById('ajustementCibleInput').value;
      const commentaire = document.getElementById('ajustementCommentaireInput').value;
      saveAjustement(uai, fonction, cible, commentaire);
    };
    document.querySelectorAll('[data-remove-override]').forEach((el) => {
      el.onclick = () => { removeAjustement(Number(el.getAttribute('data-remove-override'))); };
    });
  } else {
    // 55e échange : retrait de la fonctionnalité Croisements — plus de gestionnaires
    // `[data-dim]`/`[data-mesure]`/`#btnAddCroisement`/`[data-remove-croisement]` à câbler ici (voir
    // renderParametresTab) ; syncBlocksWithChecks ne prend plus le 3e paramètre `croisements`.
    document.querySelectorAll('[data-block-check]').forEach((el) => {
      el.onchange = () => {
        const key = el.getAttribute('data-block-check');
        state.checks = Object.assign({}, state.checks, { [key]: el.checked });
        state.blocks = syncBlocksWithChecks(state.blocks, state.checks);
        state.dirty = true;
        render();
      };
    });
    const btnSave = document.getElementById('btnSavePrefs');
    if (btnSave) btnSave.onclick = savePrefs;

    const btnRefreshEtab = document.getElementById('btnRefreshEtablissements');
    if (btnRefreshEtab) btnRefreshEtab.onclick = () => {
      refreshEtablissementsAcademie(btnRefreshEtab, document.getElementById('refreshEtabProgress'));
    };

    const btnSaveObjectif = document.getElementById('btnSaveObjectif');
    if (btnSaveObjectif) btnSaveObjectif.onclick = () => {
      const stagesInput = document.getElementById('objectifStagesInput');
      const persInput = document.getElementById('objectifPersonnelsInput');
      saveObjectifPrevisionnel(stagesInput ? stagesInput.value : '', persInput ? persInput.value : '');
    };
  }
}

/* ---------------------------------------------------------------------- */
/* Messages flash                                                          */
/* ---------------------------------------------------------------------- */

function showFlash(msg, type) {
  const el = document.getElementById('flash');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  el.hidden = false;
  el.className = 'flash' + (type === 'error' ? ' error' : type === 'ok' ? ' ok' : '');
  clearTimeout(flashTimer);
  if (type === 'error') {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button'; closeBtn.className = 'flash-close'; closeBtn.textContent = '✕';
    closeBtn.onclick = () => { el.hidden = true; };
    el.appendChild(closeBtn);
  } else {
    flashTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }
}
function flashError(prefix, err) {
  console.error('[Pilotage académique]', prefix, err);
  showFlash(prefix + ' : ' + (err && err.message ? err.message : String(err)), 'error');
}

/* ---------------------------------------------------------------------- */
/* Démarrage                                                               */
/* ---------------------------------------------------------------------- */

optionsReady = new Promise((resolve) => {
  grist.onOptions((opts) => { state.options = opts || {}; resolve(); });
});

async function boot() {
  try {
    await optionsReady;
    await loadAll();
    resolveAcademie();
    loadPrefsIntoState();
    render();
  } catch (err) {
    document.getElementById('topbarSub').textContent = 'Erreur de chargement';
    flashError('Erreur de chargement des données Grist', err);
    console.error(err);
  }
}

boot();