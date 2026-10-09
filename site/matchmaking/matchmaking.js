// Créer un match : room privée (lien partagé, théâtre au choix),
// matchmaking ou classé (adversaire trouvé automatiquement dans le même
// mode, classique ou mêlée générale ; cf. api/_lib/matchmaking.js), tous
// via api/rooms. On arrive ensuite sur la page du match (attente de
// l'adversaire).

async function creerMatch(corps) {
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps)
    });

    if (reponse.status === 401) {
      alert("Tu dois être connecté avec Discord pour créer un match.");
      return;
    }

    // Mode classique / auto sans théâtre renseigné (message du serveur).
    // Refus avec un message du serveur (mode classique sans théâtre, box
    // d'entraînement trop petite...).
    if (reponse.status === 409 || reponse.status === 400) {
      const { error } = await reponse.json().catch(() => ({}));
      alert(error || "Impossible de lancer ce mode.");
      return;
    }

    // Match privé : une room par minute au maximum (message du serveur).
    if (reponse.status === 429) {
      const { error } = await reponse.json().catch(() => ({}));
      alert(error || "Trop de rooms créées : réessaie dans une minute.");
      return;
    }

    if (!reponse.ok) {
      const { error } = await reponse.json().catch(() => ({}));
      alert(error || "Échec de la création du match.");
      return;
    }

    const data = await reponse.json();

    // Mode en équipe / Random world boss : page de leur lobby.
    window.location.href = `${data.equipe ? "equipe" : data.world_boss ? "world_boss" : "match"}.html?room=${data.room_id}`;
  } catch (error) {
    console.error(error);
    alert("Erreur lors de la création du match.");
  }
}

// Options d'un menu de choix du boss : légendes locales regroupées à part
// (celles déjà tuées aujourd'hui sont refusées par le serveur).
// World boss : jamais dans les drafts (mode Random world boss seulement).
function remplirSelectBoss(select, toutes) {
  const liste = toutes.filter(b => b.type !== "world_boss");
  const groupes = [
    ["Boss", liste.filter(b => !estLegendeLocale(b))],
    ["Légendes locales", liste.filter(estLegendeLocale)]
  ];
  groupes.filter(([, boss]) => boss.length).forEach(([titre, boss]) => {
    const groupe = document.createElement("optgroup");
    groupe.label = titre;
    boss.forEach(b => {
      const option = document.createElement("option");
      option.value = b.id;
      option.textContent = b.type === "legende_locale_jour" ? `${b.nom} (1 fois par jour)` : b.nom;
      groupe.appendChild(option);
    });
    select.appendChild(groupe);
  });
}

const BOSS_HORS_COOP = ["ichcahuipilli_ll", "potapo_ll", "defi_mer_dantan"];

// Room privée / en équipe : liste des boss, remplie à la 1re ouverture.
const selectsBossCharges = new Set();
async function remplirBossRoom(idSelect = "room-boss") {
  if (selectsBossCharges.has(idSelect)) return;
  selectsBossCharges.add(idSelect);
  try {
    const [tous, points] = await Promise.all([chargerBoss(), chargerPointsAdmin()]);
    // Boss du carnage désactivés par les admins : seulement en entraînement
    // (cf. bossCarnageExclus, api/_lib/boss.js).
    const liste = points.carnage_desactive === true ? tous.filter(b => b.type !== "carnage_boss") : tous;
    // En équipe : sans les boss pas faisables en co-op (cf. BOSS_HORS_COOP,
    // api/_lib/equipe.js).
    remplirSelectBoss(document.getElementById(idSelect), idSelect === "equipe-boss" ? liste.filter(b => !BOSS_HORS_COOP.includes(b.id)) : liste);
  } catch (erreur) {
    console.error(erreur);
    selectsBossCharges.delete(idSelect);
  }
}

