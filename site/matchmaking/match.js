const iconesElements = {
  pyro: "../DB/images/others/pyro.webp",
  hydro: "../DB/images/others/hydro.webp",
  anemo: "../DB/images/others/anemo.webp",
  electro: "../DB/images/others/electro.webp",
  cryo: "../DB/images/others/cryo.webp",
  dendro: "../DB/images/others/dendro.webp",
  geo: "../DB/images/others/geo.webp"
};

// Logos des types d'armes (mêmes que la liste des comptes), utilisés pour
// l'arme signature possédée, détourés de la couleur du raffinement.
const iconesTypesArmesSignature = {
  sword: "../DB/images/others/sword_icon.webp",
  claymore: "../DB/images/others/claymore_icon.webp",
  polearm: "../DB/images/others/polearm_icon.webp",
  bow: "../DB/images/others/bow_icon.webp",
  catalyst: "../DB/images/others/catalyst_icon.webp"
};

const ORDRE_ELEMENTS = Object.keys(iconesElements);

const BOX_LABELS = {
  full: "Full box",
  stuff: "Stuff",
  opti1: "Opti 1",
  opti2: "Opti 2",
  opti3: "Opti 3",
  opti4: "Opti 4",
  opti5: "Opti 5"
};

// Couleur du détourage du logo d'arme signature, selon son raffinement
// (index 0 = R1 ... 4 = R5).
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
let triActif = null; // "points" | "constellation" | "rarete" | "element" | null (ordre par défaut)

// ---- Animation de tirage du boss ----
let dernierePhaseVue = null; // phase locale précédente, pour détecter une transition
let animationBossEnCours = false;
let bossAnimeId = null; // boss_id pour lequel l'animation a déjà été jouée (ou sautée)

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

  // Nouvelle manche (boss pas encore tiré) : on réarme l'animation pour le
  // prochain tirage, y compris si le prochain boss tiré tombe à nouveau sur
  // le même que la manche précédente (sinon nouveauBoss resterait faux).
  if (!draft.boss_id) {
    bossAnimeId = null;
  }

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
// d'arme signature référencée. Copies dupliquées ("idArme#2"...) comprises :
// on garde la meilleure.
function getRefinementArmeSignature(joueurData, personnageId) {
  const arme = trouverArmeSignature(personnageId);
  if (!arme) return null;

  const full = joueurData?.weapons?.full || {};
  let meilleur = -1;
  Object.entries(full).forEach(([cle, valeur]) => {
    if ((cle === arme.id || cle.startsWith(`${arme.id}#`)) && valeur > meilleur) {
      meilleur = valeur;
    }
  });
  return meilleur >= 0 ? meilleur : null;
}

// Niveau "95" ou "100" d'un perso, ou null si non renseigné
// (la pastille n'est alors pas dessinée).
function getNiveauPersonnage(joueurData, personnageId) {
  // Renseigné sur la page Mon compte : profil.characters.niveaux[id] = 95 | 100
  // (clé absente = non renseigné).
  const niveau = joueurData?.characters?.niveaux?.[personnageId];
  if (niveau !== 95 && niveau !== 100) return null;

  return String(niveau);
}

// Constellation (toujours connue : c'est la valeur de possession 0-6),
// affichée séparément du niveau (en haut de carte, cf. creerCarteItem).
function getConstellationLabel(joueurData, persoId) {
  const c = joueurData?.characters?.full?.[persoId];
  return typeof c === "number" && c >= 0 ? `C${c}` : null;
}

// Constellation (0-6) d'un perso chez un joueur, ou null s'il ne l'a pas.
function getConstellation(role, persoId) {
  const c = getJoueurDataParRole(role)?.characters?.full?.[persoId];
  return typeof c === "number" && c >= 0 ? c : null;
}

// Joueurs (parmi roles) qui possèdent le perso. Le filtre J1/J2 restreint
// à ce joueur-là, sauf pour les aperçus de box (une colonne = un joueur).
function getRolesProprietaires(persoId, roles = ["j1", "j2"], avecFiltre = true) {
  const candidats = avecFiltre && filtreProprietaire ? roles.filter(r => r === filtreProprietaire) : roles;
  return candidats.filter(r => getConstellation(r, persoId) !== null);
}

