// Même ordre que les tris (commun/tri.js).
const iconesElements = {
  pyro: "../DB/images/others/pyro.webp",
  hydro: "../DB/images/others/hydro.webp",
  electro: "../DB/images/others/electro.webp",
  cryo: "../DB/images/others/cryo.webp",
  anemo: "../DB/images/others/anemo.webp",
  geo: "../DB/images/others/geo.webp",
  dendro: "../DB/images/others/dendro.webp"
};

const iconesTypesArmes = {
  sword: "../DB/images/others/sword.webp",
  claymore: "../DB/images/others/claymore.webp",
  polearm: "../DB/images/others/polearm.webp",
  bow: "../DB/images/others/bow.webp",
  catalyst: "../DB/images/others/catalyst.webp"
};

const iconesTypesArmesSignature = {
  sword: "../DB/images/others/sword_icon.webp",
  claymore: "../DB/images/others/claymore_icon.webp",
  polearm: "../DB/images/others/polearm_icon.webp",
  bow: "../DB/images/others/bow_icon.webp",
  catalyst: "../DB/images/others/catalyst_icon.webp"
};

// Couleur du détourage du logo d'arme signature, selon son raffinement
// (index 0 = R1 ... 4 = R5). Mêmes couleurs que dans la draft (match.js).
const COULEURS_REFINEMENT = ["#b0b0b0", "#6fcf6f", "#5b9bd5", "#a366d9", "#e0a83e"];

const configCollections = {
  characters: {
    pointsField: "PPC",
    labels: ["C0", "C1", "C2", "C3", "C4", "C5", "C6"],
    champType: "element",
    icones: iconesElements
  },
  weapons: {
    pointsField: "PPW",
    labels: ["R1", "R2", "R3", "R4", "R5"],
    champType: "type",
    icones: iconesTypesArmes
  }
};

// État courant de la popup
let vueActive = "characters";   // "characters" | "weapons"
let boxActive = "full";         // "full" | "stuff"

// Filtres / recherche / tris, comme en draft (sans filtre J1/J2). Le filtre
// élément/type est propre à chaque vue (ordre des clics = ordre des
// groupes) ; le reste est commun. Tris combinables : cf. commun/tri.js.
let filtreType = { characters: new Set(), weapons: new Set() };
const filtreEtoile = new Set();
const filtreVoeux = new Set(); // personnages uniquement
let rechercheTexte = "";
const etatTri = creerEtatTri();

// Données brutes du profil ouvert, conservées pour re-render sans refetch
let profilCourant = null;
let personnagesBase = [];   // characters.json
let personnagesData = [];   // avec les variantes choisies par le profil ouvert
let armesData = [];

async function chargerComptes() {
  const reponse = await fetch("/api/accounts");
  if (!reponse.ok) {
    throw new Error("Impossible de charger les comptes.");
  }
  return await reponse.json();
}

async function chargerPersonnages() {
  const reponse = await fetch("../DB/characters.json");
  if (!reponse.ok) {
    throw new Error("Impossible de charger les personnages.");
  }
  return await reponse.json();
}

async function chargerArmes() {
  const reponse = await fetch("../DB/weapons.json");
  if (!reponse.ok) {
    throw new Error("Impossible de charger les armes.");
  }
  return await reponse.json();
}

async function chargerProfil(discordId) {
  const reponse = await fetch(`/api/accounts/${discordId}`);
  if (!reponse.ok) {
    throw new Error("Impossible de charger le profil.");
  }
  return await reponse.json();
}

function getLabelConstellation(valeur, vue) {
  if (valeur < 0) return "";
  return configCollections[vue].labels[valeur];
}

function getFondRarete(rarete) {
  const valeur = String(rarete);

  if (valeur === "5") {
    return "../DB/images/others/bg_5_star.webp";
  }

  if (valeur === "3") {
    return "../DB/images/others/bg_3_star.webp";
  }

  return "../DB/images/others/bg_4_star.webp";
}

// Arme signature : image nommée "[id_personnage]_w.webp". Index construit
// une seule fois (perso -> arme et arme -> perso) au lieu de parcourir la
// liste des armes à chaque carte.
let indexArmesSignature = null;       // id perso -> arme
let indexPersosParArmeSignature = null; // id arme -> perso

