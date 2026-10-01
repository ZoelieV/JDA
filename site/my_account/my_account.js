const nomsBoxes = {
  full: "Full Box",
  stuff: "Personnages stuff",
  opti1: "Box optimisée 1",
  opti2: "Box optimisée 2",
  opti3: "Box optimisée 3",
  opti4: "Box optimisée 4",
  opti5: "Box optimisée 5",
  vitrine: "Vitrine"
};

// Vitrine : sélection à montrer (Mon compte, Tous les comptes ; plus tard
// les modes 2v2, 4v4...), limitée en nombre (même limite côté serveur,
// cf. api/auth/profile.js).
const MAX_VITRINE = { characters: 12, weapons: 12 };

// Box optimisées renommables par le joueur (profil.nomsBoxes[box], 20
// caractères max), noms repris en draft.
const BOX_RENOMMABLES = ["opti1", "opti2", "opti3", "opti4", "opti5"];
const LONGUEUR_NOM_BOX = 20;

function nomBox(profil, box) {
  return profil.nomsBoxes?.[box] || nomsBoxes[box];
}

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
    window.FondEcran?.memoriserTheatre(null);
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
  // chargement du profil, cf. memoriserFondPourLeSite). Médaille du théâtre
  // après le pseudo, mise à jour au chargement et à l'enregistrement du
  // profil (FondEcran.memoriserTheatre).
  window.FondEcran?.appliquerBanniere2(bouton, window.FondEcran.banniere2());
  window.FondEcran?.appliquerMedaille(bouton, window.FondEcran.theatre());
  document.addEventListener("theatre-change", event => {
    window.FondEcran.appliquerMedaille(bouton, event.detail);
  });

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

function creerSelectionsParDefaut() {
  return {
    stuff: {},
    opti1: {},
    opti2: {},
    opti3: {},
    opti4: {},
    opti5: {},
    vitrine: {}
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

  // Box ajoutées depuis (ex. vitrine) : absentes des anciens profils.
  Object.keys(creerSelectionsParDefaut()).forEach(box => {
    profil.characters.selections[box] ??= {};
    profil.weapons.selections[box] ??= {};
  });

  delete profil.fullBox;
  delete profil.personnages;
  delete profil.selections;

  // Ancien Voyageur unique -> Voyageur Anemo (cf. commun/variantes.js).
  migrerCollectionPersos(profil.characters);

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

// ---- Noms des box optimisées (renommables) ----

function afficherNomsBoxes(profil) {
  BOX_RENOMMABLES.forEach(box => {
    const span = document.querySelector(`.box-btn[data-box="${box}"] .nom-box`);
    if (span) span.textContent = nomBox(profil, box);
  });
}

// Champ à la place du bouton : Entrée ou sortie du champ = valider (vide =
// nom par défaut), Échap = annuler. À enregistrer ensuite comme le reste.
function commencerRenommage(bouton, profil, apresRenommage) {
  const box = bouton.dataset.box;
  const champ = document.createElement("input");
  champ.type = "text";
  champ.className = "renommer-input";
  champ.maxLength = LONGUEUR_NOM_BOX;
  champ.value = nomBox(profil, box);
  champ.placeholder = nomsBoxes[box];
  bouton.hidden = true;
  bouton.after(champ);
  champ.focus();
  champ.select();

  let termine = false;
  const terminer = valider => {
    if (termine) return;
    termine = true;
    if (valider) {
      const nom = champ.value.trim().slice(0, LONGUEUR_NOM_BOX);
      profil.nomsBoxes ??= {};
      if (nom && nom !== nomsBoxes[box]) profil.nomsBoxes[box] = nom;
      else delete profil.nomsBoxes[box];
    }
    champ.remove();
    bouton.hidden = false;
    afficherNomsBoxes(profil);
    apresRenommage();
  };

  champ.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault(); // pas d'envoi du formulaire
      terminer(true);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      terminer(false);
    }
  });
  champ.addEventListener("blur", () => terminer(true));
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

// Instance (perso ou copie d'arme) possédée et sélectionnée dans une box
// autre que la Full Box.
function instanceSelectionnee(instanceId, boxActive, collectionProfil) {
  return (collectionProfil.full[instanceId] ?? -1) >= 0 &&
    !!collectionProfil.selections[boxActive][instanceId];
}

