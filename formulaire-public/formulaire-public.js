/* ============================================================================
   Formulaire public de recrutement FPGC — widget Grist séparé, destiné à être
   visité par un candidat anonyme (pas de session Grist authentifiée).

   ARCHITECTURE — lire avant de modifier :
   - Ce widget ne partage AUCUN état avec gestion-stage-fpgc.js si ce n'est via
     de vraies tables Grist (voir Parametres_widget, déjà en place). Il ne lit
     jamais grist.setOption/onOptions : ce stockage est propre à CHAQUE section
     de widget dans le document, donc invisible depuis un widget différent
     (voir la note équivalente dans gestion-stage-fpgc.js au-dessus de
     QUESTIONS_RECRUTEMENT).
   - Ce widget ne charge QUE les tables dont il a réellement besoin en LECTURE
     (Reference, BD_Stages2, Parametres_widget) — surtout pas Annuaire_FPGC
     (données de milliers d'agents, sans rapport avec un candidat anonyme) ni
     les autres tables internes. `Candidats_du_stage` n'est volontairement
     PAS lue : voir la note ci-dessous sur `Candidats_actifs_count`.

   **29e échange — un widget par étape, pas un widget unique multi-mode.**
   Une conception à un seul fichier partagé par les trois étapes du processus
   (recrutement / espace pédagogique / satisfaction), distinguées par un
   paramètre `?mode=` sur l'URL du widget lui-même, a été envisagée puis
   abandonnée à la demande de l'utilisateur : elle n'apportait pas de réelle
   simplification opérationnelle (il fallait de toute façon créer trois pages
   Grist distinctes, une par étape) et introduisait un réglage supplémentaire
   facile à oublier lors du déploiement d'une page. Retenu à la place : un
   fichier autonome par étape, cohérent avec la convention déjà en place dans
   ce projet (`gestion-stage-fpgc.js` et ce fichier dupliquent déjà
   volontairement `QUESTIONS_RECRUTEMENT` plutôt que de partager un import).
   Les deux autres étapes vivent dans `espace-stagiaire.html`/`.js` (planning
   + émargement, clé personnelle) et `enquete-satisfaction.html`/`.js`
   (enquête anonyme, clé de stage distincte) — voir `processus-gestion-stage.md`
   et `acl-academies.md` §16 pour l'architecture ACL commune aux trois
   fichiers (inchangée par ce découpage : mêmes clés Link Key, mêmes User
   Attributes `Stagiaire`/`StageSatisfaction`).

   **Repérage du stage — réécrit au 22e échange, ne fait PLUS de détection
   d'URL côté client.** Les versions précédentes tentaient de lire un
   paramètre `stage=`/`key=` depuis l'URL du widget ou document.referrer, ou
   demandaient au candidat de coller son lien. Cette approche a été abandonnée
   après qu'un test réel a révélé DEUX failles successives, pas une seule :
     1. (21e échange, déjà corrigée) Le calcul de la liste d'attente lisait
        `Candidats_du_stage` en entier — la seule façon de rendre ce widget
        fonctionnel était alors d'accorder à l'anonyme une Lecture large sur
        cette table, exposant les données personnelles de TOUS les candidats
        de TOUS les stages. Corrigé en ajoutant `BD_Stages2.Candidats_actifs_count`
        (champ formule) pour que ce widget n'ait plus jamais besoin de lire
        `Candidats_du_stage` (Création seule y suffit désormais).
     2. (22e échange, corrigée ici) Une fois (1) réglé, ce widget avait encore
        besoin d'une Lecture anonyme sur `BD_Stages2` pour retrouver « son »
        stage à partir de la référence passée dans l'URL — et valider la clé
        lui-même, côté client, en comparant `p.key` à `stage.Formulaire_UUID`.
        Or une Lecture anonyme large sur BD_Stages2 expose, de fait, la
        colonne `Formulaire_UUID` de TOUS les stages à quiconque détient un
        seul lien valide : cette colonne est justement la clé secrète censée
        distinguer un stage d'un autre. La comparaison client-side ne protège
        RIEN si l'attaquant peut lire toutes les clés directement.

   La correction retenue pour (2) : ne plus valider la clé côté client DU
   TOUT, et laisser Grist lui-même ne renvoyer QUE la ligne autorisée. Le lien
   distribué porte désormais un paramètre `UUID_` (suffixe underscore =
   convention Grist « Link Key », voir acl-academies.md §13/§15) sur l'URL de
   la PAGE Grist elle-même (pas sur l'URL de ce widget) :
   `https://.../p/7?UUID_=<uuid>`. Une règle ACL de Lecture sur BD_Stages2
   compare alors `rec.UUID` à `user.LinkKey.UUID` : un visiteur anonyme qui
   appelle `fetchTable('BD_Stages2')` ne reçoit QUE la ligne dont la clé
   correspond à la sienne (zéro ligne si son lien est invalide/absent) —
   jamais les autres lignes, jamais les autres clés. **24e échange** : la
   colonne elle-même a été renommée par l'utilisateur directement dans Grist,
   de `Formulaire_UUID` à `UUID` — ce fichier lit donc `stage.UUID` (voir
   `resolveStage`/le gestionnaire d'envoi plus bas). Ce widget se contente
   donc de charger `BD_Stages2` sans condition (`resolveStage`, plus bas) et
   de regarder ce qui lui a été effectivement renvoyé : 1 ligne → c'est son
   stage ; 0 ligne → lien invalide/expiré, message générique (on ne cherche
   PAS à distinguer « clé fausse » de « aucune clé » de « stage inconnu »,
   pour ne rien révéler à un visiteur qui tâtonnerait). Il n'y a donc plus
   d'écran « coller le lien » : il n'y a plus rien qu'un candidat puisse
   coller qui changerait quoi que ce soit, la décision se prend entièrement
   côté serveur Grist au moment du chargement de la page. **25e échange** :
   ce fichier n'écrit plus non plus de copie de cette clé sur
   `Candidats_du_stage` (une colonne `Formulaire_UUID` y avait été envisagée
   comme défense en profondeur pour la Création, mais n'existe pas sur le
   document réel — voir le gestionnaire d'envoi plus bas).

   **29e échange** : à l'envoi, ce widget génère en plus une clé PERSONNELLE
   (`UUID_personnel`) et l'affiche à l'écran sous forme de lien — c'est ce
   lien qui donnera accès à `espace-stagiaire.html` une fois la candidature
   validée. Décision explicite de l'utilisateur : pas d'envoi automatique par
   courriel à ce stade ; le candidat doit le conserver lui-même, et à défaut
   le personnel peut le retrouver dans `Candidats_du_stage.Lien_personnel`.
   ========================================================================== */

grist.ready({ requiredAccess: 'full' });

/* ---------------------------------------------------------------------- */
/* Liste de questions — copie exacte de QUESTIONS_RECRUTEMENT dans          */
/* gestion-stage-fpgc.js. Les deux listes doivent être modifiées ensemble : */
/* c'est un choix délibéré (pas d'import partagé, chaque widget est un      */
/* fichier autonome livré séparément à Grist) — voir modele-de-donnees.md.  */
/* ---------------------------------------------------------------------- */

