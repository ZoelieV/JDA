const iconesElements = {
  pyro: "../DB/images/others/pyro.webp",
  hydro: "../DB/images/others/hydro.webp",
  anemo: "../DB/images/others/anemo.webp",
  electro: "../DB/images/others/electro.webp",
  cryo: "../DB/images/others/cryo.webp",
  dendro: "../DB/images/others/dendro.webp",
  geo: "../DB/images/others/geo.webp"
};

const BOX_LABELS = {
  full: "Full box",
  stuff: "Stuff",
  opti1: "Opti 1",
  opti2: "Opti 2",
  opti3: "Opti 3",
  opti4: "Opti 4",
  opti5: "Opti 5"
};

// Copie de la séquence fixe du backend (_lib/draft.js) : c'est de la pure
// donnée, dupliquée ici pour pouvoir afficher "à qui le tour" sans faire
// d'aller-retour serveur. Si la séquence change côté back, la changer ici
// aussi.
const BLOCS_SEQUENCE = [
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "pick", nombre: 1 },
  { joueur: "j2", type: "pick", nombre: 2 },
  { joueur: "j1", type: "pick", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "pick", nombre: 1 },
  { joueur: "j1", type: "pick", nombre: 2 },
  { joueur: "j2", type: "pick", nombre: 1 }
];
const SEQUENCE_FIXE = BLOCS_SEQUENCE.flatMap(bloc =>
  Array.from({ length: bloc.nombre }, () => ({ joueur: bloc.joueur, type: bloc.type }))
);

const POLL_INTERVAL_MS = 2500;

let roomId = null;
let moiDiscordId = null;
let monRole = null; // "j1" | "j2"
let personnagesData = [];
let bossData = [];
let draft = null;
let intervalPolling = null;

// Données des 2 joueurs : { discordId, nom, avatar, data } ou null
let joueur1 = null;
let joueur2 = null;

function getRoomIdDepuisUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("room");
}

function getAutreRole(role) {
  return role === "j1" ? "j2" : "j1";
}

// ---- Chargements ----

async function chargerPersonnages() {
  const reponse = await fetch("../DB/characters.json");
  if (!reponse.ok) throw new Error("Impossible de charger les personnages.");
  return await reponse.json();
}

async function chargerBoss() {
  const reponse = await fetch("../DB/boss.json");
  if (!reponse.ok) throw new Error("Impossible de charger les boss.");
  return await reponse.json();
}

async function chargerSessionUtilisateur() {
  const reponse = await fetch("/api/auth/me", { credentials: "include" });
  if (!reponse.ok) return null;
  const data = await reponse.json();
  return data.authenticated ? data.user : null;
}

async function rejoindreOuConsulterRoom(id) {
  const reponse = await fetch(`/api/rooms/${id}`, {
    method: "POST",
    credentials: "include"
  });

  if (reponse.status === 401) throw new Error("Tu dois être connecté avec Discord.");
  if (reponse.status === 404) throw new Error("Cette room n'existe pas.");

  if (reponse.status === 403) {
    const consult = await fetch(`/api/rooms/${id}`, { credentials: "include" });
    if (!consult.ok) throw new Error("Impossible de consulter la room.");
    return await consult.json();
  }

  if (!reponse.ok) throw new Error("Erreur en accédant à la room.");
  return await reponse.json();
}

async function chargerCompte(discordId) {
  const reponse = await fetch(`/api/accounts/${discordId}`);
  if (!reponse.ok) throw new Error("Impossible de charger ce compte.");
  return await reponse.json();
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

async function chargerDraft() {
  const reponse = await fetch(`/api/rooms/${roomId}/draft`, { credentials: "include" });
  if (!reponse.ok) throw new Error("Impossible de charger l'état de la draft.");
  return await reponse.json();
}

// ---- Actions (POST) ----

async function envoyerAction(url, body) {
  const reponse = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });

  const data = await reponse.json().catch(() => ({}));

  if (!reponse.ok) {
    throw new Error(data.error || "Erreur lors de l'action.");
  }

  return data;
}

async function postBox(box) {
  const data = await envoyerAction(`/api/rooms/${roomId}/box`, { box });
  definirDraft(data.draft);
}

async function postReady(pret) {
  const data = await envoyerAction(`/api/rooms/${roomId}/ready`, { pret });
  definirDraft(data.draft);
}

async function postActionDraft(persoId) {
  const data = await envoyerAction(`/api/rooms/${roomId}/action`, { perso_id: persoId });
  definirDraft(data.draft);
}