function itemSelectionne(item, vueActive, boxActive, collectionProfil) {
  const instances = vueActive === "weapons"
    ? getInstancesArme(item.id, collectionProfil)
    : [item.id];
  return instances.some(instanceId => instanceSelectionnee(instanceId, boxActive, collectionProfil));
}

// Points d'un item possédé ; personnages : bonus du niveau (95 / 100) et du
// théâtre compris (cf. pointsPersonnage, commun/cartes.js).
function getPPC(item, valeur, vueActive, niveau = null) {
  if (valeur < 0) {
    return "";
  }

  if (vueActive === "characters") return pointsPersonnage(item, valeur, niveau);
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
// Stocké dans profil.characters.niveaux[idPerso], clé absente si null ;
// Voyageur : niveau commun à tous ses éléments (niveaux["traveler"]).
const NIVEAUX_PERSONNAGE = [95, 100];

function creerSelectNiveau(idPerso, niveau) {
  const options = NIVEAUX_PERSONNAGE
    .map(n => `<option value="${n}" ${niveau === n ? "selected" : ""}>${n}</option>`)
    .join("");

  return `
<label class="niveau-choix" title="Niveau du personnage">
<img class="niveau-logo" src="../DB/images/others/stella.webp" alt="Niveau">
<select class="niveau-select" data-id="${idPerso}" aria-label="Niveau du personnage">
<option value="" ${niveau == null ? "selected" : ""}>-</option>
${options}
</select>
</label>
  `;
}

// ---- Coin bas droite des cartes (comme la liste des comptes) ----

// Perso : logo de son arme signature possédée, détouré de la couleur du
// meilleur raffinement (copies "idArme#2"... comprises).
// Arme : icône du perso dont c'est l'arme signature.
function creerCoinBasDroite(item, vueActive, personnages, armes, profil) {
  if (vueActive === "weapons") {
    const personnageLie = trouverPersonnageSignature(armes, personnages, item.id);
    return personnageLie
      ? `<img class="perso-lie-icone" src="../DB/${getIconeLaterale(personnageLie)}" alt="${personnageLie.nom}" title="${personnageLie.nom}">`
      : "";
  }

  const arme = trouverArmeSignature(armes, item);
  return arme ? htmlArmeSignature(item.arme, meilleurRaffinement(profil.weapons.full, arme.id)) : "";
}

// Carte : un rectangle qui englobe le visuel (constellation en haut à
// gauche, points en haut à droite, niveau en bas à gauche, arme en bas à
// droite), le réglage de constellation et le niveau. Nom au survol.
// favori : true / false pour afficher le cœur des favoris (persos et armes
// d'origine possédés, Full Box), null sinon.
function creerCarteItem(item, valeur = -1, boxActive = "full", selectionne = false, vueActive = "characters", instanceId = null, peutDupliquer = false, estDuplicata = false, niveau = null, coinBasDroite = "", favori = null) {
  const config = getConfigCollection(vueActive);
  const idInstance = instanceId || item.id;
  const conteneur = document.createElement("div");
  conteneur.className = valeur >= 0 ? "carte-personnage possede" : "carte-personnage";
  conteneur.title = estDuplicata ? `${item.nom} (copie)` : item.nom;

  const affichageNiveau = valeur < 0 ? "-" : config.labels[valeur];

  const classeSelectionnable = boxActive === "full" ? "" : "selectionnable";
  const classeSelectionnee = boxActive !== "full" && selectionne ? "selectionnee" : "";

  // Non possédé (Full Box) / non sélectionné (autres box) : estompé.
  const classeEstompee = boxActive === "full"
    ? (valeur < 0 ? "estompe" : "")
    : (selectionne ? "" : "estompe-box");

  // Copie : étiquette "Copie" à la place du bouton dupliquer (on ne duplique
  // que l'arme d'origine).
  const boutonDupliquer = estDuplicata
    ? `<span class="badge-copie">Copie</span>`
    : peutDupliquer
      ? `<button type="button" class="constellation-btn dupliquer-btn" data-base-id="${item.id}" title="Dupliquer cette arme">⧉</button>`
      : "";

  const zoneAction = boxActive === "full"
    ? `
<div class="controle-constellation">
<button type="button" class="constellation-btn moins-btn" data-id="${idInstance}">-</button>
<span class="info-constellation">${affichageNiveau}</span>
<button type="button" class="constellation-btn plus-btn" data-id="${idInstance}">+</button>
</div>
    `
    : "";

  // Sous les constellations, côte à côte et de la même taille : stella
  // (niveau) + cœur pour un perso, dupliquer (ou "Copie") + cœur pour une
  // arme.
  const boutonFavori = favori === null
    ? ""
    : `<button type="button" class="favori-btn${favori ? " actif" : ""}" data-id="${item.id}" title="${favori ? "Retirer des favoris" : "Ajouter aux favoris"}"><img src="../DB/images/others/favourite.webp" alt="Favori"></button>`;
  const outils = vueActive === "characters"
    ? (valeur >= 0 ? creerSelectNiveau(cleNiveau(item), niveau) : "") + boutonFavori
    : boutonDupliquer + boutonFavori;
  const zoneOutils = boxActive === "full" && outils
    ? `<div class="ligne-outils outils-${vueActive}">${outils}</div>`
    : "";

  // Hors Full Box (pas de réglages) : étiquette "Copie" sous l'image.
  const badgeCopie = estDuplicata && boxActive !== "full" ? `<span class="badge-copie">Copie</span>` : "";

  const possede = valeur >= 0;
  const badgeConstellation = possede
    ? `<span class="badge-carte badge-constellation">${affichageNiveau}</span>`
    : "";
  // Voyageur (un par élément) : niveau centré en bas, élément en bas à
  // gauche.
  const avecElement = vueActive === "characters" && item.groupe && ICONES_ELEMENTS_TRI[item.element];
  const badgeNiveau = possede && vueActive === "characters" && niveau
    ? `<span class="badge-carte ${avecElement ? "badge-niveau-centre" : "badge-niveau"}">${niveau}</span>`
    : "";
  const badgeElement = avecElement
    ? `<img class="badge-carte badge-element" src="${ICONES_ELEMENTS_TRI[item.element]}" alt="${item.element}" title="${NOMS_ELEMENTS[item.element] || item.element}">`
    : "";

  conteneur.innerHTML = `
<div class="visuel-personnage ${classeFondRarete(item.rarete)} ${classeSelectionnable} ${classeSelectionnee} ${classeEstompee}" data-id="${idInstance}">
<img class="image-personnage" src="../DB/${item.image}" alt="${item.nom}" loading="lazy" decoding="async">
      ${badgeConstellation}
      ${badgeNiveau}
      ${badgeElement}
      ${possede ? coinBasDroite : ""}
</div>
    ${badgeCopie}
    ${zoneAction}
    ${zoneOutils}
  `;

  if (valeur >= 0) {
    conteneur.querySelector(".visuel-personnage").appendChild(
      creerBadgePPC(getPPC(item, valeur, vueActive, niveau))
    );
  }

  return conteneur;
}

// ---- Recherche / tris combinables (cf. commun/tri.js) ----

const etatTri = creerEtatTri();
// Filtres élément / type d'arme, dans l'ordre des clics (ordre des groupes).
const selectionElements = new Set();
const selectionArmes = new Set();

// Valeur de possession d'un item : constellation (persos) ou meilleur
// raffinement parmi les copies (armes) ; -1 si non possédé.
function getValeurItem(item, vueActive, collectionProfil) {
  if (vueActive !== "weapons") {
    return collectionProfil.full[item.id] ?? -1;
  }

  return Math.max(-1, ...getInstancesArme(item.id, collectionProfil)
    .map(instanceId => collectionProfil.full[instanceId] ?? -1));
}

function getValeursTri(vueActive, collectionProfil) {
  return {
    points: item => {
      const valeur = getValeurItem(item, vueActive, collectionProfil);
      const niveau = vueActive === "characters" ? collectionProfil.niveaux?.[cleNiveau(item)] : null;
      return valeur < 0 ? -1 : Number(getPPC(item, valeur, vueActive, niveau) || 0);
    },
    constellation: item => getValeurItem(item, vueActive, collectionProfil),
    // 100 > 95 > non renseigné (persos uniquement).
    niveau: item => vueActive === "characters" ? Number(collectionProfil.niveaux?.[cleNiveau(item)]) || 0 : 0,
    // Favoris d'abord (persos et armes).
    favoris: item => collectionProfil.favoris?.[item.id] ? 1 : 0
  };
}

function mettreAJourBoutonsTri() {
  const vueActive = getVueActive();

  // Pas de niveau pour les armes : tri masqué dans cette vue.
  const trisPersos = ["niveau"];
  if (vueActive === "weapons") {
    etatTri.tris = etatTri.tris.filter(t => !trisPersos.includes(t.cle));
  }

  document.querySelectorAll(".tri-btn").forEach(btn => {
    btn.hidden = trisPersos.includes(btn.dataset.tri) && vueActive === "weapons";
    majBoutonTri(btn, etatTri, vueActive);
  });

  // Vœux : personnages uniquement.
  document.getElementById("filtres-voeux").hidden = vueActive === "weapons";
}

// Carte recyclée si rien de ce qu'elle affiche n'a changé depuis le
// dernier rendu (cf. obtenirCarte, commun/cartes.js).
function obtenirCarteItem(grille, item, ...parametres) {
  const cle = JSON.stringify([item.id, item.nom, item.image, ...parametres]);
  return obtenirCarte(grille, cle, () => creerCarteItem(item, ...parametres));
}

// Redessine sans bouger la page (le navigateur du téléphone peut remonter
// quand l'élément touché disparaît du DOM).
function garderDefilement(redessiner) {
  const y = window.scrollY;
  redessiner();
  window.scrollTo(0, y);
  requestAnimationFrame(() => {
    if (window.scrollY !== y) window.scrollTo(0, y);
  });
}

function afficherCollection(personnages, armes, profil) {
  const liste = document.getElementById("liste-collection");

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

  const voeuxSelectionnes = vueActive === "characters"
    ? Array.from(document.querySelectorAll(".filtre-voeu-input:checked")).map(input => input.value)
    : [];

  const recherche = document.getElementById("recherche").value.trim().toLowerCase();
  // Même case à cocher, sens différent selon la box : "Possédés" en Full Box,
  // "Sélectionnés" dans les autres (où seuls les possédés sont déjà listés).
  const filtreCoche = document.getElementById("filtre-possedes").checked;
  const possedesSeulement = boxActive === "full" && filtreCoche;
  const selectionnesSeulement = boxActive !== "full" && filtreCoche;
  const labelFiltre = document.getElementById("filtre-possedes").closest("label");
  labelFiltre.querySelector("span").textContent = boxActive === "full" ? "Possédés" : "Sélectionnés";
  labelFiltre.title = boxActive === "full"
    ? "N'afficher que ce que je possède"
    : "N'afficher que ce qui est sélectionné dans cette box";

  mettreAJourBoutonsTri();

  const itemsFiltres = items.filter(item => {
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

    if (selectionnesSeulement && !itemSelectionne(item, vueActive, boxActive, collectionProfil)) {
      return false;
    }

    if (recherche && !String(item.nom || "").toLowerCase().includes(recherche)) {
      return false;
    }

    const filtreVoeuOK =
      voeuxSelectionnes.length === 0 || voeuxSelectionnes.includes(getVoeu(item));

    return filtreElementOK && filtreArmeOK && filtreRareteOK && filtreVoeuOK;
  });

  // Possédés / sélectionnés, étoiles, vœux : regroupés par rareté par défaut.
  const groupes = trierEtGrouper(itemsFiltres, etatTri, {
    vue: vueActive,
    valeurs: getValeursTri(vueActive, collectionProfil),
    elements: selectionElements,
    armes: selectionArmes,
    rareteParDefaut: filtreCoche || rareteSelectionnees.length > 0 || voeuxSelectionnes.length > 0
  });

  remplirGrilleGroupee(liste, groupes, item => {
    if (vueActive === "weapons") {
      const instances = getInstancesArme(item.id, collectionProfil);
      const instancesAffichees = selectionnesSeulement
        ? instances.filter(instanceId => instanceSelectionnee(instanceId, boxActive, collectionProfil))
        : instances.length > 0 ? instances : [item.id];
      const coinBasDroite = creerCoinBasDroite(item, vueActive, personnages, armes, profil);

      return instancesAffichees.map(instanceId => {
        const valeur = collectionProfil.full[instanceId] ?? -1;
        const selectionne = boxActive === "full"
          ? valeur >= 0
          : !!collectionProfil.selections[boxActive][instanceId];
        const estDuplicata = estInstanceDupliquee(instanceId);
        const peutDupliquer = boxActive === "full" && valeur >= 0;
        // Cœur des favoris : sur l'arme d'origine possédée (favori commun à
        // toutes ses copies).
        const favori = !estDuplicata && valeur >= 0 ? !!collectionProfil.favoris?.[item.id] : null;

        return obtenirCarteItem(liste, item, valeur, boxActive, selectionne, vueActive, instanceId, peutDupliquer, estDuplicata, null, coinBasDroite, favori);
      });
    }

    const valeur = collectionProfil.full[item.id] ?? -1;
    const selectionne = boxActive === "full"
      ? valeur >= 0
      : !!collectionProfil.selections[boxActive][item.id];

    const niveau = collectionProfil.niveaux?.[cleNiveau(item)] ?? null;
    const coinBasDroite = creerCoinBasDroite(item, vueActive, personnages, armes, profil);
    // Cœur des favoris : persos possédés uniquement.
    const favori = valeur >= 0 ? !!collectionProfil.favoris?.[item.id] : null;
    return obtenirCarteItem(liste, item, valeur, boxActive, selectionne, vueActive, null, false, false, niveau, coinBasDroite, favori);
  });

  mettreAJourBoutonEnregistrer(profil);
}

// ---- Bouton Enregistrer : grisé tant qu'il n'y a rien à enregistrer ----
// Compare ce qu'enregistre le bouton (collection, variantes, UID, théâtre)
// à l'état du dernier enregistrement.

let etatEnregistre = null;

function etatAEnregistrer(profil, uid, theatre) {
  return JSON.stringify([
    profil.characters, profil.weapons,
    profil.parametres?.voyageur ?? null, profil.parametres?.manekin ?? null,
    uid, theatre, profil.nomsBoxes ?? {}
  ]);
}

function etatFormulaire(profil) {
  return etatAEnregistrer(profil, document.getElementById("uid").value, document.getElementById("theatre").value);
}

// Bouton de la page et bouton du menu du compte.
function mettreAJourBoutonEnregistrer(profil) {
  const rienAEnregistrer = etatEnregistre !== null && etatFormulaire(profil) === etatEnregistre;
  document.querySelectorAll(".btn-enregistrer-fixe, #btn-enregistrer-compte").forEach(bouton => {
    bouton.disabled = rienAEnregistrer;
  });
}

function marquerEnregistre(profil, etat = etatFormulaire(profil)) {
  etatEnregistre = etat;
  mettreAJourBoutonEnregistrer(profil);
}

// Total de la box active : points des personnages + points des armes.
function mettreAJourTotalBox(personnages, armes, profil) {
  const boxActive = getBoxActive();
  const total = calculerTotalCollection(personnages, "characters", boxActive, profil) +
    calculerTotalCollection(armes, "weapons", boxActive, profil);

  const vueActive = getVueActive();
  document.getElementById("box-total-label").textContent = boxActive === "vitrine"
    ? `${nomBox(profil, boxActive)} (${Object.keys(profil[vueActive].selections.vitrine).length} / ${MAX_VITRINE[vueActive]} ${vueActive === "weapons" ? "armes" : "persos"})`
    : nomBox(profil, boxActive);
  document.getElementById("total-ppc").textContent = total;
}

function calculerTotalCollection(items, vueActive, boxActive, profil) {
  const collectionProfil = getCollectionProfil(profil, vueActive);
  const config = getConfigCollection(vueActive);

  let total = 0;
  // Groupe (Voyageur) : seul l'élément qui vaut le plus de points compte.
  const meilleurParGroupe = {};

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

      if (!inclus) return;

      const points = vueActive === "characters"
        ? pointsPersonnage(item, valeur, collectionProfil.niveaux?.[cleNiveau(item)])
        : Number(item[config.pointsField]?.[valeur] ?? 0);
      if (item.groupe) {
        meilleurParGroupe[item.groupe] = Math.max(meilleurParGroupe[item.groupe] ?? 0, points);
      } else {
        total += points;
      }
    });
  });

  return total + Object.values(meilleurParGroupe).reduce((somme, points) => somme + points, 0);
}