const QUESTIONS_RECRUTEMENT = [
  { id: 'academie', categorie: 'Identité professionnelle', libelle: "Académie d'affectation", type: 'Choix', optionsSource: 'academies', colonneCible: 'Academie_d_affectation', obligatoireParDefaut: true, ordre: 10 },
  // 45e échange : deux colonnes cibles distinctes (nom autocomplete + UAI lecture seule), à la place
  // de l'ancienne colonne combinée `UAI_ou_etablissement_d_affectation` (conservée sur le document,
  // non supprimée, mais plus jamais écrite par ce formulaire depuis ce tour).
  { id: 'etablissement', categorie: 'Identité professionnelle', libelle: "Établissement d'affectation", type: 'EtablissementUAI', colonneCibleNom: 'Nom_etablissement_d_affectation', colonneCibleUai: 'UAI_etablissement_d_affectation', obligatoireParDefaut: true, ordre: 20 },
  // 46e échange : copie exacte de la même entrée dans gestion-stage-fpgc.js (voir la note complète
  // là-bas) — nouvelle question « Fonction » à liste fixe.
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

  { id: 'transport', categorie: 'Logistique du séjour', libelle: 'Mode de transport', type: 'Choix', optionsChoix: 'Train;Voiture personnelle;Covoiturage;Avion;Autre', colonneCible: 'Mode_transport', obligatoireParDefaut: false, ordre: 80 },
  { id: 'transport_gare', categorie: 'Logistique du séjour', libelle: "Gare d'arrivée", type: 'Texte', colonneCible: 'Gare_arrivee', obligatoireParDefaut: false, ordre: 81, dependsOn: { question: 'transport', equals: 'Train' } },
  { id: 'transport_vehicule', categorie: 'Logistique du séjour', libelle: 'Véhicule — marque, modèle, couleur', type: 'Texte', colonneCible: 'Vehicule_marque_modele_couleur', obligatoireParDefaut: false, ordre: 82, dependsOn: { question: 'transport', equals: 'Voiture personnelle' } },
  { id: 'transport_immat', categorie: 'Logistique du séjour', libelle: 'Immatriculation du véhicule', type: 'Texte', colonneCible: 'Vehicule_immatriculation', obligatoireParDefaut: false, ordre: 83, dependsOn: { question: 'transport', equals: 'Voiture personnelle' } },
  { id: 'date_heure_arrivee', categorie: 'Logistique du séjour', libelle: "Date et heure d'arrivée prévues", type: 'DateHeure', colonneCible: 'Date_heure_arrivee', obligatoireParDefaut: false, ordre: 90 },
  { id: 'date_heure_depart', categorie: 'Logistique du séjour', libelle: 'Date et heure de départ prévues', type: 'DateHeure', colonneCible: 'Date_heure_depart', obligatoireParDefaut: false, ordre: 91 },
  { id: 'hebergement', categorie: 'Logistique du séjour', libelle: "Besoin d'un hébergement sur place", type: 'Case à cocher', colonneCible: 'Besoin_hebergement', obligatoireParDefaut: false, ordre: 100 },
  { id: 'regime', categorie: 'Logistique du séjour', libelle: 'Régime alimentaire particulier / allergies', type: 'Texte', colonneCible: 'Regime_alimentaire', obligatoireParDefaut: false, ordre: 110 },

  { id: 'droit_image', categorie: 'Droits', libelle: "Droit à l'image", type: 'Choix', optionsChoix: 'Accepte;Refuse', colonneCible: 'Droit_a_limage', obligatoireParDefaut: true, ordre: 120 },

  { id: 'taille_haut', categorie: 'Habillement', libelle: 'Taille du haut (treillis)', type: 'Texte', colonneCible: 'Taille_haut_treillis', obligatoireParDefaut: true, ordre: 130 },
  { id: 'taille_pantalon', categorie: 'Habillement', libelle: 'Taille du pantalon (treillis)', type: 'Texte', colonneCible: 'Taille_pantalon_treillis', obligatoireParDefaut: true, ordre: 140 },

  { id: 'decharge', categorie: 'Décharge de responsabilité', libelle: 'Décharge de responsabilité à lire, signer et apporter le jour du stage', type: 'Lien', colonneCible: null, urlOption: true, obligatoireParDefaut: false, ordre: 150 },
];

const CATEGORIES_QUESTIONS_RECRUTEMENT = [...new Set(QUESTIONS_RECRUTEMENT.map((q) => q.categorie))];

/* ---------------------------------------------------------------------- */
/* Autocomplétion établissement — 42e échange. Même API que la carte du     */
/* widget pilotage-academique.js (Annuaire de l'éducation nationale, via    */
/* tabular-api.data.gouv.fr, CORS vérifié par lecture du code source du     */
/* dépôt datagouv/api-tabular) mais interrogée ici par un filtre texte      */
/* "contient" (`Nom_etablissement__contains`) plutôt que par une liste de   */
/* codes UAI connus — dupliquée plutôt que partagée, comme QUESTIONS_       */
/* RECRUTEMENT ci-dessus (chaque widget public reste un fichier autonome).  */
/* Repli délibéré : tant qu'aucune suggestion n'est sélectionnée, le champ   */
/* garde le texte tel que tapé (comportement historique « UAI ou nom »),     */
/* pour ne jamais bloquer une candidature si l'établissement est introuvable */
/* dans l'annuaire (établissement privé non répertorié, faute de frappe,     */
/* recherche indisponible) — seule la carte de pilotage perd le bénéfice de  */
/* la géolocalisation dans ce cas, déjà documenté dans README-livraison.md.  */
/* ---------------------------------------------------------------------- */

const ETAB_SEARCH_URL = 'https://tabular-api.data.gouv.fr/api/resources/b22f04bf-64a8-495d-b8bb-d84dbc4c7983/data/';
const ETAB_SEARCH_MIN_CHARS = 3;
const ETAB_SEARCH_DEBOUNCE_MS = 300;
const ETAB_SEARCH_PAGE_SIZE = 15;

async function searchEtablissements(query) {
  const url = ETAB_SEARCH_URL + '?Nom_etablissement__contains=' + encodeURIComponent(query) + '&page_size=' + ETAB_SEARCH_PAGE_SIZE;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return (json.data || [])
    .filter((rec) => typeof rec.Identifiant_de_l_etablissement === 'string' && rec.Identifiant_de_l_etablissement)
    .map((rec) => ({
      uai: rec.Identifiant_de_l_etablissement,
      nom: rec.Nom_etablissement || '',
      commune: rec.Nom_commune || '',
      etat: rec.etat || '',
    }));
}

/* ---------------------------------------------------------------------- */
/* Couche de données Grist — sous-ensemble minimal de tables               */
/* ---------------------------------------------------------------------- */

const TABLES = ['Reference', 'BD_Stages2', 'Parametres_widget'];
const DB = {};

async function loadTable(tableId) {
  let data;
  try {
    data = await grist.docApi.fetchTable(tableId);
  } catch (err) {
    // Grist ne nomme pas la table en cause dans son message d'erreur (ex. "Blocked by table read
    // access rules" est identique quelle que soit la table bloquée) — Promise.all ci-dessous ne le
    // ferait pas non plus (il ne garde que la première erreur, sans dire de laquelle des TABLES elle
    // vient). On préfixe donc nous-mêmes le nom de la table ici, seul endroit qui le connaît encore
    // au moment de l'échec, pour que le message affiché à l'écran (voir boot()) permette de savoir
    // laquelle des règles ACL (Reference / BD_Stages2 / Parametres_widget) regarder en premier.
    const detail = (err && (err.message || String(err))) || 'erreur inconnue';
    throw new Error('table ' + tableId + ' : ' + detail);
  }
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
  // Promise.allSettled plutôt que Promise.all : si plusieurs tables sont bloquées à la fois, on
  // veut TOUTES les signaler dans le message affiché, pas seulement la première à échouer.
  const results = await Promise.allSettled(TABLES.map(loadTable));
  const echecs = results.filter((r) => r.status === 'rejected').map((r) => r.reason && r.reason.message);
  if (echecs.length) throw new Error(echecs.join(' | '));
}

function T(tableId) { return (DB[tableId] && DB[tableId].rows) || []; }

/* ---------------------------------------------------------------------- */
/* Parametres_widget — mêmes helpers que gestion-stage-fpgc.js (voir la     */
/* note en tête de fichier) : formulaireConfig (masquées/optionnelles par   */
/* stage), dechargeUrl, et depuis le 29e échange baseUrlEspaceStagiaire     */
/* (URL de base de la page Grist `espace-stagiaire.html`, pour construire   */
/* le lien personnel affiché après l'envoi de la candidature).              */
/* ---------------------------------------------------------------------- */

function paramWidgetRaw(cle) {
  const row = T('Parametres_widget').find((r) => r.Cle === cle);
  return row ? row.Valeur : '';
}

let formulaireConfig = {};
let dechargeUrl = '';
let baseUrlEspaceStagiaire = '';
// 35e échange — voir la même note dans gestion-stage-fpgc.js (state.options) : une URL de base
// commune au document + un numéro de page par widget public, plutôt que 3 URLs complètes collées à
// la main. baseUrlEspaceStagiaire ci-dessus reste un repli pour un document configuré à l'ancienne.
let baseUrlDocument = '';
let pageIdEspaceStagiaire = '';
// 61e échange — même principe, pour la page statique donnees-personnelles.html (mention
// d'information RGPD complète), liée depuis le pied de page et depuis la mention courte affichée
// au-dessus du bouton d'envoi (voir renderFormulaire/updateFooterLienDonnees ci-dessous).
let pageIdDonneesPersonnelles = '';
// 62e échange, tour suivant — pour le lien "Voir les candidats" du panneau staff (renderStaff), qui
// ouvre gestion-stage-fpgc.js directement sur le bon stage. Voir consumeDeepLinkStage() dans
// gestion-stage-fpgc.js pour le mécanisme de transmission (localStorage, pas l'URL — voir sa note).
let pageIdGestionStage = '';