async function postTemps(temps) {
  const data = await envoyerAction(`/api/rooms/${roomId}/temps`, { temps });
  definirDraft(data.draft);
}

async function postRejouer() {
  const data = await envoyerAction(`/api/rooms/${roomId}/rejouer`, {});
  definirDraft(data.draft);
}

function definirDraft(nouveauDraft) {
  draft = nouveauDraft;
  rendrePhase();
}

// ---- Helpers d'affichage personnages ----

function getPersonnageParId(id) {
  return personnagesData.find(p => p.id === id) || null;
}

function getFondRarete(rarete) {
  const valeur = String(rarete);
  if (valeur === "5") return "../DB/images/others/bg_5_star.webp";
  if (valeur === "3") return "../DB/images/others/bg_3_star.webp";
  return "../DB/images/others/bg_4_star.webp";
}

function creerCarteItem(personnage, { selectionnable = false, onClick = null } = {}) {
  const card = document.createElement("div");
  card.className = "character-card" + (selectionnable ? " selectionnable" : "");

  const fond = getFondRarete(personnage.rarete);
  const icone = iconesElements[personnage.element] || "";

  card.innerHTML = `
    <div class="character-visuel" style="background-image: url('${fond}');">
      <img src="../DB/${personnage.image}" alt="${personnage.nom}">
      ${icone ? `<img class="character-icone-type" src="${icone}" alt="">` : ""}
    </div>
    <div class="character-name">${personnage.nom}</div>
  `;

  if (selectionnable && onClick) {
    card.addEventListener("click", onClick);
  }

  return card;
}

function creerBanMini(personnage) {
  const el = document.createElement("div");
  el.className = "ban-mini";
  el.title = personnage.nom;
  el.innerHTML = `<img src="../DB/${personnage.image}" alt="${personnage.nom}">`;
  return el;
}

// ---- Rendu des entêtes joueurs (avatar + pastille prêt) ----

function rendreEntetesJoueurs() {
  [["entete-joueur1", joueur1, "j1"], ["entete-joueur2", joueur2, "j2"]].forEach(([containerId, joueur, role]) => {
    const container = document.getElementById(containerId);
    if (!joueur) {
      container.innerHTML = `<span class="vide">En attente…</span>`;
      return;
    }

    const pret = draft && draft[`pret_${role}`];
    const afficherPastille = draft && draft.phase === "choix_box";

    container.innerHTML = `
      <img src="${joueur.avatar || ""}" alt="${joueur.nom}">
      <span class="nom-joueur">${joueur.nom}</span>
      ${afficherPastille ? `<span class="pastille ${pret ? "pret" : ""}"></span>` : ""}
    `;
  });
}

// ---- Phase 1 : choix de box ----

