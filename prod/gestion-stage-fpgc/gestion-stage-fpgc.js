/* ============================================================================
   Gestion de stage FPGC — widget personnalisé Grist (5 onglets)
   Accès complet à l'API Grist (widget non lié à une seule table).
   ========================================================================== */

grist.ready({ requiredAccess: 'full' });

/* ---------------------------------------------------------------------- */
/* Constantes                                                              */
/* ---------------------------------------------------------------------- */

const TABLES = [
  'Reference', 'Annuaire_FPGC', 'BD_Stages2', 'Administration_et_logistique',
  'Candidats_du_stage', 'Intervenants_du_stage', 'Planning_du_stage', 'Enquete_de_satisfaction',
  'Modules_de_formation', 'Emargement_du_stage', 'Parametres_widget',
  'Satisfaction_modules', // 29e échange — évaluation individuelle de chaque module, voir renderCloture
];

const DEMI_JOURNEES = ['Matin', 'Après-midi'];

const PLANNING_SLOT_MINUTES = 30;
const PLANNING_START_HOUR = 8;  // 08h00
const PLANNING_END_HOUR = 20;   // 20h00
const PLANNING_SLOT_COUNT = ((PLANNING_END_HOUR - PLANNING_START_HOUR) * 60) / PLANNING_SLOT_MINUTES; // 24
const PLANNING_ROW_PX = 26;

const CATEGORY_CODE = { 'F1': '10', 'F2': '20', 'F3': '30', 'ESA': '40', 'Recyclage F1': '11', 'Recyclage F2': '21' };
const CATEGORY_LABEL_BY_CODE = Object.fromEntries(Object.entries(CATEGORY_CODE).map(([k, v]) => [v, k]));

// Prérequis de parcours par niveau de stage — codé en dur (comme CATEGORY_CODE ci-dessus) car ces
// enchaînements sont fixes dans le dispositif FPGC. Une valeur null/absente = aucun prérequis.
const PREREQUIS_PAR_NIVEAU = {
  'F2': 'F1',
  'F3': 'F2',
  'ESA': 'F3',
  'Recyclage F1': 'F1',
  'Recyclage F2': 'F2',
};

const STATUT_BADGE_STAGE = { 'Brouillon': 'badge-brouillon', 'Clôturé': 'badge-cloture', 'Annulé': 'badge-annule' };
const STATUT_BADGE_CANDIDAT = { 'Candidat': 'badge-candidat', "Liste d'attente": 'badge-attente', 'Stagiaire': 'badge-stagiaire', 'Formé': 'badge-forme', 'Non retenu': 'badge-nonretenu' };

/* ---------------------------------------------------------------------- */
/* Formulaire de recrutement — liste de questions codée en dur (refonte    */
/* du 18e échange, voir processus-gestion-stage.md). Chaque question       */
/* pointe vers une colonne réelle de Candidats_du_stage (plus de table de  */
/* bibliothèque ni de table de réponses génériques) ; l'utilisateur peut,  */
/* par stage, masquer une question ou la rendre optionnelle — ce réglage   */
/* est persisté dans la table `Parametres_widget` (voir plus bas), pas en  */
/* colonne dédiée par question. `dependsOn` déclare une question qui n'a   */
/* de sens que si une autre question précédente porte une valeur donnée    */
/* (ex. la gare de train n'apparaît que si le mode de transport choisi est */
/* "Train") — c'est le widget public (formulaire-public.js) qui applique   */
/* cette logique à l'affichage. Le type spécial 'Lien' (décharge de        */
/* responsabilité) n'attend aucune réponse : c'est un simple lien vers un  */
/* document externe, dont l'URL est elle-même un réglage partagé (table    */
/* `Parametres_widget`) plutôt qu'un champ codé en dur, puisqu'elle dépend */
/* d'un hébergement propre à chaque académie/document.                     */
/*                                                                          */
/* Pourquoi une table plutôt qu'un simple réglage de widget (grist.setOption*/
/* / onOptions), comme pour sousGroupesParStage ou intervenantColors plus  */
/* bas ? Parce que ce réglage doit être lu par DEUX widgets distincts : ce  */
/* widget principal (qui l'écrit depuis l'onglet Stagiaires) ET le widget  */
/* public formulaire-public.js (qui doit le lire pour savoir quelles       */
/* questions afficher). Or grist.setOption/onOptions est un stockage propre*/
/* à CHAQUE section de widget dans le document (chaque page où un widget   */
/* est posé a son propre stockage d'options, même si c'est le même fichier */
/* JS chargé deux fois) — un widget ne peut pas lire les options d'un      */
/* autre. Seule une vraie table Grist, lue via grist.docApi.fetchTable,    */
/* est visible depuis n'importe quel widget du document. D'où cette petite */
/* table générique (Cle/Valeur, valeurs JSON pour les objets) plutôt qu'un */
/* schéma dédié par réglage — même esprit que le choix initial (éviter la  */
/* prolifération de colonnes), juste réalisé différemment pour rester      */
/* lisible entre les deux widgets. Voir modele-de-donnees.md, 19e échange. */
/* ---------------------------------------------------------------------- */

const QUESTIONS_RECRUTEMENT = [
  // Catégorie A — Identité professionnelle (alignée sur les colonnes d'Annuaire_FPGC quand elles
  // existent ; Nom/Prénom/Mél restent hors de cette liste, toujours affichés, jamais masquables).
  { id: 'academie', categorie: 'Identité professionnelle', libelle: "Académie d'affectation", type: 'Choix', optionsSource: 'academies', colonneCible: 'Academie_d_affectation', obligatoireParDefaut: true, ordre: 10 },
  // 45e échange : deux colonnes cibles distinctes (nom autocomplete + UAI lecture seule) — copie
  // exacte de la même entrée dans formulaire-public.js, voir la note de duplication en tête de fichier.
  { id: 'etablissement', categorie: 'Identité professionnelle', libelle: "Établissement d'affectation", type: 'EtablissementUAI', colonneCibleNom: 'Nom_etablissement_d_affectation', colonneCibleUai: 'UAI_etablissement_d_affectation', obligatoireParDefaut: true, ordre: 20 },
  // 46e échange : nouvelle question « Fonction » à liste fixe, qui tranche le point resté ouvert
  // depuis le 40e échange (données de statut — Grade/Discipline — vs données de fonction réellement
  // exercée, voir processus-gestion-stage.md). Liste par défaut proposée par l'assistant et validée
  // par l'utilisateur, alignée sur le périmètre habituel du FPGC (personnels de direction/gestion) ;
  // sert de numérateur à la ventilation par fonction du widget pilotage académique (cible automatique
  // par établissement, pilotage-academique.js). `Grade_long`/`Discipline_d_exercice` restent
  // inchangées, collectées indépendamment (les deux axes coexistent, comme envisagé au 40e échange).
  // 56e échange : « Adjoint gestionnaire » est renommé « Secrétaire général » (même poste) et
  // fusionné avec l'ancienne fonction « Secrétaire général » (sans cible) — 8 -> 7 valeurs. Voir
  // pilotage-academique.js (FONCTION_CIBLE_PAR_TYPE/normalizeFonction) pour la compatibilité avec les
  // fiches déjà saisies sous l'ancien libellé.
  { id: 'fonction', categorie: 'Identité professionnelle', libelle: 'Fonction', type: 'Choix', optionsChoix: "Proviseur;Proviseur adjoint;Principal;Principal adjoint;Directeur d'école;Secrétaire général;Autre", colonneCible: 'Fonction', obligatoireParDefaut: true, ordre: 25 },
  { id: 'grade', categorie: 'Identité professionnelle', libelle: 'Grade', type: 'Texte', colonneCible: 'Grade_long', obligatoireParDefaut: true, ordre: 30 },
  { id: 'discipline', categorie: 'Identité professionnelle', libelle: "Discipline d'exercice", type: 'Texte', colonneCible: 'Discipline_d_exercice', obligatoireParDefaut: false, ordre: 40 },
  { id: 'date_naissance', categorie: 'Identité professionnelle', libelle: 'Date de naissance', type: 'Date', colonneCible: 'Date_de_naissance', obligatoireParDefaut: true, ordre: 50 },
  { id: 'lieu_naissance', categorie: 'Identité professionnelle', libelle: 'Lieu de naissance', type: 'Texte', colonneCible: 'Lieu_de_naissance', obligatoireParDefaut: true, ordre: 60 },
  { id: 'telephone', categorie: 'Identité professionnelle', libelle: 'Numéro de téléphone portable', type: 'Texte', colonneCible: 'Telephone_portable', obligatoireParDefaut: true, ordre: 70 },

  // Catégorie B — Logistique du séjour. Le mode de transport est volontairement placé avant les
  // dates d'arrivée/départ (demande explicite) ; ses deux valeurs Train/Voiture révèlent chacune des
  // questions complémentaires (dependsOn) que le futur widget public affichera conditionnellement.
  { id: 'transport', categorie: 'Logistique du séjour', libelle: 'Mode de transport', type: 'Choix', optionsChoix: 'Train;Voiture personnelle;Covoiturage;Avion;Autre', colonneCible: 'Mode_transport', obligatoireParDefaut: false, ordre: 80 },
  { id: 'transport_gare', categorie: 'Logistique du séjour', libelle: "Gare d'arrivée", type: 'Texte', colonneCible: 'Gare_arrivee', obligatoireParDefaut: false, ordre: 81, dependsOn: { question: 'transport', equals: 'Train' } },
  { id: 'transport_vehicule', categorie: 'Logistique du séjour', libelle: 'Véhicule — marque, modèle, couleur', type: 'Texte', colonneCible: 'Vehicule_marque_modele_couleur', obligatoireParDefaut: false, ordre: 82, dependsOn: { question: 'transport', equals: 'Voiture personnelle' } },
  { id: 'transport_immat', categorie: 'Logistique du séjour', libelle: 'Immatriculation du véhicule', type: 'Texte', colonneCible: 'Vehicule_immatriculation', obligatoireParDefaut: false, ordre: 83, dependsOn: { question: 'transport', equals: 'Voiture personnelle' } },
  { id: 'date_heure_arrivee', categorie: 'Logistique du séjour', libelle: "Date et heure d'arrivée prévues", type: 'DateHeure', colonneCible: 'Date_heure_arrivee', obligatoireParDefaut: false, ordre: 90 },
  { id: 'date_heure_depart', categorie: 'Logistique du séjour', libelle: 'Date et heure de départ prévues', type: 'DateHeure', colonneCible: 'Date_heure_depart', obligatoireParDefaut: false, ordre: 91 },
  { id: 'hebergement', categorie: 'Logistique du séjour', libelle: "Besoin d'un hébergement sur place", type: 'Case à cocher', colonneCible: 'Besoin_hebergement', obligatoireParDefaut: false, ordre: 100, note: "Pertinente seulement si le stage a un internat (voir l'onglet Préparation logistique) — à masquer sinon." },
  { id: 'regime', categorie: 'Logistique du séjour', libelle: 'Régime alimentaire particulier / allergies', type: 'Texte', colonneCible: 'Regime_alimentaire', obligatoireParDefaut: false, ordre: 110 },

  // Catégorie C — Droits
  { id: 'droit_image', categorie: 'Droits', libelle: "Droit à l'image", type: 'Choix', optionsChoix: 'Accepte;Refuse', colonneCible: 'Droit_a_limage', obligatoireParDefaut: true, ordre: 120 },

  // Catégorie D — Habillement (tailles en texte libre, sans échelle imposée)
  { id: 'taille_haut', categorie: 'Habillement', libelle: 'Taille du haut (treillis)', type: 'Texte', colonneCible: 'Taille_haut_treillis', obligatoireParDefaut: true, ordre: 130 },
  { id: 'taille_pantalon', categorie: 'Habillement', libelle: 'Taille du pantalon (treillis)', type: 'Texte', colonneCible: 'Taille_pantalon_treillis', obligatoireParDefaut: true, ordre: 140 },

  // Catégorie E — Décharge de responsabilité : simple lien vers le PDF externe, aucune réponse
  // collectée (voir la discussion du 18e échange — pas de signature électronique implémentée).
  { id: 'decharge', categorie: 'Décharge de responsabilité', libelle: 'Décharge de responsabilité à lire, signer et apporter le jour du stage', type: 'Lien', colonneCible: null, urlOption: true, obligatoireParDefaut: false, ordre: 150 },
];

const CATEGORIES_QUESTIONS_RECRUTEMENT = [...new Set(QUESTIONS_RECRUTEMENT.map((q) => q.categorie))];

/* ---------------------------------------------------------------------- */
/* Socle de l'enquête de satisfaction (29e échange) — copie exacte de       */
/* QUESTIONS_SATISFACTION dans enquete-satisfaction.js (même principe de    */
/* duplication volontaire que QUESTIONS_RECRUTEMENT ci-dessus, voir la note */
/* juste au-dessus). `obligatoireFixe: true` = jamais configurable depuis   */
/* l'écran ci-dessous (voir renderConfigSatisfaction/bindConfigSatisfaction */
/* plus bas) — contrairement au recrutement, aucune question du socle       */
/* satisfaction ne se masque, seul le caractère facultatif/obligatoire se   */
/* configure (décision explicite de l'utilisateur). Les questions par       */
/* module ne figurent pas ici : elles sont générées dynamiquement depuis    */
/* Planning_du_stage par enquete-satisfaction.js, pas configurables ici.    */
/* ---------------------------------------------------------------------- */

const QUESTIONS_SATISFACTION = [
  { id: 'globale', libelle: 'Note globale de satisfaction (1 à 5)', colonneCible: 'Note_globale', obligatoireFixe: true, ordre: 10 },
  { id: 'intervenants', libelle: 'Note sur les intervenants / formateurs (1 à 5)', colonneCible: 'Note_intervenants', obligatoireParDefaut: true, ordre: 20 },
  { id: 'contenu', libelle: 'Note sur le contenu pédagogique (1 à 5)', colonneCible: 'Note_contenu', obligatoireParDefaut: true, ordre: 30 },
  { id: 'logistique', libelle: 'Note sur la logistique — hébergement, restauration, transport (1 à 5)', colonneCible: 'Note_logistique', obligatoireParDefaut: true, ordre: 40 },
  { id: 'rythme', libelle: 'Le rythme de la formation (horaires, pauses) était-il adapté ?', colonneCible: 'Rythme_adapte', obligatoireParDefaut: false, ordre: 50 },
  { id: 'duree', libelle: 'La durée du stage était-elle adaptée ?', colonneCible: 'Duree_adaptee', obligatoireParDefaut: false, ordre: 60 },
  { id: 'recommandation', libelle: 'Recommanderiez-vous ce stage à un collègue ?', colonneCible: 'Recommanderiez_vous', obligatoireParDefaut: false, ordre: 70 },
  { id: 'commentaire', libelle: 'Commentaire libre (points forts, améliorations suggérées)', colonneCible: 'Commentaire', obligatoireParDefaut: false, ordre: 80 },
];

// Échelle des réponses par module (voir enquete-satisfaction.js) — utilisée ici uniquement pour
// afficher le détail des réponses dans le bilan de clôture (renderCloture), jamais pour la saisie
// (ce widget ne construit pas le formulaire de satisfaction lui-même).
const ECHELLE_MODULE = ["Tout à fait d'accord", "Plutôt d'accord", 'Plutôt en désaccord', 'Totalement en désaccord'];

/* ---------------------------------------------------------------------- */
/* Couche de données Grist                                                 */
/* ---------------------------------------------------------------------- */

const DB = {};

// Correspondance table logique (nom utilisé par le code, voir TABLES ci-dessus) -> nom réel de la
// table dans le document Grist effectivement ouvert. Alimentée depuis l'écran "Paramètres" (onglet
// dédié, voir renderParametres/bindParametres) et persistée en option de widget (tableMap) ; une
// entrée absente ou vide = utiliser le nom logique tel quel. Le reste du code continue de désigner
// les tables par leur nom logique partout (DB, T(), byId()...) — seule la frontière avec l'API Grist
// (fetchTable / applyUserActions) traduit vers le nom réel, ici.
function physTable(tableId) {
  const map = (state.options && state.options.tableMap) || {};
  const real = map[tableId];
  return (real && real.trim()) || tableId;
}

async function loadTable(tableId) {
  const data = await grist.docApi.fetchTable(physTable(tableId));
  const cols = Object.keys(data).filter((k) => k !== 'id');
  const rows = data.id.map((id, i) => {
    const row = { id };
    cols.forEach((c) => { row[c] = data[c][i]; });
    return row;
  });
  // `cols` reflète les colonnes RÉELLEMENT présentes sur le document (fetchTable renvoie une clé
  // par colonne existante, même pour une table à 0 ligne) — mémorisé ici pour que hasColumn()
  // ci-dessous puisse distinguer une colonne optionnelle pas encore créée sur le document réel
  // d'une colonne existante simplement vide. Voir hasColumn() pour pourquoi c'est nécessaire.
  DB[tableId] = { rows, byId: new Map(rows.map((r) => [r.id, r])), cols: new Set(cols) };
  return DB[tableId];
}

// Certaines colonnes ajoutées à ce projet restent optionnelles tant que l'utilisateur ne les a pas
// posées sur le document réel (ex. Planning_du_stage.Sous_groupe, 59e échange — voir
// checklist-mise-en-production.md §1/§7). Lire un champ absent renvoie silencieusement `undefined`
// (déjà géré partout dans ce fichier), mais ÉCRIRE un champ absent d'une table lève une erreur
// Grist fatale (« [Sandbox] KeyError '<colonne>' ») qui bloque toute la création/modification, pas
// seulement la valeur de ce champ. Ce garde-fou permet d'omettre le champ des actions d'écriture
// tant que la colonne n'existe pas, plutôt que de bloquer l'ensemble du formulaire — dès que la
// colonne est ajoutée sur le document réel, elle est automatiquement détectée au prochain
// chargement de la table, sans qu'aucun code n'ait besoin d'être republié.
function hasColumn(tableId, colName) {
  return !!(DB[tableId] && DB[tableId].cols && DB[tableId].cols.has(colName));
}

async function loadAll() {
  await Promise.all(TABLES.map(loadTable));
}

// Table `Parametres_widget` (Cle Text, Valeur Text) : réglages partagés entre ce widget et le futur
// widget public (formulaire-public.js), voir la note au-dessus de QUESTIONS_RECRUTEMENT expliquant
// pourquoi grist.setOption ne convient pas ici. Les objets (ex. formulaireConfig) sont stockés en
// JSON dans Valeur ; les chaînes simples (URL) sont stockées telles quelles.
function paramWidgetRaw(cle) {
  const row = T('Parametres_widget').find((r) => r.Cle === cle);
  return row ? row.Valeur : '';
}

function loadParametresWidgetIntoState() {
  let cfg = {};
  try { cfg = JSON.parse(paramWidgetRaw('formulaireConfig') || '{}'); } catch (err) { cfg = {}; }
  state.options.formulaireConfig = cfg;
  state.options.dechargeUrl = paramWidgetRaw('dechargeUrl') || '';
  state.options.baseUrlFormulairePublic = paramWidgetRaw('baseUrlFormulairePublic') || '';
  // 29e échange — mêmes réglages partagés, pour l'espace pédagogique (espace-stagiaire.js) et
  // l'enquête de satisfaction (enquete-satisfaction.js), voir la note au-dessus de QUESTIONS_RECRUTEMENT.
  let cfgSat = {};
  try { cfgSat = JSON.parse(paramWidgetRaw('satisfactionConfig') || '{}'); } catch (err) { cfgSat = {}; }
  state.options.satisfactionConfig = cfgSat;
  state.options.baseUrlEspaceStagiaire = paramWidgetRaw('baseUrlEspaceStagiaire') || '';
  state.options.baseUrlEnqueteSatisfaction = paramWidgetRaw('baseUrlEnqueteSatisfaction') || '';
  // 35e échange — voir la note dans state.options ci-dessus.
  state.options.baseUrlDocument = paramWidgetRaw('baseUrlDocument') || '';
  state.options.pageIdFormulairePublic = paramWidgetRaw('pageIdFormulairePublic') || '';
  state.options.pageIdEspaceStagiaire = paramWidgetRaw('pageIdEspaceStagiaire') || '';
  state.options.pageIdEnqueteSatisfaction = paramWidgetRaw('pageIdEnqueteSatisfaction') || '';
  // 61e échange :
  state.options.pageIdDonneesPersonnelles = paramWidgetRaw('pageIdDonneesPersonnelles') || '';
  updateFooterLienDonnees();
}

// 61e échange — peuple le lien « Données personnelles » du pied de page (hors de #main, voir
// gestion-stage-fpgc.html : jamais effacé par render()) à partir de pageIdDonneesPersonnelles. Tant
// que ce réglage n'est pas renseigné dans Parametres_widget (l'utilisateur doit d'abord héberger
// donnees-personnelles.html comme page Grist puis noter son numéro de page — voir
// checklist-mise-en-production.md), le lien reste affiché mais désactivé, avec une info-bulle
// explicative — même esprit que les avertissements « pas encore configuré » déjà en place ailleurs
// dans ce widget (ex. fc-setup-warning/sc-setup-warning).
function updateFooterLienDonnees() {
  // Défensif (62e échange, tour suivant) : ce pied de page est un simple confort d'affichage, jamais
  // sur le chemin critique du chargement des données. Un incident ici (DOM inattendu, etc.) ne doit
  // en aucun cas se propager et interrompre loadParametresWidgetIntoState()/resolveStage()/boot() —
  // voir processus-gestion-stage.md, 62e échange, tour suivant, pour le contexte de ce durcissement.
  try {
    const el = document.getElementById('footerLienDonnees');
    if (!el) return;
    const url = pageUrlFor(state.options.pageIdDonneesPersonnelles, '');
    if (url) {
      el.href = url;
      el.target = '_blank';
      el.rel = 'noopener';
      el.classList.remove('app-footer-link-disabled');
      el.removeAttribute('aria-disabled');
      el.removeAttribute('title');
    } else {
      el.removeAttribute('href');
      el.classList.add('app-footer-link-disabled');
      el.setAttribute('aria-disabled', 'true');
      el.title = 'Page non encore configurée — voir la clé "pageIdDonneesPersonnelles" dans la table Parametres_widget';
    }
  } catch (err) {
    console.error('[Gestion de stage FPGC] mise à jour du lien "Données personnelles" du pied de page a échoué (sans incidence sur le reste du widget)', err);
  }
}

// Construit l'URL d'une page publique à partir de l'URL de base commune du document + son numéro de
// page (ex. baseUrlDocument="https://docs.getgrist.com/xxxxxxxx/Suivi-FPGC", pageId="7" ->
// ".../p/7") — évite de faire coller 3 fois la même URL complète (une par widget public), voir la
// note dans state.options. Repli sur legacyFullUrl (l'ancien réglage, une URL complète unique par
// widget) si baseUrlDocument ou pageId ne sont pas encore renseignés, pour ne pas casser un document
// déjà configuré à l'ancienne.
// 40e échange, tour suivant — cause réelle trouvée et corrigée du symptôme « toujours la première
// page accessible » (39e échange) : `baseUrlDocument` peut avoir été copié depuis un lien de partage
// Grist qui embarque des paramètres de suivi (ex. `?utm_id=share-doc`). Sans le nettoyage ci-dessous,
// ce `?...` restait accroché à la fin de `doc`, et `${doc}/p/${id}` produisait alors
// « ...circonscription?utm_id=share-doc/p/49 » : le segment `/p/49` finissait comme un morceau de la
// VALEUR du paramètre `utm_id` plutôt que comme un vrai segment de chemin — Grist ne voit alors aucune
// page demandée dans l'URL et affiche sa page par défaut, exactement le symptôme observé (confirmé
// par comparaison octet à octet avec un lien généré via `SELF_HYPERLINK(..., page=49)`, qui lui ne
// souffre pas du problème puisqu'il ne part pas de `baseUrlDocument`). Voir
// `processus-gestion-stage.md` (40e échange, tour suivant) pour le détail complet du diagnostic.
function pageUrlFor(pageId, legacyFullUrl) {
  const doc = (state.options.baseUrlDocument || '').trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const id = (pageId || '').toString().trim();
  if (doc && id) return safeUrl(`${doc}/p/${id}`);
  return safeUrl(legacyFullUrl || '');
}

async function saveParametreWidget(cle, valeurStr) {
  // addRecord/updateRecord rechargent déjà Parametres_widget après écriture (voir plus haut).
  const existing = T('Parametres_widget').find((r) => r.Cle === cle);
  if (existing) await updateRecord('Parametres_widget', existing.id, { Valeur: valeurStr });
  else await addRecord('Parametres_widget', { Cle: cle, Valeur: valeurStr });
  loadParametresWidgetIntoState();
}

function T(tableId) { return (DB[tableId] && DB[tableId].rows) || []; }
function byId(tableId, id) { return DB[tableId] && DB[tableId].byId.get(id); }

async function addRecord(tableId, fields) {
  const res = await grist.docApi.applyUserActions([['AddRecord', physTable(tableId), null, fields]]);
  await loadTable(tableId);
  return res.retValues[0];
}

async function updateRecord(tableId, id, fields) {
  await grist.docApi.applyUserActions([['UpdateRecord', physTable(tableId), id, fields]]);
  await loadTable(tableId);
}

// One applyUserActions call carrying several AddRecord actions — same mechanism already
// proven for single-record creation (stage, logistique), just batched for a "saisie groupée".
// (Deliberately not BulkAddRecord: kept to the exact action shape already known to work.)
async function addRecords(tableId, fieldsArr) {
  const actions = fieldsArr.map((f) => ['AddRecord', physTable(tableId), null, f]);
  const res = await grist.docApi.applyUserActions(actions);
  await loadTable(tableId);
  return res.retValues;
}

/* ---------------------------------------------------------------------- */
/* Utilitaires                                                             */
/* ---------------------------------------------------------------------- */

function toEpoch(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 12, 0, 0) / 1000);
}

function fromEpochToDateInput(epoch) {
  if (epoch === null || epoch === undefined || epoch === false) return '';
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(epoch * 1000));
}

function fmtDateFr(epoch) {
  if (epoch === null || epoch === undefined || epoch === false) return '—';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(epoch * 1000));
}

function parisDateParts(epoch) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: '2-digit' }).formatToParts(new Date(epoch * 1000));
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: get('day'), month: get('month'), year: get('year') };
}

function generateReference(academieCode, debutEpoch, niveauLabel) {
  const { day, month, year } = parisDateParts(debutEpoch);
  const cat = CATEGORY_CODE[niveauLabel] || '00';
  return `${academieCode}${day}${month}${cat}${year}`;
}

function decodeReferenceCategoryLabel(ref) {
  if (!ref || ref.length !== 10) return null;
  return CATEGORY_LABEL_BY_CODE[ref.slice(6, 8)] || null;
}