function loadParametresWidgetIntoState() {
  try { formulaireConfig = JSON.parse(paramWidgetRaw('formulaireConfig') || '{}'); } catch (err) { formulaireConfig = {}; }
  dechargeUrl = safeUrl(paramWidgetRaw('dechargeUrl') || '');
  baseUrlEspaceStagiaire = safeUrl(paramWidgetRaw('baseUrlEspaceStagiaire') || '');
  baseUrlDocument = paramWidgetRaw('baseUrlDocument') || '';
  pageIdEspaceStagiaire = paramWidgetRaw('pageIdEspaceStagiaire') || '';
  pageIdDonneesPersonnelles = paramWidgetRaw('pageIdDonneesPersonnelles') || '';
  pageIdGestionStage = paramWidgetRaw('pageIdGestionStage') || '';
  updateFooterLienDonnees();
}

function pageUrlGestionStage() {
  const doc = baseUrlDocument.trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const id = pageIdGestionStage.trim();
  return (doc && id) ? safeUrl(`${doc}/p/${id}`) : '';
}

// 62e échange, tour suivant — voir la note complète (raisons du choix de localStorage plutôt que
// l'URL) dans consumeDeepLinkStage(), gestion-stage-fpgc.js. Cette clé DOIT être strictement
// identique dans les trois fichiers qui la lisent/écrivent (formulaire-public.js,
// enquete-satisfaction.js, gestion-stage-fpgc.js) — pas d'import partagé possible (voir la note
// d'architecture en tête de fichier), donc à modifier ensemble si jamais renommée.
const DEEP_LINK_STORAGE_KEY = 'fpgc:ouvrirStage';

function ecrireDeepLinkStage(stageId, tab) {
  try {
    localStorage.setItem(DEEP_LINK_STORAGE_KEY, JSON.stringify({ stageId, tab, ts: Date.now() }));
  } catch (err) { /* stockage indisponible (navigation privée, etc.) — le lien ouvre quand même la
    page de gestion normalement, juste sans navigation automatique vers le bon stage */ }
}

// 61e échange — voir la note équivalente (et plus détaillée) dans gestion-stage-fpgc.js. Peuple le
// lien « Données personnelles » du pied de page (hors de #main, voir formulaire-public.html : jamais
// effacé par render()) ; désactivé avec une info-bulle tant que pageIdDonneesPersonnelles n'est pas
// renseigné dans Parametres_widget.
function updateFooterLienDonnees() {
  // Défensif (62e échange, tour suivant) : simple confort d'affichage, jamais sur le chemin critique
  // du chargement — un incident ici ne doit jamais interrompre loadParametresWidgetIntoState()/
  // resolveStage()/boot(). Voir processus-gestion-stage.md, 62e échange, tour suivant.
  try {
    const el = document.getElementById('footerLienDonnees');
    if (!el) return;
    const url = pageUrlDonneesPersonnelles();
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
      el.title = 'Page non encore configurée';
    }
  } catch (err) {
    console.error('[Formulaire public FPGC] mise à jour du lien "Données personnelles" du pied de page a échoué (sans incidence sur le formulaire)', err);
  }
}

// Même construction que pageUrlEspaceStagiaire() ci-dessous, sans URL complète de repli : ce réglage
// est entièrement nouveau (voir la note sur pageIdDonneesPersonnelles ci-dessus).
function pageUrlDonneesPersonnelles() {
  const doc = baseUrlDocument.trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const id = pageIdDonneesPersonnelles.trim();
  return (doc && id) ? safeUrl(`${doc}/p/${id}`) : '';
}

// 40e échange, tour suivant — même correctif que pageUrlFor dans gestion-stage-fpgc.js/
// espace-stagiaire.js (voir le commentaire détaillé dans gestion-stage-fpgc.js) : baseUrlDocument
// peut porter un `?...` de fin (lien de partage Grist copié avec ses paramètres de suivi), qui sans
// ce nettoyage absorbe `/p/<id>` dans sa propre valeur de paramètre au lieu d'un vrai segment de
// chemin — Grist retombe alors sur sa page par défaut plutôt que d'afficher espace-stagiaire. Voir
// processus-gestion-stage.md (40e échange, tour suivant).
function pageUrlEspaceStagiaire() {
  const doc = baseUrlDocument.trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const id = pageIdEspaceStagiaire.trim();
  if (doc && id) return safeUrl(`${doc}/p/${id}`);
  return baseUrlEspaceStagiaire; // déjà passé par safeUrl() au chargement (loadParametresWidgetIntoState)
}

function formulaireConfigForStage(stageId) {
  const cfg = formulaireConfig[stageId] || {};
  return { masquees: cfg.masquees || [], optionnelles: cfg.optionnelles || [], jamaisConfigure: !formulaireConfig[stageId] };
}

// Construit le lien personnel vers espace-stagiaire.html — même principe de paramètre « Link Key »
// (suffixe underscore) que le lien de stage existant, voir buildRecrutementLink dans
// gestion-stage-fpgc.js. `CandidatUUID_` alimente user.LinkKey.CandidatUUID, utilisé par le User
// Attribute `Stagiaire` (voir acl-academies.md §16).
// 45e échange (tour suivant, x2) : `style=singlePage` masque le bandeau/menu/panneau natifs de
// Grist SANS casser la lecture de la clé Link Key par l'ACL, à condition d'être placé AVANT le
// paramètre Link Key dans la chaîne de requête — confirmé par un test réel de l'utilisateur sur le
// document de production (l'ordre inverse casse la résolution). Voir le commentaire équivalent au-
// dessus de buildLinkKeyUrl dans gestion-stage-fpgc.js pour le détail complet ; dupliqué ici plutôt
// que partagé par un import, comme le reste de ce fichier.
function buildLienPersonnel(baseUrl, uuidPersonnel) {
  if (!baseUrl || !uuidPersonnel) return '';
  const sep = baseUrl.includes('?') ? '&' : '?';
  const params = new URLSearchParams();
  params.set('CandidatUUID_', uuidPersonnel);
  return baseUrl.trim() + sep + 'style=singlePage&' + params.toString();
}

// UUID v4 — même mécanisme que generateUUID() dans gestion-stage-fpgc.js (dupliqué ici pour la même
// raison que QUESTIONS_RECRUTEMENT : chaque widget est un fichier autonome).
function generateUUID() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ---------------------------------------------------------------------- */
/* Utilitaires                                                             */
/* ---------------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s === null || s === undefined || s === false ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// FPGC-04 (audit sécurité) : allow-list de protocoles — rejette silencieusement toute URL dont le
// schéma n'est pas http: ou https: (ex. javascript:…) pour éviter l'injection XSS via href. Appliqué
// dans chaque fonction pageUrl*() et au chargement de dechargeUrl/baseUrlEspaceStagiaire depuis
// Parametres_widget : un seul point de contrôle par URL protège tous les sites d'utilisation en aval.
function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? url : '';
  } catch (e) {
    return '';
  }
}

function toEpoch(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d, 12, 0, 0) / 1000);
}

// Un <input type="datetime-local"> ne porte pas de fuseau horaire ; on choisit d'interpréter la
// valeur saisie comme une heure locale à Paris (public visé : personnels affectés en France), puis
// on la convertit en epoch UTC pour la colonne Grist DateTime:Europe/Paris. Calcul en deux temps
// (estimation UTC puis correction par le décalage réel de Paris à cette date, hiver/été) plutôt
// qu'un décalage fixe, pour rester correct des deux côtés du changement d'heure.
function parisOffsetMinutesAt(epochSec) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = dtf.formatToParts(new Date(epochSec * 1000));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) / 1000;
  return (asUTC - epochSec) / 60;
}

function parisLocalToEpoch(dtLocal) {
  if (!dtLocal) return null;
  const [datePart, timePart] = dtLocal.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = (timePart || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0) / 1000;
  return Math.round(guess - parisOffsetMinutesAt(guess) * 60);
}

function academieRows() { return T('Reference').filter((r) => r.Academie); }

/* ---------------------------------------------------------------------- */
/* Résolution du stage — voir la note d'architecture en tête de fichier :  */
/* c'est l'ACL (Lecture BD_Stages2 filtrée par Link Key), pas ce code, qui */
/* décide de quelle(s) ligne(s) ce widget reçoit.                          */
/* ---------------------------------------------------------------------- */

