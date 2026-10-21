// Personnalisation (fond d'écran, namecard, bannière, skins, filtres et tris
// affichés en draft) : fenêtre
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
// marqués d'un cadenas et s'achètent d'un clic (prix, solde affiché en
// haut) ; exclusifs : pas en vente. Filtres et tris de la draft : libres.
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
    manekin: "manekin"
  };
  // Choix qui changent les images des personnages (rechargement).
  const CLES_PERSOS = ["voyageur", "manekin", "skins"];
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
  const differe = (a, b, cle) => valeurComparable(a[cle]) !== valeurComparable(b[cle]);
  const cles = () => [...Object.keys(PARAMETRES_DEFAUT), "skins", "filtres_draft"];

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
    lien.href = "/commun/personnalisation.css?v=9";
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
  const chargerKoyns = () => chargerScript("/commun/koyns.js?v=8",
    () => typeof idCosmetique !== "undefined", "Impossible de charger les Rikoyns.");
  // Filtres et tris de la draft (commun/filtres_draft.js).
  const chargerFiltresDraft = () => chargerScript("/commun/filtres_draft.js?v=2",
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
    if (modal) modal.querySelector(".perso-solde").innerHTML = `${koyns.solde} ${ICONE_KOYN}`;
  }

  // Choix pas possédés (cosmétiques payants) : sans Rikoyns chargés, tout est
  // considéré comme possédé (le serveur vérifie de toute façon).
  const possede = id => !koyns || koyns.tout || COSMETIQUES_GRATUITS.has(id) || koyns.possedes.has(id);
  const estExclusif = id => !!koyns?.exclusifs.has(id);

  // Choix enregistrés réduits aux cosmétiques possédés (comme le serveur).
  function sansNonPossedes(parametres = {}) {
    const propres = { ...parametres };
    cosmetiquesParametres(parametres).filter(id => !possede(id)).forEach(id => {
      const [choix, ...reste] = id.split(":");
      if (choix === "skin") propres.skins = (propres.skins || []).filter(skin => skin !== reste.join(":"));
      else delete propres[choix];
    });
    return propres;
  }

  // Import de Mon image : PRIX_IMPORT_FOND à chaque image (confirmation
  // d'abord ; administrateurs : gratuit). -> true si payé.
  async function payerImport() {
    if (koyns?.tout) return true;
    if (!confirm(`Importer cette image pour ${PRIX_IMPORT_FOND} Rikoyns ? (solde : ${koyns?.solde ?? "?"})`)) return false;
    afficherEtat("Achat…");
    try {
      const reponse = await fetch("/api/auth/profile?action=acheter", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cosmetique: idCosmetique("fond", FOND_PERSO) })
      });
      const donnees = await reponse.json().catch(() => ({}));
      if (!reponse.ok) throw new Error(donnees.error || "Achat impossible.");
      lireEtatKoyns(donnees.koyns);
      afficherEtat("");
      return true;
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message);
      return false;
    }
  }

  // Achat d'un cosmétique (confirmation d'abord). -> true si possédé ensuite.
  async function acheter(id, nom) {
    if (possede(id)) return true;
    if (estExclusif(id)) {
      afficherEtat("Cosmétique exclusif : il se gagne aux classements et aux événements.");
      return false;
    }
    const montant = prixCosmetique(id);
    const prix = `${montant} Rikoyn${montant > 1 ? "s" : ""}`;
    if (koyns.solde < montant) {
      afficherEtat(`Il faut ${prix} : joue des matchs pour en gagner (5 par match).`);
      return false;
    }
    if (!confirm(`Obtenir « ${nom} » pour ${prix} ? (solde : ${koyns.solde})`)) return false;
    afficherEtat("Achat…");
    try {
      const reponse = await fetch("/api/auth/profile?action=acheter", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cosmetique: id })
      });
      const donnees = await reponse.json().catch(() => ({}));
      if (!reponse.ok) throw new Error(donnees.error || "Achat impossible.");
      lireEtatKoyns(donnees.koyns);
      afficherEtat(`« ${nom} » obtenu !`);
      return true;
    } catch (erreur) {
      console.error(erreur);
      afficherEtat(erreur.message);
      return false;
    }
  }

  // Choix manquant (ou ancien "aucun") : valeur par défaut.
  function avecDefauts(parametres = {}) {
    return {
      ...Object.fromEntries(Object.entries(PARAMETRES_DEFAUT).map(([cle, defaut]) => [cle, parametres[cle] || defaut])),
      skins: Array.isArray(parametres.skins) ? parametres.skins.filter(id => SKINS_PERSONNAGES.includes(id)) : [],
      filtres_draft: lireFiltresDraft(parametres.filtres_draft)
    };
  }

  // Copie indépendante des choix (listes copiées).
  function copieChoix(choix) {
    return {
      ...choix,
      skins: [...choix.skins],
      filtres_draft: { masques: [...choix.filtres_draft.masques], figes: [...choix.filtres_draft.figes] }
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
          <button type="button" class="perso-apercu-bloc" data-onglet="filtres">
            <span class="perso-apercu-titre">Filtres et tris en Draft</span>
            <span class="perso-apercu-image perso-apercu-filtres" data-apercu="filtres"></span>
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
      filtres: urlImage("others/remove_filters.webp")
    };
    const affiches = FILTRES_DRAFT.length - brouillon.filtres_draft.masques.length;
    const textes = {
      skins: `${brouillon.skins.length} skin${brouillon.skins.length > 1 ? "s" : ""}`,
      filtres: `${affiches} / ${FILTRES_DRAFT.length}`
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
  // et prix, acheté au clic avant d'être choisi.
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
      const badge = document.createElement("span");
      badge.className = "perso-prix";
      const exclusif = estExclusif(cosmetique);
      const montant = prixCosmetique(cosmetique);
      badge.innerHTML = exclusif ? "🔒 Exclusif" : `🔒 ${montant} ${ICONE_KOYN}`;
      bouton.appendChild(badge);
      bouton.title = `${titre} — ${exclusif ? "exclusif" : `${montant} Rikoyn${montant > 1 ? "s" : ""}`}`;
    }
    bouton.addEventListener("click", async () => {
      if (!brouillon) return;
      if (verrouille && !await acheter(cosmetique, titre)) return;
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
    if (ongletActif === "filtres") {
      rendreFiltresDraft(conteneur, recherche);
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
          fond.categorie === categorie && (!recherche || fond.id.toLowerCase().includes(recherche)));
        if (!fonds.length) return;
        const grille = nouvelleGrille();
        fonds.forEach(fond => grille.appendChild(creerChoix(
          urlImage(fond.miniature), fond.id.split("/").pop(), brouillon.fond === fond.id, choisir(fond.id), "", idCosmetique("fond", fond.id))));
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
