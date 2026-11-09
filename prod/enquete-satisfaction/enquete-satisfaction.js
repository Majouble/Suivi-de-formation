/* ============================================================================
   Enquête de satisfaction FPGC — widget Grist séparé, destiné à être visité
   par un stagiaire de façon ANONYME (pas de session Grist authentifiée,
   aucune donnée d'identité collectée).

   ARCHITECTURE — lire avant de modifier (mêmes principes que
   formulaire-public.js, dont ce fichier est le complément — voir ce fichier
   pour l'historique complet du mécanisme Link Key) :

   - Fichier autonome, sans import partagé avec les deux autres widgets de ce
     projet (`formulaire-public.js`, `espace-stagiaire.js`) — voir la note
     équivalente dans ces fichiers.
   - **29e échange** : une première conception envisageait un widget UNIQUE
     à trois modes (`?mode=...`), abandonnée à la demande de l'utilisateur au
     profit d'un fichier par étape — voir `processus-gestion-stage.md`.
   - Clé de stage PARTAGÉE (tous les répondants d'un même stage utilisent le
     même lien), mais **distincte** de la clé de recrutement
     (`BD_Stages2.Satisfaction_UUID`, pas `UUID`) — décision explicite de
     l'utilisateur : une réponse à cette enquête ne doit jamais pouvoir être
     reliée, même indirectement, à une candidature ou à une personne. Le
     paramètre `SatisfactionUUID_` sur l'URL de la page Grist alimente un
     User Attribute nommé `StageSatisfaction` (recherché dans
     `BD_Stages2.Satisfaction_UUID`) — voir `acl-academies.md` §16.
   - Ce widget n'écrit QUE en Création (`Enquete_de_satisfaction`,
     `Satisfaction_modules`) — jamais de Lecture sur ces deux tables, pour ne
     jamais avoir besoin d'exposer une réponse déjà envoyée à un visiteur
     anonyme (cohérent avec l'anonymat : rien à gagner à relire, un risque à
     l'exposer).
   - Les questions par module sont générées dynamiquement depuis
     `Planning_du_stage` (tous les modules du planning, obligatoires et
     complémentaires, évalués individuellement — décision explicite de
     l'utilisateur), pas codées en dur comme le socle commun.
   ========================================================================== */

grist.ready({ requiredAccess: 'full' });

/* ---------------------------------------------------------------------- */
/* Socle de l'enquête — copie exacte de QUESTIONS_SATISFACTION dans          */
/* gestion-stage-fpgc.js (même principe de duplication volontaire que        */
/* QUESTIONS_RECRUTEMENT dans formulaire-public.js). `obligatoireFixe: true`  */
/* = jamais configurable par le personnel (contrairement à                   */
/* `obligatoireParDefaut`, un simple défaut ajustable via `satisfactionConfig`)*/
/* ---------------------------------------------------------------------- */

const QUESTIONS_SATISFACTION = [
  { id: 'globale', libelle: 'Note globale de satisfaction (1 à 5)', type: 'Note5', colonneCible: 'Note_globale', obligatoireFixe: true, ordre: 10 },
  { id: 'intervenants', libelle: 'Note sur les intervenants / formateurs (1 à 5)', type: 'Note5', colonneCible: 'Note_intervenants', obligatoireParDefaut: true, ordre: 20 },
  { id: 'contenu', libelle: 'Note sur le contenu pédagogique (1 à 5)', type: 'Note5', colonneCible: 'Note_contenu', obligatoireParDefaut: true, ordre: 30 },
  { id: 'logistique', libelle: 'Note sur la logistique — hébergement, restauration, transport (1 à 5)', type: 'Note5', colonneCible: 'Note_logistique', obligatoireParDefaut: true, ordre: 40 },
  { id: 'rythme', libelle: 'Le rythme de la formation (horaires, pauses) était-il adapté ?', type: 'Choix', optionsChoix: 'Pas du tout adapté;Peu adapté;Adapté;Tout à fait adapté', colonneCible: 'Rythme_adapte', obligatoireParDefaut: false, ordre: 50 },
  { id: 'duree', libelle: 'La durée du stage était-elle adaptée ?', type: 'Choix', optionsChoix: 'Trop courte;Adaptée;Trop longue', colonneCible: 'Duree_adaptee', obligatoireParDefaut: false, ordre: 60 },
  { id: 'recommandation', libelle: 'Recommanderiez-vous ce stage à un collègue ?', type: 'Choix', optionsChoix: 'Oui;Non;Peut-être', colonneCible: 'Recommanderiez_vous', obligatoireParDefaut: false, ordre: 70 },
  { id: 'commentaire', libelle: 'Commentaire libre (points forts, améliorations suggérées)', type: 'TexteLong', colonneCible: 'Commentaire', obligatoireParDefaut: false, ordre: 80 },
];