// Infos affichées sur une carte, pour chaque joueur (parmi roles) qui
// possède le perso : constellation, niveau, raffinement de l'arme signature.
function getInfosCarte(persoId, roles = ["j1", "j2"]) {
  const infos = {};
  roles.forEach(role => {
    if (getConstellation(role, persoId) === null) return;
    const data = getJoueurDataParRole(role);
    const suffixe = role === "j1" ? "J1" : "J2";
    infos[`constellation${suffixe}`] = getConstellationLabel(data, persoId);
    infos[`niveau${suffixe}`] = getNiveauPersonnage(data, persoId);
    infos[`refinement${suffixe}`] = getRefinementArmeSignature(data, persoId);
  });
  return infos;
}

// ---- Tri (choix unique) ----
// Points / constellation : meilleure valeur parmi les propriétaires pris en
// compte (le joueur filtré, sinon les 2). Décroissant, sauf éléments (ordre
// des icônes de filtre). Tri stable : l'ordre de base départage.
function valeurTri(personnage, roles) {
  // Aperçu d'une box (un seul joueur) : le filtre J1/J2 ne s'applique pas.
  const proprietaires = getRolesProprietaires(personnage.id, roles, roles.length > 1);
  const constellations = proprietaires.map(r => getConstellation(r, personnage.id));

  switch (triActif) {
    case "points":
      return Math.max(-1, ...constellations.map(c => Number(personnage.PPC?.[c] ?? 0)));
    case "constellation":
      return Math.max(-1, ...constellations);
    case "rarete":
      return Number(personnage.rarete) || 0;
    case "element":
      return -ORDRE_ELEMENTS.indexOf(personnage.element);
    default:
      return 0;
  }
}

function trierPersonnages(personnages, roles = ["j1", "j2"]) {
  if (!triActif) return personnages;
  return personnages
    .map((p, index) => ({ p, index, v: valeurTri(p, roles) }))
    .sort((a, b) => (b.v - a.v) || (a.index - b.index))
    .map(e => e.p);
}

// Filtres + recherche. ignorerProprietaire : aperçus de box (colonne déjà
// propre à un joueur).
function personnageCorrespondFiltres(personnage, { ignorerProprietaire = false } = {}) {
  if (filtreElement.size > 0 && !filtreElement.has(personnage.element)) return false;
  if (filtreEtoile.size > 0 && !filtreEtoile.has(String(personnage.rarete))) return false;

  if (filtreProprietaire && !ignorerProprietaire) {
    if (getConstellation(filtreProprietaire, personnage.id) === null) return false;
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
  constellationJ1 = null,
  constellationJ2 = null,
  niveauJ1 = null,
  niveauJ2 = null,
  refinementJ1 = null,
  refinementJ2 = null
} = {}) {
  const card = document.createElement("div");
  card.title = personnage.nom;
  card.className = "character-card" +
    (selectionnable ? " selectionnable" : "") +
    (indisponible ? " indisponible" : "");

  const fond = getFondRarete(personnage.rarete);

  const iconeArme = iconesTypesArmesSignature[personnage.arme];
  const raffinementHtml = iconeArme
    ? [["j1", refinementJ1], ["j2", refinementJ2]]
      .filter(([, r]) => r !== null && r !== undefined)
      .map(([role, r]) => `<img class="character-raffinement raffinement-${role}" src="${iconeArme}" alt="R${r + 1}" title="${role.toUpperCase()} : arme signature R${r + 1}" style="--couleur-ref: ${COULEURS_REFINEMENT[r] || COULEURS_REFINEMENT[0]}">`)
      .join("")
    : "";

  const constellationHtml = [
    constellationJ1 ? `<span class="character-constellation constellation-j1">${constellationJ1}</span>` : "",
    constellationJ2 ? `<span class="character-constellation constellation-j2">${constellationJ2}</span>` : ""
  ].join("");

  const niveauHtml = [
    niveauJ1 ? `<span class="character-niveau niveau-j1">${niveauJ1}</span>` : "",
    niveauJ2 ? `<span class="character-niveau niveau-j2">${niveauJ2}</span>` : ""
  ].join("");

  card.innerHTML = `
    <div class="character-visuel" style="background-image: url('${fond}');">
      <img src="../DB/${personnage.image}" alt="${personnage.nom}">
      ${constellationHtml}
      ${niveauHtml}
      ${raffinementHtml}
    </div>
  `;

  if (selectionnable && onClick) {
    card.addEventListener("click", onClick);
  }

  return card;
}