function construireIndexSignatures() {
  indexArmesSignature = new Map();
  indexPersosParArmeSignature = new Map();
  const persosParId = new Map(personnagesData.map(perso => [perso.id, perso]));

  armesData.forEach(arme => {
    const m = typeof arme.image === "string" && arme.image.match(/([^/]+)_w\.webp$/);
    if (!m) return;
    indexArmesSignature.set(m[1], arme);
    if (persosParId.has(m[1])) indexPersosParArmeSignature.set(arme.id, persosParId.get(m[1]));
  });
}

function trouverArmeSignature(personnageId) {
  return indexArmesSignature.get(personnageId);
}

// Raffinement (0 = R1 ... 4 = R5) de l'arme signature d'un perso sur le
// profil ouvert, ou null s'il ne la possède pas. Copies dupliquées
// ("idArme#2"...) comprises : on garde la meilleure (comme en draft).
function getRefinementArmeSignature(personnageId) {
  const arme = trouverArmeSignature(personnageId);
  if (!arme) return null;

  const full = profilCourant.data?.weapons?.full || {};
  let meilleur = -1;
  Object.entries(full).forEach(([cle, valeur]) => {
    if ((cle === arme.id || cle.startsWith(`${arme.id}#`)) && valeur > meilleur) {
      meilleur = valeur;
    }
  });
  return meilleur >= 0 ? meilleur : null;
}

// Niveau 95 / 100 renseigné sur la page Mon compte, ou null.
function getNiveauPersonnage(personnageId) {
  const niveau = profilCourant.data?.characters?.niveaux?.[personnageId];
  return niveau === 95 || niveau === 100 ? String(niveau) : null;
}

// Sens inverse : à partir d'une arme, retrouve le personnage dont c'est l'arme signature
function trouverPersonnageParArmeSignature(armeId) {
  return indexPersosParArmeSignature.get(armeId);
}

// ---- Liste des comptes : recherche + tri (sens inversé par un 2e clic) ----

let tousLesComptes = [];
const TRI_COMPTES_DEFAUT = { cle: "activite", sens: -1 };
let triComptes = { ...TRI_COMPTES_DEFAUT };

// Sens par défaut au 1er clic sur un tri : plus récents d'abord pour
// l'activité, plus anciens d'abord pour l'arrivée, A -> Z pour l'alphabet,
// plus grande valeur d'abord pour les stats.
const SENS_INITIAL_TRI = {
  activite: -1, arrivee: 1, alpha: 1,
  points: -1, nb_persos: -1, nb_c6: -1, theatre: -1, victoires: -1, ratio: -1
};

// Deuxième bannière par défaut (joueur qui n'en a pas choisi).
const BANNIERE2_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";

// Pourcentage de victoires, null si aucun match joué.
function getRatio(compte) {
  return compte.matchs > 0 ? compte.victoires / compte.matchs : null;
}

// Valeur numérique d'un tri de stats ; les comptes sans valeur (théâtre non
// renseigné, aucun match) passent toujours en dernier.
function getStatTri(compte, cle) {
  return cle === "ratio" ? getRatio(compte) : compte[cle] ?? null;
}

// Texte de la pastille à droite de la carte pour le tri en cours.
function texteStat(compte) {
  switch (triComptes.cle) {
    case "points": return `${compte.points ?? 0} pts`;
    case "nb_persos": return `${compte.nb_persos ?? 0} persos`;
    case "nb_c6": return `${compte.nb_c6 ?? 0} C6 5★`;
    case "theatre": return compte.theatre ? `Théâtre ${compte.theatre}` : "Théâtre -";
    case "victoires": return `${compte.victoires ?? 0} V / ${compte.matchs ?? 0} matchs`;
    case "ratio": return getRatio(compte) === null ? "Aucun match" : `${Math.round(getRatio(compte) * 100)} %`;
    default: return "";
  }
}

function getNomCompte(compte) {
  return compte.discord_global_name || compte.discord_username || "Utilisateur inconnu";
}