async function initialiserPage() {
  try {
    const [personnagesBase, armes] = await Promise.all([
      chargerPersonnages(),
      chargerArmes()
    ]);

    const profil = await chargerProfil();

    document.getElementById("uid").value = profil.uid || "";
    document.getElementById("theatre").value = profil.theatre || "";

    // Voyageur (Aether / Lumine) et Manekin (Manekin / Manekina) : seule la
    // variante choisie est affichée. Le tableau est mis à jour sur place
    // pour que tous les écouteurs voient le changement.
    profil.parametres ??= {};
    const personnages = appliquerVariantes(personnagesBase, profil.parametres);
    // Logo de la vue Personnages : tête du Voyageur choisi.
    const logoVuePersonnages = document.querySelector('.view-btn[data-view="characters"] img');
    const majLogoVuePersonnages = () => { logoVuePersonnages.src = `../DB/${getIconeVuePersonnages(profil.parametres)}`; };
    majLogoVuePersonnages();
    [["choix-voyageur", "voyageur"], ["choix-manekin", "manekin"]].forEach(([idSelect, cle]) => {
      const select = document.getElementById(idSelect);
      select.value = profil.parametres[cle] || select.options[0].value;
      select.addEventListener("change", () => {
        profil.parametres[cle] = select.value;
        personnages.splice(0, personnages.length, ...appliquerVariantes(personnagesBase, profil.parametres));
        majLogoVuePersonnages();
        afficherCollection(personnages, armes, profil);
      });
    });

    setBoxActive("full");
    setVueActive("characters");

    afficherCollection(personnages, armes, profil);
    mettreAJourTotalBox(personnages, armes, profil);

    document.querySelectorAll(".filtre-element, .filtre-arme, .filtre-rarete, .filtre-voeu-input, #filtre-possedes").forEach(input => {
      input.addEventListener("change", () => {
        if (input.classList.contains("filtre-element")) basculerSelection(selectionElements, input.value);
        if (input.classList.contains("filtre-arme")) basculerSelection(selectionArmes, input.value);
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
        cyclerTri(etatTri, btn.dataset.tri);
        afficherCollection(personnages, armes, profil);
      });
    });

    document.getElementById("btn-clear-filtres").addEventListener("click", () => {
      document.querySelectorAll(".barre-filtres input[type=checkbox]").forEach(input => {
        input.checked = false;
      });
      inputRecherche.value = "";
      viderTris(etatTri);
      selectionElements.clear();
      selectionArmes.clear();
      afficherCollection(personnages, armes, profil);
      mettreAJourTotalBox(personnages, armes, profil);
    });

    document.querySelectorAll(".box-btn").forEach(btn => {
      btn.addEventListener("click", event => {
        // Crayon de la box active : renommage.
        if (event.target.closest(".renommer-box") && btn.classList.contains("active")) {
          commencerRenommage(btn, profil, () => {
            mettreAJourTotalBox(personnages, armes, profil);
            mettreAJourBoutonEnregistrer(profil);
          });
          return;
        }
        setBoxActive(btn.dataset.box);
        afficherCollection(personnages, armes, profil);
        mettreAJourTotalBox(personnages, armes, profil);
      });
    });
    afficherNomsBoxes(profil);

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
        // Cœur : ajoute / retire des favoris (profil.characters.favoris ou
        // profil.weapons.favoris selon la vue).
        // Mis à jour sur place : reconstruire la grille remplaçait la carte
        // cliquée, ce qui ramenait en haut de la page sur téléphone. Grille
        // redessinée seulement si le tri "favoris" change l'ordre.
        const boutonFavori = event.target.closest(".favori-btn");
        if (boutonFavori) {
          const favoris = collectionProfil.favoris ??= {};
          const id = boutonFavori.dataset.id;
          if (favoris[id]) delete favoris[id];
          else favoris[id] = true;
          if (getSensTri(etatTri, "favoris")) {
            garderDefilement(() => afficherCollection(personnages, armes, profil));
          } else {
            boutonFavori.classList.toggle("actif", !!favoris[id]);
            boutonFavori.title = favoris[id] ? "Retirer des favoris" : "Ajouter aux favoris";
            mettreAJourBoutonEnregistrer(profil);
          }
          return;
        }

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
            // Niveau commun d'un groupe (Voyageur) : effacé quand plus aucun
            // de ses éléments n'est possédé.
            const personnage = items.find(p => p.id === id);
            const membres = personnage?.groupe ? membresGroupe(items, personnage.groupe) : [];
            if (collectionProfil.niveaux && !membres.some(p => (collectionProfil.full[p.id] ?? -1) >= 0)) {
              delete collectionProfil.niveaux[personnage ? cleNiveau(personnage) : id];
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

      const selection = collectionProfil.selections[boxActive];
      if (selection[id]) {
        delete selection[id];
      } else if (boxActive === "vitrine" && Object.keys(selection).length >= MAX_VITRINE[vueActive]) {
        afficherToast(`Vitrine pleine : ${MAX_VITRINE[vueActive]} ${vueActive === "weapons" ? "armes" : "personnages"} maximum. Retires-en un d'abord.`, "erreur");
        return;
      } else {
        selection[id] = true;
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

      // Le niveau change les points (bonus 95 / 100).
      afficherCollection(personnages, armes, profil);
      mettreAJourTotalBox(personnages, armes, profil);
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
      if (succes) {
        marquerEnregistre(profil);
        window.FondEcran?.memoriserTheatre(profil.theatre);
      }
    });

    ["uid", "theatre"].forEach(id => {
      const champ = document.getElementById(id);
      champ.addEventListener("input", () => mettreAJourBoutonEnregistrer(profil));
      champ.addEventListener("change", () => mettreAJourBoutonEnregistrer(profil));
    });

    initialiserReinitialisation(personnages, armes, profil);

    // UID / théâtre (menu du compte) : même enregistrement que le formulaire.
    document.getElementById("btn-enregistrer-compte").addEventListener("click", () => {
      document.getElementById("profil-form").requestSubmit();
      fermerMenuCompte();
    });

    initialiserGrille();
    initialiserParametres(profil);
    initialiserAutoBox(profil, personnages, armes);

    // Rien à enregistrer tant que rien n'a changé.
    marquerEnregistre(profil);
    // Médaille du bouton du compte (ici et sur les autres pages).
    window.FondEcran?.memoriserTheatre(profil.theatre);
  } catch (erreur) {
    console.error(erreur);
    alert("Erreur lors du chargement de la page.");
  }
}