// Échelle retenue pour l'évaluation individuelle de chaque module (obligatoire ou complémentaire)
// du planning — décision explicite de l'utilisateur : pas de note chiffrée, une formulation
// d'accord/désaccord avec la phrase « Le module [Nom du module] répond à mes besoins professionnels ».
const ECHELLE_MODULE = ["Tout à fait d'accord", "Plutôt d'accord", 'Plutôt en désaccord', 'Totalement en désaccord'];

/* ---------------------------------------------------------------------- */
/* Couche de données Grist                                                 */
/* ---------------------------------------------------------------------- */

const TABLES = ['BD_Stages2', 'Planning_du_stage', 'Parametres_widget', 'Reference'];
const DB = {};

async function loadTable(tableId) {
  let data;
  try {
    data = await grist.docApi.fetchTable(tableId);
  } catch (err) {
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
  const results = await Promise.allSettled(TABLES.map(loadTable));
  const echecs = results.filter((r) => r.status === 'rejected').map((r) => r.reason && r.reason.message);
  if (echecs.length) throw new Error(echecs.join(' | '));
}

function T(tableId) { return (DB[tableId] && DB[tableId].rows) || []; }

/* ---------------------------------------------------------------------- */
/* Parametres_widget — nouvelle clé `satisfactionConfig` (29e échange),     */
/* même principe que `formulaireConfig` dans formulaire-public.js.          */
/* ---------------------------------------------------------------------- */

function paramWidgetRaw(cle) {
  const row = T('Parametres_widget').find((r) => r.Cle === cle);
  return row ? row.Valeur : '';
}

let satisfactionConfig = {};
// 61e échange — ce fichier n'avait jusqu'ici ni baseUrlDocument ni fonction pageUrlXxx (voir la note
// d'architecture en tête de fichier : contrairement à formulaire-public.js, il n'a jamais eu besoin
// de lier vers une autre page publique). Ajoutés ici uniquement pour le lien vers la page statique
// donnees-personnelles.html (mention d'information RGPD complète), même principe que
// pageUrlEspaceStagiaire() dans formulaire-public.js.
let baseUrlDocument = '';
let pageIdDonneesPersonnelles = '';
// 62e échange, tour suivant — pour le lien "Voir les résultats" du panneau staff (renderStaff), qui
// ouvre gestion-stage-fpgc.js directement sur le bon stage. Voir consumeDeepLinkStage() dans
// gestion-stage-fpgc.js pour le mécanisme de transmission (localStorage, pas l'URL — voir sa note),
// et la même déclaration dans formulaire-public.js (valeur DOIT rester identique dans les trois
// fichiers qui la lisent/écrivent).
let pageIdGestionStage = '';

function loadParametresWidgetIntoState() {
  try { satisfactionConfig = JSON.parse(paramWidgetRaw('satisfactionConfig') || '{}'); } catch (err) { satisfactionConfig = {}; }
  baseUrlDocument = paramWidgetRaw('baseUrlDocument') || '';
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
// lien « Données personnelles » du pied de page (hors de #main, voir enquete-satisfaction.html :
// jamais effacé par render()) ; désactivé avec une info-bulle tant que pageIdDonneesPersonnelles
// n'est pas renseigné dans Parametres_widget.
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
    console.error('[Enquête satisfaction FPGC] mise à jour du lien "Données personnelles" du pied de page a échoué (sans incidence sur l\'enquête)', err);
  }
}

