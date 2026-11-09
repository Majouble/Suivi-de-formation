// Test de bout en bout de gestion-acces.html avec un faux Grist (mock-grist.js).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const WIDGET = path.join(__dirname, '..', 'gestion-acces', 'index.html');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-grist.js'), 'utf8');
const OUT = path.join(__dirname, 'resultats');
fs.mkdirSync(OUT, { recursive: true });

function fixture(opts = {}) {
  const tables = [];
  const cols = [];
  let tid = 0; let cid = 0;
  const T = (tableId, colDefs, extra = {}) => {
    tid += 1; tables.push({ id: tid, tableId, summarySourceTable: 0, ...extra });
    for (const c of colDefs) {
      const [colId, type = 'Text', formula = ''] = Array.isArray(c) ? c : [c];
      cid += 1; cols.push({ id: cid, parentId: tid, colId, type, isFormula: !!formula, formula });
    }
    cid += 1; cols.push({ id: cid, parentId: tid, colId: 'manualSort', type: 'ManualSortPos', isFormula: false, formula: '' });
  };
  T('Reference', ['Academie', 'Niveau']);
  T('Utilisateurs', ['Email', 'Nom', ['Academie', 'Ref:Reference'], 'Role']);
  T('BD_Stages2', ['Reference_de_stage', ['Academie_de_formation', opts.academieTexte ? 'Text' : 'Ref:Reference'], 'UUID', 'Satisfaction_UUID', 'Formulaire_URL', 'Satisfaction_URL', 'Statut_du_stage']);
  T('Candidats_du_stage', [['Stage', 'Ref:BD_Stages2'], 'Nom', 'Prenom', 'Mel', 'UUID_personnel', 'Sous_groupe', 'Lien_personnel', ['Stage_UUID', 'Text', '$Stage.UUID'], ['gristHelper_Display', 'Any', '$Stage.Reference_de_stage']]);
  T('Intervenants_du_stage', [['Stage', 'Ref:BD_Stages2'], 'Nom', 'Type', 'Sous_groupe', ['Academie_du_stage', 'Ref:Reference', '$Stage.Academie_de_formation']]);
  T('Planning_du_stage', [['Stage', 'Ref:BD_Stages2'], 'Date', 'Intervenant', ['Academie_du_stage', 'Any', '$Stage.Academie_de_formation']]);
  T('Emargement_du_stage', [['Stage', 'Ref:BD_Stages2'], ['Candidat', 'Ref:Candidats_du_stage'], 'Date', 'Demi_journee', ['Present', 'Bool']]);
  T('Administration_et_logistique', [['Reference_de_stage', 'Ref:BD_Stages2'], 'Hebergement']);
  T('Enquete_de_satisfaction', [['Stage', 'Ref:BD_Stages2'], 'Note_globale']);
  T('Satisfaction_modules', [['Enquete', 'Ref:Enquete_de_satisfaction'], 'Titre_module', 'Reponse']);
  T('Annuaire_FPGC', ['Nom', 'Prenom', 'Mel']);
  T('Modules_de_formation', ['Titre', 'Type']);
  T('Parametres_widget', ['Cle', 'Valeur']);
  T('Preferences_tableau_bord', [['Academie', 'Ref:Reference'], 'Disposition']);
  T('Annuaire_IEN', ['Nom']);
  T('BD_Stages2_summary_Academie', ['count'], { summarySourceTable: 3 });

  const ua = (o) => JSON.stringify(o);
  const sat = opts.mauvaiseCleSatisfaction ? 'SatisfactionUUID_' : 'Satisfaction_UUID_';
  return {
    _grist_Tables: tables,
    _grist_Tables_column: cols,
    _grist_ACLResources: [
      { id: 1, tableId: '', colIds: '' },
      { id: 2, tableId: '*', colIds: '*' },
      { id: 3, tableId: 'Candidats_du_stage', colIds: '*' },
      { id: 4, tableId: 'Emargement_du_stage', colIds: '*' },
      { id: 5, tableId: '*SPECIAL', colIds: 'FullCopies' },
      { id: 6, tableId: 'Candidats_du_stage', colIds: 'Mel' },
    ],
    _grist_ACLRules: [
      { id: 1, resource: 1, aclFormula: '', permissionsText: '', rulePos: 1e9, memo: '', userAttributes: '' },
      { id: 2, resource: 2, aclFormula: '', permissionsText: '', rulePos: 1, memo: '', userAttributes: ua({ name: 'Profil_acad', tableId: 'Utilisateurs', charId: 'Email', lookupColId: 'Email' }) },
      { id: 3, resource: 2, aclFormula: '', permissionsText: '', rulePos: 2, memo: '', userAttributes: ua({ name: 'Stagiaire', tableId: 'Candidats_du_stage', charId: 'LinkKey.CandidatUUID', lookupColId: 'UUID_personnel' }) },
      { id: 4, resource: 3, aclFormula: 'user.Access in [OWNER]', permissionsText: '+CRUD', rulePos: 3, memo: '', userAttributes: '' },
      { id: 5, resource: 3, aclFormula: 'user.LinkKey.UUID == newRec.Stage_UUID', permissionsText: '+C', rulePos: 4, memo: '', userAttributes: '' },
      { id: 6, resource: 3, aclFormula: 'user.Access != OWNER', permissionsText: '-CRUD', rulePos: 5, memo: '', userAttributes: '' },
      { id: 7, resource: 4, aclFormula: 'user.Stagiaire.id == rec.Candidat', permissionsText: '+RU', rulePos: 6, memo: '', userAttributes: '' },
      { id: 8, resource: 4, aclFormula: 'user.access != OWNER', permissionsText: '-CRUD', rulePos: 7, memo: '', userAttributes: '' },
      { id: 9, resource: 5, aclFormula: 'user.Access != OWNER', permissionsText: '-R', rulePos: 8, memo: '', userAttributes: '' },
      { id: 10, resource: 6, aclFormula: 'user.Stagiaire.id != rec.id', permissionsText: '-R', rulePos: 9, memo: '', userAttributes: '' },
    ],
    Reference: [{ id: 1, Academie: 'Lyon' }, { id: 2, Academie: 'Paris' }],
    Utilisateurs: [{ id: 1, Email: 'nat@x.fr', Role: 'National', Academie: 2 }, { id: 2, Email: 'lyon@x.fr', Role: 'Academie', Academie: 1 }],
    BD_Stages2: [{ id: 1, Academie_de_formation: 1, UUID: 'u1', Satisfaction_UUID: 's1',
      Formulaire_URL: 'https://docs.getgrist.com/abc/Suivi/p/3?UUID_=u1', Satisfaction_URL: `https://docs.getgrist.com/abc/Suivi/p/6?${sat}=s1` }],
    Candidats_du_stage: [{ id: 1, Stage: 1, Nom: 'A', UUID_personnel: 'k1', Lien_personnel: 'https://docs.getgrist.com/abc/Suivi/p/5?CandidatUUID_=k1' }],
    Intervenants_du_stage: [], Planning_du_stage: [], Emargement_du_stage: [], Administration_et_logistique: [],
    Enquete_de_satisfaction: [], Satisfaction_modules: [], Annuaire_FPGC: [], Modules_de_formation: [],
    Parametres_widget: [{ id: 1, Cle: 'baseUrlDocument', Valeur: 'https://docs.getgrist.com/abc/Suivi' }],
    Preferences_tableau_bord: [], Annuaire_IEN: [], BD_Stages2_summary_Academie: [],
  };
}

