// Personnalisation (fond d'écran, namecard, bannière) ouverte sur place
// depuis le menu du compte des pages autres que Mon compte (commun/compte.js).
// Même fenêtre que sur Mon compte (cf. initialiserParametres,
// my_account/my_account.js) ; styles : commun/personnalisation.css, chargé à
// la 1re ouverture. Choix listés dans DB/images/cosmetiques.json.
//
// Enregistrer relit le profil (changements faits ailleurs entre-temps) et
// n'y change que ces trois choix.
(function () {
  const RACINE_IMAGES = "/DB/images/";
  // Choix attribués par défaut à tout le monde (mêmes que Mon compte).
  const PARAMETRES_DEFAUT = {
    banniere: "namecards/Namecard_Background_Default.webp",
    banniere2: "namecards/banners/Namecard_Banner_Default.webp",
    fond: "bg/autres/default_bg.webp"
  };
  const CLES = Object.keys(PARAMETRES_DEFAUT);

  let modal = null;
  let cosmetiques = null;
  let enregistres = null; // choix enregistrés (à l'ouverture)
  let brouillon = null;   // choix en cours, appliqués seulement à l'enregistrement
  let ongletActif = "fond";

  const urlImage = chemin => encodeURI(RACINE_IMAGES + chemin);
  const getFond = id => cosmetiques?.fonds.find(fond => fond.id === id) || null;

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
    lien.href = "/commun/personnalisation.css?v=1";
    document.head.appendChild(lien);
  }

  async function chargerCosmetiques() {
    if (cosmetiques) return cosmetiques;
    const reponse = await fetch(`${RACINE_IMAGES}cosmetiques.json`);
    if (!reponse.ok) throw new Error("Impossible de charger DB/images/cosmetiques.json");
    cosmetiques = await reponse.json();
    return cosmetiques;
  }

  async function lireProfil() {
    const reponse = await fetch("/api/auth/profile", { credentials: "include" });
    if (!reponse.ok) throw new Error("Impossible de charger le profil.");
    return (await reponse.json()).profil || {};
  }

  // Choix manquant (ou ancien "aucun") : valeur par défaut.
  function avecDefauts(parametres = {}) {
    return Object.fromEntries(CLES.map(cle => [cle, parametres[cle] || PARAMETRES_DEFAUT[cle]]));
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
    const modifie = !!brouillon && CLES.some(cle => brouillon[cle] !== enregistres[cle]);
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
    const urls = {
      fond: getFond(brouillon.fond) && urlImage(getFond(brouillon.fond).miniature),
      banniere: brouillon.banniere && urlImage(brouillon.banniere),
      banniere2: brouillon.banniere2 && urlImage(brouillon.banniere2)
    };
    modal.querySelectorAll("[data-apercu]").forEach(bloc => {
      const url = urls[bloc.dataset.apercu];
      bloc.style.backgroundImage = url ? `url("${url}")` : "";
      bloc.textContent = url ? "" : "Aucun";
    });
  }

  function creerChoix(valeur, image, titre) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "perso-choix-image";
    bouton.title = titre;
    bouton.classList.toggle("active", brouillon[ongletActif] === valeur);
    const img = document.createElement("img");
    img.src = image;
    img.alt = titre;
    img.loading = "lazy";
    bouton.appendChild(img);
    bouton.addEventListener("click", () => {
      if (!brouillon) return;
      brouillon[ongletActif] = valeur;
      if (ongletActif === "fond") apercuFond(valeur);
      rendreApercus();
      rendreChoix();
      mettreAJourPied();
    });
    return bouton;
  }

  function nouvelleGrille() {
    const grille = document.createElement("div");
    grille.className = `perso-grille perso-grille-${ongletActif}`;
    return grille;
  }

  function rendreChoix() {
    const conteneur = modal.querySelector(".perso-choix");
    conteneur.innerHTML = "";
    if (!cosmetiques) {
      conteneur.textContent = "Impossible de charger la liste des images.";
      return;
    }
    const recherche = modal.querySelector(".perso-recherche").value.trim().toLowerCase();

    if (ongletActif === "fond") {
      // Fonds groupés par sous-dossier de DB/images/bg.
      [...new Set(cosmetiques.fonds.map(fond => fond.categorie))].forEach(categorie => {
        const fonds = cosmetiques.fonds.filter(fond =>
          fond.categorie === categorie && (!recherche || fond.id.toLowerCase().includes(recherche)));
        if (!fonds.length) return;
        const titre = document.createElement("h3");
        titre.className = "perso-categorie";
        titre.textContent = (categorie || "Divers").replace(/_/g, " ");
        const grille = nouvelleGrille();
        fonds.forEach(fond => grille.appendChild(creerChoix(fond.id, urlImage(fond.miniature), fond.id.split("/").pop())));
        conteneur.append(titre, grille);
      });
      return;
    }

    // Bannière par défaut en premier.
    const liste = ongletActif === "banniere" ? cosmetiques.bannieres : cosmetiques.bannieres2;
    const grille = nouvelleGrille();
    [...liste]
      .sort((a, b) => (b === PARAMETRES_DEFAUT[ongletActif]) - (a === PARAMETRES_DEFAUT[ongletActif]))
      .filter(chemin => !recherche || nomNamecard(chemin).toLowerCase().includes(recherche))
      .forEach(chemin => grille.appendChild(creerChoix(chemin, urlImage(chemin), nomNamecard(chemin))));
    conteneur.appendChild(grille);
  }

  async function ouvrir() {
    chargerStyles();
    if (!modal) creerModal();
    // Choix de l'ouverture précédente retirés pendant le chargement.
    brouillon = null;
    modal.querySelector(".perso-choix").innerHTML = "";
    modal.querySelectorAll("[data-apercu]").forEach(bloc => { bloc.style.backgroundImage = ""; });
    modal.classList.add("active");
    modal.classList.add("chargement");
    afficherEtat("Chargement…");
    mettreAJourPied();
    try {
      const [profil] = await Promise.all([lireProfil(), chargerCosmetiques()]);
      enregistres = avecDefauts(profil.parametres);
      brouillon = { ...enregistres };
      afficherEtat("");
    } catch (erreur) {
      console.error(erreur);
      afficherEtat("Erreur de chargement.");
      return;
    } finally {
      modal.classList.remove("chargement");
    }
    rendreApercus();
    choisirOnglet("fond");
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
      enregistres = { ...brouillon };
      // Fond et deuxième bannière gardés pour tout le site (commun/fond.js).
      const fond = getFond(brouillon.fond);
      const urlFond = fond ? urlImage(fond.image) : null;
      document.documentElement.style.setProperty("--fond-ecran", urlFond ? `url("${urlFond}")` : "none");
      window.FondEcran?.memoriser(urlFond, urlImage(brouillon.banniere2));
      fermer();
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message || "Erreur lors de l'enregistrement.");
      mettreAJourPied();
    }
  }

  window.Personnalisation = { ouvrir };
})();
