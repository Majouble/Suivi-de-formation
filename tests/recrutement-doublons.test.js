// Mise en forme des saisies et doublons de candidatures, sur un faux Grist :
// formulaire de recrutement (envoi, renvoi depuis le même navigateur) puis widget de gestion
// (badge « Doublon possible », saisie groupée).
//
// Usage : node tests/recrutement-doublons.test.js tests/resultats/document.json
// (structure exportée par exporter-grist.py ; les données de test sont ajoutées ici).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-grist.js'), 'utf8') + `
  window.grist.onOptions = (cb) => setTimeout(() => cb(null, {}), 0);
  window.grist.onRecords = () => {};
  window.grist.onRecord = () => {};
  window.grist.setOption = async () => {};
  window.grist.getOption = async () => null;
  window.grist.setOptions = async () => {};
  window.grist.getOptions = async () => ({});
`;

const doc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
doc.Reference = [{ id: 1, Academie: 'Lyon', Code_academique: '10' }, { id: 2, Academie: 'National', Code_academique: '99' }];
doc.BD_Stages2 = [{ id: 1, Intitule: 'Stage test', Reference_de_stage: '9909112326', Academie_de_formation: 2,
  Niveau_du_stage: 0, Statut_du_stage: 'Brouillon', Effectif_theorique: 20, UUID: 'u1', Satisfaction_UUID: 's1',
  Date_de_debut_de_session: 1795000000, Date_de_fin_de_session: 1795200000 }];
doc.Candidats_du_stage = [];
doc.Parametres_widget = [];

let echecs = 0;
function verifier(cond, msg) { console.log(`${cond ? 'OK  ' : 'ÉCHEC'} ${msg}`); if (!cond) echecs += 1; }

async function ouvrir(contexte, widget, erreurs) {
  const page = await contexte.newPage();
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript(`window.__DOC = ${JSON.stringify(doc)};`);
  await page.route(/^https?:\/\/(?!docs\.getgrist\.com\/grist-plugin-api)/, (r) => r.abort());
  await page.route('https://docs.getgrist.com/grist-plugin-api.js', (r) => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  await page.goto('file://' + path.join(RACINE, widget, 'index.html'));
  return page;
}

// Remplit les champs obligatoires du formulaire avec des valeurs plausibles.
async function remplir(page, { nom, prenom, mel }) {
  await page.fill('#pf-nom', nom);
  await page.fill('#pf-prenom', prenom);
  await page.fill('#pf-mel', mel);
  await page.evaluate(() => {
    document.querySelectorAll('[data-q-id]').forEach((el) => {
      if (el.tagName === 'SELECT') { const o = [...el.options].find((x) => x.value); if (o) el.value = o.value; }
      else if (el.type === 'date') el.value = '1980-05-04';
      else if (el.type === 'text' && !el.value) el.value = 'valeur';
      el.dispatchEvent(new Event('change'));
    });
    const etab = document.querySelector('[data-etab-search]');
    if (etab) etab.value = 'Lycée de test';
  });
}

(async () => {
  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext(); // même navigateur pour les deux envois (localStorage partagé)
  const erreurs = [];

  // 1. Mise en forme et premier envoi
  let page = await ouvrir(contexte, 'formulaire-public', erreurs);
  await page.waitForSelector('#pf-nom');
  await remplir(page, { nom: '  de la  fontaine ', prenom: 'jean-pierre', mel: ' Jean.Dupont@AC-Test.FR ' });
  await page.fill('[data-q-id="telephone"]', '+33612345678');
  await page.fill('[data-q-id="lieu_naissance"]', 'SAINT-GERMAIN-EN-LAYE');
  await page.fill('[data-q-id="taille_haut"]', ' xl ');
  await page.click('#pf-prenom'); // sortie du champ nom
  verifier(await page.inputValue('#pf-nom') === 'DE LA FONTAINE', 'nom mis en forme à la sortie du champ');
  await page.click('#pf-mel');
  verifier(await page.inputValue('#pf-prenom') === 'Jean-Pierre', 'prénom mis en forme à la sortie du champ');
  await page.click('#pf-submit');
  await page.waitForFunction(() => !document.querySelector('#pf-submit') || document.querySelector('#pf-status').textContent);
  let lignes = await page.evaluate(() => window.__DOC.Candidats_du_stage);
  verifier(lignes.length === 1, `candidature envoyée (${lignes.length})`);
  const l = lignes[0] || {};
  verifier(l.Nom === 'DE LA FONTAINE' && l.Prenom === 'Jean-Pierre' && l.Mel === 'jean.dupont@ac-test.fr',
    `identité mise en forme (${l.Nom} / ${l.Prenom} / ${l.Mel})`);
  verifier(l.Telephone_portable === '06 12 34 56 78' && l.Lieu_de_naissance === 'Saint-Germain-en-Laye' && l.Taille_haut_treillis === 'XL',
    `autres champs mis en forme (${l.Telephone_portable} / ${l.Lieu_de_naissance} / ${l.Taille_haut_treillis})`);
  const stockage = await page.evaluate(() => localStorage.getItem('fpgc_candidatures_envoyees') || '');
  verifier(stockage.includes('"mel":"') && !stockage.toLowerCase().includes('dupont'), 'seules des empreintes sont gardées dans le navigateur');
  doc.Candidats_du_stage = lignes;
  await page.close();

  // 2. Mél invalide refusé
  page = await ouvrir(contexte, 'formulaire-public', erreurs);
  await page.waitForSelector('#pf-nom');
  await remplir(page, { nom: 'Martin', prenom: 'Léa', mel: 'lea.martin@ac-test' });
  await page.click('#pf-submit');
  verifier((await page.textContent('#pf-status')).includes('ne semble pas valide'), 'mél invalide signalé');
  await page.close();

  // 3. Même personne, même navigateur : confirmation demandée, puis envoi si confirmé
  page = await ouvrir(contexte, 'formulaire-public', erreurs);
  await page.waitForSelector('#pf-nom');
  await remplir(page, { nom: 'DE LA FONTAINE', prenom: 'Jean Pierre', mel: 'jean.dupont@ac-test.fr' });
  await page.click('#pf-submit');
  await page.waitForSelector('#pf-confirmer-doublon');
  verifier((await page.textContent('#pf-status')).includes('déjà envoyé une candidature'), 'renvoi : avertissement affiché');
  verifier((await page.evaluate(() => window.__DOC.Candidats_du_stage.length)) === 1, 'renvoi : rien envoyé sans confirmation');
  await page.click('#pf-confirmer-doublon');
  await page.waitForFunction(() => window.__DOC.Candidats_du_stage.length === 2);
  verifier(true, 'renvoi : envoyé après « Envoyer quand même »');
  doc.Candidats_du_stage = await page.evaluate(() => window.__DOC.Candidats_du_stage);
  await page.close();

  // 4. Widget de gestion : badges et saisie groupée
  doc.Candidats_du_stage.push({ id: 10, Stage: 1, Nom: 'MARTIN', Prenom: 'Léa', Mel: 'lea.martin@ac-a.fr', Statut: 'Candidat' });
  doc.Candidats_du_stage.push({ id: 11, Stage: 1, Nom: 'Martin', Prenom: 'Lea', Mel: 'l.martin@ac-b.fr', Statut: 'Candidat' });
  page = await ouvrir(contexte, 'gestion-stage-fpgc', erreurs);
  await page.waitForFunction(() => typeof renderStagiaires === 'function' && T('BD_Stages2').length === 1);
  const html = await page.evaluate(() => renderStagiaires(T('BD_Stages2')[0]));
  const nbBadges = (html.match(/Doublon possible<\/span>/g) || []).length;
  verifier(nbBadges === 4, `4 candidatures signalées en doublon possible (${nbBadges})`);
  verifier(html.includes('même adresse mél') && html.includes('même nom et prénom'), 'motif indiqué dans l\'infobulle');
  await page.evaluate(() => addCandidatesBulk(T('BD_Stages2')[0], [
    { Nom: 'durand', Prenom: 'paul', Mel: 'Paul.Durand@ac-c.fr' },
    { Nom: 'Dupont', Prenom: 'Jean', Mel: 'JEAN.DUPONT@ac-test.fr' },
    { Nom: 'Durand', Prenom: 'Paul', Mel: 'paul.durand@ac-c.fr' },
  ]));
  const apres = await page.evaluate(() => window.__DOC.Candidats_du_stage);
  const durand = apres.filter((c) => c.Mel === 'paul.durand@ac-c.fr');
  verifier(apres.length === 5 && durand.length === 1 && durand[0].Nom === 'DURAND' && durand[0].Prenom === 'Paul',
    `saisie groupée : 1 ajout mis en forme, mél déjà connu et répétition ignorés (${apres.length} lignes)`);
  const message = await page.evaluate(() => document.body.innerText);
  verifier(message.includes('2 ligne(s) ignorée(s)'), 'saisie groupée : lignes ignorées signalées');
  await page.close();

  verifier(erreurs.filter((e) => !e.includes('onOptions')).length === 0, `aucune erreur JavaScript (${erreurs.join(' | ')})`);
  await navigateur.close();
  console.log(echecs ? `\n${echecs} échec(s)` : '\nTous les tests passent');
  process.exit(echecs ? 1 : 0);
})();
