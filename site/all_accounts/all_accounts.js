// Logos des filtres : mêmes listes (et même ordre) que les tris
// (commun/tri.js), sans "all" (Voyageur / Manekin).
const iconesElements = Object.fromEntries(
  Object.entries(ICONES_ELEMENTS_TRI).filter(([element]) => element !== "all")
);

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
    icones: ICONES_TYPES_ARMES_TRI
  }
};

// État courant de la popup
let vueActive = "characters";   // "characters" | "weapons"
let boxActive = "full";         // "full" | "stuff" | "vitrine"

// Filtres / recherche / tris, comme en draft (sans filtre J1/J2). Le filtre
// élément/type est propre à chaque vue (ordre des clics = ordre des
// groupes) ; le reste est commun. Tris combinables : cf. commun/tri.js.
let filtreType = { characters: new Set(), weapons: new Set() };
const filtreEtoile = new Set();
const filtreVoeux = new Set(); // personnages uniquement
const filtreArmePersos = new Set(); // personnages : type d'arme (ordre des clics)
let rechercheTexte = "";
const etatTri = creerEtatTri();

// Données brutes du profil ouvert, conservées pour re-render sans refetch
let profilCourant = null;
let moiDiscordId = null; // compte connecté : favoris visibles sur son propre profil
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

// Raffinement (0 = R1 ... 4 = R5) de l'arme signature d'un perso sur le
// profil ouvert (meilleure copie), ou -1 s'il ne la possède pas.
function getRefinementArmeSignature(personnage) {
  const arme = trouverArmeSignature(armesData, personnage);
  return arme ? meilleurRaffinement(profilCourant.data?.weapons?.full, arme.id) : -1;
}

// Niveau 95 / 100 renseigné sur la page Mon compte, ou null.
function getNiveauPersonnage(personnageId) {
  const niveau = profilCourant.data?.characters?.niveaux?.[personnageId];
  return niveau === 95 || niveau === 100 ? String(niveau) : null;
}

// Points d'un item possédé du profil ouvert ; personnages : bonus du niveau
// (95 / 100) et du théâtre compris (cf. pointsPersonnage, commun/cartes.js).
function getPointsItem(item, valeur, vue) {
  if (vue === "characters") return pointsPersonnage(item, valeur, getNiveauPersonnage(cleNiveau(item)));
  return Number(item[configCollections[vue].pointsField]?.[valeur] ?? 0);
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
  points: -1, nb_persos: -1, nb_c6: -1, constellations_5: -1, theatre: -1, matchs: -1, ratio: -1
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
    case "constellations_5": return `${compte.constellations_5 ?? 0} constellation${(compte.constellations_5 ?? 0) > 1 ? "s" : ""} 5★`;
    case "theatre": return compte.theatre ? `Théâtre ${compte.theatre}` : "Théâtre -";
    case "matchs": return `${compte.matchs ?? 0} match${(compte.matchs ?? 0) > 1 ? "s" : ""}`;
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

  // Cartes recyclées d'une frappe à l'autre dans la recherche (cf.
  // obtenirCarte) ; la liste est remplacée en une fois.
  liste.replaceChildren(...comptes.map(compte => obtenirCarte(
    liste,
    JSON.stringify([compte.discord_id, estTriStat && texteStat(compte)]),
    () => creerCarteCompte(compte, estTriStat)
  )));
  terminerRendu(liste);
}

