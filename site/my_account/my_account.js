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
    window.location.href = "/api/auth/logout";
  });

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

function getIconeItem(item, vueActive) {
  if (vueActive === "characters") {
    return iconesElements[item.element] || "";
  }

  return iconesTypesArmes[item.type] || "";
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

function creerCarteItem(item, valeur = -1, boxActive = "full", selectionne = false, vueActive = "characters", instanceId = null, peutDupliquer = false, estDuplicata = false, niveau = null) {
  const config = getConfigCollection(vueActive);
  const idInstance = instanceId || item.id;
  const conteneur = document.createElement("div");
  conteneur.className = "carte-personnage";

  const fond = getFondRarete(item.rarete);
  const icone = getIconeItem(item, vueActive);
  const affichageNiveau = valeur < 0 ? "-" : config.labels[valeur];

  const classeSelectionnable = boxActive === "full" ? "" : "selectionnable";
  const classeSelectionnee = boxActive !== "full" && selectionne ? "selectionnee" : "";

  const opacite = boxActive === "full"
    ? (valeur < 0 ? "0.4" : "1")
    : (selectionne ? "1" : "0.45");

  const infoNiveau = boxActive === "full"
    ? ""
    : `<div class="info-constellation">${affichageNiveau}</div>`;

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

  conteneur.innerHTML = `
<div class="visuel-personnage ${classeSelectionnable} ${classeSelectionnee}" data-id="${idInstance}" style="background-image: url('${fond}'); opacity: ${opacite};">
<img class="image-personnage" src="../DB/${item.image}" alt="${item.nom}">
      ${icone ? `<img class="icone-element" src="${icone}" alt="">` : ""}
</div>

    <div class="nom-personnage">${item.nom} ${badgeCopie}</div>
    ${infoNiveau}
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

    if (boxActive !== "full" && !itemPossede(item, vueActive, collectionProfil)) {
      return false;
    }

    return filtreElementOK && filtreArmeOK && filtreRareteOK;
  });

  itemsFiltres.forEach(item => {
    if (vueActive === "weapons") {
      const instances = getInstancesArme(item.id, collectionProfil);
      const instancesAffichees = instances.length > 0 ? instances : [item.id];

      instancesAffichees.forEach(instanceId => {
        const valeur = collectionProfil.full[instanceId] ?? -1;
        const selectionne = boxActive === "full"
          ? valeur >= 0
          : !!collectionProfil.selections[boxActive][instanceId];
        const estDuplicata = estInstanceDupliquee(instanceId);
        const peutDupliquer = boxActive === "full" && valeur >= 0;

        const carte = creerCarteItem(item, valeur, boxActive, selectionne, vueActive, instanceId, peutDupliquer, estDuplicata);
        liste.appendChild(carte);
      });
      return;
    }

    const valeur = collectionProfil.full[item.id] ?? -1;
    const selectionne = boxActive === "full"
      ? valeur >= 0
      : !!collectionProfil.selections[boxActive][item.id];

    const niveau = collectionProfil.niveaux?.[item.id] ?? null;
    const carte = creerCarteItem(item, valeur, boxActive, selectionne, vueActive, null, false, false, niveau);
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

    document.querySelectorAll(".filtre-element, .filtre-arme, .filtre-rarete").forEach(input => {
      input.addEventListener("change", () => {
        afficherCollection(personnages, armes, profil);
        mettreAJourTotalBox(personnages, armes, profil);
      });
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
  } catch (erreur) {
    console.error(erreur);
    alert("Erreur lors du chargement de la page.");
  }
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