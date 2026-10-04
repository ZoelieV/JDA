// Personnalisation (fond d'écran, namecard, bannière, skins) : fenêtre
// commune à tout le site, ouverte sur place depuis le menu du compte
// (commun/compte.js) et depuis Mon compte (my_account/my_account.js).
// Styles : commun/personnalisation.css, chargé à la 1re ouverture. Fonds et
// bannières listés dans DB/images/cosmetiques.json ; Voyageur, Manekin et
// skins dans commun/variantes.js (chargé si la page ne l'a pas déjà).
//
// Enregistrer relit le profil (changements faits ailleurs entre-temps) et
// n'y change que ces choix (profil.parametres), puis envoie l'événement
// "personnalisation-enregistree" (detail : les paramètres enregistrés).
// Voyageur, Manekin ou skins changés : page rechargée pour afficher les
// nouvelles images, sauf ouvrir({ recharger: false }) (Mon compte, qui les
// met à jour elle-même).
(function () {
  const RACINE_IMAGES = "/DB/images/";
  // Choix attribués par défaut à tout le monde (mêmes que Mon compte).
  const PARAMETRES_DEFAUT = {
    banniere: "namecards/Namecard_Background_Default.webp",
    banniere2: "namecards/banners/Namecard_Banner_Default.webp",
    fond: "bg/autres/default_bg.webp",
    voyageur: "aether",
    manekin: "manekin"
  };
  // Choix qui changent les images des personnages (rechargement).
  const CLES_PERSOS = ["voyageur", "manekin", "skins"];

  let modal = null;
  let cosmetiques = null;
  let nomsPersos = null;  // id -> nom (DB/characters.json)
  let enregistres = null; // choix enregistrés (à l'ouverture)
  let brouillon = null;   // choix en cours, appliqués seulement à l'enregistrement
  let ongletActif = "fond";
  let options = {};

  const urlImage = chemin => encodeURI(RACINE_IMAGES + chemin);
  const getFond = id => cosmetiques?.fonds.find(fond => fond.id === id) || null;
  const valeurComparable = valeur => JSON.stringify(Array.isArray(valeur) ? [...valeur].sort() : valeur ?? null);
  const differe = (a, b, cle) => valeurComparable(a[cle]) !== valeurComparable(b[cle]);
  const cles = () => [...Object.keys(PARAMETRES_DEFAUT), "skins"];

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
    lien.href = "/commun/personnalisation.css?v=2";
    document.head.appendChild(lien);
  }

  // Voyageur, Manekin et skins (commun/variantes.js).
  let promesseVariantes = null;
  function chargerVariantes() {
    if (typeof SKINS_PERSONNAGES !== "undefined") return Promise.resolve();
    promesseVariantes ??= new Promise((resoudre, rejeter) => {
      const script = document.createElement("script");
      script.src = "/commun/variantes.js?v=4";
      script.onload = resoudre;
      script.onerror = () => rejeter(new Error("Impossible de charger les variantes."));
      document.head.appendChild(script);
    });
    return promesseVariantes;
  }

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

  async function lireProfil() {
    const reponse = await fetch("/api/auth/profile", { credentials: "include" });
    if (!reponse.ok) throw new Error("Impossible de charger le profil.");
    return (await reponse.json()).profil || {};
  }

  // Choix manquant (ou ancien "aucun") : valeur par défaut.
  function avecDefauts(parametres = {}) {
    return {
      ...Object.fromEntries(Object.entries(PARAMETRES_DEFAUT).map(([cle, defaut]) => [cle, parametres[cle] || defaut])),
      skins: Array.isArray(parametres.skins) ? parametres.skins.filter(id => SKINS_PERSONNAGES.includes(id)) : []
    };
  }

  // Aperçu du fond pendant le choix (calque body::before, cf. entete.css) ;
  // null : retour au fond enregistré (commun/fond.js).
  function apercuFond(id) {
    const fond = id && getFond(id);
    if (fond) document.body.style.setProperty("--fond-ecran", `url("${urlImage(fond.image)}")`);
    else document.body.style.removeProperty("--fond-ecran");
  }

  function creerModal() {
    modal = document.createElement("div");
    modal.className = "modal-personnalisation";
    modal.innerHTML = `
      <div class="perso-contenu" role="dialog" aria-modal="true" aria-label="Personnalisation">
        <div class="perso-entete">
          <h2>Personnalisation</h2>
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
        </div>
        <input type="text" class="perso-recherche" placeholder="Rechercher…" autocomplete="off">
        <div class="perso-choix"></div>
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
    modal.querySelector(".perso-enregistrer").addEventListener("click", enregistrer);
  }

  function afficherEtat(texte) {
    modal.querySelector(".perso-etat").textContent = texte;
  }

  // Enregistrer / Annuler : grisés tant que rien n'a changé.
  function mettreAJourPied() {
    const modifie = !!brouillon && cles().some(cle => differe(brouillon, enregistres, cle));
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
  }

  function rendreApercus() {
    const voyageur = VARIANTES_PERSONNAGES.traveler.options[brouillon.voyageur] || VARIANTES_PERSONNAGES.traveler.options.aether;
    const urls = {
      fond: getFond(brouillon.fond) && urlImage(getFond(brouillon.fond).miniature),
      banniere: brouillon.banniere && urlImage(brouillon.banniere),
      banniere2: brouillon.banniere2 && urlImage(brouillon.banniere2),
      skins: urlImage(voyageur.image.replace(/^images\//, ""))
    };
    modal.querySelectorAll("[data-apercu]").forEach(bloc => {
      const url = urls[bloc.dataset.apercu];
      bloc.style.backgroundImage = url ? `url("${url}")` : "";
      bloc.textContent = bloc.dataset.apercu === "skins"
        ? `${brouillon.skins.length} skin${brouillon.skins.length > 1 ? "s" : ""}`
        : url ? "" : "Aucun";
    });
  }

  // Une image cliquable ; choisir() applique le choix au brouillon.
  function creerChoix(image, titre, actif, choisir, classe = "") {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = `perso-choix-image ${classe}`.trim();
    bouton.title = titre;
    bouton.classList.toggle("active", actif);
    const img = document.createElement("img");
    img.src = image;
    img.alt = titre;
    img.loading = "lazy";
    bouton.appendChild(img);
    bouton.addEventListener("click", () => {
      if (!brouillon) return;
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
        () => { brouillon[cle] = valeur; })));
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
        () => { brouillon.skins = actif ? brouillon.skins.filter(s => s !== id) : [...brouillon.skins, id]; }));
    });
    conteneur.append(titreSection("Skins (clic pour activer / retirer)"), grille);
  }

  function rendreChoix() {
    const conteneur = modal.querySelector(".perso-choix");
    conteneur.innerHTML = "";
    if (!cosmetiques) {
      conteneur.textContent = "Impossible de charger la liste des images.";
      return;
    }
    const recherche = modal.querySelector(".perso-recherche").value.trim().toLowerCase();

    if (ongletActif === "skins") {
      rendreSkins(conteneur, recherche);
      return;
    }

    const choisir = valeur => () => {
      brouillon[ongletActif] = valeur;
      if (ongletActif === "fond") apercuFond(valeur);
    };

    if (ongletActif === "fond") {
      // Fonds groupés par sous-dossier de DB/images/bg.
      [...new Set(cosmetiques.fonds.map(fond => fond.categorie))].forEach(categorie => {
        const fonds = cosmetiques.fonds.filter(fond =>
          fond.categorie === categorie && (!recherche || fond.id.toLowerCase().includes(recherche)));
        if (!fonds.length) return;
        const grille = nouvelleGrille();
        fonds.forEach(fond => grille.appendChild(creerChoix(
          urlImage(fond.miniature), fond.id.split("/").pop(), brouillon.fond === fond.id, choisir(fond.id))));
        conteneur.append(titreSection((categorie || "Divers").replace(/_/g, " ")), grille);
      });
      return;
    }

    // Bannière par défaut en premier.
    const liste = ongletActif === "banniere" ? cosmetiques.bannieres : cosmetiques.bannieres2;
    const grille = nouvelleGrille();
    [...liste]
      .sort((a, b) => (b === PARAMETRES_DEFAUT[ongletActif]) - (a === PARAMETRES_DEFAUT[ongletActif]))
      .filter(chemin => !recherche || nomNamecard(chemin).toLowerCase().includes(recherche))
      .forEach(chemin => grille.appendChild(creerChoix(
        urlImage(chemin), nomNamecard(chemin), brouillon[ongletActif] === chemin, choisir(chemin))));
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
    modal.querySelector(".perso-choix").innerHTML = "";
    modal.querySelectorAll("[data-apercu]").forEach(bloc => { bloc.style.backgroundImage = ""; bloc.textContent = ""; });
    modal.classList.add("active");
    modal.classList.add("chargement");
    afficherEtat("Chargement…");
    mettreAJourPied();
    try {
      const [profil] = await Promise.all([lireProfil(), chargerCosmetiques(), chargerVariantes(), chargerNomsPersos()]);
      enregistres = avecDefauts(profil.parametres);
      brouillon = { ...enregistres, skins: [...enregistres.skins] };
      afficherEtat("");
    } catch (erreur) {
      console.error(erreur);
      afficherEtat("Erreur de chargement.");
      return;
    } finally {
      modal.classList.remove("chargement");
    }
    rendreApercus();
    choisirOnglet(options.onglet || "fond");
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
      const profil = await lireProfil();
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
      enregistres = { ...brouillon, skins: [...brouillon.skins] };
      // Fond et deuxième bannière gardés pour tout le site (commun/fond.js).
      const fond = getFond(brouillon.fond);
      const urlFond = fond ? urlImage(fond.image) : null;
      document.documentElement.style.setProperty("--fond-ecran", urlFond ? `url("${urlFond}")` : "none");
      window.FondEcran?.memoriser(urlFond, urlImage(brouillon.banniere2));
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