function comparerComptes(a, b) {
  if (SENS_INITIAL_TRI[triComptes.cle] && !["activite", "arrivee", "alpha"].includes(triComptes.cle)) {
    const va = getStatTri(a, triComptes.cle);
    const vb = getStatTri(b, triComptes.cle);
    if (va === null || vb === null) return 0; // géré dans afficherComptes
    return va - vb;
  }

  switch (triComptes.cle) {
    case "alpha":
      return getNomCompte(a).localeCompare(getNomCompte(b), "fr", { sensitivity: "base" });
    case "arrivee":
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    default:
      return String(a.updated_at || "").localeCompare(String(b.updated_at || ""));
  }
}

function mettreAJourBoutonsTriComptes() {
  document.querySelectorAll(".tri-compte-btn").forEach(btn => {
    const actif = btn.dataset.tri === triComptes.cle;
    btn.classList.toggle("active", actif);
    btn.querySelector(".fleche").textContent = actif ? (triComptes.sens === 1 ? "▲" : "▼") : "";
  });
}

function afficherComptes() {
  const liste = document.getElementById("accounts-list");
  liste.innerHTML = "";

  const recherche = document.getElementById("recherche-comptes").value.trim().toLowerCase();
  const estTriStat = !["activite", "arrivee", "alpha"].includes(triComptes.cle);
  const comptes = tousLesComptes
    .filter(compte => !recherche ||
      getNomCompte(compte).toLowerCase().includes(recherche) ||
      String(compte.discord_username || "").toLowerCase().includes(recherche))
    .sort((a, b) => {
      // Stats sans valeur : toujours en fin de liste, quel que soit le sens.
      if (estTriStat) {
        const sansA = getStatTri(a, triComptes.cle) === null;
        const sansB = getStatTri(b, triComptes.cle) === null;
        if (sansA !== sansB) return sansA ? 1 : -1;
      }
      return comparerComptes(a, b) * triComptes.sens;
    });

  if (comptes.length === 0) {
    liste.innerHTML = `<p class="liste-vide">Aucun joueur trouvé.</p>`;
    return;
  }

  comptes.forEach(compte => {
    const card = document.createElement("div");
    card.className = "account-card";
    card.dataset.id = compte.discord_id;

    const nom = getNomCompte(compte);
    const username = compte.discord_username ? `@${compte.discord_username}` : "";

    // Deuxième bannière choisie dans Mon compte (sinon celle par défaut).
    const banniere2 = compte.banniere2 || BANNIERE2_DEFAUT;
    card.style.setProperty("--banniere2", `url("${encodeURI(`../DB/images/${banniere2}`)}")`);

    card.innerHTML = `
      <img src="${compte.discord_avatar_url || ""}" alt="">
      <div class="account-infos">
        <div class="account-name"></div>
        <div class="account-sub"></div>
      </div>
      ${estTriStat ? `<span class="account-stat"></span>` : ""}
    `;
    card.querySelector(".account-name").textContent = nom;
    card.querySelector(".account-sub").textContent = username;
    if (estTriStat) card.querySelector(".account-stat").textContent = texteStat(compte);

    card.addEventListener("click", () => ouvrirProfil(compte.discord_id, nom));
    liste.appendChild(card);
  });
}

function initialiserBarreComptes() {
  // Tri "Arrivée" masqué si la date d'arrivée n'est pas disponible.
  const avecArrivee = tousLesComptes.some(compte => compte.created_at);
  document.querySelector('.tri-compte-btn[data-tri="arrivee"]').hidden = !avecArrivee;

  document.querySelectorAll(".tri-compte-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cle = btn.dataset.tri;
      triComptes = triComptes.cle === cle
        ? { cle, sens: -triComptes.sens }
        : { cle, sens: SENS_INITIAL_TRI[cle] };
      mettreAJourBoutonsTriComptes();
      afficherComptes();
    });
  });

  document.getElementById("recherche-comptes").addEventListener("input", afficherComptes);

  document.getElementById("clear-comptes").addEventListener("click", () => {
    document.getElementById("recherche-comptes").value = "";
    triComptes = { ...TRI_COMPTES_DEFAUT };
    mettreAJourBoutonsTriComptes();
    afficherComptes();
  });

  mettreAJourBoutonsTriComptes();
}