function euro(n) {
  if (n === null || n === undefined || n === '' || n === false || isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

function escapeHtml(s) {
  return String(s === null || s === undefined || s === false ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// FPGC-04 (audit sécurité) : allow-list de protocoles — rejette silencieusement toute URL dont le
// schéma n'est pas http: ou https: (ex. javascript:…) pour éviter l'injection XSS via href. Appliqué
// dans pageUrlFor() : un seul point de contrôle protège tous les sites d'utilisation en aval.
function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? url : '';
  } catch (e) {
    return '';
  }
}

// FPGC-03 (audit sécurité) : allow-list stricte pour toute couleur réinjectée dans un attribut
// style/value — une couleur personnalisée (intervenantColors, persistée en option de widget) peut
// être modifiée hors de l'UI (API Grist directe) ; on ne fait donc jamais confiance à sa forme et
// on la rejette silencieusement (repli sur la couleur de hachage) si elle n'est pas un hex CSS pur.
const HEX_COLOR_RE = /^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
function safeColor(c) {
  return typeof c === 'string' && HEX_COLOR_RE.test(c.trim()) ? c.trim() : null;
}

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// UUID v4 utilisé comme clé du lien public du formulaire de recrutement (voir
// renderConfigFormulaire/bindConfigFormulaire) — destiné à devenir une clé de type "Link Key" côté
// règles ACL Grist (user.LinkKey.UUID == rec.UUID, voir acl-academies.md) une fois cette
// configuration posée sur le document réel. crypto.randomUUID() est disponible dans l'environnement
// des widgets Grist (Chromium) ; repli manuel uniquement si un jour absent.
function generateUUID() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Une valeur de catégorie/académie sur un stage peut être soit l'id numérique d'une ligne de la
// table `Reference` (format écrit par ce widget), soit encore le texte libre historique porté par
// les stages importés depuis l'ancien BD_Stages2 (ex. "F1", "DIJON" — voir modele-de-donnees.md).
// Sans ce filet, un <select> dont aucune <option> ne porte "selected" affiche silencieusement sa
// première option (comportement par défaut du navigateur) au lieu de la vraie valeur enregistrée —
// c'est ce qui provoquait l'affichage figé de "F1"/"Aix-Marseille" à l'ouverture d'anciens stages.
// On accepte donc les deux formats à la LECTURE (par id, puis par libellé normalisé) ; l'écriture,
// elle, continue de toujours réenregistrer au nouveau format (id numérique), inchangé.
function matchReferenceRow(rows, value, labelField) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return rows.find((r) => r.id === value) || null;
  const target = normalize(String(value));
  if (!target) return null;
  return rows.find((r) => normalize(String(r[labelField] || '')) === target) || null;
}

// Raccourcis pour le cas le plus fréquent : résoudre le niveau/l'académie d'un stage (objet
// BD_Stages2 complet), quel que soit le format sous lequel le champ est effectivement stocké.
function stageNiveauRow(stage) { return matchReferenceRow(niveauRows(), stage && stage.Niveau_du_stage, 'Niveau_du_stage'); }
function stageAcademieRow(stage) { return matchReferenceRow(academieRows(), stage && stage.Academie_de_formation, 'Academie'); }

function numOrNull(id) {
  const v = document.getElementById(id).value;
  return v === '' ? null : Number(v);
}

function academieRows() { return T('Reference').filter((r) => r.Academie); }
function niveauRows() { return T('Reference').filter((r) => r.Niveau_du_stage); }
function refRow(id) { return byId('Reference', id); }

/* ---------------------------------------------------------------------- */
/* État applicatif                                                        */
/* ---------------------------------------------------------------------- */

const state = {
  route: 'accueil',        // 'accueil' | 'stage'
  stageId: null,
  stageTab: 'stagiaires', // 'stagiaires' | 'preparation' | 'ingenierie' | 'emargement' | 'satisfaction' | 'cloture'
  monthCursor: new Date(),
  filterAcademie: '',
  myAcademieId: null,
  planningColorBy: 'intervenant', // 'intervenant' | 'modalite' | 'sous_groupe'
  // Bulle d'info stagiaire des sous-groupes (académie/fonction) : sgTooltipPinned référence
  // l'étiquette actuellement épinglée par un clic (null si aucune, ou si la bulle n'est affichée
  // que par survol/focus) ; sgTooltipDocBound évite de reposer deux fois l'écouteur global de
  // fermeture par clic extérieur (voir ensureStagiaireTooltipDocListener).
  sgTooltipPinned: null,
  sgTooltipDocBound: false,
  // formulaireConfig/dechargeUrl/baseUrlFormulairePublic sont ici de simples caches en mémoire,
  // peuplés depuis la table Parametres_widget par loadParametresWidgetIntoState() (voir plus haut)
  // — pas depuis grist.onOptions, contrairement aux trois autres réglages ci-dessous.
  options: {
    sousGroupesParStage: {}, intervenantColors: {}, tableMap: {}, formulaireConfig: {}, dechargeUrl: '', baseUrlFormulairePublic: '',
    // 29e échange :
    satisfactionConfig: {}, baseUrlEspaceStagiaire: '', baseUrlEnqueteSatisfaction: '',
    // 35e échange : au lieu de coller 3 fois l'URL complète d'une page Grist (recrutement, espace
    // stagiaire, satisfaction — qui ne diffèrent que par le numéro après « /p/ »), une seule URL de
    // base commune (baseUrlDocument) + un numéro de page par widget public. baseUrlFormulairePublic/
    // baseUrlEspaceStagiaire/baseUrlEnqueteSatisfaction ci-dessus sont conservés en repli pour les
    // documents déjà configurés à l'ancienne (voir pageUrlFor).
    baseUrlDocument: '', pageIdFormulairePublic: '', pageIdEspaceStagiaire: '', pageIdEnqueteSatisfaction: '',
    // 61e échange — même principe, pour la page statique donnees-personnelles.html (mention
    // d'information RGPD complète, liée depuis le pied de page — voir updateFooterLienDonnees). Pas
    // de repli « URL complète à l'ancienne » ici : ce réglage est entièrement nouveau, aucun document
    // existant n'a pu être configuré autrement avant ce jour.
    pageIdDonneesPersonnelles: '',
  },
};

// boot() (tout en bas du fichier) attend cette promesse avant le tout premier loadAll() : la
// correspondance des tables (state.options.tableMap, voir physTable ci-dessus) doit être connue
// avant le premier appel à grist.docApi.fetchTable, faute de quoi le chargement initial utiliserait
// les noms logiques bruts même quand une correspondance a été enregistrée par l'utilisateur.
let resolveOptionsReady;
const optionsReady = new Promise((resolve) => { resolveOptionsReady = resolve; });

grist.onOptions((opts) => {
  opts = opts || {};
  state.myAcademieId = opts.myAcademieId || null;
  state.options.sousGroupesParStage = opts.sousGroupesParStage || {};
  // Couleur de planning choisie manuellement par intervenant (id -> "#rrggbb"), voir "modifier le
  // créneau" — persistée en option de widget plutôt qu'en colonne Grist (registre auxiliaire léger,
  // même logique que sousGroupesParStage ci-dessus).
  state.options.intervenantColors = opts.intervenantColors || {};
  // Correspondance table logique -> table réelle, voir l'onglet Paramètres (physTable ci-dessus).
  state.options.tableMap = opts.tableMap || {};
  // formulaireConfig/dechargeUrl/baseUrlFormulairePublic ne viennent PAS de grist.onOptions (voir la
  // note au-dessus de QUESTIONS_RECRUTEMENT) — ils sont peuplés depuis la table Parametres_widget par
  // loadParametresWidgetIntoState(), appelée dans boot() après le premier loadAll().
  resolveOptionsReady();
  if (DB.BD_Stages2) render();
});

/* ---------------------------------------------------------------------- */
/* Entrée = valider, Alt+Entrée = retour à la ligne (zones multi-lignes)   */
/* ---------------------------------------------------------------------- */
// Comportement global plutôt qu'un handler par formulaire : Entrée dans un champ texte déclenche
// le même effet qu'un clic sur le bouton d'action associé, sans devoir localiser la souris. Pour
// les <textarea>, Entrée seule valide aussi ; Alt+Entrée (ou toute autre touche de modification)
// n'est pas interceptée, ce qui laisse le navigateur insérer un retour à la ligne comme d'habitude.

function firstButtonIn(el) {
  if (!el) return null;
  if (el.matches && el.matches('button')) return el;
  if (!el.querySelector) return null;
  return el.querySelector('.btn-primary') || el.querySelector('button');
}

// Cherche le bouton d'action associé à un champ : d'abord dans son propre groupe (ligne partagée
// avec un bouton, ex. "Nom du sous-groupe" + "Créer"), sinon en balayant les éléments suivants —
// en remontant d'un niveau à chaque fois qu'un niveau est épuisé — jusqu'à la limite de la carte
// ou de la fenêtre modale englobante.
function findEnterTarget(field) {
  const boundary = field.closest('.modal, .card') || document.body;
  let node = field.closest('.grid-2, .grid-3, .grid-4, .field') || field;
  while (node && node !== boundary && boundary.contains(node)) {
    let sib = node.nextElementSibling;
    while (sib) {
      const btn = firstButtonIn(sib);
      if (btn) return btn;
      sib = sib.nextElementSibling;
    }
    node = node.parentElement;
  }
  return boundary.querySelector('.btn-primary');
}

function triggerEnterSubmit(field) {
  const explicitId = field.getAttribute('data-enter-submit');
  const explicitBtn = explicitId ? document.getElementById(explicitId) : null;
  const btn = (explicitBtn && !explicitBtn.disabled) ? explicitBtn : findEnterTarget(field);
  if (btn && !btn.disabled) btn.click();
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const el = e.target;
  if (el.tagName === 'TEXTAREA') {
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      // Insertion manuelle du retour à la ligne : contrairement à une touche de caractère normale,
      // le navigateur n'insère PAS de saut de ligne pour Alt+Entrée par défaut (Alt est traité
      // comme un modificateur d'accélérateur clavier, pas de saisie de texte) — il faut donc le
      // faire nous-mêmes plutôt que de simplement laisser passer l'événement.
      e.preventDefault();
      const start = el.selectionStart, end = el.selectionEnd;
      el.value = el.value.slice(0, start) + '\n' + el.value.slice(end);
      el.selectionStart = el.selectionEnd = start + 1;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // autres combinaisons : comportement par défaut du navigateur
    e.preventDefault();
    triggerEnterSubmit(el);
    return;
  }
  if (el.tagName !== 'INPUT') return;
  if (['checkbox', 'radio', 'file', 'button', 'submit', 'reset'].includes(el.type)) return;
  if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  triggerEnterSubmit(el);
});

/* ---------------------------------------------------------------------- */
/* Coquille : flash, modales                                              */
/* ---------------------------------------------------------------------- */

let flashTimer = null;
function showFlash(msg, type, err) {
  if (err) console.error('[Gestion de stage FPGC]', msg, err);
  const el = document.getElementById('flash');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  el.hidden = false;
  el.className = 'flash' + (type === 'error' ? ' error' : type === 'ok' ? ' ok' : '');
  clearTimeout(flashTimer);
  if (type === 'error') {
    // Errors stay until dismissed — auto-hiding a failure message hides the diagnosis too.
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn-small btn-secondary';
    closeBtn.style.marginLeft = '10px';
    closeBtn.textContent = 'Fermer';
    closeBtn.addEventListener('click', () => { el.hidden = true; });
    el.appendChild(closeBtn);
  } else {
    flashTimer = setTimeout(() => { el.hidden = true; }, 5000);
  }
}

function flashError(prefix, err) {
  showFlash(prefix + ' : ' + (err && err.message ? err.message : String(err)), 'error', err);
}

function escCloseModal(e) { if (e.key === 'Escape') closeModal(); }

function openModal(innerHtml) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'modalBackdrop';
  wrap.innerHTML = `<div class="modal">${innerHtml}</div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeModal(); });
  document.addEventListener('keydown', escCloseModal);
  return wrap;
}

function closeModal() {
  const el = document.getElementById('modalBackdrop');
  if (el) el.remove();
  document.removeEventListener('keydown', escCloseModal);
  // Filet de sécurité générique : une bulle d'info stagiaire épinglée sur une étiquette de la
  // fenêtre contextuelle qu'on vient de fermer pointerait vers un élément détruit.
  hideStagiaireTooltip();
}

function openSettingsModal() {
  const rows = academieRows().slice().sort((a, b) => a.Academie.localeCompare(b.Academie, 'fr'));
  const options = rows.map((r) => `<option value="${r.id}" ${r.id === state.myAcademieId ? 'selected' : ''}>${escapeHtml(r.Academie)}</option>`).join('');
  const modal = openModal(`
    <h2>Mon académie</h2>
    <p class="section-sub">Pré-remplit automatiquement l'académie de formation à la création d'un nouveau stage.</p>
    <div class="field">
      <label for="settAcademie">Académie</label>
      <select id="settAcademie"><option value="">— Non définie —</option>${options}</select>
    </div>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="settCancel">Annuler</button>
      <button type="button" class="btn btn-primary" id="settSave">Enregistrer</button>
    </div>
  `);
  modal.querySelector('#settCancel').addEventListener('click', closeModal);
  modal.querySelector('#settSave').addEventListener('click', () => {
    const val = modal.querySelector('#settAcademie').value;
    state.myAcademieId = val ? Number(val) : null;
    grist.setOption('myAcademieId', state.myAcademieId);
    closeModal();
    showFlash('Académie enregistrée.', 'ok');
  });
}

/* ---------------------------------------------------------------------- */
/* Accueil                                                                 */
/* ---------------------------------------------------------------------- */

function stagesInMonth(y, m) {
  const start = Date.UTC(y, m, 1, 0, 0, 0) / 1000;
  const end = Date.UTC(y, m + 1, 1, 0, 0, 0) / 1000;
  return T('BD_Stages2').filter((s) => s.Date_de_debut_de_session && s.Date_de_fin_de_session
    && s.Date_de_debut_de_session < end && s.Date_de_fin_de_session >= start);
}

function renderCalendar(y, m, stagesMonth) {
  const startWeekday = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  let cells = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((l) => `<div class="cal-daylabel">${l}</div>`).join('');
  for (let i = 0; i < startWeekday; i++) cells += '<div class="cal-cell out"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStart = Date.UTC(y, m, d, 0, 0, 0) / 1000;
    const dayEnd = Date.UTC(y, m, d, 23, 59, 59) / 1000;
    const dayStages = stagesMonth.filter((s) => s.Date_de_debut_de_session <= dayEnd && s.Date_de_fin_de_session >= dayStart);
    const chips = dayStages.slice(0, 3).map((s) => {
      const cls = STATUT_BADGE_STAGE[s.Statut_du_stage] || 'badge-brouillon';
      return `<span class="badge cal-chip ${cls}" data-open-stage="${s.id}" title="${escapeHtml(s.Intitule || s.Reference_de_stage)}">${escapeHtml(s.Intitule || s.Reference_de_stage || 'Stage')}</span>`;
    }).join('');
    const more = dayStages.length > 3 ? `<span class="muted" style="font-size:10px;">+${dayStages.length - 3}</span>` : '';
    cells += `<div class="cal-cell"><span class="cal-daynum">${d}</span>${chips}${more}</div>`;
  }
  return `<div class="calendar">${cells}</div>`;
}

function renderAccueil() {
  const y = state.monthCursor.getFullYear();
  const m = state.monthCursor.getMonth();
  const monthLabel = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(state.monthCursor);
  const calendarHtml = renderCalendar(y, m, stagesInMonth(y, m));

  let stages = T('BD_Stages2').slice();
  if (state.filterAcademie) stages = stages.filter((s) => String(s.Academie_de_formation) === state.filterAcademie);
  stages.sort((a, b) => (b.Date_de_debut_de_session || 0) - (a.Date_de_debut_de_session || 0));

  const academieOptions = academieRows().slice().sort((a, b) => a.Academie.localeCompare(b.Academie, 'fr'))
    .map((r) => `<option value="${r.id}" ${state.filterAcademie === String(r.id) ? 'selected' : ''}>${escapeHtml(r.Academie)}</option>`).join('');

  const rowsHtml = stages.length ? stages.map((s) => {
    const academie = stageAcademieRow(s);
    const niveau = stageNiveauRow(s);
    const badgeClass = STATUT_BADGE_STAGE[s.Statut_du_stage] || 'badge-brouillon';
    return `<tr class="clickable" data-open-stage="${s.id}">
      <td class="mono">${escapeHtml(s.Reference_de_stage || '—')}</td>
      <td>${escapeHtml(s.Intitule || '(sans intitulé)')}</td>
      <td>${escapeHtml(academie ? academie.Academie : '—')}</td>
      <td>${escapeHtml(niveau ? niveau.Niveau_du_stage : '—')}</td>
      <td>${fmtDateFr(s.Date_de_debut_de_session)} → ${fmtDateFr(s.Date_de_fin_de_session)}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(s.Statut_du_stage || 'Brouillon')}</span></td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">Aucun stage pour ce filtre.</td></tr>';

  return `
    <div class="stage-header">
      <div>
        <p class="section-title">Accueil</p>
        <p class="section-sub">Calendrier et liste des stages.</p>
      </div>
      <button type="button" class="btn btn-primary" id="btnCreateStage">+ Créer un stage</button>
    </div>
    <div class="card">
      <div class="cal-nav">
        <button type="button" class="btn btn-small btn-secondary" id="calPrev">←</button>
        <strong style="text-transform:capitalize">${monthLabel}</strong>
        <button type="button" class="btn btn-small btn-secondary" id="calNext">→</button>
      </div>
      ${calendarHtml}
    </div>
    <div class="card">
      <div class="row-inline" style="justify-content: space-between; margin-bottom: 10px;">
        <h3 style="margin:0;">Liste des stages</h3>
        <div class="field" style="margin:0; min-width: 220px;">
          <select id="filterAcademie"><option value="">Toutes les académies</option>${academieOptions}</select>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>Référence</th><th>Intitulé</th><th>Académie</th><th>Niveau</th><th>Dates</th><th>Statut</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function bindAccueil() {
  document.getElementById('btnCreateStage').addEventListener('click', () => openCreateStageModal());
  document.getElementById('calPrev').addEventListener('click', () => { state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() - 1, 1); render(); });
  document.getElementById('calNext').addEventListener('click', () => { state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + 1, 1); render(); });
  document.getElementById('filterAcademie').addEventListener('change', (e) => { state.filterAcademie = e.target.value; render(); });
  document.querySelectorAll('[data-open-stage]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    openStage(Number(el.getAttribute('data-open-stage')));
  }));
}

function openStage(id) { state.route = 'stage'; state.stageId = id; state.stageTab = 'stagiaires'; render(); }

/* ---------------------------------------------------------------------- */
/* Création / duplication d'un stage                                      */
/* ---------------------------------------------------------------------- */

function openCreateStageModal() {
  const academieOpts = academieRows().slice().sort((a, b) => a.Academie.localeCompare(b.Academie, 'fr'))
    .map((r) => `<option value="${r.id}" ${state.myAcademieId === r.id ? 'selected' : ''}>${escapeHtml(r.Academie)}</option>`).join('');
  const niveauOpts = niveauRows().map((r) => `<option value="${r.id}">${escapeHtml(r.Niveau_du_stage)}</option>`).join('');
  const modeleOpts = T('BD_Stages2').slice().sort((a, b) => (b.Date_de_debut_de_session || 0) - (a.Date_de_debut_de_session || 0))
    .map((s) => `<option value="${s.id}">${escapeHtml(s.Reference_de_stage)} — ${escapeHtml(s.Intitule || '')}</option>`).join('');

  const modal = openModal(`
    <h2>Créer un stage</h2>
    <div class="field">
      <label for="csModele">Reprendre comme modèle (facultatif)</label>
      <select id="csModele"><option value="">— Aucun modèle —</option>${modeleOpts}</select>
    </div>
    <div class="grid-2">
      <div class="field"><label for="csIntitule">Intitulé</label><input type="text" id="csIntitule"></div>
      <div class="field"><label for="csNiveau">Catégorie / niveau</label><select id="csNiveau"><option value="">—</option>${niveauOpts}</select></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="csAcademie">Académie de formation</label><select id="csAcademie"><option value="">—</option>${academieOpts}</select></div>
      <div class="field"><label for="csLieu">Lieu</label><input type="text" id="csLieu"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="csDebut">Date de début</label><input type="date" id="csDebut"></div>
      <div class="field"><label for="csFin">Date de fin</label><input type="date" id="csFin"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="csEffectif">Effectif théorique</label><input type="number" id="csEffectif" min="1" step="1"></div>
      <div class="field" style="justify-content:flex-end;"><label style="display:flex; align-items:center; gap:8px; font-weight:400; text-transform:none; letter-spacing:0;"><input type="checkbox" id="csInternat" style="width:auto;"> Internat</label></div>
    </div>
    <div class="field"><label for="csDescription">Description</label><textarea id="csDescription" placeholder="Description libre du stage."></textarea></div>
    <p class="field-help">La référence sera générée automatiquement (académie + date de début + catégorie) et ne sera pas modifiable.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="csCancel">Annuler</button>
      <button type="button" class="btn btn-primary" id="csSubmit">Créer le stage</button>
    </div>
  `);

  modal.querySelector('#csModele').addEventListener('change', () => {
    const modeleId = Number(modal.querySelector('#csModele').value || 0);
    if (!modeleId) return;
    const src = byId('BD_Stages2', modeleId);
    if (!src) return;
    modal.querySelector('#csIntitule').value = src.Intitule || '';
    // Le modèle repris peut lui-même être un stage importé depuis l'ancien format (texte libre
    // plutôt qu'id de référence) — voir matchReferenceRow ci-dessus pour la même situation dans
    // l'onglet Préparation. On résout vers l'id de référence dans les deux cas, et on prévient
    // l'utilisateur si l'une des deux valeurs ne correspond à rien de connu.
    const matchedNiveauModele = matchReferenceRow(niveauRows(), src.Niveau_du_stage, 'Niveau_du_stage');
    const matchedAcademieModele = matchReferenceRow(academieRows(), src.Academie_de_formation, 'Academie');
    modal.querySelector('#csNiveau').value = matchedNiveauModele ? String(matchedNiveauModele.id) : '';
    modal.querySelector('#csAcademie').value = matchedAcademieModele ? String(matchedAcademieModele.id) : '';
    const modeleWarnings = [];
    if (src.Niveau_du_stage && !matchedNiveauModele) modeleWarnings.push(`catégorie (« ${src.Niveau_du_stage} »)`);
    if (src.Academie_de_formation && !matchedAcademieModele) modeleWarnings.push(`académie (« ${src.Academie_de_formation} »)`);
    if (modeleWarnings.length) showFlash(`Valeur(s) du modèle non reconnue(s) — ${modeleWarnings.join(', ')} — à choisir manuellement ci-dessus.`, 'error');
    modal.querySelector('#csEffectif').value = src.Effectif_theorique || '';
    modal.querySelector('#csDescription').value = src.Description || '';
    modal.querySelector('#csInternat').checked = !!src.Internat;
    const admin = T('Administration_et_logistique').find((a) => a.Reference_de_stage === modeleId);
    modal.querySelector('#csLieu').value = admin ? (admin.Lieu || '') : '';
  });
  modal.querySelector('#csCancel').addEventListener('click', closeModal);
  modal.querySelector('#csSubmit').addEventListener('click', async () => {
    const intitule = modal.querySelector('#csIntitule').value.trim();
    const niveauId = Number(modal.querySelector('#csNiveau').value || 0);
    const academieId = Number(modal.querySelector('#csAcademie').value || 0);
    const lieu = modal.querySelector('#csLieu').value.trim();
    const debut = modal.querySelector('#csDebut').value;
    const fin = modal.querySelector('#csFin').value;
    const effectif = Number(modal.querySelector('#csEffectif').value || 0);
    const description = modal.querySelector('#csDescription').value.trim();
    const internat = modal.querySelector('#csInternat').checked;
    const modeleId = Number(modal.querySelector('#csModele').value || 0);

    if (!intitule || !niveauId || !academieId || !debut || !fin) {
      showFlash('Merci de renseigner au minimum intitulé, niveau, académie et dates.', 'error');
      return;
    }
    const debutEpoch = toEpoch(debut);
    const finEpoch = toEpoch(fin);
    if (finEpoch < debutEpoch) { showFlash('La date de fin doit être postérieure à la date de début.', 'error'); return; }

    const academie = refRow(academieId);
    const niveau = refRow(niveauId);
    const reference = generateReference(academie.Code_academique, debutEpoch, niveau.Niveau_du_stage);

    const submitBtn = modal.querySelector('#csSubmit');
    submitBtn.disabled = true;
    try {
      const newId = await addRecord('BD_Stages2', {
        Reference_de_stage: reference,
        Intitule: intitule,
        Niveau_du_stage: niveauId,
        Academie_de_formation: academieId,
        Date_de_debut_de_session: debutEpoch,
        Date_de_fin_de_session: finEpoch,
        Effectif_theorique: effectif || null,
        Description: description,
        Statut_du_stage: 'Brouillon',
        Internat: internat,
        Stage_modele_source: modeleId || null,
      });
      await addRecord('Administration_et_logistique', { Reference_de_stage: newId, Lieu: lieu });
      closeModal();
      showFlash('Stage créé : ' + reference, 'ok');
      openStage(newId);
    } catch (err) {
      flashError('Erreur à la création du stage', err);
      submitBtn.disabled = false;
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Onglet 2 — Préparation logistique                                       */
/* ---------------------------------------------------------------------- */

function renderPreparation(stage) {
  const admin = T('Administration_et_logistique').find((a) => a.Reference_de_stage === stage.id) || {};
  const niveauRowsList = niveauRows();
  const academieRowsList = academieRows().slice().sort((a, b) => a.Academie.localeCompare(b.Academie, 'fr'));
  const matchedNiveau = matchReferenceRow(niveauRowsList, stage.Niveau_du_stage, 'Niveau_du_stage');
  const matchedAcademie = matchReferenceRow(academieRowsList, stage.Academie_de_formation, 'Academie');
  const niveauInconnu = !!stage.Niveau_du_stage && !matchedNiveau;
  const academieInconnue = !!stage.Academie_de_formation && !matchedAcademie;
  const niveauOpts = `<option value="" ${!matchedNiveau ? 'selected' : ''}>${niveauInconnu ? '— Valeur non reconnue : « ' + escapeHtml(String(stage.Niveau_du_stage)) + ' » —' : '— Choisir —'}</option>`
    + niveauRowsList.map((r) => `<option value="${r.id}" ${matchedNiveau && matchedNiveau.id === r.id ? 'selected' : ''}>${escapeHtml(r.Niveau_du_stage)}</option>`).join('');
  const academieOpts = `<option value="" ${!matchedAcademie ? 'selected' : ''}>${academieInconnue ? '— Valeur non reconnue : « ' + escapeHtml(String(stage.Academie_de_formation)) + ' » —' : '— Choisir —'}</option>`
    + academieRowsList.map((r) => `<option value="${r.id}" ${matchedAcademie && matchedAcademie.id === r.id ? 'selected' : ''}>${escapeHtml(r.Academie)}</option>`).join('');
  const avertissement = (niveauInconnu || academieInconnue)
    ? `<p class="field-help" style="color:#c62828;">⚠ La valeur enregistrée pour ${niveauInconnu && academieInconnue ? 'la catégorie et l\'académie' : (niveauInconnu ? 'la catégorie' : 'l\'académie')} ne correspond à aucune entrée connue (probablement un stage importé depuis l'ancien format) — choisissez la bonne valeur ci-dessous avant d'enregistrer, sans quoi elle sera effacée.</p>`
    : '';

  return `
    <div class="card">
      <h3>Informations générales</h3>
      ${avertissement}
      <div class="grid-2">
        <div class="field"><label for="pIntitule">Intitulé</label><input type="text" id="pIntitule" value="${escapeHtml(stage.Intitule || '')}"></div>
        <div class="field"><label for="pNiveau">Catégorie / niveau</label><select id="pNiveau">${niveauOpts}</select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label for="pAcademie">Académie de formation</label><select id="pAcademie">${academieOpts}</select></div>
        <div class="field"><label for="pLieu">Lieu</label><input type="text" id="pLieu" value="${escapeHtml(admin.Lieu || '')}"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label for="pDebut">Date de début</label><input type="date" id="pDebut" value="${fromEpochToDateInput(stage.Date_de_debut_de_session)}"></div>
        <div class="field"><label for="pFin">Date de fin</label><input type="date" id="pFin" value="${fromEpochToDateInput(stage.Date_de_fin_de_session)}"></div>
      </div>
      <div class="grid-2">
        <div class="field"><label for="pEffectif">Effectif théorique</label><input type="number" id="pEffectif" min="1" step="1" value="${escapeHtml(stage.Effectif_theorique || '')}"></div>
        <div class="field" style="justify-content:flex-end;"><label style="display:flex; align-items:center; gap:8px; font-weight:400; text-transform:none; letter-spacing:0;"><input type="checkbox" id="pInternat" style="width:auto;" ${stage.Internat ? 'checked' : ''}> Internat</label></div>
      </div>
      <div class="field"><label for="pDescription">Description</label><textarea id="pDescription">${escapeHtml(stage.Description || '')}</textarea></div>
      <p class="field-help">La référence <span class="mono">${escapeHtml(stage.Reference_de_stage)}</span> est générée automatiquement et non modifiable.</p>
      <div class="actions-bar"><button type="button" class="btn btn-primary" id="pSave">Enregistrer les informations générales</button></div>
    </div>

    <div class="card">
      <h3>Logistique &amp; coûts</h3>
      <div class="grid-3">
        <div class="field"><label for="pHeberges">Personnes hébergées</label><input type="number" id="pHeberges" min="0" value="${escapeHtml(admin.Nombre_de_personnes_hebergees ?? '')}"></div>
        <div class="field"><label for="pRestaures">Personnes restaurées</label><input type="number" id="pRestaures" min="0" value="${escapeHtml(admin.Nombre_de_personnes_restaurees ?? '')}"></div>
        <div class="field"></div>
      </div>
      <div class="grid-3">
        <div class="field"><label for="pCoutHeb">Coût hébergement (€)</label><input type="number" id="pCoutHeb" min="0" value="${escapeHtml(admin.Cout_hebergement ?? '')}"></div>
        <div class="field"><label for="pCoutRes">Coût restauration (€)</label><input type="number" id="pCoutRes" min="0" value="${escapeHtml(admin.Cout_restauration ?? '')}"></div>
        <div class="field"><label for="pCoutTra">Coût transport (€)</label><input type="number" id="pCoutTra" min="0" value="${escapeHtml(admin.Cout_transport ?? '')}"></div>
      </div>
      <div class="stat-tile" style="max-width: 220px;">
        <span class="stat-value">${euro(admin.Cout_total)}</span>
        <span class="stat-label">Coût total (calculé)</span>
      </div>
      <div class="actions-bar" style="margin-top:14px;"><button type="button" class="btn btn-primary" id="pSaveLogistique">Enregistrer la logistique</button></div>
    </div>
  `;
}

function bindPreparation(stage) {
  document.getElementById('pSave').addEventListener('click', async () => {
    const fields = {
      Intitule: document.getElementById('pIntitule').value.trim(),
      Niveau_du_stage: Number(document.getElementById('pNiveau').value || 0) || null,
      Academie_de_formation: Number(document.getElementById('pAcademie').value || 0) || null,
      Date_de_debut_de_session: document.getElementById('pDebut').value ? toEpoch(document.getElementById('pDebut').value) : null,
      Date_de_fin_de_session: document.getElementById('pFin').value ? toEpoch(document.getElementById('pFin').value) : null,
      Effectif_theorique: numOrNull('pEffectif'),
      Internat: document.getElementById('pInternat').checked,
      Description: document.getElementById('pDescription').value.trim(),
    };
    try {
      await updateRecord('BD_Stages2', stage.id, fields);
      const lieu = document.getElementById('pLieu').value.trim();
      const admin = T('Administration_et_logistique').find((a) => a.Reference_de_stage === stage.id);
      if (admin) await updateRecord('Administration_et_logistique', admin.id, { Lieu: lieu });
      else await addRecord('Administration_et_logistique', { Reference_de_stage: stage.id, Lieu: lieu });
      showFlash('Informations générales enregistrées.', 'ok');
      render();
    } catch (err) { flashError('Erreur', err); }
  });

  document.getElementById('pSaveLogistique').addEventListener('click', async () => {
    const admin = T('Administration_et_logistique').find((a) => a.Reference_de_stage === stage.id);
    const fields = {
      Nombre_de_personnes_hebergees: numOrNull('pHeberges'),
      Nombre_de_personnes_restaurees: numOrNull('pRestaures'),
      Cout_hebergement: numOrNull('pCoutHeb'),
      Cout_restauration: numOrNull('pCoutRes'),
      Cout_transport: numOrNull('pCoutTra'),
    };
    try {
      if (admin) await updateRecord('Administration_et_logistique', admin.id, fields);
      else await addRecord('Administration_et_logistique', { Reference_de_stage: stage.id, ...fields });
      showFlash('Logistique enregistrée.', 'ok');
      render();
    } catch (err) { flashError('Erreur', err); }
  });
}

/* ---------------------------------------------------------------------- */
/* Onglet 1 — Stagiaires                                                   */
/* ---------------------------------------------------------------------- */

function candidatesForStage(stageId) { return T('Candidats_du_stage').filter((c) => c.Stage === stageId); }

/* ---------------------------------------------------------------------- */
/* Configuration du formulaire de recrutement (18e échange) — remplace     */
/* l'ancien écran de sélection dans une bibliothèque Grist par une liste   */
/* fixe de questions (QUESTIONS_RECRUTEMENT) : l'utilisateur choisit, par   */
/* stage, lesquelles masquer ou rendre optionnelles. Une fois enregistré,   */
/* un lien public est généré (UUID + URL, écrits sur BD_Stages2) — ce lien  */
/* n'a pas encore de widget public réel derrière lui à ce stade (à venir),  */
/* mais la référence de stage et la clé sont prêtes pour l'écriture future  */
/* dans Candidats_du_stage (colonne Formulaire_UUID, clé Link Key ACL).     */
/* ---------------------------------------------------------------------- */

function formulaireConfigForStage(stageId) {
  const cfg = (state.options.formulaireConfig && state.options.formulaireConfig[stageId]) || {};
  return { masquees: cfg.masquees || [], optionnelles: cfg.optionnelles || [] };
}

// Pas de `masquees` ici : contrairement au recrutement, aucune question du socle satisfaction ne se
// masque — voir la note au-dessus de QUESTIONS_SATISFACTION. `globale` (obligatoireFixe) est filtrée
// à la lecture même si elle apparaissait par erreur dans `optionnelles` (ex. donnée corrompue).
function satisfactionConfigForStage(stageId) {
  const cfg = (state.options.satisfactionConfig && state.options.satisfactionConfig[stageId]) || {};
  return { optionnelles: (cfg.optionnelles || []).filter((id) => id !== 'globale') };
}

// 22e échange : ce lien n'embarque plus la référence du stage (`stage=...`) ni une clé lue et
// comparée côté client (`key=...`) — un test réel a montré qu'accorder à l'anonyme une Lecture
// sur BD_Stages2 suffisamment large pour que le widget public retrouve « son » stage exposait, de
// fait, la colonne clé secrète de TOUS les stages (et leurs métadonnées) à quiconque détenait
// un seul lien valide, ce qui revient à distribuer la clé secrète de chaque stage à tout le monde.
// Le paramètre ci-dessous se termine par un underscore : c'est la convention Grist de « Link Key »
// (voir acl-academies.md §13/§15), qui rend sa valeur disponible dans les règles ACL sous
// user.LinkKey.<nom>. Nommé `UUID_` pour correspondre à user.LinkKey.UUID, le nom que l'utilisateur
// a effectivement retenu et validé en conditions réelles sur le document de test (23e échange —
// voir acl-academies.md, confirmation que le mécanisme Link Key fonctionne bien depuis une page
// Custom Widget). **24e échange** : la colonne elle-même a aussi été renommée sur le document réel,
// de `Formulaire_UUID` à `UUID` (renommage fait directement par l'utilisateur dans Grist, pas par
// une livraison de fichier .grist) — `stage.UUID` ci-dessous suit ce renommage ; seule la copie sur
// `Candidats_du_stage` garde le nom `Formulaire_UUID` (table différente, non renommée). La règle ACL
// de Lecture sur BD_Stages2 compare alors rec.UUID à user.LinkKey.UUID : Grist ne renvoie au widget
// public QUE la ligne du stage correspondant (zéro ligne si la clé ne correspond à rien), jamais
// la table entière — voir formulaire-public.js (resolveStage) qui n'a donc plus besoin de
// connaître la référence du stage à l'avance ni de comparer quoi que ce soit lui-même.
// 45e échange (tour suivant, x2) : `style=singlePage` masque le bandeau/menu/panneau natifs de
// Grist SANS casser la lecture de la clé Link Key par la règle ACL — mais seulement s'il est placé
// AVANT le paramètre Link Key dans la chaîne de requête. Un premier essai l'avait ajouté APRÈS
// (`?UUID_=...&style=singlePage`) : un test réel de l'utilisateur sur le document de production a
// montré que ça casse la lecture de l'UUID par la règle ACL. Un second test, ordre inversé
// (`?style=singlePage&UUID_=...`), a confirmé que ça fonctionne. Cause probable, non confirmée
// techniquement depuis cet environnement (pas d'accès au code source de Grist ni à un moteur Grist
// réel) : le chemin de chargement de page emprunté par `style=singlePage` semble ne reconstruire
// `user.LinkKey` qu'à partir des paramètres qui LE SUIVENT dans la chaîne de requête — ceux placés
// avant seraient perdus. `buildLinkKeyUrl` ci-dessous centralise donc la construction : `style=
// singlePage` est TOUJOURS écrit en premier, avant la clé Link Key elle-même. Voir
// `processus-gestion-stage.md` (45e échange) pour le détail complet.
function buildLinkKeyUrl(baseUrl, keyName, keyValue) {
  if (!baseUrl || !keyValue) return '';
  const sep = baseUrl.includes('?') ? '&' : '?';
  const params = new URLSearchParams();
  params.set(keyName, keyValue);
  return baseUrl.trim() + sep + 'style=singlePage&' + params.toString();
}

// 22e échange : ce lien n'embarque plus la référence du stage (`stage=...`) ni une clé lue et
// comparée côté client (`key=...`) — un test réel a montré qu'accorder à l'anonyme une Lecture
// sur BD_Stages2 suffisamment large pour que le widget public retrouve « son » stage exposait, de
// fait, la colonne clé secrète de TOUS les stages (et leurs métadonnées) à quiconque détenait
// un seul lien valide, ce qui revient à distribuer la clé secrète de chaque stage à tout le monde.
// Le paramètre ci-dessous se termine par un underscore : c'est la convention Grist de « Link Key »
// (voir acl-academies.md §13/§15), qui rend sa valeur disponible dans les règles ACL sous
// user.LinkKey.<nom>. Nommé `UUID_` pour correspondre à user.LinkKey.UUID, le nom que l'utilisateur
// a effectivement retenu et validé en conditions réelles sur le document de test (23e échange —
// voir acl-academies.md, confirmation que le mécanisme Link Key fonctionne bien depuis une page
// Custom Widget). **24e échange** : la colonne elle-même a aussi été renommée sur le document réel,
// de `Formulaire_UUID` à `UUID` (renommage fait directement par l'utilisateur dans Grist, pas par
// une livraison de fichier .grist) — `stage.UUID` ci-dessous suit ce renommage ; seule la copie sur
// `Candidats_du_stage` garde le nom `Formulaire_UUID` (table différente, non renommée). La règle ACL
// de Lecture sur BD_Stages2 compare alors rec.UUID à user.LinkKey.UUID : Grist ne renvoie au widget
// public QUE la ligne du stage correspondant (zéro ligne si la clé ne correspond à rien), jamais
// la table entière — voir formulaire-public.js (resolveStage) qui n'a donc plus besoin de
// connaître la référence du stage à l'avance ni de comparer quoi que ce soit lui-même.
function buildRecrutementLink(baseUrl, stage) {
  if (!baseUrl || !stage.UUID) return '';
  return buildLinkKeyUrl(baseUrl, 'UUID_', stage.UUID);
}

// 29e échange — même mécanisme que buildRecrutementLink ci-dessus, mais pour l'enquête de
// satisfaction : clé DISTINCTE (Satisfaction_UUID, pas UUID) pour qu'une réponse ne puisse jamais
// être reliée à une candidature — voir acl-academies.md §16 et enquete-satisfaction.js.
function buildSatisfactionLink(baseUrl, stage) {
  if (!baseUrl || !stage.Satisfaction_UUID) return '';
  return buildLinkKeyUrl(baseUrl, 'SatisfactionUUID_', stage.Satisfaction_UUID);
}

// 29e échange — lien personnel vers espace-stagiaire.html, généré par formulaire-public.js au
// moment de la candidature (voir ce fichier) mais reconstructible ici pour un candidat plus ancien
// qui n'en a pas encore un (ex. candidature déposée avant que baseUrlEspaceStagiaire soit configuré),
// ou pour le régénérer si le candidat l'a perdu — voir regenererLienPersonnel plus bas.
function buildLienPersonnel(baseUrl, uuidPersonnel) {
  if (!baseUrl || !uuidPersonnel) return '';
  return buildLinkKeyUrl(baseUrl, 'CandidatUUID_', uuidPersonnel);
}

async function regenererLienPersonnel(candidat) {
  const baseUrl = pageUrlFor(state.options.pageIdEspaceStagiaire, state.options.baseUrlEspaceStagiaire);
  if (!baseUrl) { showFlash("Configurez d'abord l'URL de base du document et le numéro de la page « espace stagiaire » (carte « Configurer le formulaire de recrutement »).", 'error'); return; }
  // FPGC-05 (70e échange +1) : toujours générer un NOUVEL UUID, même si l'ancien existe — c'est le
  // but même de « Régénérer » : invalider un lien/mot de passe compromis. L'ancienne expression
  // `candidat.UUID_personnel || generateUUID()` réutilisait l'UUID existant quand il était présent,
  // rendant la rotation sans effet. Côté espace-stagiaire.js, toute valeur mémorisée en localStorage
  // (reconnexion automatique) devient invalide dès le prochain chargement : la comparaison
  // r.UUID_personnel === cleConnue échoue, l'écran de connexion s'affiche — révocation automatique.
  const uuid = generateUUID();
  const lien = buildLienPersonnel(baseUrl, uuid);
  try {
    await updateRecord('Candidats_du_stage', candidat.id, { UUID_personnel: uuid, Lien_personnel: lien });
    showFlash('Nouveau lien personnel généré — l\'ancien accès est révoqué.', 'ok');
    render();
  } catch (err) { flashError('Erreur', err); }
}

function afficherLienPersonnel(candidat) {
  const lien = candidat.Lien_personnel;
  const uuid = candidat.UUID_personnel;
  // 39e échange (tour suivant, x4) : jusqu'ici cette fenêtre n'exposait que le lien complet — aucun
  // endroit ne montrait la valeur "brute" nécessaire au nouvel écran de connexion mél + mot de passe
  // d'espace-stagiaire.js (le champ mot de passe de ce formulaire écrit exactement dans
  // Candidats_du_stage.UUID_personnel, voir la note d'architecture d'espace-stagiaire.js). Un membre
  // de l'équipe qui voulait le communiquer devait rouvrir la grille Grist brute pour aller chercher
  // cette colonne à la main — corrigé en l'affichant ici, copiable, à côté du lien.
  const body = lien
    ? `<div class="field"><label>Lien personnel de ${escapeHtml(candidat.Nom || '')} ${escapeHtml(candidat.Prenom || '')}</label>
        <div class="link-row"><input type="text" id="lp-input" readonly value="${escapeHtml(lien)}"><button type="button" class="btn btn-small btn-secondary" id="lp-copy">Copier</button></div>
      </div>
      <div class="field"><label>Mot de passe (écran de connexion « espace stagiaire »)</label>
        <div class="link-row"><input type="text" id="lp-mdp" readonly value="${escapeHtml(uuid || '')}"><button type="button" class="btn btn-small btn-secondary" id="lp-mdp-copy">Copier</button></div>
        <p class="field-help">À communiquer avec l'adresse mél du candidat pour l'écran de connexion mél + mot de passe — c'est la même valeur que celle contenue dans le lien personnel ci-dessus, juste isolée pour être plus facile à transmettre (téléphone, SMS...) qu'un lien complet.</p>
      </div>`
    : `<p class="field-help">Aucun lien personnel enregistré pour ce candidat — cliquez sur « Régénérer » pour en créer un (nécessite que l'URL de l'espace stagiaire soit configurée).</p>`;
  const modal = openModal(`
    <h2>Lien personnel — espace stagiaire</h2>
    ${body}
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="lp-regen">Régénérer</button>
      <button type="button" class="btn btn-secondary" id="lp-close">Fermer</button>
    </div>
  `);
  const copyBtn = modal.querySelector('#lp-copy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(modal.querySelector('#lp-input').value); showFlash('Copié.', 'ok'); }
    catch (err) { flashError('Erreur de copie', err); }
  });
  const copyMdpBtn = modal.querySelector('#lp-mdp-copy');
  if (copyMdpBtn) copyMdpBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(modal.querySelector('#lp-mdp').value); showFlash('Copié.', 'ok'); }
    catch (err) { flashError('Erreur de copie', err); }
  });
  modal.querySelector('#lp-regen').addEventListener('click', async () => { closeModal(); await regenererLienPersonnel(candidat); });
  modal.querySelector('#lp-close').addEventListener('click', closeModal);
}