const state = {
  phase: 'chargement', // 'chargement' | 'erreur_chargement' | 'invalide' | 'clos' | 'formulaire' | 'envoye'
  stage: null,
  erreurChargement: '',
  lienPersonnel: '', // affiché sur l'écran de confirmation, voir bindFormulaire
  // 40e échange, tour suivant — clé brute (pas l'URL déjà assemblée) conservée à part, pour pouvoir
  // reconstruire un vrai <form target="_top"> sur l'écran de confirmation (même mécanisme que
  // renderReconnexion() dans espace-stagiaire.js) plutôt qu'un lien texte à copier/coller — voir
  // renderEnvoye()/bindEnvoye() plus bas et processus-gestion-stage.md.
  uuidPersonnel: '',
  // 41e échange — lignes BD_Stages2 reçues quand ce widget est ouvert par un compte académique/
  // national plutôt que via un lien candidat (voir resolveStage()/renderStaff() plus bas).
  stagesStaff: [],
};

// Résout le libellé d'académie d'un stage pour l'affichage du panneau « staff » (renderStaff()),
// sans jamais planter selon l'état de conversion réel de `BD_Stages2.Academie_de_formation` sur le
// document (voir modele-de-donnees.md : colonne encore Texte libre sur certains documents, Référence
// sur d'autres selon que la conversion documentée a été appliquée) : un nombre est traité comme un
// identifiant de ligne de `Reference` à résoudre, une chaîne est affichée telle quelle.
function academieLabelForStage(stage) {
  const val = stage.Academie_de_formation;
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const ref = T('Reference').find((r) => r.id === val);
    return ref ? (ref.Academie || '') : '';
  }
  return String(val);
}

function resolveStage() {
  const rows = T('BD_Stages2');
  // 0 ligne : lien invalide/expiré/absent — message volontairement générique, voir la note
  // d'architecture (ne pas distinguer les causes). Couvre aussi, en résidu accepté, le cas rare d'un
  // compte académique/national dont le périmètre ACL ne contient actuellement aucun stage : ce
  // widget n'a alors aucun moyen de distinguer ce cas d'un lien réellement invalide (voir la note
  // sur la règle >1 ligne ci-dessous, qui ne peut rien dire sur une table vide).
  if (rows.length === 0) { state.phase = 'invalide'; return; }
  // >1 ligne : IMPOSSIBLE pour un visiteur anonyme muni d'une clé Link Key valide, celle-ci étant
  // unique par stage (règle ACL scopée ligne par ligne, acl-academies.md §18) — ce n'est donc jamais
  // un lien candidat mal formé. C'est en revanche exactement ce que reçoit un compte académique ou
  // national qui ouvre cette page directement, sans lien personnel : les règles 4/5 du même tableau
  // ACL lui donnent une Lecture bien plus large sur BD_Stages2 (toute son académie, ou tous les
  // stages pour National). 41e échange — signalé par l'utilisateur (« la page qui s'affiche est une
  // page "lien invalide" ») : ce cas n'est plus traité comme invalide, mais dirigé vers un panneau
  // dédié (renderStaff()) listant les liens de recrutement plutôt que le formulaire de candidature,
  // qui n'a jamais de sens pour ce profil d'utilisateur. Voir processus-gestion-stage.md pour le
  // détail, et acl-academies.md §17 pour le même symptôme déjà rencontré et corrigé une fois, mais
  // seulement pour les comptes OWNER/EDITOR — cette page complète cet angle mort côté interface,
  // sans se substituer au correctif ACL recommandé côté document (qui reste à appliquer séparément).
  if (rows.length > 1) { state.phase = 'staff'; state.stagesStaff = rows; return; }
  const stage = rows[0];
  if (stage.Statut_du_stage === 'Annulé' || stage.Statut_du_stage === 'Clôturé') { state.phase = 'clos'; state.stage = stage; return; }
  state.stage = stage;
  state.phase = 'formulaire';
}

/* ---------------------------------------------------------------------- */
/* Rendu                                                                  */
/* ---------------------------------------------------------------------- */

function fieldInputHtml(q) {
  switch (q.type) {
    case 'Texte':
      return `<input type="text" data-q-id="${q.id}">`;
    case 'EtablissementUAI':
      // 45e échange : deux champs distincts, tous deux lus directement par bindFormulaire (traitement
      // spécifique à ce type de question, ni l'un ni l'autre ne porte data-q-id). Le champ de recherche
      // reste modifiable librement (autocomplétion, repli texte libre) ; le champ UAI est en lecture
      // seule — jamais saisissable à la main, rempli uniquement par bindEtablissementAutocomplete()
      // au moment où une suggestion est cliquée (décision explicite de l'utilisateur, 45e échange).
      return `
        <div class="etab-autocomplete">
          <input type="text" data-etab-search="${q.id}" autocomplete="off" placeholder="Tapez le nom de l'établissement…">
          <div class="etab-suggestions" data-etab-suggestions="${q.id}" hidden></div>
          <p class="field-help etab-status" data-etab-status="${q.id}"></p>
          <label class="etab-uai-label" for="etab-uai-${q.id}">Code UAI</label>
          <input type="text" data-etab-uai="${q.id}" id="etab-uai-${q.id}" class="etab-uai-input" readonly tabindex="-1" placeholder="Rempli automatiquement après sélection">
        </div>`;
    case 'Date':
      return `<input type="date" data-q-id="${q.id}">`;
    case 'DateHeure':
      return `<input type="datetime-local" data-q-id="${q.id}">`;
    case 'Case à cocher':
      return `<label class="row-inline" style="font-weight:400;text-transform:none;letter-spacing:0;"><input type="checkbox" data-q-id="${q.id}" style="width:auto;"> Oui</label>`;
    case 'Choix': {
      let options = [];
      if (q.optionsSource === 'academies') options = academieRows().map((r) => r.Academie);
      else if (q.optionsChoix) options = q.optionsChoix.split(';');
      const opts = ['<option value="">— Choisir —</option>', ...options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)].join('');
      return `<select data-q-id="${q.id}">${opts}</select>`;
    }
    default:
      return '';
  }
}

// 61e échange — mention courte affichée directement sur le formulaire (art. 13 RGPD : information
// dès la collecte), distincte de la mention complète (donnees-personnelles.html, liée depuis ici et
// depuis le pied de page) — voir la discussion avec l'utilisateur dans processus-gestion-stage.md.
function mentionCourteRgpdHtml() {
  const url = pageUrlDonneesPersonnelles();
  const lien = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">notre mention d'information</a>`
    : `notre mention d'information (voir « Données personnelles » en pied de page)`;
  return `<p class="field-help" style="margin-top:14px;">Les informations recueillies dans ce formulaire sont utilisées pour organiser votre participation au stage et son suivi administratif. Elles sont conservées pour la durée nécessaire à ce suivi, puis supprimées ou archivées selon les règles applicables. Pour en savoir plus sur les données collectées et pour exercer vos droits, consultez ${lien}.</p>`;
}

function renderFormulaire(stage) {
  const cfg = formulaireConfigForStage(stage.id);
  const masqueeSet = new Set(cfg.masquees);
  const optionnelleSet = new Set(cfg.optionnelles);

  const sectionsHtml = CATEGORIES_QUESTIONS_RECRUTEMENT.map((cat) => {
    const qs = QUESTIONS_RECRUTEMENT.filter((q) => q.categorie === cat && !masqueeSet.has(q.id)).sort((a, b) => a.ordre - b.ordre);
    if (!qs.length) return '';
    const rows = qs.map((q) => {
      if (q.type === 'Lien') {
        if (!dechargeUrl) return '';
        return `<div class="field" data-q-wrap="${q.id}"><a href="${escapeHtml(dechargeUrl)}" target="_blank" rel="noopener">${escapeHtml(q.libelle)}</a></div>`;
      }
      const optionnelle = cfg.jamaisConfigure ? !q.obligatoireParDefaut : optionnelleSet.has(q.id);
      const hiddenAttr = q.dependsOn ? ' style="display:none;"' : '';
      const dependAttr = q.dependsOn ? ` data-depends-on="${q.dependsOn.question}" data-depends-equals="${escapeHtml(q.dependsOn.equals)}"` : '';
      return `
        <div class="field" data-q-wrap="${q.id}"${hiddenAttr}${dependAttr}>
          <label>${escapeHtml(q.libelle)}${optionnelle ? '' : ' *'}</label>
          ${fieldInputHtml(q)}
        </div>`;
    }).join('');
    return `<p class="section-sub" style="margin-top:16px;"><strong>${escapeHtml(cat)}</strong></p>${rows}`;
  }).join('');

  return `
    <div class="card">
      <h2 style="margin:0 0 4px;">${escapeHtml(stage.Intitule || 'Formulaire de candidature')}</h2>
      <p class="section-sub">Référence du stage : <span class="mono">${escapeHtml(stage.Reference_de_stage || '')}</span></p>
      <p class="field-help">Les champs marqués d'un * sont obligatoires.</p>
      <div class="field"><label>Nom *</label><input type="text" id="pf-nom"></div>
      <div class="field"><label>Prénom *</label><input type="text" id="pf-prenom"></div>
      <div class="field"><label>Adresse mél *</label><input type="email" id="pf-mel"></div>
      ${sectionsHtml}
      ${mentionCourteRgpdHtml()}
      <p class="status-note" id="pf-status"></p>
      <div class="actions-bar" style="margin-top:14px;"><button type="button" class="btn btn-primary" id="pf-submit">Envoyer ma candidature</button></div>
    </div>`;
}

