// Page d'accueil : affichage choisi dans Personnalisation
// (profil.parametres.accueil, posé sur <html data-accueil> par
// commun/fond.js dès le <head>).
// - "classique" (par défaut, aussi pour les visiteurs) : site sobre, barre
//   d'en-tête (liens des pages et leurs menus déroulants, compte), logo,
//   bouton Événements et modes de jeu au centre, bas de page (feedback,
//   réseaux), sans la grille de cartes (accueil.css).
// - "panneau" : Créer un match et Mon compte restent au centre, les autres
//   cartes sont rangées dans le panneau de gauche (un tiers de l'écran),
//   plié / déplié par le bouton ☰. Déplié par défaut sur ordi (choix gardé
//   dans ce navigateur), plié sur téléphone (il passe alors par-dessus la
//   page).
// - "cartes" : toutes les cartes au centre, en grille (accueil.css).
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
    const avecPanneau = document.documentElement.dataset.accueil === "panneau";
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

  // Bas de page (affichage "classique") : ouvre la fenêtre du bouton Feedback
  // (commun/feedback.js, masqué dans cet affichage).
  document.querySelector(".pied-feedback")?.addEventListener("click", () => {
    document.querySelector(".bouton-feedback")?.click();
  });

  // Menus déroulants de l'en-tête (affichage "classique") : sortis de la
  // barre des liens (qui défile de gauche à droite si elle est trop longue
  // et les couperait) et placés dans l'en-tête, sous leur titre, à
  // l'ouverture. Souris : ouverts au survol du titre ou du menu (fermés peu
  // après en le quittant) ; clavier : au focus ; écran tactile : 1er appui
  // sur le titre = ouvre le menu, 2e = va sur la page ; appui à côté ou
  // défilement des liens = referme.
  const barre = document.querySelector(".accueil-barre");
  const nav = document.querySelector(".entete-nav");
  const tactile = window.matchMedia("(hover: none)");
  const menus = [...document.querySelectorAll(".menu-deroulant")].map(menu => {
    const sousMenu = menu.querySelector(".sous-menu");
    barre.appendChild(sousMenu);
    return { menu, titre: menu.querySelector(".menu-titre"), sousMenu, minuteur: null };
  });

  function ouvrirMenu(entree) {
    clearTimeout(entree.minuteur);
    menus.forEach(autre => { if (autre !== entree) fermerMenu(autre); });
    // Position dans l'en-tête (zoom de l'en-tête compris, cf. accueil.css).
    const zoom = parseFloat(getComputedStyle(barre).zoom) || 1;
    const cadreBarre = barre.getBoundingClientRect();
    const cadreTitre = entree.titre.getBoundingClientRect();
    entree.sousMenu.style.left = `${(cadreTitre.left - cadreBarre.left) / zoom}px`;
    entree.sousMenu.style.top = `${(cadreTitre.bottom - cadreBarre.top) / zoom}px`;
    entree.menu.classList.add("ouvert");
    entree.sousMenu.classList.add("ouvert");
    entree.titre.setAttribute("aria-expanded", "true");
  }

  function fermerMenu(entree) {
    clearTimeout(entree.minuteur);
    entree.menu.classList.remove("ouvert");
    entree.sousMenu.classList.remove("ouvert");
    entree.titre.setAttribute("aria-expanded", "false");
  }

  menus.forEach(entree => {
    const { titre, sousMenu } = entree;
    [titre, sousMenu].forEach(element => {
      element.addEventListener("mouseenter", () => { if (!tactile.matches) ouvrirMenu(entree); });
      element.addEventListener("mouseleave", () => {
        if (tactile.matches) return;
        entree.minuteur = setTimeout(() => fermerMenu(entree), 150);
      });
    });
    titre.addEventListener("focus", () => { if (!tactile.matches) ouvrirMenu(entree); });
    sousMenu.addEventListener("focusout", event => {
      if (!sousMenu.contains(event.relatedTarget) && event.relatedTarget !== titre) fermerMenu(entree);
    });
    titre.addEventListener("blur", event => {
      if (!sousMenu.contains(event.relatedTarget)) fermerMenu(entree);
    });
    titre.addEventListener("click", event => {
      if (!tactile.matches || entree.menu.classList.contains("ouvert")) return;
      event.preventDefault();
      ouvrirMenu(entree);
    });
  });
  const fermerTout = () => menus.forEach(fermerMenu);
  document.addEventListener("click", event => {
    if (!event.target.closest(".menu-deroulant, .sous-menu")) fermerTout();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") fermerTout();
  });
  nav.addEventListener("scroll", fermerTout, { passive: true });
  window.addEventListener("resize", fermerTout);
  // Molette verticale sur les liens : défilement de gauche à droite (s'ils
  // ne tiennent pas).
  nav.addEventListener("wheel", event => {
    if (nav.scrollWidth <= nav.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    nav.scrollLeft += event.deltaY;
  }, { passive: false });

  telephone.addEventListener("change", ranger);
  document.addEventListener("accueil-change", ranger);
  ranger();
  // Animations du panneau seulement après le premier affichage.
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("accueil-anime")));
})();