// 36e échange — icônes en ligne (SVG, trait fin) réutilisées par les cartes « Diffuser… » ci-dessous
// (recrutement et satisfaction) : chevron d'accordéon/repli, lien, copier, coche de statut. Pas de
// dépendance externe — cohérent avec le reste du widget qui n'utilise que du HTML/JS natif.
const ICON_CHEVRON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>';
const ICON_LINK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 15l6-6"></path><path d="M11 5.5l1-1a3.5 3.5 0 0 1 5 5l-1 1"></path><path d="M13 18.5l-1 1a3.5 3.5 0 0 1-5-5l1-1"></path></svg>';
const ICON_COPY = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="1"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
const ICON_CHECK = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';

// Statut affiché à côté du lien à diffuser (recrutement ou satisfaction) : « warn » tant que les
// réglages techniques ne sont pas complets ou que le lien n'a pas encore été généré (premier
// enregistrement), « ok » une fois qu'il y a un vrai lien à copier.
function lienStatus(baseUrl, link) {
  if (!baseUrl) return { badgeClass: 'badge-warn', label: 'Réglages à compléter' };
  if (!link) return { badgeClass: 'badge-warn', label: 'À enregistrer' };
  return { badgeClass: 'badge-forme', label: 'Prêt à partager' };
}

function renderConfigFormulaire(stage) {
  const cfg = formulaireConfigForStage(stage.id);
  const masqueeSet = new Set(cfg.masquees);
  const optionnelleSet = new Set(cfg.optionnelles);
  const jamaisConfigure = !(state.options.formulaireConfig && state.options.formulaireConfig[stage.id]);

  // 36e échange — refonte de l'écran (accordéon repliable par catégorie + lien mis en avant), voir
  // acl-academies.md et la maquette « Formulaire de recrutement — refonte » (Option A). Les compteurs
  // ci-dessous alimentent le résumé affiché au-dessus de la liste (totalQuestions/maskedCount/
  // optionalCount) ; optionalCount exclut la question de type « Lien » (décharge), qui n'a pas de
  // case Facultative (elle se masque ou s'affiche, sans notion de caractère facultatif).
  let totalQuestions = 0;
  let maskedCount = 0;
  let optionalCount = 0;

  const sectionsHtml = CATEGORIES_QUESTIONS_RECRUTEMENT.map((cat, catIndex) => {
    const qs = QUESTIONS_RECRUTEMENT.filter((q) => q.categorie === cat).sort((a, b) => a.ordre - b.ordre);
    let shownCount = 0;
    const rowsHtml = qs.map((q) => {
      const masquee = jamaisConfigure ? false : masqueeSet.has(q.id);
      const optionnelle = jamaisConfigure ? !q.obligatoireParDefaut : optionnelleSet.has(q.id);
      totalQuestions++;
      if (masquee) maskedCount++; else shownCount++;
      if (q.type !== 'Lien' && optionnelle) optionalCount++;
      const dependance = q.dependsOn ? `<p class="field-help" style="margin:4px 0 0;">↳ affichée seulement si « ${escapeHtml(QUESTIONS_RECRUTEMENT.find((p) => p.id === q.dependsOn.question).libelle)} » = ${escapeHtml(q.dependsOn.equals)}</p>` : '';
      const note = q.note ? `<p class="field-help" style="margin:4px 0 0;">${escapeHtml(q.note)}</p>` : '';
      if (q.type === 'Lien') {
        return `
          <div class="q-row">
            <div class="q-row-main">
              <span class="q-label">${escapeHtml(q.libelle)}</span>
              <span class="q-type-tag">${escapeHtml(q.type)}</span>
              ${dependance}${note}
              <input type="text" class="fc-decharge-url" placeholder="https://.../decharge-responsabilite.pdf" value="${escapeHtml(state.options.dechargeUrl || '')}" style="margin-top:6px;max-width:100%;">
            </div>
            <div class="q-toggles">
              <label class="q-toggle"><input type="checkbox" class="fc-mask" data-q-id="${q.id}" ${masquee ? 'checked' : ''}>Masquer</label>
            </div>
          </div>`;
      }
      return `
        <div class="q-row">
          <div class="q-row-main">
            <span class="q-label">${escapeHtml(q.libelle)}</span>
            <span class="q-type-tag">${escapeHtml(q.type)}</span>
            ${dependance}${note}
          </div>
          <div class="q-toggles">
            <label class="q-toggle"><input type="checkbox" class="fc-mask" data-q-id="${q.id}" ${masquee ? 'checked' : ''}>Masquer</label>
            <label class="q-toggle"><input type="checkbox" class="fc-opt" data-q-id="${q.id}" ${optionnelle ? 'checked' : ''}>Facultative</label>
          </div>
        </div>`;
    }).join('');
    const bodyId = 'fc-cat-body-' + catIndex;
    return `
      <div class="accordion-cat">
        <button type="button" class="accordion-head" data-fc-cat-toggle aria-expanded="false" aria-controls="${bodyId}">
          <div class="accordion-head-left">${ICON_CHEVRON}<span class="accordion-cat-name">${escapeHtml(cat)}</span></div>
          <span class="accordion-cat-meta">${shownCount} / ${qs.length} affichées</span>
        </button>
        <div class="accordion-body" id="${bodyId}" hidden>${rowsHtml}</div>
      </div>`;
  }).join('');

  const baseUrl = pageUrlFor(state.options.pageIdFormulairePublic, state.options.baseUrlFormulairePublic);
  const link = buildRecrutementLink(baseUrl, stage);
  const status = lienStatus(baseUrl, link);
  // 41e échange, tour suivant — le volet « Réglages techniques du document » (URL de base + numéros
  // de page) a été retiré de cette carte à la demande de l'utilisateur : ces réglages sont désormais
  // saisis directement par l'administrateur du document dans la table `Parametres_widget` (voir
  // saveParametreWidget/loadParametresWidgetIntoState plus haut), plutôt que via ce formulaire. Cette
  // carte se contente de lire state.options.baseUrlDocument (repeuplé au chargement du widget) pour
  // savoir si le lien peut se générer, et d'orienter vers la table sinon.
  const setupNeedsAttention = !state.options.baseUrlDocument;

  return `
    <div class="card">
      <div class="link-callout">
        <div class="link-callout-head">
          <div class="link-callout-title">${ICON_LINK}Diffuser le formulaire de recrutement</div>
          <span class="badge badge-icon ${status.badgeClass}">${ICON_CHECK}${status.label}</span>
        </div>
        <p class="field-help" style="margin:0 0 10px;">Copiez ce lien et transmettez-le aux candidats potentiels de ce stage — ils pourront candidater sans créer de compte.</p>
        <div class="link-row">
          <input type="text" id="fc-link" readonly value="${escapeHtml(link)}" placeholder="Enregistrez la configuration pour générer le lien">
          <button type="button" class="btn btn-small btn-primary" id="fc-copy" ${link ? '' : 'disabled'}>${ICON_COPY}Copier</button>
        </div>
        <p class="status-note" id="fc-status"></p>
        ${setupNeedsAttention ? `<p id="fc-setup-warning" class="field-help" style="color:var(--danger);">⚠ Réglages techniques manquants (URL de base du document et/ou numéros de page). Ce n'est plus configurable depuis ce widget : demandez à l'administrateur du document Grist de renseigner les clés <code>baseUrlDocument</code>, <code>pageIdFormulairePublic</code> et <code>pageIdEspaceStagiaire</code> directement dans la table « Parametres_widget » (colonnes Cle/Valeur), puis rouvrez ce widget.</p>` : ''}
      </div>

      <h3 style="margin-top:22px;">Questions du formulaire</h3>
      <p class="field-help">Nom, prénom et adresse mél sont toujours demandés sur le formulaire et ne se configurent pas ici. Les questions ci-dessous sont fixes (codées dans le widget) ; vous choisissez, pour ce stage, lesquelles masquer ou rendre facultatives.</p>
      ${jamaisConfigure ? '<p class="field-help">Ce formulaire n\'a pas encore été configuré pour ce stage : les réglages par défaut sont affichés ci-dessous — ajustez puis enregistrez.</p>' : ''}
      <div class="q-summary">
        <div class="q-summary-counts">
          <span class="count-pill">${totalQuestions} questions</span>
          <span class="count-pill">${CATEGORIES_QUESTIONS_RECRUTEMENT.length} catégories</span>
          <span class="count-pill">${maskedCount} masquée${maskedCount > 1 ? 's' : ''}</span>
          <span class="count-pill">${optionalCount} facultative${optionalCount > 1 ? 's' : ''}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-small" id="fc-toggle-all">Tout déplier</button>
      </div>
      ${sectionsHtml}
      <div class="actions-bar" style="margin-top:16px;"><button type="button" class="btn btn-primary" id="fc-save">Enregistrer la configuration</button></div>
      <p class="field-help">Ce bouton enregistre la sélection de questions et l'URL de décharge ci-dessus (réglages de contenu). Les réglages techniques (URL de base du document, numéros de page) se configurent désormais directement dans la table « Parametres_widget », par l'administrateur du document Grist — voir l'avertissement en tête de carte si le lien ne se génère pas encore. Le lien reste stable une fois généré (même si vous modifiez les questions ensuite) — seule la sélection de questions affichées change, pas l'adresse. La page publique elle-même reste à construire et à héberger séparément ; ce lien n'est fonctionnel qu'une fois cette page en place et les règles ACL de lecture/écriture anonyme posées sur le document (voir acl-academies.md).</p>
    </div>
  `;
}

// Bascule accessible d'un panneau repliable (accordéon de catégorie ou disclosure de réglages) :
// pure manipulation du DOM déjà en place (hidden + aria-expanded), jamais un appel à render() — voir
// la note dans bindConfigFormulaire ci-dessous sur pourquoi un re-rendu intermédiaire est à éviter
// ici. Réutilisée par bindConfigFormulaire et bindConfigSatisfaction (36e échange).
function bindDisclosureToggle(triggerId, bodyId) {
  const trigger = document.getElementById(triggerId);
  const body = document.getElementById(bodyId);
  if (!trigger || !body) return;
  trigger.addEventListener('click', () => {
    const isOpen = trigger.getAttribute('aria-expanded') === 'true';
    body.hidden = isOpen;
    trigger.setAttribute('aria-expanded', String(!isOpen));
  });
}

function bindConfigFormulaire(stage) {
  // Toutes les modifications de cette carte (cases à cocher, URL de décharge) ne sont lues qu'au
  // moment d'Enregistrer, en une seule fois — volontairement pas de handler "change" qui appellerait
  // render() en cours de route : un re-rendu intermédiaire reconstruit tout le HTML de la carte depuis
  // state.options et effacerait les cases déjà cochées mais pas encore enregistrées (piège déjà
  // rencontré ailleurs dans ce widget avec un re-rendu destructif). Même logique pour
  // l'ouverture/fermeture de l'accordéon ci-dessous : un pur bascule de `hidden` sur le DOM déjà
  // rendu, jamais un render(). (41e échange, tour suivant — le volet « Réglages techniques » et son
  // disclosure fc-setup-toggle/fc-setup-body ont été retirés, voir renderConfigFormulaire ci-dessus.)

  const catToggles = Array.from(document.querySelectorAll('[data-fc-cat-toggle]'));
  const toggleAllBtn = document.getElementById('fc-toggle-all');
  const updateToggleAllLabel = () => {
    if (!toggleAllBtn) return;
    const allOpen = catToggles.length > 0 && catToggles.every((btn) => btn.getAttribute('aria-expanded') === 'true');
    toggleAllBtn.textContent = allOpen ? 'Tout replier' : 'Tout déplier';
  };
  catToggles.forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(btn.getAttribute('aria-controls'));
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      if (body) body.hidden = isOpen;
      btn.setAttribute('aria-expanded', String(!isOpen));
      updateToggleAllLabel();
    });
  });
  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const allOpen = catToggles.every((btn) => btn.getAttribute('aria-expanded') === 'true');
      catToggles.forEach((btn) => {
        const body = document.getElementById(btn.getAttribute('aria-controls'));
        if (body) body.hidden = allOpen;
        btn.setAttribute('aria-expanded', String(!allOpen));
      });
      updateToggleAllLabel();
    });
  }

  document.getElementById('fc-save').addEventListener('click', async () => {
    const masquees = Array.from(document.querySelectorAll('.fc-mask')).filter((el) => el.checked).map((el) => el.getAttribute('data-q-id'));
    const optionnelles = Array.from(document.querySelectorAll('.fc-opt')).filter((el) => el.checked).map((el) => el.getAttribute('data-q-id'));
    const dechargeUrlEl = document.querySelector('.fc-decharge-url');
    const dechargeUrl = dechargeUrlEl ? dechargeUrlEl.value.trim() : (state.options.dechargeUrl || '');

    try {
      // Écrit dans la table Parametres_widget (pas grist.setOption) : ces réglages doivent être
      // lisibles par les widgets publics (formulaire-public.js, espace-stagiaire.js), voir la note
      // au-dessus de QUESTIONS_RECRUTEMENT expliquant pourquoi grist.setOption ne convient pas ici.
      const nouvelleConfig = { ...state.options.formulaireConfig, [stage.id]: { masquees, optionnelles } };
      await saveParametreWidget('formulaireConfig', JSON.stringify(nouvelleConfig));
      await saveParametreWidget('dechargeUrl', dechargeUrl);
      // 41e échange, tour suivant — baseUrlDocument/pageIdFormulairePublic/pageIdEspaceStagiaire ne
      // sont plus saisis depuis cette carte (voir renderConfigFormulaire) : on lit directement
      // state.options, déjà repeuplé au chargement du widget depuis Parametres_widget, table que
      // l'administrateur du document édite désormais lui-même dans Grist.
      const baseUrl = pageUrlFor(state.options.pageIdFormulairePublic, '');
      // Le lien (UUID + URL) n'est généré qu'une seule fois par stage — un enregistrement ultérieur
      // met à jour la sélection de questions sans jamais changer l'adresse déjà distribuée.
      if (!stage.UUID) {
        const uuid = generateUUID();
        const url = buildRecrutementLink(baseUrl, { ...stage, UUID: uuid });
        await updateRecord('BD_Stages2', stage.id, { UUID: uuid, Formulaire_URL: url });
      } else if (!stage.Formulaire_URL && baseUrl) {
        // 41e échange, tour suivant — filet de sécurité rendu plus utile depuis que baseUrlDocument/
        // pageIdFormulairePublic sont configurés séparément (par l'administrateur, dans
        // Parametres_widget) plutôt qu'au même moment que ce bouton : si un premier enregistrement a
        // eu lieu avant que ces réglages ne soient renseignés, l'UUID a été figé mais Formulaire_URL
        // est resté vide (voir formulaire-public.js, qui lit ce champ directement pour le panneau
        // staff — 41e échange). On le complète ici dès que baseUrl est disponible, sans jamais
        // toucher à l'UUID déjà distribué.
        const url = buildRecrutementLink(baseUrl, stage);
        await updateRecord('BD_Stages2', stage.id, { Formulaire_URL: url });
      }
      showFlash('Configuration enregistrée.', 'ok');
      render();
    } catch (err) { flashError('Erreur', err); }
  });

  const copyBtn = document.getElementById('fc-copy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const input = document.getElementById('fc-link');
    const statusEl = document.getElementById('fc-status');
    try {
      await navigator.clipboard.writeText(input.value);
      statusEl.textContent = 'Copié.';
    } catch (err) {
      input.removeAttribute('readonly'); input.select(); document.execCommand('copy'); input.setAttribute('readonly', 'true');
      statusEl.textContent = 'Copié (méthode de repli).';
    }
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
}

