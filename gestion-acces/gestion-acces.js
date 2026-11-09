/*
 * Gestion des accès — widget Grist « FPGC »
 *
 * Applique en un clic la configuration de référence des règles d'accès (ACL) du document,
 * telle que décrite dans acl-academies.md (§18 et suivants), corrigée sur les points où
 * la lecture du code source de Grist montre qu'une règle documentée ne se comporte pas
 * comme prévu (voir NOTE_CORRECTIONS plus bas).
 *
 * Mécanisme : les règles d'accès d'un document Grist sont stockées dans deux tables
 * internes, _grist_ACLResources (une ligne par table / groupe de colonnes visé) et
 * _grist_ACLRules (une ligne par règle, plus une ligne par « User Attribute »).
 * Un propriétaire du document peut les modifier par applyUserActions, exactement comme
 * le fait l'écran « Règles d'accès » de Grist lui-même. Le serveur Grist :
 *   - compile chaque condition (aclFormulaParsed est calculé par le moteur de données) ;
 *   - revalide l'ensemble des règles AVANT d'enregistrer, et refuse tout le lot si une
 *     règle est invalide (table ou colonne inexistante, User Attribute mal formé…).
 * Une application est donc atomique : soit tout passe, soit rien ne change.
 *
 * Ce widget ne fonctionne que pour un propriétaire (OWNER) : Grist n'envoie le contenu des
 * tables de règles qu'aux propriétaires, et refuse leur modification à tout autre compte.
 */

grist.ready({ requiredAccess: 'full' });

// ---------------------------------------------------------------------------------------
// Paramètres de nommage — à ajuster ici si le document réel diffère.
// ---------------------------------------------------------------------------------------

// Noms des paramètres Link Key (le paramètre d'URL est ce nom suivi de « _ »).
const CLES_LIEN = {
  recrutement: 'UUID',               // ?UUID_=…               → user.LinkKey.UUID
  // Nom réellement produit par gestion-stage-fpgc (buildSatisfactionLink) : « SatisfactionUUID_ ».
  // Le v17 attendait « Satisfaction_UUID », d'où une enquête impossible à charger (09/11/2026).
  satisfaction: 'SatisfactionUUID',  // ?SatisfactionUUID_=…   → user.LinkKey.SatisfactionUUID
  stagiaire: 'CandidatUUID',         // ?CandidatUUID_=…       → user.LinkKey.CandidatUUID
};

// Colonnes qui contiennent les liens générés par le widget principal, pour vérifier que
// le nom du paramètre de chaque lien correspond bien à celui attendu par les règles.
const COLONNES_LIENS = [
  { table: 'BD_Stages2', col: 'Formulaire_URL', cle: CLES_LIEN.recrutement, libelle: 'Liens de recrutement' },
  { table: 'BD_Stages2', col: 'Satisfaction_URL', cle: CLES_LIEN.satisfaction, libelle: 'Liens de satisfaction' },
  { table: 'Candidats_du_stage', col: 'Lien_personnel', cle: CLES_LIEN.stagiaire, libelle: 'Liens personnels des stagiaires' },
];

// Colonnes d'une ligne de camarade de sous-groupe visibles par un stagiaire (acl-academies §24).
// Toutes les AUTRES colonnes de Candidats_du_stage lui sont masquées sur les lignes qui ne sont pas la sienne.
const COLONNES_CAMARADE_VISIBLES = ['Nom', 'Prenom', 'Sous_groupe', 'Stage'];

// Seule colonne d'Emargement_du_stage qu'un stagiaire peut modifier (sa présence).
const COLONNE_EMARGEMENT_MODIFIABLE = 'Present';

// Table qui rattache une adresse de connexion à une académie (document v17 : « Utilisateurs »,
// colonnes Email et Academie). Un compte rattaché à l'académie « National » de la table Reference
// a la vue nationale (tous les stages, toutes les académies) : décision du 09/11/2026.
const TABLE_UTILISATEURS = 'Utilisateurs';
const ACADEMIE_NATIONALE = 'National';

// Réglages de Parametres_widget que le personnel académique peut modifier : la configuration des
// formulaires de recrutement et d'enquête. Tous les autres réglages (adresses, numéros de page,
// lien de décharge…) sont communs à toutes les académies : propriétaires et national uniquement.
const PARAMETRES_ACADEMIQUES = ['formulaireConfig', 'satisfactionConfig'];

const PARAM_SAUVEGARDE = 'aclSauvegarde';
const PARAM_TABLES_ANNEXES = 'aclTablesAnnexes';

// ---------------------------------------------------------------------------------------
// Conditions réutilisées
// ---------------------------------------------------------------------------------------

const C = {
  owner: 'user.Access in [OWNER]',
  // Colonne pont Utilisateurs.Est_national (voir COLONNES_PONT) : une condition ne peut pas lire
  // le libellé de l'académie à travers la référence user.Profil.Academie.
  national: 'user.Profil.Est_national',
  // Un User Attribute introuvable n'est PAS None dans Grist : c'est un enregistrement vide,
  // toujours « vrai ». Seul son .id (nul si introuvable) permet de tester sa présence.
  profil: 'user.Profil.id',
  academieStage: 'user.Profil.id and rec.Academie_du_stage == user.Profil.Academie',
  stagiaire: 'user.Stagiaire.id',
  // Visiteur muni d'une clé de lien VALIDE (elle correspond à un stage ou à un stagiaire existant).
  // Une clé inventée ou altérée ne suffit pas : l'attribut utilisateur correspondant reste vide.
  visiteurValide: 'user.StageRecrutement.id or user.StageSatisfaction.id or user.Stagiaire.id',
  sansCle: `not (user.LinkKey.${CLES_LIEN.recrutement} or user.LinkKey.${CLES_LIEN.satisfaction} or user.LinkKey.${CLES_LIEN.stagiaire})`,
};

const MEMO_REFUS = (table) =>
  `Accès refusé (règles FPGC, table ${table}). Vérifiez que votre adresse de connexion figure dans ${TABLE_UTILISATEURS}, ou que le lien utilisé est complet.`;

// ---------------------------------------------------------------------------------------
// User Attributes de référence
// ---------------------------------------------------------------------------------------

const USER_ATTRIBUTES = [
  { name: 'StageRecrutement', tableId: 'BD_Stages2', charId: `LinkKey.${CLES_LIEN.recrutement}`, lookupColId: 'UUID',
    libelle: 'Retrouve le stage à partir de la clé du lien de recrutement' },
  { name: 'Profil', tableId: TABLE_UTILISATEURS, charId: 'Email', lookupColId: 'Email',
    libelle: `Rattache le compte connecté (adresse mél) à sa ligne ${TABLE_UTILISATEURS}` },
  { name: 'Stagiaire', tableId: 'Candidats_du_stage', charId: `LinkKey.${CLES_LIEN.stagiaire}`, lookupColId: 'UUID_personnel',
    libelle: 'Retrouve le stagiaire à partir de la clé personnelle de son lien' },
  { name: 'StageSatisfaction', tableId: 'BD_Stages2', charId: `LinkKey.${CLES_LIEN.satisfaction}`, lookupColId: 'Satisfaction_UUID',
    libelle: "Retrouve le stage à partir de la clé du lien d'enquête de satisfaction" },
];

// ---------------------------------------------------------------------------------------
// Colonnes formule « pont » (les conditions ACL ne savent pas suivre une Référence :
// acl-academies §6/§27). Créées automatiquement si absentes.
// ---------------------------------------------------------------------------------------

const COLONNES_PONT = [
  { table: TABLE_UTILISATEURS, col: 'Est_national', type: 'Bool',
    formula: `($Academie.Academie or "").strip().lower() == "${ACADEMIE_NATIONALE.toLowerCase()}"` },
  { table: 'Candidats_du_stage', col: 'Academie_du_stage', formula: '$Stage.Academie_de_formation', type: 'Ref:Reference' },
  { table: 'Candidats_du_stage', col: 'Stage_UUID', formula: '$Stage.UUID', type: 'Text' },
  { table: 'Intervenants_du_stage', col: 'Academie_du_stage', formula: '$Stage.Academie_de_formation', type: 'Ref:Reference' },
  { table: 'Planning_du_stage', col: 'Academie_du_stage', formula: '$Stage.Academie_de_formation', type: 'Ref:Reference' },
  { table: 'Enquete_de_satisfaction', col: 'Academie_du_stage', formula: '$Stage.Academie_de_formation', type: 'Ref:Reference' },
  { table: 'Emargement_du_stage', col: 'Academie_du_stage', formula: '$Stage.Academie_de_formation', type: 'Ref:Reference' },
  { table: 'Administration_et_logistique', col: 'Academie_du_stage', formula: '$Reference_de_stage.Academie_de_formation', type: 'Ref:Reference' },
  { table: 'Satisfaction_modules', col: 'Academie_du_stage', formula: '$Enquete.Academie_du_stage', type: 'Ref:Reference' },
];