// ---- Construction de la liste affichée selon vue + box + filtres ----

function construireListeAffichee() {
  const config = configCollections[vueActive];
  const items = vueActive === "characters" ? personnagesData : armesData;
  const collectionProfil = profilCourant.data?.[vueActive] || { full: {}, selections: {} };
  const filtresType = filtreType[vueActive];
  const recherche = rechercheTexte.trim().toLowerCase();

  return items
    .filter(item => {
      const valeur = collectionProfil.full?.[item.id] ?? -1;

      if (valeur < 0) return false;
      if (boxActive === "stuff" && !collectionProfil.selections?.stuff?.[item.id]) return false;
      if (filtresType.size > 0 && !filtresType.has(item[config.champType])) return false;
      if (filtreEtoile.size > 0 && !filtreEtoile.has(String(item.rarete))) return false;
      if (vueActive === "characters" && filtreVoeux.size > 0 && !filtreVoeux.has(getVoeu(item))) return false;
      if (recherche && !String(item.nom || "").toLowerCase().includes(recherche)) return false;

      return true;
    })
    .map(item => ({
      item,
      valeur: collectionProfil.full[item.id],
      config
    }));
}

// ---- Cartes (même disposition que la draft) ----
// Haut gauche : constellation (raffinement pour une arme) ; haut droite :
// points ; bas gauche : niveau ; bas droite : arme signature (détourée de la
// couleur du raffinement) ou, pour une arme, le perso dont c'est l'arme.

function creerCarteProfil({ item, valeur, config }) {
  const card = document.createElement("div");
  card.className = "character-card";
  card.title = item.nom;

  const fond = getFondRarete(item.rarete);
  let basGaucheHtml = "";
  let basDroiteHtml = "";

  if (vueActive === "characters") {
    const niveau = getNiveauPersonnage(item.id);
    if (niveau) {
      basGaucheHtml = `<span class="character-niveau">${niveau}</span>`;
    }

    const refinement = getRefinementArmeSignature(item.id);
    const iconeArme = iconesTypesArmesSignature[item.arme];
    if (refinement !== null && iconeArme) {
      const couleur = COULEURS_REFINEMENT[refinement] || COULEURS_REFINEMENT[0];
      basDroiteHtml = `<img class="character-raffinement" src="${iconeArme}" alt="R${refinement + 1}" title="Arme signature R${refinement + 1}" style="--couleur-ref: ${couleur}">`;
    }
  } else {
    const personnageLie = trouverPersonnageParArmeSignature(item.id);
    if (personnageLie) {
      basDroiteHtml = `<img class="perso-lie-icone" src="../DB/${getIconeLaterale(personnageLie)}" alt="${personnageLie.nom}" title="${personnageLie.nom}">`;
    }
  }

  card.innerHTML = `
    <div class="character-visuel" style="background-image: url('${fond}');">
      <img src="../DB/${item.image}" alt="${item.nom}" loading="lazy" decoding="async">
      <span class="character-constellation">${getLabelConstellation(valeur, vueActive)}</span>
      <span class="character-points">${item[config.pointsField]?.[valeur] ?? ""}</span>
      ${basGaucheHtml}
      ${basDroiteHtml}
    </div>
  `;

  return card;
}

function rendreProfilBox() {
  const container = document.getElementById("profile-box");
  container.innerHTML = "";

  const config = configCollections[vueActive];
  const entrees = construireListeAffichee();
  const parItem = new Map(entrees.map(entree => [entree.item, entree]));

  const groupes = trierEtGrouper(entrees.map(entree => entree.item), etatTri, {
    vue: vueActive,
    valeurs: {
      points: item => Number(item[config.pointsField]?.[parItem.get(item).valeur] ?? 0),
      constellation: item => parItem.get(item).valeur,
      // 100 > 95 > non renseigné (persos uniquement).
      niveau: item => vueActive === "characters" ? Number(getNiveauPersonnage(item.id)) || 0 : 0
    },
    elements: vueActive === "characters" ? filtreType.characters : [],
    armes: vueActive === "weapons" ? filtreType.weapons : [],
    rareteParDefaut: filtreEtoile.size > 0 || (vueActive === "characters" && filtreVoeux.size > 0)
  });

  remplirGrilleGroupee(container, groupes, item => creerCarteProfil(parItem.get(item)));
}