function pageUrlDonneesPersonnelles() {
  const doc = baseUrlDocument.trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const id = pageIdDonneesPersonnelles.trim();
  return (doc && id) ? safeUrl(`${doc}/p/${id}`) : '';
}

// Pas de `masquees` ici : contrairement au recrutement, aucune question du socle satisfaction ne
// se masque — seul le caractère facultatif/obligatoire se configure (décision explicite de
// l'utilisateur). `globale` (obligatoireFixe) n'apparaît jamais dans `optionnelles`, y compris si
// elle y figurait par erreur (ex. configuration manuelle malencontreuse) — vérifié à la lecture.
function satisfactionConfigForStage(stageId) {
  const cfg = satisfactionConfig[stageId] || {};
  return { optionnelles: (cfg.optionnelles || []).filter((id) => id !== 'globale'), jamaisConfigure: !satisfactionConfig[stageId] };
}

/* ---------------------------------------------------------------------- */
/* Utilitaires                                                             */
/* ---------------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s === null || s === undefined || s === false ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// FPGC-04 (audit sécurité) : allow-list de protocoles — rejette silencieusement toute URL dont le
// schéma n'est pas http: ou https: (ex. javascript:…) pour éviter l'injection XSS via href. Appliqué
// dans pageUrlGestionStage() et pageUrlDonneesPersonnelles() : un seul point de contrôle par URL
// protège tous les sites d'utilisation en aval.
function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol) ? url : '';
  } catch (e) {
    return '';
  }
}

/* ---------------------------------------------------------------------- */
/* Résolution du stage — voir la note d'architecture en tête de fichier :  */
/* c'est l'ACL (Lecture BD_Stages2 filtrée par Link Key), pas ce code, qui */
/* décide de quelle(s) ligne(s) ce widget reçoit.                          */
/* ---------------------------------------------------------------------- */

const state = {
  phase: 'chargement', // 'chargement' | 'erreur_chargement' | 'invalide' | 'staff' | 'clos' | 'formulaire' | 'envoye'
  stage: null,
  erreurChargement: '',
  // 62e échange, tour suivant — lignes BD_Stages2 reçues quand ce widget est ouvert par un compte
  // académique/national plutôt que via un lien de stage (voir resolveStage()/renderStaff() plus bas).
  // Même mécanisme que state.stagesStaff dans formulaire-public.js (41e échange).
  stagesStaff: null,
};

// Copie exacte de academieLabelForStage() dans formulaire-public.js (voir la note complète là-bas) —
// résout le libellé d'académie d'un stage pour l'affichage du panneau « staff » (renderStaff()), sans
// jamais planter selon l'état de conversion réel de BD_Stages2.Academie_de_formation sur le document.
function academieLabelForStage(stage) {
  const val = stage.Academie_de_formation;
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    const ref = T('Reference').find((r) => r.id === val);
    return ref ? (ref.Academie || '') : '';
  }
  return String(val);
}