function renderMessage(title, body) {
  return `<div class="card"><h2 style="margin:0 0 10px;">${escapeHtml(title)}</h2><p class="field-help">${escapeHtml(body)}</p></div>`;
}

// 41e échange — panneau affiché à un compte académique/national qui ouvre cette page directement
// (voir resolveStage() : >1 ligne BD_Stages2 reçue, impossible pour un candidat anonyme). Plutôt
// qu'un message d'erreur, ce panneau rend la page utile : la liste des stages dans le périmètre ACL
// de la personne connectée, avec le lien de recrutement déjà généré par gestion-stage-fpgc.js
// (BD_Stages2.Formulaire_URL) et un bouton pour le copier — pratique pour le retrouver sans ouvrir
// le widget de gestion. Les stages clôturés/annulés sont repliés par défaut (`<details>`) : ce sont
// les stages ouverts que le personnel vient chercher ici la plupart du temps.
function renderStaff() {
  const rows = state.stagesStaff || [];
  const ouverts = rows.filter((r) => r.Statut_du_stage !== 'Annulé' && r.Statut_du_stage !== 'Clôturé');
  const fermes = rows.filter((r) => r.Statut_du_stage === 'Annulé' || r.Statut_du_stage === 'Clôturé');
  // Colonne Académie affichée seulement si plusieurs académies distinctes apparaissent dans les
  // lignes reçues — signe empirique d'un compte National plutôt qu'Académie (qui ne verrait jamais
  // que la sienne) ; inutile de dupliquer une colonne toujours identique pour un compte Académie.
  const academies = new Set(rows.map((r) => academieLabelForStage(r)).filter(Boolean));
  const showAcademieCol = academies.size > 1;

  // 62e échange, tour suivant — colonne "Candidats" : lien direct vers gestion-stage-fpgc.js, ouvert
  // sur ce stage précis (onglet Stagiaires), plutôt que d'obliger le personnel à rouvrir le widget de
  // gestion puis à retrouver le stage lui-même. Indépendant de la présence d'un lien de recrutement
  // déjà généré (r.Formulaire_URL) : utile même pour un stage jamais encore partagé publiquement.
  // 63e échange, tour suivant — demande explicite de l'utilisateur : navigation dans le même onglet
  // par défaut (Ctrl/Cmd+clic pour un nouvel onglet, comportement natif du navigateur), pas de nouvel
  // onglet systématique. `target="_top"` (pas `target="_blank"`) sort de l'iframe du widget vers la
  // fenêtre/onglet qui l'héberge, exactement le même mécanisme que le formulaire de bascule vers
  // espace-stagiaire.html dans renderEnvoye()/bindEnvoye() plus bas (déjà confirmé fonctionnel en
  // conditions réelles à ce tour-ci, voir la note au-dessus de renderEnvoye()) — un simple attribut
  // HTML natif, rien à gérer en JS pour le cas Ctrl/Cmd+clic (le navigateur l'ouvre alors lui-même
  // dans un nouvel onglet, quel que soit `target`).
  const gestionUrl = pageUrlGestionStage();

  const ligneHtml = (r) => {
    const lien = r.Formulaire_URL || '';
    const label = escapeHtml(r.Intitule || r.Reference_de_stage || ('Stage #' + r.id));
    const statutColor = r.Statut_du_stage === 'Annulé' ? 'var(--danger)' : (r.Statut_du_stage === 'Clôturé' ? 'var(--text-muted)' : 'var(--ok)');
    const academieCol = showAcademieCol ? `<td>${escapeHtml(academieLabelForStage(r) || '—')}</td>` : '';
    const lienCol = lien
      ? `<div class="link-row"><input type="text" readonly value="${escapeHtml(lien)}"><button type="button" class="btn btn-small pf-staff-copy" data-copy-url="${escapeHtml(lien)}">Copier</button></div>`
      : `<span class="field-help">Lien pas encore généré — à configurer depuis le widget de gestion.</span>`;
    const candidatsCol = gestionUrl
      ? `<a href="${escapeHtml(gestionUrl)}" target="_top" rel="noopener" class="pf-staff-open-gestion" data-stage-id="${r.id}">Voir les candidats</a>`
      : `<span class="field-help">Page de gestion non configurée</span>`;
    return `<tr><td>${label}</td>${academieCol}<td><span style="color:${statutColor};font-weight:600;">${escapeHtml(r.Statut_du_stage || '—')}</span></td><td>${lienCol}</td><td>${candidatsCol}</td></tr>`;
  };

  const tableHtml = (list) => list.length
    ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Stage</th>${showAcademieCol ? '<th>Académie</th>' : ''}<th>Statut</th><th>Lien de recrutement</th><th>Candidats</th></tr></thead><tbody>${list.map(ligneHtml).join('')}</tbody></table></div>`
    : `<p class="field-help">Aucun stage dans cette catégorie, dans votre périmètre actuel.</p>`;

  return `
    <div class="card">
      <h2 style="margin:0 0 10px;">Liens de recrutement</h2>
      <p class="field-help">Vous consultez cette page avec un compte du personnel (académique ou national) plutôt que via un lien candidat — le formulaire de candidature n'a pas de sens pour ce profil. Voici les liens de recrutement des stages actuellement dans votre périmètre, à copier et transmettre à vos candidats.</p>
      ${tableHtml(ouverts)}
      ${fermes.length ? `
        <details style="margin-top:14px;">
          <summary style="cursor:pointer;font-size:12.5px;color:var(--text-muted);">Afficher aussi les stages clôturés/annulés (${fermes.length})</summary>
          <div class="pf-staff-closed" style="margin-top:10px;">${tableHtml(fermes)}</div>
        </details>` : ''}
    </div>`;
}

function bindStaff() {
  document.querySelectorAll('.pf-staff-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const url = btn.getAttribute('data-copy-url') || '';
      try { await navigator.clipboard.writeText(url); btn.textContent = 'Copié !'; }
      catch (err) {
        const input = btn.previousElementSibling;
        if (input && input.select) { input.select(); document.execCommand('copy'); }
        btn.textContent = 'Copié !';
      }
      setTimeout(() => { btn.textContent = 'Copier'; }, 2000);
    });
  });
  // 62e échange, tour suivant — écrit l'entrée localStorage juste avant l'ouverture (target="_top"
  // depuis le 63e échange, tour suivant — déjà porté par le lien lui-même dans le HTML ; ce clic ne
  // fait qu'ajouter la préparation du deep-link, il ne gère pas la navigation elle-même) — voir
  // ecrireDeepLinkStage() et la note dans consumeDeepLinkStage() (gestion-stage-fpgc.js) pour le
  // mécanisme complet.
  document.querySelectorAll('.pf-staff-open-gestion').forEach((el) => {
    el.addEventListener('click', () => {
      const stageId = Number(el.getAttribute('data-stage-id'));
      if (stageId) ecrireDeepLinkStage(stageId, 'stagiaires');
    });
  });
}

// Écran de confirmation : distinct de renderMessage() car il doit, en plus du texte, afficher le
// lien personnel (avec bouton copier) quand il a pu être généré — voir bindFormulaire (29e échange).
// 40e échange, tour suivant — demande explicite de l'utilisateur : rendre le passage du recrutement
// vers l'espace stagiaire plus agréable qu'un simple lien à copier. Une redirection automatique
// silencieuse (tour précédent) a été testée en conditions réelles (Brave, navigation privée) et
// fonctionne — le mécanisme <form target="_top"> lui-même est donc confirmé fiable — mais l'utilisateur
// a demandé une fenêtre de confirmation avant la bascule plutôt qu'un départ instantané et silencieux.
// Remplacé en conséquence par une fenêtre modale (`.modal-overlay`, voir formulaire-public.html) qui
// s'affiche automatiquement au-dessus de l'écran de confirmation : le même <form target="_top"> (même
// construction que renderReconnexion() dans espace-stagiaire.js — style=singlePage en champ caché
// AVANT CandidatUUID_) y est soumis par un vrai clic sur « Accéder à mon espace stagiaire », plutôt
// que déclenché par le widget lui-même. Bénéfice secondaire : la navigation est désormais rattachée à
// un geste utilisateur direct et sans ambiguïté, ce qui lève la réserve posée au tour précédent sur le
// risque qu'un navigateur bloque silencieusement une navigation déclenchée après un `await` réseau
// (voir §39e échange x3) — un clic sur un bouton de soumission est un geste utilisateur classique,
// pas une tentative programmatique. La fenêtre reste dismissible (« Plus tard ») sans forcer la
// bascule : le lien texte, inchangé, reste le filet de secours (autre appareil, onglet fermé avant
// d'avoir cliqué, etc.).
function renderEnvoye() {
  const lien = state.lienPersonnel;
  const baseUrlEspace = pageUrlEspaceStagiaire();
  const modalHtml = (lien && baseUrlEspace && state.uuidPersonnel)
    ? `
      <div class="modal-overlay" id="pf-modal-espace">
        <div class="card modal-card">
          <h2 style="margin:0 0 10px;">Accéder à votre espace stagiaire ?</h2>
          <p class="field-help">Votre candidature a bien été enregistrée. Vous pouvez dès maintenant accéder à votre espace stagiaire, où vous retrouverez le planning et votre émargement une fois votre candidature validée.</p>
          <form id="pf-form-espace" method="GET" action="${escapeHtml(baseUrlEspace)}" target="_top">
            <input type="hidden" name="style" value="singlePage">
            <input type="hidden" name="CandidatUUID_" value="${escapeHtml(state.uuidPersonnel)}">
            <div class="actions-bar" style="margin-top:16px;">
              <button type="submit" class="btn btn-primary">Accéder à mon espace stagiaire →</button>
              <button type="button" class="btn" id="pf-modal-plus-tard">Plus tard</button>
            </div>
          </form>
        </div>
      </div>`
    : '';
  const lienHtml = lien
    ? `
      <div class="field" style="margin-top:16px;">
        <label>Votre lien personnel — à conserver précieusement</label>
        <div class="row-inline">
          <input type="text" id="pf-lien-perso" readonly value="${escapeHtml(lien)}">
          <button type="button" class="btn btn-small" id="pf-copy-lien">Copier</button>
        </div>
        <p class="field-help">Ce lien vous donnera accès au planning du stage et à votre émargement une fois votre candidature validée. Il n'est envoyé par aucun autre moyen : notez-le ou enregistrez cette page dans vos favoris — utile si vous fermez la fenêtre ci-dessus sans y cliquer, ou depuis un autre appareil. En cas de perte, l'organisation du stage peut le retrouver pour vous.</p>
      </div>`
    : `<p class="field-help" style="margin-top:12px;">Un lien personnel vous donnant accès, plus tard, au planning et à l'émargement du stage n'a pas pu être généré automatiquement — l'organisation du stage pourra vous le communiquer.</p>`;
  return `
    <div class="card">
      <h2 style="margin:0 0 10px;">Candidature enregistrée</h2>
      <p class="field-help">Votre candidature a bien été transmise. Vous serez recontacté(e) par l'organisation du stage.</p>
      ${lienHtml}
    </div>
    ${modalHtml}`;
}

