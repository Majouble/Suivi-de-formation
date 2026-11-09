/* Suivi FPGC — widget « Accueil de l'espace Grist »
 *
 * 67e échange, tour suivant — nouvelle demande de l'utilisateur : « Rédige moi une page d'accueil
 * de présentation de l'espace Grist. Elle comportera un sommaire détaillé avec des liens renvoyant
 * vers les différentes vues du document. »
 *
 * Note d'architecture (fichier autonome, comme tous les autres de ce projet — voir la convention de
 * duplication déjà en place dans gestion-stage-fpgc.js/espace-stagiaire.js/etc., pas de fichier
 * partagé). Ce widget est volontairement le plus simple de tous ceux du projet : il ne lit qu'UNE
 * seule table (`Parametres_widget`), n'écrit jamais rien, et n'a qu'un seul rôle — reconstruire,
 * pour chaque page du document, son URL (mécanisme `baseUrlDocument` + `pageIdXxx`, voir la note
 * détaillée au 35e échange dans gestion-stage-fpgc.js) et présenter un sommaire de navigation.
 *
 * Pourquoi ce mécanisme plutôt que des URL codées en dur dans ce fichier : les numéros de page
 * (`/p/N`) ne sont connus qu'une fois chaque page réellement créée dans le document Grist réel, et
 * diffèrent d'un document à l'autre (production vs copie de test). Coder ces URL en dur aurait
 * obligé à modifier ce fichier à chaque nouvel hébergement — au lieu de cela, comme pour toutes les
 * pages publiques du projet, elles sont lues depuis la table `Parametres_widget` (Cle/Valeur),
 * renseignée une fois par l'administrateur du document. Tant qu'une clé manque, le lien correspondant
 * reste affiché mais désactivé, avec une explication — jamais un lien cassé.
 *
 * Accès : cette page ne lit que `Parametres_widget`, déjà lisible par tout profil authentifié (et
 * même par l'anonyme, voir acl-academies.md §21) — aucune nouvelle règle ACL n'est nécessaire pour
 * que ce widget fonctionne. `requiredAccess: 'full'` est demandé uniquement par cohérence avec tous
 * les autres widgets de ce projet (aucun n'utilise un niveau plus restreint) ; ce widget lui-même
 * n'effectue jamais aucune écriture.
 */

grist.ready({ requiredAccess: 'full' });

/* ---------------------------------------------------------------------- */
/* Constantes                                                              */
/* ---------------------------------------------------------------------- */

const TABLES = ['Parametres_widget'];