/* ---------------------------------------------------------------------- */
/* Configuration de l'enquête de satisfaction (29e échange) — même principe */
/* que renderConfigFormulaire/bindConfigFormulaire ci-dessus, mais sans      */
/* colonne « Masquer » : aucune question du socle satisfaction ne se cache,  */
/* seul son caractère facultatif/obligatoire se configure (décision         */
/* explicite de l'utilisateur) — voir la note au-dessus de                  */
/* QUESTIONS_SATISFACTION. La clé Satisfaction_UUID est DISTINCTE de la clé  */
/* UUID du recrutement (voir buildSatisfactionLink) pour que l'anonymat de   */
/* l'enquête soit garanti même face à quelqu'un connaissant le lien de       */
/* recrutement.                                                             */
/* ---------------------------------------------------------------------- */

function renderConfigSatisfaction(stage) {
  const cfg = satisfactionConfigForStage(stage.id);
  const optionnelleSet = new Set(cfg.optionnelles);
  const jamaisConfigure = !(state.options.satisfactionConfig && state.options.satisfactionConfig[stage.id]);

  // 36e échange — même refonte (lien mis en avant + section repliable) que renderConfigFormulaire
  // ci-dessus ; une seule section ici puisque le socle satisfaction n'a pas de catégories, mais le
  // même habillage visuel (accordion-cat/accordion-head/q-row) pour rester cohérent à l'écran.
  let optionalCount = 0;
  const rowsHtml = QUESTIONS_SATISFACTION.map((q) => {
    const optionnelle = q.obligatoireFixe ? false : (jamaisConfigure ? !q.obligatoireParDefaut : optionnelleSet.has(q.id));
    if (optionnelle) optionalCount++;
    return `
      <div class="q-row">
        <div class="q-row-main"><span class="q-label">${escapeHtml(q.libelle)}</span></div>
        <div class="q-toggles">
          ${q.obligatoireFixe
            ? '<span class="q-type-tag">Toujours obligatoire</span>'
            : `<label class="q-toggle"><input type="checkbox" class="sc-opt" data-q-id="${q.id}" ${optionnelle ? 'checked' : ''}>Facultative</label>`}
        </div>
      </div>`;
  }).join('');

  const baseUrlDoc = state.options.baseUrlDocument || '';
  const baseUrl = pageUrlFor(state.options.pageIdEnqueteSatisfaction, state.options.baseUrlEnqueteSatisfaction);
  const link = buildSatisfactionLink(baseUrl, stage);
  const status = lienStatus(baseUrl, link);
  // 41e échange, tour suivant — le volet « Réglages techniques » (URL de base + numéro de page) a été
  // retiré de cette carte, même décision que pour renderConfigFormulaire ci-dessus : ces valeurs sont
  // désormais saisies directement par l'administrateur du document dans la table `Parametres_widget`.
  const setupNeedsAttention = !baseUrlDoc || !state.options.pageIdEnqueteSatisfaction;

  return `
    <div class="card">
      <div class="link-callout">
        <div class="link-callout-head">
          <div class="link-callout-title">${ICON_LINK}Diffuser l'enquête de satisfaction</div>
          <span class="badge badge-icon ${status.badgeClass}">${ICON_CHECK}${status.label}</span>
        </div>
        <p class="field-help" style="margin:0 0 10px;">Copiez ce lien et transmettez-le aux stagiaires une fois le stage terminé — l'accès reste possible avant la clôture du stage.</p>
        <div class="link-row">
          <input type="text" id="sc-link" readonly value="${escapeHtml(link)}" placeholder="Enregistrez la configuration pour générer le lien">
          <button type="button" class="btn btn-small btn-primary" id="sc-copy" ${link ? '' : 'disabled'}>${ICON_COPY}Copier</button>
        </div>
        <p class="status-note" id="sc-status"></p>
        ${setupNeedsAttention ? `<p id="sc-setup-warning" class="field-help" style="color:var(--danger);">⚠ Réglages techniques manquants (URL de base du document et/ou numéro de page). Ce n'est plus configurable depuis ce widget : demandez à l'administrateur du document Grist de renseigner les clés <code>baseUrlDocument</code> et <code>pageIdEnqueteSatisfaction</code> directement dans la table « Parametres_widget » (colonnes Cle/Valeur), puis rouvrez ce widget.</p>` : ''}
      </div>

      <h3 style="margin-top:22px;">Questions de l'enquête</h3>
      <p class="field-help">Chaque module du planning de ce stage (obligatoire ou complémentaire) est en plus évalué individuellement, sans configuration possible ici (voir enquete-satisfaction.js) — cette carte ne concerne que le socle commun de questions ci-dessous.</p>
      ${jamaisConfigure ? '<p class="field-help">Cette enquête n\'a pas encore été configurée pour ce stage : les réglages par défaut sont affichés ci-dessous — ajustez puis enregistrez.</p>' : ''}
      <div class="q-summary">
        <div class="q-summary-counts">
          <span class="count-pill">${QUESTIONS_SATISFACTION.length} questions du socle commun</span>
          <span class="count-pill">${optionalCount} facultative${optionalCount > 1 ? 's' : ''}</span>
        </div>
      </div>
      <div class="accordion-cat">
        <button type="button" class="accordion-head" id="sc-questions-toggle" aria-expanded="false" aria-controls="sc-questions-body">
          <div class="accordion-head-left">${ICON_CHEVRON}<span class="accordion-cat-name">Socle commun de questions</span></div>
          <span class="accordion-cat-meta">${QUESTIONS_SATISFACTION.length} question${QUESTIONS_SATISFACTION.length > 1 ? 's' : ''}</span>
        </button>
        <div class="accordion-body" id="sc-questions-body" hidden>${rowsHtml}</div>
      </div>
      <div class="actions-bar" style="margin-top:16px;"><button type="button" class="btn btn-primary" id="sc-save">Enregistrer la configuration</button></div>
      <p class="field-help">Ce bouton enregistre la sélection de questions (réglage de contenu). Le numéro de page et l'URL de base du document se configurent désormais directement dans la table « Parametres_widget », par l'administrateur du document Grist — voir l'avertissement en tête de carte si le lien ne se génère pas encore. Ce lien est distinct de celui du recrutement et reste stable une fois généré. Il reste accessible avant même la clôture du stage (voulu) — seule une annulation du stage le ferme. ⚠ Un problème de cloisonnement des clés est en cours de correction côté règles ACL (voir acl-academies.md) : la clé du formulaire de recrutement ne doit pas, elle, donner accès à cette enquête.</p>
    </div>
  `;
}

function bindConfigSatisfaction(stage) {
  // Même discipline « pas de render() intermédiaire » que bindConfigFormulaire — voir sa note.
  // (41e échange, tour suivant — le disclosure sc-setup-toggle/sc-setup-body a été retiré, voir
  // renderConfigSatisfaction ci-dessus ; celui des questions, sc-questions-toggle, reste inchangé.)
  bindDisclosureToggle('sc-questions-toggle', 'sc-questions-body');

  document.getElementById('sc-save').addEventListener('click', async () => {
    const optionnelles = Array.from(document.querySelectorAll('.sc-opt')).filter((el) => el.checked).map((el) => el.getAttribute('data-q-id'));

    try {
      const nouvelleConfig = { ...state.options.satisfactionConfig, [stage.id]: { optionnelles } };
      await saveParametreWidget('satisfactionConfig', JSON.stringify(nouvelleConfig));
      // 41e échange, tour suivant — pageIdEnqueteSatisfaction n'est plus saisi depuis cette carte
      // (voir renderConfigSatisfaction) : on lit directement state.options, déjà repeuplé au
      // chargement du widget depuis Parametres_widget, table que l'administrateur du document édite
      // désormais lui-même dans Grist.
      const baseUrl = pageUrlFor(state.options.pageIdEnqueteSatisfaction, '');
      // Même principe que le lien de recrutement : généré une seule fois par stage, jamais réécrit.
      if (!stage.Satisfaction_UUID) {
        const uuid = generateUUID();
        const url = buildSatisfactionLink(baseUrl, { ...stage, Satisfaction_UUID: uuid });
        await updateRecord('BD_Stages2', stage.id, { Satisfaction_UUID: uuid, Satisfaction_URL: url });
      } else if (!stage.Satisfaction_URL && baseUrl) {
        // 41e échange, tour suivant — même filet de sécurité que côté recrutement (voir
        // bindConfigFormulaire) : complète Satisfaction_URL si un premier enregistrement a eu lieu
        // avant que l'administrateur ne renseigne baseUrlDocument/pageIdEnqueteSatisfaction dans
        // Parametres_widget, sans jamais toucher à la clé déjà distribuée.
        const url = buildSatisfactionLink(baseUrl, stage);
        await updateRecord('BD_Stages2', stage.id, { Satisfaction_URL: url });
      }
      showFlash('Configuration enregistrée.', 'ok');
      render();
    } catch (err) { flashError('Erreur', err); }
  });

  const copyBtn = document.getElementById('sc-copy');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const input = document.getElementById('sc-link');
    const statusEl = document.getElementById('sc-status');
    try {
      await navigator.clipboard.writeText(input.value);
      statusEl.textContent = 'Copié.';
    } catch (err) {
      input.removeAttribute('readonly'); input.select(); document.execCommand('copy'); input.setAttribute('readonly', 'true');
      statusEl.textContent = 'Copié (méthode de repli).';
    }
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });
}

function renderStagiaires(stage) {
  const candidates = candidatesForStage(stage.id);
  const counts = { Candidat: 0, "Liste d'attente": 0, Stagiaire: 0, 'Formé': 0, 'Non retenu': 0 };
  candidates.forEach((c) => { if (c.Statut in counts) counts[c.Statut]++; });
  const effectif = stage.Effectif_theorique || 0;
  // Restructuration (60e échange) : à ce stade du workflow, un candidat ne peut plus être choisi
  // "Formé" directement — ce statut ne s'obtient désormais que dans l'onglet « Émargement &
  // formation » (voir renderEmargement/applySuggestedStatuts), à partir de l'assiduité constatée.
  // Un candidat déjà "Formé" (import historique, ou retour en arrière depuis l'onglet 4) reste
  // affiché ici en badge en lecture seule plutôt qu'avec un sélecteur qui laisserait croire qu'on
  // peut encore choisir ce statut depuis cet écran.
  const statutOptions = ['Candidat', "Liste d'attente", 'Stagiaire', 'Non retenu'];

  const rowsHtml = candidates.length ? candidates.slice().sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr')).map((c) => {
    const statutCell = c.Statut === 'Formé'
      ? `<span class="badge ${STATUT_BADGE_CANDIDAT['Formé']}">Formé</span>`
      : `<select class="cand-statut" data-cand-id="${c.id}">${statutOptions.map((s) => `<option value="${s}" ${c.Statut === s ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
    return `<tr>
      <td>${escapeHtml(c.Nom || '')} ${escapeHtml(c.Prenom || '')}</td>
      <td>${escapeHtml(c.Mel || '')}</td>
      <td>${statutCell}</td>
      <td>
        <div class="actions-bar">
          <button type="button" class="btn btn-small btn-secondary cand-eligibilite" data-cand-id="${c.id}">Éligibilité</button>
          <button type="button" class="btn btn-small btn-secondary cand-lien-perso" data-cand-id="${c.id}">${c.Lien_personnel ? 'Lien perso' : 'Générer le lien perso'}</button>
        </div>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty-state">Aucune candidature pour ce stage.</td></tr>';

  return `
    <div class="card">
      <h3>Stagiaires</h3>
      <p class="section-sub">${counts.Stagiaire + counts['Formé']} validé(s) / ${effectif || '—'} places · ${counts.Candidat} en attente de décision · ${counts["Liste d'attente"]} en liste d'attente${counts['Formé'] ? ` · ${counts['Formé']} formé(s)` : ''}</p>
      <p class="field-help">« Lien perso » retrouve ou (re)génère le lien personnel d'un candidat vers l'espace stagiaire (planning + émargement) — utile s'il l'a perdu, ou pour les candidatures déposées avant que l'URL de l'espace stagiaire soit configurée. Le statut « Formé » ne se choisit plus ici : il s'obtient dans l'onglet « Émargement & formation », à partir de l'assiduité constatée.</p>
      <table class="data-table">
        <thead><tr><th>Candidat</th><th>Email</th><th>Statut</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <div class="actions-bar" style="margin-top:14px;">
        <button type="button" class="btn btn-primary" id="candAcceptAll">Accepter toutes les candidatures</button>
        <button type="button" class="btn btn-secondary" id="candCheckAllElig">Vérifier toutes les éligibilités</button>
      </div>
    </div>
    <div class="card">
      <h3>Ajouter des candidatures</h3>
      <div class="grid-3">
        <div class="field"><label for="candNom">Nom</label><input type="text" id="candNom"></div>
        <div class="field"><label for="candPrenom">Prénom</label><input type="text" id="candPrenom"></div>
        <div class="field"><label for="candMel">Email</label><input type="email" id="candMel"></div>
      </div>
      <div class="actions-bar"><button type="button" class="btn btn-secondary" id="candAddOne">Ajouter cette candidature</button></div>
      <div class="rgpd-reminder" style="margin-top:14px;">
        <strong>Rappel RGPD</strong> — les candidatures ajoutées ici (nom, prénom, adresse mél, puis
        les réponses du formulaire de recrutement) sont des données à caractère personnel :
        <ul>
          <li>ne saisissez que les données strictement nécessaires au traitement de la candidature (principe de minimisation) ;</li>
          <li>assurez-vous que les personnes concernées ont bien été informées de cette collecte (voir la mention « Données personnelles » en pied de page) ;</li>
          <li>ne collez une liste que si elle provient d'une source fiable (la personne elle-même, ou un service autorisé à la transmettre).</li>
        </ul>
      </div>
      <p class="field-help">Ou saisie groupée — une ligne par candidat, valeurs séparées par une tabulation ou un point-virgule : <span class="mono">Nom;Prénom;Email</span></p>
      <div class="field"><textarea id="candBulk" placeholder="Dupont;Jean;jean.dupont@ac-exemple.fr"></textarea></div>
      <div class="actions-bar"><button type="button" class="btn btn-primary" id="candAddBulk">Ajouter la liste</button></div>
    </div>
    ${renderConfigFormulaire(stage)}
  `;
}

async function addCandidatesBulk(stage, entries) {
  const existing = candidatesForStage(stage.id).filter((c) => c.Statut === 'Candidat' || c.Statut === 'Stagiaire' || c.Statut === 'Formé').length;
  const effectif = stage.Effectif_theorique || Infinity;
  const withStatut = entries.map((e, i) => ({
    ...e,
    Stage: stage.id,
    Statut: (existing + i) < effectif ? 'Candidat' : "Liste d'attente",
  }));
  try {
    await addRecords('Candidats_du_stage', withStatut);
    showFlash(withStatut.length + ' candidature(s) ajoutée(s).', 'ok');
    render();
  } catch (err) { flashError('Erreur', err); }
}

function findInAnnuaire(nom, prenom, mel) {
  const rows = T('Annuaire_FPGC');
  if (mel) {
    const m = rows.find((r) => normalize(r.Mel) === normalize(mel));
    if (m) return m;
  }
  if (nom && prenom) return rows.find((r) => normalize(r.Nom) === normalize(nom) && normalize(r.Prenom) === normalize(prenom));
  return null;
}

function categoriesFromReferences(refString) {
  if (!refString) return [];
  return refString.split(',').map((r) => r.trim()).filter(Boolean).map(decodeReferenceCategoryLabel).filter(Boolean);
}

function prerequisPourNiveau(niveauLabel) {
  return PREREQUIS_PAR_NIVEAU[niveauLabel] || null;
}

// Retourne un verdict structuré {status, message} sans effet de bord (utilisable pour un
// candidat seul comme pour une vérification groupée). status ∈ 'ok' | 'attention' | 'non-eligible'.
function eligibiliteVerdict(candidat, stage) {
  const niveau = stageNiveauRow(stage);
  const niveauLabel = niveau ? niveau.Niveau_du_stage : null;
  const prereq = niveauLabel ? prerequisPourNiveau(niveauLabel) : null;
  if (!prereq) return { status: 'ok', message: `Aucun prérequis requis pour le niveau ${niveauLabel || '—'} — candidature éligible d'office.` };
  const match = findInAnnuaire(candidat.Nom, candidat.Prenom, candidat.Mel);
  if (!match) return { status: 'attention', message: `Prérequis ${prereq} requis pour ${niveauLabel} — aucune correspondance dans l'annuaire, à vérifier manuellement.` };
  const cats = categoriesFromReferences(match.References_de_stage);
  if (cats.includes(prereq)) return { status: 'ok', message: `Prérequis ${prereq} trouvé dans l'historique de l'annuaire (fiche ${match.Nom} ${match.Prenom}).` };
  return { status: 'non-eligible', message: `Prérequis ${prereq} non trouvé dans l'historique de la fiche annuaire ${match.Nom} ${match.Prenom} — décision laissée à l'équipe administrative.` };
}

function checkEligibilite(candidat, stage) {
  const v = eligibiliteVerdict(candidat, stage);
  showFlash(`${candidat.Nom} ${candidat.Prenom} : ${v.message}`, v.status === 'non-eligible' ? 'error' : (v.status === 'attention' ? null : 'ok'));
}

function checkAllEligibilites(stage) {
  const candidates = candidatesForStage(stage.id).filter((c) => c.Statut === 'Candidat' || c.Statut === "Liste d'attente");
  if (!candidates.length) { showFlash('Aucune candidature en attente de décision à vérifier.', null); return; }
  const rows = candidates.slice().sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr')).map((c) => {
    const v = eligibiliteVerdict(c, stage);
    const icon = v.status === 'ok' ? '✅' : (v.status === 'attention' ? '⚠️' : '⛔');
    return `<tr><td>${icon}</td><td>${escapeHtml(c.Nom || '')} ${escapeHtml(c.Prenom || '')}</td><td>${escapeHtml(v.message)}</td></tr>`;
  }).join('');
  const modal = openModal(`
    <h2>Vérification des éligibilités (${candidates.length})</h2>
    <table class="data-table"><thead><tr><th></th><th>Candidat</th><th>Résultat</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" id="eligClose">Fermer</button></div>
  `);
  modal.querySelector('#eligClose').addEventListener('click', closeModal);
}

async function acceptAllCandidatures(stage) {
  const candidates = candidatesForStage(stage.id).filter((c) => c.Statut === 'Candidat');
  if (!candidates.length) { showFlash('Aucune candidature en attente à accepter.', null); return; }
  if (!window.confirm(`Accepter les ${candidates.length} candidature(s) en attente (statut → Stagiaire) ?`)) return;
  try {
    const actions = candidates.map((c) => ['UpdateRecord', physTable('Candidats_du_stage'), c.id, { Statut: 'Stagiaire' }]);
    await grist.docApi.applyUserActions(actions);
    await loadTable('Candidats_du_stage');
    showFlash(`${candidates.length} candidature(s) acceptée(s).`, 'ok');
    render();
  } catch (err) { flashError('Erreur', err); }
}

// Fusionne un candidat dans une fiche Annuaire_FPGC existante, ou en crée une nouvelle — logique
// commune réutilisée par transferAllFormesToAnnuaire (nouvel onglet 4, transfert groupé sans
// confirmation ligne par ligne, voir plus bas) : trouver la correspondance est déjà fait par
// l'appelant (findInAnnuaire), cette fonction ne fait que l'écriture.
async function mergeOrCreateAnnuaireEntry(candidat, stage, match) {
  const newRef = stage.Reference_de_stage;
  if (match) {
    const already = (match.References_de_stage || '').split(',').map((s) => s.trim()).filter(Boolean);
    const mergedRefs = already.includes(newRef) ? match.References_de_stage : [...already, newRef].join(', ');
    // 45e/46e échange : l'établissement et la fonction ne sont recopiés vers une fiche existante que
    // si le candidat apporte une valeur non vide, pour ne jamais effacer une info déjà consolidée par
    // un stage antérieur avec une candidature moins complète.
    const updates = { References_de_stage: mergedRefs };
    if (candidat.Nom_etablissement_d_affectation) updates.Nom_etablissement_d_affectation = candidat.Nom_etablissement_d_affectation;
    if (candidat.UAI_etablissement_d_affectation) updates.UAI_etablissement_d_affectation = candidat.UAI_etablissement_d_affectation;
    if (candidat.Fonction) updates.Fonction = candidat.Fonction;
    await updateRecord('Annuaire_FPGC', match.id, updates);
    return 'fusionne';
  }
  await addRecord('Annuaire_FPGC', {
    Nom: candidat.Nom, Prenom: candidat.Prenom, Mel: candidat.Mel,
    Academie_d_affectation: candidat.Academie_d_affectation || null,
    Grade_long: candidat.Grade_long || null,
    Discipline_d_exercice: candidat.Discipline_d_exercice || null,
    Fonction: candidat.Fonction || null,
    Nom_etablissement_d_affectation: candidat.Nom_etablissement_d_affectation || null,
    UAI_etablissement_d_affectation: candidat.UAI_etablissement_d_affectation || null,
    References_de_stage: newRef,
  });
  return 'cree';
}

function bindStagiaires(stage) {
  bindConfigFormulaire(stage);

  document.querySelectorAll('.cand-lien-perso').forEach((el) => el.addEventListener('click', () => {
    afficherLienPersonnel(byId('Candidats_du_stage', Number(el.getAttribute('data-cand-id'))));
  }));

  document.querySelectorAll('.cand-statut').forEach((el) => el.addEventListener('change', async (e) => {
    const id = Number(e.target.getAttribute('data-cand-id'));
    try { await updateRecord('Candidats_du_stage', id, { Statut: e.target.value }); showFlash('Statut mis à jour.', 'ok'); render(); }
    catch (err) { flashError('Erreur', err); }
  }));
  document.querySelectorAll('.cand-eligibilite').forEach((el) => el.addEventListener('click', () => {
    checkEligibilite(byId('Candidats_du_stage', Number(el.getAttribute('data-cand-id'))), stage);
  }));
  document.getElementById('candAcceptAll').addEventListener('click', () => acceptAllCandidatures(stage));
  document.getElementById('candCheckAllElig').addEventListener('click', () => checkAllEligibilites(stage));

  document.getElementById('candAddOne').addEventListener('click', () => {
    const nom = document.getElementById('candNom').value.trim();
    const prenom = document.getElementById('candPrenom').value.trim();
    const mel = document.getElementById('candMel').value.trim();
    if (!nom && !mel) { showFlash('Merci de renseigner au moins un nom ou un email.', 'error'); return; }
    addCandidatesBulk(stage, [{ Nom: nom, Prenom: prenom, Mel: mel }]);
  });
  document.getElementById('candAddBulk').addEventListener('click', () => {
    const lines = document.getElementById('candBulk').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const entries = lines.map((line) => {
      const parts = line.includes('\t') ? line.split('\t') : line.split(';');
      return { Nom: (parts[0] || '').trim(), Prenom: (parts[1] || '').trim(), Mel: (parts[2] || '').trim() };
    }).filter((e) => e.Nom || e.Mel);
    if (!entries.length) { showFlash('Aucune ligne valide détectée.', 'error'); return; }
    addCandidatesBulk(stage, entries);
  });
}

/* ---------------------------------------------------------------------- */
/* Onglet 3 — Ingénierie pédagogique                                       */
/* ---------------------------------------------------------------------- */

function intervenantsForStage(stageId) { return T('Intervenants_du_stage').filter((i) => i.Stage === stageId); }
function planningForStage(stageId) { return T('Planning_du_stage').filter((p) => p.Stage === stageId); }

// Avertissement affiché sous le champ « Sous-groupe » des 3 formulaires de créneau (édition,
// création par clic, ajout sans glisser-déposer) tant que la colonne Planning_du_stage.Sous_groupe
// n'a pas été créée sur le document réel — voir hasColumn(). Le champ reste utilisable (la liste
// des sous-groupes elle-même vient de grist.setOption, pas de cette colonne), mais la valeur
// choisie n'est alors pas enregistrée : mieux vaut le dire explicitement que de laisser croire
// que l'affectation a fonctionné.
function sousGroupeColonneManquanteHtml() {
  return hasColumn('Planning_du_stage', 'Sous_groupe') ? '' : (
    '<p class="field-help" style="color:var(--warn);">Colonne « Sous_groupe » pas encore créée sur '
    + '<code>Planning_du_stage</code> dans ce document — le sous-groupe choisi ici ne sera pas '
    + 'enregistré tant qu\'elle n\'existe pas (type Texte, voir checklist-mise-en-production.md).</p>'
  );
}

function slotsOverlap(startA, durA, startB, durB) {
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const aStart = toMin(startA), aEnd = aStart + Number(durA || 0);
  const bStart = toMin(startB), bEnd = bStart + Number(durB || 0);
  return aStart < bEnd && bStart < aEnd;
}

// Détection de chevauchement centralisée (FR-008 : "détection/refus de chevauchement limité à une
// même ressource — formateur, intervenant, ou sous-groupe"). Une ressource ne peut être engagée
// que sur un seul créneau à la fois pour un même stage/jour ; on vérifie donc l'intervenant ET le
// sous-groupe indépendamment (un créneau peut avoir l'un, l'autre, les deux, ou aucun). Utilisée
// par les deux modales (édition/création), le formulaire d'ajout sans glisser-déposer, le
// déplacement à la souris et le déplacement au clavier — un seul endroit à faire évoluer si la
// règle change, plutôt que cinq copies divergentes.
// Renvoie le libellé de la ressource en conflit ('formateur/intervenant' ou 'sous-groupe'), ou
// null si aucun chevauchement.
function planningConflict(stage, { excludeId, intervenantId, sousGroupe, dayEpoch, heure, duree }) {
  const others = planningForStage(stage.id).filter((o) => o.id !== excludeId && o.Jour === dayEpoch);
  if (intervenantId && others.some((o) => o.Intervenant === intervenantId && slotsOverlap(o.Heure_de_debut, o.Duree, heure, duree))) {
    return 'formateur/intervenant';
  }
  if (sousGroupe && others.some((o) => o.Sous_groupe === sousGroupe && slotsOverlap(o.Heure_de_debut, o.Duree, heure, duree))) {
    return 'sous-groupe';
  }
  return null;
}

/* -- Bibliothèque de modules ------------------------------------------- */

// La colonne Niveau de Modules_de_formation peut être un simple Texte ("F1", si la table a été
// recréée par import Excel) ou une vraie Référence vers la table Reference (comme dans le fichier
// .grist livré) — on compare toujours par le libellé (ex. "F1") pour rester compatible avec les deux.
function moduleNiveauLabel(m) {
  if (typeof m.Niveau === 'number' && m.Niveau) {
    const r = refRow(m.Niveau);
    return r ? r.Niveau_du_stage : null;
  }
  return m.Niveau || null;
}

