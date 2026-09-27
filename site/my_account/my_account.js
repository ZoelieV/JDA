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

const nomsBoxes = {
  full: "Full box",
  stuff: "Personnages stuff",
  opti1: "Box optimisée 1",
  opti2: "Box optimisée 2",
  opti3: "Box optimisée 3",
  opti4: "Box optimisée 4",
  opti5: "Box optimisée 5"
};

const configCollections = {
  characters: {
    pointsField: "PPC",
    labels: ["C0", "C1", "C2", "C3", "C4", "C5", "C6"],
    maxLevel: 6,
    nomVue: "Personnages"
  },
  weapons: {
    pointsField: "PPW",
    labels: ["R1", "R2", "R3", "R4", "R5"],
    maxLevel: 4,
    nomVue: "Armes"
  }
};

async function chargerSessionDiscord() {
  const loginGate = document.getElementById("login-gate");
  const accountContent = document.getElementById("account-content");
  const loginBtn = document.getElementById("discord-login-btn");
  const avatar = document.getElementById("discord-avatar");
  const name = document.getElementById("discord-name");
  const logoutBtn = document.getElementById("discord-logout-btn");

  loginBtn.addEventListener("click", () => {
    window.location.href = "/api/auth/discord/login";
  });

  logoutBtn.addEventListener("click", () => {
    // Plus de fond personnalisé une fois déconnecté.
    window.FondEcran?.memoriser(null, null);
    window.location.href = "/api/auth/logout";
  });

  initialiserMenuCompte();

  try {
    const response = await fetch("/api/auth/me", {
      credentials: "include"
    });

    if (!response.ok) {
      loginGate.classList.add("actif");
      accountContent.classList.remove("actif");
      return false;
    }

    const data = await response.json();

    loginGate.classList.remove("actif");
    accountContent.classList.add("actif");

    name.textContent = data.user.global_name || data.user.username;
    if (data.user.avatar) {
      avatar.src = data.user.avatar;
      avatar.hidden = false;
    } else {
      avatar.hidden = true;
    }

    return true;
  } catch (error) {
    console.error(error);
    loginGate.classList.add("actif");
    accountContent.classList.remove("actif");
    return false;
  }
}

// ---- Menu déroulant du compte (photo + nom Discord cliquables) ----

function fermerMenuCompte() {
  document.getElementById("menu-compte").classList.add("cache");
  document.getElementById("compte-btn").setAttribute("aria-expanded", "false");
}

function initialiserMenuCompte() {
  const bouton = document.getElementById("compte-btn");
  const menu = document.getElementById("menu-compte");

  // Deuxième bannière en fond du bouton, depuis le cache (mise à jour au
  // chargement du profil, cf. memoriserFondPourLeSite).
  window.FondEcran?.appliquerBanniere2(bouton, window.FondEcran.banniere2());

  bouton.addEventListener("click", () => {
    const ouvert = menu.classList.toggle("cache") === false;
    bouton.setAttribute("aria-expanded", String(ouvert));
  });

  // Clic en dehors du menu ou Échap : fermeture.
  document.addEventListener("click", event => {
    if (!event.target.closest("#auth-zone")) fermerMenuCompte();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") fermerMenuCompte();
  });
}

async function chargerPersonnages() {
  const reponse = await fetch("../DB/characters.json");
  if (!reponse.ok) {
    throw new Error("Impossible de charger DB/characters.json");
  }
  return await reponse.json();
}

async function chargerArmes() {
  const reponse = await fetch("../DB/weapons.json");
  if (!reponse.ok) {
    throw new Error("Impossible de charger DB/weapons.json");
  }
  return await reponse.json();
}

function creerSelectionsParDefaut() {
  return {
    stuff: {},
    opti1: {},
    opti2: {},
    opti3: {},
    opti4: {},
    opti5: {}
  };
}

function creerProfilParDefaut() {
  return {
    uid: "",
    theatre: "",
    characters: {
      full: {},
      niveaux: {},
      selections: creerSelectionsParDefaut()
    },
    weapons: {
      full: {},
      selections: creerSelectionsParDefaut()
    }
  };
}

function normaliserProfil(profil) {
  if (!profil.characters) {
    profil.characters = {
      full: profil.fullBox || profil.personnages || {},
      selections: profil.selections || creerSelectionsParDefaut()
    };
  }

  if (!profil.weapons) {
    profil.weapons = {
      full: {},
      selections: creerSelectionsParDefaut()
    };
  }

  if (!profil.characters.selections) {
    profil.characters.selections = creerSelectionsParDefaut();
  }

  if (!profil.weapons.selections) {
    profil.weapons.selections = creerSelectionsParDefaut();
  }

  if (!profil.characters.niveaux) {
    profil.characters.niveaux = {};
  }

  delete profil.fullBox;
  delete profil.personnages;
  delete profil.selections;

  return profil;
}