// ---- Grille : écarts homogènes (même calcul que la draft) ----
// Autant de colonnes que possible avec un écart >= ECART_MIN_GRILLE, puis
// l'espace restant est réparti également entre les cartes et sur les 2
// bords ; le même écart sert entre les lignes. Téléphone : 4 par ligne.

const ECART_MIN_GRILLE = 10;
const MEDIA_TELEPHONE = window.matchMedia("(max-width: 700px)");
const COLONNES_TELEPHONE = 4;

// --taille-carte converti en px (la variable CSS est en rem, cf. l'échelle
// du site dans commun/entete.css).
function lireTailleCarte() {
  const racine = getComputedStyle(document.documentElement);
  const valeur = racine.getPropertyValue("--taille-carte").trim();
  const nombre = parseFloat(valeur);
  return valeur.endsWith("rem") ? nombre * (parseFloat(racine.fontSize) || 16) : nombre;
}

// Écart minimal entre les cartes, à la même échelle que le reste du site.
function lireEcartMin() {
  return ECART_MIN_GRILLE * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
}

function ajusterGrille(grille) {
  const largeur = grille.clientWidth;
  if (!largeur) return;

  let taille = lireTailleCarte() || 110;
  const ecartMin = lireEcartMin();
  let colonnes;

  if (MEDIA_TELEPHONE.matches) {
    colonnes = COLONNES_TELEPHONE;
    taille = Math.floor((largeur - (colonnes + 1) * ecartMin) / colonnes);
    grille.style.setProperty("--taille-carte", `${taille}px`);
  } else {
    grille.style.removeProperty("--taille-carte");
    colonnes = Math.max(1, Math.floor((largeur - ecartMin) / (taille + ecartMin)));
  }

  const ecart = Math.max(0, (largeur - colonnes * taille) / (colonnes + 1));

  grille.style.gridTemplateColumns = `repeat(${colonnes}, ${taille}px)`;
  grille.style.gap = `${ecart}px`;
}

function initialiserGrille() {
  const grille = document.getElementById("profile-box");
  new ResizeObserver(() => ajusterGrille(grille)).observe(grille);
}

// ---- Barre recherche / tri / filtres ----

function mettreAJourBoutonsVueEtBox() {
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === vueActive);
  });

  document.querySelectorAll(".box-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.box === boxActive);
  });
}

// Icônes élément (persos) ou type d'arme (armes), selon la vue.
function genererFiltresIcones() {
  const container = document.getElementById("filtres-icones");
  container.innerHTML = "";

  Object.entries(configCollections[vueActive].icones).forEach(([valeur, src]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.classList.toggle("active", filtreType[vueActive].has(valeur));
    btn.innerHTML = `<img src="${src}" alt="${valeur}">`;

    btn.addEventListener("click", () => {
      const set = filtreType[vueActive];
      basculerSelection(set, valeur);
      btn.classList.toggle("active", set.has(valeur));
      rendreProfilBox();
    });

    container.appendChild(btn);
  });
}

// Libellés de tri propres à la vue (constellation/raffinement,
// élément/type) et état actif de tous les boutons.
function mettreAJourBarreOutils() {
  // Pas de niveau pour les armes : tri masqué dans cette vue.
  if (vueActive === "weapons" && getSensTri(etatTri, "niveau")) {
    etatTri.tris = etatTri.tris.filter(t => t.cle !== "niveau");
  }

  document.querySelectorAll(".tri-btn").forEach(btn => {
    btn.hidden = btn.dataset.tri === "niveau" && vueActive === "weapons";
    majBoutonTri(btn, etatTri, vueActive);
  });

  document.querySelectorAll("[data-etoile]").forEach(btn => {
    btn.classList.toggle("active", filtreEtoile.has(btn.dataset.etoile));
  });

  // Vœux : personnages uniquement.
  document.getElementById("filtres-voeux").hidden = vueActive === "weapons";
  document.querySelectorAll("[data-voeu]").forEach(btn => {
    btn.classList.toggle("active", filtreVoeux.has(btn.dataset.voeu));
  });

  document.getElementById("recherche").value = rechercheTexte;
  genererFiltresIcones();
}