function modulesForNiveau(niveauId) {
  const stageNiveau = matchReferenceRow(niveauRows(), niveauId, 'Niveau_du_stage');
  const label = stageNiveau ? stageNiveau.Niveau_du_stage : null;
  if (!label) return [];
  // Comparaison normalisée (accents/casse/espaces) : la bibliothèque peut avoir été saisie ou
  // réimportée avec une graphie légèrement différente (ex. "f1 " au lieu de "F1").
  const target = normalize(label);
  return T('Modules_de_formation').filter((m) => normalize(moduleNiveauLabel(m)) === target).slice().sort((a, b) => (a.Ordre || 0) - (b.Ordre || 0));
}

function moduleDuration(mod) {
  // Durée unique pour tous les publics — on retient la durée "cadres intermédiaires".
  return mod.Duree_minutes_cadres || mod.Duree_minutes_directeurs || 30;
}

// Détecte comment la colonne Niveau de Modules_de_formation est effectivement représentée dans
// le document courant (Texte libre "F1" ou Référence numérique vers la table Reference), pour
// écrire les nouveaux modules créés depuis le widget dans le même format que les existants.
function moduleNiveauRepresentation() {
  const sample = T('Modules_de_formation').find((m) => m.Niveau !== null && m.Niveau !== undefined && m.Niveau !== '');
  return (sample && typeof sample.Niveau === 'number') ? 'ref' : 'text';
}

function niveauValueForModuleWrite(niveauId) {
  const row = matchReferenceRow(niveauRows(), niveauId, 'Niveau_du_stage');
  if (!row) return null;
  // On écrit toujours l'id résolu (row.id), pas niveauId tel quel — au cas où niveauId aurait été
  // fourni au format texte historique d'un stage importé (voir matchReferenceRow ci-dessus).
  return moduleNiveauRepresentation() === 'ref' ? row.id : row.Niveau_du_stage;
}

// Seuls les modules Obligatoires sont affichés dans la palette (glisser-déposer) : les
// Complémentaires ne s'affichent plus en permanence, ils apparaissent en autocomplétion au moment
// de créer un créneau par clic sur le planning (voir openPlanningCreateModal ci-dessous).
function renderModulePalette(stage) {
  const modules = modulesForNiveau(stage.Niveau_du_stage).filter((m) => m.Type === 'Obligatoire');
  if (!modules.length) {
    const stageNiveau = stageNiveauRow(stage);
    const label = stageNiveau ? stageNiveau.Niveau_du_stage : null;
    const present = Array.from(new Set(T('Modules_de_formation').map(moduleNiveauLabel).filter(Boolean)));
    const detail = present.length
      ? `Niveaux actuellement présents dans Modules_de_formation : ${present.map((p) => escapeHtml(p)).join(', ')}.`
      : 'La table Modules_de_formation semble vide, ou sa colonne Niveau est vide sur toutes les lignes.';
    return `<p class="empty-state">Aucun module obligatoire dans la bibliothèque pour le niveau « ${escapeHtml(label || '—')} ». ${detail} Cliquez directement sur un créneau du planning pour créer un module complémentaire.</p>`;
  }
  const itemHtml = (m) => {
    const d = moduleDuration(m) ? (Math.round((moduleDuration(m) / 60) * 10) / 10) + 'h' : '—';
    return `<div class="pg-palette-item" draggable="true" data-module-id="${m.id}">
      <span class="pg-item-title">${escapeHtml(m.Titre)}</span>
      <span class="pg-item-meta">${d}${m.Jour_indicatif ? ' · jour ' + m.Jour_indicatif : ''}</span>
    </div>`;
  };
  return modules.map(itemHtml).join('');
}

// Ajoute un nouveau module Complémentaire à la bibliothèque si son titre (normalisé) ne
// correspond à aucun module déjà connu pour ce niveau — appelé depuis la création de créneau par
// clic sur le planning, qui remplace désormais l'ancien formulaire dédié "Ajouter un module à la
// bibliothèque".
async function ensureComplementaryModuleInLibrary(stage, titre, duree) {
  const niveauId = stage.Niveau_du_stage;
  if (!niveauId || !titre) return;
  const niveauRow = stageNiveauRow(stage);
  if (!niveauRow) return;
  const target = normalize(titre);
  const existingForNiveau = T('Modules_de_formation').filter((m) => normalize(moduleNiveauLabel(m)) === normalize(niveauRow.Niveau_du_stage));
  if (existingForNiveau.some((m) => normalize(m.Titre) === target)) return; // déjà dans la bibliothèque
  const ordre = existingForNiveau.length ? Math.max(...existingForNiveau.map((m) => m.Ordre || 0)) + 1 : 1;
  try {
    await addRecord('Modules_de_formation', {
      Titre: titre, Niveau: niveauValueForModuleWrite(niveauId), Type: 'Complémentaire',
      Jour_indicatif: null, Demi_journee: '', Duree_minutes_cadres: duree, Description: '', Ordre: ordre,
    });
  } catch (err) { flashError('Erreur (ajout à la bibliothèque de modules)', err); }
}

/* -- Grille visuelle jour / créneau ------------------------------------- */

function computeStageDays(stage) {
  const days = [];
  if (!stage.Date_de_debut_de_session || !stage.Date_de_fin_de_session) return days;
  let cursor = stage.Date_de_debut_de_session;
  let guard = 0;
  while (cursor <= stage.Date_de_fin_de_session && guard < 60) { days.push(cursor); cursor += 86400; guard++; }
  return days;
}

function slotIndexFromTime(hhmm) {
  const [h, m] = (hhmm || '08:00').split(':').map(Number);
  return (h - PLANNING_START_HOUR) * (60 / PLANNING_SLOT_MINUTES) + (m / PLANNING_SLOT_MINUTES);
}

function timeFromSlotIndex(idx) {
  const totalMin = idx * PLANNING_SLOT_MINUTES;
  const h = PLANNING_START_HOUR + Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function spanFromDuration(mins) { return Math.max(1, Math.ceil((mins || PLANNING_SLOT_MINUTES) / PLANNING_SLOT_MINUTES)); }

/* -- Code couleur des blocs de planning ---------------------------------- */
// Par modalité : couleur dérivée par hachage (palette fixe), pas de réglage utilisateur demandé.
// Par intervenant : couleur choisie explicitement par l'utilisateur (formulaire "Modifier le
// créneau"), persistée en option de widget (intervenantColors) pour être garantie distincte d'un
// intervenant à l'autre — le hachage seul pouvait donner la même couleur à deux personnes
// différentes (10 couleurs fixes, modulo). Tant qu'aucune couleur n'a été choisie pour un
// intervenant, on retombe sur le hachage de son nom pour ne pas laisser un bloc sans couleur.
const PLANNING_COLORS = ['#0063cb', '#00825b', '#c8394b', '#8d5b00', '#6a3d9a', '#2f7a78', '#b5581f', '#3f5b7a', '#a13a7c', '#4c6b2f'];
function hashString(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }
function colorForKey(key) { if (!key) return null; return PLANNING_COLORS[hashString(String(key)) % PLANNING_COLORS.length]; }

function colorForIntervenant(intervId, intervNom) {
  const custom = state.options.intervenantColors && state.options.intervenantColors[intervId];
  return safeColor(custom) || colorForKey(intervNom);
}

async function setIntervenantColor(intervId, color) {
  const map = { ...state.options.intervenantColors, [intervId]: color };
  state.options.intervenantColors = map;
  await grist.setOption('intervenantColors', map);
}

function blockColor(p, interv) {
  if (state.planningColorBy === 'modalite') return p.Modalite ? colorForKey(p.Modalite) : null;
  if (state.planningColorBy === 'sous_groupe') return p.Sous_groupe ? colorForKey(p.Sous_groupe) : null;
  return interv ? colorForIntervenant(interv.id, interv.Nom) : null;
}

// Affecte à chaque créneau une "lane" (colonne) et un laneCount — mais le laneCount est calculé
// par groupe de créneaux qui se chevauchent réellement entre eux (composante connexe), pas pour
// la journée entière : sans ça, un seul chevauchement à 9h rétrécissait à tort TOUS les créneaux
// de la journée, y compris un créneau isolé à 15h qui n'en avait pas besoin.
function assignLanes(items) {
  const sorted = items.slice().sort((a, b) => a.start - b.start);
  let cluster = [];
  let clusterEnd = -Infinity;
  const clusters = [];
  sorted.forEach((it) => {
    if (cluster.length && it.start >= clusterEnd) {
      clusters.push(cluster);
      cluster = [];
      clusterEnd = -Infinity;
    }
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.start + it.span);
  });
  if (cluster.length) clusters.push(cluster);

  clusters.forEach((clusterItems) => {
    const laneEnds = [];
    clusterItems.forEach((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = it.start + it.span;
      it.lane = lane;
    });
    const laneCount = laneEnds.length || 1;
    clusterItems.forEach((it) => { it.laneCount = laneCount; });
  });
}

function renderPlanningGrid(stage) {
  const days = computeStageDays(stage);
  if (!days.length) return '<p class="empty-state">Renseignez les dates de début et de fin du stage (onglet Préparation logistique) pour afficher la grille.</p>';
  const planning = planningForStage(stage.id);

  const gutterRows = Array.from({ length: PLANNING_SLOT_COUNT }, (_, i) => `<div class="pg-gutter-row">${i % 2 === 0 ? timeFromSlotIndex(i) : ''}</div>`).join('');

  const dayColumns = days.map((dayEpoch) => {
    const dayLabel = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: '2-digit', month: '2-digit' }).format(new Date(dayEpoch * 1000));
    const dayLabelLong = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(dayEpoch * 1000));
    const items = planning.filter((p) => p.Jour === dayEpoch).map((p) => ({ id: p.id, start: slotIndexFromTime(p.Heure_de_debut), span: spanFromDuration(p.Duree), data: p }));
    assignLanes(items);
    const slotRows = Array.from({ length: PLANNING_SLOT_COUNT }, (_, i) => `<div class="pg-slot-row" data-day="${dayEpoch}" data-slot="${i}"></div>`).join('');
    const blocks = items.map((it) => {
      const p = it.data;
      const interv = byId('Intervenants_du_stage', p.Intervenant);
      const top = it.start * PLANNING_ROW_PX;
      const height = it.span * PLANNING_ROW_PX - 2;
      const left = (it.lane / it.laneCount) * 100;
      const width = (1 / it.laneCount) * 100;
      const color = blockColor(p, interv);
      const colorClass = color ? 'pg-block-colored' : '';
      const colorStyle = color ? `--block-color: ${color};` : '';
      const metaParts = [p.Heure_de_debut || '', `${p.Duree || 0} min`, interv ? interv.Nom : 'non assigné'];
      if (p.Sous_groupe) metaParts.push('sous-groupe ' + p.Sous_groupe);
      // tabindex/role/aria-label + gestion clavier (voir bindIngenierie) : déplacement du créneau
      // aux flèches, ouverture de la modale d'édition à Entrée/Espace — pendant du glisser-déposer
      // souris ci-dessus pour rester conforme à FR-008 ("glisser-déposer à la souris ET au
      // clavier") sans dupliquer un second mode d'édition séparé.
      const ariaLabel = `${p.Titre || '(sans titre)'}, ${dayLabelLong}, ${p.Heure_de_debut || ''}, ${p.Duree || 0} minutes, ${interv ? interv.Nom : 'non assigné'}${p.Sous_groupe ? ', sous-groupe ' + p.Sous_groupe : ''}. Flèches pour déplacer, Maj+flèches pour redimensionner, Entrée pour modifier.`;
      // .pg-resize-handle : poignée de redimensionnement en bas du bloc (voir bindIngenierie) —
      // `draggable="false"` explicite pour empêcher le glisser-déposer natif du bloc parent
      // (draggable="true") de se déclencher depuis cette poignée ; le pointerdown associé appelle
      // aussi stopPropagation/preventDefault par sécurité, certains navigateurs déclenchant encore
      // un dragstart natif sur un descendant sans cet attribut explicite.
      return `<div class="pg-block ${interv ? '' : 'pg-unassigned'} ${colorClass}" draggable="true" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}" data-planning-id="${p.id}" style="top:${top}px; height:${height}px; left:${left}%; width:calc(${width}% - 2px); ${colorStyle}">
        <span class="pg-block-title">${escapeHtml(p.Titre || '(sans titre)')}</span>
        <span class="pg-block-meta">${escapeHtml(metaParts.join(' · '))}</span>
        <span class="pg-resize-handle" draggable="false" title="Étendre/réduire (pas de 30 min)"></span>
      </div>`;
    }).join('');
    return `<div class="pg-day">
      <div class="pg-day-head">${escapeHtml(dayLabel)}</div>
      <div class="pg-day-body" data-day="${dayEpoch}" style="height:${PLANNING_SLOT_COUNT * PLANNING_ROW_PX}px;">${slotRows}${blocks}</div>
    </div>`;
  }).join('');

  return `<div class="pg-grid-scroll"><div class="pg-wrap">
    <div class="pg-gutter"><div class="pg-gutter-head"></div>${gutterRows}</div>
    ${dayColumns}
  </div></div>`;
}

function renderPlanningLegend(stage) {
  const planning = planningForStage(stage.id);
  const items = new Map(); // libellé -> couleur
  planning.forEach((p) => {
    if (state.planningColorBy === 'modalite') {
      if (p.Modalite) items.set(p.Modalite, colorForKey(p.Modalite));
      return;
    }
    if (state.planningColorBy === 'sous_groupe') {
      if (p.Sous_groupe) items.set(p.Sous_groupe, colorForKey(p.Sous_groupe));
      return;
    }
    const interv = byId('Intervenants_du_stage', p.Intervenant);
    if (interv) items.set(interv.Nom, colorForIntervenant(interv.id, interv.Nom));
  });
  if (!items.size) return '<p class="empty-state">Aucun créneau coloré pour l\'instant.</p>';
  return `<div class="pg-legend">${Array.from(items.entries()).sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([k, c]) => `<span class="pg-legend-item"><span class="pg-legend-swatch" style="background:${c};"></span>${escapeHtml(k)}</span>`).join('')}</div>`;
}

/* -- Indicateurs de volume horaire --------------------------------------- */

function renderPlanningIndicators(stage) {
  const planning = planningForStage(stage.id);
  const totalMin = planning.reduce((s, p) => s + (Number(p.Duree) || 0), 0);
  const byInterv = {};
  planning.forEach((p) => {
    if (!p.Intervenant) return;
    byInterv[p.Intervenant] = (byInterv[p.Intervenant] || 0) + (Number(p.Duree) || 0);
  });
  const rows = Object.entries(byInterv).map(([id, min]) => {
    const interv = byId('Intervenants_du_stage', Number(id));
    return { nom: interv ? interv.Nom : '—', type: interv ? interv.Type : '', min };
  }).sort((a, b) => b.min - a.min);
  const externeMin = rows.filter((r) => r.type === 'Intervenant').reduce((s, r) => s + r.min, 0);
  const pctExterne = totalMin ? Math.round((100 * externeMin) / totalMin) : null;
  const assigneMin = rows.reduce((s, r) => s + r.min, 0);
  const nonAssigneMin = totalMin - assigneMin;

  const rowsHtml = rows.length ? rows.map((r) => `<tr><td>${escapeHtml(r.nom)}</td><td>${escapeHtml(r.type || '')}</td><td>${(r.min / 60).toFixed(1)} h</td></tr>`).join('') : '<tr><td colspan="3" class="empty-state">Aucun créneau assigné à un formateur/intervenant.</td></tr>';

  return `
    <div class="grid-3" style="margin-bottom:12px;">
      <div class="stat-tile"><span class="stat-value">${(totalMin / 60).toFixed(1)} h</span><span class="stat-label">Volume horaire total</span></div>
      <div class="stat-tile"><span class="stat-value">${pctExterne !== null ? pctExterne + ' %' : '—'}</span><span class="stat-label">Part assurée par des intervenants externes</span></div>
      <div class="stat-tile"><span class="stat-value">${(nonAssigneMin / 60).toFixed(1)} h</span><span class="stat-label">Volume non assigné</span></div>
    </div>
    <table class="data-table"><thead><tr><th>Formateur / intervenant</th><th>Type</th><th>Volume horaire</th></tr></thead><tbody>${rowsHtml}</tbody></table>
  `;
}

/* -- Conformité du planning aux modules obligatoires --------------------- */
// Comparaison par titre normalisé (le planning ne référence pas directement un id de module,
// son Titre est recopié depuis la bibliothèque au moment du dépôt) — c'est donc la correspondance
// la plus robuste disponible sans changer le schéma de Planning_du_stage.

function renderConformitePlanning(stage) {
  const modules = modulesForNiveau(stage.Niveau_du_stage);
  const obligatoires = modules.filter((m) => m.Type === 'Obligatoire');
  if (!obligatoires.length) return '<p class="empty-state">Aucun module obligatoire défini pour ce niveau dans la bibliothèque (Modules_de_formation).</p>';
  const planningTitres = new Set(planningForStage(stage.id).map((p) => normalize(p.Titre)));
  const rows = obligatoires.slice().sort((a, b) => (a.Ordre || 0) - (b.Ordre || 0)).map((m) => {
    const present = planningTitres.has(normalize(m.Titre));
    return { titre: m.Titre, present };
  });
  const manquants = rows.filter((r) => !r.present);
  const badge = manquants.length ? `<span class="badge badge-nonretenu">⚠️ ${manquants.length} module(s) obligatoire(s) manquant(s)</span>` : `<span class="badge badge-forme">✅ Tous les modules obligatoires sont planifiés</span>`;
  const rowsHtml = rows.map((r) => `<tr><td>${r.present ? '✅' : '⛔'}</td><td>${escapeHtml(r.titre)}</td></tr>`).join('');
  return `
    <p class="section-sub">${badge}</p>
    <table class="data-table"><thead><tr><th></th><th>Module obligatoire</th></tr></thead><tbody>${rowsHtml}</tbody></table>
  `;
}

function openPlanningBlockModal(planningId, stage) {
  const p = byId('Planning_du_stage', planningId);
  if (!p) return;
  const intervenants = intervenantsForStage(stage.id);
  const intervOptions = intervenants.map((i) => `<option value="${i.id}" ${p.Intervenant === i.id ? 'selected' : ''}>${escapeHtml(i.Nom)} (${escapeHtml(i.Type || '')})</option>`).join('');
  const currentInterv = byId('Intervenants_du_stage', p.Intervenant);
  const currentColor = currentInterv ? colorForIntervenant(currentInterv.id, currentInterv.Nom) : '#0063cb';
  const groupOptions = groupsForStage(stage).map((g) => `<option value="${escapeHtml(g)}" ${p.Sous_groupe === g ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('');
  const modal = openModal(`
    <h2>Modifier le créneau</h2>
    <div class="field"><label for="pbTitre">Titre</label><input type="text" id="pbTitre" value="${escapeHtml(p.Titre || '')}"></div>
    <div class="grid-2">
      <div class="field"><label for="pbHeure">Heure de début</label><input type="time" id="pbHeure" min="08:00" max="19:30" step="1800" value="${escapeHtml(p.Heure_de_debut || '')}"></div>
      <div class="field"><label for="pbDuree">Durée (min)</label><input type="number" id="pbDuree" min="30" step="30" value="${escapeHtml(p.Duree || 30)}"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="pbIntervenant">Formateur / intervenant</label><select id="pbIntervenant"><option value="">— Non assigné —</option>${intervOptions}</select></div>
      <div class="field" id="pbColorField" ${p.Intervenant ? '' : 'hidden'}><label for="pbColor">Couleur de cet intervenant</label><input type="color" id="pbColor" value="${currentColor}"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="pbModalite">Modalité</label><input type="text" id="pbModalite" value="${escapeHtml(p.Modalite || '')}" placeholder="Présentiel, distanciel…"></div>
      <div class="field"><label for="pbSousGroupe">Sous-groupe</label><select id="pbSousGroupe"><option value="">— Aucun —</option>${groupOptions}</select>${sousGroupeColonneManquanteHtml()}</div>
    </div>
    <p class="field-help">La couleur est associée à l'intervenant (pas au créneau) : la changer ici met à jour tous ses créneaux sur ce planning. Le sous-groupe ne peut lui non plus être engagé que sur un seul créneau à la fois (ex. ateliers tournants) : un chevauchement est refusé comme pour un formateur.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-danger" id="pbDelete">Supprimer</button>
      <button type="button" class="btn btn-secondary" id="pbCancel">Annuler</button>
      <button type="button" class="btn btn-primary" id="pbSave">Enregistrer</button>
    </div>
  `);
  modal.querySelector('#pbCancel').addEventListener('click', closeModal);
  modal.querySelector('#pbIntervenant').addEventListener('change', (e) => {
    const id = Number(e.target.value || 0) || null;
    const field = modal.querySelector('#pbColorField');
    const interv = id ? byId('Intervenants_du_stage', id) : null;
    if (interv) {
      field.hidden = false;
      modal.querySelector('#pbColor').value = colorForIntervenant(interv.id, interv.Nom);
    } else {
      field.hidden = true;
    }
  });
  modal.querySelector('#pbDelete').addEventListener('click', async () => {
    if (!window.confirm('Supprimer ce créneau ?')) return;
    try {
      await grist.docApi.applyUserActions([['RemoveRecord', physTable('Planning_du_stage'), planningId]]);
      await loadTable('Planning_du_stage');
      closeModal(); showFlash('Créneau supprimé.', 'ok'); render();
    } catch (err) { flashError('Erreur', err); }
  });
  modal.querySelector('#pbSave').addEventListener('click', async () => {
    const heure = modal.querySelector('#pbHeure').value;
    const duree = Number(modal.querySelector('#pbDuree').value || 0);
    const intervenantId = Number(modal.querySelector('#pbIntervenant').value || 0) || null;
    const sousGroupe = modal.querySelector('#pbSousGroupe').value;
    if (!heure || !duree) { showFlash('Heure et durée sont requises.', 'error'); return; }
    const conflict = planningConflict(stage, { excludeId: planningId, intervenantId, sousGroupe, dayEpoch: p.Jour, heure, duree });
    if (conflict) { showFlash(`Ce ${conflict} est déjà engagé sur un créneau qui chevauche celui-ci.`, 'error'); return; }
    try {
      if (intervenantId) {
        const chosenColor = modal.querySelector('#pbColor').value;
        await setIntervenantColor(intervenantId, chosenColor);
      }
      const champsPb = {
        Titre: modal.querySelector('#pbTitre').value.trim(), Heure_de_debut: heure, Duree: duree,
        Intervenant: intervenantId, Modalite: modal.querySelector('#pbModalite').value.trim(),
      };
      // Voir hasColumn() : Sous_groupe reste omis tant que la colonne n'existe pas sur le document
      // réel, plutôt que de faire échouer toute la sauvegarde du créneau avec un KeyError Grist.
      if (hasColumn('Planning_du_stage', 'Sous_groupe')) champsPb.Sous_groupe = sousGroupe;
      await updateRecord('Planning_du_stage', planningId, champsPb);
      closeModal(); showFlash('Créneau mis à jour.', 'ok'); render();
    } catch (err) { flashError('Erreur', err); }
  });
}

// Créer un créneau en cliquant directement sur une case vide du planning (jour/heure déjà
// déduits de l'endroit cliqué). Remplace l'ancien formulaire séparé "Ajouter un module à la
// bibliothèque" : le champ Titre propose en autocomplétion les modules complémentaires déjà
// connus pour ce niveau (les Obligatoires restent accessibles par glisser-déposer depuis la
// palette) ; un titre inédit est automatiquement ajouté à la bibliothèque comme nouveau module
// complémentaire réutilisable pour de futurs stages du même niveau.
function openPlanningCreateModal(stage, dayEpoch, heure) {
  const intervenants = intervenantsForStage(stage.id);
  const intervOptions = intervenants.map((i) => `<option value="${i.id}">${escapeHtml(i.Nom)} (${escapeHtml(i.Type || '')})</option>`).join('');
  const complementaires = modulesForNiveau(stage.Niveau_du_stage).filter((m) => m.Type !== 'Obligatoire');
  const datalistOptions = complementaires.map((m) => `<option value="${escapeHtml(m.Titre)}">`).join('');
  const dayLabel = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(dayEpoch * 1000));
  const modal = openModal(`
    <h2>Ajouter un créneau</h2>
    <p class="section-sub">${escapeHtml(dayLabel)}, ${escapeHtml(heure)}. Modifiable ci-dessous si besoin.</p>
    <div class="field">
      <label for="plcTitre">Titre</label>
      <input type="text" id="plcTitre" list="plcModulesList" placeholder="Nom du module…">
      <datalist id="plcModulesList">${datalistOptions}</datalist>
    </div>
    <div class="grid-2">
      <div class="field"><label for="plcHeure">Heure de début</label><input type="time" id="plcHeure" min="08:00" max="19:30" step="1800" value="${escapeHtml(heure)}"></div>
      <div class="field"><label for="plcDuree">Durée (min)</label><input type="number" id="plcDuree" min="30" step="30" value="30"></div>
    </div>
    <div class="grid-2">
      <div class="field"><label for="plcIntervenant">Formateur / intervenant</label><select id="plcIntervenant"><option value="">— Non assigné —</option>${intervOptions}</select></div>
      <div class="field"><label for="plcSousGroupe">Sous-groupe</label><select id="plcSousGroupe"><option value="">— Aucun —</option>${groupsForStage(stage).map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}</select>${sousGroupeColonneManquanteHtml()}</div>
    </div>
    <div class="field"><label for="plcModalite">Modalité</label><input type="text" id="plcModalite" placeholder="Présentiel, distanciel…"></div>
    <p class="field-help">${complementaires.length ? 'Tapez le titre d\'un module complémentaire existant pour reprendre sa durée, ou un nouveau titre pour l\'ajouter à la bibliothèque.' : 'Aucun module complémentaire connu pour ce niveau pour l\'instant — le titre saisi sera ajouté à la bibliothèque.'}</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="plcCancel">Annuler</button>
      <button type="button" class="btn btn-primary" id="plcSave">Créer le créneau</button>
    </div>
  `);
  modal.querySelector('#plcCancel').addEventListener('click', closeModal);
  modal.querySelector('#plcTitre').addEventListener('change', (e) => {
    const target = normalize(e.target.value.trim());
    const match = complementaires.find((m) => normalize(m.Titre) === target);
    if (match) modal.querySelector('#plcDuree').value = moduleDuration(match);
  });
  modal.querySelector('#plcSave').addEventListener('click', async () => {
    const titre = modal.querySelector('#plcTitre').value.trim();
    const heureSaisie = modal.querySelector('#plcHeure').value;
    const duree = Number(modal.querySelector('#plcDuree').value || 0);
    const intervenantId = Number(modal.querySelector('#plcIntervenant').value || 0) || null;
    const sousGroupe = modal.querySelector('#plcSousGroupe').value;
    const modalite = modal.querySelector('#plcModalite').value.trim();
    if (!titre || !heureSaisie || !duree) { showFlash('Titre, heure et durée sont requis.', 'error'); return; }
    const conflict = planningConflict(stage, { excludeId: null, intervenantId, sousGroupe, dayEpoch, heure: heureSaisie, duree });
    if (conflict) { showFlash(`Ce ${conflict} est déjà engagé sur un créneau qui chevauche celui-ci.`, 'error'); return; }
    try {
      const champsPlc = { Stage: stage.id, Jour: dayEpoch, Heure_de_debut: heureSaisie, Duree: duree, Titre: titre, Modalite: modalite, Intervenant: intervenantId };
      // Voir hasColumn() : Sous_groupe reste omis tant que la colonne n'existe pas sur le document réel.
      if (hasColumn('Planning_du_stage', 'Sous_groupe')) champsPlc.Sous_groupe = sousGroupe;
      await addRecord('Planning_du_stage', champsPlc);
      await ensureComplementaryModuleInLibrary(stage, titre, duree);
      closeModal(); showFlash('Créneau créé.', 'ok'); render();
    } catch (err) { flashError('Erreur', err); }
  });
}

/* -- Sous-groupes pédagogiques ------------------------------------------ */
// Les sous-groupes sont des étiquettes libres, créées indépendamment de toute affectation,
// et stockées dans une option de widget (sousGroupesParStage: { [stageId]: [nom, ...] }) plutôt
// que dans une table Grist — pas de nouvelle table à risquer côté .grist pour un simple registre
// de noms. L'affectation elle-même (Sous_groupe sur Intervenants_du_stage / Candidats_du_stage)
// se fait par glisser-déposer une fois le groupe créé.

function groupsForStage(stage) {
  return state.options.sousGroupesParStage[stage.id] || [];
}

async function createSousGroupe(stage, name) {
  const map = { ...state.options.sousGroupesParStage };
  const list = map[stage.id] || [];
  if (list.includes(name)) { showFlash('Ce sous-groupe existe déjà.', 'error'); return; }
  map[stage.id] = [...list, name];
  state.options.sousGroupesParStage = map;
  await grist.setOption('sousGroupesParStage', map);
  showFlash('Sous-groupe « ' + name + ' » créé — affectez des formateurs/stagiaires par glisser-déposer.', 'ok');
  render();
}

async function deleteSousGroupe(stage, name) {
  const map = { ...state.options.sousGroupesParStage };
  map[stage.id] = (map[stage.id] || []).filter((g) => g !== name);
  state.options.sousGroupesParStage = map;
  await grist.setOption('sousGroupesParStage', map);
  const actions = [];
  intervenantsForStage(stage.id).filter((i) => i.Sous_groupe === name).forEach((i) => actions.push(['UpdateRecord', physTable('Intervenants_du_stage'), i.id, { Sous_groupe: '' }]));
  candidatesForStage(stage.id).filter((c) => c.Sous_groupe === name).forEach((c) => actions.push(['UpdateRecord', physTable('Candidats_du_stage'), c.id, { Sous_groupe: '' }]));
  try {
    if (actions.length) { await grist.docApi.applyUserActions(actions); await loadTable('Intervenants_du_stage'); await loadTable('Candidats_du_stage'); }
    showFlash('Sous-groupe supprimé, membres désaffectés.', 'ok');
  } catch (err) { flashError('Erreur', err); }
  render();
}

// Fenêtre contextuelle d'ajout de stagiaires à un sous-groupe, ouverte au clic sur le bouton
// "+ Stagiaires" du groupe — deux façons d'ajouter, au choix : cocher dans un tableau des
// stagiaires validés non encore affectés à ce groupe, ou taper un nom avec autocomplétion
// (datalist) puis valider (Entrée ou bouton), qui affecte le premier stagiaire correspondant.
function openSousGroupeModal(stage, groupName) {
  const valides = candidatesForStage(stage.id).filter((c) => c.Statut === 'Stagiaire' || c.Statut === 'Formé');
  const inGroup = valides.filter((c) => c.Sous_groupe === groupName).sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr'));
  const available = valides.filter((c) => c.Sous_groupe !== groupName).sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr'));

  const fonctionOf = (c) => [c.Grade_long, c.Discipline_d_exercice].filter(Boolean).join(' — ');
  const currentHtml = inGroup.length
    ? inGroup.map((c) => `<span class="sg-chip sg-chip-stagiaire" data-tt-nom="${escapeHtml(c.Nom + ' ' + c.Prenom)}" data-tt-academie="${escapeHtml(c.Academie_d_affectation || '')}" data-tt-fonction="${escapeHtml(fonctionOf(c))}">${escapeHtml(c.Nom)} ${escapeHtml(c.Prenom)} <button type="button" class="sgm-remove" data-cand-id="${c.id}" title="Retirer du sous-groupe">×</button></span>`).join('')
    : '<span class="empty-state">Aucun stagiaire pour l\'instant.</span>';

  const rowsHtml = available.length
    ? available.map((c) => `<tr><td><input type="checkbox" class="sgm-check" data-cand-id="${c.id}"></td><td>${escapeHtml(c.Nom)} ${escapeHtml(c.Prenom)}</td><td>${escapeHtml(c.Sous_groupe || '—')}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-state">Tous les stagiaires validés sont déjà dans ce sous-groupe.</td></tr>';

  const datalistOptions = available.map((c) => `<option value="${escapeHtml(c.Nom + ' ' + c.Prenom)}">`).join('');

  const modal = openModal(`
    <h2>Sous-groupe « ${escapeHtml(groupName)} »</h2>
    <p class="section-sub">Membres actuels :</p>
    <div class="sg-board" style="margin-bottom:14px;">${currentHtml}</div>

    <p class="section-sub">Ajouter par nom (autocomplétion) :</p>
    <div class="grid-2">
      <div class="field"><label for="sgmName">Nom du stagiaire</label><input type="text" id="sgmName" list="sgmNames" placeholder="Tapez un nom…" data-enter-submit="sgmAddByName"></div>
      <div class="field" style="justify-content:flex-end;"><button type="button" class="btn btn-secondary" id="sgmAddByName">Ajouter</button></div>
    </div>
    <datalist id="sgmNames">${datalistOptions}</datalist>

    <p class="section-sub" style="margin-top:14px;">Ou cocher dans la liste :</p>
    <div class="table-scroll"><table class="data-table"><thead><tr><th></th><th>Stagiaire</th><th>Sous-groupe actuel</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>

    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="sgmCancel">Fermer</button>
      <button type="button" class="btn btn-primary" id="sgmApply">Ajouter la sélection</button>
    </div>
  `);

  bindStagiaireTooltips(modal);
  ensureStagiaireTooltipDocListener();

  modal.querySelector('#sgmCancel').addEventListener('click', closeModal);

  modal.querySelectorAll('.sgm-remove').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      await updateRecord('Candidats_du_stage', Number(btn.getAttribute('data-cand-id')), { Sous_groupe: '' });
      closeModal(); render(); openSousGroupeModal(stage, groupName);
    } catch (err) { flashError('Erreur', err); }
  }));

  modal.querySelector('#sgmApply').addEventListener('click', async () => {
    const ids = Array.from(modal.querySelectorAll('.sgm-check:checked')).map((el) => Number(el.getAttribute('data-cand-id')));
    if (!ids.length) { showFlash('Sélectionnez au moins un stagiaire.', 'error'); return; }
    try {
      await grist.docApi.applyUserActions(ids.map((id) => ['UpdateRecord', physTable('Candidats_du_stage'), id, { Sous_groupe: groupName }]));
      await loadTable('Candidats_du_stage');
      closeModal(); showFlash(ids.length + ' stagiaire(s) ajouté(s) au sous-groupe.', 'ok'); render();
    } catch (err) { flashError('Erreur', err); }
  });

  modal.querySelector('#sgmAddByName').addEventListener('click', async () => {
    const typed = modal.querySelector('#sgmName').value.trim();
    if (!typed) return;
    const target = normalize(typed);
    const match = available.find((c) => normalize(c.Nom + ' ' + c.Prenom) === target) || available.find((c) => normalize(c.Nom + ' ' + c.Prenom).includes(target));
    if (!match) { showFlash('Aucun stagiaire correspondant (vérifiez l\'orthographe, ou utilisez le tableau ci-dessous).', 'error'); return; }
    try {
      await updateRecord('Candidats_du_stage', match.id, { Sous_groupe: groupName });
      closeModal(); showFlash('Stagiaire ajouté.', 'ok'); render(); openSousGroupeModal(stage, groupName);
    } catch (err) { flashError('Erreur', err); }
  });
}

