// En-tête et pied de page du site, affichage "classique" de la
// personnalisation seulement (profil.parametres.accueil, posé sur
// <html data-accueil> par commun/fond.js) : en-tête (logo, liens des pages
// et leurs menus déroulants, bouton du compte) et pied de page (feedback,
// réseaux) sur toutes les pages, sauf les rooms de match (pas chargé). En
// "panneau" et "cartes" : rien n'est ajouté, design d'origine des pages.
// Styles : commun/site.css.
//
// À charger sans defer en fin de <body> (avant les scripts defer, dont
// commun/compte.js, qui remplit la zone du compte de l'en-tête) :
// l'en-tête est en place avant le premier affichage.
// Accueil : son en-tête existe déjà (.accueil-barre, zone du compte des
// autres affichages), il reçoit le logo et les liens.
// Mon compte : pas de commun/compte.js, son propre bouton du compte
// (#auth-zone, menu des paramètres) est déplacé dans l'en-tête.
(function () {
  // Page affichée dans une fenêtre d'une autre page (Litiges dans
  // l'administration, cf. admin_litiges.js) : ni en-tête ni pied de page.
  if (window.self !== window.top) return;
  if (document.documentElement.dataset.accueil !== "classique") {
    // Affichage changé depuis la personnalisation : page rechargée pour
    // afficher (ou retirer) l'en-tête.
    document.addEventListener("accueil-change", () => {
      if (document.documentElement.dataset.accueil === "classique") location.reload();
    });
    return;
  }
  document.addEventListener("accueil-change", () => location.reload());
  document.documentElement.classList.add("site-classique");

  // Liens des pages ; menus déroulants : Match, Historique, Règles.
  const LIENS = [
    { titre: "Match", href: "/match", menu: [
      ["Créer une room", "/match#room"],
      ["Matchmaking", "/match#matchmaking"],
      ["Classé", "/match#classe"],
      ["Entraînement", "/match#entrainement"],
      ["En équipe", "/match#equipe"]
    ] },
    { titre: "Joueurs", href: "/comptes" },
    { titre: "Classement", href: "/classement" },
    { titre: "Historique", href: "/historique", menu: [
      ["Matchs", "/historique?onglet=matchs"],
      ["Matchs en équipe", "/historique?onglet=equipe"],
      ["Random world boss", "/historique?onglet=world_boss"],
      ["Entraînements", "/historique?onglet=entrainements"]
    ] },
    { titre: "Statistiques", href: "/statistiques" },
    { titre: "Règles", href: "/regles", menu: [
      ["Règles simplifiées", "/regles/simplifiees"],
      ["Règles complètes", "/regles/completes"],
      // Connectés seulement, sauf shadowbans (affiché par commun/compte.js).
      ["Theorycraft", "/theorycraft", "carte-theorycraft"],
      ["Tutoriel", "/tutoriel"]
    ] },
    { titre: "Événements", href: "/evenements" },
    { titre: "Tournois", href: "/tournois" },
    // Administrateurs et mini admins (affiché par commun/compte.js).
    { titre: "Admin", href: "/admin", classe: "carte-admin", menu: [
      ["Équilibrage", "/admin/equilibrage"],
      ["Administration", "/admin"],
      ["Litiges", "/admin?litiges=1"]
    ] }
  ];
  // Réseaux : sites officiels en attendant les liens du site.
  const RESEAUX = [
    ["Discord", "https://discord.com", "discord"],
    ["TikTok", "https://www.tiktok.com", "tiktok"],
    ["Instagram", "https://www.instagram.com", "instagram"],
    ["YouTube", "https://www.youtube.com", "youtube"],
    ["Ko-fi", "https://ko-fi.com", "kofi"]
  ];
  // Crédits : fenêtre du bouton Crédits du pied de page.
  const CREDITS = [
    ["Développeurs", "Strike, Koy"],
    ["Équilibrage", "Lightningstorm, Matrere, Gogetox"],
    ["Streameuse", "Laïna"],
    ["Paparazzi", "Zekroy"]
  ];

  function element(balise, attributs = {}, texte = "") {
    const el = document.createElement(balise);
    Object.entries(attributs).forEach(([nom, valeur]) => el.setAttribute(nom, valeur));
    if (texte) el.textContent = texte;
    return el;
  }

  function lien(texte, href, classe) {
    const a = element("a", { href }, texte);
    if (classe) {
      a.className = classe;
      a.hidden = true;
    }
    return a;
  }

  function creerMarque() {
    const marque = element("a", { class: "entete-marque", href: "/" });
    marque.append(
      element("img", { src: "/DB/images/others/logo_site.webp", alt: "", width: "32", height: "32" }),
      element("span", {}, "Jugement des Archons")
    );
    return marque;
  }

  function creerNav() {
    const nav = element("nav", { class: "entete-nav", "aria-label": "Pages du site" });
    LIENS.forEach(({ titre, href, menu, classe }) => {
      if (!menu) {
        nav.appendChild(lien(titre, href, classe));
        return;
      }
      const bloc = element("div", { class: classe ? `menu-deroulant ${classe}` : "menu-deroulant" });
      if (classe) bloc.hidden = true;
      const titreMenu = element("a", { class: "menu-titre", href, "aria-haspopup": "true", "aria-expanded": "false" }, titre);
      const sousMenu = element("div", { class: "sous-menu" });
      menu.forEach(([texte, cible, classeLien]) => sousMenu.appendChild(lien(texte, cible, classeLien)));
      bloc.append(titreMenu, sousMenu);
      nav.appendChild(bloc);
    });
    return nav;
  }

  function creerPied() {
    const pied = element("footer", { class: "site-pied" });
    const contenu = element("div", { class: "pied-contenu" });
    const marque = element("div", { class: "pied-marque" });
    marque.append(element("strong", {}, "Jugement des Archons"), element("span", {}, "Site de fans, non affilié à HoYoverse."));
    const liens = element("nav", { class: "pied-liens", "aria-label": "Liens utiles" });
    const feedback = element("button", { type: "button", class: "pied-feedback" }, "Envoyer un feedback");
    feedback.appendChild(element("img", { src: "/DB/images/others/Icon_Mail.webp", alt: "" }));
    feedback.addEventListener("click", ouvrirFeedback);
    const credits = element("button", { type: "button", class: "pied-feedback" }, "Crédits");
    credits.addEventListener("click", ouvrirCredits);
    liens.append(credits, feedback);
    const reseaux = element("div", { class: "pied-reseaux" });
    RESEAUX.forEach(([nom, href, icone]) => {
      const a = element("a", { href, target: "_blank", rel: "noopener noreferrer", "aria-label": nom, title: nom });
      a.appendChild(element("img", { src: `/DB/images/others/reseaux/${icone}.svg`, alt: "" }));
      reseaux.appendChild(a);
    });
    contenu.append(marque, liens, reseaux);
    pied.appendChild(contenu);
    return pied;
  }

  // Fenêtre des crédits (créée au 1er clic) ; Échap, × ou clic à côté :
  // fermée.
  let fenetreCredits = null;
  function ouvrirCredits() {
    if (!fenetreCredits) {
      fenetreCredits = element("dialog", { class: "fenetre-credits", "aria-label": "Crédits" });
      const fermer = element("button", { type: "button", class: "fermer-credits", "aria-label": "Fermer" }, "×");
      fermer.addEventListener("click", () => fenetreCredits.close());
      fenetreCredits.append(fermer, element("h2", {}, "Crédits"));
      CREDITS.forEach(([role, noms]) => {
        const ligne = element("p", { class: "ligne-credits" });
        ligne.append(element("strong", {}, role), element("span", {}, noms));
        fenetreCredits.appendChild(ligne);
      });
      fenetreCredits.addEventListener("click", event => {
        if (event.target === fenetreCredits) fenetreCredits.close();
      });
      document.body.appendChild(fenetreCredits);
    }
    fenetreCredits.showModal();
  }

  // Feedback : fenêtre de commun/feedback.js (bouton flottant masqué dans
  // cet affichage), chargé au 1er clic sur les pages qui ne l'ont pas.
  let promesseFeedback = null;
  function ouvrirFeedback() {
    const bouton = document.querySelector(".bouton-feedback");
    if (bouton) {
      bouton.click();
      return;
    }
    if (!document.querySelector('link[href^="/commun/feedback.css"]')) {
      document.head.appendChild(element("link", { rel: "stylesheet", href: "/commun/feedback.css?v=4" }));
    }
    promesseFeedback ??= new Promise((resoudre, rejeter) => {
      const script = element("script", { src: "/commun/feedback.js?v=2" });
      script.onload = resoudre;
      script.onerror = () => { promesseFeedback = null; rejeter(); };
      document.head.appendChild(script);
    });
    promesseFeedback.then(() => document.querySelector(".bouton-feedback")?.click()).catch(() => {});
  }

  // ---- En-tête : celui de l'accueil, sinon un nouveau en haut de la page.
  let entete = document.querySelector(".accueil-barre");
  if (entete) {
    entete.prepend(creerMarque(), creerNav());
  } else {
    document.documentElement.classList.add("avec-entete-site");
    entete = element("header", {});
    entete.append(creerMarque(), creerNav());
    // Mon compte : son bouton du compte ; ailleurs : zone remplie par
    // commun/compte.js.
    const authZone = document.getElementById("auth-zone");
    if (authZone) entete.appendChild(authZone);
    else entete.appendChild(element("div", { id: "zone-compte", class: "zone-compte" }));
    document.body.prepend(entete);
  }
  entete.classList.add("site-entete");
  document.body.appendChild(creerPied());

  // Hauteur de l'en-tête (zoom compris) : éléments figés en haut des pages
  // (barres de filtres, en-têtes de tableaux) placés juste en dessous (cf.
  // site.css).
  const majHauteurEntete = () => document.documentElement.style.setProperty("--hauteur-entete", `${entete.getBoundingClientRect().height}px`);
  majHauteurEntete();
  new ResizeObserver(majHauteurEntete).observe(entete);

  // ---- Menus déroulants : sortis de la barre des liens (qui défile de
  // gauche à droite si elle est trop longue et les couperait) et placés
  // dans l'en-tête, sous leur titre, à l'ouverture. Souris : ouverts au
  // survol du titre ou du menu (fermés peu après en le quittant) ; clavier :
  // au focus ; écran tactile : 1er appui sur le titre = ouvre le menu, 2e =
  // va sur la page ; appui à côté ou défilement des liens = referme.
  const nav = entete.querySelector(".entete-nav");
  const tactile = window.matchMedia("(hover: none)");
  const menus = [...entete.querySelectorAll(".menu-deroulant")].map(menu => {
    const sousMenu = menu.querySelector(".sous-menu");
    entete.appendChild(sousMenu);
    return { menu, titre: menu.querySelector(".menu-titre"), sousMenu, minuteur: null };
  });

  function ouvrirMenu(entree) {
    clearTimeout(entree.minuteur);
    menus.forEach(autre => { if (autre !== entree) fermerMenu(autre); });
    // Position dans l'en-tête (zoom de l'en-tête compris, cf. site.css).
    const zoom = parseFloat(getComputedStyle(entete).zoom) || 1;
    const cadreEntete = entete.getBoundingClientRect();
    const cadreTitre = entree.titre.getBoundingClientRect();
    entree.sousMenu.style.left = `${(cadreTitre.left - cadreEntete.left) / zoom}px`;
    entree.sousMenu.style.right = "";
    entree.sousMenu.style.top = `${(cadreTitre.bottom - cadreEntete.top) / zoom}px`;
    entree.menu.classList.add("ouvert");
    entree.sousMenu.classList.add("ouvert");
    // Menu qui dépasserait de l'écran (titre près du bord, téléphone) :
    // calé contre le bord de l'écran (par son côté droit : sa largeur change
    // avec sa position).
    const marge = 8;
    const largeurEcran = document.documentElement.clientWidth;
    const cadreMenu = entree.sousMenu.getBoundingClientRect();
    if (cadreMenu.right > largeurEcran - marge) {
      entree.sousMenu.style.left = "auto";
      entree.sousMenu.style.right = `${(cadreEntete.right - (largeurEcran - marge)) / zoom}px`;
    } else if (cadreMenu.left < marge) {
      entree.sousMenu.style.left = `${(marge - cadreEntete.left) / zoom}px`;
    }
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
    [titre, sousMenu].forEach(el => {
      el.addEventListener("mouseenter", () => { if (!tactile.matches) ouvrirMenu(entree); });
      el.addEventListener("mouseleave", () => {
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
})();