function render() {
  const main = document.getElementById('main');
  if (state.phase === 'chargement') { main.innerHTML = renderMessage('Chargement…', 'Merci de patienter.'); return; }
  // Contrairement à un simple blocage ACL (phase 'invalide', message générique volontaire), une
  // erreur ici vient d'un échec du CHARGEMENT lui-même (fetchTable qui plante, ex. une règle ACL
  // dont la formule référence une colonne inexistante) — sans ce cas, boot() restait bloqué sur
  // "Chargement…" indéfiniment et sans aucune indication, y compris pour vous en train de déboguer
  // les règles à distance. Le détail technique est donc affiché ici aussi, comme pour l'échec d'envoi.
  if (state.phase === 'erreur_chargement') { main.innerHTML = renderMessage('Erreur de chargement', "Le formulaire n'a pas pu se charger. (Détail technique : " + state.erreurChargement + ')'); return; }
  if (state.phase === 'invalide') { main.innerHTML = renderMessage('Lien invalide', "Ce lien n'est plus valable ou ne correspond à aucun formulaire ouvert. Merci de contacter l'organisation du stage pour obtenir un lien à jour."); return; }
  if (state.phase === 'staff') { main.innerHTML = renderStaff(); bindStaff(); return; }
  if (state.phase === 'clos') { main.innerHTML = renderMessage('Candidatures closes', `Le stage « ${state.stage.Intitule || state.stage.Reference_de_stage} » n'accepte plus de nouvelles candidatures (statut : ${state.stage.Statut_du_stage}).`); return; }
  if (state.phase === 'envoye') { main.innerHTML = renderEnvoye(); bindEnvoye(); return; }
  if (state.phase === 'formulaire') { main.innerHTML = renderFormulaire(state.stage); bindFormulaire(state.stage); return; }
}

/* ---------------------------------------------------------------------- */
/* Interaction                                                            */
/* ---------------------------------------------------------------------- */

// Bascule l'affichage des questions conditionnelles (dependsOn) selon la valeur courante de leur
// question contrôlante, sans jamais reconstruire le HTML du formulaire (qui effacerait les réponses
// déjà saisies) — même principe que le fichier principal (bindConfigFormulaire, lecture atomique).
function updateDependentVisibility() {
  document.querySelectorAll('[data-depends-on]').forEach((wrap) => {
    const controllerId = wrap.getAttribute('data-depends-on');
    const equals = wrap.getAttribute('data-depends-equals');
    const controllerEl = document.querySelector(`[data-q-id="${controllerId}"]`);
    const match = controllerEl && controllerEl.value === equals;
    wrap.style.display = match ? '' : 'none';
  });
}

function bindEnvoye() {
  // 40e échange, tour suivant x3 — plus de soumission déclenchée par le widget lui-même (l'ancienne
  // tentative automatique, confirmée fonctionnelle en conditions réelles au tour précédent, a été
  // remplacée par une fenêtre de confirmation à la demande de l'utilisateur — voir la note au-dessus
  // de renderEnvoye()). La navigation ne part plus que d'un vrai clic sur le bouton de soumission de
  // #pf-form-espace (comportement natif du navigateur, rien à câbler ici) ; « Plus tard » referme
  // simplement la fenêtre sans naviguer, laissant la personne sur l'écran de confirmation avec le lien
  // texte toujours disponible.
  // FPGC-06 : défense en profondeur — valider l'action résolue du formulaire avant toute soumission.
  // pageUrlEspaceStagiaire() a déjà appliqué safeUrl() au rendu, mais un remplacement de l'attribut
  // action par manipulation DOM après le rendu serait ici intercepté.
  const formEspace = document.getElementById('pf-form-espace');
  if (formEspace) {
    formEspace.addEventListener('submit', (e) => {
      if (!safeUrl(formEspace.action)) {
        e.preventDefault();
      }
    });
  }
  const modalOverlay = document.getElementById('pf-modal-espace');
  const plusTardBtn = document.getElementById('pf-modal-plus-tard');
  if (modalOverlay && plusTardBtn) {
    plusTardBtn.addEventListener('click', () => { modalOverlay.remove(); });
    // Confort : clic sur le fond assombri ou touche Échap ferment aussi la fenêtre, sans forcer la
    // bascule — jamais la seule façon de la fermer (le bouton « Plus tard » suffit à lui seul).
    modalOverlay.addEventListener('click', (ev) => { if (ev.target === modalOverlay) modalOverlay.remove(); });
    document.addEventListener('keydown', function echapFermeModal(ev) {
      if (ev.key === 'Escape') { modalOverlay.remove(); document.removeEventListener('keydown', echapFermeModal); }
    });
  }

  const copyBtn = document.getElementById('pf-copy-lien');
  if (!copyBtn) return;
  copyBtn.addEventListener('click', async () => {
    const input = document.getElementById('pf-lien-perso');
    try { await navigator.clipboard.writeText(input.value); copyBtn.textContent = 'Copié !'; }
    catch (err) { input.select(); document.execCommand('copy'); copyBtn.textContent = 'Copié !'; }
    setTimeout(() => { copyBtn.textContent = 'Copier'; }, 2000);
  });
}