// Une entrée par vue/page du document. `pageIdKey` est la clé Parametres_widget qui porte le
// numéro de page (voir pageUrlFor ci-dessous) ; `legacyKey`, quand renseignée, est l'ancienne clé
// d'URL complète déjà utilisée par d'autres widgets de ce projet avant le 35e échange, conservée ici
// en repli pour un document déjà configuré à l'ancienne — voir pageUrlFor. `staffNote`, quand
// renseignée, prévient l'utilisateur du personnel qu'ouvrir ce lien sans passer par un lien personnel
// affichera la vue « Staff » de la page plutôt que l'espace d'un candidat/stagiaire précis (65e/63e/
// 41e échanges) — comportement voulu, pas une erreur.
const VUES = [
  {
    categorie: 'pilotage',
    titre: 'Gestion des stages',
    description: "Widget principal de gestion administrative d'un stage : création, informations générales, préparation logistique, recrutement des stagiaires, ingénierie pédagogique (équipe, sous-groupes, planning), émargement et clôture.",
    pageIdKey: 'pageIdGestionStage',
    legacyKey: '',
  },
  {
    categorie: 'pilotage',
    titre: 'Pilotage académique',
    description: "Tableau de bord de pilotage pour une académie : indicateurs clés, carte des établissements, comparaison au prévisionnel. Chaque académie n'y voit que ses propres données.",
    pageIdKey: 'pageIdPilotageAcademique',
    legacyKey: '',
  },
  {
    categorie: 'pilotage',
    titre: 'Pilotage national',
    description: "Vue agrégée et comparaison inter-académies, réservée à la direction nationale.",
    pageIdKey: 'pageIdPilotageNational',
    legacyKey: '',
  },

  {
    categorie: 'pilotage',
    titre: 'Annuaire FPGC',
    description: "Table brute de l'annuaire des personnels formés (Annuaire_FPGC) : historique des stages suivis par chaque personnel. Consultation directe, hors widget — réservée à un usage technique/avancé.",
    pageIdKey: 'pageIdAnnuaireFPGC',
    legacyKey: '',
  },
  {
    categorie: 'candidats',
    titre: 'Formulaire de candidature',
    description: "Formulaire public de candidature à un stage, normalement ouvert via le lien de recrutement dédié à ce stage (voir l'onglet Stagiaires du widget de gestion).",
    pageIdKey: 'pageIdFormulairePublic',
    legacyKey: 'baseUrlFormulairePublic',
    staffNote: "Ouvert depuis ce sommaire (sans lien de recrutement), cette page affiche la vue « Staff » (liste des liens de recrutement en cours) plutôt qu'un formulaire de candidature.",
  },
  {
    categorie: 'candidats',
    titre: 'Espace stagiaire',
    description: "Espace personnel d'un stagiaire (planning, émargement, sous-groupe), normalement ouvert via son lien personnel.",
    pageIdKey: 'pageIdEspaceStagiaire',
    legacyKey: 'baseUrlEspaceStagiaire',
    staffNote: "Ouvert depuis ce sommaire (sans lien personnel), cette page affiche la vue « Staff » (accès stagiaires par stage) plutôt que l'espace d'un stagiaire précis.",
  },
  {
    categorie: 'candidats',
    titre: 'Enquête de satisfaction',
    description: "Enquête de satisfaction anonyme d'un stage, normalement ouverte via son lien dédié à l'issue du stage (voir l'onglet Clôture du stage du widget de gestion).",
    pageIdKey: 'pageIdEnqueteSatisfaction',
    legacyKey: 'baseUrlEnqueteSatisfaction',
    staffNote: "Ouvert depuis ce sommaire (sans lien dédié), cette page affiche la vue « Staff » (résultats en cours) plutôt qu'un formulaire de réponse.",
  },
  {
    categorie: 'legal',
    titre: 'Mentions RGPD',
    description: "Mention d'information relative aux données personnelles (RGPD), destinée aux candidats, stagiaires et personnels concernés par le dispositif.",
    pageIdKey: 'pageIdDonneesPersonnelles',
    legacyKey: '',
  },
];

const CATEGORIES = [
  { id: 'pilotage', titre: 'Pilotage et gestion des stages', note: 'Usage interne (personnel académique et national).' },
  { id: 'candidats', titre: 'Parcours candidats et stagiaires', note: "Pages publiques du dispositif, normalement ouvertes via un lien personnel ou de recrutement transmis à la personne concernée — voir la remarque sur chaque carte." },
  { id: 'legal', titre: 'Informations légales', note: '' },
];

const DB = {};
const state = { options: {} };

/* ---------------------------------------------------------------------- */
/* Accès aux données Grist                                                 */
/* ---------------------------------------------------------------------- */

function T(tableId) { return (DB[tableId] && DB[tableId].rows) || []; }

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

// Table `Parametres_widget` (Cle Text, Valeur Text) — voir la note identique dans
// gestion-stage-fpgc.js.
function paramWidgetRaw(cle) {
  const row = T('Parametres_widget').find((r) => r.Cle === cle);
  return row ? row.Valeur : '';
}

function loadParametresWidgetIntoState() {
  state.options.baseUrlDocument = paramWidgetRaw('baseUrlDocument') || '';
  VUES.forEach((v) => {
    state.options[v.pageIdKey] = paramWidgetRaw(v.pageIdKey) || '';
    if (v.legacyKey) state.options[v.legacyKey] = paramWidgetRaw(v.legacyKey) || '';
  });
  state.options.pageIdDonneesPersonnelles = paramWidgetRaw('pageIdDonneesPersonnelles') || '';
  updateFooterLienDonnees();
}

// Identique à gestion-stage-fpgc.js::pageUrlFor (dupliqué par convention du projet, voir en-tête de
// fichier) — construit l'URL d'une page à partir de l'URL de base commune du document + son numéro
// de page, avec repli sur une éventuelle ancienne URL complète.
function pageUrlFor(pageId, legacyFullUrl) {
  const doc = (state.options.baseUrlDocument || '').trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const id = (pageId || '').toString().trim();
  if (doc && id) return `${doc}/p/${id}`;
  return legacyFullUrl || '';
}

function urlForVue(v) {
  return pageUrlFor(state.options[v.pageIdKey], v.legacyKey ? state.options[v.legacyKey] : '');
}