// Revert le 2026-08-24 (35e -> 36e échange) : le correctif précédent (bloquer tant que
// Statut_du_stage !== 'Clôturé') partait d'un mauvais diagnostic — l'utilisateur a précisé que
// l'accès à l'enquête DOIT rester possible avant la clôture du stage. Le vrai problème, distinct,
// est que ce fetchTable('BD_Stages2') réussit aussi bien avec la clé de recrutement (user.LinkKey.
// UUID) qu'avec la clé de satisfaction (user.LinkKey.Satisfaction_UUID) — voir acl-academies.md,
// nouvelle section sur ce point : la règle de Lecture de BD_Stages2 les combine par "or" sur la
// MÊME ligne, et ni Grist ni ce widget ne peuvent distinguer après coup laquelle des deux a
// autorisé la lecture. Le correctif se fait côté ACL/architecture, pas ici.
//
// 62e échange, tour suivant — même correctif que resolveStage() dans formulaire-public.js (41e
// échange) : 0 ligne reste 'invalide' (message générique, voir la note d'architecture), >1 ligne est
// désormais dirigé vers un panneau 'staff' dédié (compte académique/national ouvrant la page
// directement) plutôt que traité comme un lien invalide. Règle métier de fermeture INCHANGÉE et
// spécifique à ce fichier : seul 'Annulé' ferme l'enquête (contrairement à formulaire-public.js qui
// ferme aussi sur 'Clôturé' — une enquête de satisfaction est légitimement collectée après la clôture
// du stage, voir la note du 35e/36e échange ci-dessus).
function resolveStage() {
  const rows = T('BD_Stages2');
  if (rows.length === 0) { state.phase = 'invalide'; return; }
  if (rows.length > 1) { state.phase = 'staff'; state.stagesStaff = rows; return; }
  const stage = rows[0];
  if (stage.Statut_du_stage === 'Annulé') { state.phase = 'clos'; state.stage = stage; return; }
  state.stage = stage;
  state.phase = 'formulaire';
}

function modulesDuStage(stage) {
  const rows = T('Planning_du_stage').filter((r) => r.Titre && (!stage || r.Stage === stage.id));
  // Un même intitulé de module peut apparaître sur plusieurs créneaux (rare, mais possible) — on ne
  // demande la satisfaction qu'une seule fois par intitulé distinct, pas une fois par créneau.
  const parTitre = new Map();
  rows.forEach((r) => { if (!parTitre.has(r.Titre)) parTitre.set(r.Titre, r); });
  return [...parTitre.values()].sort((a, b) => (a.Jour || 0) - (b.Jour || 0) || String(a.Heure_de_debut || '').localeCompare(String(b.Heure_de_debut || '')));
}

function moduleQId(titre) { return 'mod_' + titre.replace(/[^a-zA-Z0-9]+/g, '_'); }

/* ---------------------------------------------------------------------- */
/* Rendu                                                                  */
/* ---------------------------------------------------------------------- */

function fieldInputHtml(q) {
  switch (q.type) {
    case 'Choix': {
      const options = q.optionsChoix ? q.optionsChoix.split(';') : [];
      const opts = ['<option value="">— Choisir —</option>', ...options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)].join('');
      return `<select data-q-id="${q.id}">${opts}</select>`;
    }
    case 'Note5': {
      const opts = ['<option value="">— Choisir —</option>', ...[1, 2, 3, 4, 5].map((n) => `<option value="${n}">${n}</option>`)].join('');
      return `<select data-q-id="${q.id}">${opts}</select>`;
    }
    case 'TexteLong':
      return `<textarea data-q-id="${q.id}" rows="3"></textarea>`;
    default:
      return '';
  }
}

function renderMessage(title, body) {
  return `<div class="card"><h2 style="margin:0 0 10px;">${escapeHtml(title)}</h2><p class="field-help">${escapeHtml(body)}</p></div>`;
}