// Bulle d'information stagiaire (académie / fonction) — un seul élément DOM partagé entre toutes
// les étiquettes de sous-groupe (tableau de bord glisser-déposer et fenêtre contextuelle
// d'ajout), affiché au survol et/ou au clic/focus d'une étiquette « .sg-chip-stagiaire » pour
// aider la répartition sans avoir à rouvrir la fiche du candidat. Positionné en JS (position:
// fixed) plutôt qu'en CSS pur, pour rester lisible même près du bord de l'écran.
function stagiaireTooltipContent(el) {
  const nom = el.getAttribute('data-tt-nom') || '';
  const academie = el.getAttribute('data-tt-academie') || '';
  const fonction = el.getAttribute('data-tt-fonction') || '';
  return `<div class="sg-tooltip-name">${escapeHtml(nom)}</div>`
    + `<div class="sg-tooltip-row"><strong>Académie</strong> — ${academie ? escapeHtml(academie) : 'non renseignée'}</div>`
    + `<div class="sg-tooltip-row"><strong>Fonction</strong> — ${fonction ? escapeHtml(fonction) : 'non renseignée'}</div>`;
}

function getStagiaireTooltipEl() {
  let el = document.getElementById('sgTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sgTooltip';
    el.className = 'sg-tooltip';
    el.hidden = true;
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
  }
  return el;
}

function showStagiaireTooltip(chipEl) {
  const tt = getStagiaireTooltipEl();
  tt.innerHTML = stagiaireTooltipContent(chipEl);
  tt.hidden = false;
  const chipRect = chipEl.getBoundingClientRect();
  const ttRect = tt.getBoundingClientRect();
  let left = chipRect.left;
  let top = chipRect.bottom + 6;
  if (left + ttRect.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - ttRect.width - 8);
  if (top + ttRect.height > window.innerHeight - 8) top = Math.max(8, chipRect.top - ttRect.height - 6);
  tt.style.left = left + 'px';
  tt.style.top = top + 'px';
}

function hideStagiaireTooltip() {
  const tt = document.getElementById('sgTooltip');
  if (tt) { tt.hidden = true; state.sgTooltipPinned = null; }
}

// Câble le survol/clic/focus d'informations sur un lot d'étiquettes stagiaire déjà présentes
// dans le DOM (tableau de bord des sous-groupes, ou fenêtre contextuelle d'ajout) — appelé après
// chaque rendu concerné, jamais mémorisé d'un rendu à l'autre puisque les éléments sont recréés.
function bindStagiaireTooltips(root) {
  root.querySelectorAll('.sg-chip-stagiaire').forEach((el) => {
    el.setAttribute('tabindex', '0');
    el.addEventListener('mouseenter', () => showStagiaireTooltip(el));
    el.addEventListener('mouseleave', () => { if (state.sgTooltipPinned !== el) hideStagiaireTooltip(); });
    el.addEventListener('focus', () => showStagiaireTooltip(el));
    el.addEventListener('blur', () => { if (state.sgTooltipPinned !== el) hideStagiaireTooltip(); });
    el.addEventListener('click', (e) => {
      // Ne concurrence pas le glisser-déposer (dragstart) : un simple clic sans déplacement
      // n'en déclenche pas. Clic = épingle la bulle ouverte (utile tactile/sans survol) ; un
      // second clic sur la même étiquette, ou ailleurs (voir écouteur document plus bas), la
      // referme. Un clic sur le bouton « retirer » (×) de la fenêtre contextuelle ne doit
      // épingler/dépingler aucune bulle — laisser son propre gestionnaire agir seul.
      if (e.target.closest('.sgm-remove')) return;
      e.stopPropagation();
      if (state.sgTooltipPinned === el) { hideStagiaireTooltip(); return; }
      state.sgTooltipPinned = el;
      showStagiaireTooltip(el);
    });
  });
}

// Un seul écouteur global, posé une fois (garde via state.sgTooltipDocBound), pour refermer une
// bulle épinglée par clic dès qu'on clique en dehors d'une étiquette ou de la bulle elle-même.
function ensureStagiaireTooltipDocListener() {
  if (state.sgTooltipDocBound) return;
  state.sgTooltipDocBound = true;
  document.addEventListener('click', (e) => {
    if (!state.sgTooltipPinned) return;
    if (e.target.closest && (e.target.closest('.sg-chip-stagiaire') || e.target.closest('#sgTooltip'))) return;
    hideStagiaireTooltip();
  });
}

function renderSousGroupes(stage) {
  const formateurs = intervenantsForStage(stage.id).filter((i) => i.Type === 'Formateur');
  const valides = candidatesForStage(stage.id).filter((c) => c.Statut === 'Stagiaire' || c.Statut === 'Formé');
  const groups = groupsForStage(stage);

  const chipFormateur = (f) => `<span class="sg-chip" draggable="true" data-kind="formateur" data-id="${f.id}">${escapeHtml(f.Nom)}</span>`;
  const stagiaireFonction = (c) => [c.Grade_long, c.Discipline_d_exercice].filter(Boolean).join(' — ');
  const chipStagiaire = (c) => `<span class="sg-chip sg-chip-stagiaire" draggable="true" data-kind="stagiaire" data-id="${c.id}" data-tt-nom="${escapeHtml(c.Nom + ' ' + c.Prenom)}" data-tt-academie="${escapeHtml(c.Academie_d_affectation || '')}" data-tt-fonction="${escapeHtml(stagiaireFonction(c))}">${escapeHtml(c.Nom)} ${escapeHtml(c.Prenom)}</span>`;

  const groupCard = (g, isPool) => {
    const fmts = isPool ? formateurs.filter((f) => !f.Sous_groupe || !groups.includes(f.Sous_groupe)) : formateurs.filter((f) => f.Sous_groupe === g);
    const membres = isPool ? valides.filter((c) => !c.Sous_groupe || !groups.includes(c.Sous_groupe)) : valides.filter((c) => c.Sous_groupe === g);
    return `
      <div class="sg-group${isPool ? ' sg-pool' : ''}">
        <div class="sg-group-head">
          <h4>${isPool ? 'Non affectés' : escapeHtml(g)}</h4>
          ${isPool ? '' : `<div class="row-inline" style="gap:6px;">
            <button type="button" class="btn btn-small btn-secondary sg-add-stagiaires" data-group="${escapeHtml(g)}">+ Stagiaires</button>
            <button type="button" class="btn btn-small btn-danger sg-delete" data-group="${escapeHtml(g)}">Supprimer</button>
          </div>`}
        </div>
        <p class="sg-sub">Formateurs</p>
        <div class="sg-dropzone" data-group="${isPool ? '' : escapeHtml(g)}" data-kind="formateur">${fmts.length ? fmts.map(chipFormateur).join('') : '<span class="empty-state">—</span>'}</div>
        <p class="sg-sub">Stagiaires</p>
        <div class="sg-dropzone" data-group="${isPool ? '' : escapeHtml(g)}" data-kind="stagiaire">${membres.length ? membres.map(chipStagiaire).join('') : '<span class="empty-state">—</span>'}</div>
      </div>`;
  };

  const groupsHtml = groups.map((g) => groupCard(g, false)).join('') + groupCard(null, true);

  return `
    <div class="card">
      <h3>Créer un sous-groupe</h3>
      <p class="section-sub">Donnez un nom au sous-groupe, puis affectez formateurs et stagiaires par glisser-déposer ci-dessous — indépendamment l'un de l'autre.</p>
      <div class="grid-2">
        <div class="field"><label for="sgName">Nom du sous-groupe</label><input type="text" id="sgName" placeholder="Groupe A"></div>
        <div class="field" style="justify-content:flex-end;"><button type="button" class="btn btn-primary" id="sgCreate">Créer le sous-groupe</button></div>
      </div>
    </div>
    <div class="sg-board">${groupsHtml}</div>
  `;
}

function bindSousGroupes(stage) {
  // Un re-rendu de l'onglet (ex. juste après un dépôt glisser-déposer) reconstruit tout le DOM
  // du tableau de bord des sous-groupes : toute bulle d'info encore affichée pointerait alors
  // vers une étiquette qui n'existe plus. On la referme systématiquement ici, avant de recâbler
  // les nouvelles étiquettes.
  hideStagiaireTooltip();
  ensureStagiaireTooltipDocListener();
  document.getElementById('sgCreate').addEventListener('click', () => {
    const input = document.getElementById('sgName');
    const name = input.value.trim();
    if (!name) { showFlash('Le nom du sous-groupe est requis.', 'error'); return; }
    createSousGroupe(stage, name);
  });
  document.querySelectorAll('.sg-delete').forEach((el) => el.addEventListener('click', () => {
    const g = el.getAttribute('data-group');
    if (window.confirm(`Supprimer le sous-groupe « ${g} » ? Les formateurs et stagiaires affectés seront désaffectés.`)) deleteSousGroupe(stage, g);
  }));
  document.querySelectorAll('.sg-add-stagiaires').forEach((el) => el.addEventListener('click', () => {
    openSousGroupeModal(stage, el.getAttribute('data-group'));
  }));
  bindStagiaireTooltips(document);
  document.querySelectorAll('.sg-chip').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: el.getAttribute('data-kind'), id: el.getAttribute('data-id') }));
      e.dataTransfer.effectAllowed = 'move';
    });
  });
  document.querySelectorAll('.sg-dropzone').forEach((el) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      let data;
      try { data = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
      const zoneKind = el.getAttribute('data-kind');
      if (data.kind !== zoneKind) { showFlash('Un formateur ne peut être déposé que dans une zone Formateurs (et de même pour les stagiaires).', 'error'); return; }
      const groupName = el.getAttribute('data-group') || '';
      try {
        if (data.kind === 'formateur') await updateRecord('Intervenants_du_stage', Number(data.id), { Sous_groupe: groupName });
        else await updateRecord('Candidats_du_stage', Number(data.id), { Sous_groupe: groupName });
        render();
      } catch (err) { flashError('Erreur', err); }
    });
  });
}

// Suppression d'un formateur/intervenant (fonctionnalité manquante, ajoutée à la demande de
// l'utilisateur). Les créneaux de planning qui lui étaient assignés ne sont pas supprimés — ils
// sont désaffectés (Intervenant remis à vide) plutôt que laissés avec une référence à une ligne
// qui n'existe plus, même si `byId()` gère déjà silencieusement ce cas ailleurs dans ce fichier
// (mieux vaut ne jamais compter dessus qu'en avoir besoin). Un seul appel `applyUserActions`,
// mélangeant UpdateRecord (désaffectation) et RemoveRecord (suppression), sur le même principe que
// deleteSousGroupe() plus bas (déjà un mélange de tables dans un seul appel).
async function deleteIntervenant(stage, intervId) {
  const creneauxAffectes = planningForStage(stage.id).filter((p) => p.Intervenant === intervId);
  const actions = creneauxAffectes.map((p) => ['UpdateRecord', physTable('Planning_du_stage'), p.id, { Intervenant: null }]);
  actions.push(['RemoveRecord', physTable('Intervenants_du_stage'), intervId]);
  try {
    await grist.docApi.applyUserActions(actions);
    await loadTable('Planning_du_stage');
    await loadTable('Intervenants_du_stage');
    showFlash(creneauxAffectes.length
      ? `Supprimé — ${creneauxAffectes.length} créneau(x) désaffecté(s), pas supprimé(s).`
      : 'Supprimé.', 'ok');
  } catch (err) { flashError('Erreur', err); }
  render();
}

/* -- Rendu de l'onglet --------------------------------------------------- */

function renderIngenierie(stage) {
  const intervenants = intervenantsForStage(stage.id);
  const formateurs = intervenants.filter((i) => i.Type === 'Formateur');
  const externes = intervenants.filter((i) => i.Type === 'Intervenant');
  const planning = planningForStage(stage.id);
  const volumeMinutes = planning.reduce((sum, p) => sum + (Number(p.Duree) || 0), 0);

  // Bouton de suppression (demande explicite de l'utilisateur — cette fonctionnalité n'existait pas
  // du tout jusqu'ici : un formateur/intervenant ajouté par erreur ne pouvait pas être retiré). Voir
  // deleteIntervenant() : les créneaux de planning qui lui sont assignés sont désaffectés plutôt que
  // supprimés, jamais laissés avec une référence à une ligne qui n'existe plus.
  const formateurRows = formateurs.length ? formateurs.map((f) => `<li><span>${escapeHtml(f.Nom)}${f.Sous_groupe ? ' — sous-groupe ' + escapeHtml(f.Sous_groupe) : ''}</span><span class="row-inline" style="gap:10px;"><span class="muted">${escapeHtml(f.Role_specialite || '')}</span><button type="button" class="btn btn-small btn-danger iv-delete" data-interv-id="${f.id}">Supprimer</button></span></li>`).join('') : '<li class="empty-state">Aucun formateur.</li>';
  const externeRows = externes.length ? externes.map((i) => `<li><span>${escapeHtml(i.Nom)}${i.Organisme ? ' — ' + escapeHtml(i.Organisme) : ''}</span><span class="row-inline" style="gap:10px;"><label class="row-inline" style="font-size:12px;"><input type="checkbox" class="interv-confirme" data-interv-id="${i.id}" ${i.Confirme ? 'checked' : ''}> Confirmé</label><button type="button" class="btn btn-small btn-danger iv-delete" data-interv-id="${i.id}">Supprimer</button></span></li>`).join('') : '<li class="empty-state">Aucun intervenant.</li>';

  return `
    <div class="grid-2">
      <div class="card"><h3>Formateurs (récurrents, internes)</h3><ul class="list-plain">${formateurRows}</ul></div>
      <div class="card"><h3>Intervenants (ponctuels, externes)</h3><ul class="list-plain">${externeRows}</ul></div>
    </div>
    <div class="card">
      <h3>Ajouter un formateur ou un intervenant</h3>
      <div class="grid-4">
        <div class="field"><label for="ivNom">Nom</label><input type="text" id="ivNom"></div>
        <div class="field"><label for="ivType">Type</label><select id="ivType"><option value="Formateur">Formateur</option><option value="Intervenant">Intervenant</option></select></div>
        <div class="field"><label for="ivRole">Rôle / spécialité</label><input type="text" id="ivRole"></div>
        <div class="field"><label for="ivOrganisme">Organisme (intervenant externe)</label><input type="text" id="ivOrganisme"></div>
      </div>
      <div class="field"><label for="ivContact">Contact</label><input type="text" id="ivContact"></div>
      <div class="actions-bar"><button type="button" class="btn btn-primary" id="ivAdd">Ajouter</button></div>
    </div>

    <h3 class="section-title" style="font-size:16px;">Sous-groupes pédagogiques</h3>
    ${renderSousGroupes(stage)}

    <h3 class="section-title" style="font-size:16px; margin-top:22px;">Planning</h3>
    <div class="card">
      <p class="section-sub">Volume horaire total : ${(volumeMinutes / 60).toFixed(1)} h — jours limités à l'intervalle du stage (${fmtDateFr(stage.Date_de_debut_de_session)} → ${fmtDateFr(stage.Date_de_fin_de_session)}), créneaux 08h00–20h00 par pas de 30 min. Glissez un module obligatoire sur la grille, ou cliquez une case vide pour créer un créneau (module complémentaire compris, avec autocomplétion). Cliquez un créneau déjà placé pour l'assigner à un formateur/intervenant, le modifier ou le supprimer, ou tirez la petite poignée en bas du bloc pour l'étendre/réduire par pas de 30 min — au clavier, atteignez-le par tabulation, déplacez-le avec les flèches (jour à gauche/droite, horaire en haut/bas), redimensionnez-le avec Maj+flèches, et ouvrez-le avec Entrée. Un chevauchement est toujours refusé pour une même ressource (formateur/intervenant ou sous-groupe), à la souris comme au clavier.</p>
      <div class="row-inline-radio">
        <span class="muted">Code couleur des créneaux :</span>
        <label><input type="radio" name="plColorBy" value="intervenant" ${state.planningColorBy === 'intervenant' ? 'checked' : ''}> par formateur / intervenant</label>
        <label><input type="radio" name="plColorBy" value="modalite" ${state.planningColorBy === 'modalite' ? 'checked' : ''}> par modalité</label>
        <label><input type="radio" name="plColorBy" value="sous_groupe" ${state.planningColorBy === 'sous_groupe' ? 'checked' : ''}> par sous-groupe</label>
      </div>
      ${renderPlanningGrid(stage)}${renderPlanningLegend(stage)}
      <div class="pg-palette-col" style="margin-top:14px;">
        <p class="pg-palette-group" style="margin-top:0;">Modules obligatoires (${escapeHtml(stageNiveauRow(stage) ? stageNiveauRow(stage).Niveau_du_stage : '—')}) — glissez-les sur le planning</p>
        <div class="pg-palette pg-palette-row">${renderModulePalette(stage)}</div>
      </div>
    </div>

    <div class="card">
      <h3>Indicateurs de volume horaire</h3>
      ${renderPlanningIndicators(stage)}
    </div>

    <div class="card">
      <h3>Conformité aux modules obligatoires</h3>
      ${renderConformitePlanning(stage)}
    </div>

    <div class="card">
      <h3>Ajouter un créneau sans glisser-déposer (accessible au clavier)</h3>
      <p class="field-help">Pour créer un nouveau créneau au clavier, utilisez ce formulaire. Un créneau déjà placé sur la grille se déplace directement au clavier (voir plus haut).</p>
      <div class="grid-4">
        <div class="field"><label for="plJour">Jour</label><input type="date" id="plJour" min="${fromEpochToDateInput(stage.Date_de_debut_de_session)}" max="${fromEpochToDateInput(stage.Date_de_fin_de_session)}"></div>
        <div class="field"><label for="plHeure">Heure de début</label><input type="time" id="plHeure" min="08:00" max="19:30" step="1800"></div>
        <div class="field"><label for="plDuree">Durée (min)</label><input type="number" id="plDuree" min="30" step="30" value="60"></div>
        <div class="field"><label for="plIntervenant">Formateur / intervenant</label><select id="plIntervenant"><option value="">—</option>${intervenants.map((i) => `<option value="${i.id}">${escapeHtml(i.Nom)} (${escapeHtml(i.Type || '')})</option>`).join('')}</select></div>
      </div>
      <div class="grid-3">
        <div class="field"><label for="plTitre">Titre du module</label><input type="text" id="plTitre"></div>
        <div class="field"><label for="plModalite">Modalité</label><input type="text" id="plModalite" placeholder="Présentiel, distanciel…"></div>
        <div class="field"><label for="plSousGroupe">Sous-groupe</label><select id="plSousGroupe"><option value="">— Aucun —</option>${groupsForStage(stage).map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}</select>${sousGroupeColonneManquanteHtml()}</div>
      </div>
      <div class="actions-bar"><button type="button" class="btn btn-primary" id="plAdd">Placer sur le planning</button></div>
    </div>
  `;
}

