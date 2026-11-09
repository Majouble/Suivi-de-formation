grist.ready({ requiredAccess: 'full' });

const DEMI_JOURNEES = ['Matin', 'Après-midi'];




const ICON_CHEVRON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"></path></svg>';



const FPGC_LS_CLE = 'fpgc_espace_cle_memorisee'; 
const FPGC_LS_NOM = 'fpgc_espace_nom_memorise'; 
const FPGC_LS_PENDING = 'fpgc_espace_tentative_pendante'; 





const TABLES = ['Candidats_du_stage', 'BD_Stages2', 'Planning_du_stage', 'Emargement_du_stage', 'Parametres_widget'];














const TABLES_OPTIONNELLES = ['Intervenants_du_stage'];

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
  
  
  await Promise.allSettled(TABLES_OPTIONNELLES.map(loadTable));
}

function T(tableId) { return (DB[tableId] && DB[tableId].rows) || []; }





function escapeHtml(s) {
  return String(s === null || s === undefined || s === false ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDateFr(epoch) {
  if (epoch === null || epoch === undefined || epoch === false) return '—';
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(epoch * 1000));
}



function paramWidgetRaw(cle) {
  const row = T('Parametres_widget').find((r) => r.Cle === cle);
  return row ? row.Valeur : '';
}










function pageUrlFor(pageId) {
  const doc = (paramWidgetRaw('baseUrlDocument') || '').trim().split('?')[0].split('#')[0].replace(/\/+$/, '');
  const id = (pageId || '').toString().trim();
  return (doc && id) ? `${doc}/p/${id}` : '';
}









function lireTentativePendante() {
  try {
    const raw = sessionStorage.getItem(FPGC_LS_PENDING);
    if (!raw) return null;
    sessionStorage.removeItem(FPGC_LS_PENDING);
    return JSON.parse(raw);
  } catch (err) {
    return null; 
                 
  }
}

function lireCleMemorisee() {
  try { return localStorage.getItem(FPGC_LS_CLE) || ''; } catch (err) { return ''; }
}

function lireNomMemorise() {
  try { return localStorage.getItem(FPGC_LS_NOM) || ''; } catch (err) { return ''; }
}

function oublierCleMemorisee() {
  try {
    localStorage.removeItem(FPGC_LS_CLE);
    localStorage.removeItem(FPGC_LS_NOM);
  } catch (err) {  }
}

function memoriserCle(cle, nomComplet) {
  try {
    localStorage.setItem(FPGC_LS_CLE, cle);
    localStorage.setItem(FPGC_LS_NOM, nomComplet || '');
  } catch (err) {  }
}







const state = {
  phase: 'chargement', 
  stage: null,
  stagiaire: null,
  stagiairesStaff: null, 
  erreurChargement: '',
  erreurConnexion: '', 
  melSaisi: '', 
  nomMemorise: '', 
  avertissementMel: false, 
                            
};

function resolveStagiaire() {
  const rows = T('Candidats_du_stage');
  const pending = lireTentativePendante();

  
  
  
  
  
  
  
  
  
  
  
  
  
  const cleConnue = (pending && pending.motDePasse) || lireCleMemorisee();
  let moi = null;
  if (rows.length === 1) {
    moi = rows[0];
  } else if (rows.length > 1 && cleConnue) {
    moi = rows.find((r) => r.UUID_personnel === cleConnue) || null;
  }

  if (moi) {
    state.stagiaire = moi;
    
    
    
    
    state.stage = T('BD_Stages2')[0] || null;
    state.phase = 'espace';
    if (pending && pending.motDePasse) {
      
      
      
      const nomComplet = [state.stagiaire.Prenom, state.stagiaire.Nom].filter(Boolean).join(' ');
      memoriserCle(pending.motDePasse, nomComplet);
      if (pending.mel && state.stagiaire.Mel
          && pending.mel.trim().toLowerCase() !== String(state.stagiaire.Mel).trim().toLowerCase()) {
        
        
        state.avertissementMel = true;
      }
    }
    return;
  }

  
  
  
  if (pending && pending.auto) {
    
    
    
    oublierCleMemorisee();
    state.phase = 'connexion';
    state.erreurConnexion = "Votre connexion précédente n'est plus valable. Merci de vous reconnecter.";
    return;
  }
  if (pending && !pending.auto) {
    
    state.phase = 'connexion';
    state.melSaisi = pending.mel || '';
    state.erreurConnexion = 'Identifiant ou mot de passe incorrect.';
    return;
  }
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  
  if (rows.length > 1 && !cleConnue) {
    const CHAMPS_RESERVES_A_MOI = ['Mel', 'UUID_personnel', 'Lien_personnel'];
    const stagesDistincts = new Set(rows.map((r) => r.Stage)).size;
    const lignesAccesPlein = rows.filter((r) => CHAMPS_RESERVES_A_MOI.some((c) => r[c])).length;
    if (stagesDistincts > 1 || lignesAccesPlein > 1) {
      state.phase = 'staff';
      state.stagiairesStaff = rows;
      return;
    }
  }
  
  
  
  const cleMemorisee = lireCleMemorisee();
  if (cleMemorisee) {
    state.nomMemorise = lireNomMemorise();
    state.phase = 'reconnexion';
  } else {
    state.phase = 'connexion';
  }
}





function renderMessage(title, body) {
  return `<div class="card"><h2 style="margin:0 0 10px;">${escapeHtml(title)}</h2><p class="field-help">${escapeHtml(body)}</p></div>`;
}






function renderConnexion() {
  const baseUrl = pageUrlFor(paramWidgetRaw('pageIdEspaceStagiaire'));
  const messageConfig = !baseUrl
    ? '<p class="status-note">Cette page n\'est pas encore configurée (paramètre baseUrlDocument/pageIdEspaceStagiaire manquant dans Parametres_widget). Merci de contacter l\'organisation du stage.</p>'
    : '';
  return `
    <div class="card">
      <h2 style="margin:0 0 4px;">Espace stagiaire</h2>
      <p class="section-sub">Connectez-vous avec l'adresse mél et le mot de passe qui vous ont été communiqués.</p>
      ${messageConfig}
      <form id="form-connexion" method="GET"${baseUrl ? ` action="${escapeHtml(baseUrl)}"` : ''} target="_top">
        <input type="hidden" name="style" value="singlePage">
        <div class="field">
          <label for="cx-mel">Adresse mél</label>
          <input type="email" id="cx-mel" autocomplete="email" value="${escapeHtml(state.melSaisi)}" required>
        </div>
        <div class="field">
          <label for="cx-mdp">Mot de passe</label>
          <input type="password" id="cx-mdp" name="CandidatUUID_" autocomplete="current-password" required>
        </div>
        <p class="status-note">${escapeHtml(state.erreurConnexion)}</p>
        <div class="actions-bar">
          <button type="submit" class="btn btn-primary" ${baseUrl ? '' : 'disabled'}>Se connecter</button>
        </div>
      </form>
    </div>`;
}

function renderReconnexion() {
  const baseUrl = pageUrlFor(paramWidgetRaw('pageIdEspaceStagiaire'));
  const cle = lireCleMemorisee();
  const messageConfig = !baseUrl
    ? '<p class="status-note">Cette page n\'est pas encore configurée (paramètre baseUrlDocument/pageIdEspaceStagiaire manquant dans Parametres_widget). Merci de contacter l\'organisation du stage.</p>'
    : '';
  const salutation = state.nomMemorise
    ? ` en tant que <strong>${escapeHtml(state.nomMemorise)}</strong>`
    : '';
  return `
    <div class="card">
      <h2 style="margin:0 0 4px;">Espace stagiaire</h2>
      <p class="section-sub">Ce navigateur a déjà été connecté${salutation}.</p>
      ${messageConfig}
      <form id="form-reconnexion" method="GET"${baseUrl ? ` action="${escapeHtml(baseUrl)}"` : ''} target="_top">
        <input type="hidden" name="style" value="singlePage">
        <input type="hidden" name="CandidatUUID_" value="${escapeHtml(cle)}">
        <div class="actions-bar">
          <button type="submit" class="btn btn-primary" ${baseUrl ? '' : 'disabled'}>Continuer${salutation}</button>
          <button type="button" id="btn-pas-moi" class="btn btn-small">Ce n'est pas moi</button>
        </div>
      </form>
    </div>`;
}








function renderStaff() {
  const rows = state.stagiairesStaff || [];
  const stages = T('BD_Stages2');
  const stageLabel = (stageId) => {
    const s = stages.find((x) => x.id === stageId);
    if (s) return s.Intitule || s.Reference_de_stage || ('Stage #' + stageId);
    return 'Stage #' + stageId;
  };

  const parStage = new Map();
  rows.forEach((r) => {
    const key = r.Stage || 0;
    if (!parStage.has(key)) parStage.set(key, []);
    parStage.get(key).push(r);
  });

  const ligneHtml = (c) => {
    const nom = escapeHtml([c.Prenom, c.Nom].filter(Boolean).join(' ') || 'Stagiaire');
    const lien = c.Lien_personnel || '';
    const lienCol = lien
      ? `<div class="link-row"><input type="text" readonly value="${escapeHtml(lien)}"><button type="button" class="btn btn-small es-staff-copy" data-copy="${escapeHtml(lien)}">Copier</button></div>`
      : '<span class="field-help">Lien pas encore généré — à configurer depuis le widget de gestion.</span>';
    const motDePasse = c.UUID_personnel
      ? `<div class="link-row"><input type="text" readonly value="${escapeHtml(c.UUID_personnel)}" class="mono"><button type="button" class="btn btn-small es-staff-copy" data-copy="${escapeHtml(c.UUID_personnel)}">Copier</button></div>`
      : '<span class="field-help">—</span>';
    return `<tr><td>${nom}</td><td>${lienCol}</td><td>${motDePasse}</td></tr>`;
  };

  const stageIds = [...parStage.keys()].sort((a, b) => stageLabel(a).localeCompare(stageLabel(b), 'fr'));
  const tiroirsHtml = stageIds.map((stageId, idx) => {
    const candidats = parStage.get(stageId).slice().sort((a, b) =>
      String(a.Nom || '').localeCompare(String(b.Nom || ''), 'fr') || String(a.Prenom || '').localeCompare(String(b.Prenom || ''), 'fr'));
    const bodyId = 'es-staff-body-' + idx;
    return `
      <div class="accordion-cat">
        <button type="button" class="accordion-head" data-es-staff-toggle aria-expanded="false" aria-controls="${bodyId}">
          <div class="accordion-head-left">${ICON_CHEVRON}<span class="accordion-cat-name">${escapeHtml(stageLabel(stageId))}</span></div>
          <span class="accordion-cat-meta">${candidats.length} stagiaire${candidats.length > 1 ? 's' : ''}</span>
        </button>
        <div class="accordion-body" id="${bodyId}" hidden>
          <div class="table-scroll"><table class="data-table">
            <thead><tr><th>Stagiaire</th><th>Lien personnel</th><th>Mot de passe</th></tr></thead>
            <tbody>${candidats.map(ligneHtml).join('')}</tbody>
          </table></div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="card">
      <h2 style="margin:0 0 10px;">Accès stagiaires</h2>
      <p class="field-help">Vous consultez cette page avec un compte du personnel (académique ou national) plutôt que via un lien personnel de stagiaire. Voici les accès des stagiaires actuellement dans votre périmètre, groupés par stage — pratique pour retransmettre un lien ou un mot de passe perdu sans rouvrir le widget de gestion.</p>
      ${tiroirsHtml || '<p class="field-help">Aucun stagiaire dans votre périmètre actuel.</p>'}
    </div>`;
}

function renderEspace() {
  const candidat = state.stagiaire;
  const stage = state.stage;

  
  
  
  
  const sousGroupeMembres = candidat.Sous_groupe
    ? T('Candidats_du_stage')
      .filter((r) => (!stage || r.Stage === stage.id) && r.Sous_groupe === candidat.Sous_groupe)
      .sort((a, b) => String(a.Nom || '').localeCompare(String(b.Nom || ''), 'fr') || String(a.Prenom || '').localeCompare(String(b.Prenom || ''), 'fr'))
    : [];
  const sousGroupeHtml = !candidat.Sous_groupe
    ? '<p class="field-help">Vous n\'avez pas encore été affecté à un sous-groupe.</p>'
    : `<ul id="sg-liste" style="margin:0;padding-left:20px;">${sousGroupeMembres.map((m) => (
        '<li>' + escapeHtml([m.Prenom, m.Nom].filter(Boolean).join(' ') || 'Stagiaire')
        + (m.id === candidat.id ? ' <span class="field-help" style="display:inline;">(vous)</span>' : '')
        + '</li>'
      )).join('')}</ul>`;

  const planning = T('Planning_du_stage')
    .filter((r) => !stage || r.Stage === stage.id)
    .sort((a, b) => (a.Jour || 0) - (b.Jour || 0) || String(a.Heure_de_debut || '').localeCompare(String(b.Heure_de_debut || '')));
  const parJour = new Map();
  planning.forEach((r) => {
    const key = r.Jour || 0;
    if (!parJour.has(key)) parJour.set(key, []);
    parJour.get(key).push(r);
  });
  
  
  
  
  
  
  
  const nomIntervenant = (c) => {
    if (!c.Intervenant) return '—';
    const interv = T('Intervenants_du_stage').find((i) => i.id === c.Intervenant);
    return interv ? escapeHtml(interv.Nom || '—') : '—';
  };

  const planningHtml = parJour.size
    ? [...parJour.entries()].map(([jour, creneaux]) => `
        <p class="section-sub" style="margin-top:14px;"><strong>${escapeHtml(fmtDateFr(jour))}</strong></p>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Horaire</th><th>Titre</th><th>Formateur / intervenant</th><th>Modalité</th></tr></thead>
          <tbody>${creneaux.map((c) => `<tr><td>${escapeHtml(c.Heure_de_debut || '')}${c.Duree ? ' (' + escapeHtml(c.Duree) + ' min)' : ''}</td><td>${escapeHtml(c.Titre || '')}</td><td>${nomIntervenant(c)}</td><td>${escapeHtml(c.Modalite || '')}</td></tr>`).join('')}</tbody>
        </table></div>`).join('')
    : '<p class="field-help">Le planning de ce stage n\'est pas encore publié.</p>';

  const emargements = T('Emargement_du_stage')
    .filter((r) => r.Candidat === candidat.id)
    .sort((a, b) => (a.Jour || 0) - (b.Jour || 0) || DEMI_JOURNEES.indexOf(a.Demi_journee) - DEMI_JOURNEES.indexOf(b.Demi_journee));
  const emargJour = new Map();
  emargements.forEach((r) => {
    const key = r.Jour || 0;
    if (!emargJour.has(key)) emargJour.set(key, []);
    emargJour.get(key).push(r);
  });
  const emargementHtml = emargJour.size
    ? [...emargJour.entries()].map(([jour, creneaux]) => `
        <div class="field" style="margin-top:10px;">
          <label style="text-transform:none;letter-spacing:0;font-weight:600;">${escapeHtml(fmtDateFr(jour))}</label>
          <div class="row-inline" style="gap:20px;flex-wrap:wrap;">
            ${creneaux.map((c) => `
              <label class="row-inline" style="font-weight:400;">
                <input type="checkbox" class="em-toggle" data-em-id="${c.id}" ${c.Present ? 'checked' : ''}> ${escapeHtml(c.Demi_journee || '')}
              </label>`).join('')}
          </div>
        </div>`).join('')
    : '<p class="field-help">Aucune feuille d\'émargement n\'a encore été préparée pour vous.</p>';

  
  
  
  const avertissementHtml = state.avertissementMel
    ? `<div class="card" style="border-color:var(--warn);"><p class="field-help" style="color:var(--warn);margin:0;">L'adresse mél saisie ne correspond pas exactement à celle enregistrée pour vous. Cela n'empêche pas l'accès à votre espace ; si vous pensez qu'il ne s'agit pas de vous, merci de contacter l'organisation du stage.</p></div>`
    : '';

  return `
    ${avertissementHtml}
    <div class="card">
      <h2 style="margin:0 0 4px;">${escapeHtml(candidat.Nom || '')} ${escapeHtml(candidat.Prenom || '')}</h2>
      <p class="section-sub">${escapeHtml(stage && (stage.Intitule || stage.Reference_de_stage) || 'Stage')}${candidat.Sous_groupe ? ' — Sous-groupe : ' + escapeHtml(candidat.Sous_groupe) : ''}</p>
    </div>
    <div class="card">
      <h2 style="margin:0 0 10px;">Mon sous-groupe${candidat.Sous_groupe ? ' — ' + escapeHtml(candidat.Sous_groupe) : ''}</h2>
      ${sousGroupeHtml}
    </div>
    <div class="card">
      <h2 style="margin:0 0 10px;">Planning</h2>
      ${planningHtml}
    </div>
    <div class="card">
      <h2 style="margin:0 0 10px;">Mon émargement</h2>
      <p class="field-help">Cochez chaque demi-journée à laquelle vous avez bien assisté.</p>
      <p class="status-note" id="em-status"></p>
      ${emargementHtml}
    </div>`;
}

function render() {
  const main = document.getElementById('main');
  if (state.phase === 'chargement') { main.innerHTML = renderMessage('Chargement…', 'Merci de patienter.'); return; }
  if (state.phase === 'erreur_chargement') { main.innerHTML = renderMessage('Erreur de chargement', "Cette page n'a pas pu se charger. (Détail technique : " + state.erreurChargement + ')'); return; }
  if (state.phase === 'connexion') { main.innerHTML = renderConnexion(); bindConnexion(); return; }
  if (state.phase === 'reconnexion') { main.innerHTML = renderReconnexion(); bindReconnexion(); return; }
  if (state.phase === 'espace') { main.innerHTML = renderEspace(); bindEspace(); return; }
  if (state.phase === 'staff') { main.innerHTML = renderStaff(); bindStaff(); return; }
}









function bindConnexion() {
  const form = document.getElementById('form-connexion');
  if (!form) return;
  form.addEventListener('submit', () => {
    const melEl = document.getElementById('cx-mel');
    const mdpEl = document.getElementById('cx-mdp');
    const mel = melEl ? (melEl.value || '').trim() : '';
    const motDePasse = mdpEl ? (mdpEl.value || '').trim() : '';
    try {
      sessionStorage.setItem(FPGC_LS_PENDING, JSON.stringify({ mel, motDePasse, auto: false }));
    } catch (err) {  }
  });
}

function bindReconnexion() {
  const form = document.getElementById('form-reconnexion');
  if (form) {
    form.addEventListener('submit', () => {
      try {
        sessionStorage.setItem(FPGC_LS_PENDING, JSON.stringify({ auto: true }));
      } catch (err) {  }
    });
  }
  const btnPasMoi = document.getElementById('btn-pas-moi');
  if (btnPasMoi) {
    btnPasMoi.addEventListener('click', () => {
      
      
      oublierCleMemorisee();
      state.phase = 'connexion';
      state.nomMemorise = '';
      render();
    });
  }
}





function bindStaff() {
  document.querySelectorAll('.es-staff-copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const texte = btn.getAttribute('data-copy') || '';
      try {
        await navigator.clipboard.writeText(texte);
        btn.textContent = 'Copié !';
      } catch (err) {
        const input = btn.previousElementSibling;
        if (input && input.select) { input.select(); document.execCommand('copy'); }
        btn.textContent = 'Copié !';
      }
      setTimeout(() => { btn.textContent = 'Copier'; }, 2000);
    });
  });
  document.querySelectorAll('[data-es-staff-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(btn.getAttribute('aria-controls'));
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      if (body) body.hidden = isOpen;
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  });
}

