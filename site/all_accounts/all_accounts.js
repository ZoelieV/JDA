const iconesElements = {
  pyro: "../DB/images/others/pyro.webp",
  hydro: "../DB/images/others/hydro.webp",
  anemo: "../DB/images/others/anemo.webp",
  electro: "../DB/images/others/electro.webp",
  cryo: "../DB/images/others/cryo.webp",
  dendro: "../DB/images/others/dendro.webp",
  geo: "../DB/images/others/geo.webp"
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
    icones: iconesElements,
    libelleConstellation: "Constel.",
    libelleType: "Élément"
  },
  weapons: {
    pointsField: "PPW",
    labels: ["R1", "R2", "R3", "R4", "R5"],
    champType: "type",
    icones: iconesTypesArmes,
    libelleConstellation: "Raffin.",
    libelleType: "Type"
  }
};

// État courant de la popup
let vueActive = "characters";   // "characters" | "weapons"
let boxActive = "full";         // "full" | "stuff"

// Filtres / recherche / tri, comme en draft (sans filtre J1/J2). Le filtre
// élément/type est propre à chaque vue ; le reste est commun.
let filtreType = { characters: new Set(), weapons: new Set() };
const filtreEtoile = new Set();
let rechercheTexte = "";
let triActif = null; // "points" | "constellation" | "rarete" | "element" | null (ordre par défaut)

// Données brutes du profil ouvert, conservées pour re-render sans refetch
let profilCourant = null;
let personnagesData = [];
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

// Arme signature : image nommée "[id_personnage]_w.webp"
function trouverArmeSignature(personnageId) {
  return armesData.find(
    arme => typeof arme.image === "string" && arme.image.endsWith(`${personnageId}_w.webp`)
  );
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
  return personnagesData.find(perso => {
    const arme = trouverArmeSignature(perso.id);
    return arme && arme.id === armeId;
  });
}

function afficherComptes(comptes) {
  const liste = document.getElementById("accounts-list");
  liste.innerHTML = "";

  comptes.forEach(compte => {
    const card = document.createElement("div");
    card.className = "account-card";
    card.dataset.id = compte.discord_id;

    const nom = compte.discord_global_name || compte.discord_username || "Utilisateur inconnu";
    const username = compte.discord_username ? `@${compte.discord_username}` : "";

    card.innerHTML = `
      <img src="${compte.discord_avatar_url || ""}" alt="${nom}">
      <div>
        <div class="account-name">${nom}</div>
        <div class="account-sub">${username}</div>
      </div>
    `;

    card.addEventListener("click", () => ouvrirProfil(compte.discord_id, nom));
    liste.appendChild(card);
  });
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
      if (recherche && !String(item.nom || "").toLowerCase().includes(recherche)) return false;

      return true;
    })
    .map(item => ({
      item,
      valeur: collectionProfil.full[item.id],
      config
    }));
}

// ---- Tri (choix unique, comme en draft) ----
// Décroissant, sauf élément/type (ordre des icônes de filtre). Tri stable :
// l'ordre de base départage.

function valeurTri({ item, valeur, config }) {
  switch (triActif) {
    case "points":
      return Number(item[config.pointsField]?.[valeur] ?? 0);
    case "constellation":
      return valeur;
    case "rarete":
      return Number(item.rarete) || 0;
    case "element":
      return -Object.keys(config.icones).indexOf(item[config.champType]);
    default:
      return 0;
  }
}

function trierListe(liste) {
  if (!triActif) return liste;
  return liste
    .map((entree, index) => ({ entree, index, v: valeurTri(entree) }))
    .sort((a, b) => (b.v - a.v) || (a.index - b.index))
    .map(e => e.entree);
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
      basDroiteHtml = `<img class="perso-lie-icone" src="../DB/images/characters/side_char/${personnageLie.id}_side.webp" alt="${personnageLie.nom}" title="${personnageLie.nom}">`;
    }
  }

  card.innerHTML = `
    <div class="character-visuel" style="background-image: url('${fond}');">
      <img src="../DB/${item.image}" alt="${item.nom}">
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

  trierListe(construireListeAffichee()).forEach(entree => {
    container.appendChild(creerCarteProfil(entree));
  });
}

// ---- Grille : écarts homogènes (même calcul que la draft) ----
// Autant de colonnes que possible avec un écart >= ECART_MIN_GRILLE, puis
// l'espace restant est réparti également entre les cartes et sur les 2
// bords ; le même écart sert entre les lignes. Téléphone : 4 par ligne.

const ECART_MIN_GRILLE = 10;
const MEDIA_TELEPHONE = window.matchMedia("(max-width: 700px)");
const COLONNES_TELEPHONE = 4;

function ajusterGrille(grille) {
  const largeur = grille.clientWidth;
  if (!largeur) return;

  let taille = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--taille-carte")) || 110;
  let colonnes;

  if (MEDIA_TELEPHONE.matches) {
    colonnes = COLONNES_TELEPHONE;
    taille = Math.floor((largeur - (colonnes + 1) * ECART_MIN_GRILLE) / colonnes);
    grille.style.setProperty("--taille-carte", `${taille}px`);
  } else {
    grille.style.removeProperty("--taille-carte");
    colonnes = Math.max(1, Math.floor((largeur - ECART_MIN_GRILLE) / (taille + ECART_MIN_GRILLE)));
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
      if (set.has(valeur)) set.delete(valeur); else set.add(valeur);
      btn.classList.toggle("active", set.has(valeur));
      rendreProfilBox();
    });

    container.appendChild(btn);
  });
}

// Libellés de tri propres à la vue (constellation/raffinement,
// élément/type) et état actif de tous les boutons.
function mettreAJourBarreOutils() {
  const config = configCollections[vueActive];

  document.querySelectorAll(".tri-btn").forEach(btn => {
    if (btn.dataset.tri === "constellation") btn.textContent = config.libelleConstellation;
    if (btn.dataset.tri === "element") btn.textContent = config.libelleType;
    btn.classList.toggle("active", btn.dataset.tri === triActif);
  });

  document.querySelectorAll("[data-etoile]").forEach(btn => {
    btn.classList.toggle("active", filtreEtoile.has(btn.dataset.etoile));
  });

  document.getElementById("recherche").value = rechercheTexte;
  genererFiltresIcones();
}

function reinitialiserFiltres() {
  filtreType = { characters: new Set(), weapons: new Set() };
  filtreEtoile.clear();
  rechercheTexte = "";
  triActif = null;
}

function initialiserBarreOutils() {
  document.querySelectorAll(".tri-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      triActif = triActif === btn.dataset.tri ? null : btn.dataset.tri;
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
    const [profil, personnages, armes] = await Promise.all([
      chargerProfil(discordId),
      chargerPersonnages(),
      chargerArmes()
    ]);

    profilCourant = profil;
    personnagesData = personnages;
    armesData = armes;

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
    const comptes = await chargerComptes();
    afficherComptes(comptes);
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
