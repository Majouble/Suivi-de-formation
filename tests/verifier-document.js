// Ouvre gestion-acces sur la structure d'un document réel (exportée par exporter-grist.py)
// et affiche ce que le widget y constate : vérifications préalables et écarts table par table.
//
// Usage : node tests/verifier-document.js tests/resultats/document.json
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const WIDGET = path.join(__dirname, '..', 'gestion-acces', 'index.html');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-grist.js'), 'utf8');
const doc = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

(async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1100, height: 900 } });
  page.on('pageerror', (e) => console.log('ERREUR PAGE', e.message));
  await page.addInitScript(`window.__DOC = ${JSON.stringify(doc)};`);
  await page.route('https://docs.getgrist.com/grist-plugin-api.js', (r) => r.fulfill({ body: MOCK, contentType: 'application/javascript' }));
  await page.goto('file://' + WIDGET);
  await page.waitForFunction(() => !document.querySelector('#main').textContent.includes('Chargement'));

  console.log('Statut :', (await page.textContent('#topbarSub')).trim());
  console.log('\nVérifications préalables');
  for (const c of await page.$$eval('.checks li', (els) => els.map((e) => e.innerText.replace(/\n+/g, ' | ').trim()))) console.log(' -', c);
  console.log('\nTables');
  for (const t of await page.$$eval('.table-card, details', (els) => els.map((e) => e.querySelector('summary, h3, .table-title')?.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean))) console.log(' -', t);
  await page.screenshot({ path: path.join(path.dirname(process.argv[2]), 'document-reel.png'), fullPage: true });
  await navigateur.close();
})();