// Colonnes Référence qui DOIVENT être de type Ref:Reference pour que les comparaisons
// « rec.X == user.Profil.Academie » comparent bien deux identifiants.
const COLONNES_REF_ACADEMIE = [
  { table: TABLE_UTILISATEURS, col: 'Academie' },
  { table: 'BD_Stages2', col: 'Academie_de_formation' },
  { table: 'Annuaire_FPGC', col: 'Academie_d_affectation' },
  { table: 'Etablissements_education_nationale', col: 'Libelle_academie', optionnelle: true },
  { table: 'Cibles_fonction_overrides', col: 'Academie', optionnelle: true },
  { table: 'Preferences_tableau_bord', col: 'Academie', optionnelle: true },
  { table: 'Objectifs_previsionnels', col: 'Academie', optionnelle: true },
];

// ---------------------------------------------------------------------------------------
// Configuration de référence, table par table.
// Chaque règle : { label, formula, perms, memo? }. L'ordre compte : Grist s'arrête, pour
// chaque droit, à la première règle qui statue. perms au format Grist (« +R-CUD »).
// La dernière règle (formula vide) est « Tous les autres » : elle ferme systématiquement la
// table — sans elle, Grist retombe sur ses règles par défaut, qui donnent un accès Éditeur
// complet à tout Éditeur… y compris un visiteur arrivé par le lien public (acl-academies §26).
// ---------------------------------------------------------------------------------------

function regleOwner() { return { label: 'Propriétaires du document', formula: C.owner, perms: '+CRUD' }; }
function regleNational() { return { label: 'Équipe nationale', formula: C.national, perms: '+CRUD' }; }
function regleAcademie(perms = '+CRUD') { return { label: "Personnel de l'académie du stage", formula: C.academieStage, perms }; }
function regleRefus(table) { return { label: 'Tous les autres', formula: '', perms: '-CRUD', memo: MEMO_REFUS(table) }; }

const TABLES_REFERENCE = [
  {
    tableId: 'BD_Stages2',
    description: 'Stages — lecture par lien (recrutement, satisfaction, stagiaire), sinon cloisonnement par académie',
    rules: [
      { label: 'Visiteur muni d\'un lien valide pour ce stage',
        formula: `(user.LinkKey.${CLES_LIEN.recrutement} and user.LinkKey.${CLES_LIEN.recrutement} == rec.UUID)` +
          ` or (user.LinkKey.${CLES_LIEN.satisfaction} and user.LinkKey.${CLES_LIEN.satisfaction} == rec.Satisfaction_UUID)` +
          ` or (user.Stagiaire.id and user.Stagiaire.Stage == rec.id)`,
        perms: '+R' },
      { label: 'Propriétaires (hors prévisualisation d\'un lien)', formula: `${C.owner} and ${C.sansCle}`, perms: '+CRUD' },
      { label: 'Équipe nationale (hors prévisualisation d\'un lien)', formula: `${C.national} and ${C.sansCle}`, perms: '+CRUD' },
      { label: "Personnel de l'académie (hors prévisualisation d'un lien)",
        formula: `user.Profil.id and rec.Academie_de_formation == user.Profil.Academie and ${C.sansCle}`, perms: '+CRUD' },
      regleRefus('BD_Stages2'),
    ],
  },
  {
    tableId: 'Candidats_du_stage',
    description: 'Candidats — dépôt de candidature par lien, lecture de sa ligne et de son sous-groupe par le stagiaire',
    rules: [
      regleOwner(),
      { label: 'Dépôt de candidature avec le lien de recrutement du stage',
        formula: `user.LinkKey.${CLES_LIEN.recrutement} and user.LinkKey.${CLES_LIEN.recrutement} == newRec.Stage_UUID`, perms: '+C' },
      { label: 'Stagiaire : sa propre ligne', formula: `${C.stagiaire} and user.Stagiaire.id == rec.id`, perms: '+R' },
      { label: 'Stagiaire : camarades de son sous-groupe (colonnes restreintes)',
        formula: `${C.stagiaire} and user.Stagiaire.Sous_groupe and user.Stagiaire.Stage == rec.Stage and user.Stagiaire.Sous_groupe == rec.Sous_groupe`,
        perms: '+R' },
      regleNational(),
      regleAcademie(),
      regleRefus('Candidats_du_stage'),
    ],
    columnRules: [
      {
        description: `Colonnes masquées sur la ligne d'un camarade (toutes sauf ${COLONNES_CAMARADE_VISIBLES.join(', ')})`,
        colIds: (cols) => cols.filter((c) => !COLONNES_CAMARADE_VISIBLES.includes(c)),
        rules: [
          { label: "Stagiaire consultant la ligne d'un camarade", formula: `${C.stagiaire} and rec.id != user.Stagiaire.id`, perms: '-RU',
            memo: "Cette information n'est visible que par la personne concernée." },
        ],
      },
    ],
  },
  {
    tableId: 'Intervenants_du_stage',
    description: 'Intervenants — lecture par les stagiaires du stage (nom dans le planning)',
    rules: [
      regleOwner(),
      { label: 'Stagiaire du stage', formula: `${C.stagiaire} and user.Stagiaire.Stage == rec.Stage`, perms: '+R' },
      regleNational(),
      regleAcademie(),
      regleRefus('Intervenants_du_stage'),
    ],
  },
  {
    tableId: 'Planning_du_stage',
    description: "Planning — lecture par les stagiaires du stage, et par le répondant de l'enquête (liste des modules à noter)",
    rules: [
      regleOwner(),
      { label: 'Stagiaire du stage', formula: `${C.stagiaire} and user.Stagiaire.Stage == rec.Stage`, perms: '+R' },
      { label: "Répondant de l'enquête du stage", formula: 'user.StageSatisfaction.id and user.StageSatisfaction.id == rec.Stage', perms: '+R' },
      regleNational(),
      regleAcademie(),
      regleRefus('Planning_du_stage'),
    ],
  },
  {
    tableId: 'Emargement_du_stage',
    description: 'Émargement — le stagiaire lit et coche uniquement sa propre présence',
    rules: [
      regleOwner(),
      { label: 'Stagiaire : ses propres lignes', formula: `${C.stagiaire} and user.Stagiaire.id == rec.Candidat and user.Stagiaire.id == newRec.Candidat`, perms: '+RU' },
      regleNational(),
      regleAcademie(),
      regleRefus('Emargement_du_stage'),
    ],
    columnRules: [
      {
        description: `Colonnes non modifiables par un stagiaire (toutes sauf ${COLONNE_EMARGEMENT_MODIFIABLE})`,
        colIds: (cols) => cols.filter((c) => c !== COLONNE_EMARGEMENT_MODIFIABLE),
        rules: [
          { label: 'Stagiaire (hors personnel)', formula: `${C.stagiaire} and not user.Profil.id and user.Access != OWNER`, perms: '-U',
            memo: 'Un stagiaire ne peut modifier que sa présence.' },
        ],
      },
    ],
  },
  {
    tableId: 'Administration_et_logistique',
    description: 'Logistique — personnel uniquement',
    rules: [regleOwner(), regleNational(), regleAcademie(), regleRefus('Administration_et_logistique')],
  },
  {
    tableId: 'Enquete_de_satisfaction',
    description: "Enquête — dépôt anonyme avec le lien d'enquête du stage, jamais relue par le public",
    rules: [
      regleOwner(),
      { label: "Réponse avec le lien d'enquête du stage",
        formula: 'user.StageSatisfaction.id and user.StageSatisfaction.id == newRec.Stage', perms: '+C' },
      regleNational(),
      regleAcademie(),
      regleRefus('Enquete_de_satisfaction'),
    ],
  },
  {
    tableId: 'Satisfaction_modules',
    optionnelle: true,
    description: "Notes par module — dépôt avec le lien d'enquête, lecture par le personnel de l'académie",
    rules: [
      regleOwner(),
      { label: "Réponse avec un lien d'enquête valide", formula: 'user.StageSatisfaction.id', perms: '+C' },
      regleNational(),
      regleAcademie(),
      regleRefus('Satisfaction_modules'),
    ],
  },
  {
    tableId: 'Reference',
    description: 'Référentiel académies / niveaux — lecture par le personnel et par les visiteurs munis d\'un lien valide',
    rules: [
      regleOwner(),
      regleNational(),
      { label: 'Personnel répertorié (lecture)', formula: C.profil, perms: '+R-CUD' },
      { label: "Visiteur muni d'un lien valide (lecture)", formula: C.visiteurValide, perms: '+R-CUD' },
      regleRefus('Reference'),
    ],
  },
  {
    tableId: 'Annuaire_FPGC',
    description: "Annuaire — chaque académie voit les personnels de son académie d'affectation (décision du 09/11/2026), suppression réservée au national",
    rules: [
      regleOwner(),
      regleNational(),
      { label: "Académie : personnels qui y sont affectés", formula: 'user.Profil.id and rec.Academie_d_affectation == user.Profil.Academie', perms: '+CRU-D' },
      regleRefus('Annuaire_FPGC'),
    ],
  },
  {
    tableId: 'Modules_de_formation',
    description: 'Bibliothèque de modules — lecture par le personnel, ajout de modules complémentaires par les académies',
    rules: [
      regleOwner(),
      regleNational(),
      { label: 'Académies : ajout de modules complémentaires', formula: `${C.profil} and newRec.Type == "Complémentaire"`, perms: '+C' },
      { label: 'Personnel répertorié (lecture)', formula: C.profil, perms: '+R-CUD' },
      regleRefus('Modules_de_formation'),
    ],
  },
  {
    tableId: 'Parametres_widget',
    description: "Réglages des widgets — les académies modifient la configuration des formulaires, les réglages communs restent au national",
    rules: [
      regleOwner(),
      regleNational(),
      { label: 'Personnel : configuration des formulaires (création)',
        formula: `${C.profil} and newRec.Cle in ${JSON.stringify(PARAMETRES_ACADEMIQUES)}`, perms: '+C' },
      { label: 'Personnel : configuration des formulaires (modification)',
        formula: `${C.profil} and rec.Cle in ${JSON.stringify(PARAMETRES_ACADEMIQUES)} and newRec.Cle in ${JSON.stringify(PARAMETRES_ACADEMIQUES)}`, perms: '+U' },
      { label: 'Personnel : lecture des autres réglages', formula: C.profil, perms: '+R-CUD',
        memo: 'Réglage commun à toutes les académies : seuls les propriétaires du document et l\'équipe nationale peuvent le modifier.' },
      { label: "Visiteur muni d'un lien valide (lecture)", formula: C.visiteurValide, perms: '+R-CUD' },
      regleRefus('Parametres_widget'),
    ],
  },
  {
    tableId: TABLE_UTILISATEURS,
    description: 'Correspondance comptes / académies — national uniquement',
    rules: [regleOwner(), regleNational(), regleRefus(TABLE_UTILISATEURS)],
  },
  {
    tableId: 'Etablissements_education_nationale',
    optionnelle: true,
    description: "Copie locale des établissements — chaque académie lit et actualise les siens (pilotage académique)",
    rules: [
      regleOwner(),
      regleNational(),
      { label: 'Académie : ses établissements', formula: 'user.Profil.id and rec.Libelle_academie == user.Profil.Academie', perms: '+CRUD' },
      regleRefus('Etablissements_education_nationale'),
    ],
  },
  {
    tableId: 'Cibles_fonction_overrides',
    optionnelle: true,
    description: "Ajustements de cible par établissement — chaque académie gère les siens (pilotage académique)",
    rules: [
      regleOwner(),
      regleNational(),
      { label: 'Académie : ses ajustements', formula: 'user.Profil.id and rec.Academie == user.Profil.Academie', perms: '+CRUD' },
      regleRefus('Cibles_fonction_overrides'),
    ],
  },
  {
    tableId: 'Preferences_tableau_bord',
    optionnelle: true,
    description: 'Préférences du tableau de bord — chaque académie lit et modifie sa propre ligne',
    rules: [
      regleOwner(),
      regleNational(),
      { label: 'Académie : sa propre ligne', formula: 'user.Profil.id and rec.Academie == user.Profil.Academie', perms: '+RU-CD' },
      regleRefus('Preferences_tableau_bord'),
    ],
  },
  {
    tableId: 'Objectifs_previsionnels',
    optionnelle: true,
    description: 'Objectifs prévisionnels — chaque académie gère les siens, suppression par le national',
    rules: [
      regleOwner(),
      regleNational(),
      { label: 'Académie : ses propres lignes', formula: 'user.Profil.id and rec.Academie == user.Profil.Academie', perms: '+CRU-D' },
      regleRefus('Objectifs_previsionnels'),
    ],
  },
];

