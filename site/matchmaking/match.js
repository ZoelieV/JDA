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

// Couleur du contour brillant des personnages équipés de leur arme
// signature, selon le raffinement de cette arme (index 0 = R1 ... 4 = R5).
// Convention reprise des paliers de rareté habituels ; à ajuster si besoin.
const COULEURS_REFINEMENT = ["#b0b0b0", "#6fcf6f", "#5b9bd5", "#a366d9", "#e0a83e"];

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
let armesData = [];
let bossData = [];
let draft = null;
let intervalPolling = null;

// Données des 2 joueurs : { discordId, nom, avatar, data } ou null.
// j1/j2 sont les rôles DE LA MANCHE EN COURS (draft.discord_j1/discord_j2),
// tirés au sort côté serveur puis échangés à chaque revanche — pas
// forcément "qui a créé la room".
let joueur1 = null;
let joueur2 = null;

// ---- Filtres / recherche de la grille de draft ----
const filtreElement = new Set();
const filtreEtoile = new Set();
let filtreProprietaire = null; // "j1" | "j2" | null
let rechercheTexte = "";

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

async function chargerArmes() {
  const reponse = await fetch("../DB/weapons.json");
  if (!reponse.ok) throw new Error("Impossible de charger les armes.");
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

// Mise à jour optimiste : on anticipe le résultat côté affichage pour que
// le clic réagisse immédiatement, sans attendre l'aller-retour réseau. Le
// serveur reste la seule source de vérité : sa réponse écrase l'anticipation,
// et en cas d'erreur on revient à l'état précédent.
async function postBox(box) {
  const ancienneBox = draft[`box_${monRole}`];
  const ancienPret = draft[`pret_${monRole}`];

  draft[`box_${monRole}`] = box;
  draft[`pret_${monRole}`] = false;
  rendrePhase();

  try {
    const data = await envoyerAction(`/api/rooms/${roomId}/box`, { box });
    await definirDraft(data.draft);
  } catch (err) {
    draft[`box_${monRole}`] = ancienneBox;
    draft[`pret_${monRole}`] = ancienPret;
    rendrePhase();
    throw err;
  }
}

async function postReady(pret) {
  const ancienPret = draft[`pret_${monRole}`];

  draft[`pret_${monRole}`] = pret;
  rendrePhase();

  try {
    const data = await envoyerAction(`/api/rooms/${roomId}/ready`, { pret });
    await definirDraft(data.draft);
  } catch (err) {
    draft[`pret_${monRole}`] = ancienPret;
    rendrePhase();
    throw err;
  }
}

async function postActionDraft(persoId) {
  const data = await envoyerAction(`/api/rooms/${roomId}/action`, { perso_id: persoId });
  await definirDraft(data.draft);
}

async function postBonusToggle(persoId) {
  const data = await envoyerAction(`/api/rooms/${roomId}/bonus_toggle`, { perso_id: persoId });
  await definirDraft(data.draft);
}

async function postBonusConfirmer() {
  const data = await envoyerAction(`/api/rooms/${roomId}/bonus_confirmer`, {});
  await definirDraft(data.draft);
}

async function postTemps(temps) {
  const data = await envoyerAction(`/api/rooms/${roomId}/temps`, { temps });
  await definirDraft(data.draft);
}

async function postRejouer(rejouer) {
  const data = await envoyerAction(`/api/rooms/${roomId}/rejouer`, { rejouer });
  await definirDraft(data.draft);
}

// Applique un nouvel état de draft. Si les rôles j1/j2 de la manche ont
// changé (1er chargement, ou échange automatique après une revanche), on
// recharge les profils concernés avant de redessiner — sinon joueur1/
// joueur2/monRole resteraient périmés.
async function definirDraft(nouveauDraft) {
  draft = nouveauDraft;

  if (draft.discord_j1 && (!joueur1 || joueur1.discordId !== draft.discord_j1)) {
    joueur1 = await chargerJoueurDepuisId(draft.discord_j1);
  }
  if (draft.discord_j2 && (!joueur2 || joueur2.discordId !== draft.discord_j2)) {
    joueur2 = await chargerJoueurDepuisId(draft.discord_j2);
  }
  if (draft.discord_j1 && draft.discord_j2) {
    monRole = moiDiscordId === draft.discord_j1 ? "j1" : "j2";
  }

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

function getJoueurDataParRole(role) {
  return role === "j1" ? joueur1?.data : joueur2?.data;
}

// Arme signature d'un personnage : image nommée "[id_personnage]_w.webp"
// (même convention que sur la page des box de comptes).
function trouverArmeSignature(personnageId) {
  return armesData.find(
    arme => typeof arme.image === "string" && arme.image.endsWith(`${personnageId}_w.webp`)
  );
}

// Raffinement (0 = R1 ... 4 = R5) de l'arme signature d'un personnage chez
// un joueur donné, ou null s'il ne la possède pas / si le perso n'a pas
// d'arme signature référencée.
function getRefinementArmeSignature(joueurData, personnageId) {
  const arme = trouverArmeSignature(personnageId);
  if (!arme) return null;
  const valeur = joueurData?.weapons?.full?.[arme.id] ?? -1;
  return valeur >= 0 ? valeur : null;
}

// Best-effort : affiche un niveau "x/y" pour un personnage si la donnée
// existe dans le profil, sous un des noms de champ plausibles. Ne casse
// jamais l'affichage si le champ n'existe pas (retourne simplement null,
// et la pastille n'est pas dessinée). À adapter si le vrai champ diffère.
function getNiveauPersonnage(joueurData, personnageId) {
  const collection = joueurData?.characters;
  if (!collection) return null;

  const brut =
    collection.niveaux?.[personnageId] ??
    collection.levels?.[personnageId] ??
    collection.lvl?.[personnageId] ??
    collection.details?.[personnageId]?.niveau ??
    collection.details?.[personnageId]?.lvl ??
    null;

  if (brut === null || brut === undefined) return null;

  if (typeof brut === "object") {
    const actuel = brut.actuel ?? brut.niveau ?? brut.lvl ?? brut.value;
    if (actuel === undefined || actuel === null) return null;
    const max = brut.max ?? 100;
    return `${actuel}/${max}`;
  }

  return `${brut}/100`;
}

function personnageCorrespondFiltres(personnage) {
  if (filtreElement.size > 0 && !filtreElement.has(personnage.element)) return false;
  if (filtreEtoile.size > 0 && !filtreEtoile.has(String(personnage.rarete))) return false;

  if (filtreProprietaire) {
    const pool = filtreProprietaire === "j1" ? draft.pool_j1 : draft.pool_j2;
    if (!pool || !pool.includes(personnage.id)) return false;
  }

  if (rechercheTexte.trim()) {
    const q = rechercheTexte.trim().toLowerCase();
    if (!personnage.nom.toLowerCase().includes(q)) return false;
  }

  return true;
}

function creerCarteItem(personnage, {
  selectionnable = false,
  indisponible = false,
  onClick = null,
  niveauJ1 = null,
  niveauJ2 = null,
  refinementViewer = null
} = {}) {
  const card = document.createElement("div");
  card.className = "character-card" +
    (selectionnable ? " selectionnable" : "") +
    (indisponible ? " indisponible" : "");

  const fond = getFondRarete(personnage.rarete);
  const icone = iconesElements[personnage.element] || "";

  const glow = refinementViewer !== null && refinementViewer !== undefined;
  const styleParts = [`background-image: url('${fond}')`];
  if (glow) {
    styleParts.push(`--couleur-glow: ${COULEURS_REFINEMENT[refinementViewer] || COULEURS_REFINEMENT[0]}`);
  }

  const niveauHtml = [
    niveauJ1 ? `<span class="character-niveau niveau-j1">${niveauJ1}</span>` : "",
    niveauJ2 ? `<span class="character-niveau niveau-j2">${niveauJ2}</span>` : ""
  ].join("");

  card.innerHTML = `
    <div class="character-visuel${glow ? " arme-signature" : ""}" style="${styleParts.join("; ")};">
      <img src="../DB/${personnage.image}" alt="${personnage.nom}">
      ${icone ? `<img class="character-icone-type" src="${icone}" alt="">` : ""}
      ${niveauHtml}
    </div>
    <div class="character-name">${personnage.nom}</div>
  `;

  if (selectionnable && onClick) {
    card.addEventListener("click", onClick);
  }

  return card;
}

// Aperçu des personnages compris dans une box donnée (image + nom, pas
// de points/constellation : c'est juste un aperçu de composition ici).
function rendreApercuBox(containerId, joueurData, boxChoisie) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!boxChoisie) {
    container.innerHTML = `<p class="apercu-vide">Aucune box choisie pour l'instant.</p>`;
    return;
  }

  const collection = joueurData?.characters || { full: {}, selections: {} };

  const persosBox = personnagesData.filter(p => {
    const valeur = collection.full?.[p.id] ?? -1;
    if (valeur < 0) return false;
    if (boxChoisie !== "full") {
      return !!collection.selections?.[boxChoisie]?.[p.id];
    }
    return true;
  });

  if (persosBox.length === 0) {
    container.innerHTML = `<p class="apercu-vide">Cette box ne contient aucun personnage.</p>`;
    return;
  }

  persosBox.forEach(p => container.appendChild(creerCarteItem(p)));
}