// ---- Remplace l'ancien chargerProfil() basé sur localStorage ----
async function chargerProfil() {
  try {
    const reponse = await fetch("/api/auth/profile", {
      credentials: "include"
    });

    if (!reponse.ok) {
      console.error("Impossible de charger le profil depuis le serveur.");
      return creerProfilParDefaut();
    }

    const data = await reponse.json();

    if (!data.profil) {
      return creerProfilParDefaut();
    }

    return normaliserProfil(data.profil);
  } catch (error) {
    console.error(error);
    return creerProfilParDefaut();
  }
}

// ---- Remplace l'ancien sauvegarderProfil() basé sur localStorage ----
async function sauvegarderProfil(profil) {
  try {
    const reponse = await fetch("/api/auth/profile", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profil)
    });

    if (!reponse.ok) {
      throw new Error("Échec de la sauvegarde côté serveur.");
    }

    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function getBoxActive() {
  return document.querySelector(".box-btn.active")?.dataset.box || "full";
}

function setBoxActive(box) {
  document.querySelectorAll(".box-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.box === box);
  });
}

function getVueActive() {
  return document.querySelector(".view-btn.active")?.dataset.view || "characters";
}

function setVueActive(view) {
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
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

function getConfigCollection(vueActive) {
  return configCollections[vueActive];
}

function getCollectionProfil(profil, vueActive) {
  return profil[vueActive];
}

function getListeActive(personnages, armes) {
  return getVueActive() === "characters" ? personnages : armes;
}

// ---- Gestion des instances dupliquées (armes uniquement) ----
// Une instance dupliquée a pour id "idArme#2", "idArme#3", etc.
// L'instance "originale" garde l'id brut de l'arme.

function getInstancesArme(idArme, collectionProfil) {
  const prefixe = `${idArme}#`;

  return Object.keys(collectionProfil.full)
    .filter(cle => cle === idArme || cle.startsWith(prefixe))
    .sort((a, b) => {
      const na = a === idArme ? 1 : parseInt(a.slice(prefixe.length), 10);
      const nb = b === idArme ? 1 : parseInt(b.slice(prefixe.length), 10);
      return na - nb;
    });
}

function creerNouvelleInstanceId(idArme, collectionProfil) {
  const prefixe = `${idArme}#`;
  let maxN = 1;

  Object.keys(collectionProfil.full).forEach(cle => {
    if (cle.startsWith(prefixe)) {
      const n = parseInt(cle.slice(prefixe.length), 10);
      if (!isNaN(n) && n > maxN) {
        maxN = n;
      }
    }
  });

  return `${idArme}#${maxN + 1}`;
}

function estInstanceDupliquee(instanceId) {
  return instanceId.includes("#");
}

function itemPossede(item, vueActive, collectionProfil) {
  if (vueActive !== "weapons") {
    return (collectionProfil.full[item.id] ?? -1) >= 0;
  }

  return getInstancesArme(item.id, collectionProfil)
    .some(instanceId => (collectionProfil.full[instanceId] ?? -1) >= 0);
}

function getPPC(item, valeur, vueActive) {
  if (valeur < 0) {
    return "";
  }

  const config = getConfigCollection(vueActive);
  return item[config.pointsField]?.[valeur] ?? "";
}

function creerBadgePPC(valeur) {
  const badge = document.createElement("div");
  badge.className = "ppc-badge";
  badge.textContent = valeur;
  return badge;
}

function getTypeValeur(item, vueActive) {
  return vueActive === "characters" ? item.arme : item.type;
}

// Niveau d'un perso possédé : null (non renseigné), 95 ou 100.
// Stocké dans profil.characters.niveaux[idPerso], clé absente si null.
const NIVEAUX_PERSONNAGE = [95, 100];

function creerSelectNiveau(idPerso, niveau) {
  const options = NIVEAUX_PERSONNAGE
    .map(n => `<option value="${n}" ${niveau === n ? "selected" : ""}>${n}</option>`)
    .join("");

  return `
<select class="niveau-select" data-id="${idPerso}" title="Niveau du personnage">
<option value="" ${niveau == null ? "selected" : ""}>Niv. -</option>
${options}
</select>
  `;
}

// ---- Coin bas droite des cartes (comme la liste des comptes) ----

// Couleur du détourage du logo d'arme signature, selon son raffinement
// (index 0 = R1 ... 4 = R5). Mêmes couleurs que la draft et la liste des comptes.
const COULEURS_REFINEMENT = ["#b0b0b0", "#6fcf6f", "#5b9bd5", "#a366d9", "#e0a83e"];

const iconesTypesArmesSignature = {
  sword: "../DB/images/others/sword_icon.webp",
  claymore: "../DB/images/others/claymore_icon.webp",
  polearm: "../DB/images/others/polearm_icon.webp",
  bow: "../DB/images/others/bow_icon.webp",
  catalyst: "../DB/images/others/catalyst_icon.webp"
};

// Arme signature : image nommée "[id_personnage]_w.webp". Index construit
// une seule fois (perso -> arme et arme -> perso) au lieu de parcourir la
// liste des armes à chaque carte.
let indexSignatures = null;

function getIndexSignatures(personnages, armes) {
  if (!indexSignatures) {
    const armeParPerso = new Map();
    const persoParArme = new Map();
    const persosParId = new Map(personnages.map(perso => [perso.id, perso]));

    armes.forEach(arme => {
      const m = typeof arme.image === "string" && arme.image.match(/([^/]+)_w\.webp$/);
      if (!m) return;
      armeParPerso.set(m[1], arme);
      if (persosParId.has(m[1])) persoParArme.set(arme.id, persosParId.get(m[1]));
    });

    indexSignatures = { armeParPerso, persoParArme };
  }
  return indexSignatures;
}

// Perso : logo de son arme signature possédée, détouré de la couleur du
// meilleur raffinement (copies "idArme#2"... comprises).
// Arme : icône du perso dont c'est l'arme signature.
function creerCoinBasDroite(item, vueActive, personnages, armes, profil) {
  if (vueActive === "weapons") {
    const personnageLie = getIndexSignatures(personnages, armes).persoParArme.get(item.id);
    return personnageLie
      ? `<img class="perso-lie-icone" src="../DB/images/characters/side_char/${personnageLie.id}_side.webp" alt="${personnageLie.nom}" title="${personnageLie.nom}">`
      : "";
  }

  const arme = getIndexSignatures(personnages, armes).armeParPerso.get(item.id);
  const iconeArme = iconesTypesArmesSignature[item.arme];
  if (!arme || !iconeArme) return "";

  const refinement = Math.max(-1, ...getInstancesArme(arme.id, profil.weapons)
    .map(instanceId => profil.weapons.full[instanceId] ?? -1));
  if (refinement < 0) return "";

  const couleur = COULEURS_REFINEMENT[refinement] || COULEURS_REFINEMENT[0];
  return `<img class="character-raffinement" src="${iconeArme}" alt="R${refinement + 1}" title="Arme signature R${refinement + 1}" style="--couleur-ref: ${couleur}">`;
}

// Carte : un rectangle qui englobe le visuel (constellation en haut à
// gauche, points en haut à droite, niveau en bas à gauche, arme en bas à
// droite), le réglage de constellation et le niveau. Nom au survol.
function creerCarteItem(item, valeur = -1, boxActive = "full", selectionne = false, vueActive = "characters", instanceId = null, peutDupliquer = false, estDuplicata = false, niveau = null, coinBasDroite = "") {
  const config = getConfigCollection(vueActive);
  const idInstance = instanceId || item.id;
  const conteneur = document.createElement("div");
  conteneur.className = "carte-personnage";
  conteneur.title = estDuplicata ? `${item.nom} (copie)` : item.nom;

  const fond = getFondRarete(item.rarete);
  const affichageNiveau = valeur < 0 ? "-" : config.labels[valeur];

  const classeSelectionnable = boxActive === "full" ? "" : "selectionnable";
  const classeSelectionnee = boxActive !== "full" && selectionne ? "selectionnee" : "";

  const opacite = boxActive === "full"
    ? (valeur < 0 ? "0.4" : "1")
    : (selectionne ? "1" : "0.45");

  const boutonDupliquer = peutDupliquer
    ? `<button type="button" class="constellation-btn dupliquer-btn" data-base-id="${item.id}" title="Dupliquer cette arme">⧉</button>`
    : "";

  const zoneAction = boxActive === "full"
    ? `
<div class="controle-constellation">
<button type="button" class="constellation-btn moins-btn" data-id="${idInstance}">-</button>
<span class="info-constellation">${affichageNiveau}</span>
<button type="button" class="constellation-btn plus-btn" data-id="${idInstance}">+</button>
${boutonDupliquer}
</div>
    `
    : "";

  const zoneNiveau = boxActive === "full" && vueActive === "characters" && valeur >= 0
    ? creerSelectNiveau(idInstance, niveau)
    : "";

  const badgeCopie = estDuplicata ? `<span class="badge-copie">Copie</span>` : "";

  const possede = valeur >= 0;
  const badgeConstellation = possede
    ? `<span class="badge-carte badge-constellation">${affichageNiveau}</span>`
    : "";
  const badgeNiveau = possede && vueActive === "characters" && niveau
    ? `<span class="badge-carte badge-niveau">${niveau}</span>`
    : "";

  conteneur.innerHTML = `
<div class="visuel-personnage ${classeSelectionnable} ${classeSelectionnee}" data-id="${idInstance}" style="background-image: url('${fond}'); opacity: ${opacite};">
<img class="image-personnage" src="../DB/${item.image}" alt="${item.nom}" loading="lazy" decoding="async">
      ${badgeConstellation}
      ${badgeNiveau}
      ${possede ? coinBasDroite : ""}
</div>
    ${badgeCopie}
    ${zoneAction}
    ${zoneNiveau}
  `;

  if (valeur >= 0) {
    conteneur.querySelector(".visuel-personnage").appendChild(
      creerBadgePPC(getPPC(item, valeur, vueActive))
    );
  }

  return conteneur;
}

// ---- Recherche / tri (choix unique, comme en draft) ----

let triActif = null; // "points" | "constellation" | "niveau" | "rarete" | "element" | null (ordre par défaut)

const LIBELLES_TRI = {
  characters: { constellation: "Constel.", element: "Élément" },
  weapons: { constellation: "Raffin.", element: "Type" }
};

// Valeur de possession d'un item : constellation (persos) ou meilleur
// raffinement parmi les copies (armes) ; -1 si non possédé.
function getValeurItem(item, vueActive, collectionProfil) {
  if (vueActive !== "weapons") {
    return collectionProfil.full[item.id] ?? -1;
  }

  return Math.max(-1, ...getInstancesArme(item.id, collectionProfil)
    .map(instanceId => collectionProfil.full[instanceId] ?? -1));
}

// Décroissant, sauf élément/type (ordre des icônes de filtre). Tri stable :
// l'ordre de base départage.
function valeurTri(item, vueActive, collectionProfil) {
  const valeur = getValeurItem(item, vueActive, collectionProfil);

  switch (triActif) {
    case "points":
      return valeur < 0 ? -1 : Number(getPPC(item, valeur, vueActive) || 0);
    case "constellation":
      return valeur;
    case "niveau":
      // 100 > 95 > non renseigné (persos uniquement).
      return vueActive === "characters" ? Number(collectionProfil.niveaux?.[item.id]) || 0 : 0;
    case "rarete":
      return Number(item.rarete) || 0;
    case "element":
      return vueActive === "characters"
        ? -Object.keys(iconesElements).indexOf(item.element)
        : -Object.keys(iconesTypesArmes).indexOf(item.type);
    default:
      return 0;
  }
}

function trierItems(items, vueActive, collectionProfil) {
  if (!triActif) return items;
  return items
    .map((item, index) => ({ item, index, v: valeurTri(item, vueActive, collectionProfil) }))
    .sort((a, b) => (b.v - a.v) || (a.index - b.index))
    .map(e => e.item);
}

function mettreAJourBoutonsTri() {
  const vueActive = getVueActive();
  const libelles = LIBELLES_TRI[vueActive];

  // Pas de niveau pour les armes : tri masqué dans cette vue.
  if (vueActive === "weapons" && triActif === "niveau") triActif = null;

  document.querySelectorAll(".tri-btn").forEach(btn => {
    btn.hidden = btn.dataset.tri === "niveau" && vueActive === "weapons";
    if (libelles[btn.dataset.tri]) btn.textContent = libelles[btn.dataset.tri];
    btn.classList.toggle("active", btn.dataset.tri === triActif);
  });
}

function afficherCollection(personnages, armes, profil) {
  const liste = document.getElementById("liste-collection");
  liste.innerHTML = "";

  const vueActive = getVueActive();
  const boxActive = getBoxActive();
  const items = getListeActive(personnages, armes);
  const collectionProfil = getCollectionProfil(profil, vueActive);

  const elementsSelectionnes = Array.from(document.querySelectorAll(".filtre-element:checked"))
    .map(input => input.value);

  const armesSelectionnees = Array.from(document.querySelectorAll(".filtre-arme:checked"))
    .map(input => input.value);

  const rareteSelectionnees = Array.from(document.querySelectorAll(".filtre-rarete:checked"))
    .map(input => input.value);

  const recherche = document.getElementById("recherche").value.trim().toLowerCase();
  const possedesSeulement = document.getElementById("filtre-possedes").checked;

  mettreAJourBoutonsTri();

  const itemsFiltres = trierItems(items.filter(item => {
    const typeValeur = getTypeValeur(item, vueActive);
    const rareteValeur = item.rarete != null ? String(item.rarete) : "";

    const filtreElementOK =
      elementsSelectionnes.length === 0 || elementsSelectionnes.includes(item.element);

    const filtreArmeOK =
      armesSelectionnees.length === 0 || armesSelectionnees.includes(typeValeur);

    const filtreRareteOK =
      rareteSelectionnees.length === 0 ||
      rareteValeur === "" ||
      rareteSelectionnees.includes(rareteValeur);

    if ((boxActive !== "full" || possedesSeulement) && !itemPossede(item, vueActive, collectionProfil)) {
      return false;
    }

    if (recherche && !String(item.nom || "").toLowerCase().includes(recherche)) {
      return false;
    }

    return filtreElementOK && filtreArmeOK && filtreRareteOK;
  }), vueActive, collectionProfil);

  itemsFiltres.forEach(item => {
    if (vueActive === "weapons") {
      const instances = getInstancesArme(item.id, collectionProfil);
      const instancesAffichees = instances.length > 0 ? instances : [item.id];
      const coinBasDroite = creerCoinBasDroite(item, vueActive, personnages, armes, profil);

      instancesAffichees.forEach(instanceId => {
        const valeur = collectionProfil.full[instanceId] ?? -1;
        const selectionne = boxActive === "full"
          ? valeur >= 0
          : !!collectionProfil.selections[boxActive][instanceId];
        const estDuplicata = estInstanceDupliquee(instanceId);
        const peutDupliquer = boxActive === "full" && valeur >= 0;

        const carte = creerCarteItem(item, valeur, boxActive, selectionne, vueActive, instanceId, peutDupliquer, estDuplicata, null, coinBasDroite);
        liste.appendChild(carte);
      });
      return;
    }

    const valeur = collectionProfil.full[item.id] ?? -1;
    const selectionne = boxActive === "full"
      ? valeur >= 0
      : !!collectionProfil.selections[boxActive][item.id];

    const niveau = collectionProfil.niveaux?.[item.id] ?? null;
    const coinBasDroite = creerCoinBasDroite(item, vueActive, personnages, armes, profil);
    const carte = creerCarteItem(item, valeur, boxActive, selectionne, vueActive, null, false, false, niveau, coinBasDroite);
    liste.appendChild(carte);
  });
}

function mettreAJourTotalBox(personnages, armes, profil) {
  const vueActive = getVueActive();
  const boxActive = getBoxActive();
  const items = getListeActive(personnages, armes);
  const collectionProfil = getCollectionProfil(profil, vueActive);
  const config = getConfigCollection(vueActive);

  let total = 0;

  items.forEach(item => {
    const instances = vueActive === "weapons"
      ? getInstancesArme(item.id, collectionProfil)
      : [item.id];
    const instancesAffichees = instances.length > 0 ? instances : [item.id];

    instancesAffichees.forEach(instanceId => {
      const valeur = collectionProfil.full[instanceId] ?? -1;

      if (valeur < 0) {
        return;
      }

      const inclus = boxActive === "full"
        ? true
        : !!collectionProfil.selections[boxActive][instanceId];

      if (inclus) {
        total += Number(item[config.pointsField]?.[valeur] ?? 0);
      }
    });
  });

  document.getElementById("box-total-label").textContent = `${nomsBoxes[boxActive]} - ${config.nomVue}`;
  document.getElementById("total-ppc").textContent = total;
}

async function initialiserPage() {
  try {
    const [personnages, armes] = await Promise.all([
      chargerPersonnages(),
      chargerArmes()
    ]);

    const profil = await chargerProfil();

    document.getElementById("uid").value = profil.uid || "";
    document.getElementById("theatre").value = profil.theatre || "";

    setBoxActive("full");
    setVueActive("characters");

    afficherCollection(personnages, armes, profil);
    mettreAJourTotalBox(personnages, armes, profil);

    document.querySelectorAll(".filtre-element, .filtre-arme, .filtre-rarete, #filtre-possedes").forEach(input => {
      input.addEventListener("change", () => {
        afficherCollection(personnages, armes, profil);
        mettreAJourTotalBox(personnages, armes, profil);
      });
    });

    const inputRecherche = document.getElementById("recherche");
    inputRecherche.addEventListener("input", () => {
      afficherCollection(personnages, armes, profil);
    });
    // Entrée dans la recherche ne doit pas soumettre (= enregistrer) le formulaire.
    inputRecherche.addEventListener("keydown", event => {
      if (event.key === "Enter") event.preventDefault();
    });

    document.querySelectorAll(".tri-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        triActif = triActif === btn.dataset.tri ? null : btn.dataset.tri;
        afficherCollection(personnages, armes, profil);
      });
    });

    document.getElementById("btn-clear-filtres").addEventListener("click", () => {
      document.querySelectorAll(".barre-filtres input[type=checkbox]").forEach(input => {
        input.checked = false;
      });
      inputRecherche.value = "";
      triActif = null;
      afficherCollection(personnages, armes, profil);
      mettreAJourTotalBox(personnages, armes, profil);
    });

    document.querySelectorAll(".box-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        setBoxActive(btn.dataset.box);
        afficherCollection(personnages, armes, profil);
        mettreAJourTotalBox(personnages, armes, profil);
      });
    });

    document.querySelectorAll(".view-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        setVueActive(btn.dataset.view);
        afficherCollection(personnages, armes, profil);
        mettreAJourTotalBox(personnages, armes, profil);
      });
    });

    const liste = document.getElementById("liste-collection");

    liste.addEventListener("click", event => {
      const vueActive = getVueActive();
      const boxActive = getBoxActive();
      const items = getListeActive(personnages, armes);
      const collectionProfil = getCollectionProfil(profil, vueActive);
      const config = getConfigCollection(vueActive);

      if (boxActive === "full") {
        const boutonDupliquer = event.target.closest(".dupliquer-btn");

        if (boutonDupliquer) {
          const idArme = boutonDupliquer.dataset.baseId;
          const valeurArme = collectionProfil.full[idArme] ?? -1;

          if (valeurArme < 0) {
            return;
          }

          const nouvelId = creerNouvelleInstanceId(idArme, collectionProfil);
          collectionProfil.full[nouvelId] = 0; // nouvelle copie à R1

          afficherCollection(personnages, armes, profil);
          mettreAJourTotalBox(personnages, armes, profil);
          return;
        }

        const boutonMoins = event.target.closest(".moins-btn");
        const boutonPlus = event.target.closest(".plus-btn");

        if (!boutonMoins && !boutonPlus) {
          return;
        }

        const id = (boutonMoins || boutonPlus).dataset.id;
        let valeur = collectionProfil.full[id] ?? -1;

        if (boutonPlus) {
          valeur = valeur === config.maxLevel ? -1 : valeur + 1;
        }

        if (boutonMoins) {
          valeur = valeur === -1 ? config.maxLevel : valeur - 1;
        }

        // Une copie dupliquée n'existe pas en dessous de R1 : elle est
        // simplement supprimée au lieu de repasser à "non possédée".
        if (estInstanceDupliquee(id) && valeur < 0) {
          delete collectionProfil.full[id];
          Object.keys(collectionProfil.selections).forEach(box => {
            delete collectionProfil.selections[box][id];
          });
        } else {
          collectionProfil.full[id] = valeur;

          if (valeur < 0) {
            Object.keys(collectionProfil.selections).forEach(box => {
              delete collectionProfil.selections[box][id];
            });
            if (collectionProfil.niveaux) {
              delete collectionProfil.niveaux[id];
            }
          }
        }

        afficherCollection(personnages, armes, profil);
        mettreAJourTotalBox(personnages, armes, profil);
        return;
      }

      const visuel = event.target.closest(".visuel-personnage[data-id]");
      if (!visuel) {
        return;
      }

      const id = visuel.dataset.id;

      if (collectionProfil.selections[boxActive][id]) {
        delete collectionProfil.selections[boxActive][id];
      } else {
        collectionProfil.selections[boxActive][id] = true;
      }

      afficherCollection(personnages, armes, profil);
      mettreAJourTotalBox(personnages, armes, profil);
    });

    liste.addEventListener("change", event => {
      const select = event.target.closest(".niveau-select");
      if (!select) {
        return;
      }

      const niveaux = profil.characters.niveaux;
      const niveau = Number(select.value);

      if (NIVEAUX_PERSONNAGE.includes(niveau)) {
        niveaux[select.dataset.id] = niveau;
      } else {
        delete niveaux[select.dataset.id];
      }
    });

    document.getElementById("profil-form").addEventListener("submit", async event => {
      event.preventDefault();

      profil.uid = document.getElementById("uid").value;
      profil.theatre = document.getElementById("theatre").value;

      const succes = await sauvegarderProfil(profil);
      afficherToast(
        succes ? "Profil enregistré avec succès" : "Erreur lors de l'enregistrement du profil",
        succes ? "succes" : "erreur"
      );
    });

    // UID / théâtre (menu du compte) : même enregistrement que le formulaire.
    document.getElementById("btn-enregistrer-compte").addEventListener("click", () => {
      document.getElementById("profil-form").requestSubmit();
      fermerMenuCompte();
    });

    initialiserGrille();
    initialiserParametres(profil);
  } catch (erreur) {
    console.error(erreur);
    alert("Erreur lors du chargement de la page.");
  }
}

