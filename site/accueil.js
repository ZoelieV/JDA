// Page d'accueil : affichage choisi dans Personnalisation
// (profil.parametres.accueil, posé sur <html data-accueil> par
// commun/fond.js dès le <head>).
// - "panneau" (par défaut, aussi pour les visiteurs) : Créer un match et Mon
//   compte restent au centre, les autres cartes sont rangées dans le panneau
//   de gauche (un tiers de l'écran), plié / déplié par le bouton ☰. Déplié
//   par défaut sur ordi (choix gardé dans ce navigateur), plié sur
//   téléphone (il passe alors par-dessus la page).
// - "classique" : toutes les cartes au centre (accueil.css).
// - "test" : où sont essayés les prochains changements : site classique,
//   avec barre d'en-tête (liens des pages, compte), deux boutons au centre,
//   principe en 3 étapes et bas de page (feedback, réseaux), sans cartes
//   (accueil.css).
// Chargé en fin de <body>, sans defer : les cartes sont rangées avant le
// premier affichage.
(function () {
  const CLE_PLIE = "accueil-panneau-plie";
  const telephone = window.matchMedia("(max-width: 700px)");
  const grille = document.querySelector(".accueil-sections");
  const panneau = document.getElementById("accueil-panneau");
  const bouton = document.querySelector(".accueil-menu");
  // Ordre d'origine des cartes (retour à l'affichage classique).
  const cartes = [...grille.querySelectorAll(".carte-section")];
  const resteAuCentre = carte => carte.classList.contains("principale") || carte.classList.contains("carte-mon-compte");

  function lire(cle) {
    try { return localStorage.getItem(cle); } catch { return null; }
  }

  function ecrire(cle, valeur) {
    try {
      if (valeur === null) localStorage.removeItem(cle);
      else localStorage.setItem(cle, valeur);
    } catch { /* stockage indisponible : choix pas gardé */ }
  }

  function deplier(ouvert) {
    document.body.classList.toggle("panneau-ouvert", ouvert);
    bouton.setAttribute("aria-expanded", String(ouvert));
    const texte = ouvert ? "Plier le menu" : "Déplier le menu";
    bouton.setAttribute("aria-label", texte);
    bouton.title = texte;
  }

  function ranger() {
    const avecPanneau = !["classique", "test"].includes(document.documentElement.dataset.accueil);
    cartes.forEach(carte => (avecPanneau && !resteAuCentre(carte) ? panneau : grille).appendChild(carte));
    deplier(avecPanneau && !telephone.matches && lire(CLE_PLIE) !== "1");
  }

  bouton.addEventListener("click", () => {
    const ouvert = !document.body.classList.contains("panneau-ouvert");
    deplier(ouvert);
    if (!telephone.matches) ecrire(CLE_PLIE, ouvert ? null : "1");
  });

  // Téléphone : panneau par-dessus la page, replié au choix d'une carte ou
  // d'un clic à côté.
  document.addEventListener("click", event => {
    if (!telephone.matches || !document.body.classList.contains("panneau-ouvert")) return;
    if (!event.target.closest(".accueil-panneau, .accueil-menu")) deplier(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && telephone.matches) deplier(false);
  });

  // Bas de page (affichage "test") : ouvre la fenêtre du bouton Feedback
  // (commun/feedback.js, masqué dans cet affichage).
  document.querySelector(".pied-feedback")?.addEventListener("click", () => {
    document.querySelector(".bouton-feedback")?.click();
  });

  telephone.addEventListener("change", ranger);
  document.addEventListener("accueil-change", ranger);
  ranger();
  // Animations du panneau seulement après le premier affichage.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("accueil-anime")));
})();