// Mode choisi : room privée (mode de théâtre au choix) ou recherche
// (matchmaking / classé : classique ou mêlée générale).
document.querySelectorAll(".mode-match").forEach(bouton => {
  bouton.addEventListener("click", () => {
    const type = bouton.closest(".modes-match").dataset.type;
    const mode = bouton.dataset.mode;
    if (type === "world_boss") {
      creerMatch({ type });
      return;
    }
    if (type === "equipe") {
      creerMatch({
        type,
        taille: Number(bouton.dataset.taille),
        formation: document.getElementById("equipe-formation").value,
        boss_id: document.getElementById("equipe-boss").value || null
      });
      return;
    }
    creerMatch(type === "prive"
      ? { mode, boss_id: document.getElementById("room-boss").value || null, premier: document.getElementById("room-premier").value }
      : { type, mode });
  });
});

// ---- Mode entraînement ----
// Configuration : draft (classée ou non, mode de théâtre), ta box et la box
// adverse (une des tiennes ; full ou stuff d'un autre joueur ; ou une box
// personnalisée cochée dans la full box d'un joueur), boss et J1.
// Administrateurs et mini admins : box fictives en plus des joueurs (full
// ou personnalisée, cf. api/_lib/boxes_fictives.js).
const MIN_PERSOS_BOX = 16; // cf. NB_PERSOS_MIN_BOX, api/_lib/draft.js
const LIBELLES_BOX = { full: "Full box", stuff: "Stuff", opti1: "Opti 1", opti2: "Opti 2", opti3: "Opti 3", opti4: "Opti 4", opti5: "Opti 5", custom: "Personnalisée" };

const entrainement = {
  pret: false,
  moi: null, // mon compte { id }
  comptes: [], // tous les joueurs { discord_id, nom }
  fictives: [], // box fictives (administrateurs) { id, nom }
  profils: new Map(), // discord_id -> données du profil (box)
  personnages: [],
  cotes: {
    moi: { proprietaire: null, box: "full", persos: new Set() },
    adverse: { proprietaire: null, box: "full", persos: new Set() }
  }
};

async function chargerJSONApi(url) {
  const reponse = await fetch(url, { credentials: "include" });
  if (!reponse.ok) throw new Error("Chargement impossible.");
  return reponse.json();
}

async function profilJoueur(discordId) {
  if (!entrainement.profils.has(discordId)) {
    const compte = await chargerJSONApi(`/api/accounts/${encodeURIComponent(discordId)}`);
    migrerCollectionPersos(compte.data?.characters);
    entrainement.profils.set(discordId, compte.data || {});
  }
  return entrainement.profils.get(discordId);
}

function personnagesPossedes(profil) {
  const full = profil?.characters?.full || {};
  return entrainement.personnages.filter(p => (full[p.id] ?? -1) >= 0);
}

