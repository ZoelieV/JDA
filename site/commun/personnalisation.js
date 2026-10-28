// Personnalisation (fond d'écran, namecard, bannière, skins, filtres et tris
// affichés en draft, affichage de l'accueil) : fenêtre
// commune à tout le site, ouverte sur place depuis le menu du compte
// (commun/compte.js) et depuis Mon compte (my_account/my_account.js).
// Styles : commun/personnalisation.css, chargé à la 1re ouverture. Fonds et
// bannières listés dans DB/images/cosmetiques.json ; Voyageur, Manekin et
// skins dans commun/variantes.js, filtres et tris de la draft dans
// commun/filtres_draft.js (chargés si la page ne l'a pas déjà).
//
// Enregistrer relit le profil (changements faits ailleurs entre-temps) et
// n'y change que ces choix (profil.parametres), puis envoie l'événement
// "personnalisation-enregistree" (detail : les paramètres enregistrés).
// Voyageur, Manekin ou skins changés : page rechargée pour afficher les
// nouvelles images, sauf ouvrir({ recharger: false }) (Mon compte, qui les
// met à jour elle-même).
//
// Rikoyns (cf. commun/koyns.js) : les cosmétiques pas encore possédés sont
// marqués d'un cadenas (prix, solde affiché en haut) ; un clic les met dans
// le panier (ou les en retire), achetés ensemble depuis la fenêtre du
// panier (confirmation au centre de l'écran) ; exclusifs : pas en vente.
// Tirages : page Cosmétiques (cosmetiques/cosmetiques.js), dont « Équiper »
// ouvre cette fenêtre avec le cosmétique déjà choisi (ouvrir({ equiper })).
// Filtres et tris de la draft, affichage
// de l'accueil : libres.
//
// Flex cosmétiques (onglet Flex, parametres.flex) : 12 namecards et fonds d'écran possédés
// placés sur une grille de 3 × 4, montrés sur la page Joueurs (onglet Flex) ;
// clic sur une case puis sur un cosmétique (cf. nettoyerParametres dans
// api/auth/profile.js).
//
// Fond "Mon image" (fond = "perso") : image importée par le joueur,
// redimensionnée et ré-encodée ici (canvas : seuls les pixels sont gardés,
// sans métadonnées ni contenu caché), puis gardée dans ce navigateur
// seulement (commun/fond.js), jamais envoyée au serveur.
(function () {
  const RACINE_IMAGES = "/DB/images/";
  // Choix attribués par défaut à tout le monde (mêmes que Mon compte).
  const PARAMETRES_DEFAUT = {
    banniere: "namecards/Namecard_Background_Default.webp",
    banniere2: "namecards/banners/Namecard_Banner_Default.webp",
    fond: "bg/autres/default_bg.webp",
    voyageur: "aether",
    manekin: "manekin",
    // Accueil : site classique (en-tête, bas de page), panneau pliable à
    // gauche, ou toutes les cartes au centre (cf. accueil.js).
    accueil: "classique"
  };
  const AFFICHAGES_ACCUEIL = [
    { id: "classique", nom: "Classique", description: "En-tête avec les pages et leurs menus, logo et modes de jeu au centre, bas de page." },
    { id: "panneau", nom: "Panneau", description: "Créer un match et Mon compte au centre, les autres pages dans un panneau à gauche (bouton ☰ pour le plier)." },
    { id: "cartes", nom: "Cartes", description: "Toutes les pages au centre, en grille de cartes." }
  ];
  // Choix qui changent les images des personnages (rechargement).
  const CLES_PERSOS = ["voyageur", "manekin", "skins"];
  // Flex : emplacements (TAILLE_FLEX de commun/koyns.js).
  const TAILLE_FLEX = 12;
  let caseFlex = 0; // emplacement choisi dans l'onglet Flex
  // Fond personnel : formats acceptés (pas de SVG ni de GIF), poids du
  // fichier importé, nombre de pixels décodés, taille gardée (largeur et
  // hauteur au plus).
  const FOND_PERSO = "perso";
  const TYPES_IMAGE_PERSO = ["image/png", "image/jpeg", "image/webp", "image/avif"];
  const POIDS_MAX_IMAGE_PERSO = 25 * 1024 * 1024;
  const PIXELS_MAX_IMAGE_PERSO = 60 * 1000 * 1000;
  const TAILLE_MAX_IMAGE_PERSO = 2560;

  let modal = null;
  let cosmetiques = null;
  let nomsPersos = null;  // id -> nom (DB/characters.json)
  let enregistres = null; // choix enregistrés (à l'ouverture)
  let brouillon = null;   // choix en cours, appliqués seulement à l'enregistrement
  let ongletActif = "fond";
  let options = {};
  let koyns = null;       // { solde, prix, tout, possedes: Set, exclusifs: Set } (api/auth/profile.js)
  // Panier : id -> { id, nom, image, type, choisir } (choisir : appliqué si
  // c'est le seul cosmétique acheté).
  const panier = new Map();
  let imageEnregistree = null; // fond personnel gardé dans ce navigateur (Blob)
  let imageBrouillon = null;   // fond personnel en cours (importé ou retiré)
  const urlsImages = new WeakMap(); // Blob -> URL blob:

  const urlImage = chemin => encodeURI(RACINE_IMAGES + chemin);
  const getFond = id => cosmetiques?.fonds.find(fond => fond.id === id) || null;
  const urlBlob = image => {
    if (!urlsImages.has(image)) urlsImages.set(image, URL.createObjectURL(image));
    return urlsImages.get(image);
  };
  // URL de l'image d'un fond (complète ou miniature), ou null.
  const urlFond = (id, miniature = false) => {
    if (id === FOND_PERSO) return imageBrouillon && urlBlob(imageBrouillon);
    const fond = getFond(id);
    return fond && urlImage(miniature ? fond.miniature : fond.image);
  };
  const valeurComparable = valeur => JSON.stringify(Array.isArray(valeur) ? [...valeur].sort() : valeur ?? null);
  // Flex : l'ordre des cases compte.
  const differe = (a, b, cle) => cle === "flex" ? JSON.stringify(a.flex) !== JSON.stringify(b.flex) : valeurComparable(a[cle]) !== valeurComparable(b[cle]);
  const cles = () => [...Object.keys(PARAMETRES_DEFAUT), "skins", "filtres_draft", "flex"];

  // "namecards/Namecard_Background_Hu_Tao_Lingering.webp" -> "Hu Tao Lingering"
  function nomNamecard(chemin) {
    return chemin.split("/").pop()
      .replace(/^Namecard_(Background|Banner)_/, "")
      .replace(/\.[a-z]+$/i, "")
      .replace(/_/g, " ");
  }

  function chargerStyles() {
    if (document.getElementById("styles-personnalisation")) return;
    const lien = document.createElement("link");
    lien.id = "styles-personnalisation";
    lien.rel = "stylesheet";
    lien.href = "/commun/personnalisation.css?v=20";
    document.head.appendChild(lien);
  }

  // Script commun chargé une seule fois (sauf si la page l'a déjà).
  const promessesScripts = {};
  function chargerScript(src, dejaCharge, erreur) {
    if (dejaCharge()) return Promise.resolve();
    promessesScripts[src] ??= new Promise((resoudre, rejeter) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resoudre;
      script.onerror = () => {
        delete promessesScripts[src];
        rejeter(new Error(erreur));
      };
      document.head.appendChild(script);
    });
    return promessesScripts[src];
  }

  // Voyageur, Manekin et skins (commun/variantes.js).
  const chargerVariantes = () => chargerScript("/commun/variantes.js?v=4",
    () => typeof SKINS_PERSONNAGES !== "undefined", "Impossible de charger les variantes.");
  // Ids et cosmétiques gratuits des Rikoyns (commun/koyns.js).
  const chargerKoyns = () => chargerScript("/commun/koyns.js?v=12",
    () => typeof idCosmetique !== "undefined", "Impossible de charger les Rikoyns.");
  // Filtres et tris de la draft (commun/filtres_draft.js).
  const chargerFiltresDraft = () => chargerScript("/commun/filtres_draft.js?v=4",
    () => typeof FILTRES_DRAFT !== "undefined", "Impossible de charger les filtres de la draft.");

  async function chargerCosmetiques() {
    if (cosmetiques) return cosmetiques;
    const reponse = await fetch(`${RACINE_IMAGES}cosmetiques.json`);
    if (!reponse.ok) throw new Error("Impossible de charger DB/images/cosmetiques.json");
    cosmetiques = await reponse.json();
    return cosmetiques;
  }

  async function chargerNomsPersos() {
    if (nomsPersos) return nomsPersos;
    try {
      const reponse = await fetch("/DB/characters.json");
      nomsPersos = new Map((await reponse.json()).map(perso => [perso.id, perso.nom]));
    } catch (erreur) {
      console.error(erreur);
      nomsPersos = new Map();
    }
    return nomsPersos;
  }

  // Profil enregistré et Rikoyns (solde, cosmétiques possédés) -> { profil,
  // koyns }. Rikoyns appliqués par l'appelant une fois commun/koyns.js
  // chargé (ICONE_KOYN) : le profil arrive souvent avant le script sur
  // téléphone.
  async function lireProfil() {
    const reponse = await fetch("/api/auth/profile", { credentials: "include" });
    if (!reponse.ok) throw new Error("Impossible de charger le profil.");
    const donnees = await reponse.json();
    return { profil: donnees.profil || {}, koyns: donnees.koyns || null };
  }

  // ---- Rikoyns ----

  function lireEtatKoyns(etat) {
    koyns = { ...etat, possedes: new Set(etat.possedes || []), exclusifs: new Set(etat.exclusifs || []) };
    // tirage : { prix, chance, garantie, focus: [ids], compteur }.
    koyns.tirage ??= null;
    if (modal) modal.querySelector(".perso-solde").innerHTML = `${koyns.solde} ${ICONE_KOYN}`;
  }

  // Choix pas possédés (cosmétiques payants) : sans Rikoyns chargés, tout est
  // considéré comme possédé (le serveur vérifie de toute façon).
  const possede = id => !koyns || koyns.tout || COSMETIQUES_GRATUITS.has(id) || koyns.possedes.has(id);
  const estExclusif = id => !!koyns?.exclusifs.has(id);
  const estFocusTirage = id => !!koyns?.tirage?.focus?.includes(id);

  // Choix enregistrés réduits aux cosmétiques possédés (comme le serveur).
  function sansNonPossedes(parametres = {}) {
    const propres = { ...parametres };
    cosmetiquesParametres(parametres).filter(id => !possede(id)).forEach(id => {
      const [choix, ...reste] = id.split(":");
      if (choix === "skin") propres.skins = (propres.skins || []).filter(skin => skin !== reste.join(":"));
      else delete propres[choix];
    });
    if (Array.isArray(propres.flex)) propres.flex = propres.flex.map(id => (id && possede(id) ? id : null));
    return propres;
  }

  // ---- Fenêtre de confirmation (au centre, à la place de confirm()) ----
  // contenu : nœud ou HTML ; -> Promise<boolean>. avantOk(dialog) : appelé à
  // chaque mise à jour (ex. panier modifié) pour activer ou non le bouton.
  function confirmer({ titre, contenu, ok = "Confirmer", annuler = "Annuler", classe = "" }) {
    return new Promise(resoudre => {
      const fenetre = document.createElement("dialog");
      fenetre.className = `perso-fenetre ${classe}`.trim();
      fenetre.innerHTML = `
        <h3 class="perso-fenetre-titre"></h3>
        <div class="perso-fenetre-contenu"></div>
        <div class="perso-fenetre-actions">
          <button type="button" class="perso-fenetre-annuler"></button>
          <button type="button" class="perso-fenetre-ok"></button>
        </div>`;
      fenetre.querySelector(".perso-fenetre-titre").textContent = titre;
      const zone = fenetre.querySelector(".perso-fenetre-contenu");
      if (typeof contenu === "string") zone.innerHTML = contenu;
      else zone.appendChild(contenu);
      fenetre.querySelector(".perso-fenetre-annuler").textContent = annuler;
      fenetre.querySelector(".perso-fenetre-ok").innerHTML = ok;
      let reponse = false;
      fenetre.querySelector(".perso-fenetre-annuler").addEventListener("click", () => fenetre.close());
      fenetre.querySelector(".perso-fenetre-ok").addEventListener("click", () => { reponse = true; fenetre.close(); });
      fenetre.addEventListener("click", event => { if (event.target === fenetre) fenetre.close(); });
      // Échap : ferme cette fenêtre seulement (pas la personnalisation).
      fenetre.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
      fenetre.addEventListener("close", () => {
        fenetre.remove();
        resoudre(reponse);
      });
      document.body.appendChild(fenetre);
      fenetre.showModal();
      fenetre.querySelector(".perso-fenetre-ok").focus();
    });
  }

  const texteRikoyns = montant => `${montant} ${ICONE_KOYN}`;

  // Solde avant / après un achat (rouge s'il ne suffit pas).
  function htmlSolde(total) {
    const apres = koyns.solde - total;
    return `<p class="perso-fenetre-solde${apres < 0 ? " insuffisant" : ""}">Solde : ${texteRikoyns(koyns.solde)} → <strong>${texteRikoyns(apres)}</strong></p>` +
      (apres < 0 ? `<p class="perso-fenetre-alerte">Il manque ${texteRikoyns(-apres)} : joue des matchs pour en gagner (5 par match).</p>` : "");
  }

  // Envoi d'un achat (un ou plusieurs cosmétiques). -> ids achetés.
  async function envoyerAchat(ids) {
    const reponse = await fetch("/api/auth/profile?action=acheter", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids.length === 1 ? { cosmetique: ids[0] } : { cosmetiques: ids })
    });
    const donnees = await reponse.json().catch(() => ({}));
    if (donnees.koyns) lireEtatKoyns(donnees.koyns);
    if (!reponse.ok) {
      const erreur = new Error(donnees.error || "Achat impossible.");
      erreur.achetes = donnees.achetes || [];
      throw erreur;
    }
    return donnees.achetes || ids;
  }

  // Import de Mon image : PRIX_IMPORT_FOND à chaque image (confirmation
  // d'abord ; administrateurs : gratuit). -> true si payé.
  async function payerImport() {
    if (koyns?.tout) return true;
    const ok = await confirmer({
      titre: "Importer une image",
      contenu: `<p>Mon image comme fond d'écran, pour <strong>${texteRikoyns(PRIX_IMPORT_FOND)}</strong> à chaque image importée.</p>${htmlSolde(PRIX_IMPORT_FOND)}`,
      ok: `Payer ${texteRikoyns(PRIX_IMPORT_FOND)}`
    });
    if (!ok) return false;
    afficherEtat("Achat…");
    try {
      await envoyerAchat([idCosmetique("fond", FOND_PERSO)]);
      afficherEtat("");
      return true;
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message);
      return false;
    }
  }

  // ---- Panier ----

  const totalPanier = () => [...panier.keys()].reduce((total, id) => total + prixCosmetique(id), 0);

  // Bouton du panier (en-tête) : nombre et total, caché si vide.
  function majBoutonPanier() {
    const bouton = modal.querySelector(".perso-panier");
    bouton.hidden = panier.size === 0;
    // Vide (ouverture) : commun/koyns.js (ICONE_KOYN) pas forcément chargé.
    if (!panier.size) return;
    bouton.innerHTML = `🛒 ${panier.size}<span class="perso-panier-montant"> · ${texteRikoyns(totalPanier())}</span>`;
    bouton.title = `Panier : ${panier.size} cosmétique${panier.size > 1 ? "s" : ""}, clic pour acheter`;
  }

  // Clic sur un cosmétique pas possédé : ajouté au panier, ou retiré.
  function basculerPanier(id, article) {
    if (estExclusif(id)) {
      afficherEtat("Cosmétique exclusif : il se gagne aux classements et aux événements.");
      return;
    }
    if (estFocusTirage(id)) {
      afficherEtat("Cosmétique focus : il ne s'obtient que par tirage (page Cosmétiques).");
      return;
    }
    if (panier.has(id)) panier.delete(id);
    else panier.set(id, article);
    afficherEtat(panier.has(id) ? `« ${article.nom} » ajouté au panier.` : `« ${article.nom} » retiré du panier.`);
    majBoutonPanier();
    rendreChoix();
  }

  // Contenu de la fenêtre du panier (lignes, total, solde), refait à chaque
  // retrait.
  function rendrePanier(zone, fenetre) {
    const total = totalPanier();
    zone.innerHTML = `
      <ul class="perso-panier-lignes">${[...panier.values()].map(article => `
        <li data-id="${encodeURIComponent(article.id)}">
          ${article.image ? `<img src="${article.image}" alt="" loading="lazy">` : `<span class="perso-panier-sans-image"></span>`}
          <span class="perso-panier-nom"><strong></strong><small>${article.type}</small></span>
          <span class="perso-panier-prix">${texteRikoyns(prixCosmetique(article.id))}</span>
          <button type="button" class="perso-panier-retirer" title="Retirer du panier" aria-label="Retirer du panier">×</button>
        </li>`).join("")}
      </ul>
      <p class="perso-panier-total">Total : <strong>${texteRikoyns(total)}</strong></p>
      ${htmlSolde(total)}`;
    zone.querySelectorAll("li").forEach(ligne => {
      const id = decodeURIComponent(ligne.dataset.id);
      ligne.querySelector("strong").textContent = panier.get(id).nom;
      ligne.querySelector(".perso-panier-retirer").addEventListener("click", () => {
        panier.delete(id);
        majBoutonPanier();
        rendreChoix();
        if (!panier.size) fenetre.close();
        else rendrePanier(zone, fenetre);
      });
    });
    const ok = fenetre.querySelector(".perso-fenetre-ok");
    ok.disabled = !panier.size || koyns.solde < total;
    ok.innerHTML = `Acheter${panier.size > 1 ? ` les ${panier.size}` : ""} · ${texteRikoyns(total)}`;
  }

  async function ouvrirPanier() {
    if (!panier.size) return;
    const zone = document.createElement("div");
    const promesse = confirmer({ titre: "Panier", contenu: zone, ok: "Acheter", annuler: "Continuer mes achats", classe: "perso-fenetre-panier" });
    rendrePanier(zone, zone.closest("dialog"));
    if (!await promesse || !panier.size) return;
    const articles = [...panier.values()];
    afficherEtat("Achat…");
    let achetes = [];
    try {
      achetes = await envoyerAchat(articles.map(article => article.id));
    } catch (erreur) {
      console.error(erreur);
      achetes = erreur.achetes || [];
      afficherEtat(erreur.message);
    }
    achetes.forEach(id => panier.delete(id));
    // Un seul cosmétique acheté : choisi tout de suite (comme avant le panier).
    if (achetes.length === 1) articles.find(article => article.id === achetes[0])?.choisir?.();
    if (achetes.length) {
      afficherEtat(achetes.length === 1 ? `« ${articles.find(a => a.id === achetes[0]).nom} » obtenu !` : `${achetes.length} cosmétiques obtenus !`);
      celebrerAchat(achetes.length);
    }
    majBoutonPanier();
    rendreApercus();
    rendreChoix();
    mettreAJourPied();
  }

  // Petite animation sur le solde après un achat.
  function celebrerAchat() {
    const solde = modal.querySelector(".perso-solde");
    solde.classList.remove("achat");
    void solde.offsetWidth;
    solde.classList.add("achat");
  }

  const TYPES_COSMETIQUES = { fond: "Fond d'écran", banniere: "Namecard", banniere2: "Bannière", skin: "Skin", voyageur: "Voyageur", manekin: "Manekin" };

  // Choix manquant (ou ancien "aucun") : valeur par défaut.
  function avecDefauts(parametres = {}) {
    return {
      ...Object.fromEntries(Object.entries(PARAMETRES_DEFAUT).map(([cle, defaut]) => [cle, parametres[cle] || defaut])),
      skins: Array.isArray(parametres.skins) ? parametres.skins.filter(id => SKINS_PERSONNAGES.includes(id)) : [],
      filtres_draft: lireFiltresDraft(parametres.filtres_draft),
      // Namecards et fonds seulement (anciens flex : le reste retiré).
      flex: Array.from({ length: TAILLE_FLEX }, (_, i) => {
        const id = parametres.flex?.[i];
        return typeof id === "string" && /^(banniere|fond):/.test(id) && id !== "fond:perso" ? id : null;
      })
    };
  }

  // Copie indépendante des choix (listes copiées).
  function copieChoix(choix) {
    return {
      ...choix,
      skins: [...choix.skins],
      filtres_draft: { masques: [...choix.filtres_draft.masques], figes: [...choix.filtres_draft.figes] },
      flex: [...choix.flex]
    };
  }

  // Aperçu du fond pendant le choix (calque body::before, cf. entete.css) ;
  // null : retour au fond enregistré (commun/fond.js).
  function apercuFond(id) {
    const url = id && urlFond(id);
    if (url) document.body.style.setProperty("--fond-ecran", `url("${url}")`);
    else document.body.style.removeProperty("--fond-ecran");
  }

  function toBlob(canvas, type) {
    return new Promise(resoudre => canvas.toBlob(resoudre, type, 0.9));
  }

  // Image choisie par le joueur -> Blob WebP (JPEG si le navigateur ne sait
  // pas encoder le WebP) d'au plus TAILLE_MAX_IMAGE_PERSO px de côté.
  async function preparerImagePerso(fichier) {
    if (!TYPES_IMAGE_PERSO.includes(fichier.type)) throw new Error("Formats acceptés : PNG, JPEG, WebP ou AVIF.");
    if (fichier.size > POIDS_MAX_IMAGE_PERSO) throw new Error("Image trop lourde (25 Mo au plus).");
    let bitmap;
    try {
      bitmap = await createImageBitmap(fichier);
    } catch {
      throw new Error("Image illisible.");
    }
    try {
      if (bitmap.width * bitmap.height > PIXELS_MAX_IMAGE_PERSO) throw new Error("Image trop grande.");
      const echelle = Math.min(1, TAILLE_MAX_IMAGE_PERSO / bitmap.width, TAILLE_MAX_IMAGE_PERSO / bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * echelle));
      canvas.height = Math.max(1, Math.round(bitmap.height * echelle));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let image = await toBlob(canvas, "image/webp");
      if (!image || image.type !== "image/webp") image = await toBlob(canvas, "image/jpeg");
      if (!image) throw new Error("Impossible de préparer l'image.");
      return image;
    } finally {
      bitmap.close();
    }
  }

  async function importerImagePerso(fichier) {
    if (!fichier || !brouillon) return;
    afficherEtat("Préparation de l'image…");
    try {
      imageBrouillon = await preparerImagePerso(fichier);
      brouillon.fond = FOND_PERSO;
      apercuFond(FOND_PERSO);
      afficherEtat("");
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message || "Impossible d'importer l'image.");
    }
    rendreApercus();
    rendreChoix();
    mettreAJourPied();
  }

  function creerModal() {
    modal = document.createElement("div");
    modal.className = "modal-personnalisation";
    modal.innerHTML = `
      <div class="perso-contenu" role="dialog" aria-modal="true" aria-label="Personnalisation">
        <div class="perso-entete">
          <h2>Personnalisation</h2>
          <button type="button" class="perso-panier" hidden></button>
          <span class="perso-solde" title="Rikoyns : gagnés en jouant (5 par match), ils servent à obtenir les cosmétiques"></span>
          <button type="button" class="perso-fermer" aria-label="Fermer">×</button>
        </div>
        <div class="perso-apercus">
          <button type="button" class="perso-apercu-bloc" data-onglet="fond">
            <span class="perso-apercu-titre">Fond d'écran</span>
            <span class="perso-apercu-image perso-apercu-fond" data-apercu="fond"></span>
          </button>
          <button type="button" class="perso-apercu-bloc" data-onglet="banniere">
            <span class="perso-apercu-titre">Namecard</span>
            <span class="perso-apercu-image perso-apercu-banniere" data-apercu="banniere"></span>
          </button>
          <button type="button" class="perso-apercu-bloc" data-onglet="banniere2">
            <span class="perso-apercu-titre">Bannière</span>
            <span class="perso-apercu-image perso-apercu-banniere2" data-apercu="banniere2"></span>
          </button>
          <button type="button" class="perso-apercu-bloc" data-onglet="skins">
            <span class="perso-apercu-titre">Skins</span>
            <span class="perso-apercu-image perso-apercu-skins" data-apercu="skins"></span>
          </button>
          <button type="button" class="perso-apercu-bloc" data-onglet="flex">
            <span class="perso-apercu-titre">Flex</span>
            <span class="perso-apercu-image perso-apercu-flex" data-apercu="flex"></span>
          </button>
          <button type="button" class="perso-apercu-bloc" data-onglet="filtres">
            <span class="perso-apercu-titre">Filtres/Tris</span>
            <span class="perso-apercu-image perso-apercu-filtres" data-apercu="filtres"></span>
          </button>
          <button type="button" class="perso-apercu-bloc" data-onglet="accueil">
            <span class="perso-apercu-titre">Accueil</span>
            <span class="perso-apercu-image perso-apercu-accueil" data-apercu="accueil"></span>
          </button>
        </div>
        <input type="text" class="perso-recherche" placeholder="Rechercher…" autocomplete="off">
        <div class="perso-choix"></div>
        <input type="file" class="perso-fichier-image" accept="${TYPES_IMAGE_PERSO.join(",")}" hidden>
        <div class="perso-pied">
          <button type="button" class="perso-annuler">Annuler</button>
          <span class="perso-etat"></span>
          <button type="button" class="perso-enregistrer" disabled>Enregistrer</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".perso-fermer").addEventListener("click", fermer);
    modal.querySelector(".perso-annuler").addEventListener("click", fermer);
    modal.addEventListener("click", event => {
      if (event.target === modal) fermer();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && modal.classList.contains("active")) fermer();
    });
    modal.querySelectorAll(".perso-apercu-bloc").forEach(bloc => {
      bloc.addEventListener("click", () => choisirOnglet(bloc.dataset.onglet));
    });
    modal.querySelector(".perso-recherche").addEventListener("input", rendreChoix);
    modal.querySelector(".perso-panier").addEventListener("click", ouvrirPanier);
    modal.querySelector(".perso-enregistrer").addEventListener("click", enregistrer);
    const champImage = modal.querySelector(".perso-fichier-image");
    champImage.addEventListener("change", async () => {
      const fichier = champImage.files[0];
      champImage.value = "";
      if (fichier && await payerImport()) importerImagePerso(fichier);
    });

    // Téléphone : en faisant défiler les choix, seuls l'aperçu actif et la
    // recherche restent en haut (classe "defilement", cf.
    // personnalisation.css) ; tout en haut, les autres aperçus reviennent.
    // Seulement si la liste défile encore une fois les aperçus masqués
    // (sinon ils clignoteraient).
    const contenu = modal.querySelector(".perso-contenu");
    const apercus = modal.querySelector(".perso-apercus");
    const choix = modal.querySelector(".perso-choix");
    choix.addEventListener("scroll", () => {
      const haut = choix.scrollTop;
      if (contenu.classList.contains("defilement")) {
        if (haut <= 4) contenu.classList.remove("defilement");
        return;
      }
      const hauteurMasquee = apercus.offsetHeight - (apercus.querySelector(".perso-apercu-bloc.active")?.offsetHeight || 0);
      const marge = choix.scrollHeight - choix.clientHeight;
      if (haut > 24 && marge > hauteurMasquee + 24) contenu.classList.add("defilement");
    }, { passive: true });
  }

  function afficherEtat(texte) {
    modal.querySelector(".perso-etat").textContent = texte;
  }

  // Enregistrer / Annuler : grisés tant que rien n'a changé.
  function mettreAJourPied() {
    const modifie = !!brouillon && (cles().some(cle => differe(brouillon, enregistres, cle)) || imageBrouillon !== imageEnregistree);
    modal.querySelector(".perso-enregistrer").classList.toggle("modifie", modifie);
    modal.querySelector(".perso-annuler").classList.toggle("modifie", modifie);
    modal.querySelector(".perso-enregistrer").disabled = !modifie;
  }

  function choisirOnglet(onglet) {
    ongletActif = onglet;
    modal.querySelectorAll(".perso-apercu-bloc").forEach(bloc => {
      bloc.classList.toggle("active", bloc.dataset.onglet === onglet);
    });
    modal.querySelector(".perso-recherche").value = "";
    rendreChoix();
    modal.querySelector(".perso-choix").scrollTop = 0;
    modal.querySelector(".perso-contenu").classList.remove("defilement");
  }

  function rendreApercus() {
    const voyageur = VARIANTES_PERSONNAGES.traveler.options[brouillon.voyageur] || VARIANTES_PERSONNAGES.traveler.options.aether;
    const urls = {
      fond: urlFond(brouillon.fond, true),
      banniere: brouillon.banniere && urlImage(brouillon.banniere),
      banniere2: brouillon.banniere2 && urlImage(brouillon.banniere2),
      skins: urlImage(voyageur.image.replace(/^images\//, "")),
      filtres: urlImage("others/remove_filters.webp"),
      flex: brouillon.flex.find(Boolean) && infoCosmetique(brouillon.flex.find(Boolean)).image,
    };
    const affiches = FILTRES_DRAFT.length - brouillon.filtres_draft.masques.length;
    const textes = {
      skins: `${brouillon.skins.length} skin${brouillon.skins.length > 1 ? "s" : ""}`,
      filtres: `${affiches} / ${FILTRES_DRAFT.length}`,
      flex: `${brouillon.flex.filter(Boolean).length} / ${TAILLE_FLEX}`,
      accueil: AFFICHAGES_ACCUEIL.find(affichage => affichage.id === brouillon.accueil)?.nom || ""
    };
    modal.querySelectorAll("[data-apercu]").forEach(bloc => {
      const url = urls[bloc.dataset.apercu];
      bloc.style.backgroundImage = url ? `url("${url}")` : "";
      bloc.textContent = textes[bloc.dataset.apercu] ?? (url ? "" : "Aucun");
    });
  }

  // Une image cliquable ; choisir() applique le choix au brouillon.
  // image null : bouton texte (titre affiché), ex. "Importer une image".
  // cosmetique : id du cosmétique (commun/koyns.js) ; pas possédé : cadenas
  // et prix, mis au panier (ou retiré) au clic.
  function creerChoix(image, titre, actif, choisir, classe = "", cosmetique = null) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = `perso-choix-image ${classe}`.trim();
    bouton.title = titre;
    bouton.classList.toggle("active", actif);
    const verrouille = !!cosmetique && !possede(cosmetique);
    if (image) {
      const img = document.createElement("img");
      img.src = image;
      img.alt = titre;
      img.loading = "lazy";
      bouton.appendChild(img);
    } else {
      bouton.textContent = titre;
    }
    if (verrouille) {
      bouton.classList.add("verrouille");
      const dansPanier = panier.has(cosmetique);
      bouton.classList.toggle("dans-panier", dansPanier);
      const badge = document.createElement("span");
      badge.className = "perso-prix";
      const exclusif = estExclusif(cosmetique);
      const focus = estFocusTirage(cosmetique);
      const montant = prixCosmetique(cosmetique);
      badge.innerHTML = exclusif ? "🔒 Exclusif" : focus ? "🎲 Tirage" : `${dansPanier ? "🛒" : "🔒"} ${montant} ${ICONE_KOYN}`;
      bouton.appendChild(badge);
      bouton.title = `${titre} — ${exclusif ? "exclusif" : focus ? "focus du tirage (page Cosmétiques)" : `${montant} Rikoyn${montant > 1 ? "s" : ""}, ${dansPanier ? "dans le panier (clic pour le retirer)" : "clic pour l'ajouter au panier"}`}`;
    }
    bouton.addEventListener("click", () => {
      if (!brouillon) return;
      if (verrouille) {
        basculerPanier(cosmetique, { id: cosmetique, nom: titre.replace(/ : clic pour activer le skin$/, ""), image, type: TYPES_COSMETIQUES[cosmetique.split(":")[0]] || "Cosmétique", choisir });
        return;
      }
      choisir();
      rendreApercus();
      rendreChoix();
      mettreAJourPied();
    });
    return bouton;
  }

  function nouvelleGrille(type = ongletActif) {
    const grille = document.createElement("div");
    grille.className = `perso-grille perso-grille-${type}`;
    return grille;
  }

  function titreSection(texte) {
    const titre = document.createElement("h3");
    titre.className = "perso-categorie";
    titre.textContent = texte;
    return titre;
  }

  // Voyageur et Manekin (une variante au choix), puis les skins (chacun
  // activé ou non, clic pour basculer).
  function rendreSkins(conteneur, recherche) {
    const correspond = texte => !recherche || texte.toLowerCase().includes(recherche);
    [["traveler", "voyageur", "Voyageur"], ["manekin", "manekin", "Manekin"]].forEach(([id, cle, titre]) => {
      const variante = VARIANTES_PERSONNAGES[id];
      const choix = Object.entries(variante.options).filter(([, option]) => correspond(`${titre} ${option.nom}`));
      if (!choix.length) return;
      const grille = nouvelleGrille("variantes");
      choix.forEach(([valeur, option]) => grille.appendChild(creerChoix(
        urlImage(option.image.replace(/^images\//, "")), option.nom, brouillon[cle] === valeur,
        () => { brouillon[cle] = valeur; }, "", idCosmetique(cle, valeur))));
      conteneur.append(titreSection(titre), grille);
    });

    const skins = SKINS_PERSONNAGES.filter(id => correspond(nomsPersos.get(id) || id));
    if (!skins.length) return;
    const grille = nouvelleGrille("skins");
    skins.forEach(id => {
      const actif = brouillon.skins.includes(id);
      grille.appendChild(creerChoix(
        urlImage(imagesSkin(id).item.replace(/^images\//, "")),
        `${nomsPersos.get(id) || id} : ${actif ? "skin activé (clic pour le retirer)" : "clic pour activer le skin"}`,
        actif,
        () => { brouillon.skins = actif ? brouillon.skins.filter(s => s !== id) : [...brouillon.skins, id]; },
        "", actif ? null : idCosmetique("skin", id)));
    });
    conteneur.append(titreSection("Skins (clic pour activer / retirer)"), grille);
  }

  // Filtres et tris de la draft : une ligne chacun (case "affiché", logo,
  // fonctionnement, case "figé sur téléphone"). Cocher / décocher ne
  // reconstruit pas la liste (défilement gardé).
  function rendreFiltresDraft(conteneur, recherche) {
    const choix = brouillon.filtres_draft;
    const basculer = (liste, id, actif) => {
      const reste = choix[liste].filter(autre => autre !== id);
      choix[liste] = (actif ? [...reste, id] : reste).sort();
      rendreApercus();
      mettreAJourPied();
    };
    const note = document.createElement("p");
    note.className = "perso-note";
    note.textContent = "Décoche ceux que tu ne veux pas voir dans la barre de la draft. « Figé » : sur téléphone, il reste en haut de l'écran quand tu fais défiler les persos. Tris : 1er clic dans un sens, 2e dans l'autre, 3e pour l'enlever.";
    conteneur.appendChild(note);

    [["filtres", "Filtres"], ["tris", "Tris"]].forEach(([groupe, titre]) => {
      const filtres = FILTRES_DRAFT.filter(filtre => filtre.groupe === groupe &&
        (!recherche || `${filtre.nom} ${filtre.description}`.toLowerCase().includes(recherche)));
      if (!filtres.length) return;
      const tableau = document.createElement("table");
      tableau.className = "perso-filtres";
      tableau.innerHTML = `<thead><tr><th>Affiché</th><th></th><th>Fonctionnement</th><th>Figé<span>sur téléphone</span></th></tr></thead>`;
      const corps = document.createElement("tbody");
      filtres.forEach(filtre => {
        const ligne = document.createElement("tr");
        const affiche = !choix.masques.includes(filtre.id);
        ligne.classList.toggle("masque", !affiche);
        ligne.innerHTML = `
          <td><input type="checkbox" class="filtre-affiche" aria-label="Afficher : ${filtre.nom}"></td>
          <td class="perso-filtre-logo">${filtre.logo ? `<img src="${filtre.logo}" alt="">` : `<span></span>`}</td>
          <td><strong></strong> <span class="perso-filtre-description"></span></td>
          <td><input type="checkbox" class="filtre-fige" aria-label="Figé sur téléphone : ${filtre.nom}"></td>`;
        if (!filtre.logo) ligne.querySelector(".perso-filtre-logo span").textContent = filtre.texte;
        ligne.querySelector("strong").textContent = filtre.nom;
        ligne.querySelector(".perso-filtre-description").textContent = filtre.description;
        const caseAffiche = ligne.querySelector(".filtre-affiche");
        const caseFige = ligne.querySelector(".filtre-fige");
        caseAffiche.checked = affiche;
        caseFige.checked = choix.figes.includes(filtre.id);
        caseFige.disabled = !affiche;
        caseAffiche.addEventListener("change", () => {
          basculer("masques", filtre.id, !caseAffiche.checked);
          ligne.classList.toggle("masque", !caseAffiche.checked);
          caseFige.disabled = !caseAffiche.checked;
        });
        caseFige.addEventListener("change", () => basculer("figes", filtre.id, caseFige.checked));
        corps.appendChild(ligne);
      });
      tableau.appendChild(corps);
      conteneur.append(titreSection(titre), tableau);
    });
  }

  // Flex cosmétiques : la grille de 3 × 4 (case choisie entourée, × pour
  // la vider), puis les cosmétiques possédés par type ; clic : placé dans
  // la case choisie (retiré de son ancienne case), puis case vide suivante.
  function rendreFlex(conteneur, recherche) {
    const flex = brouillon.flex;
    const majTout = () => {
      rendreApercus();
      rendreChoix();
      mettreAJourPied();
    };
    const note = document.createElement("p");
    note.className = "perso-note";
    note.textContent = `Jusqu'à ${TAILLE_FLEX} namecards et fonds d'écran que tu possèdes, montrés sur la page Joueurs (onglet Flex cosmétiques). Clic sur une case, puis sur un cosmétique.`;
    const grilleFlex = document.createElement("div");
    grilleFlex.className = "perso-flex-grille";
    flex.forEach((id, i) => {
      const caseBouton = document.createElement("button");
      caseBouton.type = "button";
      caseBouton.className = `perso-flex-case${i === caseFlex ? " active" : ""}`;
      if (id) {
        const info = infoCosmetique(id);
        caseBouton.classList.add(`perso-flex-${info.choix}`);
        caseBouton.title = `${info.nom} (${info.type})`;
        if (info.image) {
          const img = document.createElement("img");
          img.src = info.image;
          img.alt = info.nom;
          caseBouton.appendChild(img);
        }
        const vider = document.createElement("span");
        vider.className = "perso-flex-vider";
        vider.textContent = "×";
        vider.title = "Vider la case";
        vider.addEventListener("click", event => {
          event.stopPropagation();
          flex[i] = null;
          caseFlex = i;
          majTout();
        });
        caseBouton.appendChild(vider);
      } else {
        caseBouton.textContent = "+";
        caseBouton.title = "Case vide : clic pour la choisir, puis clic sur un cosmétique";
      }
      caseBouton.addEventListener("click", () => {
        caseFlex = i;
        rendreChoix();
      });
      grilleFlex.appendChild(caseBouton);
    });
    conteneur.append(note, grilleFlex);

    const placer = id => () => {
      const ancienne = flex.indexOf(id);
      if (ancienne >= 0) flex[ancienne] = null;
      flex[caseFlex] = id;
      const vide = [...flex.keys()].map(k => (caseFlex + 1 + k) % TAILLE_FLEX).find(k => !flex[k]);
      if (vide !== undefined) caseFlex = vide;
    };
    const correspond = info => !recherche || `${info.nom} ${info.type}`.toLowerCase().includes(recherche);
    // Namecards et fonds d'écran du site seulement (pas Mon image).
    [
      ["Namecards", "banniere", cosmetiques.bannieres.map(chemin => idCosmetique("banniere", chemin))],
      ["Fonds d'écran", "fond", cosmetiques.fonds.map(fond => idCosmetique("fond", fond.id))]
    ].forEach(([titre, type, ids]) => {
      const infos = ids.filter(id => possede(id) && !COSMETIQUES_GRATUITS.has(id)).map(infoCosmetique).filter(correspond);
      if (!infos.length) return;
      const grille = nouvelleGrille(type);
      infos.forEach(info => {
        const id = idCosmetique(info.choix, info.valeur);
        grille.appendChild(creerChoix(info.image, info.nom, flex.includes(id), placer(id)));
      });
      conteneur.append(titreSection(titre), grille);
    });
    if (conteneur.querySelectorAll(".perso-grille").length === 0) {
      const vide = document.createElement("p");
      vide.className = "perso-note";
      vide.textContent = recherche ? "Aucune namecard ni aucun fond possédé ne correspond." : "Tu n'as pas encore de namecard ni de fond d'écran : achète-en ou tente le tirage !";
      conteneur.appendChild(vide);
    }
  }

  // Affichage de l'accueil : un schéma de chaque page (cartes en petits
  // rectangles), gratuit.
  function rendreAccueil(conteneur) {
    const note = document.createElement("p");
    note.className = "perso-note";
    note.textContent = "Disposition des cartes de la page d'accueil. Gratuit.";
    const grille = nouvelleGrille();
    AFFICHAGES_ACCUEIL.forEach(affichage => {
      const bouton = creerChoix(null, affichage.nom, brouillon.accueil === affichage.id,
        () => { brouillon.accueil = affichage.id; }, `perso-choix-accueil perso-schema-${affichage.id}`);
      bouton.title = affichage.description;
      bouton.innerHTML = `<span class="perso-schema" aria-hidden="true">${"<span></span>".repeat(8)}</span>`;
      const nom = document.createElement("strong");
      nom.textContent = affichage.nom;
      const description = document.createElement("span");
      description.className = "perso-schema-description";
      description.textContent = affichage.description;
      bouton.append(nom, description);
      grille.appendChild(bouton);
    });
    conteneur.append(note, grille);
  }

  // ---- Infos des cosmétiques (flex, équiper) ----

  // Nom, type et image d'un cosmétique (id "<choix>:<valeur>").
  function infoCosmetique(id) {
    const [choix, ...reste] = id.split(":");
    const valeur = reste.join(":");
    const type = TYPES_COSMETIQUES[choix] || "Cosmétique";
    if (choix === "fond") {
      const fond = getFond(valeur);
      return { choix, valeur, type, nom: fond ? nomFond(fond) : valeur, image: fond && urlImage(fond.miniature) };
    }
    if (choix === "banniere" || choix === "banniere2") return { choix, valeur, type, nom: nomNamecard(valeur), image: urlImage(valeur) };
    if (choix === "skin") return { choix, valeur, type, nom: nomsPersos?.get(valeur) || valeur, image: urlImage(imagesSkin(valeur).item.replace(/^images\//, "")) };
    const option = Object.values(VARIANTES_PERSONNAGES).find(v => v.parametre === choix)?.options[valeur];
    return { choix, valeur, type, nom: option?.nom || valeur, image: option && urlImage(option.image.replace(/^images\//, "")) };
  }

  // Cosmétique gagné porté dans le brouillon (à enregistrer ensuite).
  function equiper(id) {
    const { choix, valeur } = infoCosmetique(id);
    if (choix === "skin") {
      if (!brouillon.skins.includes(valeur)) brouillon.skins = [...brouillon.skins, valeur];
    } else {
      brouillon[choix] = valeur;
      if (choix === "fond") apercuFond(valeur);
    }
    rendreApercus();
    mettreAJourPied();
  }

  function rendreChoix() {
    const conteneur = modal.querySelector(".perso-choix");
    conteneur.innerHTML = "";
    conteneur.classList.toggle("perso-choix-flex", ongletActif === "flex");
    if (!cosmetiques) {
      conteneur.textContent = "Impossible de charger la liste des images.";
      return;
    }
    const recherche = modal.querySelector(".perso-recherche").value.trim().toLowerCase();

    if (ongletActif === "skins") {
      rendreSkins(conteneur, recherche);
      return;
    }
    if (ongletActif === "filtres") {
      rendreFiltresDraft(conteneur, recherche);
      return;
    }
    if (ongletActif === "accueil") {
      rendreAccueil(conteneur);
      return;
    }
    if (ongletActif === "flex") {
      rendreFlex(conteneur, recherche);
      return;
    }

    const choisir = valeur => () => {
      brouillon[ongletActif] = valeur;
      if (ongletActif === "fond") apercuFond(valeur);
    };

    if (ongletActif === "fond") {
      // Mon image : la choisir, en importer une (autre), ou la retirer.
      if (!recherche || "mon image".includes(recherche)) {
        const grille = nouvelleGrille();
        if (imageBrouillon) {
          grille.appendChild(creerChoix(urlBlob(imageBrouillon), "Mon image", brouillon.fond === FOND_PERSO, choisir(FOND_PERSO), "", idCosmetique("fond", FOND_PERSO)));
        }
        // Mon image : PRIX_IMPORT_FOND à chaque image importée, payés une
        // fois l'image choisie (cf. payerImport).
        const importer = creerChoix(null, imageBrouillon ? "Changer d'image" : "＋ Importer une image", false, () => {}, "perso-choix-action");
        // Prix en bas, avec l'icône des Rikoyns (comme les cosmétiques à acheter).
        const prixImport = document.createElement("span");
        prixImport.className = "perso-prix";
        prixImport.innerHTML = `${PRIX_IMPORT_FOND} ${ICONE_KOYN}`;
        importer.appendChild(prixImport);
        importer.title = `${importer.title} — ${PRIX_IMPORT_FOND} Rikoyns à chaque image importée`;
        importer.addEventListener("click", () => {
          if (koyns && !koyns.tout && koyns.solde < PRIX_IMPORT_FOND) {
            afficherEtat(`Importer une image coûte ${PRIX_IMPORT_FOND} Rikoyns : joue des matchs pour en gagner (5 par match).`);
            return;
          }
          modal.querySelector(".perso-fichier-image").click();
        });
        grille.appendChild(importer);
        if (imageBrouillon) {
          grille.appendChild(creerChoix(null, "Retirer mon image", false, () => {
            imageBrouillon = null;
            if (brouillon.fond === FOND_PERSO) {
              brouillon.fond = PARAMETRES_DEFAUT.fond;
              apercuFond(brouillon.fond);
            }
          }, "perso-choix-action"));
        }
        const note = document.createElement("p");
        note.className = "perso-note";
        note.textContent = "Ton image reste dans ce navigateur, elle n'est jamais envoyée sur le site : importe-la sur chacun de tes appareils.";
        conteneur.append(titreSection("Mon image"), note, grille);
      }

      // Fonds groupés par sous-dossier de DB/images/bg.
      [...new Set(cosmetiques.fonds.map(fond => fond.categorie))].forEach(categorie => {
        const fonds = cosmetiques.fonds.filter(fond =>
          fond.categorie === categorie && (!recherche || nomFond(fond).toLowerCase().includes(recherche)));
        if (!fonds.length) return;
        const grille = nouvelleGrille();
        fonds.forEach(fond => grille.appendChild(creerChoix(
          urlImage(fond.miniature), nomFond(fond), brouillon.fond === fond.id, choisir(fond.id), "", idCosmetique("fond", fond.id))));
        conteneur.append(titreSection((categorie || "Divers").replace(/_/g, " ")), grille);
      });
      return;
    }

    // Bannière par défaut en premier.
    const liste = ongletActif === "banniere" ? cosmetiques.bannieres : cosmetiques.bannieres2;
    const grille = nouvelleGrille();
    [...liste]
      .sort((a, b) => (b === PARAMETRES_DEFAUT[ongletActif]) - (a === PARAMETRES_DEFAUT[ongletActif]))
      // Cachés (cosmetiques.json, "caches") : seulement une fois obtenus.
      .filter(chemin => !cosmetiques.caches?.includes(idCosmetique(ongletActif, chemin)) || possede(idCosmetique(ongletActif, chemin)))
      .filter(chemin => !recherche || nomNamecard(chemin).toLowerCase().includes(recherche))
      .forEach(chemin => grille.appendChild(creerChoix(
        urlImage(chemin), nomNamecard(chemin), brouillon[ongletActif] === chemin, choisir(chemin), "", idCosmetique(ongletActif, chemin))));
    conteneur.appendChild(grille);
  }

  // options.recharger : false pour ne pas recharger la page quand Voyageur,
  // Manekin ou les skins changent ; options.onglet : onglet ouvert.
  async function ouvrir(nouvellesOptions = {}) {
    options = nouvellesOptions;
    chargerStyles();
    if (!modal) creerModal();
    // Choix de l'ouverture précédente retirés pendant le chargement.
    brouillon = null;
    panier.clear();
    majBoutonPanier();
    modal.querySelector(".perso-choix").innerHTML = "";
    modal.querySelectorAll("[data-apercu]").forEach(bloc => { bloc.style.backgroundImage = ""; bloc.textContent = ""; });
    modal.classList.add("active");
    modal.classList.add("chargement");
    afficherEtat("Chargement…");
    mettreAJourPied();
    try {
      const [{ profil, koyns: etatKoyns }, image] = await Promise.all([
        lireProfil(), window.FondEcran?.lireImagePerso() ?? null, chargerCosmetiques(), chargerVariantes(), chargerFiltresDraft(), chargerNomsPersos(), chargerKoyns()
      ]);
      if (etatKoyns) lireEtatKoyns(etatKoyns);
      imageEnregistree = imageBrouillon = image;
      // Cosmétiques plus possédés (lancement des Rikoyns) : choix par défaut.
      enregistres = avecDefauts(sansNonPossedes(profil.parametres));
      brouillon = copieChoix(enregistres);
      caseFlex = Math.max(0, brouillon.flex.findIndex(id => !id));
      afficherEtat("");
    } catch (erreur) {
      console.error(erreur);
      afficherEtat("Erreur de chargement.");
      return;
    } finally {
      modal.classList.remove("chargement");
    }
    // Cosmétique à équiper (bouton Équiper d'un tirage, page Cosmétiques) :
    // choisi dans le brouillon, onglet de son type ouvert.
    let onglet = options.onglet || "fond";
    if (options.equiper && possede(options.equiper)) {
      equiper(options.equiper);
      const choix = options.equiper.split(":")[0];
      onglet = ["voyageur", "manekin", "skin"].includes(choix) ? "skins" : choix;
      afficherEtat(`« ${infoCosmetique(options.equiper).nom} » choisi : pense à enregistrer.`);
    }
    rendreApercus();
    choisirOnglet(onglet);
    mettreAJourPied();
  }

  // Fermer sans enregistrer : retour au fond enregistré.
  function fermer() {
    modal.classList.remove("active");
    apercuFond(null);
    afficherEtat("");
  }

  async function enregistrer() {
    const bouton = modal.querySelector(".perso-enregistrer");
    bouton.disabled = true;
    afficherEtat("Enregistrement…");
    try {
      if (imageBrouillon !== imageEnregistree) {
        try {
          await window.FondEcran.enregistrerImagePerso(imageBrouillon);
        } catch (erreur) {
          console.error(erreur);
          throw new Error("Ce navigateur ne permet pas de garder l'image (navigation privée ?).");
        }
        imageEnregistree = imageBrouillon;
      }
      const { profil, koyns: etatKoyns } = await lireProfil();
      if (etatKoyns) lireEtatKoyns(etatKoyns);
      profil.parametres = { ...(profil.parametres || {}), ...brouillon };
      const reponse = await fetch("/api/auth/profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profil)
      });
      if (!reponse.ok) {
        const { error } = await reponse.json().catch(() => ({}));
        throw new Error(error || "Erreur lors de l'enregistrement.");
      }
      const persosChanges = CLES_PERSOS.some(cle => differe(brouillon, enregistres, cle));
      enregistres = copieChoix(brouillon);
      // Fond et deuxième bannière gardés pour tout le site (commun/fond.js).
      // Fond personnel : marqueur FOND_PERSO (image relue par commun/fond.js).
      const valeurFond = brouillon.fond === FOND_PERSO ? FOND_PERSO : urlFond(brouillon.fond);
      if (window.FondEcran) window.FondEcran.appliquer(valeurFond);
      else document.documentElement.style.setProperty("--fond-ecran", valeurFond ? `url("${valeurFond}")` : "none");
      window.FondEcran?.memoriser(valeurFond, urlImage(brouillon.banniere2));
      window.FondEcran?.memoriserAccueil(brouillon.accueil);
      fermer();
      document.dispatchEvent(new CustomEvent("personnalisation-enregistree", { detail: { ...profil.parametres } }));
      if (persosChanges && options.recharger !== false) window.location.reload();
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message || "Erreur lors de l'enregistrement.");
      mettreAJourPied();
    }
  }

  window.Personnalisation = { ouvrir };
})();