// 62e échange, tour suivant — équivalent, pour l'enquête de satisfaction, de renderStaff() dans
// formulaire-public.js (voir la note complète là-bas) : panneau affiché à un compte académique/
// national qui ouvre cette page directement plutôt que via un lien de stage. Affiche directement
// BD_Stages2.Satisfaction_URL (construit par buildSatisfactionLink() dans gestion-stage-fpgc.js),
// avec un lien "Voir les résultats" vers l'onglet Satisfaction du stage correspondant dans le widget
// de gestion. Pas de repli sur les stages clôturés/annulés : contrairement au recrutement, une enquête
// reste pertinente après la clôture (voir la note de resolveStage() ci-dessus), donc tous les stages
// du périmètre apparaissent dans une seule liste, sans repli <details>.
function renderStaff() {
  const rows = state.stagesStaff || [];
  const academies = new Set(rows.map((r) => academieLabelForStage(r)).filter(Boolean));
  const showAcademieCol = academies.size > 1;
  // 63e échange, tour suivant — demande explicite de l'utilisateur : navigation dans le même onglet
  // par défaut (Ctrl/Cmd+clic pour un nouvel onglet, comportement natif du navigateur). Voir la note
  // équivalente et plus détaillée dans formulaire-public.js (`target="_top"`, pas `target="_blank"`).
  const gestionUrl = pageUrlGestionStage();

  const ligneHtml = (r) => {
    const lien = r.Satisfaction_URL || '';
    const label = escapeHtml(r.Intitule || r.Reference_de_stage || ('Stage #' + r.id));
    const statutColor = r.Statut_du_stage === 'Annulé' ? 'var(--danger)' : (r.Statut_du_stage === 'Clôturé' ? 'var(--text-muted)' : 'var(--ok)');
    const academieCol = showAcademieCol ? `<td>${escapeHtml(academieLabelForStage(r) || '—')}</td>` : '';
    const lienCol = lien
      ? `<div class="link-row"><input type="text" readonly value="${escapeHtml(lien)}"><button type="button" class="btn btn-small pf-staff-copy" data-copy-url="${escapeHtml(lien)}">Copier</button></div>`
      : `<span class="field-help">Lien pas encore généré — à configurer depuis le widget de gestion.</span>`;
    const resultatsCol = gestionUrl
      ? `<a href="${escapeHtml(gestionUrl)}" target="_top" rel="noopener" class="pf-staff-open-gestion" data-stage-id="${r.id}">Voir les résultats</a>`
      : `<span class="field-help">Page de gestion non configurée</span>`;
    return `<tr><td>${label}</td>${academieCol}<td><span style="color:${statutColor};font-weight:600;">${escapeHtml(r.Statut_du_stage || '—')}</span></td><td>${lienCol}</td><td>${resultatsCol}</td></tr>`;
  };

  const tableHtml = rows.length
    ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Stage</th>${showAcademieCol ? '<th>Académie</th>' : ''}<th>Statut</th><th>Lien d'enquête</th><th>Résultats</th></tr></thead><tbody>${rows.map(ligneHtml).join('')}</tbody></table></div>`
    : `<p class="field-help">Aucun stage dans votre périmètre actuel.</p>`;

  return `
    <div class="card">
      <h2 style="margin:0 0 10px;">Liens de satisfaction</h2>
      <p class="field-help">Vous consultez cette page avec un compte du personnel (académique ou national) plutôt que via un lien d'enquête — le formulaire de réponse n'a pas de sens pour ce profil. Voici les liens d'enquête de satisfaction des stages actuellement dans votre périmètre, à copier et transmettre à vos stagiaires.</p>
      ${tableHtml}
    </div>`;
}

// 61e échange — mention courte adaptée à ce formulaire : contrairement à formulaire-public.js, elle
// insiste sur l'ANONYMAT (déjà rappelé juste au-dessus, voir le texte existant "Cette enquête est
// entièrement anonyme...") plutôt que sur la collecte, puisqu'aucune donnée à caractère personnel
// identifiante n'est recueillie ici. Le lien pointe vers la même mention complète, qui couvre
// l'ensemble du dispositif (dont le recrutement, où des données personnelles sont bien collectées).
function mentionCourteRgpdHtml() {
  const url = pageUrlDonneesPersonnelles();
  const lien = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">notre mention d'information</a>`
    : `notre mention d'information (voir « Données personnelles » en pied de page)`;
  return `<p class="field-help">Vos réponses ne sont associées à aucune donnée d'identité et ne peuvent pas être reliées à votre candidature. Pour en savoir plus sur le traitement des données dans le cadre de ce dispositif de formation, consultez ${lien}.</p>`;
}