// Sélecteur d'un côté : joueur, box, et persos cochés si personnalisée.
async function rendreSelecteurBox(cote) {
  const etat = entrainement.cotes[cote];
  const zone = document.querySelector(`.selecteur-box[data-cote="${cote}"]`);
  const estMoi = etat.proprietaire === entrainement.moi.id;
  const profil = await profilJoueur(etat.proprietaire);
  const nomsBoxes = estMoi ? profil.nomsBoxes || {} : {};
  // Box d'un autre joueur : full ou stuff (ses box opti restent privées) ;
  // box fictive : full seulement.
  const fictive = etat.proprietaire.startsWith("fictif_");
  const boxes = estMoi ? ["full", "stuff", "opti1", "opti2", "opti3", "opti4", "opti5", "custom"]
    : fictive ? ["full", "custom"] : ["full", "stuff", "custom"];
  if (!boxes.includes(etat.box)) etat.box = "full";

  zone.innerHTML = `
    <label>Joueur <select class="ent-joueur"></select></label>
    <div class="choix-boutons ent-box">
      ${boxes.map(box => `<button type="button" class="choix-btn${etat.box === box ? " active" : ""}" data-valeur="${box}"></button>`).join("")}
    </div>
    <div class="ent-perso-zone${etat.box === "custom" ? "" : " cache"}">
      <div class="ligne-entrainement">
        <span class="ent-compteur"></span>
        <button type="button" class="choix-btn ent-tout">Tout cocher</button>
        <button type="button" class="choix-btn ent-rien">Tout décocher</button>
      </div>
      <div class="ent-persos"></div>
    </div>
  `;

  // Libellés en texte (noms de box choisis par le joueur).
  zone.querySelectorAll(".ent-box .choix-btn").forEach(btn => {
    const box = btn.dataset.valeur;
    btn.textContent = typeof nomsBoxes[box] === "string" && nomsBoxes[box] ? nomsBoxes[box] : LIBELLES_BOX[box];
  });

  const select = zone.querySelector(".ent-joueur");
  entrainement.comptes.forEach(compte => {
    const option = document.createElement("option");
    option.value = compte.discord_id;
    option.textContent = compte.discord_id === entrainement.moi.id ? `${compte.nom} (moi)` : compte.nom;
    option.selected = compte.discord_id === etat.proprietaire;
    select.appendChild(option);
  });
  if (entrainement.fictives.length) {
    const groupe = document.createElement("optgroup");
    groupe.label = "Box fictives";
    entrainement.fictives.forEach(box => {
      const option = document.createElement("option");
      option.value = box.id;
      option.textContent = box.nom;
      option.selected = box.id === etat.proprietaire;
      groupe.appendChild(option);
    });
    select.appendChild(groupe);
  }
  select.addEventListener("change", () => {
    etat.proprietaire = select.value;
    etat.persos = new Set();
    rendreSelecteurBox(cote);
  });

  zone.querySelectorAll(".ent-box .choix-btn").forEach(btn => btn.addEventListener("click", () => {
    etat.box = btn.dataset.valeur;
    rendreSelecteurBox(cote);
  }));

  if (etat.box !== "custom") return;
  const possedes = personnagesPossedes(profil);
  const grille = zone.querySelector(".ent-persos");
  const compteur = zone.querySelector(".ent-compteur");
  const majCompteur = () => {
    // Voyageur : un seul perso quel que soit le nombre d'éléments cochés.
    const nb = new Set(possedes.filter(p => etat.persos.has(p.id)).map(p => p.groupe || p.id)).size;
    compteur.textContent = `${nb} personnage${nb > 1 ? "s" : ""} (${MIN_PERSOS_BOX} minimum)`;
    compteur.classList.toggle("insuffisant", nb < MIN_PERSOS_BOX);
  };
  grille.replaceChildren(...possedes.map(perso => {
    const carte = document.createElement("button");
    carte.type = "button";
    carte.className = `ent-perso ${classeFondRarete(perso.rarete)}${etat.persos.has(perso.id) ? " coche" : ""}`;
    // Voyageur (un par élément) : élément en bas à gauche pour les distinguer.
    const element = perso.groupe ? perso.element : null;
    carte.title = perso.nom; // déjà avec l'élément ("Voyageur Geo")
    carte.innerHTML = `<img src="../DB/${perso.image}" alt="" loading="lazy">` +
      (element ? `<img class="ent-element" src="../DB/images/others/${element}.webp" alt="${element}">` : "");
    carte.addEventListener("click", () => {
      if (etat.persos.has(perso.id)) etat.persos.delete(perso.id);
      else etat.persos.add(perso.id);
      carte.classList.toggle("coche");
      majCompteur();
    });
    return carte;
  }));
  zone.querySelector(".ent-tout").addEventListener("click", () => {
    possedes.forEach(p => etat.persos.add(p.id));
    rendreSelecteurBox(cote);
  });
  zone.querySelector(".ent-rien").addEventListener("click", () => {
    etat.persos.clear();
    rendreSelecteurBox(cote);
  });
  majCompteur();
}