// ---- Grille : toute la largeur, 1re et dernière colonnes alignées sur les
// bords (avec les filtres et le profil), cf. ajusterGrille (commun/cartes.js).

function initialiserGrille() {
  observerGrilles([document.getElementById("liste-collection")], { bordsAlignes: true, tailleDefaut: 132 });
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

// Choix attribués par défaut à tout le monde.
const PARAMETRES_DEFAUT = {
  banniere: "namecards/Namecard_Background_Default.webp",
  banniere2: "namecards/banners/Namecard_Banner_Default.webp",
  fond: "bg/autres/default_bg.webp"
};

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

  let ongletActif = "fond";
  let brouillon = null; // choix en cours, appliqués seulement à l'enregistrement

  const btnEnregistrer = document.getElementById("enregistrer-parametres");
  const btnAnnuler = document.getElementById("annuler-parametres");

  // Enregistrer / Annuler : grisés (contour vert / rouge) tant que rien n'a
  // changé, remplis dès qu'un choix diffère de ce qui est enregistré.
  function mettreAJourPied() {
    const modifie = Object.keys(PARAMETRES_DEFAUT).some(cle => brouillon[cle] !== profil.parametres[cle]);
    btnEnregistrer.classList.toggle("modifie", modifie);
    btnAnnuler.classList.toggle("modifie", modifie);
    btnEnregistrer.disabled = !modifie;
  }

  // Aperçu actif = ce qu'on modifie.
  function choisirOnglet(onglet) {
    ongletActif = onglet;
    document.querySelectorAll(".apercu-bloc").forEach(bloc => {
      bloc.classList.toggle("active", bloc.dataset.onglet === onglet);
    });
    inputRecherche.value = "";
    rendreChoix();
    conteneurChoix.scrollTop = 0;
    contenuModal.classList.remove("defilement");
  }

  // Téléphone : en faisant défiler les choix, seuls l'aperçu actif et la
  // recherche restent en haut (classe "defilement", cf. my_account.css) ;
  // tout en haut, les autres aperçus reviennent. Seulement si la liste
  // défile encore une fois les aperçus masqués (sinon ils clignoteraient).
  const contenuModal = modal.querySelector(".modal-parametres-contenu");
  const apercus = modal.querySelector(".apercu-parametres");
  conteneurChoix.addEventListener("scroll", () => {
    const haut = conteneurChoix.scrollTop;
    if (contenuModal.classList.contains("defilement")) {
      if (haut <= 4) contenuModal.classList.remove("defilement");
      return;
    }
    const hauteurMasquee = apercus.offsetHeight - (apercus.querySelector(".apercu-bloc.active")?.offsetHeight || 0);
    const marge = conteneurChoix.scrollHeight - conteneurChoix.clientHeight;
    if (haut > 24 && marge > hauteurMasquee + 24) contenuModal.classList.add("defilement");
  }, { passive: true });

  try {
    await chargerCosmetiques();
  } catch (erreur) {
    console.error(erreur);
  }

  // Choix manquant (ou ancien "aucun") : valeur par défaut.
  const choix = profil.parametres || {};
  profil.parametres = {
    ...choix,
    ...Object.fromEntries(
      Object.entries(PARAMETRES_DEFAUT).map(([cle, defaut]) => [cle, choix[cle] || defaut])
    )
  };
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
      mettreAJourPied();
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
    if (ongletActif === "fond") {
      // Fonds groupés par sous-dossier de DB/images/bg.
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

    // Bannière par défaut en premier.
    const liste = ongletActif === "banniere" ? cosmetiques.bannieres : cosmetiques.bannieres2;
    [...liste]
      .sort((a, b) => (b === PARAMETRES_DEFAUT[ongletActif]) - (a === PARAMETRES_DEFAUT[ongletActif]))
      .filter(chemin => !recherche || nomNamecard(chemin).toLowerCase().includes(recherche))
      .forEach(chemin => {
        grille.appendChild(creerChoix({ valeur: chemin, image: urlImage(chemin), titre: nomNamecard(chemin), classe }));
      });
    conteneurChoix.appendChild(grille);
  }

  function ouvrir() {
    brouillon = { ...profil.parametres };
    rendreApercus();
    choisirOnglet("fond");
    mettreAJourPied();
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

  document.querySelectorAll(".apercu-bloc").forEach(bloc => {
    bloc.addEventListener("click", () => choisirOnglet(bloc.dataset.onglet));
  });

  inputRecherche.addEventListener("input", rendreChoix);

  // Enregistre le profil entier (comme le bouton Enregistrer de la page).
  btnEnregistrer.addEventListener("click", async () => {
    profil.parametres = { ...brouillon };
    const succes = await sauvegarderProfil(profil);
    afficherToast(
      succes ? "Paramètres enregistrés" : "Erreur lors de l'enregistrement des paramètres",
      succes ? "succes" : "erreur"
    );
    if (succes) {
      marquerEnregistre(profil, etatAEnregistrer(profil, profil.uid || "", profil.theatre || ""));
      memoriserFondPourLeSite(profil.parametres.fond, profil.parametres.banniere2);
      fermer();
    }
  });
}

// ---- Réinitialiser la box (vue et box affichées) ----
// Full Box : plus rien n'est possédé dans la vue (persos ou armes, copies
// comprises), donc toutes les box de cette vue sont vidées aussi.
// Autre box : seule la sélection de cette box est vidée.

function reinitialiserBox(profil, vueActive, boxActive) {
  const collection = profil[vueActive];

  if (boxActive === "full") {
    collection.full = {};
    if (collection.niveaux) collection.niveaux = {};
    Object.keys(collection.selections).forEach(box => {
      collection.selections[box] = {};
    });
    return;
  }

  collection.selections[boxActive] = {};
}

function initialiserReinitialisation(personnages, armes, profil) {
  const modal = document.getElementById("modal-reinitialiser");
  const texte = document.getElementById("reinitialiser-texte");

  function fermer() {
    modal.classList.remove("active");
  }

  document.getElementById("btn-reinitialiser").addEventListener("click", () => {
    const vueActive = getVueActive();
    const boxActive = getBoxActive();
    const armes = vueActive === "weapons";
    const quoi = armes ? "armes" : "personnages";
    const tous = armes ? "Toutes les armes" : "Tous les personnages";
    const retires = armes ? "retirées (non possédées)" : "retirés (non possédés)";
    const libelleBox = nomBox(profil, boxActive);

    texte.textContent = boxActive === "full"
      ? `${tous} de ta Full Box seront ${retires}, et donc aussi de toutes tes autres box.`
      : `${tous} de la box « ${libelleBox} » seront ${retires.split(" ")[0]} de cette box.`;
    document.getElementById("reinitialiser-titre").textContent = `Réinitialiser « ${libelleBox} » (${quoi}) ?`;
    modal.classList.add("active");
  });

  document.getElementById("reinitialiser-confirmer").addEventListener("click", () => {
    reinitialiserBox(profil, getVueActive(), getBoxActive());
    afficherCollection(personnages, armes, profil);
    mettreAJourTotalBox(personnages, armes, profil);
    fermer();
    afficherToast("Box réinitialisée : clique sur Enregistrer pour confirmer");
  });

  document.getElementById("reinitialiser-annuler").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
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