function renderFormulaire(stage) {
  const cfg = satisfactionConfigForStage(stage.id);
  const optionnelleSet = new Set(cfg.optionnelles);

  const socleHtml = QUESTIONS_SATISFACTION.map((q) => {
    const optionnelle = q.obligatoireFixe ? false : (cfg.jamaisConfigure ? !q.obligatoireParDefaut : optionnelleSet.has(q.id));
    return `
      <div class="field" data-q-wrap="${q.id}">
        <label>${escapeHtml(q.libelle)}${optionnelle ? '' : ' *'}</label>
        ${fieldInputHtml(q)}
      </div>`;
  }).join('');

  const modules = modulesDuStage(stage);
  const modulesHtml = modules.length
    ? modules.map((m) => `
        <div class="field" data-q-wrap="${moduleQId(m.Titre)}">
          <label>Le module « ${escapeHtml(m.Titre)} » répond à mes besoins professionnels. *</label>
          <select data-q-id="${moduleQId(m.Titre)}">
            <option value="">— Choisir —</option>
            ${ECHELLE_MODULE.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}
          </select>
        </div>`).join('')
    : '<p class="field-help">Le planning de ce stage n\'a pas encore été publié : aucun module à évaluer individuellement pour le moment.</p>';

  return `
    <div class="card">
      <h2 style="margin:0 0 4px;">Enquête de satisfaction</h2>
      <p class="section-sub">${escapeHtml(stage.Intitule || stage.Reference_de_stage || '')}</p>
      <p class="field-help">Cette enquête est entièrement anonyme : aucune réponse n'est reliée à votre identité ni à votre candidature. Les champs marqués d'un * sont obligatoires.</p>
      ${socleHtml}
    </div>
    <div class="card">
      <h2 style="margin:0 0 10px;">Évaluation des modules</h2>
      ${modulesHtml}
      ${mentionCourteRgpdHtml()}
    </div>
    <p class="status-note" id="sf-status"></p>
    <div class="actions-bar"><button type="button" class="btn btn-primary" id="sf-submit">Envoyer mes réponses</button></div>`;
}

function render() {
  const main = document.getElementById('main');
  if (state.phase === 'chargement') { main.innerHTML = renderMessage('Chargement…', 'Merci de patienter.'); return; }
  if (state.phase === 'erreur_chargement') { main.innerHTML = renderMessage('Erreur de chargement', "L'enquête n'a pas pu se charger. (Détail technique : " + state.erreurChargement + ')'); return; }
  if (state.phase === 'invalide') { main.innerHTML = renderMessage('Lien invalide', "Ce lien n'est plus valable ou ne correspond à aucune enquête ouverte. Merci de contacter l'organisation du stage pour obtenir un lien à jour."); return; }
  if (state.phase === 'staff') { main.innerHTML = renderStaff(); bindStaff(); return; }
  if (state.phase === 'clos') { main.innerHTML = renderMessage('Enquête indisponible', `Le stage « ${state.stage.Intitule || state.stage.Reference_de_stage} » a été annulé : l'enquête de satisfaction n'est plus accessible.`); return; }
  if (state.phase === 'envoye') { main.innerHTML = renderMessage('Merci !', 'Vos réponses ont bien été enregistrées, de façon anonyme.'); return; }
  if (state.phase === 'formulaire') { main.innerHTML = renderFormulaire(state.stage); bindFormulaire(state.stage); return; }
}

/* ---------------------------------------------------------------------- */
/* Interaction                                                            */
/* ---------------------------------------------------------------------- */