function reinitialiserFiltres() {
  filtreType = { characters: new Set(), weapons: new Set() };
  filtreEtoile.clear();
  filtreVoeux.clear();
  rechercheTexte = "";
  viderTris(etatTri);
}

function initialiserBarreOutils() {
  document.querySelectorAll(".tri-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      cyclerTri(etatTri, btn.dataset.tri);
      mettreAJourBarreOutils();
      rendreProfilBox();
    });
  });

  document.querySelectorAll("[data-etoile]").forEach(btn => {
    btn.addEventListener("click", () => {
      const valeur = btn.dataset.etoile;
      if (filtreEtoile.has(valeur)) filtreEtoile.delete(valeur); else filtreEtoile.add(valeur);
      btn.classList.toggle("active", filtreEtoile.has(valeur));
      rendreProfilBox();
    });
  });

  document.querySelectorAll("[data-voeu]").forEach(btn => {
    btn.addEventListener("click", () => {
      basculerSelection(filtreVoeux, btn.dataset.voeu);
      btn.classList.toggle("active", filtreVoeux.has(btn.dataset.voeu));
      rendreProfilBox();
    });
  });

  document.getElementById("recherche").addEventListener("input", event => {
    rechercheTexte = event.target.value;
    rendreProfilBox();
  });

  document.getElementById("btn-clear-filtres").addEventListener("click", () => {
    reinitialiserFiltres();
    mettreAJourBarreOutils();
    rendreProfilBox();
  });
}

function initialiserSelecteursVueEtBox() {
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      vueActive = btn.dataset.view;
      mettreAJourBoutonsVueEtBox();
      mettreAJourBarreOutils();
      rendreProfilBox();
    });
  });

  document.querySelectorAll(".box-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      boxActive = btn.dataset.box;
      mettreAJourBoutonsVueEtBox();
      rendreProfilBox();
    });
  });
}

// ---- Ouverture / fermeture popup ----

async function ouvrirProfil(discordId, nom) {
  try {
    const dejaCharges = personnagesBase.length > 0 && armesData.length > 0;
    const [profil, personnages, armes] = await Promise.all([
      chargerProfil(discordId),
      dejaCharges ? personnagesBase : chargerPersonnages(),
      dejaCharges ? armesData : chargerArmes()
    ]);

    profilCourant = profil;
    personnagesBase = personnages;
    armesData = armes;
    // Voyageur / Manekin : variante choisie par ce joueur.
    personnagesData = appliquerVariantes(personnagesBase, profil.data?.parametres);
    construireIndexSignatures();

    vueActive = "characters";
    boxActive = "full";
    reinitialiserFiltres();

    mettreAJourBoutonsVueEtBox();
    mettreAJourBarreOutils();

    document.getElementById("modal-title").textContent = `Box de ${nom}`;
    rendreProfilBox();
    document.getElementById("modal").classList.add("active");
  } catch (error) {
    console.error(error);
    alert("Erreur lors du chargement du profil.");
  }
}

function initialiserModal() {
  const modal = document.getElementById("modal");
  const closeBtn = document.getElementById("close-modal");

  closeBtn.addEventListener("click", () => {
    modal.classList.remove("active");
  });

  modal.addEventListener("click", event => {
    if (event.target === modal) {
      modal.classList.remove("active");
    }
  });
}

async function demarrer() {
  try {
    tousLesComptes = await chargerComptes();
    initialiserBarreComptes();
    afficherComptes();
    initialiserModal();
    initialiserBarreOutils();
    initialiserSelecteursVueEtBox();
    initialiserGrille();
  } catch (error) {
    console.error(error);
    alert("Erreur lors du chargement des comptes.");
  }
}

demarrer();
