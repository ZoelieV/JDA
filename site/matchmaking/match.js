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
let personnagesBase = [];   // characters.json
let personnagesData = [];   // variantes (Voyageur, Manekin) choisies par le joueur connecté
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
let triActif = null; // "points" | "constellation" | "niveau" | "rarete" | "element" | null (ordre par défaut)

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
let derniereCleVariantes = null;

async function definirDraft(nouveauDraft) {
  // Poll qui renvoie exactement l'état déjà affiché (y compris une mise à
  // jour optimiste) : rien à re-rendre.
  if (draft && joueur1 && joueur2 && JSON.stringify(nouveauDraft) === JSON.stringify(draft)) return;

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

  // Voyageur / Manekin : la grille montre les variantes du joueur connecté
  // (celles de j1 pour un spectateur) ; les picks, celles de leur joueur.
  const parametresVue = getJoueurDataParRole(monRole || "j1")?.parametres;
  const cleVariantes = JSON.stringify([parametresVue?.voyageur, parametresVue?.manekin]);
  if (cleVariantes !== derniereCleVariantes) {
    derniereCleVariantes = cleVariantes;
    personnagesData = appliquerVariantes(personnagesBase, parametresVue);
    document.querySelectorAll(".grille-pool").forEach(grille => delete grille.dataset.cle);
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

// Arme signature : image nommée "[id_personnage]_w.webp". Index construit
// une seule fois (perso -> arme et arme -> perso) au lieu de parcourir la
// liste des armes à chaque carte.
let indexArmesSignature = null;

function trouverArmeSignature(personnageId) {
  if (!indexArmesSignature) {
    indexArmesSignature = new Map();
    armesData.forEach(arme => {
      const m = typeof arme.image === "string" && arme.image.match(/([^/]+)_w\.webp$/);
      if (m) indexArmesSignature.set(m[1], arme);
    });
  }
  return indexArmesSignature.get(personnageId);
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
// Dès que les pools sont calculés (après le choix des box), seuls les
// personnages de la box choisie pour le match comptent comme possédés.
const cachePools = {};

function getPoolMatch(role) {
  const pool = draft?.[`pool_${role}`];
  if (!draft || draft.phase === "choix_box" || !Array.isArray(pool)) return null;
  if (cachePools[role]?.source !== pool) cachePools[role] = { source: pool, set: new Set(pool) };
  return cachePools[role].set;
}

function getConstellation(role, persoId) {
  const pool = getPoolMatch(role);
  if (pool && !pool.has(persoId)) return null;
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
    case "niveau":
      // 100 > 95 > non renseigné ; meilleur niveau parmi les propriétaires.
      return Math.max(0, ...proprietaires.map(r => Number(getNiveauPersonnage(getJoueurDataParRole(r), personnage.id)) || 0));
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
      <img src="../DB/${personnage.image}" alt="${personnage.nom}" loading="lazy" decoding="async">
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

const NAMECARD_DEFAUT = "namecards/Namecard_Background_Default.webp";

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

    // Namecard du joueur (choisie dans Mon compte, sinon celle par défaut)
    // en fond du rectangle.
    const namecard = joueur.data?.parametres?.banniere || NAMECARD_DEFAUT;
    container.classList.add("avec-namecard");
    container.style.setProperty("--namecard", `url("${encodeURI(`/DB/images/${namecard}`)}")`);

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
// En-tête d'un tableau joueur : sa namecard (largeur du tableau) avec photo
// et pseudo ("J1"/"J2" sur téléphone).
// ---- Bannière d'un personnage (namecards/banners/Namecard_Banner_<Nom>_...) ----
// Retrouvée par son nom ; alias quand le fichier porte un autre nom.
// Sans bannière : celle par défaut.

const ALIAS_BANNIERES = { tartaglia: "childe", itto: "itto" };
const BANNIERE_PERSO_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";
let bannieresPersos = [];
const cacheBannieres = new Map();

function normaliserNomFichier(texte) {
  return texte.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function getBannierePersonnage(personnage) {
  if (cacheBannieres.has(personnage.id)) return cacheBannieres.get(personnage.id);
  const cle = ALIAS_BANNIERES[personnage.id] || normaliserNomFichier(personnage.nom);
  const fichier = bannieresPersos.find(chemin => {
    const nom = normaliserNomFichier(chemin.split("/").pop().replace(/^Namecard_Banner_/, "").replace(/\.webp$/, ""));
    return nom === cle || nom.startsWith(`${cle}_`);
  });
  const url = encodeURI(`/DB/images/${fichier || BANNIERE_PERSO_DEFAUT}`);
  if (bannieresPersos.length > 0) cacheBannieres.set(personnage.id, url);
  return url;
}

// Case de tableau (pick ou ban) : personnage sur sa bannière.
function remplirCaseTableau(slot, personnage) {
  slot.classList.add("avec-banniere");
  slot.style.setProperty("--banniere-perso", `url("${getBannierePersonnage(personnage)}")`);
  slot.innerHTML = `<img src="../DB/${personnage.image}" alt="${personnage.nom}" title="${personnage.nom}">`;
}

function titreTableauJoueur(role, nomJoueur) {
  const joueur = role === "j1" ? joueur1 : joueur2;
  const namecard = encodeURI(`/DB/images/${joueur?.data?.parametres?.banniere || NAMECARD_DEFAUT}`);
  const tagRole = draft?.roles_tires ? `<span class="tag-role">${role.toUpperCase()}</span>` : "";
  return `
    <div class="namecard-tableau" style="--namecard: url(&quot;${namecard}&quot;)">
      ${joueur?.avatar ? `<img class="avatar-tableau" src="${joueur.avatar}" alt="">` : ""}
      <span class="nom-complet">${nomJoueur}</span>
      <span class="nom-court">${role.toUpperCase()}</span>
      ${tagRole}
    </div>
  `;
}

function rendreSlotsEtBans(role) {
  const nomJoueur = role === "j1" ? joueur1.nom : joueur2.nom;

  const picks = draft.actions.filter(a => a.type === "pick" && a.joueur === role).map(a => a.perso_id);
  // Les bans bonus d'équilibrage ont leur propre bloc (au-dessus du tableau
  // du joueur qui les a faits) : on ne les remet pas ici.
  const bans = draft.actions.filter(a => a.type === "ban" && a.joueur === role && !a.bonus).map(a => a.perso_id);

  const slotsContainer = document.getElementById(`slots-pick-${role}`);
  slotsContainer.innerHTML = titreTableauJoueur(role, nomJoueur);

  for (let i = 0; i < 4; i++) {
    const persoId = picks[i];
    const slot = document.createElement("div");

    if (persoId) {
      slot.className = "slot-pick";
      remplirCaseTableau(slot, appliquerVariante(getPersonnageParId(persoId), getJoueurDataParRole(role)?.parametres));
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
      remplirCaseTableau(slot, personnage);
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
// Bans d'équilibrage : bloc au-dessus du tableau du joueur qui les a faits.
function rendreBansEquilibrage() {
  ["j1", "j2"].forEach(role => {
    const bans = draft.actions.filter(a => a.bonus && a.joueur === role);
    const bloc = document.getElementById(`bans-eq-${role}`);
    bloc.classList.toggle("cache", bans.length === 0);

    const grille = document.getElementById(`bans-eq-grille-${role}`);
    grille.innerHTML = "";
    bans.forEach(a => {
      const personnage = getPersonnageParId(a.perso_id);
      if (personnage) grille.appendChild(creerBanMini(personnage));
    });
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
      appliquerFondRoom();
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

  rendreBansEquilibrage();

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

// --taille-carte converti en px (la variable CSS est en rem, cf. l'échelle
// du site dans commun/entete.css).
function lireTailleCarte() {
  const racine = getComputedStyle(document.documentElement);
  const valeur = racine.getPropertyValue("--taille-carte").trim();
  const nombre = parseFloat(valeur);
  return valeur.endsWith("rem") ? nombre * (parseFloat(racine.fontSize) || 16) : nombre;
}

// Écart minimal entre les cartes, à la même échelle que le reste du site.
function lireEcartMin() {
  return ECART_MIN_GRILLE * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16;
}

function ajusterGrille(grille) {
  const largeur = grille.clientWidth;
  if (!largeur) return;

  let taille = lireTailleCarte() || 130;
  const ecartMin = lireEcartMin();
  let colonnes;

  if (MEDIA_TELEPHONE.matches) {
    colonnes = COLONNES_TELEPHONE;
    taille = Math.floor((largeur - (colonnes + 1) * ecartMin) / colonnes);
    grille.style.setProperty("--taille-carte", `${taille}px`);
  } else {
    grille.style.removeProperty("--taille-carte");
    colonnes = Math.max(1, Math.floor((largeur - ecartMin) / (taille + ecartMin)));
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

  // Éléments, étoiles et J1/J2 regroupés : sur téléphone, ce bloc reste figé
  // en haut de l'écran pendant la draft (cf. CSS .filtres-figeables).
  const figeables = document.createElement("div");
  figeables.className = "filtres-figeables";
  container.appendChild(figeables);

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
  figeables.appendChild(zoneIcones);

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
  figeables.appendChild(zoneEtoiles);

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
  figeables.appendChild(zoneProprio);

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
  [["points", "Points"], ["constellation", "Constel."], ["niveau", "Niveau"], ["rarete", "Rareté"], ["element", "Élément"]].forEach(([valeur, label]) => {
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
// ---- Phases 4 et 5 : récap des équipes ----
// Tableau de chaque joueur : namecard, zone du temps, puis ses personnages
// avec les mêmes infos qu'en draft (constellation, niveau, arme ; j1 à
// gauche, j2 à droite). Boss au centre.

// Case du récap : personnage sur sa bannière (comme en draft) + ses infos
// chez ce joueur (constellation, niveau, arme signature).
function creerCaseRecap(personnage, role) {
  const slot = document.createElement("div");
  slot.className = "slot-pick";
  remplirCaseTableau(slot, appliquerVariante(personnage, getJoueurDataParRole(role)?.parametres));

  const suffixe = role === "j1" ? "J1" : "J2";
  const infos = getInfosCarte(personnage.id, [role]);
  const iconeArme = iconesTypesArmesSignature[personnage.arme];
  const refinement = infos[`refinement${suffixe}`];

  const zoneInfos = document.createElement("div");
  zoneInfos.className = `infos-case infos-${role}`;
  zoneInfos.innerHTML = [
    infos[`constellation${suffixe}`] ? `<span class="pastille-case">${infos[`constellation${suffixe}`]}</span>` : "",
    infos[`niveau${suffixe}`] ? `<span class="pastille-case">${infos[`niveau${suffixe}`]}</span>` : "",
    refinement !== null && refinement !== undefined && iconeArme
      ? `<img class="arme-case" src="${iconeArme}" alt="R${refinement + 1}" title="Arme signature R${refinement + 1}" style="--couleur-ref: ${COULEURS_REFINEMENT[refinement] || COULEURS_REFINEMENT[0]}">`
      : ""
  ].join("");
  // Côté extérieur : à gauche de l'icône pour j1, à droite pour j2 (la case
  // de j2 est en miroir).
  slot.prepend(zoneInfos);
  return slot;
}

function rendreTableauRecap(role) {
  const joueur = role === "j1" ? joueur1 : joueur2;
  const zone = document.getElementById(`recap-temps-${role}`);

  // Namecard redessinée seulement si elle change ; la zone du temps (et le
  // champ de saisie qu'elle contient) est posée DANS la namecard, sans être
  // recréée (le texte tapé n'est pas perdu aux rafraîchissements).
  const entete = document.getElementById(`recap-entete-${role}`);
  const cleEntete = JSON.stringify([joueur.nom, joueur.avatar, joueur.data?.parametres?.banniere, draft.roles_tires]);
  if (entete.dataset.cle !== cleEntete) {
    entete.dataset.cle = cleEntete;
    zone.remove();
    entete.innerHTML = titreTableauJoueur(role, joueur.nom);
  }
  const namecard = entete.querySelector(".namecard-tableau");
  if (zone.parentElement !== namecard) namecard.appendChild(zone);

  // Personnages : reconstruits seulement si les picks changent.
  const picks = draft.actions.filter(a => a.type === "pick" && a.joueur === role).map(a => a.perso_id);
  const grille = document.getElementById(`recap-persos-${role}`);
  if (grilleAChange(grille, picks.join(","))) {
    picks.forEach(id => {
      const personnage = getPersonnageParId(id);
      if (personnage) grille.appendChild(creerCaseRecap(personnage, role));
    });
  }

  // Temps : champ de saisie dans la namecard du joueur connecté pendant la
  // saisie ; sinon un texte (temps de l'adversaire masqué jusqu'au résultat).
  const temps = draft[`temps_${role}`];
  const saisie = document.getElementById("saisie-temps");
  const saisieIci = draft.phase === "temps" && role === monRole && !temps;

  let texte = "";
  if (draft.phase === "termine") {
    texte = temps ? `Temps : ${temps.affiche}` : "";
  } else if (role === monRole) {
    texte = temps ? `Ton temps : ${temps.affiche}` : "";
  } else {
    texte = temps ? "Temps enregistré ✓" : "En attente de son temps…";
  }

  let ligne = zone.querySelector(".texte-temps");
  if (!ligne) {
    ligne = document.createElement("div");
    ligne.className = "texte-temps";
    zone.prepend(ligne);
  }
  ligne.textContent = texte;
  ligne.classList.toggle("cache", !texte);

  if (saisieIci && saisie.parentElement !== zone) zone.appendChild(saisie);
  if (role === monRole) saisie.classList.toggle("cache", !saisieIci);

  document.getElementById(`recap-equipe-${role}`).classList.toggle(
    "gagnant", draft.phase === "termine" && draft.vainqueur === role
  );
}

function rendreRecap() {
  assurerBossAffiche();
  rendreTableauRecap("j1");
  rendreTableauRecap("j2");
  if (!monRole) document.getElementById("saisie-temps").classList.add("cache");

  const boss = bossData.find(b => b.id === draft.boss_id);
  const blocBoss = document.getElementById("recap-boss");
  const cleBoss = boss ? boss.id : "";
  if (blocBoss.dataset.cle !== cleBoss) {
    blocBoss.dataset.cle = cleBoss;
    blocBoss.innerHTML = boss
      ? `<img src="../DB/${boss.image}" alt="${boss.nom}"><span class="nom-boss">${boss.nom}</span>`
      : "";
  }

  const termine = draft.phase === "termine";
  document.getElementById("resultat-final").classList.toggle("cache", !termine);
  document.getElementById("btn-rejouer").classList.toggle("cache", !termine);
}

function rendreTemps() {
  rendreRecap();

  const monTemps = draft[`temps_${monRole}`];
  const tempsAdversaire = draft[`temps_${getAutreRole(monRole)}`];

  const input = document.getElementById("input-temps");
  const btn = document.getElementById("btn-valider-temps");
  const etat = document.getElementById("etat-temps");

  input.disabled = !!monTemps;
  btn.disabled = !!monTemps;

  if (monTemps && !tempsAdversaire) {
    etat.textContent = "Temps enregistré. En attente du temps de l'adversaire…";
  } else if (!monTemps) {
    etat.textContent = "Entre ton temps en minutes et secondes (ex : 7:32, 7,32 ou 7.32).";
  } else {
    etat.textContent = "";
  }

  btn.onclick = () => {
    // "7,32" et "7.32" (clavier numérique du téléphone) valent "7:32".
    const valeur = input.value.trim().replace(/[.,]/, ":");
    if (!/^[0-9]{1,3}:[0-5][0-9]$/.test(valeur)) {
      alert("Format invalide. Entre les minutes puis les secondes sur 2 chiffres, par exemple 7:32, 7,32 ou 7.32.");
      return;
    }
    postTemps(valeur).catch(err => alert(err.message));
  };
}

// ---- Phase 5 : résultat ----

function rendreTermine() {
  rendreRecap();
  const container = document.getElementById("resultat-final");

  // Résultat au-dessus du boss (les temps sont dans les tableaux).
  let ligneVainqueur;
  if (draft.vainqueur === "egalite") {
    ligneVainqueur = `<span class="egalite">Égalité !</span>`;
  } else if (monRole) {
    const gagne = draft.vainqueur === monRole;
    ligneVainqueur = `<span class="${gagne ? "vainqueur" : "perdant"}">${gagne ? "Tu as gagné !" : "Tu as perdu."}</span>`;
  } else {
    const nomGagnant = draft.vainqueur === "j1" ? joueur1.nom : joueur2.nom;
    ligneVainqueur = `<span class="vainqueur">${nomGagnant} gagne !</span>`;
  }

  container.innerHTML = `
    <p class="ligne-vainqueur">${ligneVainqueur}</p>
    <p class="ligne-temps">${joueur1.nom} : ${draft.temps_j1.affiche} — ${joueur2.nom} : ${draft.temps_j2.affiche}</p>
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

// ---- Fond d'écran de la room ----
// Fond par défaut, puis, une fois le boss tiré (et son animation finie), une
// des images de DB/images/bg_web/boss_hebdo/ nommées "<boss>_<n>" (id du
// boss sans "_boss"). Le choix dépend de la room et du boss : les deux
// joueurs voient la même image.

const FOND_ROOM_DEFAUT = "/DB/images/bg_web/autres/default_bg.webp";
let fondsBoss = null;
let fondRoomApplique = null;

// cosmetiques.json : fonds des boss + bannières des personnages.
async function chargerFondsBoss() {
  try {
    const reponse = await fetch("/DB/images/cosmetiques.json");
    const cosmetiques = await reponse.json();
    fondsBoss = cosmetiques.fonds.filter(fond => fond.categorie === "boss_hebdo");
    bannieresPersos = cosmetiques.bannieres2 || [];
  } catch (erreur) {
    console.error(erreur);
    fondsBoss = [];
    bannieresPersos = [];
  }
}

function hashTexte(texte) {
  let h = 0;
  for (const caractere of texte) h = (h * 31 + caractere.charCodeAt(0)) >>> 0;
  return h;
}

function appliquerFondRoom() {
  let url = FOND_ROOM_DEFAUT;

  if (draft?.boss_id && fondsBoss && !animationBossEnCours) {
    const prefixe = draft.boss_id.replace(/_boss$/, "");
    const images = fondsBoss.filter(fond => fond.image.split("/").pop().replace(/_\d+\.webp$/, "") === prefixe);
    if (images.length > 0) {
      const choisi = images[hashTexte(`${roomId}:${draft.boss_id}`) % images.length];
      url = encodeURI(`/DB/images/${choisi.image}`);
    }
  }

  if (url !== fondRoomApplique) {
    fondRoomApplique = url;
    document.body.style.setProperty("--fond-ecran", `url("${url}")`);
  }
}

function rendrePhase() {
  appliquerFondRoom();

  const phasePrecedente = dernierePhaseVue;
  dernierePhaseVue = draft.phase;

  rendreEntetesJoueurs();

  document.querySelectorAll(".phase").forEach(el => el.classList.add("cache"));

  const idsParPhase = {
    choix_box: "phase-choix-box",
    analyse: "phase-choix-box",
    bans_bonus: "phase-bans-bonus",
    draft: "phase-draft",
    temps: "phase-recap",
    termine: "phase-recap"
  };

  const idAffiche = idsParPhase[draft.phase];
  if (!idAffiche) return;

  document.getElementById(idAffiche).classList.remove("cache");

  // Boss tiré (draft, temps) : entêtes réduites à 1/3 de leur largeur, le
  // boss occupe le centre libéré (et déborde vers le bas pendant la draft).
  // Temps / résultat : le boss est au centre du récap, plus d'entêtes.
  const avecBoss = draft.phase === "draft";
  const enRecap = draft.phase === "temps" || draft.phase === "termine";
  const entetes = document.querySelector(".entetes-joueurs");
  entetes.classList.toggle("cache", enRecap);
  entetes.classList.toggle("compact", avecBoss);
  entetes.classList.toggle("boss-deborde", draft.phase === "draft");
  // Boss tiré : plus de rectangles joueurs (namecard, photo et pseudo sont
  // en haut des tableaux).
  entetes.classList.toggle("sans-joueurs", avecBoss);
  // Draft sur ordi : tableaux à gauche / droite (figés), boss, filtres et
  // grille au centre (cf. CSS #zone-match.mode-draft).
  document.getElementById("zone-match").classList.toggle("mode-draft", draft.phase === "draft");
  document.getElementById("entete-centre").classList.toggle("cache", !avecBoss);

  // Bulles du bas : seules celles de la phase en cours sont visibles.
  Object.entries(BULLES_PAR_PHASE).forEach(([id, phases]) => {
    document.getElementById(id).classList.toggle("hors-phase", !phases.includes(draft.phase));
  });

  const avecPersos = ["choix_box", "analyse", "bans_bonus", "draft"].includes(draft.phase);
  document.getElementById("barre-outils").classList.toggle("cache", !avecPersos);
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

// ---- Partage du lien de la room (copié dans le presse-papiers) ----

function initialiserPartage() {
  const bouton = document.getElementById("btn-partager");
  const texteInitial = bouton.textContent;

  bouton.addEventListener("click", async () => {
    const lien = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(lien);
      bouton.textContent = "Lien copié ✓";
    } catch {
      // Presse-papiers indisponible : on affiche le lien à copier à la main.
      window.prompt("Copie ce lien et envoie-le à ton adversaire :", lien);
    }
    setTimeout(() => { bouton.textContent = texteInitial; }, 2000);
  });
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
    initialiserPartage();

    appliquerFondRoom();

    [personnagesBase, bossData, armesData] = await Promise.all([
      chargerPersonnages(),
      chargerBoss(),
      chargerArmes(),
      chargerFondsBoss()
    ]);
    personnagesData = personnagesBase;

    initialiserFiltresTri();
    initialiserGrillesPersos();

    await tick();

    intervalPolling = setInterval(tick, POLL_INTERVAL_MS);

    // Onglet masqué : plus de requêtes ; au retour, état rafraîchi tout de
    // suite puis polling normal.
    document.addEventListener("visibilitychange", () => {
      clearInterval(intervalPolling);
      intervalPolling = null;
      if (!document.hidden) {
        tick();
        intervalPolling = setInterval(tick, POLL_INTERVAL_MS);
      }
    });
  } catch (error) {
    console.error(error);
    alert(error.message || "Erreur lors du chargement du match.");
  }
}

demarrer();