// Autocomplétion « établissement » (42e échange, champs séparés depuis le 45e échange) : recherche
// par nom au fil de la frappe (debounce), sélection d'une suggestion qui écrit le nom (sans la
// commune, gardée seulement dans la liste déroulante) dans le champ de recherche et le vrai code UAI
// dans le champ dédié en lecture seule. Tant qu'aucune suggestion n'est choisie, le nom reste en texte
// libre (repli documenté dans la note d'architecture au-dessus de searchEtablissements()) et le champ
// UAI reste vide — jamais rempli autrement que par une sélection explicite.
function bindEtablissementAutocomplete() {
  document.querySelectorAll('[data-etab-search]').forEach((searchInput) => {
    const qId = searchInput.getAttribute('data-etab-search');
    const uaiInput = document.querySelector(`[data-etab-uai="${qId}"]`);
    const suggestionsBox = document.querySelector(`[data-etab-suggestions="${qId}"]`);
    const statusEl = document.querySelector(`[data-etab-status="${qId}"]`);
    if (!uaiInput || !suggestionsBox || !statusEl) return;

    let debounceTimer = null;
    let currentQuery = '';

    function closeSuggestions() {
      suggestionsBox.hidden = true;
      suggestionsBox.innerHTML = '';
    }

    function selectSuggestion(etab) {
      searchInput.value = etab.nom;
      uaiInput.value = etab.uai;
      statusEl.textContent = 'Établissement sélectionné — code UAI ' + etab.uai + '.';
      closeSuggestions();
    }

    function renderSuggestions(list) {
      if (!list.length) {
        closeSuggestions();
        statusEl.textContent = "Aucun établissement trouvé pour l'instant — vérifiez l'orthographe, ou continuez : le texte saisi sera utilisé tel quel (non géolocalisé sur la carte de pilotage).";
        return;
      }
      suggestionsBox.innerHTML = list.map((etab, i) => `
        <div class="etab-suggestion" data-etab-idx="${i}" tabindex="0">
          <span class="etab-suggestion-nom">${escapeHtml(etab.nom)}</span>${etab.commune ? ` <span class="etab-suggestion-commune">— ${escapeHtml(etab.commune)}</span>` : ''}${etab.etat && etab.etat !== 'OUVERT' ? ` <span class="etab-suggestion-etat">(${escapeHtml(etab.etat)})</span>` : ''}
        </div>`).join('');
      suggestionsBox.hidden = false;
      suggestionsBox.querySelectorAll('[data-etab-idx]').forEach((el) => {
        const idx = Number(el.getAttribute('data-etab-idx'));
        // mousedown (pas click) : se déclenche avant le blur du champ texte, qui refermerait sinon
        // la liste avant que la sélection ne soit prise en compte.
        el.addEventListener('mousedown', (ev) => { ev.preventDefault(); selectSuggestion(list[idx]); });
      });
      statusEl.textContent = '';
    }

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim();
      currentQuery = q;
      // 45e échange : toute frappe dans le nom invalide une sélection précédente — le champ UAI
      // (lecture seule, jamais saisissable à la main) est effacé plutôt que de risquer d'envoyer un
      // code qui ne correspond plus au nom désormais affiché. Il ne sera réécrit que par un nouveau
      // clic sur une suggestion (selectSuggestion ci-dessus).
      uaiInput.value = '';
      if (debounceTimer) clearTimeout(debounceTimer);
      if (q.length < ETAB_SEARCH_MIN_CHARS) {
        closeSuggestions();
        statusEl.textContent = q.length ? `Continuez de taper (au moins ${ETAB_SEARCH_MIN_CHARS} caractères) pour voir des suggestions.` : '';
        return;
      }
      statusEl.textContent = 'Recherche…';
      debounceTimer = setTimeout(async () => {
        try {
          const results = await searchEtablissements(q);
          if (currentQuery !== q) return; // une saisie plus récente a eu lieu entre-temps
          renderSuggestions(results);
        } catch (err) {
          if (currentQuery !== q) return;
          console.error('[Formulaire public FPGC] recherche établissement', err);
          closeSuggestions();
          statusEl.textContent = "Recherche indisponible pour l'instant — continuez : le texte saisi sera utilisé tel quel.";
        }
      }, ETAB_SEARCH_DEBOUNCE_MS);
    });

    // Laisse le temps au mousedown d'une suggestion de s'exécuter avant de refermer la liste.
    searchInput.addEventListener('blur', () => { setTimeout(closeSuggestions, 150); });
  });
}

/* ---------------------------------------------------------------------- */
/* Mise en forme des saisies et candidature déjà envoyée (09/11/2026)      */
/*                                                                         */
/* Mise en forme : règles de commun/normalisation.js (NOM en majuscules,   */
/* Prénom, mél en minuscules, téléphone « 06 12 34 56 78 »…), appliquées à */
/* la sortie de chaque champ, pour que la personne voie le résultat, puis  */
/* une dernière fois à l'envoi. Si le module commun n'est pas chargé       */
/* (widget collé dans le Custom Widget Builder), les saisies partent       */
/* telles quelles : le formulaire continue de fonctionner.                 */
/*                                                                         */
/* Doublons : ce formulaire ne peut lire aucune candidature (règles        */
/* d'accès), il ne peut donc pas comparer avec celles déjà reçues. La      */
/* détection complète se fait dans le widget de gestion. Ici, on prévient  */
/* seulement la personne qui a déjà envoyé une candidature à ce stage      */
/* depuis ce navigateur. Seules des empreintes SHA-256 (mél, nom+prénom)   */
/* sont gardées dans le navigateur, jamais les données en clair.           */
/* ---------------------------------------------------------------------- */

const Normalisation = window.NormalisationFPGC || null;
const CLE_CANDIDATURES_ENVOYEES = 'fpgc_candidatures_envoyees';

function miseEnForme(colonne, valeur) {
  return Normalisation ? Normalisation.normaliserValeur(colonne, valeur) : valeur;
}

// Champ de saisie → colonne qu'il alimente (pour la mise en forme à la sortie du champ).
function colonneDuChamp(el) {
  if (el.id === 'pf-nom') return 'Nom';
  if (el.id === 'pf-prenom') return 'Prenom';
  if (el.id === 'pf-mel') return 'Mel';
  const q = QUESTIONS_RECRUTEMENT.find((x) => x.id === el.getAttribute('data-q-id'));
  return q ? q.colonneCible : null;
}

function bindMiseEnForme() {
  if (!Normalisation) return;
  document.querySelectorAll('#pf-nom, #pf-prenom, #pf-mel, input[type="text"][data-q-id]').forEach((el) => {
    el.addEventListener('blur', () => {
      const colonne = colonneDuChamp(el);
      if (colonne && el.value) el.value = miseEnForme(colonne, el.value);
    });
  });
}

async function empreinte(texte) {
  const octets = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte));
  return Array.from(new Uint8Array(octets)).map((o) => o.toString(16).padStart(2, '0')).join('');
}

// Empreintes de la candidature pour ce stage, ou null si le navigateur ne permet pas de les calculer.
async function empreintesCandidature(stageId, champs) {
  if (!Normalisation || !(window.crypto && crypto.subtle)) return null;
  try {
    const mel = Normalisation.cleMel(champs.Mel);
    const identite = Normalisation.cleIdentite(champs.Nom, champs.Prenom);
    return {
      mel: mel ? await empreinte(`${stageId}|mel|${mel}`) : '',
      identite: identite ? await empreinte(`${stageId}|identite|${identite}`) : '',
    };
  } catch (e) { return null; }
}

function candidaturesEnvoyees() {
  try { return JSON.parse(localStorage.getItem(CLE_CANDIDATURES_ENVOYEES) || '[]') || []; } catch (e) { return []; }
}

// Candidature déjà envoyée depuis ce navigateur par la même personne (même mél, ou même nom et prénom).
function envoiPrecedent(empreintes) {
  if (!empreintes) return null;
  return candidaturesEnvoyees().find((e) => (empreintes.mel && e.mel === empreintes.mel)
    || (empreintes.identite && e.identite === empreintes.identite)) || null;
}

function memoriserEnvoi(empreintes) {
  if (!empreintes) return;
  try {
    const liste = candidaturesEnvoyees().slice(-49); // 50 dernières candidatures au plus
    liste.push({ ...empreintes, date: Date.now() });
    localStorage.setItem(CLE_CANDIDATURES_ENVOYEES, JSON.stringify(liste));
  } catch (e) { /* stockage indisponible : rien à mémoriser */ }
}

