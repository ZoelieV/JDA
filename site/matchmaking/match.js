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

const configCollections = {
  characters: {
    pointsField: "PPC",
    labels: ["C0", "C1", "C2", "C3", "C4", "C5", "C6"]
  },
  weapons: {
    pointsField: "PPW",
    labels: ["R1", "R2", "R3", "R4", "R5"]
  }
};

const POLL_INTERVAL_MS = 2500;

let vueActive = "characters";
let boxActive = "full";

let roomId = null;
let personnagesData = [];
let armesData = [];
let intervalPolling = null;

// Données des 2 joueurs : { discordId, nom, avatar, data } ou null si pas encore présent
let joueur1 = null;
let joueur2 = null;

function getRoomIdDepuisUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("room");
}

async function chargerPersonnages() {
  const reponse = await fetch("../DB/characters.json");
  if (!reponse.ok) throw new Error("Impossible de charger les personnages.");
  return await reponse.json();
}

async function chargerArmes() {
  const reponse = await fetch("../DB/weapons.json");
  if (!reponse.ok) throw new Error("Impossible de charger les armes.");
  return await reponse.json();
}

async function rejoindreOuConsulterRoom(id) {
  const reponse = await fetch(`/api/rooms/${id}`, {
    method: "POST",
    credentials: "include"
  });

  if (reponse.status === 401) {
    throw new Error("Tu dois être connecté avec Discord.");
  }

  if (reponse.status === 404) {
    throw new Error("Cette room n'existe pas.");
  }

  if (reponse.status === 403) {
    // Room déjà complète et tu n'en fais pas partie : on regarde juste l'état
    const consult = await fetch(`/api/rooms/${id}`, { credentials: "include" });
    if (!consult.ok) throw new Error("Impossible de consulter la room.");
    return await consult.json();
  }

  if (!reponse.ok) {
    throw new Error("Erreur en accédant à la room.");
  }

  return await reponse.json();
}

async function chargerCompte(discordId) {
  const reponse = await fetch(`/api/accounts/${discordId}`);
  if (!reponse.ok) throw new Error("Impossible de charger ce compte.");
  return await reponse.json();
}

function getFondRarete(rarete) {
  const valeur = String(rarete);
  if (valeur === "5") return "../DB/images/others/bg_5_star.webp";
  if (valeur === "3") return "../DB/images/others/bg_3_star.webp";
  return "../DB/images/others/bg_4_star.webp";
}

function getIconeItem(item, vue) {
  if (vue === "characters") return iconesElements[item.element] || "";
  return iconesTypesArmes[item.type] || "";
}

function getLabelConstellation(valeur, vue) {
  if (valeur < 0) return "";
  return configCollections[vue].labels[valeur];
}

function creerCarteItem(item, valeur, config) {
  const card = document.createElement("div");
  card.className = "character-card";

  const fond = getFondRarete(item.rarete);
  const icone = getIconeItem(item, vueActive);

  card.innerHTML = `
    <div class="character-visuel" style="background-image: url('${fond}');">
      <img src="../DB/${item.image}" alt="${item.nom}">
      ${icone ? `<img class="character-icone-type" src="${icone}" alt="">` : ""}
      <div class="character-ppc-badge">${item[config.pointsField]?.[valeur] ?? ""}</div>
    </div>
    <div class="character-name">${item.nom}</div>
    <div class="character-level">${getLabelConstellation(valeur, vueActive)}</div>
  `;

  return card;
}

function rendreEnteteJoueur(containerId, joueur) {
  const container = document.getElementById(containerId);

  if (!joueur) {
    container.innerHTML = `<span class="vide">En attente…</span>`;
    return;
  }

  container.innerHTML = `
    <img src="${joueur.avatar || ""}" alt="${joueur.nom}">
    <span class="nom-joueur">${joueur.nom}</span>
  `;
}

function rendreBoxJoueur(containerId, joueur) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!joueur) {
    return;
  }

  const config = configCollections[vueActive];
  const items = vueActive === "characters" ? personnagesData : armesData;
  const collectionProfil = joueur.data?.[vueActive] || { full: {}, selections: {} };

  items.forEach(item => {
    const valeur = collectionProfil.full?.[item.id] ?? -1;

    if (valeur < 0) {
      return;
    }

    if (boxActive === "stuff" && !collectionProfil.selections?.stuff?.[item.id]) {
      return;
    }

    container.appendChild(creerCarteItem(item, valeur, config));
  });
}

function rendreTout() {
  rendreEnteteJoueur("entete-joueur1", joueur1);
  rendreEnteteJoueur("entete-joueur2", joueur2);
  rendreBoxJoueur("box-joueur1", joueur1);
  rendreBoxJoueur("box-joueur2", joueur2);

  const attente = document.getElementById("etat-attente");
  attente.classList.toggle("cache", !!(joueur1 && joueur2));
}

async function chargerJoueurDepuisId(discordId) {
  if (!discordId) return null;

  const compte = await chargerCompte(discordId);
  const nom = compte.discord_global_name || compte.discord_username || "Utilisateur inconnu";

  return {
    discordId: compte.discord_id,
    nom,
    avatar: compte.discord_avatar_url,
    data: compte.data
  };
}

async function rafraichirEtatRoom() {
  const room = await rejoindreOuConsulterRoom(roomId);

  const [j1, j2] = await Promise.all([
    chargerJoueurDepuisId(room.player1_discord_id),
    chargerJoueurDepuisId(room.player2_discord_id)
  ]);

  joueur1 = j1;
  joueur2 = j2;

  rendreTout();

  // Une fois les 2 joueurs présents, plus besoin de continuer le polling
  if (joueur1 && joueur2 && intervalPolling) {
    clearInterval(intervalPolling);
    intervalPolling = null;
  }
}

function initialiserControles() {
  document.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      vueActive = btn.dataset.view;
      document.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b === btn));
      rendreBoxJoueur("box-joueur1", joueur1);
      rendreBoxJoueur("box-joueur2", joueur2);
    });
  });

  document.querySelectorAll(".box-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      boxActive = btn.dataset.box;
      document.querySelectorAll(".box-btn").forEach(b => b.classList.toggle("active", b === btn));
      rendreBoxJoueur("box-joueur1", joueur1);
      rendreBoxJoueur("box-joueur2", joueur2);
    });
  });
}

async function demarrer() {
  try {
    roomId = getRoomIdDepuisUrl();

    if (!roomId) {
      alert("Aucune room spécifiée dans le lien.");
      return;
    }

    [personnagesData, armesData] = await Promise.all([
      chargerPersonnages(),
      chargerArmes()
    ]);

    initialiserControles();

    await rafraichirEtatRoom();

    if (!(joueur1 && joueur2)) {
      intervalPolling = setInterval(rafraichirEtatRoom, POLL_INTERVAL_MS);
    }
  } catch (error) {
    console.error(error);
    alert(error.message || "Erreur lors du chargement du match.");
  }
}

demarrer();