// Règle du document entier (ressource « * ») : filet de sécurité pour toute table sans règle
// propre, et réserve la modification de la structure (tables, colonnes, formules) aux propriétaires.
const REGLES_DOCUMENT = [
  { label: 'Tout compte non propriétaire', formula: 'user.Access != OWNER', perms: '-CRUDS',
    memo: 'Accès refusé (règles FPGC) : seuls les propriétaires ont accès aux tables sans règle propre et à la structure du document.' },
];

// Règles proposées pour les tables du document absentes de la référence ci-dessus.
const MODELES_TABLES_ANNEXES = {
  national: {
    libelle: 'Propriétaires et national uniquement',
    rules: (t) => [regleOwner(), regleNational(), regleRefus(t)],
  },
  lecture: {
    libelle: 'Lecture pour tout le personnel, modification par le national',
    rules: (t) => [regleOwner(), regleNational(), { label: 'Personnel répertorié (lecture)', formula: C.profil, perms: '+R-CUD' }, regleRefus(t)],
  },
};

const NOTE_CORRECTIONS = [
  "Décisions du 09/11/2026 : le personnel académique ne voit l'annuaire que pour son académie d'affectation ; un compte rattaché à l'académie « National » a la vue nationale (colonne pont Utilisateurs.Est_national) ; dans Parametres_widget, les académies ne modifient que la configuration des formulaires (formulaireConfig, satisfactionConfig).",
  "Lien d'enquête : le widget de gestion produit « SatisfactionUUID_ », les règles du v17 attendaient « Satisfaction_UUID_ » : la page d'enquête ne pouvait rien lire. Les règles suivent désormais le nom réellement produit.",
  "Reference, Parametres_widget, Modules_de_formation : plus lisibles avec le seul lien public. Lecture réservée au personnel et aux visiteurs dont la clé correspond à un stage ou un stagiaire existant (attribut StageRecrutement ajouté pour vérifier la clé de recrutement).",
  "Anonymat : un visiteur non connecté a pour adresse « anon@getgrist.com », jamais une adresse vide — « user.Email is None » ne le reconnaît donc pas. Les règles utilisent la présence d'une clé de lien (ou « Tous les autres »).",
  "« not user.Profil » n'est jamais vrai : un User Attribute introuvable est un enregistrement vide, pas None. Les règles testent « user.Profil.id ». Même correction pour « user.StageSatisfaction is not None », qui était toujours vrai.",
  "Les règles Grist s'appliquent aussi aux propriétaires : chaque table commence par une règle explicite « Propriétaires ».",
  "Chaque table se termine par « Tous les autres → refus » : sans cela, Grist donne par défaut un accès Éditeur complet, y compris au visiteur arrivé par le lien public.",
  "BD_Stages2 : l'accès « tout Éditeur » (règle 2 du §18) est retiré — le visiteur du lien public est lui-même Éditeur et aurait obtenu tous les stages et leurs clés. Le §23 (prévisualisation d'un lien par un compte connecté) est intégré.",
  "Planning, Intervenants, Émargement : les règles « stagiaire » passent avant les règles « personnel », sinon le refus « pas de Profil » les rendait inatteignables.",
  "Candidats_du_stage : la restriction de colonnes du §24 est posée comme règle de colonnes (le seul mécanisme Grist qui le permet), recalculée sur les colonnes réelles de la table. Le national retrouve son accès (absent du §18).",
  "Satisfaction_modules : colonne pont Academie_du_stage ajoutée pour que le personnel académique puisse lire les résultats de son académie (le widget de gestion charge cette table).",
];