// ---- Grille : toute la largeur, écarts homogènes (même calcul que la draft) ----
// Autant de colonnes que possible avec un écart >= ECART_MIN_GRILLE, puis
// l'espace restant est réparti également entre les cartes et sur les 2
// bords ; le même écart sert entre les lignes. Téléphone : 4 par ligne,
// cartes réduites à la largeur de l'écran.

const ECART_MIN_GRILLE = 10;
const MEDIA_TELEPHONE = window.matchMedia("(max-width: 700px)");
const COLONNES_TELEPHONE = 4;

function ajusterGrille(grille) {
  const largeur = grille.clientWidth;
  if (!largeur) return;

  let taille = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--taille-carte")) || 132;
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
  const grille = document.getElementById("liste-collection");
  new ResizeObserver(() => ajusterGrille(grille)).observe(grille);
}

// ---- Paramètres : bannière, deuxième bannière, fond d'écran ----
// Choix listés dans DB/images/cosmetiques.json (généré par
// scripts/generer_cosmetiques.py). Stockés dans profil.parametres :
//   banniere  : "namecards/Namecard_Background_....webp"
//   banniere2 : "namecards/banners/Namecard_Banner_....webp"
//   fond      : id du fond = chemin de l'image source ("bg/autres/....png")
// null = aucun (fond gris par défaut).