// Copie de bindStaff() dans formulaire-public.js (voir la note complète là-bas) : bouton copier pour
// chaque lien d'enquête, et écriture de l'entrée localStorage juste avant l'ouverture du lien "Voir
// les résultats" (target="_top" depuis le 63e échange, tour suivant — déjà porté par le lien lui-même
// dans le HTML) — voir ecrireDeepLinkStage() et la note dans consumeDeepLinkStage()
// (gestion-stage-fpgc.js). Onglet cible 'satisfaction', contrairement à 'stagiaires' côté recrutement.
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
  document.querySelectorAll('.pf-staff-open-gestion').forEach((el) => {
    el.addEventListener('click', () => {
      const stageId = Number(el.getAttribute('data-stage-id'));
      if (stageId) ecrireDeepLinkStage(stageId, 'satisfaction');
    });
  });
}

function bindFormulaire(stage) {
  document.getElementById('sf-submit').addEventListener('click', async () => {
    const statusEl = document.getElementById('sf-status');
    const cfg = satisfactionConfigForStage(stage.id);
    const optionnelleSet = new Set(cfg.optionnelles);
    const fields = {};
    const manquantes = [];

    for (const q of QUESTIONS_SATISFACTION) {
      const el = document.querySelector(`[data-q-id="${q.id}"]`);
      if (!el) continue;
      const optionnelle = q.obligatoireFixe ? false : (cfg.jamaisConfigure ? !q.obligatoireParDefaut : optionnelleSet.has(q.id));
      const raw = el.value;
      if (!raw) { if (!optionnelle) manquantes.push(q.libelle); continue; }
      fields[q.colonneCible] = q.type === 'Note5' ? Number(raw) : raw;
    }

    const modules = modulesDuStage(stage);
    const reponsesModules = [];
    for (const m of modules) {
      const el = document.querySelector(`[data-q-id="${moduleQId(m.Titre)}"]`);
      const raw = el ? el.value : '';
      if (!raw) { manquantes.push('Module « ' + m.Titre + ' »'); continue; }
      reponsesModules.push({ Titre: m.Titre, Reponse: raw });
    }

    if (manquantes.length) { statusEl.textContent = 'Merci de renseigner : ' + manquantes.join(', ') + '.'; return; }

    fields.Stage = stage.id;
    // FPGC-02 (70e échange) : Date_de_reponse supprimé du payload client — désormais calculé par
    // une trigger formula Grist "New records" (NOW() en epoch). Cela élimine la falsification de
    // l'horodatage de réponse (CWE-602, CWE-915).
    // Stage est conservé côté client : sans colonne de référence vers Candidats_du_stage dans
    // Enquete_de_satisfaction, Grist ne peut pas le déduire seul. La protection passe par une
    // ACL de colonne interdisant à l'utilisateur lien public d'écrire une valeur différente de
    // celle attendue (voir acl-academies.md, 70e échange).

    const submitBtn = document.getElementById('sf-submit');
    submitBtn.disabled = true;
    statusEl.textContent = 'Envoi en cours…';
    try {
      // Deux appels séquentiels (pas un seul batché) : le second a besoin de l'id retourné par le
      // premier pour rattacher chaque évaluation de module à la bonne ligne Enquete_de_satisfaction
      // — même mécanisme que addRecord()/addRecords() dans gestion-stage-fpgc.js.
      const res = await grist.docApi.applyUserActions([['AddRecord', 'Enquete_de_satisfaction', null, fields]]);
      const enqueteId = res.retValues[0];
      if (reponsesModules.length) {
        const actions = reponsesModules.map((r) => ['AddRecord', 'Satisfaction_modules', null, { Enquete: enqueteId, Titre_module: r.Titre, Reponse: r.Reponse }]);
        await grist.docApi.applyUserActions(actions);
      }
      state.phase = 'envoye';
      render();
    } catch (err) {
      console.error('[Enquête satisfaction FPGC]', err);
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
    console.error('[Enquête satisfaction FPGC] échec du chargement initial', err);
    state.phase = 'erreur_chargement';
    state.erreurChargement = (err && (err.message || String(err))) || 'erreur inconnue';
  }
  render();
}

boot();