// Aperçu des personnages compris dans la box d'un joueur, avec ses infos
// (constellation, niveau, raffinement), filtres/recherche et tri.
function rendreApercuBox(containerId, role, boxChoisie) {
  const joueurData = getJoueurDataParRole(role);
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

  trierPersonnages(persosBox.filter(p => personnageCorrespondFiltres(p, { ignorerProprietaire: true })), [role])
    .forEach(p => container.appendChild(creerCarteItem(p, getInfosCarte(p.id, [role]))));
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
    const afficherPastille = draft && (draft.phase === "choix_box" || draft.phase === "analyse");
    // Avant le tirage, j1/j2 ne sont que des places provisoires : pas de tag.
    const afficherRole = draft && draft.roles_tires;

    container.innerHTML = `
      <img src="${joueur.avatar || ""}" alt="${joueur.nom}">
      <span class="nom-joueur">${joueur.nom}</span>
      ${afficherRole ? `<span class="tag-role">${role.toUpperCase()}</span>` : ""}
      ${afficherPastille ? `<span class="pastille ${pret ? "pret" : ""}"></span>` : ""}
    `;
  });
}

// ---- Phases 1 et 2 : choix de box, puis analyse ----
// Colonnes fixes j1 (gauche) / j2 (droite), alignées sur les entêtes.
// choix_box : chacun ne voit et ne modifie que sa box (celle de
// l'adversaire n'est même pas envoyée par le serveur), "Je suis prêt" la
// valide. analyse : les 2 box sont verrouillées et visibles, chacun
// confirme quand il a fini de regarder celle de l'adversaire.

