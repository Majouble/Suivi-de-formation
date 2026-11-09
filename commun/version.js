/*
 * Numéro de version de la suite de widgets FPGC.
 *
 * Définit : VERSION_FPGC (window), affichée discrètement en bas à droite de chaque widget
 *           et dans la console du navigateur.
 * Utilise : rien (chargé avant le code du widget, chemin relatif ../commun/version.js).
 *
 * À incrémenter à chaque mise à jour : « x.y.z-alpha.n » pendant le développement,
 * « x.y.z » pour une version publiée en production (outils/publier-prod.sh refuse
 * de publier une version alpha, beta ou dev).
 */
{ // bloc : VERSION ne devient pas une variable globale du widget
const VERSION = "1.0.1-alpha.1 (09/11/2026)";

window.VERSION_FPGC = VERSION;
console.info(`Widgets FPGC — version ${VERSION}`);

document.addEventListener('DOMContentLoaded', () => {
  const etiquette = document.createElement('div');
  etiquette.textContent = `v${VERSION}`;
  etiquette.setAttribute('aria-hidden', 'true');
  etiquette.style.cssText = 'position:fixed;right:6px;bottom:4px;font:10px/1 sans-serif;'
    + 'color:var(--text-muted,#666);opacity:.55;pointer-events:none;z-index:1;';
  etiquette.className = 'version-fpgc';
  document.body.appendChild(etiquette);
  const style = document.createElement('style');
  style.textContent = '@media print { .version-fpgc { display: none; } }';
  document.head.appendChild(style);
});
}