async function initialiserEntrainement() {
  const reponseMoi = await fetch("/api/auth/me", { credentials: "include" });
  if (!reponseMoi.ok) {
    alert("Tu dois être connecté avec Discord pour t'entraîner.");
    return false;
  }
  entrainement.moi = (await reponseMoi.json()).user;
  const [comptes, personnages, boss] = await Promise.all([chargerJSONApi("/api/accounts"), chargerPersonnages(), chargerBoss()]);
  const nom = c => c.discord_global_name || c.discord_username || "Joueur";
  entrainement.comptes = comptes
    .map(c => ({ discord_id: c.discord_id, nom: nom(c) }))
    .sort((a, b) => (b.discord_id === entrainement.moi.id) - (a.discord_id === entrainement.moi.id) || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  entrainement.personnages = personnages;
  if (entrainement.moi.admin || entrainement.moi.mini_admin) {
    entrainement.fictives = await chargerJSONApi("/api/accounts/boxes_fictives").catch(erreur => {
      console.error(erreur);
      return [];
    });
  }
  entrainement.cotes.moi.proprietaire = entrainement.moi.id;
  entrainement.cotes.adverse.proprietaire = entrainement.moi.id;

  remplirSelectBoss(document.getElementById("ent-boss"), boss);

  document.querySelectorAll("#ent-mode .choix-btn").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll("#ent-mode .choix-btn").forEach(b => b.classList.toggle("active", b === btn));
  }));
  document.getElementById("lancer-entrainement").addEventListener("click", lancerEntrainement);

  await Promise.all([rendreSelecteurBox("moi"), rendreSelecteurBox("adverse")]);
  entrainement.pret = true;
  return true;
}

function lancerEntrainement() {
  const cote = c => {
    const etat = entrainement.cotes[c];
    return { proprietaire: etat.proprietaire, box: etat.box, ...(etat.box === "custom" ? { persos: [...etat.persos] } : {}) };
  };
  creerMatch({
    type: "entrainement",
    config: {
      classe: document.getElementById("ent-classe").checked,
      mode: document.querySelector("#ent-mode .choix-btn.active")?.dataset.valeur || "auto",
      boxes: { moi: cote("moi"), adverse: cote("adverse") },
      boss_id: document.getElementById("ent-boss").value || null,
      premier: document.getElementById("ent-premier").value
    }
  });
}

// ---- Cartes des modes : cliquer une carte affiche ses détails dans le
// rectangle en dessous (un seul ouvert : celui d'une autre carte se ferme),
// recliquer la même le referme. Préparé à la 1re ouverture : liste des boss
// (room), comptes et box (entraînement). ----
const PREPARATIONS = {
  // Rectangle ouvert tout de suite, liste des boss remplie en arrière-plan.
  room: async () => { remplirBossRoom(); return true; },
  equipe: async () => { remplirBossRoom("equipe-boss"); return true; },
  entrainement: async () => {
    if (entrainement.pret) return true;
    try {
      return await initialiserEntrainement();
    } catch (erreur) {
      console.error(erreur);
      alert("Impossible de charger le mode entraînement.");
      return false;
    }
  }
};

// Dernier clic : une préparation encore en cours n'ouvre rien si une autre
// carte a été cliquée entre-temps.
let dernierClic = 0;

async function choisirCarte(carte) {
  const clic = ++dernierClic;
  const nom = carte.dataset.detail;
  const dejaOuvert = carte.getAttribute("aria-expanded") === "true";
  document.querySelectorAll(".carte-match").forEach(c => {
    c.setAttribute("aria-expanded", "false");
    c.classList.remove("selectionnee");
  });
  document.querySelectorAll(".detail-match").forEach(d => d.classList.add("cache"));
  if (dejaOuvert) return;

  if (PREPARATIONS[nom]) {
    carte.disabled = true;
    const pret = await PREPARATIONS[nom]().finally(() => { carte.disabled = false; });
    if (!pret || clic !== dernierClic) return;
  }
  carte.setAttribute("aria-expanded", "true");
  carte.classList.add("selectionnee");
  const detail = document.querySelector(`.detail-match[data-detail="${nom}"]`);
  detail.classList.remove("cache");
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.querySelectorAll(".carte-match").forEach(carte => {
  carte.addEventListener("click", () => choisirCarte(carte));
});
