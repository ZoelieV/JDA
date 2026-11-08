// Volume du site : curseur de 0 à 100 % dans le menu des paramètres du compte
// (sous le zoom, cf. commun/zoom.js), sur ordinateur comme sur téléphone.
// Gardé sur l'appareil (localStorage) et suivi dans les autres onglets.
// S'applique aux sons et vidéos qui passent par VolumeSite.appliquer
// (tirage du boss, musique et sons du visual novel) : volume final = volume
// propre du son × volume du site. 0 % : coupé.
//
// À inclure tôt dans la page (avant les scripts qui jouent des sons) :
// <script src="/commun/volume.js"></script>
// Réglage ajouté au menu des paramètres par commun/compte.js
// (VolumeSite.inserer) et, sur Mon compte, au menu #menu-compte de la page.
(function () {
  const CLE = "volume-site";
  const PAS = 5;
  const DEFAUT = 100;
  const reglages = [];
  // Médias suivis : { media, base } (base : volume propre du son, 0 à 1).
  const medias = new Set();

  function lire() {
    let valeur = NaN;
    try {
      const brut = localStorage.getItem(CLE);
      if (brut !== null) valeur = Number(brut);
    } catch { /* stockage indisponible */ }
    return Number.isFinite(valeur) && valeur >= 0 && valeur <= 100 ? valeur : DEFAUT;
  }

  function ecrire(valeur) {
    try {
      if (valeur === DEFAUT) localStorage.removeItem(CLE);
      else localStorage.setItem(CLE, String(valeur));
    } catch { /* stockage indisponible : volume pour cette page seulement */ }
  }

  let volume = lire();

  // Seul le volume est touché (jamais muted, que la page gère elle-même,
  // ex. vidéo du tirage sans son si le navigateur refuse la lecture sonore).
  function regler(entree) {
    entree.media.volume = Math.min(1, Math.max(0, entree.base * volume / 100));
  }

  function rafraichir() {
    medias.forEach(entree => {
      // Vidéo retirée de la page : plus suivie.
      if (entree.video && !entree.media.isConnected) medias.delete(entree);
      else regler(entree);
    });
    reglages.forEach(({ curseur, valeur }) => {
      curseur.value = String(volume);
      valeur.textContent = volume === 0 ? "Coupé" : `${volume} %`;
    });
  }

  // Média (audio, vidéo) réglé sur le volume du site, et suivi s'il change.
  // base : son volume propre (0 à 1). -> le média.
  function appliquer(media, base = 1) {
    if (!media) return media;
    const video = media instanceof HTMLVideoElement;
    const entree = [...medias].find(e => e.media === media) || { media, video };
    entree.base = base;
    medias.add(entree);
    regler(entree);
    // Son joué une fois (hors musique en boucle) : plus suivi une fois fini.
    if (!video && !media.loop) media.addEventListener("ended", () => medias.delete(entree), { once: true });
    return media;
  }

  // Le navigateur ne laisse pas jouer un son coupé par le site : à vérifier
  // avant de lancer un son qui n'a pas besoin d'être joué du tout.
  const estCoupe = () => volume === 0;

  window.addEventListener("storage", event => {
    if (event.key !== CLE) return;
    volume = lire();
    rafraichir();
  });

  function creerReglage() {
    const bloc = document.createElement("div");
    bloc.className = "menu-champ volume-site";
    bloc.innerHTML = `
      <label for="volume-site-${reglages.length}">Volume du site <span class="zoom-site-note">(cet appareil)</span></label>
      <div class="zoom-site-ligne">
        <span class="volume-site-icone" aria-hidden="true">🔈</span>
        <input type="range" id="volume-site-${reglages.length}" class="zoom-site-curseur" min="0" max="100" step="${PAS}">
        <span class="volume-site-icone" aria-hidden="true">🔊</span>
        <button type="button" class="zoom-site-valeur" title="Couper le son, ou le remettre"></button>
      </div>
    `;
    const curseur = bloc.querySelector(".zoom-site-curseur");
    const valeur = bloc.querySelector(".zoom-site-valeur");
    let avantCoupure = DEFAUT;
    const changer = nouveau => {
      if (nouveau > 0) avantCoupure = nouveau;
      volume = nouveau;
      ecrire(volume);
      rafraichir();
    };
    // Le volume suit le curseur pendant le glissement (on entend le changement).
    curseur.addEventListener("input", () => changer(Number(curseur.value)));
    valeur.addEventListener("click", () => changer(volume === 0 ? avantCoupure || DEFAUT : 0));
    reglages.push({ bloc, curseur, valeur });
    rafraichir();
    return bloc;
  }

  // Ajoute le réglage au menu des paramètres : juste sous le zoom s'il y est,
  // sinon dans sa propre section après le premier séparateur.
  function inserer(menu) {
    if (!menu || menu.querySelector(".volume-site")) return;
    const bloc = creerReglage();
    const zoom = menu.querySelector(".zoom-site");
    if (zoom) return zoom.after(bloc);
    const separateur = menu.querySelector(".menu-separateur");
    if (!separateur) return menu.appendChild(bloc);
    const autre = document.createElement("div");
    autre.className = "menu-separateur";
    separateur.after(bloc, autre);
  }

  window.VolumeSite = { appliquer, inserer, estCoupe, lire: () => volume / 100 };

  // Mon compte : menu des paramètres dans la page (après le zoom).
  function insererMenuPage() {
    inserer(document.getElementById("menu-compte"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", insererMenuPage);
  else insererMenuPage();
})();