function creerBanMini(personnage) {
  const el = document.createElement("div");
  el.className = "ban-mini";
  el.title = personnage.nom;
  el.innerHTML = `<img src="../DB/${personnage.image}" alt="${personnage.nom}">`;
  return el;
}

// ---- Rendu des entêtes joueurs (avatar + pastille prêt) ----
// j1 à gauche, j2 à droite — reflète toujours les rôles de la manche en
// cours (draft.discord_j1/discord_j2), pas "qui a créé la room".

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
// Colonnes fixes j1 (gauche) / j2 (droite), alignées sur les entêtes.
// Chacun ne peut modifier que sa propre colonne ; celle de l'adversaire est
// en lecture seule.

function rendreChoixBox() {
  ["j1", "j2"].forEach(role => {
    const estMoi = role === monRole;
    const joueurObjet = role === "j1" ? joueur1 : joueur2;
    const nom = joueurObjet ? joueurObjet.nom : (role === "j1" ? "Joueur 1" : "Joueur 2");

    document.getElementById(`titre-box-${role}`).innerHTML =
      `${nom}${estMoi ? '<span class="tag-toi">(toi)</span>' : ""}`;

    const conteneur = document.getElementById(`box-select-${role}`);
    conteneur.innerHTML = "";
    conteneur.classList.toggle("desactive", !estMoi);

    Object.entries(BOX_LABELS).forEach(([valeur, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "box-btn" + (draft[`box_${role}`] === valeur ? " active" : "");
      btn.textContent = label;
      btn.disabled = !estMoi;
      if (estMoi) {
        btn.addEventListener("click", () => postBox(valeur).catch(err => alert(err.message)));
      }
      conteneur.appendChild(btn);
    });

    document.getElementById(`statut-pret-${role}`).textContent = draft[`pret_${role}`]
      ? (estMoi ? "Tu es prêt." : `${nom} est prêt.`)
      : (estMoi ? "Choisis ta box puis clique sur \"Je suis prêt\"." : `${nom} n'est pas encore prêt.`);

    const btnPret = document.getElementById(`btn-pret-${role}`);
    if (estMoi) {
      btnPret.classList.remove("cache");
      const dejaPret = draft[`pret_${role}`];
      btnPret.textContent = dejaPret ? "Annuler (je ne suis plus prêt)" : "Je suis prêt";
      btnPret.classList.toggle("active", dejaPret);
      btnPret.disabled = !draft[`box_${role}`];
      btnPret.onclick = () => postReady(!dejaPret).catch(err => alert(err.message));
    } else {
      btnPret.classList.add("cache");
    }

    rendreApercuBox(`apercu-box-${role}`, getJoueurDataParRole(role), draft[`box_${role}`]);
  });
}

// ---- Phase 2 : bans bonus d'équilibrage ----
// Les bans choisis vont dans des emplacements dédiés, modifiables (on peut
// en retirer un et en reprendre un autre) tant qu'on n'a pas confirmé.

function rendreBansBonus() {
  const choix = draft.bans_bonus_choix || [];
  const restant = draft.bans_bonus_total - choix.length;
  const nomJoueurConcerne = draft.bans_bonus_joueur === "j1" ? joueur1.nom : joueur2.nom;
  const ecart = Math.abs((draft.points_j1 ?? 0) - (draft.points_j2 ?? 0));
  const cEstMonTour = draft.bans_bonus_joueur === monRole;

  const message = document.getElementById("message-equilibrage");
  if (cEstMonTour) {
    message.textContent = restant > 0
      ? `Écart de ${ecart} pts entre les 2 box : choisis encore ${restant} personnage(s) à bannir avant le tirage du boss (tu peux revenir sur ton choix avant de confirmer).`
      : `Écart de ${ecart} pts entre les 2 box : tes ${draft.bans_bonus_total} ban(s) bonus sont sélectionnés. Clique sur "Confirmer les bans" pour tirer le boss.`;
  } else {
    message.textContent = `Écart de ${ecart} pts entre les 2 box : ${nomJoueurConcerne} choisit ${draft.bans_bonus_total} ban(s) bonus. En attente…`;
  }

  const slots = document.getElementById("bans-bonus-slots");
  slots.innerHTML = "";

  for (let i = 0; i < draft.bans_bonus_total; i++) {
    const persoId = choix[i];
    const slot = document.createElement("div");

    if (persoId) {
      const personnage = getPersonnageParId(persoId);
      slot.className = "slot-bonus rempli";
      slot.innerHTML = `
        <img src="../DB/${personnage.image}" alt="${personnage.nom}">
        <span class="retirer">✕</span>
      `;
      if (cEstMonTour) {
        slot.title = "Cliquer pour retirer";
        slot.addEventListener("click", () => postBonusToggle(persoId).catch(err => alert(err.message)));
      }
    } else {
      slot.className = "slot-bonus";
    }

    slots.appendChild(slot);
  }

  const btnConfirmer = document.getElementById("btn-confirmer-bonus");
  if (cEstMonTour) {
    btnConfirmer.classList.remove("cache");
    btnConfirmer.disabled = choix.length !== draft.bans_bonus_total;
    btnConfirmer.onclick = () => postBonusConfirmer().catch(err => alert(err.message));
  } else {
    btnConfirmer.classList.add("cache");
  }

  const grille = document.getElementById("grille-bans-bonus");
  grille.innerHTML = "";

  draft.pool_disponible.forEach(id => {
    const personnage = getPersonnageParId(id);
    if (!personnage) return;

    const dejaChoisi = choix.includes(id);
    const peutCliquer = cEstMonTour && (dejaChoisi || choix.length < draft.bans_bonus_total);

    const carte = creerCarteItem(personnage, {
      selectionnable: peutCliquer,
      indisponible: dejaChoisi,
      onClick: () => postBonusToggle(id).catch(err => alert(err.message))
    });
    grille.appendChild(carte);
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

// Résumé des constellations picks en haut de la draft : j1 à gauche, j2 à
// droite, 2 couleurs distinctes (cf. CSS). Rend inutile un éventuel tag
// "j1/j2" sur chaque carte de la grille du pool.
function rendreConstellations() {
  ["j1", "j2"].forEach(role => {
    const container = document.getElementById(`constellations-${role}`);
    if (!container) return;
    container.innerHTML = "";

    const joueurData = getJoueurDataParRole(role);
    const picks = draft.actions.filter(a => a.type === "pick" && a.joueur === role).map(a => a.perso_id);

    picks.forEach(persoId => {
      const personnage = getPersonnageParId(persoId);
      if (!personnage) return;

      const niveauC = joueurData?.characters?.full?.[persoId];
      const label = typeof niveauC === "number" && niveauC >= 0 ? `C${niveauC}` : "";

      const badge = document.createElement("span");
      badge.className = "constellation-badge";
      badge.innerHTML = `<img src="../DB/${personnage.image}" alt="${personnage.nom}"><span>${personnage.nom}${label ? " · " + label : ""}</span>`;
      container.appendChild(badge);
    });
  });
}

// Petit rappel persistant, pendant la draft, des bans d'équilibrage joués
// avant le tirage du boss (utile puisque la phase bans_bonus elle-même est
// passée à ce stade).
function rendreBansBonusRecap() {
  const recap = document.getElementById("bans-bonus-recap");
  const actionsBonus = draft.actions.filter(a => a.bonus);

  if (actionsBonus.length === 0) {
    recap.classList.add("cache");
    return;
  }

  recap.classList.remove("cache");
  const nomJoueurConcerne = draft.bans_bonus_joueur === "j1" ? joueur1.nom : joueur2.nom;

  recap.innerHTML = `<span>Bans équilibrage (${nomJoueurConcerne}) :</span>`;
  actionsBonus.forEach(a => {
    const personnage = getPersonnageParId(a.perso_id);
    if (personnage) recap.appendChild(creerBanMini(personnage));
  });
}

function rendreDraft() {
  const boss = bossData.find(b => b.id === draft.boss_id);
  const bossContainer = document.getElementById("boss-affiche");
  bossContainer.innerHTML = boss
    ? `<img src="../DB/${boss.image}" alt="${boss.nom}"><span class="nom-boss">${boss.nom}</span>`
    : "";

  rendreConstellations();
  rendreBansBonusRecap();

  const prochaine = getProchaineActionLocale();
  const tourContainer = document.getElementById("tour-actuel");

  if (!prochaine) {
    tourContainer.innerHTML = "Draft terminée.";
  } else {
    const verbe = prochaine.type === "ban" ? "bannir" : "picker";
    if (prochaine.joueur === monRole) {
      tourContainer.innerHTML = `À toi de <strong>${verbe}</strong> un personnage.`;
    } else {
      const nomAdversaire = prochaine.joueur === "j1" ? joueur1.nom : joueur2.nom;
      tourContainer.innerHTML = `En attente : ${nomAdversaire} doit <strong>${verbe}</strong> un personnage.`;
    }
  }

  rendreSlotsEtBans("j1");
  rendreSlotsEtBans("j2");

  const grille = document.getElementById("grille-pool-draft");
  grille.innerHTML = "";

  const cEstMonTour = !!prochaine && prochaine.joueur === monRole;
  const restrictionPick = cEstMonTour && prochaine.type === "pick";
  const monPool = monRole === "j1" ? draft.pool_j1 : draft.pool_j2;
  const joueurDataViewer = getJoueurDataParRole(monRole);

  draft.pool_disponible
    .map(id => getPersonnageParId(id))
    .filter(p => p && personnageCorrespondFiltres(p))
    .forEach(personnage => {
      const jePeuxLePicker = !restrictionPick || (monPool && monPool.includes(personnage.id));
      const selectionnable = cEstMonTour && jePeuxLePicker;

      const niveauJ1 = draft.pool_j1 && draft.pool_j1.includes(personnage.id)
        ? getNiveauPersonnage(getJoueurDataParRole("j1"), personnage.id)
        : null;
      const niveauJ2 = draft.pool_j2 && draft.pool_j2.includes(personnage.id)
        ? getNiveauPersonnage(getJoueurDataParRole("j2"), personnage.id)
        : null;
      const refinement = monPool && monPool.includes(personnage.id)
        ? getRefinementArmeSignature(joueurDataViewer, personnage.id)
        : null;

      const carte = creerCarteItem(personnage, {
        selectionnable,
        indisponible: cEstMonTour && !jePeuxLePicker,
        onClick: () => postActionDraft(personnage.id).catch(err => alert(err.message)),
        niveauJ1,
        niveauJ2,
        refinementViewer: refinement
      });
      grille.appendChild(carte);
    });
}

// ---- Barre de filtres / recherche de la grille de draft ----
// Construite UNE SEULE FOIS (pas à chaque rendu) pour ne pas perdre le
// focus/texte de la recherche à chaque poll.

function initialiserFiltresTri() {
  const container = document.getElementById("filtres-tri");
  if (!container) return;
  container.innerHTML = "";

  const zoneIcones = document.createElement("div");
  zoneIcones.className = "filtres-icones";
  Object.entries(iconesElements).forEach(([valeur, src]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.innerHTML = `<img src="${src}" alt="${valeur}">`;
    btn.addEventListener("click", () => {
      if (filtreElement.has(valeur)) filtreElement.delete(valeur); else filtreElement.add(valeur);
      btn.classList.toggle("active");
      rendrePhase();
    });
    zoneIcones.appendChild(btn);
  });
  container.appendChild(zoneIcones);

  const zoneEtoiles = document.createElement("div");
  zoneEtoiles.className = "filtres-etoiles";
  ["5", "4", "3"].forEach(valeur => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-etoile-btn";
    btn.textContent = `${valeur}★`;
    btn.addEventListener("click", () => {
      if (filtreEtoile.has(valeur)) filtreEtoile.delete(valeur); else filtreEtoile.add(valeur);
      btn.classList.toggle("active");
      rendrePhase();
    });
    zoneEtoiles.appendChild(btn);
  });
  container.appendChild(zoneEtoiles);

  const zoneProprio = document.createElement("div");
  zoneProprio.className = "filtres-proprietaire";
  [["j1", "J1"], ["j2", "J2"]].forEach(([valeur, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-proprietaire-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      filtreProprietaire = filtreProprietaire === valeur ? null : valeur;
      zoneProprio.querySelectorAll(".filtre-proprietaire-btn").forEach(b => b.classList.remove("active"));
      if (filtreProprietaire === valeur) btn.classList.add("active");
      rendrePhase();
    });
    zoneProprio.appendChild(btn);
  });
  container.appendChild(zoneProprio);

  const btnClear = document.createElement("button");
  btnClear.type = "button";
  btnClear.className = "btn-clear-filtres";
  btnClear.textContent = "✕ Filtres";
  btnClear.addEventListener("click", () => {
    filtreElement.clear();
    filtreEtoile.clear();
    filtreProprietaire = null;
    rechercheTexte = "";
    container.querySelectorAll(".active").forEach(b => b.classList.remove("active"));
    const input = document.getElementById("recherche-personnage");
    if (input) input.value = "";
    rendrePhase();
  });
  container.appendChild(btnClear);

  const inputRecherche = document.createElement("input");
  inputRecherche.type = "text";
  inputRecherche.id = "recherche-personnage";
  inputRecherche.className = "recherche-personnage";
  inputRecherche.placeholder = "Rechercher…";
  inputRecherche.addEventListener("input", () => {
    rechercheTexte = inputRecherche.value;
    rendrePhase();
  });
  container.appendChild(inputRecherche);
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

  // Revanche : même principe de ready-check que le lancement de la draft —
  // il faut que les 2 joueurs confirment avant que la manche ne redémarre
  // (avec j1/j2 échangés automatiquement côté serveur).
  const dejaOk = draft[`rejouer_${monRole}`];
  const autreRole = getAutreRole(monRole);
  const autreOk = draft[`rejouer_${autreRole}`];
  const nomAutre = autreRole === "j1" ? joueur1.nom : joueur2.nom;

  const btn = document.getElementById("btn-rejouer");
  btn.textContent = dejaOk ? "Annuler la demande de revanche" : "Rejouer";
  btn.classList.toggle("active", dejaOk);
  btn.onclick = () => postRejouer(!dejaOk).catch(err => alert(err.message));

  const etat = document.getElementById("etat-rejouer");
  if (dejaOk && !autreOk) {
    etat.textContent = `En attente que ${nomAutre} accepte la revanche…`;
    etat.classList.remove("cache");
  } else if (!dejaOk && autreOk) {
    etat.textContent = `${nomAutre} veut rejouer. Clique sur "Rejouer" pour confirmer.`;
    etat.classList.remove("cache");
  } else {
    etat.classList.add("cache");
  }
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

  if (room.player1_discord_id && room.player2_discord_id) {
    document.getElementById("etat-attente").classList.add("cache");
    document.getElementById("zone-match").classList.remove("cache");

    const { draft: draftActuel } = await chargerDraft();
    await definirDraft(draftActuel);
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
      await definirDraft(draftActuel);
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

    [personnagesData, bossData, armesData] = await Promise.all([
      chargerPersonnages(),
      chargerBoss(),
      chargerArmes()
    ]);

    initialiserFiltresTri();

    await tick();

    intervalPolling = setInterval(tick, POLL_INTERVAL_MS);
  } catch (error) {
    console.error(error);
    alert(error.message || "Erreur lors du chargement du match.");
  }
}

demarrer();