function bindEspace() {
  const statusEl = document.getElementById('em-status');
  document.querySelectorAll('.em-toggle').forEach((el) => {
    el.addEventListener('change', async () => {
      const id = Number(el.getAttribute('data-em-id'));
      const present = el.checked;
      el.disabled = true;
      statusEl.textContent = 'Enregistrement…';
      try {
        await grist.docApi.applyUserActions([['UpdateRecord', 'Emargement_du_stage', id, { Present: present }]]);
        
        
        const row = DB['Emargement_du_stage'] && DB['Emargement_du_stage'].byId.get(id);
        if (row) row.Present = present;
        statusEl.textContent = '';
      } catch (err) {
        console.error('[Espace stagiaire FPGC]', err);
        el.checked = !present; 
        const detail = (err && (err.message || String(err))) || 'erreur inconnue';
        statusEl.textContent = "Erreur — l'émargement n'a pas été enregistré. (Détail technique : " + detail + ')';
      } finally {
        el.disabled = false;
      }
    });
  });
}





async function boot() {
  render();
  try {
    await loadAll();
    resolveStagiaire();
  } catch (err) {
    console.error('[Espace stagiaire FPGC] échec du chargement initial', err);
    state.phase = 'erreur_chargement';
    state.erreurChargement = (err && (err.message || String(err))) || 'erreur inconnue';
  }
  render();
}

boot();