function bindIngenierie(stage) {
  document.querySelectorAll('input[name="plColorBy"]').forEach((el) => el.addEventListener('change', (e) => {
    if (e.target.checked) { state.planningColorBy = e.target.value; render(); }
  }));

  document.querySelectorAll('.interv-confirme').forEach((el) => el.addEventListener('change', async (e) => {
    try { await updateRecord('Intervenants_du_stage', Number(e.target.getAttribute('data-interv-id')), { Confirme: e.target.checked }); }
    catch (err) { flashError('Erreur', err); }
  }));

  document.querySelectorAll('.iv-delete').forEach((el) => el.addEventListener('click', () => {
    const id = Number(el.getAttribute('data-interv-id'));
    const interv = byId('Intervenants_du_stage', id);
    const nom = interv ? interv.Nom : 'cette personne';
    const nbCreneaux = planningForStage(stage.id).filter((p) => p.Intervenant === id).length;
    const avertissement = nbCreneaux
      ? ` ${nbCreneaux} créneau(x) de planning lui sont actuellement assignés — ils resteront sur le planning, simplement désaffectés.`
      : '';
    if (!window.confirm(`Supprimer ${nom} ?${avertissement}`)) return;
    deleteIntervenant(stage, id);
  }));

  document.getElementById('ivAdd').addEventListener('click', async () => {
    const nom = document.getElementById('ivNom').value.trim();
    const type = document.getElementById('ivType').value;
    const role = document.getElementById('ivRole').value.trim();
    const organisme = document.getElementById('ivOrganisme').value.trim();
    const contact = document.getElementById('ivContact').value.trim();
    if (!nom) { showFlash('Le nom est requis.', 'error'); return; }
    const fields = { Stage: stage.id, Nom: nom, Type: type, Role_specialite: role, Contact: contact };
    if (type === 'Intervenant') fields.Organisme = organisme;
    try { await addRecord('Intervenants_du_stage', fields); showFlash('Ajouté.', 'ok'); render(); }
    catch (err) { flashError('Erreur', err); }
  });

  bindSousGroupes(stage);

  // Palette → grille (nouveau créneau), et créneau existant → grille (déplacement), glisser-déposer.
  let pgBlockDragging = false;
  // Idem pour le redimensionnement à la souris (voir plus bas) : contrairement au glisser-déposer
  // natif ci-dessus, qui supprime lui-même le `click` suivant, un redimensionnement par pointeur
  // est suivi d'un vrai `click` du navigateur au relâchement — et sa cible n'est pas forcément la
  // poignée elle-même (si le pointeur a fini sa course ailleurs sur le bloc, par exemple après
  // avoir buté sur la durée minimale de 30 min en réduisant), donc un simple stopPropagation posé
  // sur la seule poignée ne suffit pas à l'arrêter dans tous les cas. Même garde-fou que
  // `pgBlockDragging` : positionné au pointerdown, relâché après le `click` qui suit le
  // pointerup (via setTimeout(…, 0), pour laisser ce clic s'exécuter puis être ignoré).
  let pgBlockResizing = false;

  document.querySelectorAll('.pg-palette-item').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'new-module', moduleId: el.getAttribute('data-module-id') }));
      // 'all' plutôt que 'copy' : le créneau cible fixe un seul dropEffect ('move', réutilisé aussi
      // pour le déplacement de créneaux existants) — il doit rester compatible avec effectAllowed
      // ici, sans quoi certains navigateurs annulent silencieusement le drop.
      e.dataTransfer.effectAllowed = 'all';
    });
  });
  // Déplacement au clavier d'un créneau déjà placé (pendant du glisser-déposer souris ci-dessous) —
  // FR-008 : "placement par glisser-déposer à la souris ET au clavier". Chaque .pg-block est
  // atteignable par tabulation (tabindex="0" posé dans renderPlanningGrid) ; les flèches
  // haut/bas déplacent d'un pas de 30 min dans la même journée, gauche/droite changent de jour (à
  // heure égale), et Entrée/Espace ouvrent la même modale d'édition que le clic. `pgKeyMoveBusy`
  // évite d'empiler plusieurs déplacements si une touche est maintenue enfoncée pendant qu'un
  // premier déplacement est encore en cours d'écriture côté Grist (même logique de garde que
  // `pgBlockDragging` ci-dessus pour le glisser-déposer). Après un déplacement réussi, le focus est
  // reposé sur le même créneau (par id) une fois le rendu terminé : sans ça, chaque flèche forcerait
  // à retabuler jusqu'au bloc, rendant l'ajustement fin injouable au clavier.
  let pgKeyMoveBusy = false;

  // Redimensionnement à la souris (extension explicitement demandée) : une poignée en bas de
  // chaque bloc (.pg-resize-handle) suit le pointeur verticalement pendant l'appui — aperçu visuel
  // en direct (simple changement de `height` CSS), aucune écriture Grist tant que le bouton n'est
  // pas relâché — puis un seul `updateRecord` au relâchement, avec le même contrôle de
  // chevauchement (formateur/intervenant OU sous-groupe) que le déplacement ci-dessus. Écouteurs
  // posés sur `document` (comme le glisser-déposer clavier/souris déjà en place) pour continuer à
  // recevoir les événements même si le pointeur quitte la poignée pendant le geste.
  let pgResizeCtx = null;
  function onResizePointerMove(e) {
    if (!pgResizeCtx) return;
    const { dayBodyRect, startSlot, maxSlots, el } = pgResizeCtx;
    const pointerSlot = Math.floor((e.clientY - dayBodyRect.top) / PLANNING_ROW_PX);
    const newSpan = Math.max(1, Math.min(maxSlots, pointerSlot - startSlot + 1));
    pgResizeCtx.previewSpan = newSpan;
    el.style.height = (newSpan * PLANNING_ROW_PX - 2) + 'px';
    el.classList.add('pg-resizing');
  }
  function onResizePointerUp() {
    document.removeEventListener('pointermove', onResizePointerMove);
    document.removeEventListener('pointerup', onResizePointerUp);
    // Laisse le `click` de fin de geste (émis par le navigateur juste après ce pointerup, quelle
    // que soit sa cible exacte sur le bloc) se produire et être ignoré par le garde-fou du click
    // handler ci-dessus, avant de relâcher le drapeau au tick suivant.
    setTimeout(() => { pgBlockResizing = false; }, 0);
    if (!pgResizeCtx) return;
    const { el, planningId, startSpan, previewSpan } = pgResizeCtx;
    pgResizeCtx = null;
    el.classList.remove('pg-resizing');
    if (previewSpan === startSpan) return; // relâché sans déplacement réel : rien à écrire
    (async () => {
      const p = byId('Planning_du_stage', planningId);
      if (!p) return;
      const newDuree = previewSpan * PLANNING_SLOT_MINUTES;
      const conflict = planningConflict(stage, { excludeId: planningId, intervenantId: p.Intervenant, sousGroupe: p.Sous_groupe, dayEpoch: p.Jour, heure: p.Heure_de_debut, duree: newDuree });
      // Chevauchement détecté : on ne garde jamais l'aperçu visuel non enregistré — un rendu
      // complet remet la hauteur du bloc à sa vraie valeur (celle encore en base).
      if (conflict) { showFlash(`Redimensionnement refusé : ce ${conflict} est déjà engagé sur un créneau qui chevaucherait celui-ci.`, 'error'); render(); return; }
      try {
        await updateRecord('Planning_du_stage', planningId, { Duree: newDuree });
        showFlash('Créneau redimensionné.', 'ok');
        render();
      } catch (err) { flashError('Erreur', err); render(); }
    })();
  }

  document.querySelectorAll('.pg-block').forEach((el) => {
    el.addEventListener('dragstart', (e) => {
      pgBlockDragging = true;
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'move-block', planningId: el.getAttribute('data-planning-id') }));
      e.dataTransfer.effectAllowed = 'all';
      e.stopPropagation();
      setTimeout(() => el.classList.add('pg-dragging'), 0);
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('pg-dragging');
      setTimeout(() => { pgBlockDragging = false; }, 0);
    });
    el.addEventListener('click', () => {
      if (pgBlockDragging || pgBlockResizing) return;
      openPlanningBlockModal(Number(el.getAttribute('data-planning-id')), stage);
    });
    el.addEventListener('keydown', async (e) => {
      const planningId = Number(el.getAttribute('data-planning-id'));
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPlanningBlockModal(planningId, stage);
        return;
      }
      // Maj+flèches : redimensionne (pendant clavier de la poignée souris ci-dessous) plutôt que de
      // déplacer — Haut réduit d'un pas de 30 min, Bas étend d'un pas de 30 min, toujours borné à
      // une durée minimale de 30 min et à ne jamais dépasser 20h00 le même jour.
      if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (pgKeyMoveBusy) return;
        const p = byId('Planning_du_stage', planningId);
        if (!p) return;
        const startSlot = slotIndexFromTime(p.Heure_de_debut);
        const newSpan = spanFromDuration(p.Duree) + (e.key === 'ArrowUp' ? -1 : 1);
        if (newSpan < 1 || startSlot + newSpan > PLANNING_SLOT_COUNT) return; // mini 30 min, jamais après 20h00
        const newDuree = newSpan * PLANNING_SLOT_MINUTES;
        const conflict = planningConflict(stage, { excludeId: planningId, intervenantId: p.Intervenant, sousGroupe: p.Sous_groupe, dayEpoch: p.Jour, heure: p.Heure_de_debut, duree: newDuree });
        if (conflict) { showFlash(`Redimensionnement refusé : ce ${conflict} est déjà engagé sur un créneau qui chevaucherait celui-ci.`, 'error'); return; }
        pgKeyMoveBusy = true;
        try {
          await updateRecord('Planning_du_stage', planningId, { Duree: newDuree });
          render();
          const resized = document.querySelector(`.pg-block[data-planning-id="${planningId}"]`);
          if (resized) resized.focus();
        } catch (err) { flashError('Erreur', err); }
        finally { pgKeyMoveBusy = false; }
        return;
      }
      const slotDelta = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      const dayDelta = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (slotDelta === undefined && dayDelta === undefined) return;
      e.preventDefault();
      if (pgKeyMoveBusy) return;
      const p = byId('Planning_du_stage', planningId);
      if (!p) return;
      let dayEpoch = p.Jour;
      let heure = p.Heure_de_debut;
      if (dayDelta !== undefined) {
        const days = computeStageDays(stage);
        const newIdx = days.indexOf(dayEpoch) + dayDelta;
        if (newIdx < 0 || newIdx >= days.length) return; // hors de l'intervalle du stage : on ne bouge pas
        dayEpoch = days[newIdx];
      } else {
        const newSlot = slotIndexFromTime(heure) + slotDelta;
        if (newSlot < 0 || newSlot > PLANNING_SLOT_COUNT - spanFromDuration(p.Duree)) return; // hors 08h00–20h00
        heure = timeFromSlotIndex(newSlot);
      }
      const conflict = planningConflict(stage, { excludeId: planningId, intervenantId: p.Intervenant, sousGroupe: p.Sous_groupe, dayEpoch, heure, duree: p.Duree });
      if (conflict) { showFlash(`Déplacement refusé : ce ${conflict} est déjà engagé sur un créneau qui chevaucherait celui-ci.`, 'error'); return; }
      pgKeyMoveBusy = true;
      try {
        await updateRecord('Planning_du_stage', planningId, { Jour: dayEpoch, Heure_de_debut: heure });
        render();
        const moved = document.querySelector(`.pg-block[data-planning-id="${planningId}"]`);
        if (moved) moved.focus();
      } catch (err) { flashError('Erreur', err); }
      finally { pgKeyMoveBusy = false; }
    });
    const resizeHandle = el.querySelector('.pg-resize-handle');
    if (resizeHandle) {
      // Défense en profondeur : si le `click` de fin de geste cible bien la poignée (le cas le
      // plus courant), il ne remonte même pas jusqu'à `.pg-block` — le garde-fou principal reste
      // `pgBlockResizing` ci-dessus, posé/relâché juste en dessous, car ce clic peut aussi cibler
      // un autre endroit du bloc si le pointeur a fini sa course ailleurs (ex. en butant sur la
      // durée minimale de 30 min en réduisant).
      resizeHandle.addEventListener('click', (e) => e.stopPropagation());
      resizeHandle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation(); // n'initie jamais le dragstart natif du bloc parent (voir renderPlanningGrid)
        const planningId = Number(el.getAttribute('data-planning-id'));
        const p = byId('Planning_du_stage', planningId);
        if (!p) return;
        const dayBodyEl = el.closest('.pg-day-body');
        if (!dayBodyEl) return;
        // Posé seulement une fois sûr d'aller au bout du geste (voir les deux `if` ci-dessus) :
        // les écouteurs pointermove/pointerup qui relâchent ce drapeau ne sont attachés que
        // maintenant — le poser plus tôt risquerait de le laisser bloqué à `true` pour toujours
        // si l'une de ces sorties anticipées était empruntée.
        pgBlockResizing = true;
        const startSlot = slotIndexFromTime(p.Heure_de_debut);
        const startSpan = spanFromDuration(p.Duree);
        pgResizeCtx = {
          el, planningId, startSpan, previewSpan: startSpan, startSlot,
          maxSlots: PLANNING_SLOT_COUNT - startSlot,
          dayBodyRect: dayBodyEl.getBoundingClientRect(),
        };
        document.addEventListener('pointermove', onResizePointerMove);
        document.addEventListener('pointerup', onResizePointerUp);
      });
    }
  });
  // Délégation au niveau de la colonne (.pg-day-body) plutôt que sur chaque .pg-slot-row :
  // les blocs (.pg-block) sont en position:absolute et recouvrent visuellement les créneaux
  // déjà occupés, ce qui empêchait tout drop (et Playwright de cibler l'élément) sur un
  // créneau non vide. Comme les événements drag remontent (bubbling), on les capte sur le
  // conteneur du jour et on calcule le créneau ciblé à partir de la position verticale du
  // curseur, indépendamment de l'élément DOM précisément survolé.
  function slotIndexFromPointer(dayBodyEl, clientY) {
    const rect = dayBodyEl.getBoundingClientRect();
    const idx = Math.floor((clientY - rect.top) / PLANNING_ROW_PX);
    return Math.max(0, Math.min(PLANNING_SLOT_COUNT - 1, idx));
  }
  function highlightSlot(dayBodyEl, slotIdx) {
    dayBodyEl.querySelectorAll('.pg-slot-row.drag-over').forEach((r) => r.classList.remove('drag-over'));
    const row = dayBodyEl.querySelector(`.pg-slot-row[data-slot="${slotIdx}"]`);
    if (row) row.classList.add('drag-over');
  }
  document.querySelectorAll('.pg-day-body').forEach((el) => {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      highlightSlot(el, slotIndexFromPointer(el, e.clientY));
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) el.querySelectorAll('.pg-slot-row.drag-over').forEach((r) => r.classList.remove('drag-over'));
    });
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      el.querySelectorAll('.pg-slot-row.drag-over').forEach((r) => r.classList.remove('drag-over'));
      let payload;
      try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
      const dayEpoch = Number(el.getAttribute('data-day'));
      const heure = timeFromSlotIndex(slotIndexFromPointer(el, e.clientY));

      if (payload.kind === 'new-module') {
        const mod = byId('Modules_de_formation', Number(payload.moduleId));
        if (!mod) return;
        const duree = moduleDuration(mod);
        try {
          await addRecord('Planning_du_stage', { Stage: stage.id, Jour: dayEpoch, Heure_de_debut: heure, Duree: duree, Titre: mod.Titre, Modalite: '', Intervenant: null });
          showFlash('Module placé — cliquez dessus pour l\'assigner à un formateur/intervenant.', 'ok');
          render();
        } catch (err) { flashError('Erreur', err); }
        return;
      }

      if (payload.kind === 'move-block') {
        const planningId = Number(payload.planningId);
        const p = byId('Planning_du_stage', planningId);
        if (!p) return;
        const conflict = planningConflict(stage, { excludeId: planningId, intervenantId: p.Intervenant, sousGroupe: p.Sous_groupe, dayEpoch, heure, duree: p.Duree });
        if (conflict) { showFlash(`Déplacement refusé : ce ${conflict} est déjà engagé sur un créneau qui chevaucherait celui-ci.`, 'error'); return; }
        try {
          await updateRecord('Planning_du_stage', planningId, { Jour: dayEpoch, Heure_de_debut: heure });
          showFlash('Créneau déplacé.', 'ok');
          render();
        } catch (err) { flashError('Erreur', err); }
      }
    });
    // Clic sur une case vide (pas sur un bloc déjà placé, qui a son propre gestionnaire de clic
    // pour ouvrir sa modale d'édition) : ouvre la création d'un créneau, jour/heure pré-remplis
    // d'après la position cliquée.
    el.addEventListener('click', (e) => {
      if (e.target.closest('.pg-block')) return;
      const dayEpoch = Number(el.getAttribute('data-day'));
      const heure = timeFromSlotIndex(slotIndexFromPointer(el, e.clientY));
      openPlanningCreateModal(stage, dayEpoch, heure);
    });
  });

  document.getElementById('plAdd').addEventListener('click', async () => {
    const jour = document.getElementById('plJour').value;
    const heure = document.getElementById('plHeure').value;
    const duree = Number(document.getElementById('plDuree').value || 0);
    const intervenantId = Number(document.getElementById('plIntervenant').value || 0) || null;
    const sousGroupe = document.getElementById('plSousGroupe').value;
    const titre = document.getElementById('plTitre').value.trim();
    const modalite = document.getElementById('plModalite').value.trim();
    if (!jour || !heure || !duree) { showFlash('Jour, heure et durée sont requis.', 'error'); return; }
    const jourEpoch = toEpoch(jour);
    const conflict = planningConflict(stage, { excludeId: null, intervenantId, sousGroupe, dayEpoch: jourEpoch, heure, duree });
    if (conflict) { showFlash(`Ce ${conflict} est déjà engagé sur un créneau qui chevauche celui-ci.`, 'error'); return; }
    try {
      const champsPl = { Stage: stage.id, Jour: jourEpoch, Heure_de_debut: heure, Duree: duree, Titre: titre, Modalite: modalite, Intervenant: intervenantId };
      // Voir hasColumn() : Sous_groupe reste omis tant que la colonne n'existe pas sur le document réel.
      if (hasColumn('Planning_du_stage', 'Sous_groupe')) champsPl.Sous_groupe = sousGroupe;
      await addRecord('Planning_du_stage', champsPl);
      showFlash('Créneau ajouté.', 'ok'); render();
    } catch (err) { flashError('Erreur', err); }
  });
}

/* ---------------------------------------------------------------------- */
/* Grille d'émargement — fonctions partagées, utilisées par l'onglet 4     */
/* (Émargement & formation, voir plus bas) et par espace-stagiaire.js       */
/* (lecture/écriture des lignes déjà créées ici, jamais de création côté   */
/* stagiaire — voir la note d'architecture dans espace-stagiaire.js).       */
/* ---------------------------------------------------------------------- */

function emargementForStage(stageId) { return T('Emargement_du_stage').filter((e) => e.Stage === stageId); }

function emargementRow(stageId, candidatId, jourEpoch, demi) {
  return T('Emargement_du_stage').find((e) => e.Stage === stageId && e.Candidat === candidatId && e.Jour === jourEpoch && e.Demi_journee === demi) || null;
}

async function toggleEmargement(stage, candidatId, jourEpoch, demi, present) {
  const existing = emargementRow(stage.id, candidatId, jourEpoch, demi);
  try {
    if (existing) await updateRecord('Emargement_du_stage', existing.id, { Present: present });
    else await addRecord('Emargement_du_stage', { Stage: stage.id, Candidat: candidatId, Jour: jourEpoch, Demi_journee: demi, Present: present });
  } catch (err) { flashError('Erreur émargement', err); }
}

// Taux de présence global du stage = part des demi-journées (candidat validé × jour × Matin/AM)
// effectivement pointées "Présent" parmi celles renseignées dans Emargement_du_stage.
function tauxDePresence(stage, candidates) {
  const rows = emargementForStage(stage.id);
  if (!rows.length) return null;
  const present = rows.filter((r) => r.Present).length;
  return Math.round((100 * present) / rows.length);
}

function renderEmargementCard(stage, candidates) {
  const days = computeStageDays(stage);
  const stagiaires = candidates.filter((c) => c.Statut === 'Stagiaire' || c.Statut === 'Formé').slice().sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr'));
  if (!days.length) {
    return `<div class="card"><h3>Émargement</h3><p class="empty-state">Renseignez les dates de début et de fin du stage (onglet Préparation logistique) pour faire apparaître la grille d'émargement.</p></div>`;
  }
  if (!stagiaires.length) {
    return `<div class="card"><h3>Émargement</h3><p class="empty-state">Aucun stagiaire validé (statut Stagiaire ou Formé) pour ce stage.</p></div>`;
  }
  const headDays = days.map((d) => `<th colspan="2" style="text-align:center;">${fmtDateFr(d)}</th>`).join('');
  const headDemis = days.map(() => DEMI_JOURNEES.map((demi) => `<th style="font-weight:400; font-size:0.85em;">${demi === 'Matin' ? 'Matin' : 'A.M.'}</th>`).join('')).join('');
  const rows = stagiaires.map((c) => {
    const cells = days.map((d) => DEMI_JOURNEES.map((demi) => {
      const row = emargementRow(stage.id, c.id, d, demi);
      const checked = row && row.Present ? 'checked' : '';
      return `<td style="text-align:center;"><input type="checkbox" class="emarg-check" data-cand-id="${c.id}" data-jour="${d}" data-demi="${demi}" ${checked}></td>`;
    }).join('')).join('');
    return `<tr><td>${escapeHtml(c.Nom || '')} ${escapeHtml(c.Prenom || '')}</td>${cells}</tr>`;
  }).join('');
  const footCells = days.map((d) => DEMI_JOURNEES.map((demi) => {
    const allChecked = stagiaires.every((c) => { const row = emargementRow(stage.id, c.id, d, demi); return row && row.Present; });
    return `<td style="text-align:center;"><input type="checkbox" class="emarg-check-all" data-jour="${d}" data-demi="${demi}" ${allChecked ? 'checked' : ''}></td>`;
  }).join('')).join('');
  return `
    <div class="card">
      <h3>Émargement</h3>
      <p class="section-sub">Émargement matin / après-midi pour chaque jour de stage — coché à la clôture du stage. Utilisez la ligne « Tout émarger » pour cocher une colonne entière d'un coup.</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th></th>${headDays}</tr><tr><th>Stagiaire</th>${headDemis}</tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td class="muted" style="font-size:11px;">Tout émarger</td>${footCells}</tr></tfoot>
        </table>
      </div>
    </div>
  `;
}

function bindEmargementCard(stage) {
  document.querySelectorAll('.emarg-check-all').forEach((el) => el.addEventListener('change', async (e) => {
    const jour = Number(e.target.getAttribute('data-jour'));
    const demi = e.target.getAttribute('data-demi');
    const present = e.target.checked;
    const stagiaires = candidatesForStage(stage.id).filter((c) => c.Statut === 'Stagiaire' || c.Statut === 'Formé');
    const actions = stagiaires.map((c) => {
      const existing = emargementRow(stage.id, c.id, jour, demi);
      return existing
        ? ['UpdateRecord', physTable('Emargement_du_stage'), existing.id, { Present: present }]
        : ['AddRecord', physTable('Emargement_du_stage'), null, { Stage: stage.id, Candidat: c.id, Jour: jour, Demi_journee: demi, Present: present }];
    });
    try {
      if (actions.length) { await grist.docApi.applyUserActions(actions); await loadTable('Emargement_du_stage'); }
      render();
    } catch (err) { flashError('Erreur émargement groupé', err); }
  }));
  document.querySelectorAll('.emarg-check').forEach((el) => el.addEventListener('change', async (e) => {
    const candId = Number(e.target.getAttribute('data-cand-id'));
    const jour = Number(e.target.getAttribute('data-jour'));
    const demi = e.target.getAttribute('data-demi');
    await toggleEmargement(stage, candId, jour, demi, e.target.checked);
    render();
  }));
}

/* ---------------------------------------------------------------------- */
/* Onglet 4 — Émargement & formation (60e échange)                         */
/* Grille d'émargement (inchangée, voir renderEmargementCard/bindEmargementCard */
/* ci-dessus) + assiduité par stagiaire (statut manuel ET suggestion       */
/* automatique, cf. décision utilisateur "les deux options") + inscription  */
/* groupée des formés à l'annuaire + génération des attestations.          */
/* ---------------------------------------------------------------------- */

// Seuil par défaut (%) au-delà duquel un stagiaire est suggéré au statut "Formé". Choix de
// conception assumé (non demandé explicitement par l'utilisateur) : à ajuster ici si besoin, le
// widget n'expose pas encore de réglage pour cette valeur.
const SEUIL_ASSIDUITE_FORME = 80;

// Taux de présence d'UN candidat sur L'ENSEMBLE des créneaux possibles du stage (contrairement à
// tauxDePresence ci-dessus, qui ne compte que les lignes Emargement_du_stage déjà créées, pour le
// bilan global) : un créneau jamais coché compte ici comme une absence, pas comme une donnée
// manquante — nécessaire pour qu'un stagiaire dont le staff n'a "rien coché du tout" ne soit
// jamais suggéré à 100 % de présence par défaut.
function presenceRateForCandidat(stage, candidatId) {
  const days = computeStageDays(stage);
  const totalSlots = days.length * DEMI_JOURNEES.length;
  if (!totalSlots) return null;
  let present = 0;
  days.forEach((d) => DEMI_JOURNEES.forEach((demi) => {
    const row = emargementRow(stage.id, candidatId, d, demi);
    if (row && row.Present) present++;
  }));
  return Math.round((100 * present) / totalSlots);
}

function renderEmargement(stage) {
  const candidates = candidatesForStage(stage.id);
  const days = computeStageDays(stage);
  const formables = candidates.filter((c) => c.Statut === 'Stagiaire' || c.Statut === 'Formé')
    .slice().sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr'));
  const formes = candidates.filter((c) => c.Statut === 'Formé');
  const statutOptions = ['Stagiaire', 'Formé', 'Non retenu'];

  const assiduiteRows = formables.length ? formables.map((c) => {
    const taux = days.length ? presenceRateForCandidat(stage, c.id) : null;
    const suggestion = taux !== null && taux >= SEUIL_ASSIDUITE_FORME && c.Statut !== 'Formé';
    const opts = statutOptions.map((s) => `<option value="${s}" ${c.Statut === s ? 'selected' : ''}>${s}</option>`).join('');
    return `<tr>
      <td>${escapeHtml(c.Nom || '')} ${escapeHtml(c.Prenom || '')}</td>
      <td>${taux !== null ? taux + ' %' : '—'}</td>
      <td>${suggestion ? '<span class="badge badge-forme">Formé suggéré</span>' : ''}</td>
      <td><select class="ass-statut" data-cand-id="${c.id}">${opts}</select></td>
    </tr>`;
  }).join('') : '<tr><td colspan="4" class="empty-state">Aucun stagiaire validé pour ce stage.</td></tr>';

  return `
    ${renderEmargementCard(stage, candidates)}

    <div class="card">
      <h3>Assiduité et statut de formation</h3>
      <p class="section-sub">Taux calculé sur l'ensemble des créneaux du stage (${days.length} jour(s) × 2 demi-journées) — un créneau non coché dans la grille d'émargement ci-dessus compte comme une absence. Seuil de suggestion : ${SEUIL_ASSIDUITE_FORME} % de présence.</p>
      <table class="data-table">
        <thead><tr><th>Stagiaire</th><th>Taux de présence</th><th></th><th>Statut</th></tr></thead>
        <tbody>${assiduiteRows}</tbody>
      </table>
      <div class="actions-bar" style="margin-top:14px;">
        <button type="button" class="btn btn-primary" id="btnAppliquerSuggestions">Appliquer les suggestions (Stagiaire → Formé)</button>
      </div>
      <p class="field-help">Le statut peut aussi être changé manuellement ci-dessus, dans les deux sens. « Appliquer les suggestions » ne fait que passer au statut Formé les stagiaires atteignant le seuil — il ne repasse jamais automatiquement quelqu'un en Non retenu : une baisse d'assiduité reste toujours une décision manuelle.</p>
    </div>

    <div class="card">
      <h3>Inscription à l'annuaire</h3>
      <p class="section-sub">${formes.length} stagiaire(s) au statut Formé pour ce stage.</p>
      <div class="actions-bar"><button type="button" class="btn btn-primary" id="btnInscrireAnnuaire" ${formes.length ? '' : 'disabled'}>Inscrire tous les formés à l'annuaire</button></div>
      <p class="field-help">Recherche automatique d'une fiche existante (par email, sinon nom + prénom) pour chaque stagiaire Formé : fusionne l'historique si une fiche est trouvée, en crée une nouvelle sinon — en une seule confirmation, sans demande ligne par ligne.</p>
    </div>

    <div class="card">
      <h3>Attestations de formation</h3>
      <p class="section-sub">Génère une page imprimable par stagiaire Formé, à enregistrer en PDF depuis la fenêtre d'impression du navigateur.</p>
      <table class="data-table">
        <thead><tr><th>Stagiaire</th><th>Action</th></tr></thead>
        <tbody>${formes.length ? formes.slice().sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr')).map((c) => `<tr><td>${escapeHtml(c.Nom || '')} ${escapeHtml(c.Prenom || '')}</td><td><button type="button" class="btn btn-small btn-secondary attest-one" data-cand-id="${c.id}">Générer l'attestation</button></td></tr>`).join('') : '<tr><td colspan="2" class="empty-state">Aucun stagiaire Formé pour l\'instant.</td></tr>'}</tbody>
      </table>
      <div class="actions-bar" style="margin-top:14px;"><button type="button" class="btn btn-primary" id="btnAttestationsToutes" ${formes.length ? '' : 'disabled'}>Générer toutes les attestations</button></div>
    </div>
  `;
}

async function applySuggestedStatuts(stage) {
  const days = computeStageDays(stage);
  if (!days.length) { showFlash('Renseignez les dates du stage (onglet Préparation logistique) pour calculer l\'assiduité.', 'error'); return; }
  const candidats = candidatesForStage(stage.id).filter((c) => c.Statut === 'Stagiaire');
  const aPromouvoir = candidats.filter((c) => {
    const taux = presenceRateForCandidat(stage, c.id);
    return taux !== null && taux >= SEUIL_ASSIDUITE_FORME;
  });
  if (!aPromouvoir.length) { showFlash('Aucun stagiaire n\'atteint le seuil de présence pour le moment.', null); return; }
  if (!window.confirm(`Passer ${aPromouvoir.length} stagiaire(s) au statut Formé (seuil ${SEUIL_ASSIDUITE_FORME} % de présence atteint) ?`)) return;
  try {
    const actions = aPromouvoir.map((c) => ['UpdateRecord', physTable('Candidats_du_stage'), c.id, { Statut: 'Formé' }]);
    await grist.docApi.applyUserActions(actions);
    await loadTable('Candidats_du_stage');
    showFlash(`${aPromouvoir.length} stagiaire(s) passé(s) au statut Formé.`, 'ok');
    render();
  } catch (err) { flashError('Erreur', err); }
}

// Transfert groupé de tous les stagiaires "Formé" vers Annuaire_FPGC, en une seule confirmation
// (contrairement à l'ancien bouton par ligne, qui demandait confirmation à chaque fusion trouvée) —
// voir mergeOrCreateAnnuaireEntry ci-dessus pour la logique de fusion/création elle-même.
async function transferAllFormesToAnnuaire(stage) {
  const formes = candidatesForStage(stage.id).filter((c) => c.Statut === 'Formé');
  if (!formes.length) { showFlash('Aucun stagiaire au statut Formé à inscrire.', null); return; }
  if (!window.confirm(`Inscrire ${formes.length} stagiaire(s) formé(s) à l'annuaire (fusion automatique des fiches déjà existantes, sans confirmation individuelle) ?`)) return;
  let crees = 0, fusionnes = 0;
  try {
    for (const candidat of formes) {
      const match = findInAnnuaire(candidat.Nom, candidat.Prenom, candidat.Mel);
      const result = await mergeOrCreateAnnuaireEntry(candidat, stage, match);
      if (result === 'fusionne') fusionnes++; else crees++;
    }
    showFlash(`Annuaire mis à jour : ${crees} fiche(s) créée(s), ${fusionnes} fusionnée(s).`, 'ok');
    render();
  } catch (err) { flashError('Erreur au transfert groupé', err); }
}