// ---------------------------------------------------------------------------------------
// État
// ---------------------------------------------------------------------------------------

const state = {
  loading: true,
  isOwner: false,
  schema: null,        // { tables: Map(tableId → { ref, cols: Map(colId → {type, isFormula, formula}) }) }
  acl: null,           // { resources: [], rules: [] }
  params: null,        // lignes de Parametres_widget
  annexes: {},         // tableId → 'national' | 'lecture'
  checks: [],
  plan: null,
  lastError: null,
};

// ---------------------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------------------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function toRows(data) {
  const cols = Object.keys(data).filter((k) => k !== 'id');
  return (data.id || []).map((id, i) => {
    const row = { id };
    cols.forEach((c) => { row[c] = data[c][i]; });
    return row;
  });
}

async function fetchRows(tableId) {
  return toRows(await grist.docApi.fetchTable(tableId));
}

function flash(msg, kind = 'info') {
  const el = document.getElementById('flash');
  el.hidden = !msg;
  el.className = 'flash' + (kind === 'error' ? ' error' : kind === 'ok' ? ' ok' : '');
  el.textContent = msg || '';
}

const BITS = ['C', 'R', 'U', 'D', 'S'];
const ALIAS_PERMS = { all: '+CRUDS', none: '-CRUDS' };

// Forme canonique d'un texte de permissions, en ne gardant que les bits pertinents
// pour le type de ressource (S n'existe qu'au niveau document, C/D pas sur des colonnes).
function canonPerms(text, bitsDispo = BITS) {
  const t = ALIAS_PERMS[text] || text || '';
  const val = {};
  let mode = '';
  for (const ch of t) {
    if (ch === '+') mode = '+';
    else if (ch === '-') mode = '-';
    else if (BITS.includes(ch) && mode) val[ch] = mode;
  }
  const plus = bitsDispo.filter((b) => val[b] === '+').join('');
  const moins = bitsDispo.filter((b) => val[b] === '-').join('');
  return (plus ? '+' + plus : '') + (moins ? '-' + moins : '');
}

function bitsPour(colIds, tableId) {
  if (tableId === '*') return BITS;
  return colIds === '*' ? ['C', 'R', 'U', 'D'] : ['R', 'U'];
}

function normFormula(f) { return String(f || '').replace(/\s+/g, ' ').trim(); }

function permBadges(perms, bitsDispo) {
  const c = canonPerms(perms, bitsDispo);
  const val = {};
  let mode = '';
  for (const ch of c) { if (ch === '+' || ch === '-') mode = ch; else val[ch] = mode; }
  const noms = { C: 'Créer', R: 'Lire', U: 'Modifier', D: 'Supprimer', S: 'Structure' };
  return bitsDispo.map((b) => {
    const v = val[b];
    const cls = v === '+' ? 'perm-allow' : v === '-' ? 'perm-deny' : 'perm-none';
    const sym = v === '+' ? '✓' : v === '-' ? '✗' : '·';
    return `<span class="perm ${cls}" title="${noms[b]} : ${v === '+' ? 'autorisé' : v === '-' ? 'refusé' : 'non décidé ici'}">${b} ${sym}</span>`;
  }).join('');
}

// Colonnes référencées par une condition (rec.X / newRec.X).
function colonnesReferencees(formula) {
  const out = new Set();
  const re = /\b(?:rec|newRec)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(formula || ''))) { if (m[1] !== 'id') out.add(m[1]); }
  return [...out];
}

// Attributs utilisateurs référencés (user.Profil.X → { attr: 'Profil', col: 'X' }).
function attributsReferences(formula) {
  const out = [];
  const re = /\buser\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(formula || ''))) { if (m[1] !== 'LinkKey') out.push({ attr: m[1], col: m[2] }); }
  return out;
}

// ---------------------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------------------

async function chargerSchema() {
  const tables = await fetchRows('_grist_Tables');
  const cols = await fetchRows('_grist_Tables_column');
  const byRef = new Map();
  const map = new Map();
  for (const t of tables) {
    if (!t.tableId || t.tableId.startsWith('_grist')) continue;
    if (t.summarySourceTable) continue; // tables de synthèse : couvertes par leur table source
    const entry = { ref: t.id, cols: new Map() };
    map.set(t.tableId, entry);
    byRef.set(t.id, entry);
  }
  for (const c of cols) {
    const entry = byRef.get(c.parentId);
    if (!entry || !c.colId) continue;
    if (c.colId === 'manualSort' || c.colId.startsWith('gristHelper_')) continue;
    entry.cols.set(c.colId, { id: c.id, type: c.type, isFormula: !!c.isFormula, formula: c.formula || '' });
  }
  return { tables: map };
}

async function chargerAcl() {
  const resources = await fetchRows('_grist_ACLResources');
  const rules = await fetchRows('_grist_ACLRules');
  return { resources, rules };
}

async function chargerParams() {
  try { return await fetchRows('Parametres_widget'); } catch (e) { return null; }
}

function paramValeur(cle) {
  const row = (state.params || []).find((r) => r.Cle === cle);
  return row ? row.Valeur : null;
}

async function chargerTout() {
  state.loading = true;
  state.lastError = null;
  render();
  try {
    state.acl = await chargerAcl();
    // Grist n'envoie le contenu des tables de règles qu'aux propriétaires ; la ligne n°1 de
    // _grist_ACLResources existe dans tout document, elle est donc un bon témoin.
    state.isOwner = state.acl.resources.length > 0;
    state.schema = await chargerSchema();
    state.params = await chargerParams();
    try { state.annexes = JSON.parse(paramValeur(PARAM_TABLES_ANNEXES) || '{}') || {}; } catch (e) { state.annexes = {}; }
    if (state.isOwner) {
      state.checks = await verifierPrerequis();
      state.plan = construirePlan();
    }
  } catch (err) {
    console.error(err);
    state.lastError = err;
  }
  state.loading = false;
  render();
}

// ---------------------------------------------------------------------------------------
// Vérifications préalables
// ---------------------------------------------------------------------------------------

function tablesGerees() {
  return TABLES_REFERENCE.filter((t) => state.schema.tables.has(t.tableId));
}

function tablesAnnexes() {
  const gerees = new Set(TABLES_REFERENCE.map((t) => t.tableId));
  return [...state.schema.tables.keys()].filter((t) => !gerees.has(t)).sort();
}