const RACINE_IMAGES = "../DB/images/";

let cosmetiques = null;

async function chargerCosmetiques() {
  if (cosmetiques) return cosmetiques;
  const reponse = await fetch(`${RACINE_IMAGES}cosmetiques.json`);
  if (!reponse.ok) {
    throw new Error("Impossible de charger DB/images/cosmetiques.json");
  }
  cosmetiques = await reponse.json();
  return cosmetiques;
}

function urlImage(chemin) {
  return encodeURI(RACINE_IMAGES + chemin);
}

// "namecards/Namecard_Background_Hu_Tao_Lingering.webp" -> "Hu Tao Lingering"
function nomNamecard(chemin) {
  return chemin
    .split("/").pop()
    .replace(/^Namecard_(Background|Banner)_/, "")
    .replace(/\.[a-z]+$/i, "")
    .replace(/_/g, " ");
}

function getFond(idFond) {
  return cosmetiques?.fonds.find(fond => fond.id === idFond) || null;
}

// Met à jour le cache du fond partagé avec les autres pages (commun/fond.js).
// Met aussi à jour la deuxième bannière du bouton du compte.
function memoriserFondPourLeSite(idFond, banniere2) {
  const urlBanniere2 = banniere2 ? urlImage(banniere2) : null;
  if (window.FondEcran) {
    window.FondEcran.appliquerBanniere2(document.getElementById("compte-btn"), urlBanniere2);
  }
  if (!cosmetiques || !window.FondEcran) return;
  const fond = getFond(idFond);
  window.FondEcran.memoriser(fond ? urlImage(fond.image) : null, urlBanniere2);
}