function updateFooterLienDonnees() {
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
    console.error('[Accueil de l\'espace Grist] mise à jour du lien "Données personnelles" du pied de page a échoué (sans incidence sur le reste du widget)', err);
  }
}

/* ---------------------------------------------------------------------- */
/* Aides diverses (dupliquées, convention du projet — pas de fichier partagé) */
/* ---------------------------------------------------------------------- */

function escapeHtml(s) {
  return String(s === null || s === undefined || s === false ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function slugify(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* ---------------------------------------------------------------------- */
/* Rendu                                                                   */
/* ---------------------------------------------------------------------- */

function viewCardHtml(v) {
  const anchorId = 'vue-' + slugify(v.titre);
  const url = urlForVue(v);
  const linkHtml = url
    ? `<a href="${escapeHtml(url)}" target="_top" rel="noopener" class="btn btn-primary" data-vue-link data-vue-titre="${escapeHtml(v.titre)}">Ouvrir</a>`
    : `<span class="view-card-disabled-link" data-vue-disabled data-vue-titre="${escapeHtml(v.titre)}" title="Page non encore configurée — voir la clé &quot;${escapeHtml(v.pageIdKey)}&quot; dans la table Parametres_widget">Page non encore configurée</span>`;
  const staffNoteHtml = v.staffNote ? `<p class="view-card-staff-note">${escapeHtml(v.staffNote)}</p>` : '';
  return `
    <div class="card view-card" id="${anchorId}">
      <h3>${escapeHtml(v.titre)}</h3>
      <p>${escapeHtml(v.description)}</p>
      ${staffNoteHtml}
      ${linkHtml}
    </div>`;
}

function tocHtml() {
  return `
    <nav class="toc" aria-label="Sommaire">
      <h2>Sommaire</h2>
      ${CATEGORIES.map((cat) => {
        const vues = VUES.filter((v) => v.categorie === cat.id);
        return `
          <div class="toc-cat">
            <span class="toc-cat-label">${escapeHtml(cat.titre)}</span>
            <ol>
              ${vues.map((v) => {
                const disabled = !urlForVue(v);
                const anchorId = 'vue-' + slugify(v.titre);
                return `<li><a href="#${anchorId}" class="${disabled ? 'toc-disabled' : ''}">${escapeHtml(v.titre)}${disabled ? ' (non configurée)' : ''}</a></li>`;
              }).join('')}
            </ol>
          </div>`;
      }).join('')}
    </nav>`;
}

function render() {
  const doc = state.options.baseUrlDocument || '';
  const warningHtml = !doc
    ? `<div class="warning-banner" id="warningBaseUrl">⚠ L'URL de base du document (clé <code>baseUrlDocument</code> de la table « Parametres_widget ») n'est pas encore configurée : aucun lien de ce sommaire ne fonctionnera tant qu'elle n'est pas renseignée par l'administrateur du document.</div>`
    : '';

  const sectionsHtml = CATEGORIES.map((cat) => {
    const vues = VUES.filter((v) => v.categorie === cat.id);
    if (!vues.length) return '';
    return `
      <section class="cat-section" id="cat-${cat.id}">
        <h2>${escapeHtml(cat.titre)}</h2>
        ${cat.note ? `<p class="cat-note">${escapeHtml(cat.note)}</p>` : ''}
        <div class="view-grid">
          ${vues.map(viewCardHtml).join('')}
        </div>
      </section>`;
  }).join('');

  document.getElementById('main').innerHTML = `
    <div class="card">
      <p class="lede">
        Ce document Grist regroupe l'ensemble du dispositif de suivi des stages de formation
        professionnelle FPGC : gestion administrative des stages, pilotage académique et national,
        parcours de candidature et de suivi des stagiaires, ainsi que les données brutes
        sous-jacentes. Cette page d'accueil sert de point d'entrée — utilisez le sommaire ci-dessous
        pour rejoindre directement la vue qui vous concerne.
      </p>
    </div>
    ${warningHtml}
    ${tocHtml()}
    ${sectionsHtml}
  `;
}

/* ---------------------------------------------------------------------- */
/* Démarrage                                                               */
/* ---------------------------------------------------------------------- */

async function boot() {
  try {
    await loadAll();
    loadParametresWidgetIntoState();
    document.getElementById('topbarSub').textContent = "Point d'entrée du dispositif de suivi FPGC";
    render();
  } catch (err) {
    document.getElementById('topbarSub').textContent = 'Erreur de chargement';
    console.error(err);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();