async function verifierPrerequis() {
  const checks = [];
  const S = state.schema.tables;
  const add = (niveau, titre, detail) => checks.push({ niveau, titre, detail });

  // 1. Tables
  const manquantes = TABLES_REFERENCE.filter((t) => !t.optionnelle && !S.has(t.tableId)).map((t) => t.tableId);
  if (manquantes.length) add('ko', 'Tables manquantes', `Introuvables dans ce document : ${manquantes.join(', ')}.`);
  else add('ok', 'Toutes les tables attendues sont présentes', '');
  const optAbs = TABLES_REFERENCE.filter((t) => t.optionnelle && !S.has(t.tableId)).map((t) => t.tableId);
  if (optAbs.length) add('info', 'Tables facultatives absentes (ignorées)', optAbs.join(', '));

  // 2. Colonnes pont
  const pontsManquants = [];
  const pontsAType = [];
  const pontsDifferents = [];
  for (const p of COLONNES_PONT) {
    const t = S.get(p.table);
    if (!t) continue;
    const col = t.cols.get(p.col);
    if (!col) { pontsManquants.push(p); continue; }
    if (normFormula(col.formula) !== normFormula(p.formula) || !col.isFormula) pontsDifferents.push({ p, col });
    else if (col.type !== p.type) pontsAType.push({ p, col });
  }
  if (pontsManquants.length || pontsAType.length) {
    add('warn', 'Colonnes pont à créer ou à corriger (fait automatiquement à l\'application)',
      [...pontsManquants.map((p) => `${p.table}.${p.col} — absente (formule ${p.formula})`),
        ...pontsAType.map(({ p, col }) => `${p.table}.${p.col} — type ${col.type}, attendu ${p.type}`)].join('\n'));
  } else {
    add('ok', 'Colonnes pont présentes', '');
  }
  if (pontsDifferents.length) {
    add('warn', 'Colonnes pont avec une formule différente (non modifiées automatiquement)',
      pontsDifferents.map(({ p, col }) => `${p.table}.${p.col} : « ${col.formula || '(valeur saisie, pas une formule)'} » au lieu de « ${p.formula} »`).join('\n'));
  }
  state.pontsACreer = pontsManquants;
  state.pontsATyper = pontsAType;

  // 3. Types des colonnes académie
  for (const r of COLONNES_REF_ACADEMIE) {
    const t = S.get(r.table);
    if (!t) continue;
    const col = t.cols.get(r.col);
    if (!col) { if (!r.optionnelle) add('ko', `Colonne ${r.table}.${r.col} absente`, ''); continue; }
    if (col.type !== 'Ref:Reference') {
      add('ko', `${r.table}.${r.col} n'est pas une Référence vers Reference`,
        `Type actuel : ${col.type}. Les règles comparent des identifiants de la table Reference : ` +
        'convertissez cette colonne en « Référence → Reference » dans Grist avant d\'appliquer.');
    }
  }

  // 4. Colonnes citées par les règles, User Attributes
  const absentes = [];
  for (const t of tablesGerees()) {
    const cols = S.get(t.tableId).cols;
    const formules = ([...t.rules, ...(t.columnRules || []).flatMap((cr) => cr.rules)]).map((r) => r.formula);
    for (const f of formules) {
      for (const c of colonnesReferencees(f)) {
        const prevue = COLONNES_PONT.some((p) => p.table === t.tableId && p.col === c);
        if (!cols.has(c) && !prevue) absentes.push(`${t.tableId}.${c}`);
      }
    }
  }
  const uaAbsentes = [];
  for (const ua of USER_ATTRIBUTES) {
    const t = S.get(ua.tableId);
    if (!t) { uaAbsentes.push(`${ua.name} : table ${ua.tableId} absente`); continue; }
    if (!t.cols.has(ua.lookupColId)) uaAbsentes.push(`${ua.name} : colonne ${ua.tableId}.${ua.lookupColId} absente`);
  }
  // Colonnes lues sur les User Attributes (user.Profil.Role, user.Stagiaire.Sous_groupe…)
  const toutesFormules = ([...TABLES_REFERENCE.flatMap((t) => [...t.rules, ...(t.columnRules || []).flatMap((cr) => cr.rules)]), ...REGLES_DOCUMENT])
    .map((r) => r.formula);
  for (const f of toutesFormules) {
    for (const { attr, col } of attributsReferences(f)) {
      if (col === 'id') continue;
      const ua = USER_ATTRIBUTES.find((u) => u.name === attr);
      const t = ua && S.get(ua.tableId);
      const prevue = COLONNES_PONT.some((p) => p.table === ua.tableId && p.col === col);
      if (t && !t.cols.has(col) && !prevue) uaAbsentes.push(`user.${attr}.${col} : colonne ${ua.tableId}.${col} absente`);
    }
  }
  if (absentes.length || uaAbsentes.length) {
    add('ko', 'Colonnes utilisées par les règles mais absentes du document', [...new Set([...absentes, ...uaAbsentes])].join('\n'));
  } else {
    add('ok', 'Toutes les colonnes utilisées par les règles existent', '');
  }

  // 5. Comptes répertoriés, vue nationale
  if (S.has(TABLE_UTILISATEURS)) {
    try {
      const users = await fetchRows(TABLE_UTILISATEURS);
      // Vue nationale : comptes rattachés à l'académie « National » de la table Reference.
      let idsNationaux = new Set();
      try {
        const refs = await fetchRows('Reference');
        idsNationaux = new Set(refs.filter((r) => String(r.Academie || '').trim().toLowerCase() === ACADEMIE_NATIONALE.toLowerCase()).map((r) => r.id));
      } catch (e) { /* Reference illisible : déjà signalé ailleurs */ }
      if (!idsNationaux.size) {
        add('warn', `Aucune ligne « ${ACADEMIE_NATIONALE} » dans la table Reference`,
          `La vue nationale repose sur cette ligne : ajoutez-la (colonne Academie = « ${ACADEMIE_NATIONALE} ») avant d'appliquer.`);
      }
      const nat = users.filter((u) => u.Email && idsNationaux.has(u.Academie));
      if (!nat.length) {
        add('warn', `Aucun compte rattaché à l'académie « ${ACADEMIE_NATIONALE} » dans ${TABLE_UTILISATEURS}`,
          "Les propriétaires gardent l'accès, mais personne d'autre n'aura la vue nationale.");
      } else {
        add('ok', `${users.length} compte(s) répertorié(s), dont ${nat.length} national(aux)`, '');
      }
      const sansAcademie = users.filter((u) => u.Email && !u.Academie);
      if (sansAcademie.length) {
        add('warn', `${sansAcademie.length} compte(s) sans académie`,
          `Ces comptes ne verront aucun stage : ${sansAcademie.map((u) => u.Email).join(', ')}.`);
      }
    } catch (e) { /* lecture impossible : déjà signalé ailleurs */ }
  }

  // 6. Paramètres des liens générés
  for (const l of COLONNES_LIENS) {
    const t = S.get(l.table);
    if (!t || !t.cols.has(l.col)) continue;
    let rows = [];
    try { rows = await fetchRows(l.table); } catch (e) { continue; }
    const urls = rows.map((r) => r[l.col]).filter((u) => typeof u === 'string' && u.includes('?'));
    if (!urls.length) continue;
    const params = new Set();
    for (const u of urls) {
      try { for (const k of new URL(u).searchParams.keys()) if (k.endsWith('_')) params.add(k); } catch (e) { /* lien mal formé */ }
    }
    const attendu = `${l.cle}_`;
    if (params.has(attendu) && params.size === 1) {
      add('ok', `${l.libelle} : paramètre « ${attendu} » conforme`, `${urls.length} lien(s) vérifié(s).`);
    } else {
      add('ko', `${l.libelle} : paramètre de lien inattendu`,
        `Les règles attendent « ${attendu} » ; les liens existants utilisent : ${[...params].join(', ') || 'aucun paramètre de clé'}. ` +
        'Corrigez CLES_LIEN en tête de gestion-acces.js, ou régénérez les liens.');
    }
  }

  return checks;
}

function prerequisBloquants() {
  // Les colonnes pont manquantes (niveau « warn ») ne bloquent pas : elles sont créées dans le même geste.
  return state.checks.filter((c) => c.niveau === 'ko');
}

// ---------------------------------------------------------------------------------------
// Construction de la configuration cible et du plan d'application
// ---------------------------------------------------------------------------------------

function colonnesDe(tableId) {
  const t = state.schema.tables.get(tableId);
  const cols = t ? [...t.cols.keys()] : [];
  // Les colonnes pont qui vont être créées font partie de la table cible.
  for (const p of COLONNES_PONT) if (p.table === tableId && !cols.includes(p.col)) cols.push(p.col);
  return cols.sort();
}

// Liste ordonnée des ressources cibles : [{ tableId, colIds, rules: [...] }]
function configurationCible() {
  const cible = [];
  cible.push({ tableId: '*', colIds: '*', rules: REGLES_DOCUMENT, libelle: 'Document entier (filet de sécurité)' });
  for (const t of tablesGerees()) {
    cible.push({ tableId: t.tableId, colIds: '*', rules: (t.rules), libelle: t.tableId, description: t.description });
    for (const cr of t.columnRules || []) {
      const cols = cr.colIds(colonnesDe(t.tableId));
      if (cols.length) cible.push({ tableId: t.tableId, colIds: cols.join(','), rules: (cr.rules), libelle: `${t.tableId} — colonnes`, description: cr.description });
    }
  }
  for (const tableId of tablesAnnexes()) {
    const modele = MODELES_TABLES_ANNEXES[state.annexes[tableId]] || MODELES_TABLES_ANNEXES.national;
    cible.push({ tableId, colIds: '*', rules: (modele.rules(tableId)), libelle: tableId, description: `Table annexe — ${modele.libelle}`, annexe: true });
  }
  return cible;
}

function signatureRegles(rules, tableId, colIds) {
  const bits = bitsPour(colIds, tableId);
  return JSON.stringify(rules.map((r) => [normFormula(r.formula), canonPerms(r.perms, bits)]));
}

function signatureUA(ua) {
  return JSON.stringify([ua.name, ua.tableId, ua.charId, ua.lookupColId]);
}