/* -- Attestations de formation (page imprimable, sans dépendance externe) -- */
// Motif retenu (décision utilisateur : "Page imprimable par stagiaire") : window.open + document.write
// + window.print(), avec page-break-after pour enchaîner plusieurs attestations dans un seul job
// d'impression côté "Générer toutes les attestations" — cohérent avec le reste du widget qui
// n'utilise aucune librairie externe (pas de génération de PDF côté client).
const ATTESTATION_STYLE = `
  body { font-family: Arial, sans-serif; color: #1a1a1a; }
  .attestation-page { padding: 60px; page-break-after: always; }
  .attestation-page:last-child { page-break-after: auto; }
  .attestation-page h1 { font-size: 26px; text-align: center; margin-bottom: 40px; }
  .attestation-nom { font-size: 20px; font-weight: bold; text-align: center; margin: 16px 0; }
  .attestation-intitule { font-size: 17px; font-style: italic; text-align: center; margin: 16px 0 30px; }
  .attestation-details { margin: 0 auto 30px; border-collapse: collapse; }
  .attestation-details td { padding: 6px 14px; border-bottom: 1px solid #ddd; }
  .attestation-details td:first-child { font-weight: bold; color: #444; }
  .attestation-date { text-align: right; margin-top: 60px; }
`;

function buildAttestationHtml(stage, candidat, volumeH) {
  const niveau = stageNiveauRow(stage);
  return `
    <section class="attestation-page">
      <h1>Attestation de formation</h1>
      <p>Le présent document atteste que</p>
      <p class="attestation-nom">${escapeHtml(candidat.Nom || '')} ${escapeHtml(candidat.Prenom || '')}</p>
      <p>a suivi la formation :</p>
      <p class="attestation-intitule">${escapeHtml(stage.Intitule || '')}</p>
      <table class="attestation-details">
        <tr><td>Référence du stage</td><td>${escapeHtml(stage.Reference_de_stage || '—')}</td></tr>
        <tr><td>Niveau</td><td>${escapeHtml(niveau ? niveau.Niveau_du_stage : '—')}</td></tr>
        <tr><td>Dates</td><td>${fmtDateFr(stage.Date_de_debut_de_session)} au ${fmtDateFr(stage.Date_de_fin_de_session)}</td></tr>
        <tr><td>Volume horaire</td><td>${volumeH} heure(s)</td></tr>
      </table>
      <p class="attestation-date">Fait le ${fmtDateFr(Math.floor(Date.now() / 1000))}</p>
    </section>
  `;
}

function openAttestationWindow(bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) { showFlash('La fenêtre d\'impression a été bloquée par le navigateur — autorisez les popups pour ce site puis réessayez.', 'error'); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Attestation de formation</title><style>${ATTESTATION_STYLE}</style></head><body>${bodyHtml}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function volumeHoraireStage(stage) {
  const planning = planningForStage(stage.id);
  return (planning.reduce((s, p) => s + (Number(p.Duree) || 0), 0) / 60).toFixed(1);
}

function genererAttestation(stage, candidat) {
  openAttestationWindow(buildAttestationHtml(stage, candidat, volumeHoraireStage(stage)));
}

function genererToutesAttestations(stage) {
  const formes = candidatesForStage(stage.id).filter((c) => c.Statut === 'Formé').slice().sort((a, b) => (a.Nom || '').localeCompare(b.Nom || '', 'fr'));
  if (!formes.length) { showFlash('Aucun stagiaire au statut Formé.', null); return; }
  const volumeH = volumeHoraireStage(stage);
  openAttestationWindow(formes.map((c) => buildAttestationHtml(stage, c, volumeH)).join(''));
}

function bindEmargement(stage) {
  bindEmargementCard(stage);

  document.querySelectorAll('.ass-statut').forEach((el) => el.addEventListener('change', async (e) => {
    const id = Number(e.target.getAttribute('data-cand-id'));
    try { await updateRecord('Candidats_du_stage', id, { Statut: e.target.value }); showFlash('Statut mis à jour.', 'ok'); render(); }
    catch (err) { flashError('Erreur', err); }
  }));

  const btnSuggestions = document.getElementById('btnAppliquerSuggestions');
  if (btnSuggestions) btnSuggestions.addEventListener('click', () => applySuggestedStatuts(stage));

  const btnAnnuaire = document.getElementById('btnInscrireAnnuaire');
  if (btnAnnuaire) btnAnnuaire.addEventListener('click', () => transferAllFormesToAnnuaire(stage));

  document.querySelectorAll('.attest-one').forEach((el) => el.addEventListener('click', () => {
    const c = byId('Candidats_du_stage', Number(el.getAttribute('data-cand-id')));
    if (c) genererAttestation(stage, c);
  }));
  const btnAttestationsToutes = document.getElementById('btnAttestationsToutes');
  if (btnAttestationsToutes) btnAttestationsToutes.addEventListener('click', () => genererToutesAttestations(stage));
}

/* ---------------------------------------------------------------------- */
/* Onglet 5 — Enquête de satisfaction (60e échange) : résultats en haut    */
/* (déplacés depuis l'ancien onglet Clôture), paramétrage en bas (déplacé  */
/* depuis l'ancien onglet Stagiaires) — voir renderConfigSatisfaction/      */
/* bindConfigSatisfaction plus haut, inchangées.                          */
/* ---------------------------------------------------------------------- */

function renderSatisfaction(stage) {
  const enquetes = T('Enquete_de_satisfaction').filter((e) => e.Stage === stage.id);
  const avg = (field) => {
    const vals = enquetes.map((e) => Number(e[field])).filter((v) => !isNaN(v));
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '—';
  };
  // 29e échange — détail par module (Satisfaction_modules) : rattaché à Enquete_de_satisfaction,
  // pas directement au stage, d'où le passage par l'ensemble des ids d'enquête de ce stage.
  const enqueteIds = new Set(enquetes.map((e) => e.id));
  const reponsesModules = T('Satisfaction_modules').filter((r) => enqueteIds.has(r.Enquete));
  const modulesSatisfaction = new Map();
  reponsesModules.forEach((r) => {
    if (!modulesSatisfaction.has(r.Titre_module)) modulesSatisfaction.set(r.Titre_module, {});
    const bucket = modulesSatisfaction.get(r.Titre_module);
    bucket[r.Reponse] = (bucket[r.Reponse] || 0) + 1;
  });

  return `
    <div class="card">
      <h3>Résultats de l'enquête de satisfaction</h3>
      <p class="section-sub">${enquetes.length} réponse(s) reçue(s), anonymes.</p>
      <div class="grid-4">
        <div class="stat-tile"><span class="stat-value">${avg('Note_globale')}</span><span class="stat-label">Note globale /5</span></div>
        <div class="stat-tile"><span class="stat-value">${avg('Note_intervenants')}</span><span class="stat-label">Intervenants /5</span></div>
        <div class="stat-tile"><span class="stat-value">${avg('Note_contenu')}</span><span class="stat-label">Contenu /5</span></div>
        <div class="stat-tile"><span class="stat-value">${avg('Note_logistique')}</span><span class="stat-label">Logistique /5</span></div>
      </div>
      ${modulesSatisfaction.size ? `
        <p class="section-sub" style="margin-top:16px;"><strong>Évaluation individuelle des modules</strong></p>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Module</th>${ECHELLE_MODULE.map((o) => `<th>${escapeHtml(o)}</th>`).join('')}<th>Réponses</th></tr></thead>
          <tbody>${[...modulesSatisfaction.entries()].map(([titre, bucket]) => {
            const total = ECHELLE_MODULE.reduce((s, o) => s + (bucket[o] || 0), 0);
            return `<tr><td>${escapeHtml(titre)}</td>${ECHELLE_MODULE.map((o) => `<td>${bucket[o] || 0}</td>`).join('')}<td>${total}</td></tr>`;
          }).join('')}</tbody>
        </table></div>` : ''}
    </div>
    ${renderConfigSatisfaction(stage)}
  `;
}

function bindSatisfaction(stage) {
  bindConfigSatisfaction(stage);
}

/* ---------------------------------------------------------------------- */
/* Onglet 6 — Clôture du stage (60e échange : trimmé à Bilan + Actions,    */
/* l'émargement et les résultats de l'enquête de satisfaction ont chacun   */
/* leur propre onglet désormais, voir renderEmargement/renderSatisfaction  */
/* ci-dessus)                                                              */
/* ---------------------------------------------------------------------- */

function renderCloture(stage) {
  const candidates = candidatesForStage(stage.id);
  const admin = T('Administration_et_logistique').find((a) => a.Reference_de_stage === stage.id) || {};
  const volumeH = volumeHoraireStage(stage);
  const tauxPresence = tauxDePresence(stage, candidates);
  const formes = candidates.filter((c) => c.Statut === 'Formé').length;
  const nonRetenus = candidates.filter((c) => c.Statut === 'Non retenu').length;
  const tauxReussite = (formes + nonRetenus) ? Math.round((100 * formes) / (formes + nonRetenus)) : null;

  const canClose = stage.Statut_du_stage !== 'Clôturé' && stage.Statut_du_stage !== 'Annulé';

  return `
    <div class="card">
      <h3>Bilan du stage</h3>
      <p class="section-sub">Synthèse agrégée depuis les autres onglets — pas de saisie ici.</p>
      <div class="grid-4">
        <div class="stat-tile"><span class="stat-value">${tauxPresence !== null ? tauxPresence + ' %' : '—'}</span><span class="stat-label">Taux de présence</span></div>
        <div class="stat-tile"><span class="stat-value">${euro(admin.Cout_total)}</span><span class="stat-label">Coût réel total</span></div>
        <div class="stat-tile"><span class="stat-value">${volumeH} h</span><span class="stat-label">Volume horaire réalisé</span></div>
        <div class="stat-tile"><span class="stat-value">${tauxReussite !== null ? tauxReussite + ' %' : '—'}</span><span class="stat-label">Taux de réussite (${formes}/${formes + nonRetenus} Formé)</span></div>
      </div>
    </div>

    <div class="card">
      <h3>Actions</h3>
      ${canClose ? '' : `<p class="section-sub">Statut actuel : <strong>${escapeHtml(stage.Statut_du_stage || '—')}</strong> — c'est pour cela que « Clôturer le stage » est grisé (un stage déjà clôturé ou annulé ne peut pas être re-clôturé). Utilisez « Rouvrir le stage » ci-dessous si c'est une erreur (ex. stage historique importé comme Clôturé par défaut).</p>`}
      <div class="actions-bar">
        <button type="button" class="btn btn-primary" id="btnCloturer" ${canClose ? '' : 'disabled'}>Clôturer le stage</button>
        ${canClose ? '' : '<button type="button" class="btn btn-secondary" id="btnRouvrir">Rouvrir le stage (repasser en Brouillon)</button>'}
        <button type="button" class="btn btn-secondary" id="btnDupliquer">Dupliquer ce stage</button>
        <button type="button" class="btn btn-danger" id="btnAnnuler" ${stage.Statut_du_stage === 'Annulé' ? 'disabled' : ''}>Annuler le stage</button>
      </div>
    </div>
  `;
}

function bindCloture(stage) {
  document.getElementById('btnCloturer').addEventListener('click', async () => {
    if (!window.confirm('Clôturer ce stage ? Il restera consultable.')) return;
    try { await updateRecord('BD_Stages2', stage.id, { Statut_du_stage: 'Clôturé' }); showFlash('Stage clôturé.', 'ok'); render(); }
    catch (err) { flashError('Erreur', err); }
  });
  document.getElementById('btnAnnuler').addEventListener('click', async () => {
    if (!window.confirm('Annuler ce stage ?')) return;
    try { await updateRecord('BD_Stages2', stage.id, { Statut_du_stage: 'Annulé' }); showFlash('Stage annulé.', 'ok'); render(); }
    catch (err) { flashError('Erreur', err); }
  });
  const btnRouvrir = document.getElementById('btnRouvrir');
  if (btnRouvrir) btnRouvrir.addEventListener('click', async () => {
    if (!window.confirm('Rouvrir ce stage (statut → Brouillon) ?')) return;
    try { await updateRecord('BD_Stages2', stage.id, { Statut_du_stage: 'Brouillon' }); showFlash('Stage rouvert.', 'ok'); render(); }
    catch (err) { flashError('Erreur', err); }
  });
  document.getElementById('btnDupliquer').addEventListener('click', () => {
    openCreateStageModal();
    setTimeout(() => {
      const sel = document.getElementById('csModele');
      if (sel) { sel.value = String(stage.id); sel.dispatchEvent(new Event('change')); }
    }, 0);
  });
}

/* ---------------------------------------------------------------------- */
/* Espace de travail d'un stage — coquille à 6 onglets                    */
/* ---------------------------------------------------------------------- */

const STAGE_TAB_RENDERERS = {
  stagiaires: { render: renderStagiaires, bind: bindStagiaires, label: '1 · Stagiaires' },
  preparation: { render: renderPreparation, bind: bindPreparation, label: '2 · Préparation logistique' },
  ingenierie: { render: renderIngenierie, bind: bindIngenierie, label: '3 · Ingénierie pédagogique' },
  emargement: { render: renderEmargement, bind: bindEmargement, label: '4 · Émargement & formation' },
  satisfaction: { render: renderSatisfaction, bind: bindSatisfaction, label: '5 · Enquête de satisfaction' },
  cloture: { render: renderCloture, bind: bindCloture, label: '6 · Clôture du stage' },
};

function renderStageWorkspace() {
  const stage = byId('BD_Stages2', state.stageId);
  if (!stage) { state.route = 'accueil'; return renderAccueil(); }
  // matchReferenceRow (voir renderPreparation) : accepte aussi bien l'id de référence que le texte
  // libre historique, pour ne jamais afficher "—" à tort sur un stage importé de l'ancien format.
  const academie = matchReferenceRow(academieRows(), stage.Academie_de_formation, 'Academie');
  const niveau = matchReferenceRow(niveauRows(), stage.Niveau_du_stage, 'Niveau_du_stage');
  const badgeClass = STATUT_BADGE_STAGE[stage.Statut_du_stage] || 'badge-brouillon';

  const tabKeys = Object.keys(STAGE_TAB_RENDERERS);
  const tabsHtml = tabKeys.map((key) => {
    const def = STAGE_TAB_RENDERERS[key];
    const active = state.stageTab === key;
    return `<button type="button" role="tab" id="tab-${key}" aria-selected="${active}" aria-controls="tabpanel-stage" tabindex="${active ? '0' : '-1'}" class="tab ${active ? 'active' : ''}" data-stage-tab="${key}">${def.label}</button>`;
  }).join('');

  const bodyHtml = STAGE_TAB_RENDERERS[state.stageTab].render(stage);

  return `
    <div class="stage-header">
      <div>
        <h2>${escapeHtml(stage.Intitule || '(sans intitulé)')} <span class="badge ${badgeClass}">${escapeHtml(stage.Statut_du_stage || 'Brouillon')}</span></h2>
        <p class="stage-ref mono">${escapeHtml(stage.Reference_de_stage)} · ${escapeHtml(academie ? academie.Academie : '—')} · ${escapeHtml(niveau ? niveau.Niveau_du_stage : '—')}</p>
      </div>
    </div>
    <div class="tabs" role="tablist" aria-label="Onglets du stage">${tabsHtml}</div>
    <div id="tabpanel-stage" role="tabpanel" aria-labelledby="tab-${state.stageTab}" tabindex="0">${bodyHtml}</div>
  `;
}

// Navigation clavier des onglets (FR-015) : flèches gauche/droite pour passer à l'onglet précédent/
// suivant (avec repli circulaire), Origine/Fin pour aller directement au premier/dernier — motif
// ARIA APG "tabs" standard (tabindex tournant : seul l'onglet actif reste dans l'ordre de tabulation,
// les flèches déplacent le focus ET activent l'onglet, cf. tabIndex posé dans renderStageWorkspace).
function bindStageWorkspace() {
  const stage = byId('BD_Stages2', state.stageId);
  const tabKeys = Object.keys(STAGE_TAB_RENDERERS);
  document.querySelectorAll('[data-stage-tab]').forEach((el) => {
    el.addEventListener('click', () => {
      state.stageTab = el.getAttribute('data-stage-tab');
      render();
    });
    el.addEventListener('keydown', (e) => {
      const idx = tabKeys.indexOf(state.stageTab);
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabKeys.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabKeys.length) % tabKeys.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabKeys.length - 1;
      if (nextIdx === null) return;
      e.preventDefault();
      state.stageTab = tabKeys[nextIdx];
      render();
      const newTabEl = document.querySelector(`[data-stage-tab="${state.stageTab}"]`);
      if (newTabEl) newTabEl.focus();
    });
  });
  if (stage) STAGE_TAB_RENDERERS[state.stageTab].bind(stage);
}

/* ---------------------------------------------------------------------- */
/* Paramètres — correspondance des tables Grist                            */
/* Onglet séparé (bouton "⚙ Tables" dans la barre du haut, toujours        */
/* accessible même si le chargement initial a échoué) permettant de faire  */
/* correspondre chaque nom logique utilisé par le code (TABLES ci-dessus)  */
/* au nom réel d'une table dans le document Grist effectivement ouvert —   */
/* sans toucher au code. Utile en particulier quand une table attendue     */
/* n'existe pas encore sous ce nom exact dans le document (ex. erreur      */
/* "no such table"), ou porte un nom différent d'un document à l'autre.    */
/* ---------------------------------------------------------------------- */

function renderParametres() {
  const map = state.options.tableMap || {};
  const rowsHtml = TABLES.map((t) => `
    <tr>
      <td><code>${escapeHtml(t)}</code></td>
      <td><input type="text" class="pm-map-input" data-logical="${escapeHtml(t)}" value="${escapeHtml(map[t] || '')}" placeholder="${escapeHtml(t)}" style="width:100%;"></td>
      <td class="pm-status" data-status-for="${escapeHtml(t)}"><span class="empty-state">Non vérifié</span></td>
    </tr>`).join('');

  return `
    <div class="card">
      <h2>Paramètres — correspondance des tables Grist</h2>
      <p class="section-sub">
        Le code de ce widget désigne chaque table par un nom fixe (colonne de gauche). Si, dans ce document Grist,
        la table correspondante porte un nom différent — ou si elle n'existe pas encore sous ce nom, par exemple
        après l'ajout d'un nouveau schéma — indiquez ici le nom réel à utiliser à sa place. Laissez le champ vide
        pour utiliser le nom du widget tel quel.
      </p>
      <div class="table-scroll"><table class="data-table">
        <thead><tr><th>Nom utilisé par le widget</th><th>Nom réel dans ce document</th><th>État</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      <div class="actions-bar" style="margin-top:14px;">
        <button type="button" class="btn btn-secondary" id="pmCheck">Vérifier la correspondance</button>
        <button type="button" class="btn btn-secondary" id="pmReset">Tout vider</button>
        <button type="button" class="btn btn-primary" id="pmSave">Enregistrer et recharger</button>
      </div>
    </div>
  `;
}

// Interroge directement grist.docApi.fetchTable pour chaque ligne (avec le nom saisi à l'écran,
// pas encore forcément enregistré) — indépendant du cache DB, pour pouvoir diagnostiquer une
// correspondance avant de l'enregistrer.
async function checkTableMapping() {
  await Promise.all(TABLES.map(async (t) => {
    const cell = document.querySelector(`[data-status-for="${CSS.escape(t)}"]`);
    const input = document.querySelector(`.pm-map-input[data-logical="${CSS.escape(t)}"]`);
    if (!cell) return;
    const target = (input && input.value.trim()) || t;
    cell.innerHTML = '<span class="empty-state">Vérification…</span>';
    try {
      const data = await grist.docApi.fetchTable(target);
      const n = data && data.id ? data.id.length : 0;
      cell.innerHTML = `<span style="color:#2e7d32;">✓ trouvée (${n} ligne${n === 1 ? '' : 's'})</span>`;
    } catch (err) {
      cell.innerHTML = `<span style="color:#c62828;">✗ ${escapeHtml(String((err && err.message) || err))}</span>`;
    }
  }));
}

function bindParametres() {
  checkTableMapping();

  document.getElementById('pmCheck').addEventListener('click', checkTableMapping);

  document.getElementById('pmReset').addEventListener('click', () => {
    document.querySelectorAll('.pm-map-input').forEach((el) => { el.value = ''; });
    showFlash('Champs vidés à l\'écran — cliquez "Enregistrer et recharger" pour appliquer.', 'ok');
  });

  document.getElementById('pmSave').addEventListener('click', async () => {
    const map = {};
    document.querySelectorAll('.pm-map-input').forEach((el) => {
      const v = el.value.trim();
      if (v) map[el.getAttribute('data-logical')] = v;
    });
    state.options.tableMap = map;
    try {
      await grist.setOption('tableMap', map);
      await loadAll();
      loadParametresWidgetIntoState();
      document.getElementById('topbarSub').textContent = `${T('BD_Stages2').length} stage(s) — ${T('Annuaire_FPGC').length} personnel(s) à l'annuaire`;
      showFlash('Correspondance enregistrée, données rechargées avec succès.', 'ok');
    } catch (err) {
      flashError('Correspondance enregistrée, mais le rechargement d\'une ou plusieurs tables a échoué', err);
    }
    render();
  });
}

/* ---------------------------------------------------------------------- */
/* Rendu racine et démarrage                                              */
/* ---------------------------------------------------------------------- */

// Corrigé le 2026-08-24 : changer de page Grist et revenir détruit puis recrée l'iframe du widget —
// state.route/stageId/stageTab (de simples variables JS) repartaient donc toujours de zéro
// ('accueil'), quelle que soit la vue consultée juste avant. sessionStorage survit à ce cycle
// destruction/recréation (il est attaché à l'origine du widget dans cet onglet de navigateur, pas à
// l'iframe elle-même) sans redémarrer à chaque fermeture complète du navigateur, contrairement à
// grist.setOption qui aurait en plus l'inconvénient d'être une préférence PARTAGÉE entre tous les
// utilisateurs de ce widget (voir la discussion sur "Mon académie", même piège). Enveloppé en
// try/catch : sessionStorage peut être indisponible dans certains contextes de navigation privée.
const NAV_STORAGE_KEY = 'fpgc:derniereVue';

function saveNavState() {
  try {
    sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify({ route: state.route, stageId: state.stageId, stageTab: state.stageTab }));
  } catch (err) { /* navigation privée ou stockage désactivé — pas grave, retour à l'accueil par défaut */ }
}

function restoreNavState() {
  try {
    const raw = sessionStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Le stage consulté a pu être supprimé entre-temps (ou n'être plus visible pour cet utilisateur,
    // ex. filtrage académie) — dans ce cas on retombe sur l'accueil plutôt que sur un écran vide.
    if (saved.route === 'stage' && saved.stageId && T('BD_Stages2').some((s) => s.id === saved.stageId)) {
      state.route = 'stage';
      state.stageId = saved.stageId;
      state.stageTab = saved.stageTab || 'stagiaires';
    } else if (saved.route === 'parametres') {
      state.route = 'parametres';
    }
  } catch (err) { /* valeur corrompue — ignorée, retour à l'accueil par défaut */ }
}

// 62e échange, tour suivant — permet à formulaire-public.js/enquete-satisfaction.js (panneau "Liens
// de recrutement"/"Liens de satisfaction" affiché à un compte académique/national ouvrant l'une de
// ces pages directement, voir renderStaff() dans ces deux fichiers) d'ouvrir CE widget directement
// sur le bon stage/onglet, plutôt que d'obliger le personnel à le retrouver lui-même.
//
// Pourquoi localStorage plutôt qu'un paramètre d'URL (`?stageId=...`) : ce widget tourne dans un
// iframe dont l'URL est celle, FIXE, du fichier hébergé (choisie une fois pour toutes dans le
// sélecteur "Custom Widget" de Grist) — elle ne reflète PAS l'URL de la page Grist qui l'héberge.
// C'est précisément la raison pour laquelle une tentative similaire, côté candidat, a été abandonnée
// au 22e échange (voir la note d'architecture en tête de formulaire-public.js : « lire un paramètre
// depuis l'URL du widget » ne fonctionne pas de façon fiable pour cette raison). En revanche, TOUS
// les fichiers de ce projet sont hébergés sur la MÊME origine statique — localStorage est partagé par
// origine, quel que soit l'onglet/la fenêtre qui héberge chaque widget dans son iframe (localStorage
// n'est jamais cloisonné par onglet, seulement par origine) ; ceci reste vrai que le widget d'origine
// (formulaire-public.js/enquete-satisfaction.js) ouvre ce widget dans le MÊME onglet (`target="_top"`,
// comportement par défaut depuis le 63e échange, tour suivant — demande explicite de l'utilisateur) ou
// dans un nouvel onglet (Ctrl/Cmd+clic, comportement natif du navigateur, `target` n'y change rien). Le
// widget d'origine écrit une petite entrée juste avant l'ouverture ; ce widget la lit une seule fois au
// démarrage puis l'efface aussitôt (usage unique, pour ne jamais réappliquer un ancien clic lors
// d'une réouverture normale plus tard). Une entrée de plus de 30 secondes est ignorée par prudence —
// protection contre le cas où `removeItem` échouerait silencieusement (quota, navigation privée).
//
// **NON CONFIRMÉ EN CONDITIONS RÉELLES** : ce mécanisme (localStorage partagé entre iframes de widgets
// hébergés sur la même origine mais intégrés dans des pages/onglets Grist différents) n'a jamais été
// testé face à un vrai navigateur/document Grist dans ce projet — voir
// checklist-mise-en-production.md. Repli sans risque si ça ne fonctionne pas (partitionnement du
// stockage par certains navigateurs, etc.) : ce widget s'ouvre simplement sur sa dernière vue connue
// via restoreNavState(), exactement comme avant l'ajout de cette fonctionnalité — aucune régression
// possible, seulement une fonctionnalité de confort qui ne s'active pas.
const DEEP_LINK_STORAGE_KEY = 'fpgc:ouvrirStage';

function consumeDeepLinkStage() {
  try {
    const raw = localStorage.getItem(DEEP_LINK_STORAGE_KEY);
    if (!raw) return false;
    localStorage.removeItem(DEEP_LINK_STORAGE_KEY); // à usage unique, exploitable ou non
    const saved = JSON.parse(raw);
    if (!saved || !saved.stageId || !saved.ts || (Date.now() - saved.ts) > 30000) return false;
    // Le stage visé a pu être supprimé ou n'être plus visible pour cet utilisateur (filtrage
    // académie) entre le clic et l'ouverture — dans ce cas on ignore silencieusement l'entrée plutôt
    // que d'essayer d'ouvrir un stage inexistant, exactement comme restoreNavState() ci-dessus.
    if (!T('BD_Stages2').some((s) => s.id === saved.stageId)) return false;
    state.route = 'stage';
    state.stageId = saved.stageId;
    state.stageTab = saved.tab || 'stagiaires';
    return true;
  } catch (err) { return false; /* stockage indisponible/corrompu — pas grave, restoreNavState() prend le relais */ }
}

function render() {
  const main = document.getElementById('main');
  if (state.route === 'stage' && state.stageId) {
    main.innerHTML = renderStageWorkspace();
    bindStageWorkspace();
  } else if (state.route === 'parametres') {
    main.innerHTML = renderParametres();
    bindParametres();
  } else {
    state.route = 'accueil';
    main.innerHTML = renderAccueil();
    bindAccueil();
  }
  saveNavState();
}

document.getElementById('btnHome').addEventListener('click', () => { state.route = 'accueil'; state.stageId = null; render(); });
document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
document.getElementById('btnTableMap').addEventListener('click', () => { state.route = 'parametres'; render(); });

async function boot() {
  try {
    await optionsReady;
    await loadAll();
    loadParametresWidgetIntoState();
    if (!consumeDeepLinkStage()) restoreNavState();
    document.getElementById('topbarSub').textContent = `${T('BD_Stages2').length} stage(s) — ${T('Annuaire_FPGC').length} personnel(s) à l'annuaire`;
    render();
  } catch (err) {
    document.getElementById('topbarSub').textContent = 'Erreur de chargement';
    flashError('Erreur de chargement des données Grist — ouvrez "⚙ Tables" pour vérifier la correspondance des tables', err);
    console.error(err);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();