function appliquerFond(idFond) {
  const fond = getFond(idFond);
  // Utilisé par le calque fixe body::before (cf. CSS).
  document.body.style.setProperty("--fond-ecran", fond ? `url("${urlImage(fond.image)}")` : "none");
}

async function initialiserParametres(profil) {
  const modal = document.getElementById("modal-parametres");
  const conteneurChoix = document.getElementById("choix-parametres");
  const inputRecherche = document.getElementById("recherche-parametres");

  let ongletActif = "banniere";
  let brouillon = null; // choix en cours, appliqués seulement à l'enregistrement

  try {
    await chargerCosmetiques();
  } catch (erreur) {
    console.error(erreur);
  }

  profil.parametres = { banniere: null, banniere2: null, fond: null, ...(profil.parametres || {}) };
  appliquerFond(profil.parametres.fond);
  memoriserFondPourLeSite(profil.parametres.fond, profil.parametres.banniere2);

  function rendreApercus() {
    const cases = {
      "apercu-banniere": brouillon.banniere && urlImage(brouillon.banniere),
      "apercu-banniere2": brouillon.banniere2 && urlImage(brouillon.banniere2),
      "apercu-fond": getFond(brouillon.fond) && urlImage(getFond(brouillon.fond).miniature)
    };
    Object.entries(cases).forEach(([id, url]) => {
      const bloc = document.getElementById(id);
      bloc.style.backgroundImage = url ? `url("${url}")` : "";
      bloc.textContent = url ? "" : "Aucun";
    });
  }

  function creerChoix({ valeur, image, titre, classe }) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = `choix-parametre ${classe}`;
    bouton.title = titre;
    bouton.classList.toggle("active", brouillon[ongletActif] === valeur);
    bouton.innerHTML = image
      ? `<img src="${image}" alt="${titre}" loading="lazy">`
      : `<span>Aucun</span>`;
    bouton.addEventListener("click", () => {
      brouillon[ongletActif] = valeur;
      if (ongletActif === "fond") appliquerFond(valeur);
      rendreApercus();
      rendreChoix();
    });
    return bouton;
  }

  function rendreChoix() {
    conteneurChoix.innerHTML = "";

    if (!cosmetiques) {
      conteneurChoix.textContent = "Impossible de charger la liste des images.";
      return;
    }

    const recherche = inputRecherche.value.trim().toLowerCase();
    const classe = `choix-${ongletActif}`;
    const grille = document.createElement("div");
    grille.className = `grille-choix ${classe}`;
    grille.appendChild(creerChoix({ valeur: null, image: null, titre: "Aucun", classe }));

    if (ongletActif === "fond") {
      // Fonds groupés par sous-dossier de DB/images/bg.
      conteneurChoix.appendChild(grille);
      const categories = [...new Set(cosmetiques.fonds.map(fond => fond.categorie))];

      categories.forEach(categorie => {
        const fonds = cosmetiques.fonds.filter(fond =>
          fond.categorie === categorie &&
          (!recherche || fond.id.toLowerCase().includes(recherche))
        );
        if (fonds.length === 0) return;

        const titre = document.createElement("h3");
        titre.className = "categorie-choix";
        titre.textContent = (categorie || "Divers").replace(/_/g, " ");
        conteneurChoix.appendChild(titre);

        const grilleCategorie = document.createElement("div");
        grilleCategorie.className = `grille-choix ${classe}`;
        fonds.forEach(fond => {
          grilleCategorie.appendChild(creerChoix({
            valeur: fond.id,
            image: urlImage(fond.miniature),
            titre: fond.id.split("/").pop(),
            classe
          }));
        });
        conteneurChoix.appendChild(grilleCategorie);
      });
      return;
    }

    const liste = ongletActif === "banniere" ? cosmetiques.bannieres : cosmetiques.bannieres2;
    liste
      .filter(chemin => !recherche || nomNamecard(chemin).toLowerCase().includes(recherche))
      .forEach(chemin => {
        grille.appendChild(creerChoix({ valeur: chemin, image: urlImage(chemin), titre: nomNamecard(chemin), classe }));
      });
    conteneurChoix.appendChild(grille);
  }

  function ouvrir() {
    brouillon = { ...profil.parametres };
    inputRecherche.value = "";
    rendreApercus();
    rendreChoix();
    modal.classList.add("active");
    fermerMenuCompte();
  }

  // Fermer sans enregistrer : on revient au fond enregistré.
  function fermer() {
    modal.classList.remove("active");
    appliquerFond(profil.parametres.fond);
  }

  document.getElementById("btn-parametres").addEventListener("click", ouvrir);
  document.getElementById("fermer-parametres").addEventListener("click", fermer);
  document.getElementById("annuler-parametres").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  document.querySelectorAll(".onglet-parametre").forEach(bouton => {
    bouton.addEventListener("click", () => {
      ongletActif = bouton.dataset.onglet;
      document.querySelectorAll(".onglet-parametre").forEach(b => {
        b.classList.toggle("active", b === bouton);
      });
      inputRecherche.value = "";
      rendreChoix();
    });
  });

  inputRecherche.addEventListener("input", rendreChoix);

  // Enregistre le profil entier (comme le bouton Enregistrer de la page).
  document.getElementById("enregistrer-parametres").addEventListener("click", async () => {
    profil.parametres = { ...brouillon };
    const succes = await sauvegarderProfil(profil);
    afficherToast(
      succes ? "Paramètres enregistrés" : "Erreur lors de l'enregistrement des paramètres",
      succes ? "succes" : "erreur"
    );
    if (succes) {
      memoriserFondPourLeSite(profil.parametres.fond, profil.parametres.banniere2);
      fermer();
    }
  });
}

function afficherToast(message, type = "succes") {
  const conteneur = document.getElementById("toast-conteneur") || (() => {
    const div = document.createElement("div");
    div.id = "toast-conteneur";
    document.body.appendChild(div);
    return div;
  })();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  conteneur.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));

  setTimeout(() => {
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
  }, 3000);
}

async function demarrer() {
  const connecte = await chargerSessionDiscord();

  if (connecte) {
    initialiserPage();
  }
}

demarrer();