function construirePlan() {
  const { resources, rules } = state.acl;
  const resById = new Map(resources.map((r) => [r.id, r]));
  const cible = configurationCible();
  const cleRes = (tableId, colIds) => `${tableId}|${colIds}`;

  // Règles actuelles groupées par ressource (hors User Attributes), dans l'ordre de rulePos.
  const tri = [...rules].sort((a, b) => (a.rulePos || 0) - (b.rulePos || 0));
  const actuelles = new Map();
  const uaActuels = [];
  for (const r of tri) {
    if (r.userAttributes) {
      try { uaActuels.push({ ...JSON.parse(r.userAttributes), _id: r.id }); } catch (e) { uaActuels.push({ name: '?', _id: r.id }); }
      continue;
    }
    const res = resById.get(r.resource);
    if (!res || !res.tableId) continue; // ancienne ressource n°1, ignorée par Grist
    const k = cleRes(res.tableId, res.colIds);
    if (!actuelles.has(k)) actuelles.set(k, { res, rules: [] });
    actuelles.get(k).rules.push(r);
  }

  const tablesCible = new Set(cible.map((c) => c.tableId));
  const comparaisons = [];
  for (const c of cible) {
    const k = cleRes(c.tableId, c.colIds);
    const act = actuelles.get(k);
    const actRegles = act ? act.rules.map((r) => ({ formula: r.aclFormula, perms: r.permissionsText, memo: r.memo })) : [];
    const identique = act && signatureRegles(actRegles, c.tableId, c.colIds) === signatureRegles(c.rules, c.tableId, c.colIds);
    comparaisons.push({ ...c, actuelles: actRegles, statut: identique ? 'ok' : act ? 'diff' : 'nouveau' });
  }
  // Ressources actuelles sur une table gérée mais absentes de la cible (ex. anciennes règles de colonnes).
  const clesCible = new Set(cible.map((c) => cleRes(c.tableId, c.colIds)));
  const aRetirer = [];
  const nonGerees = [];
  for (const [k, v] of actuelles) {
    if (clesCible.has(k)) continue;
    if (tablesCible.has(v.res.tableId)) aRetirer.push({ tableId: v.res.tableId, colIds: v.res.colIds, actuelles: v.rules });
    else nonGerees.push({ tableId: v.res.tableId, colIds: v.res.colIds, nb: v.rules.length });
  }

  // User Attributes
  const uaCibleSig = new Set(USER_ATTRIBUTES.map(signatureUA));
  const uaActSig = new Set(uaActuels.map(signatureUA));
  const uaIdentiques = uaCibleSig.size === uaActSig.size && [...uaCibleSig].every((s) => uaActSig.has(s));

  const aJour = uaIdentiques && aRetirer.length === 0 && comparaisons.every((c) => c.statut === 'ok')
    && !(state.pontsACreer || []).length && !(state.pontsATyper || []).length;

  return { cible, comparaisons, aRetirer, nonGerees, uaActuels, uaIdentiques, aJour, actuelles };
}

// Actions utilisateur Grist pour passer de l'état actuel à la configuration cible.
function actionsApplication() {
  const { resources, rules } = state.acl;
  const plan = state.plan;
  const resById = new Map(resources.map((r) => [r.id, r]));
  const tablesCible = new Set(plan.cible.map((c) => c.tableId));
  const actions = [];

  // 0. Colonnes pont (même lot : si les règles sont refusées, les colonnes ne sont pas créées non plus).
  for (const p of state.pontsACreer || []) {
    actions.push(['AddColumn', p.table, p.col, { type: p.type, isFormula: true, formula: p.formula }]);
  }
  for (const { p } of state.pontsATyper || []) {
    actions.push(['ModifyColumn', p.table, p.col, { type: p.type }]);
  }

  // 1. Sauvegarde : envoyée dans un lot séparé, AVANT celui-ci (voir ouvrirConfirmation) —
  //    Grist contrôle les écritures de données d'un lot avec les règles encore en vigueur,
  //    qui peuvent justement bloquer Parametres_widget (acl-academies §21).
  const sauvegarde = [
    ...actionsParametre(PARAM_SAUVEGARDE, JSON.stringify(instantane())),
    ...actionsParametre(PARAM_TABLES_ANNEXES, JSON.stringify(state.annexes)),
  ];

  // 2. Retrait : toutes les règles des ressources gérées (tables cibles + document entier),
  //    et tous les User Attributes (remplacés par ceux de référence).
  const resGerees = resources.filter((r) => r.tableId && tablesCible.has(r.tableId));
  const idsResGerees = new Set(resGerees.map((r) => r.id));
  const reglesARetirer = rules.filter((r) => idsResGerees.has(r.resource) || r.userAttributes).map((r) => r.id);
  if (reglesARetirer.length) actions.push(['BulkRemoveRecord', '_grist_ACLRules', reglesARetirer]);

  // On garde la ressource « * » existante (elle porte les User Attributes) ; les autres
  // ressources des tables gérées sont supprimées puis recréées.
  const resDoc = resources.find((r) => r.tableId === '*' && r.colIds === '*');
  const resASupprimer = resGerees.filter((r) => r !== resDoc).map((r) => r.id);
  if (resASupprimer.length) actions.push(['BulkRemoveRecord', '_grist_ACLResources', resASupprimer]);

  // 3. Ajout des ressources (identifiants négatifs = provisoires, résolus par Grist dans le lot).
  const idRes = new Map();
  const nouvellesRes = [];
  let neg = -1;
  if (resDoc) idRes.set('*|*', resDoc.id);
  for (const c of plan.cible) {
    const k = `${c.tableId}|${c.colIds}`;
    if (idRes.has(k)) continue;
    idRes.set(k, neg);
    nouvellesRes.push({ id: neg, tableId: c.tableId, colIds: c.colIds });
    neg -= 1;
  }
  if (nouvellesRes.length) {
    actions.push(['BulkAddRecord', '_grist_ACLResources', nouvellesRes.map((r) => r.id), {
      tableId: nouvellesRes.map((r) => r.tableId),
      colIds: nouvellesRes.map((r) => r.colIds),
    }]);
  }

  // 4. Ajout des règles, positionnées après toutes les règles conservées.
  const conservees = rules.filter((r) => !reglesARetirer.includes(r.id));
  let pos = Math.max(0, ...conservees.map((r) => Number(r.rulePos) || 0).filter((n) => Number.isFinite(n))) + 1;
  const lignes = [];
  for (const ua of USER_ATTRIBUTES) {
    lignes.push({ resource: idRes.get('*|*'), aclFormula: '', permissionsText: '', rulePos: pos++, memo: '',
      userAttributes: JSON.stringify({ name: ua.name, tableId: ua.tableId, lookupColId: ua.lookupColId, charId: ua.charId }) });
  }
  for (const c of plan.cible) {
    for (const r of c.rules) {
      lignes.push({ resource: idRes.get(`${c.tableId}|${c.colIds}`), aclFormula: r.formula, permissionsText: r.perms,
        rulePos: pos++, memo: r.memo || '', userAttributes: '' });
    }
  }
  actions.push(['BulkAddRecord', '_grist_ACLRules', lignes.map((_, i) => -(i + 1)), {
    resource: lignes.map((l) => l.resource),
    aclFormula: lignes.map((l) => l.aclFormula),
    permissionsText: lignes.map((l) => l.permissionsText),
    rulePos: lignes.map((l) => l.rulePos),
    memo: lignes.map((l) => l.memo),
    userAttributes: lignes.map((l) => l.userAttributes),
  }]);

  return { sauvegarde, actions, stats: { reglesRetirees: reglesARetirer.length, reglesAjoutees: lignes.length, ponts: (state.pontsACreer || []).length } };
}

function actionsParametre(cle, valeur) {
  if (!state.params) return []; // Parametres_widget absente : pas de sauvegarde possible
  const row = state.params.find((r) => r.Cle === cle);
  return row ? [['UpdateRecord', 'Parametres_widget', row.id, { Valeur: valeur }]]
    : [['AddRecord', 'Parametres_widget', null, { Cle: cle, Valeur: valeur }]];
}

// Copie restaurable de toutes les règles actuelles (hors ressource/règle n°1, propres à Grist).
function instantane() {
  const { resources, rules } = state.acl;
  return {
    date: new Date().toISOString(),
    resources: resources.filter((r) => r.tableId).map((r) => ({ id: r.id, tableId: r.tableId, colIds: r.colIds })),
    rules: rules.filter((r) => r.resource !== 1 || r.userAttributes)
      .filter((r) => resources.some((res) => res.id === r.resource && res.tableId))
      .map((r) => ({ resource: r.resource, aclFormula: r.aclFormula || '', permissionsText: r.permissionsText || '',
        rulePos: r.rulePos, memo: r.memo || '', userAttributes: r.userAttributes || '' })),
  };
}