let echecs = 0;
function verifier(cond, msg) { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) echecs += 1; }

async function ouvrir(browser, doc, init = '') {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text()); });
  await page.addInitScript(`window.__DOC = ${JSON.stringify(doc)}; ${init}`);
  await page.route('https://docs.getgrist.com/grist-plugin-api.js', (r) => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  await page.goto('file://' + WIDGET);
  await page.waitForFunction(() => !document.querySelector('#main').textContent.includes('Chargement'));
  return { page, erreurs };
}

(async () => {
  const browser = await chromium.launch();

  // --- Scénario 1 : document « réel » partiellement configuré ---
  {
    const { page, erreurs } = await ouvrir(browser, fixture());
    const sub = await page.textContent('#topbarSub');
    verifier(/écart/.test(sub), `statut initial annonce des écarts (« ${sub} »)`);
    const checks = await page.$$eval('.checks li', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    verifier(checks.some((c) => c.includes('Candidats_du_stage.Academie_du_stage — absente')), 'colonne pont manquante détectée');
    verifier(checks.some((c) => c.includes('Planning_du_stage.Academie_du_stage — type Any')), 'colonne pont de type Any détectée');
    verifier(checks.some((c) => c.includes('Liens de satisfaction : paramètre « Satisfaction_UUID_ » conforme')), 'paramètre de lien satisfaction vérifié');
    verifier(checks.some((c) => c.includes('dont 1 national')), 'compte national compté');
    verifier(await page.isEnabled('#btnAppliquer'), 'bouton Appliquer actif');
    const annexes = await page.$$eval('select[data-annexe]', (s) => s.map((x) => x.dataset.annexe));
    verifier(JSON.stringify(annexes) === '["Annuaire_IEN"]', `table annexe proposée, table de synthèse ignorée (${annexes})`);
    await page.screenshot({ path: path.join(OUT, '01-avant.png'), fullPage: true });

    // Formules extraites pour validation syntaxique (Python).
    const formules = await page.evaluate(() => [
      ...TABLES_REFERENCE.flatMap((t) => [...t.rules, ...(t.columnRules || []).flatMap((c) => c.rules)]),
      ...REGLES_DOCUMENT, ...MODELES_TABLES_ANNEXES.lecture.rules('X'),
    ].map((r) => r.formula).filter(Boolean));
    fs.writeFileSync(path.join(OUT, 'formules.json'), JSON.stringify([...new Set(formules)], null, 2));

    // Choix « lecture » pour la table annexe, puis application.
    await page.selectOption('select[data-annexe="Annuaire_IEN"]', 'lecture');
    await page.click('#btnAppliquer');
    await page.screenshot({ path: path.join(OUT, '02-confirmation.png') });
    await page.click('.modal [data-x="ok"]');
    await page.waitForSelector('#flash:not([hidden])');
    const flashTxt = await page.textContent('#flash');
    verifier(/conformes/.test(flashTxt), `application réussie (« ${flashTxt.trim()} »)`);
    verifier(/conformes/.test(await page.textContent('#topbarSub')), 'état relu conforme après application');
    verifier(await page.isDisabled('#btnAppliquer'), 'bouton désactivé une fois conforme');

    const etat = await page.evaluate(() => ({ res: window.__DOC._grist_ACLResources, rules: window.__DOC._grist_ACLRules, cols: window.__DOC._grist_Tables_column, params: window.__DOC.Parametres_widget, nbLots: window.__ACTIONS.length }));
    verifier(etat.nbLots === 2, `deux lots envoyés (sauvegarde puis règles) : ${etat.nbLots}`);
    const ua = etat.rules.filter((r) => r.userAttributes).map((r) => JSON.parse(r.userAttributes).name).sort();
    verifier(JSON.stringify(ua) === '["Profil","StageSatisfaction","Stagiaire"]', `attributs utilisateur remplacés (${ua})`);
    verifier(etat.res.some((r) => r.tableId === '*SPECIAL') && etat.rules.some((r) => r.id === 9), 'règle spéciale non gérée conservée');
    verifier(!etat.res.some((r) => r.tableId === 'Candidats_du_stage' && r.colIds === 'Mel'), 'ancienne règle de colonne retirée');
    const colRes = etat.res.find((r) => r.tableId === 'Candidats_du_stage' && r.colIds !== '*');
    verifier(colRes && !colRes.colIds.split(',').some((c) => ['Nom', 'Prenom', 'Sous_groupe', 'Stage', 'manualSort', 'gristHelper_Display'].includes(c))
      && colRes.colIds.includes('UUID_personnel') && colRes.colIds.includes('Mel') && colRes.colIds.includes('Academie_du_stage'),
      `colonnes masquées aux camarades : ${colRes && colRes.colIds}`);
    const pont = etat.cols.find((c) => c.colId === 'Academie_du_stage' && c.parentId === 4);
    verifier(pont && pont.type === 'Ref:Reference' && pont.formula === '$Stage.Academie_de_formation', 'colonne pont créée avec le bon type');
    const planningPont = etat.cols.find((c) => c.colId === 'Academie_du_stage' && c.parentId === 6);
    verifier(planningPont.type === 'Ref:Reference', 'type de colonne pont corrigé');
    verifier(etat.params.some((p) => p.Cle === 'aclSauvegarde'), 'sauvegarde enregistrée');
    verifier(etat.params.some((p) => p.Cle === 'aclTablesAnnexes' && JSON.parse(p.Valeur).Annuaire_IEN === 'lecture'), 'choix table annexe enregistré');
    // Chaque ressource de table se termine par une règle sans condition.
    const parRes = {};
    [...etat.rules].sort((a, b) => a.rulePos - b.rulePos).forEach((r) => { if (!r.userAttributes) (parRes[r.resource] = parRes[r.resource] || []).push(r); });
    const tablesSansFermeture = etat.res.filter((r) => r.colIds === '*' && r.tableId && r.tableId !== '*' && !r.tableId.startsWith('*'))
      .filter((r) => { const b = parRes[r.id] || []; return !b.length || b[b.length - 1].aclFormula !== ''; }).map((r) => r.tableId);
    verifier(tablesSansFermeture.length === 0, `toutes les tables se terminent par « Tous les autres » (${tablesSansFermeture})`);
    await page.screenshot({ path: path.join(OUT, '03-apres.png'), fullPage: true });

    // Restauration
    const avant = fixture();
    await page.click('#btnRestaurer');
    await page.click('.modal [data-x="ok"]');
    await page.waitForFunction(() => /restaurées/.test(document.querySelector('#flash').textContent));
    const restaure = await page.evaluate(() => ({ res: window.__DOC._grist_ACLResources, rules: window.__DOC._grist_ACLRules }));
    const sig = (d) => {
      const m = new Map(d.res.map((r) => [r.id, `${r.tableId}|${r.colIds}`]));
      return d.rules.filter((r) => m.get(r.resource) !== '|').map((r) => `${m.get(r.resource)}#${r.aclFormula}#${r.permissionsText}#${r.userAttributes}`).sort().join('\n');
    };
    verifier(sig(restaure) === sig({ res: avant._grist_ACLResources, rules: avant._grist_ACLRules }), 'restauration : règles identiques à l\'état initial');
    verifier(erreurs.length === 0, `aucune erreur console (${erreurs.join(' | ')})`);
    await page.close();
  }

  // --- Scénario 2 : refus par Grist → rien ne change, message affiché ---
  {
    const { page } = await ouvrir(browser, fixture(), 'window.__REFUSER = "ACLRule 99 invalid because listed after default rule";');
    await page.click('#btnAppliquer');
    await page.click('.modal [data-x="ok"]');
    await page.waitForFunction(() => /refusé/.test(document.querySelector('#flash').textContent));
    const n = await page.evaluate(() => window.__DOC._grist_ACLRules.length);
    verifier(n === 10, 'refus de Grist : règles inchangées');
    await page.close();
  }

  // --- Scénario 3 : prérequis bloquants ---
  {
    const { page } = await ouvrir(browser, fixture({ academieTexte: true, mauvaiseCleSatisfaction: true }));
    verifier(await page.isDisabled('#btnAppliquer'), 'Appliquer désactivé si prérequis bloquants');
    const t = await page.textContent('.checks');
    verifier(t.includes("BD_Stages2.Academie_de_formation n'est pas une Référence"), 'type Texte détecté');
    verifier(t.includes('SatisfactionUUID_'), 'mauvais paramètre de lien détecté');
    await page.screenshot({ path: path.join(OUT, '04-bloquant.png'), fullPage: true });
    await page.close();
  }

  // --- Scénario 4 : compte non propriétaire ---
  {
    const { page } = await ouvrir(browser, fixture(), 'window.__NON_OWNER = true;');
    verifier((await page.textContent('#main')).includes('réservée aux propriétaires'), 'non-propriétaire : page bloquée');
    await page.close();
  }

  await browser.close();
  console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent');
  process.exit(echecs ? 1 : 0);
})();
