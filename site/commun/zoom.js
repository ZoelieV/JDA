// Zoom du site sur ordinateur : curseur horizontal de 50 à 200 % et boutons
// − / + (pas de 5 %) dans le menu des paramètres du compte (sur Mac,
// dézoomer une page n'est pas intuitif).
//
// Le zoom n'est appliqué qu'au relâché (curseur ou bouton maintenu) :
// appliqué en direct, il agrandirait le réglage sous la souris pendant le
// geste, qui s'emballerait. Pendant le geste, seule la valeur affichée suit. La valeur est gardée sur l'appareil (localStorage) et
// appliquée à toutes les pages, sans passer par "Enregistrer".
//
// Le zoom change la taille de base du texte (--zoom-site dans la taille de
// html, cf. commun/entete.css) : tout le site est en rem, il grandit ou
// rétrécit d'un bloc. Téléphones et tablettes tactiles : ni zoom ni réglage,
// le zoom du navigateur (pincement) suffit.
//
// À inclure dans le <head> (appliqué avant l'affichage, sans saut) :
// <script src="/commun/zoom.js"></script>
// Réglage ajouté au menu des paramètres : par commun/compte.js
// (ZoomSite.inserer) et, sur Mon compte, au menu #menu-compte de la page.
(function () {
  const CLE = "zoom-site";
  const MIN = 50;
  const MAX = 200;
  const PAS = 5;
  const DEFAUT = 100;
  // Ordinateur : souris (ou pavé tactile) et écran assez large.
  const ordi = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 701px)");
  const reglages = [];

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

  let zoom = lire();

  function appliquer() {
    if (ordi.matches && zoom !== DEFAUT) document.documentElement.style.setProperty("--zoom-site", String(zoom / 100));
    else document.documentElement.style.removeProperty("--zoom-site");
    reglages.forEach(({ bloc, curseur, valeur }) => {
      bloc.hidden = !ordi.matches;
      curseur.value = String(zoom);
      valeur.textContent = `${zoom} %`;
    });
  }

  appliquer();
  ordi.addEventListener?.("change", appliquer);

  // Autre onglet du site : même zoom partout.
  window.addEventListener("storage", event => {
    if (event.key !== CLE) return;
    zoom = lire();
    appliquer();
  });

  // Bloc "Zoom du site" (même présentation que les champs du menu).
  function creerReglage() {
    const bloc = document.createElement("div");
    bloc.className = "menu-champ zoom-site";
    bloc.innerHTML = `
      <label for="zoom-site-${reglages.length}">Zoom du site <span class="zoom-site-note">(cet appareil)</span></label>
      <div class="zoom-site-ligne">
        <button type="button" class="zoom-site-pas" data-sens="-1" title="Dézoomer (maintenir pour continuer)" aria-label="Dézoomer">−</button>
        <input type="range" id="zoom-site-${reglages.length}" class="zoom-site-curseur" min="${MIN}" max="${MAX}" step="${PAS}">
        <button type="button" class="zoom-site-pas" data-sens="1" title="Zoomer (maintenir pour continuer)" aria-label="Zoomer">+</button>
        <button type="button" class="zoom-site-valeur" title="Revenir à 100 %"></button>
      </div>
    `;
    const curseur = bloc.querySelector(".zoom-site-curseur");
    const valeur = bloc.querySelector(".zoom-site-valeur");
    const changer = (nouveau, enregistrer) => {
      zoom = nouveau;
      if (enregistrer) ecrire(zoom);
      appliquer();
    };
    // Valeur affichée pendant le geste, sans toucher au zoom.
    const apercu = nouveau => {
      curseur.value = String(nouveau);
      valeur.textContent = `${nouveau} %`;
    };
    const borner = v => Math.min(MAX, Math.max(MIN, v));
    // Curseur : valeur suivie pendant le glissement, zoom appliqué au relâché.
    curseur.addEventListener("input", () => apercu(Number(curseur.value)));
    curseur.addEventListener("change", () => changer(Number(curseur.value), true));
    valeur.addEventListener("click", () => changer(DEFAUT, true));
    // Boutons − / + : un clic = 5 %, maintenu = répété ; zoom appliqué au
    // relâché (capture du pointeur : relâché même hors du bouton).
    bloc.querySelectorAll(".zoom-site-pas").forEach(bouton => {
      const sens = Number(bouton.dataset.sens);
      let enCours = null;
      let minuteur = null;
      const avancer = () => {
        enCours = borner(enCours + sens * PAS);
        apercu(enCours);
      };
      const finir = () => {
        if (enCours === null) return;
        clearTimeout(minuteur);
        clearInterval(minuteur);
        const final = enCours;
        enCours = null;
        changer(final, true);
      };
      bouton.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        bouton.setPointerCapture(event.pointerId);
        enCours = zoom;
        avancer();
        minuteur = setTimeout(() => { minuteur = setInterval(avancer, 80); }, 400);
      });
      bouton.addEventListener("pointerup", finir);
      bouton.addEventListener("pointercancel", finir);
      bouton.addEventListener("lostpointercapture", finir);
      // Clavier (Entrée, Espace) : un pas, appliqué tout de suite.
      bouton.addEventListener("click", event => {
        if (event.detail === 0) changer(borner(zoom + sens * PAS), true);
      });
    });
    reglages.push({ bloc, curseur, valeur });
    appliquer();
    return bloc;
  }

  // Ajoute le réglage dans un menu des paramètres, dans sa propre section
  // (entre deux séparateurs, après Enregistrer).
  function inserer(menu) {
    if (!menu || menu.querySelector(".zoom-site")) return;
    const separateur = menu.querySelector(".menu-separateur");
    const bloc = creerReglage();
    if (!separateur) {
      menu.appendChild(bloc);
      return;
    }
    const autre = document.createElement("div");
    autre.className = "menu-separateur";
    separateur.after(bloc, autre);
  }

  window.ZoomSite = { inserer };

  // Mon compte : menu des paramètres dans la page.
  function insererMenuPage() {
    inserer(document.getElementById("menu-compte"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", insererMenuPage);
  else insererMenuPage();
})();