function rendreChoixBox() {
  const enAnalyse = draft.phase === "analyse";

  document.getElementById("message-choix-box").textContent = enAnalyse
    ? (draft.roles_tires
      ? "Revanche : mêmes box et mêmes bans d'équilibrage, rôles J1/J2 inversés. Analyse la box adverse puis clique sur \"Prêt\" pour tirer le boss."
      : "Analyse la box adverse puis clique sur \"Prêt\". Suite : bans d'équilibrage (si écart), puis tirage J1/J2 et du boss.")
    : "Choisis ta box et valide-la. La box adverse sera visible une fois les 2 box validées.";

  ["j1", "j2"].forEach(role => {
    const estMoi = role === monRole;
    const joueurObjet = role === "j1" ? joueur1 : joueur2;
    const nom = joueurObjet ? joueurObjet.nom : (role === "j1" ? "Joueur 1" : "Joueur 2");
    const points = enAnalyse && draft[`points_${role}`] != null ? ` · ${draft[`points_${role}`]} pts` : "";
    const peutChoisir = estMoi && !enAnalyse;

    document.getElementById(`titre-box-${role}`).innerHTML =
      `${nom}${estMoi ? '<span class="tag-toi">(toi)</span>' : ""}${points}`;

    const conteneur = document.getElementById(`box-select-${role}`);
    conteneur.innerHTML = "";
    conteneur.classList.toggle("desactive", !peutChoisir);

    Object.entries(BOX_LABELS).forEach(([valeur, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "box-btn" + (draft[`box_${role}`] === valeur ? " active" : "");
      btn.textContent = label;
      btn.disabled = !peutChoisir;
      if (peutChoisir) {
        btn.addEventListener("click", () => postBox(valeur).catch(err => alert(err.message)));
      }
      conteneur.appendChild(btn);
    });

    const pret = draft[`pret_${role}`];
    let statut;
    if (enAnalyse) {
      statut = pret
        ? (estMoi ? "Tu as fini l'analyse." : `${nom} a fini l'analyse.`)
        : (estMoi ? "Analyse la box adverse puis clique sur \"Prêt\"." : `${nom} analyse encore…`);
    } else {
      statut = pret
        ? (estMoi ? "Box validée." : `${nom} a validé sa box.`)
        : (estMoi ? "Choisis ta box puis clique sur \"Valider ma box\"." : `${nom} choisit sa box…`);
    }
    document.getElementById(`statut-pret-${role}`).textContent = statut;

    const btnPret = document.getElementById(`btn-pret-${role}`);
    if (estMoi) {
      btnPret.classList.remove("cache");
      if (enAnalyse) {
        btnPret.textContent = pret ? "Annuler (pas encore prêt)" : "Prêt";
      } else {
        btnPret.textContent = pret ? "Annuler (modifier ma box)" : "Valider ma box";
      }
      btnPret.classList.toggle("active", pret);
      btnPret.disabled = !draft[`box_${role}`];
      btnPret.onclick = () => postReady(!pret).catch(err => alert(err.message));
    } else {
      btnPret.classList.add("cache");
    }

    if (!estMoi && !enAnalyse) {
      document.getElementById(`apercu-box-${role}`).innerHTML =
        `<p class="apercu-vide">Box cachée jusqu'à l'analyse.</p>`;
    } else {
      rendreApercuBox(`apercu-box-${role}`, role, draft[`box_${role}`]);
    }
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
      ? `Écart de ${ecart} pts entre les 2 box : choisis encore ${restant} personnage(s) à bannir avant le tirage J1/J2 et du boss (tu peux revenir sur ton choix avant de confirmer).`
      : `Écart de ${ecart} pts entre les 2 box : tes ${draft.bans_bonus_total} ban(s) bonus sont sélectionnés. Clique sur "Confirmer les bans" pour lancer le tirage J1/J2 et du boss.`;
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
  const cleGrille = JSON.stringify([
    choix, draft.bans_bonus_total, draft.bans_bonus_joueur, draft.pool_disponible,
    draft.pool_j1, draft.pool_j2, draft.discord_j1, draft.discord_j2, monRole,
    ...cleFiltres()
  ]);
  if (!grilleAChange(grille, cleGrille)) return;

  const personnages = draft.pool_disponible
    .map(id => getPersonnageParId(id))
    .filter(p => p && personnageCorrespondFiltres(p));

  trierPersonnages(personnages).forEach(personnage => {
    const id = personnage.id;
    const dejaChoisi = choix.includes(id);
    const peutCliquer = cEstMonTour && (dejaChoisi || choix.length < draft.bans_bonus_total);

    const carte = creerCarteItem(personnage, {
      selectionnable: peutCliquer,
      indisponible: dejaChoisi,
      onClick: () => postBonusToggle(id).catch(err => alert(err.message)),
      ...getInfosCarte(id)
    });
    grille.appendChild(carte);
  });
}

// ---- Phase 3 : draft (boss + bans/picks) ----

function getProchaineActionLocale() {
  const action = SEQUENCE_FIXE[draft.sequence_index];
  return action || null;
}

// Titre d'un tableau joueur : pseudo, remplacé par "J1"/"J2" sur téléphone
// (tableaux côte à côte, cf. CSS).
function titreTableauJoueur(role, nomJoueur) {
  return `<h4><span class="nom-complet">${nomJoueur}</span><span class="nom-court">${role.toUpperCase()}</span></h4>`;
}

function rendreSlotsEtBans(role) {
  const nomJoueur = role === "j1" ? joueur1.nom : joueur2.nom;

  const picks = draft.actions.filter(a => a.type === "pick" && a.joueur === role).map(a => a.perso_id);
  // Les bans bonus d'équilibrage ont leur propre récap (bans-bonus-recap,
  // affiché en haut) : on ne les remet pas ici pour éviter le doublon.
  const bans = draft.actions.filter(a => a.type === "ban" && a.joueur === role && !a.bonus).map(a => a.perso_id);

  const slotsContainer = document.getElementById(`slots-pick-${role}`);
  slotsContainer.innerHTML = titreTableauJoueur(role, nomJoueur);

  for (let i = 0; i < 4; i++) {
    const persoId = picks[i];
    const slot = document.createElement("div");

    if (persoId) {
      const personnage = getPersonnageParId(persoId);
      slot.className = "slot-pick";
      slot.innerHTML = `
        <img src="../DB/${personnage.image}" alt="${personnage.nom}" title="${personnage.nom}">
      `;
    } else {
      slot.className = "slot-pick vide";
      slot.textContent = "Vide";
    }

    slotsContainer.appendChild(slot);
  }

  // Cases de bans (rouges), une par ban prévu pour ce joueur dans la
  // séquence, sous les cases de picks.
  const nbBans = SEQUENCE_FIXE.filter(a => a.type === "ban" && a.joueur === role).length;
  const bansContainer = document.getElementById(`rangee-bans-${role}`);
  bansContainer.innerHTML = "";

  for (let i = 0; i < nbBans; i++) {
    const personnage = bans[i] ? getPersonnageParId(bans[i]) : null;
    const slot = document.createElement("div");

    if (personnage) {
      slot.className = "slot-pick slot-ban";
      slot.innerHTML = `
        <img src="../DB/${personnage.image}" alt="${personnage.nom}" title="${personnage.nom}">
      `;
    } else {
      slot.className = "slot-pick slot-ban vide";
      slot.textContent = "Vide";
    }

    bansContainer.appendChild(slot);
  }
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

// Affiche directement le boss final, sans animation (arrivée directe en
// phase "draft" : rechargement de page, ou 2e joueur qui a raté la
// transition entre 2 polls).
function afficherBossFinal(bossId) {
  const boss = bossData.find(b => b.id === bossId);
  const container = document.getElementById("boss-affiche");
  container.classList.remove("boss-tirage", "boss-revele");
  container.innerHTML = boss
    ? `<img src="../DB/${boss.image}" alt="${boss.nom}"><span class="nom-boss">${boss.nom}</span>`
    : "";
}

// Petite animation "roue" : fait défiler des boss aléatoires de plus en
// plus lentement avant de révéler le vrai boss tiré (déjà déterminé côté
// serveur — l'aléatoire ici est purement visuel/théâtral).
function jouerAnimationBoss(bossIdFinal) {
  animationBossEnCours = true;

  const container = document.getElementById("boss-affiche");
  container.classList.remove("boss-revele");
  container.classList.add("boss-tirage");

  const bossFinal = bossData.find(b => b.id === bossIdFinal);
  const autresBoss = bossData.filter(b => b.id !== bossIdFinal);
  const nbTours = 12;
  let tour = 0;

  function etape() {
    const propose = autresBoss.length > 0
      ? autresBoss[Math.floor(Math.random() * autresBoss.length)]
      : bossFinal;

    container.innerHTML = propose
      ? `<img src="../DB/${propose.image}" alt=""><span class="nom-boss">?</span>`
      : "";

    tour += 1;

    if (tour < nbTours) {
      // Ralentit progressivement, comme une roue qui perd de la vitesse.
      setTimeout(etape, 80 + tour * 15);
    } else {
      container.classList.remove("boss-tirage");
      container.classList.add("boss-revele");
      container.innerHTML = bossFinal
        ? `<img src="../DB/${bossFinal.image}" alt="${bossFinal.nom}"><span class="nom-boss">${bossFinal.nom}</span>`
        : "";

      setTimeout(() => container.classList.remove("boss-revele"), 700);

      animationBossEnCours = false;
      bossAnimeId = bossIdFinal;
    }
  }

  etape();
}

// Affiche le boss (sans animation) s'il n'est pas déjà à l'écran et
// qu'aucune animation n'est en cours (ex : rechargement en phase temps).
function assurerBossAffiche() {
  if (draft.boss_id !== bossAnimeId && !animationBossEnCours) {
    afficherBossFinal(draft.boss_id);
    bossAnimeId = draft.boss_id;
  }
}

function rendreDraft(phasePrecedente) {
  const nouveauBoss = draft.boss_id !== bossAnimeId;
  const justeTransitionne = !!phasePrecedente && phasePrecedente !== "draft";

  if (nouveauBoss && !animationBossEnCours) {
    if (justeTransitionne) {
      jouerAnimationBoss(draft.boss_id);
    } else {
      afficherBossFinal(draft.boss_id);
      bossAnimeId = draft.boss_id;
    }
  }
  // Si une animation est déjà en cours ou déjà jouée pour ce boss, on ne
  // touche pas à #boss-affiche (évite de la couper/relancer à chaque poll).

  rendreBansBonusRecap();

  const prochaine = getProchaineActionLocale();
  const tourContainer = document.getElementById("tour-actuel");

  if (!prochaine) {
    tourContainer.innerHTML = "Draft terminée.";
  } else {
    const verbe = prochaine.type === "ban" ? "bannir" : "pick";
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
  const cleGrille = JSON.stringify([
    draft.actions, draft.sequence_index, draft.pool_disponible, draft.pool_j1, draft.pool_j2,
    draft.discord_j1, draft.discord_j2, monRole,
    ...cleFiltres()
  ]);
  if (!grilleAChange(grille, cleGrille)) return;

  const cEstMonTour = !!prochaine && prochaine.joueur === monRole;
  const restrictionPick = cEstMonTour && prochaine.type === "pick";
  const monPool = monRole === "j1" ? draft.pool_j1 : draft.pool_j2;

  const personnages = draft.pool_disponible
    .map(id => getPersonnageParId(id))
    .filter(p => p && personnageCorrespondFiltres(p));

  trierPersonnages(personnages).forEach(personnage => {
    const jePeuxLePicker = !restrictionPick || (monPool && monPool.includes(personnage.id));
    const selectionnable = cEstMonTour && jePeuxLePicker;

    const carte = creerCarteItem(personnage, {
      selectionnable,
      indisponible: cEstMonTour && !jePeuxLePicker,
      onClick: () => postActionDraft(personnage.id).catch(err => alert(err.message)),
      ...getInfosCarte(personnage.id)
    });
    grille.appendChild(carte);
  });
}

// ---- Grilles de persos : reconstruction seulement si nécessaire ----
// Le polling rappelle le rendu toutes les 2.5s : reconstruire la grille à
// chaque fois recrée la carte survolée, qui rejoue alors son animation de
// survol (effet "faux clic"). On ne la reconstruit que si ce qui l'affecte
// (état de la draft, filtres, rôles) a changé. Vide la grille si oui.

// Part de la clé de grille qui dépend de la barre recherche/tri/filtres.
function cleFiltres() {
  return [[...filtreElement], [...filtreEtoile], filtreProprietaire, rechercheTexte, triActif];
}

function grilleAChange(grille, cle) {
  if (grille.dataset.cle === cle) return false;
  grille.dataset.cle = cle;
  grille.innerHTML = "";
  return true;
}

// ---- Grilles de persos : écarts homogènes ----
// Autant de colonnes que possible avec un écart >= ECART_MIN_GRILLE, puis
// l'espace restant est réparti également entre les cartes ET sur les 2
// bords (grille centrée) ; le même écart sert entre les lignes.

const ECART_MIN_GRILLE = 10;

// Téléphone (même seuil que le CSS) : toujours 4 cartes par ligne, dont la
// taille s'adapte à la largeur disponible.
const MEDIA_TELEPHONE = window.matchMedia("(max-width: 700px)");
const COLONNES_TELEPHONE = 4;

function ajusterGrille(grille) {
  const largeur = grille.clientWidth;
  if (!largeur) return;

  let taille = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--taille-carte")) || 130;
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

function initialiserGrillesPersos() {
  const observer = new ResizeObserver(entrees => entrees.forEach(e => ajusterGrille(e.target)));
  document.querySelectorAll(".grille-pool").forEach(grille => observer.observe(grille));
}

// ---- Barre recherche / tri / filtres (commune à toutes les phases) ----
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
  zoneProprio.id = "filtres-proprietaire";
  [["j1", "J1"], ["j2", "J2"]].forEach(([valeur, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-proprietaire-btn";
    btn.dataset.role = valeur;
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
    triActif = null;
    document.getElementById("barre-outils").querySelectorAll(".active").forEach(b => b.classList.remove("active"));
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
  // Recherche à gauche de la barre, tri juste à sa droite, filtres à droite.
  const zoneRecherche = document.getElementById("zone-recherche");
  zoneRecherche.appendChild(inputRecherche);

  const zoneTris = document.createElement("div");
  zoneTris.className = "tris";
  zoneTris.innerHTML = `<span class="tris-label">Trier :</span>`;
  [["points", "Points"], ["constellation", "Constel."], ["rarete", "Rareté"], ["element", "Élément"]].forEach(([valeur, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-etoile-btn tri-btn";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      triActif = triActif === valeur ? null : valeur;
      zoneTris.querySelectorAll(".tri-btn").forEach(b => b.classList.toggle("active", b === btn && triActif === valeur));
      rendrePhase();
    });
    zoneTris.appendChild(btn);
  });
  zoneRecherche.appendChild(zoneTris);
}

// Filtre J1/J2 : inutile pendant le choix de box et l'analyse (une colonne
// par joueur) ; avant le tirage, j1/j2 ne sont que des places provisoires,
// donc les boutons portent le nom des joueurs.
function mettreAJourFiltreProprietaire() {
  const zone = document.getElementById("filtres-proprietaire");
  if (!zone) return;
  zone.classList.toggle("cache", draft.phase === "choix_box" || draft.phase === "analyse");
  zone.querySelectorAll(".filtre-proprietaire-btn").forEach(btn => {
    const joueur = btn.dataset.role === "j1" ? joueur1 : joueur2;
    btn.textContent = draft.roles_tires || !joueur ? btn.dataset.role.toUpperCase() : joueur.nom;
  });
}

// ---- Annonce du rôle au tirage ----
// Affichée 5 s quand la draft démarre (tirage J1/J2 en 1re manche, rôles
// inversés en revanche). L'animation CSS gère l'apparition/disparition.
function annoncerRole() {
  if (!monRole) return;
  const annonce = document.createElement("div");
  annonce.className = `annonce-role annonce-${monRole}`;
  annonce.innerHTML = `
    <div class="annonce-titre">Tu es ${monRole.toUpperCase()}</div>
    <div class="annonce-sous-titre">${monRole === "j1" ? "Tu bannis en premier." : "Ton adversaire bannit en premier."}</div>
  `;
  document.body.appendChild(annonce);
  setTimeout(() => annonce.remove(), 5000);
}

// ---- Phase 4 : saisie du temps ----

// Recap des picks d'un joueur (sans la rangée de bans, contrairement à
// rendreSlotsEtBans) — utilisé sur la page de saisie du temps pour se
// souvenir des 2 teams pendant qu'on tape son temps.
function rendrePicksSeuls(containerId, role) {
  const nomJoueur = role === "j1" ? joueur1.nom : joueur2.nom;
  const picks = draft.actions.filter(a => a.type === "pick" && a.joueur === role).map(a => a.perso_id);

  const container = document.getElementById(containerId);
  container.innerHTML = titreTableauJoueur(role, nomJoueur);

  const slotsWrap = document.createElement("div");
  slotsWrap.className = "slots-pick";

  for (let i = 0; i < 4; i++) {
    const persoId = picks[i];
    const slot = document.createElement("div");

    if (persoId) {
      const personnage = getPersonnageParId(persoId);
      slot.className = "slot-pick";
      slot.innerHTML = `
        <img src="../DB/${personnage.image}" alt="${personnage.nom}" title="${personnage.nom}">
      `;
    } else {
      slot.className = "slot-pick vide";
      slot.textContent = "Vide";
    }

    slotsWrap.appendChild(slot);
  }

  container.appendChild(slotsWrap);
}

function rendreTemps() {
  assurerBossAffiche();

  rendrePicksSeuls("recap-equipe-j1", "j1");
  rendrePicksSeuls("recap-equipe-j2", "j2");

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

  // Revanche : ready-check des 2 joueurs, puis retour direct à l'analyse
  // avec les mêmes box et bans d'équilibrage, j1/j2 échangés côté serveur.
  const dejaOk = draft[`rejouer_${monRole}`];
  const autreRole = getAutreRole(monRole);
  const autreOk = draft[`rejouer_${autreRole}`];
  const nomAutre = autreRole === "j1" ? joueur1.nom : joueur2.nom;

  const btn = document.getElementById("btn-rejouer");
  btn.textContent = dejaOk ? "Annuler la demande de revanche" : "Rejouer (mêmes box, rôles inversés)";
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

// Bulles figées en bas de l'écran (#bulles-bas) -> phases où elles s'affichent.
const BULLES_PAR_PHASE = {
  "message-choix-box": ["choix_box", "analyse"],
  "message-equilibrage": ["bans_bonus"],
  "tour-actuel": ["draft"],
  "etat-temps": ["temps"],
  "etat-rejouer": ["termine"]
};

function rendrePhase() {
  const phasePrecedente = dernierePhaseVue;
  dernierePhaseVue = draft.phase;

  rendreEntetesJoueurs();

  document.querySelectorAll(".phase").forEach(el => el.classList.add("cache"));

  const idsParPhase = {
    choix_box: "phase-choix-box",
    analyse: "phase-choix-box",
    bans_bonus: "phase-bans-bonus",
    draft: "phase-draft",
    temps: "phase-temps",
    termine: "phase-termine"
  };

  const idAffiche = idsParPhase[draft.phase];
  if (!idAffiche) return;

  document.getElementById(idAffiche).classList.remove("cache");

  // Boss tiré (draft, temps) : entêtes réduites à 1/3 de leur largeur, le
  // boss occupe le centre libéré (et déborde vers le bas pendant la draft).
  const avecBoss = draft.phase === "draft" || draft.phase === "temps";
  const entetes = document.querySelector(".entetes-joueurs");
  entetes.classList.toggle("compact", avecBoss);
  entetes.classList.toggle("boss-deborde", draft.phase === "draft");
  document.getElementById("entete-centre").classList.toggle("cache", !avecBoss);

  // Bulles du bas : seules celles de la phase en cours sont visibles.
  Object.entries(BULLES_PAR_PHASE).forEach(([id, phases]) => {
    document.getElementById(id).classList.toggle("hors-phase", !phases.includes(draft.phase));
  });

  const avecPersos = ["choix_box", "analyse", "bans_bonus", "draft"].includes(draft.phase);
  document.getElementById("barre-outils").classList.toggle("cache", !avecPersos);
  if (draft.phase !== "draft") document.getElementById("bans-bonus-recap").classList.add("cache");
  mettreAJourFiltreProprietaire();

  if (draft.phase === "draft" && phasePrecedente && phasePrecedente !== "draft") {
    annoncerRole();
  }

  if (draft.phase === "choix_box" || draft.phase === "analyse") rendreChoixBox();
  else if (draft.phase === "bans_bonus") rendreBansBonus();
  else if (draft.phase === "draft") rendreDraft(phasePrecedente);
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
    initialiserGrillesPersos();

    await tick();

    intervalPolling = setInterval(tick, POLL_INTERVAL_MS);
  } catch (error) {
    console.error(error);
    alert(error.message || "Erreur lors du chargement du match.");
  }
}

demarrer();