function actionsRestauration(sauvegarde) {
  const { resources, rules } = state.acl;
  const actions = [];
  const resASupprimer = resources.filter((r) => r.tableId).map((r) => r.id);
  const reglesASupprimer = rules.filter((r) => resASupprimer.includes(r.resource)).map((r) => r.id);
  if (reglesASupprimer.length) actions.push(['BulkRemoveRecord', '_grist_ACLRules', reglesASupprimer]);
  if (resASupprimer.length) actions.push(['BulkRemoveRecord', '_grist_ACLResources', resASupprimer]);
  const map = new Map();
  sauvegarde.resources.forEach((r, i) => map.set(r.id, -(i + 1)));
  if (sauvegarde.resources.length) {
    actions.push(['BulkAddRecord', '_grist_ACLResources', sauvegarde.resources.map((r) => map.get(r.id)), {
      tableId: sauvegarde.resources.map((r) => r.tableId), colIds: sauvegarde.resources.map((r) => r.colIds),
    }]);
  }
  const rs = sauvegarde.rules.filter((r) => map.has(r.resource));
  if (rs.length) {
    actions.push(['BulkAddRecord', '_grist_ACLRules', rs.map((_, i) => -(i + 1)), {
      resource: rs.map((r) => map.get(r.resource)),
      aclFormula: rs.map((r) => r.aclFormula),
      permissionsText: rs.map((r) => r.permissionsText),
      rulePos: rs.map((r) => r.rulePos),
      memo: rs.map((r) => r.memo),
      userAttributes: rs.map((r) => r.userAttributes),
    }]);
  }
  return actions;
}

// ---------------------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------------------

function render() {
  const main = document.getElementById('main');
  const sub = document.getElementById('topbarSub');
  if (state.loading) { sub.textContent = 'Lecture des règles du document…'; main.innerHTML = '<p class="muted">Chargement…</p>'; return; }
  if (state.lastError) {
    sub.textContent = 'Erreur de lecture';
    main.innerHTML = `<div class="card"><h2>Impossible de lire le document</h2><p class="card-sub">${esc(state.lastError.message || state.lastError)}</p>
      <p class="muted">Vérifiez que ce widget est configuré avec l'accès « Accès complet au document ».</p></div>`;
    return;
  }
  if (!state.isOwner) {
    sub.textContent = 'Réservé aux propriétaires';
    main.innerHTML = `<div class="card"><h2>Page réservée aux propriétaires du document</h2>
      <p class="card-sub">Grist ne communique les règles d'accès qu'aux propriétaires (rôle Owner), et seuls eux peuvent les modifier.</p></div>`;
    return;
  }
  const plan = state.plan;
  const bloquants = prerequisBloquants();
  const nbDiff = plan.comparaisons.filter((c) => c.statut !== 'ok').length + plan.aRetirer.length + (plan.uaIdentiques ? 0 : 1);
  sub.textContent = plan.aJour ? 'Les règles du document sont conformes à la configuration de référence'
    : `${nbDiff} écart(s) avec la configuration de référence`;

  main.innerHTML = `
    ${renderStatut(plan, bloquants)}
    ${renderChecks()}
    ${renderTables(plan)}
    ${renderAnnexes()}
    ${renderCorrections()}
    ${renderSauvegarde()}
  `;
  bind();
}

function renderStatut(plan, bloquants) {
  const badge = plan.aJour ? '<span class="badge badge-ok">Conforme</span>'
    : bloquants.length ? '<span class="badge badge-ko">Prérequis manquants</span>'
      : '<span class="badge badge-warn">À appliquer</span>';
  return `<div class="card">
    <h2>Configuration des accès ${badge}</h2>
    <p class="card-sub">Ce bouton remplace les règles d'accès de toutes les tables du document par la configuration de référence FPGC
      (${plan.cible.length} ensembles de règles, ${USER_ATTRIBUTES.length} attributs utilisateur), crée les colonnes pont manquantes,
      et sauvegarde d'abord les règles actuelles. Grist vérifie l'ensemble avant de l'enregistrer : en cas d'erreur, rien n'est modifié.</p>
    ${bloquants.length ? `<p class="note note-warn">Corrigez d'abord les points marqués ✗ ci-dessous.</p>` : ''}
    <div class="row-actions">
      <button type="button" class="btn btn-primary" id="btnAppliquer" ${plan.aJour || bloquants.length ? 'disabled' : ''}>Appliquer la configuration de référence</button>
      <button type="button" class="btn btn-secondary" id="btnExporter">Copier la configuration de référence</button>
      <button type="button" class="btn btn-secondary" id="btnExporterActuel">Copier les règles actuelles</button>
    </div>
  </div>`;
}

function renderChecks() {
  const icon = { ok: '✓', ko: '✗', warn: '!', info: 'i' };
  const cls = { ok: 'ok-c', ko: 'ko-c', warn: 'warn-c', info: 'muted' };
  return `<div class="card"><h2>Vérifications préalables</h2>
    <p class="card-sub">Ce que les règles supposent du document.</p>
    <ul class="checks">${state.checks.map((c) => `<li class="${c.niveau === 'ko' ? 'ko' : c.niveau === 'warn' ? 'warn' : ''}">
      <span class="check-icon ${cls[c.niveau]}">${icon[c.niveau]}</span>
      <div><div>${esc(c.titre)}</div>${c.detail ? `<div class="check-detail">${esc(c.detail).replace(/\n/g, '<br>')}</div>` : ''}</div></li>`).join('')}
    </ul></div>`;
}

function renderRegles(rules, tableId, colIds, avecLibelle) {
  const bits = bitsPour(colIds, tableId);
  if (!rules.length) return '<p class="muted">Aucune règle.</p>';
  return `<div class="scroll"><table class="rules"><thead><tr><th>#</th><th>Condition</th><th>Droits</th></tr></thead><tbody>
    ${rules.map((r, i) => `<tr><td>${i + 1}</td><td>${avecLibelle && r.label ? `<span class="rule-label">${esc(r.label)}</span>` : ''}
      <code class="rule-formula">${r.formula ? esc(r.formula) : '<em>(tous les autres)</em>'}</code></td>
      <td style="white-space:nowrap">${permBadges(r.perms, bits)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function renderTables(plan) {
  const statutBadge = { ok: '<span class="badge badge-ok">À jour</span>', diff: '<span class="badge badge-warn">Différente</span>', nouveau: '<span class="badge badge-info">À créer</span>' };
  const ua = `<details class="table-card"><summary><div><div class="table-name">Attributs utilisateur</div>
      <div class="table-desc">Profil, Stagiaire, StageSatisfaction</div></div>${plan.uaIdentiques ? statutBadge.ok : statutBadge.diff}</summary>
    <div class="table-body"><div class="rules-title">Référence</div>
      <div class="scroll"><table class="rules"><thead><tr><th>Nom</th><th>Recherche</th><th>Rôle</th></tr></thead><tbody>
      ${USER_ATTRIBUTES.map((u) => `<tr><td><code>user.${esc(u.name)}</code></td><td><code>user.${esc(u.charId)}</code> → <code>${esc(u.tableId)}.${esc(u.lookupColId)}</code></td><td>${esc(u.libelle)}</td></tr>`).join('')}
      </tbody></table></div>
      ${plan.uaIdentiques ? '' : `<div class="rules-title">Actuellement</div>
        ${plan.uaActuels.length ? `<ul>${plan.uaActuels.map((u) => `<li><code>user.${esc(u.name)}</code> → <code>${esc(u.tableId)}.${esc(u.lookupColId)}</code> (clé <code>user.${esc(u.charId)}</code>)</li>`).join('')}</ul>` : '<p class="muted">Aucun.</p>'}`}
    </div></details>`;
  const cartes = plan.comparaisons.map((c) => `<details class="table-card"><summary>
      <div><div class="table-name">${esc(c.libelle)}${c.colIds !== '*' ? '' : ''}</div><div class="table-desc">${esc(c.description || '')}</div></div>
      ${statutBadge[c.statut]}</summary>
    <div class="table-body">
      ${c.colIds !== '*' && c.tableId !== '*' ? `<p class="table-desc">Colonnes : <code>${esc(c.colIds.split(',').join(', '))}</code></p>` : ''}
      <div class="rules-title">Référence</div>${renderRegles(c.rules, c.tableId, c.colIds, true)}
      ${c.statut === 'ok' ? '' : `<div class="rules-title">Actuellement</div>${renderRegles(c.actuelles, c.tableId, c.colIds, false)}`}
    </div></details>`).join('');
  const retraits = plan.aRetirer.length ? `<p class="note note-warn">Règles de colonnes actuelles qui seront retirées :
      ${plan.aRetirer.map((r) => `<code>${esc(r.tableId)} [${esc(r.colIds)}]</code>`).join(', ')}</p>` : '';
  return `<div class="card"><h2>Comparaison table par table</h2>
    <p class="card-sub">Ouvrez une table pour voir les règles de référence et, en cas d'écart, celles actuellement en place.
      ✓ autorisé, ✗ refusé, · décidé par une règle suivante.</p>
    ${ua}${cartes}${retraits}</div>`;
}

function renderAnnexes() {
  const annexes = tablesAnnexes();
  if (!annexes.length) return '';
  return `<div class="card"><h2>Autres tables du document</h2>
    <p class="card-sub">Tables absentes de la configuration de référence. Elles reçoivent malgré tout des règles, pour ne pas rester ouvertes
      au visiteur du lien public. Choisissez le niveau d'accès de chacune.</p>
    ${annexes.map((t) => `<div class="annexe-row"><code>${esc(t)}</code>
      <select data-annexe="${esc(t)}">${Object.entries(MODELES_TABLES_ANNEXES).map(([k, m]) =>
        `<option value="${k}" ${(state.annexes[t] || 'national') === k ? 'selected' : ''}>${esc(m.libelle)}</option>`).join('')}</select></div>`).join('')}
  </div>`;
}

function renderCorrections() {
  return `<div class="card"><details><summary class="rules-title" style="cursor:pointer">Écarts volontaires avec acl-academies.md (${NOTE_CORRECTIONS.length})</summary>
    <ul>${NOTE_CORRECTIONS.map((n) => `<li style="margin-bottom:6px">${esc(n)}</li>`).join('')}</ul></details></div>`;
}

function renderSauvegarde() {
  const brut = paramValeur(PARAM_SAUVEGARDE);
  let s = null;
  try { s = brut ? JSON.parse(brut) : null; } catch (e) { s = null; }
  return `<div class="card"><h2>Sauvegarde</h2>
    ${state.params ? '' : '<p class="note note-warn">Table Parametres_widget absente : aucune sauvegarde ne sera conservée.</p>'}
    ${s ? `<p class="card-sub">Règles en place avant la dernière application : ${s.rules.length} règle(s), enregistrées le
        ${esc(new Date(s.date).toLocaleString('fr-FR'))}.</p>
      <div class="row-actions"><button type="button" class="btn btn-danger" id="btnRestaurer">Restaurer ces règles</button></div>`
    : '<p class="card-sub">Aucune sauvegarde pour l\'instant : elle est créée automatiquement à la première application.</p>'}
  </div>`;
}

// ---------------------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------------------

function bind() {
  const b = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  b('btnAppliquer', ouvrirConfirmation);
  b('btnExporter', exporter);
  b('btnExporterActuel', () => copier(JSON.stringify(instantane(), null, 2), 'Règles actuelles copiées dans le presse-papiers.'));
  b('btnRestaurer', ouvrirRestauration);
  document.querySelectorAll('select[data-annexe]').forEach((sel) => sel.addEventListener('change', () => {
    state.annexes[sel.dataset.annexe] = sel.value;
    state.plan = construirePlan();
    render();
  }));
}

function modal(html, onConfirm, libelleConfirm, classeConfirm = 'btn-primary') {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}
    <div class="modal-actions"><button type="button" class="btn" data-x="annuler">Annuler</button>
    <button type="button" class="btn ${classeConfirm}" data-x="ok">${esc(libelleConfirm)}</button></div></div>`;
  document.body.appendChild(wrap);
  const fermer = () => wrap.remove();
  wrap.querySelector('[data-x="annuler"]').addEventListener('click', fermer);
  wrap.querySelector('[data-x="ok"]').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'Application…';
    try { await onConfirm(); } finally { fermer(); }
  });
  wrap.querySelector('[data-x="ok"]').focus();
}