function bindFormulaire(stage) {
  document.querySelectorAll('[data-q-id]').forEach((el) => {
    el.addEventListener('change', updateDependentVisibility);
    el.addEventListener('input', updateDependentVisibility);
  });
  bindEtablissementAutocomplete();
  bindMiseEnForme();
  updateDependentVisibility();

  document.getElementById('pf-submit').addEventListener('click', async () => {
    const statusEl = document.getElementById('pf-status');
    const nom = document.getElementById('pf-nom').value.trim();
    const prenom = document.getElementById('pf-prenom').value.trim();
    const mel = document.getElementById('pf-mel').value.trim();
    if (!nom || !prenom || !mel) { statusEl.textContent = 'Nom, prénom et adresse mél sont obligatoires.'; return; }
    if (Normalisation && !Normalisation.melValide(mel)) { statusEl.textContent = "L'adresse mél ne semble pas valide (exemple : prenom.nom@ac-academie.fr)."; return; }

    const cfg = formulaireConfigForStage(stage.id);
    const masqueeSet = new Set(cfg.masquees);
    const optionnelleSet = new Set(cfg.optionnelles);
    const fields = { Nom: nom, Prenom: prenom, Mel: mel };
    const manquantes = [];

    for (const q of QUESTIONS_RECRUTEMENT) {
      if (q.type === 'Lien' || masqueeSet.has(q.id)) continue;
      // 45e échange : la question établissement porte deux champs cibles et aucun data-q-id — traitée
      // séparément juste après cette boucle, pas ici.
      if (q.type === 'EtablissementUAI') continue;
      const wrap = document.querySelector(`[data-q-wrap="${q.id}"]`);
      const visible = !wrap || wrap.style.display !== 'none';
      const el = document.querySelector(`[data-q-id="${q.id}"]`);
      if (!visible || !el) continue; // question conditionnelle non affichée : ni validée ni écrite
      const optionnelle = cfg.jamaisConfigure ? !q.obligatoireParDefaut : optionnelleSet.has(q.id);

      let value = null;
      if (q.type === 'Case à cocher') {
        value = el.checked;
      } else {
        const raw = el.value;
        if (!raw) { if (!optionnelle) manquantes.push(q.libelle); continue; }
        if (q.type === 'Date') value = toEpoch(raw);
        else if (q.type === 'DateHeure') value = parisLocalToEpoch(raw);
        else value = raw;
      }
      if (q.colonneCible) fields[q.colonneCible] = value;
    }

    // 45e échange : champ établissement (nom + UAI), traité à part car il ne suit pas le schéma
    // « une question -> un champ data-q-id -> une colonne » de la boucle ci-dessus. Le nom suit la
    // règle d'obligatoire/optionnel habituelle ; l'UAI n'est jamais indépendamment obligatoire — il
    // n'est écrit que s'il a été rempli par une sélection (bindEtablissementAutocomplete), jamais saisi
    // à la main (champ en lecture seule).
    const etabQ = QUESTIONS_RECRUTEMENT.find((q) => q.type === 'EtablissementUAI');
    if (etabQ && !masqueeSet.has(etabQ.id)) {
      const wrap = document.querySelector(`[data-q-wrap="${etabQ.id}"]`);
      const visible = !wrap || wrap.style.display !== 'none';
      if (visible) {
        const searchEl = document.querySelector(`[data-etab-search="${etabQ.id}"]`);
        const uaiEl = document.querySelector(`[data-etab-uai="${etabQ.id}"]`);
        const optionnelle = cfg.jamaisConfigure ? !etabQ.obligatoireParDefaut : optionnelleSet.has(etabQ.id);
        const nomVal = searchEl ? searchEl.value.trim() : '';
        const uaiVal = uaiEl ? uaiEl.value.trim() : '';
        if (!nomVal) {
          if (!optionnelle) manquantes.push(etabQ.libelle);
        } else {
          if (etabQ.colonneCibleNom) fields[etabQ.colonneCibleNom] = nomVal;
          if (uaiVal && etabQ.colonneCibleUai) fields[etabQ.colonneCibleUai] = uaiVal;
        }
      }
    }

    if (manquantes.length) { statusEl.textContent = 'Merci de renseigner : ' + manquantes.join(', ') + '.'; return; }

    // Mise en forme finale (y compris les champs non quittés au clavier avant l'envoi).
    if (Normalisation) Object.assign(fields, Normalisation.normaliserChamps(fields));

    // Candidature déjà envoyée à ce stage depuis ce navigateur : on demande confirmation une fois.
    const submitBtn = document.getElementById('pf-submit');
    const empreintes = await empreintesCandidature(stage.id, fields);
    const precedent = envoiPrecedent(empreintes);
    if (precedent && submitBtn.dataset.doublonConfirme !== '1') {
      const date = new Date(precedent.date).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' });
      statusEl.innerHTML = `<strong>Vous avez déjà envoyé une candidature à ce stage le ${escapeHtml(date)}.</strong> `
        + 'Un nouvel envoi créerait une seconde candidature. Si vous souhaitez corriger une information, '
        + "contactez plutôt l'organisation du stage. "
        + '<button type="button" class="btn btn-small btn-secondary" id="pf-confirmer-doublon">Envoyer quand même</button>';
      document.getElementById('pf-confirmer-doublon').addEventListener('click', () => {
        submitBtn.dataset.doublonConfirme = '1';
        submitBtn.click();
      });
      return;
    }

    fields.Stage = stage.id;
    // FPGC-02 (70e échange) : Statut n'est plus fixé côté client. Il est désormais calculé par une
    // trigger formula Grist sur Candidats_du_stage ("New records" uniquement) :
    //   "Candidat" if $Stage.Candidats_actifs_count < $Stage.Effectif_theorique else "Liste d'attente"
    // Cela élimine le vecteur d'auto-promotion (Statut='Stagiaire' forgé depuis la console) et le
    // contournement de la liste d'attente. Les variables existing/effectif ne sont plus utilisées ici
    // mais BD_Stages2.Candidats_actifs_count reste lu par resolveStage() pour d'autres besoins
    // éventuels — on les conserve donc dans la structure de données chargée.
    // 25e échange : n'écrit plus de copie de la clé sur Candidats_du_stage (`Formulaire_UUID`) —
    // cette colonne n'existe pas sur le document réel (« [Sandbox] KeyError 'Formulaire_UUID' » à
    // l'envoi, que la colonne soit absente du AddRecord ou de la règle ACL de Création qui la
    // référençait en défense en profondeur). Ce n'était qu'une protection supplémentaire, pas le
    // mécanisme de sécurité principal : celui-ci reste la Lecture de BD_Stages2 scopée par Link Key
    // (`user.LinkKey.UUID == rec.UUID`), déjà confirmée fonctionnelle — voir acl-academies.md.

    // 29e échange : clé personnelle donnant accès à espace-stagiaire.html, générée ici (pas par le
    // widget principal) et affichée à l'écran juste après l'envoi — voir renderEnvoye()/bindEnvoye().
    const uuidPersonnel = generateUUID();
    fields.UUID_personnel = uuidPersonnel;
    const lienPersonnel = buildLienPersonnel(pageUrlEspaceStagiaire(), uuidPersonnel);
    if (lienPersonnel) fields.Lien_personnel = lienPersonnel;

    submitBtn.disabled = true;
    statusEl.textContent = 'Envoi en cours…';
    try {
      await grist.docApi.applyUserActions([['AddRecord', 'Candidats_du_stage', null, fields]]);
      memoriserEnvoi(empreintes);
      state.phase = 'envoye';
      state.lienPersonnel = lienPersonnel;
      state.uuidPersonnel = uuidPersonnel;
      render();
    } catch (err) {
      console.error('[Formulaire public FPGC]', err);
      // Le détail technique est affiché volontairement (pas seulement loggé en console) : ce widget
      // est piloté à distance par des personnes qui n'ouvriront pas forcément les outils de
      // développement du navigateur, et le message brut de Grist (ex. refus ACL, colonne inconnue,
      // type de valeur invalide) est souvent la seule façon de diagnostiquer sans accès au document.
      const detail = (err && (err.message || String(err))) || 'erreur inconnue';
      statusEl.textContent = "Erreur lors de l'envoi — merci de réessayer, ou de contacter l'organisation si le problème persiste. (Détail technique : " + detail + ')';
      submitBtn.disabled = false;
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Démarrage                                                              */
/* ---------------------------------------------------------------------- */

async function boot() {
  render();
  try {
    await loadAll();
    loadParametresWidgetIntoState();
    resolveStage();
  } catch (err) {
    // Sans ce filet, une erreur ici (ex. fetchTable qui échoue à cause d'une règle ACL mal formée)
    // laissait la page bloquée sur "Chargement…" pour toujours, sans aucun indice — voir la note à
    // l'endroit où 'erreur_chargement' est géré dans render().
    console.error('[Formulaire public FPGC] échec du chargement initial', err);
    state.phase = 'erreur_chargement';
    state.erreurChargement = (err && (err.message || String(err))) || 'erreur inconnue';
  }
  render();
}

boot();