function rendreChoixBox() {
  const autre = getAutreRole(monRole);

  const conteneurMoi = document.getElementById("box-select-moi");
  conteneurMoi.innerHTML = "";
  Object.entries(BOX_LABELS).forEach(([valeur, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "box-btn" + (draft[`box_${monRole}`] === valeur ? " active" : "");
    btn.textContent = label;
    btn.addEventListener("click", () => postBox(valeur).catch(err => alert(err.message)));
    conteneurMoi.appendChild(btn);
  });

  const conteneurAdv = document.getElementById("box-select-adversaire");
  conteneurAdv.innerHTML = "";
  Object.entries(BOX_LABELS).forEach(([valeur, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "box-btn" + (draft[`box_${autre}`] === valeur ? " active" : "");
    btn.textContent = label;
    btn.disabled = true;
    conteneurAdv.appendChild(btn);
  });

  document.getElementById("statut-pret-moi").textContent = draft[`pret_${monRole}`]
    ? "Tu es prêt."
    : "Choisis ta box puis clique sur \"Je suis prêt\".";

  document.getElementById("statut-pret-adversaire").textContent = draft[`pret_${autre}`]
    ? "L'adversaire est prêt."
    : "L'adversaire n'est pas encore prêt.";

  const btnPret = document.getElementById("btn-pret");
  const dejaPret = draft[`pret_${monRole}`];
  btnPret.textContent = dejaPret ? "Annuler (je ne suis plus prêt)" : "Je suis prêt";
  btnPret.classList.toggle("active", dejaPret);
  btnPret.disabled = !draft[`box_${monRole}`];
  btnPret.onclick = () => postReady(!dejaPret).catch(err => alert(err.message));
}

// ---- Phase 2 : bans bonus d'équilibrage ----

function rendreBansBonus() {
  const restant = draft.bans_bonus_total - draft.bans_bonus_faits;
  const nomJoueurConcerne = draft.bans_bonus_joueur === "j1" ? joueur1.nom : joueur2.nom;
  const ecart = Math.abs((draft.points_j1 ?? 0) - (draft.points_j2 ?? 0));

  const message = document.getElementById("message-equilibrage");

  if (draft.bans_bonus_joueur === monRole) {
    message.textContent = `Écart de ${ecart} pts entre les 2 box : tu dois bannir ${restant} personnage(s) de plus avant le tirage du boss.`;
  } else {
    message.textContent = `Écart de ${ecart} pts entre les 2 box : ${nomJoueurConcerne} doit bannir ${restant} personnage(s) de plus. En attente…`;
  }

  const grille = document.getElementById("grille-bans-bonus");
  grille.innerHTML = "";

  const cEstMonTour = draft.bans_bonus_joueur === monRole;

  draft.pool_disponible.forEach(id => {
    const personnage = getPersonnageParId(id);
    if (!personnage) return;

    grille.appendChild(
      creerCarteItem(personnage, {
        selectionnable: cEstMonTour,
        onClick: () => postActionDraft(id).catch(err => alert(err.message))
      })
    );
  });
}

// ---- Phase 3 : draft (boss + bans/picks) ----

function getProchaineActionLocale() {
  const action = SEQUENCE_FIXE[draft.sequence_index];
  return action || null;
}

function rendreSlotsEtBans(role) {
  const nomJoueur = role === "j1" ? joueur1.nom : joueur2.nom;

  const picks = draft.actions.filter(a => a.type === "pick" && a.joueur === role).map(a => a.perso_id);
  const bans = draft.actions.filter(a => a.type === "ban" && a.joueur === role).map(a => a.perso_id);

  const slotsContainer = document.getElementById(`slots-pick-${role}`);
  slotsContainer.innerHTML = `<h4>${nomJoueur}</h4>`;

  for (let i = 0; i < 4; i++) {
    const persoId = picks[i];
    const slot = document.createElement("div");

    if (persoId) {
      const personnage = getPersonnageParId(persoId);
      slot.className = "slot-pick";
      slot.innerHTML = `
        <img src="../DB/${personnage.image}" alt="${personnage.nom}">
        <span class="nom-slot">${personnage.nom}</span>
      `;
    } else {
      slot.className = "slot-pick vide";
      slot.textContent = "Vide";
    }

    slotsContainer.appendChild(slot);
  }

  const bansContainer = document.getElementById(`rangee-bans-${role}`);
  bansContainer.innerHTML = "";
  bans.forEach(persoId => {
    const personnage = getPersonnageParId(persoId);
    if (personnage) bansContainer.appendChild(creerBanMini(personnage));
  });
}

function rendreDraft() {
  const boss = bossData.find(b => b.id === draft.boss_id);
  const bossContainer = document.getElementById("boss-affiche");
  bossContainer.innerHTML = boss
    ? `<img src="../DB/${boss.image}" alt="${boss.nom}"><span>${boss.nom}</span>`
    : "";

  const prochaine = getProchaineActionLocale();
  const tourContainer = document.getElementById("tour-actuel");

  if (!prochaine) {
    tourContainer.textContent = "Draft terminée.";
  } else {
    const verbe = prochaine.type === "ban" ? "bannir" : "picker";
    if (prochaine.joueur === monRole) {
      tourContainer.textContent = `À toi de ${verbe} un personnage.`;
    } else {
      const nomAdversaire = prochaine.joueur === "j1" ? joueur1.nom : joueur2.nom;
      tourContainer.textContent = `En attente : ${nomAdversaire} doit ${verbe} un personnage.`;
    }
  }

  rendreSlotsEtBans("j1");
  rendreSlotsEtBans("j2");

  const grille = document.getElementById("grille-pool-draft");
  grille.innerHTML = "";

  const cEstMonTour = !!prochaine && prochaine.joueur === monRole;

  draft.pool_disponible.forEach(id => {
    const personnage = getPersonnageParId(id);
    if (!personnage) return;

    grille.appendChild(
      creerCarteItem(personnage, {
        selectionnable: cEstMonTour,
        onClick: () => postActionDraft(id).catch(err => alert(err.message))
      })
    );
  });
}

// ---- Phase 4 : saisie du temps ----

function rendreTemps() {
  const monTemps = draft[`temps_${monRole}`];
  const tempsAdversaire = draft[`temps_${getAutreRole(monRole)}`];

  const input = document.getElementById("input-temps");
  const btn = document.getElementById("btn-valider-temps");
  const etat = document.getElementById("etat-temps");

  if (monTemps) {
    input.value = monTemps.affiche;
    input.disabled = true;
    btn.disabled = true;
  } else {
    input.disabled = false;
    btn.disabled = false;
  }

  if (monTemps && !tempsAdversaire) {
    etat.textContent = "Temps enregistré. En attente du temps de l'adversaire…";
  } else if (!monTemps) {
    etat.textContent = "Entre ton temps au format mm:ss (ex : 7:32).";
  } else {
    etat.textContent = "";
  }

  btn.onclick = () => {
    const valeur = input.value.trim();
    if (!/^[0-9]{1,3}:[0-5][0-9]$/.test(valeur)) {
      alert("Format invalide. Utilise mm:ss, par exemple 7:32.");
      return;
    }
    postTemps(valeur).catch(err => alert(err.message));
  };
}

// ---- Phase 5 : résultat ----

function rendreTermine() {
  const boss = bossData.find(b => b.id === draft.boss_id);
  const container = document.getElementById("resultat-final");

  let ligneVainqueur;
  if (draft.vainqueur === "egalite") {
    ligneVainqueur = `<span class="egalite">Égalité !</span>`;
  } else {
    const gagnant = draft.vainqueur === monRole ? "Tu as gagné !" : "Tu as perdu.";
    ligneVainqueur = `<span class="vainqueur">${gagnant}</span>`;
  }

  container.innerHTML = `
    <p>Boss : ${boss ? boss.nom : draft.boss_id}</p>
    <p>${joueur1.nom} : ${draft.temps_j1.affiche} — ${joueur2.nom} : ${draft.temps_j2.affiche}</p>
    <p>${ligneVainqueur}</p>
  `;

  document.getElementById("btn-rejouer").onclick = () => postRejouer().catch(err => alert(err.message));
}

// ---- Dispatch de phase ----

function rendrePhase() {
  rendreEntetesJoueurs();

  document.querySelectorAll(".phase").forEach(el => el.classList.add("cache"));

  const idsParPhase = {
    choix_box: "phase-choix-box",
    bans_bonus: "phase-bans-bonus",
    draft: "phase-draft",
    temps: "phase-temps",
    termine: "phase-termine"
  };

  const idAffiche = idsParPhase[draft.phase];
  if (!idAffiche) return;

  document.getElementById(idAffiche).classList.remove("cache");

  if (draft.phase === "choix_box") rendreChoixBox();
  else if (draft.phase === "bans_bonus") rendreBansBonus();
  else if (draft.phase === "draft") rendreDraft();
  else if (draft.phase === "temps") rendreTemps();
  else if (draft.phase === "termine") rendreTermine();
}

// ---- Polling ----

async function rafraichirEtatRoomEtJoueurs() {
  const room = await rejoindreOuConsulterRoom(roomId);

  const [j1, j2] = await Promise.all([
    chargerJoueurDepuisId(room.player1_discord_id),
    chargerJoueurDepuisId(room.player2_discord_id)
  ]);

  joueur1 = j1;
  joueur2 = j2;

  if (joueur1 && joueur2) {
    monRole = moiDiscordId === joueur1.discordId ? "j1" : "j2";

    document.getElementById("etat-attente").classList.add("cache");
    document.getElementById("zone-match").classList.remove("cache");

    const { draft: draftActuel } = await chargerDraft();
    definirDraft(draftActuel);
  } else {
    rendreEntetesJoueurs();
  }
}

async function tick() {
  try {
    if (!(joueur1 && joueur2)) {
      await rafraichirEtatRoomEtJoueurs();
    } else {
      const { draft: draftActuel } = await chargerDraft();
      definirDraft(draftActuel);
    }
  } catch (error) {
    console.error(error);
  }
}

async function demarrer() {
  try {
    roomId = getRoomIdDepuisUrl();

    if (!roomId) {
      alert("Aucune room spécifiée dans le lien.");
      return;
    }

    const user = await chargerSessionUtilisateur();
    if (!user) {
      alert("Tu dois être connecté avec Discord.");
      return;
    }
    moiDiscordId = user.id;

    [personnagesData, bossData] = await Promise.all([
      chargerPersonnages(),
      chargerBoss()
    ]);

    await tick();

    intervalPolling = setInterval(tick, POLL_INTERVAL_MS);
  } catch (error) {
    console.error(error);
    alert(error.message || "Erreur lors du chargement du match.");
  }
}

demarrer();