function creerCarteCompte(compte, estTriStat) {
  const card = document.createElement("div");
  card.className = "account-card banniere-joueur cote-gauche";
  card.dataset.id = compte.discord_id;

  const nom = getNomCompte(compte);
  const username = compte.discord_username ? `@${compte.discord_username}` : "";

  // Deuxième bannière choisie dans Mon compte (sinon celle par défaut).
  const banniere2 = compte.banniere2 || BANNIERE2_DEFAUT;
  card.style.setProperty("--banniere2", `url("${encodeURI(`../DB/images/${banniere2}`)}")`);

  card.innerHTML = `
    <img class="photo-joueur" src="${compte.discord_avatar_url || ""}" alt="">
    <div class="account-infos">
      <div class="account-name"><span class="account-pseudo"></span>${htmlMedailleTheatre(compte.theatre)}</div>
      <div class="account-sub"></div>
    </div>
    ${estTriStat ? `<span class="account-stat"></span>` : ""}
  `;
  card.querySelector(".account-pseudo").textContent = nom;
  card.querySelector(".account-sub").textContent = username;
  if (estTriStat) card.querySelector(".account-stat").textContent = texteStat(compte);

  card.addEventListener("click", () => ouvrirProfil(compte.discord_id, nom));
  return card;
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
  // Box autre que la Full Box : items sélectionnés (arme : une de ses
  // copies "idArme#2"... suffit).
  const selection = Object.keys(collectionProfil.selections?.[boxActive] || {});
  const selectionne = item => selection.some(id => id === item.id || id.startsWith(`${item.id}#`));

  return items
    .filter(item => {
      const valeur = collectionProfil.full?.[item.id] ?? -1;

      if (valeur < 0) return false;
      if (boxActive !== "full" && !selectionne(item)) return false;
      if (filtresType.size > 0 && !filtresType.has(item[config.champType])) return false;
      if (filtreEtoile.size > 0 && !filtreEtoile.has(String(item.rarete))) return false;
      if (vueActive === "characters" && filtreVoeux.size > 0 && !filtreVoeux.has(getVoeu(item))) return false;
      if (vueActive === "characters" && filtreArmePersos.size > 0 && !filtreArmePersos.has(item.arme)) return false;
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

function creerCarteProfil({ item, valeur }) {
  const card = document.createElement("div");
  card.className = "character-card";
  card.title = item.nom;

  let basGaucheHtml = "";
  let basDroiteHtml = "";

  if (vueActive === "characters") {
    // Voyageur (un par élément) : niveau centré en bas, élément en bas à
    // gauche.
    const avecElement = item.groupe && ICONES_ELEMENTS_TRI[item.element];
    const niveau = getNiveauPersonnage(cleNiveau(item));
    if (niveau) {
      basGaucheHtml = `<span class="character-niveau${avecElement ? " niveau-centre" : ""}">${niveau}</span>`;
    }
    if (avecElement) {
      basGaucheHtml += `<img class="character-element" src="${ICONES_ELEMENTS_TRI[item.element]}" alt="${item.element}" title="${NOMS_ELEMENTS[item.element] || item.element}">`;
    }

    basDroiteHtml = htmlArmeSignature(item.arme, getRefinementArmeSignature(item));
  } else {
    const personnageLie = trouverPersonnageSignature(armesData, personnagesData, item.id);
    if (personnageLie) {
      basDroiteHtml = `<img class="perso-lie-icone" src="../DB/${getIconeLaterale(personnageLie)}" alt="${personnageLie.nom}" title="${personnageLie.nom}">`;
    }
  }

  card.innerHTML = `
    <div class="character-visuel ${classeFondRarete(item.rarete)}">
      <img src="../DB/${item.image}" alt="${item.nom}" loading="lazy" decoding="async">
      <span class="character-constellation">${getLabelConstellation(valeur, vueActive)}</span>
      <span class="character-points">${valeur >= 0 ? getPointsItem(item, valeur, vueActive) : ""}</span>
      ${basGaucheHtml}
      ${basDroiteHtml}
    </div>
  `;

  return card;
}

function rendreProfilBox() {
  const container = document.getElementById("profile-box");

  const entrees = construireListeAffichee();
  const parItem = new Map(entrees.map(entree => [entree.item, entree]));

  const groupes = trierEtGrouper(entrees.map(entree => entree.item), etatTri, {
    vue: vueActive,
    valeurs: {
      points: item => parItem.get(item).valeur >= 0 ? getPointsItem(item, parItem.get(item).valeur, vueActive) : 0,
      constellation: item => parItem.get(item).valeur,
      // 100 > 95 > non renseigné (persos uniquement).
      niveau: item => vueActive === "characters" ? Number(getNiveauPersonnage(cleNiveau(item))) || 0 : 0,
      favoris: item => profilCourant.data?.[vueActive]?.favoris?.[item.id] ? 1 : 0
    },
    elements: vueActive === "characters" ? filtreType.characters : [],
    armes: vueActive === "weapons" ? filtreType.weapons : filtreArmePersos,
    rareteParDefaut: filtreEtoile.size > 0 || (vueActive === "characters" && filtreVoeux.size > 0)
  });

  // Cartes recyclées (cf. obtenirCarte) : le cache est vidé à l'ouverture
  // d'un autre profil.
  remplirGrilleGroupee(container, groupes, item => obtenirCarte(
    container,
    JSON.stringify([vueActive, item.id, item.nom, item.image, parItem.get(item).valeur]),
    () => creerCarteProfil(parItem.get(item))
  ));
}

// ---- Grille : écarts homogènes, même écart sur les bords (comme la
// draft), cf. ajusterGrille (commun/cartes.js).

function initialiserGrille() {
  observerGrilles([document.getElementById("profile-box")], { tailleDefaut: 110 });
}

// ---- Barre recherche / tri / filtres ----

// Points d'une box du profil ouvert : personnages + armes (copies
// comprises), comme le total de Mon compte ; Voyageur : seul l'élément qui
// vaut le plus de points compte.
function calculerPointsBox(box) {
  let total = 0;
  const meilleurParGroupe = {};

  [["characters", personnagesData], ["weapons", armesData]].forEach(([vue, items]) => {
    const collection = profilCourant.data?.[vue] || {};
    const parId = new Map(items.map(item => [item.id, item]));

    Object.entries(collection.full || {}).forEach(([instanceId, valeur]) => {
      if (valeur < 0) return;
      if (box !== "full" && !collection.selections?.[box]?.[instanceId]) return;
      const item = parId.get(instanceId.split("#")[0]);
      if (!item) return;
      const points = getPointsItem(item, valeur, vue);
      if (item.groupe) meilleurParGroupe[item.groupe] = Math.max(meilleurParGroupe[item.groupe] ?? 0, points);
      else total += points;
    });
  });

  return total + Object.values(meilleurParGroupe).reduce((somme, points) => somme + points, 0);
}

function afficherPointsBox() {
  document.querySelectorAll(".box-btn").forEach(btn => {
    btn.querySelector(".points-box").textContent = ` · ${calculerPointsBox(btn.dataset.box)} pts`;
  });
}

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

// Personnages : filtre par type d'arme (combinable, ordre des clics = ordre
// des groupes, comme les éléments).
function genererFiltresArmesPersos() {
  const container = document.getElementById("filtres-armes-persos");
  container.hidden = vueActive !== "characters";
  container.innerHTML = "";
  if (vueActive !== "characters") return;

  Object.entries(ICONES_TYPES_ARMES_TRI).forEach(([valeur, src]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.title = valeur;
    btn.classList.toggle("active", filtreArmePersos.has(valeur));
    btn.innerHTML = `<img src="${src}" alt="${valeur}">`;
    btn.addEventListener("click", () => {
      basculerSelection(filtreArmePersos, valeur);
      btn.classList.toggle("active", filtreArmePersos.has(valeur));
      rendreProfilBox();
    });
    container.appendChild(btn);
  });
}

// Libellés de tri propres à la vue (constellation/raffinement,
// élément/type) et état actif de tous les boutons.
function mettreAJourBarreOutils() {
  // Pas de niveau pour les armes : tri masqué dans cette vue.
  // Pas de niveau ni de tri par type d'arme (déjà le tri "Type") pour les
  // armes : tris masqués dans cette vue.
  // Favoris : seulement sur son propre profil (persos et armes).
  const trisPersos = ["niveau", "arme"];
  const favorisVisibles = !!moiDiscordId && profilCourant?.discord_id === moiDiscordId;
  const masques = [...(vueActive === "weapons" ? trisPersos : []), ...(favorisVisibles ? [] : ["favoris"])];
  etatTri.tris = etatTri.tris.filter(t => !masques.includes(t.cle));

  document.querySelectorAll(".tri-btn").forEach(btn => {
    btn.hidden = masques.includes(btn.dataset.tri);
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
  genererFiltresArmesPersos();
}

function reinitialiserFiltres() {
  filtreType = { characters: new Set(), weapons: new Set() };
  filtreEtoile.clear();
  filtreVoeux.clear();
  filtreArmePersos.clear();
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
    // Ancien Voyageur unique -> Voyageur Anemo (cf. commun/variantes.js).
    migrerCollectionPersos(profil.data?.characters);
    personnagesBase = personnages;
    armesData = armes;
    // Voyageur / Manekin : variante choisie par ce joueur.
    personnagesData = appliquerVariantes(personnagesBase, profil.data?.parametres);
    viderCacheCartes(document.getElementById("profile-box"));

    vueActive = "characters";
    boxActive = "full";
    reinitialiserFiltres();

    mettreAJourBoutonsVueEtBox();
    mettreAJourBarreOutils();
    afficherPointsBox();

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
    // Compte connecté (sans bloquer la page) : pour le tri des favoris.
    fetch("/api/auth/me", { credentials: "include" })
      .then(reponse => reponse.ok ? reponse.json() : null)
      .then(session => { moiDiscordId = session?.user?.id || null; })
      .catch(() => {});

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
