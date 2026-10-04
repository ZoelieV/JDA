// Zoom du site sur ordinateur : curseur vertical à droite de l'écran, de
// 50 à 200 % (sur Mac, dézoomer une page n'est pas intuitif). La valeur est
// gardée sur l'appareil (localStorage) et appliquée à toutes les pages.
//
// Le zoom change la taille de base du texte (--zoom-site dans la taille de
// html, cf. commun/entete.css) : tout le site est en rem, il grandit ou
// rétrécit d'un bloc. Téléphones et tablettes tactiles : pas de curseur, le
// zoom du navigateur (pincement) suffit.
//
// À inclure dans le <head> (appliqué avant l'affichage, sans saut) :
// <script src="/commun/zoom.js"></script>
(function () {
  const CLE = "zoom-site";
  const MIN = 50;
  const MAX = 200;
  const PAS = 5;
  const DEFAUT = 100;
  // Ordinateur : souris (ou pavé tactile) et écran assez large.
  const ordi = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 701px)");

  function lire() {
    let valeur = NaN;
    try { valeur = Number(localStorage.getItem(CLE)); } catch { /* stockage indisponible */ }
    return Number.isFinite(valeur) && valeur >= MIN && valeur <= MAX ? valeur : DEFAUT;
  }

  function ecrire(valeur) {
    try {
      if (valeur === DEFAUT) localStorage.removeItem(CLE);
      else localStorage.setItem(CLE, String(valeur));
    } catch { /* stockage indisponible : zoom pour cette page seulement */ }
  }

  function appliquer(valeur) {
    if (ordi.matches && valeur !== DEFAUT) document.documentElement.style.setProperty("--zoom-site", String(valeur / 100));
    else document.documentElement.style.removeProperty("--zoom-site");
  }

  let zoom = lire();
  appliquer(zoom);

  function creerCurseur() {
    const zone = document.createElement("div");
    zone.className = "zoom-site";
    zone.innerHTML = `
      <button type="button" class="zoom-site-valeur" title="Zoom du site : clic pour revenir à 100 %"></button>
      <input type="range" class="zoom-site-curseur" min="${MIN}" max="${MAX}" step="${PAS}" aria-label="Zoom du site">
      <span class="zoom-site-icone" aria-hidden="true">🔍</span>
    `;
    const curseur = zone.querySelector(".zoom-site-curseur");
    const libelle = zone.querySelector(".zoom-site-valeur");
    const afficher = () => {
      curseur.value = String(zoom);
      libelle.textContent = `${zoom} %`;
    };
    const changer = (valeur, enregistrer) => {
      zoom = valeur;
      appliquer(zoom);
      afficher();
      if (enregistrer) ecrire(zoom);
    };

    // Pendant le glissement : appliqué en direct ; enregistré au relâché.
    curseur.addEventListener("input", () => changer(Number(curseur.value), false));
    curseur.addEventListener("change", () => changer(Number(curseur.value), true));
    libelle.addEventListener("click", () => changer(DEFAUT, true));
    afficher();

    const basculer = () => {
      zone.hidden = !ordi.matches;
      appliquer(zoom);
    };
    ordi.addEventListener?.("change", basculer);
    basculer();
    document.body.appendChild(zone);
  }

  // Autre onglet du site : même zoom partout.
  window.addEventListener("storage", event => {
    if (event.key !== CLE) return;
    zoom = lire();
    appliquer(zoom);
    const curseur = document.querySelector(".zoom-site-curseur");
    if (curseur) {
      curseur.value = String(zoom);
      document.querySelector(".zoom-site-valeur").textContent = `${zoom} %`;
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", creerCurseur);
  else creerCurseur();
})();