function ouvrirConfirmation() {
  const { sauvegarde, actions, stats } = actionsApplication();
  const touchees = state.plan.comparaisons.filter((c) => c.statut !== 'ok').map((c) => c.libelle);
  modal(`<h2>Appliquer la configuration de référence ?</h2>
    <div class="summary-counts">
      <span class="badge badge-warn">${stats.reglesRetirees} règle(s) retirée(s)</span>
      <span class="badge badge-info">${stats.reglesAjoutees} règle(s) posée(s)</span>
      ${stats.ponts ? `<span class="badge badge-info">${stats.ponts} colonne(s) pont créée(s)</span>` : ''}
    </div>
    <p>Ensembles de règles modifiés : ${touchees.length ? esc([...new Set(touchees)].join(', ')) : 'attributs utilisateur uniquement'}.</p>
    <p class="muted">${sauvegarde.length ? 'Les règles actuelles sont d\'abord sauvegardées dans Parametres_widget, restaurables depuis cette page.'
      : 'Parametres_widget est absente : aucune sauvegarde automatique. Utilisez « Copier les règles actuelles » avant d\'appliquer.'}
      Testez ensuite les pages publiques en navigation privée.</p>`, async () => {
    if (sauvegarde.length) {
      try {
        await grist.docApi.applyUserActions(sauvegarde, { desc: 'FPGC — sauvegarde des règles d\'accès' });
      } catch (err) {
        console.error(err);
        flash("La sauvegarde des règles actuelles a échoué : rien n'a été modifié.\n" +
          'Copiez les règles actuelles (bouton dédié) puis réessayez, ou donnez aux propriétaires l\'accès à Parametres_widget.\n' +
          (err.message || err), 'error');
        return;
      }
    }
    try {
      await grist.docApi.applyUserActions(actions, { desc: 'FPGC — configuration de référence des accès' });
      await chargerTout();
      flash(state.plan && state.plan.aJour ? 'Configuration appliquée. Les règles du document sont conformes.'
        : "Configuration appliquée, mais des écarts subsistent — voir le détail ci-dessous.", state.plan && state.plan.aJour ? 'ok' : 'error');
    } catch (err) {
      console.error(err);
      flash(`Grist a refusé la modification — aucune règle n'a changé.\n${err.message || err}`, 'error');
    }
  }, 'Appliquer');
}

function ouvrirRestauration() {
  let s;
  try { s = JSON.parse(paramValeur(PARAM_SAUVEGARDE)); } catch (e) { flash('Sauvegarde illisible.', 'error'); return; }
  modal(`<h2>Restaurer les règles sauvegardées ?</h2>
    <p>Les règles actuelles seront entièrement remplacées par les ${s.rules.length} règle(s) en place le
      ${esc(new Date(s.date).toLocaleString('fr-FR'))}. Les colonnes pont éventuellement créées sont conservées.</p>`, async () => {
    try {
      await grist.docApi.applyUserActions(actionsRestauration(s), { desc: 'FPGC — restauration des règles d\'accès' });
      await chargerTout();
      flash('Règles restaurées.', 'ok');
    } catch (err) {
      console.error(err);
      flash(`Grist a refusé la restauration — aucune règle n'a changé.\n${err.message || err}`, 'error');
    }
  }, 'Restaurer', 'btn-danger');
}

async function exporter() {
  const json = JSON.stringify({
    userAttributes: USER_ATTRIBUTES.map(({ libelle, ...u }) => u),
    ressources: state.plan.cible.map((c) => ({ table: c.tableId, colonnes: c.colIds, regles: c.rules.map((r) => ({ condition: r.formula, droits: r.perms, libelle: r.label })) })),
  }, null, 2);
  await copier(json, 'Configuration de référence copiée dans le presse-papiers.');
}

async function copier(texte, message) {
  try {
    await navigator.clipboard.writeText(texte);
    flash(message, 'ok');
  } catch (e) {
    console.log(texte);
    flash('Copie impossible depuis ce navigateur : le contenu a été écrit dans la console du navigateur.', 'error');
  }
}

document.getElementById('btnRefresh').addEventListener('click', () => { flash(''); chargerTout(); });

chargerTout();
