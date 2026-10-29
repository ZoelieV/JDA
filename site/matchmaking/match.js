// Logos des filtres d'élément : même liste (et même ordre) que les tris
// (commun/tri.js), sans "all" (Voyageur / Manekin).
const iconesElements = Object.fromEntries(
  Object.entries(ICONES_ELEMENTS_TRI).filter(([element]) => element !== "all")
);

const BOX_LABELS = {
  full: "Full box",
  stuff: "Stuff",
  opti1: "Opti 1",
  opti2: "Opti 2",
  opti3: "Opti 3",
  opti4: "Opti 4",
  opti5: "Opti 5",
  custom: "Personnalisée" // entraînement seulement
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

// Relecture de la draft : toutes les 2,5 s, plus lentement dans les
// phases où rien ne change pendant des minutes (combat, fin de manche) ;
// chaque relecture coûte un appel Vercel et une lecture Supabase. Toujours
// sous PRESENCE_JOUEUR_MS (15 s, api/rooms/[room_id]/[action].js).
const POLL_INTERVAL_MS = 2500;
const POLL_LENT_MS = { temps: 6000, verification: 4000, termine: 6000, litige: 6000, annule: 10000 };

function delaiPolling() {
  return POLL_LENT_MS[draft?.phase] || POLL_INTERVAL_MS;
}

let roomId = null;
let typeRoom = "prive"; // "prive" | "matchmaking" | "classe" (trophées en fin de match)
let moiDiscordId = null;
let monRole = null; // "j1" | "j2" | null (spectateur)
let personnagesBase = [];   // characters.json (un Voyageur par élément)
let personnagesData = [];   // catalogue de draft (un seul Voyageur), variantes (Voyageur, Manekin) du joueur connecté
let armesData = [];
let bossData = [];
let draft = null;
let intervalPolling = null; // minuteur de la prochaine relecture (cf. programmerPolling)
let pollingActif = false;

// Données des 2 joueurs : { discordId, nom, avatar, data } ou null.
// j1/j2 sont les rôles DE LA MANCHE EN COURS (draft.discord_j1/discord_j2),
// tirés au sort côté serveur puis échangés à chaque revanche — pas
// forcément "qui a créé la room".
let joueur1 = null;
let joueur2 = null;

// ---- Filtres / recherche / tris de la grille de draft ----
// Filtre élément : ordre des clics = ordre des groupes. Tris combinables :
// cf. commun/tri.js.
const filtreElement = new Set();
const filtreEtoile = new Set();
const filtreVoeux = new Set();
const filtreFactions = new Set();
// Rôles (bouclier, soin) : cumulables, ordre des clics = ordre des groupes.
const filtreSoutiens = new Set();
const filtreArme = new Set();
// Choix de box / analyse : personnages seulement, armes seulement, ou les
// deux (null).
let filtreVue = null; // "characters" | "weapons" | null
let filtreProprietaire = null; // "j1" | "j2" | null
// Persos en commun ("commun", =) ou différents ("difference", Δ : ceux de
// j1 seul, puis ceux de j2 seul, à la ligne). Exclusif avec J1 / J2.
let filtrePossession = null;
let rechercheTexte = "";
const etatTri = creerEtatTri();

// Draft : personnage sélectionné dans la grille, envoyé au clic sur
// "Confirmer". { persoId, element, index (sequence_index) } ou null.
let selectionDraft = null;

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

async function chargerSessionUtilisateur() {
  const reponse = await fetch("/api/auth/me", { credentials: "include" });
  if (!reponse.ok) return null;
  const data = await reponse.json();
  return data.authenticated ? data.user : null;
}

// Venu de l'historique (?spectateur=1) : on regarde, sans jamais prendre la
// place du second joueur d'un match privé.
function enSpectateurVoulu() {
  return new URLSearchParams(window.location.search).get("spectateur") === "1";
}

async function rejoindreOuConsulterRoom(id) {
  const reponse = await fetch(`/api/rooms/${id}${enSpectateurVoulu() ? "?spectateur=1" : ""}`, {
    method: "POST",
    credentials: "include"
  });

  if (reponse.status === 401) throw new Error("Tu dois être connecté avec Discord.");
  if (reponse.status === 404) throw new Error("Cette room n'existe pas.");

  // Room en mode classique / auto sans théâtre renseigné : direction Mon
  // compte pour le renseigner. Match classé en cours (room_id) : retour à
  // ce match, ou abandon puis nouvel essai (cf. proposerAbandonClasse,
  // commun/cartes.js, qui ne revient qu'après un abandon).
  if (reponse.status === 409) {
    const { error, room_id: matchEnCours } = await reponse.json().catch(() => ({}));
    arreterPolling();
    if (matchEnCours) {
      await proposerAbandonClasse(matchEnCours);
      return rejoindreOuConsulterRoom(id);
    }
    alert(error || "Impossible de rejoindre cette room.");
    window.location.href = "/compte";
    throw new Error(error || "Impossible de rejoindre cette room.");
  }

  if (reponse.status === 403) {
    const consult = await fetch(`/api/rooms/${id}`, { credentials: "include" });
    if (!consult.ok) throw new Error("Impossible de consulter la room.");
    return await consult.json();
  }

  if (!reponse.ok) throw new Error("Erreur en accédant à la room.");
  return await reponse.json();
}

// Box opti : privées, envoyées par le serveur pour cette room seulement une
// fois révélées (cf. api/accounts/[discord_id].js).
async function chargerCompte(discordId) {
  const reponse = await fetch(`/api/accounts/${discordId}?room=${encodeURIComponent(roomId)}`);
  if (!reponse.ok) throw new Error("Impossible de charger ce compte.");
  return await reponse.json();
}

// Joueur d'un rôle et box révélée (pools calculés après le choix des box).
function cleChargementJoueur(role) {
  const revelee = draft.phase !== "choix_box" && Array.isArray(draft[`pool_${role}`]);
  return `${draft[`discord_${role}`]}|${revelee ? draft[`box_${role}`] || "" : ""}`;
}

async function chargerJoueurDepuisId(discordId) {
  if (!discordId) return null;
  const compte = await chargerCompte(discordId);
  // Ancien Voyageur unique -> Voyageur Anemo (cf. commun/variantes.js).
  migrerCollectionPersos(compte.data?.characters);
  const nom = compte.discord_global_name || compte.discord_username || "Utilisateur inconnu";
  return {
    discordId: compte.discord_id,
    nom,
    pseudo: htmlPseudo(nom), // nom en HTML (échappé, police des pseudos)
    avatar: compte.discord_avatar_url,
    data: compte.data
  };
}

async function chargerDraft() {
  const reponse = await fetch(`/api/rooms/${roomId}/draft`, { credentials: "include" });
  if (!reponse.ok) throw new Error("Impossible de charger l'état de la draft.");
  const data = await reponse.json();
  calerHeureServeur(data);
  return data;
}

// ---- Heure du serveur : les chronos de la draft classée sont calculés
// dessus (écart avec l'horloge de l'appareil, mis à jour à chaque réponse).
let decalageServeur = 0;

function calerHeureServeur(data) {
  if (Number.isFinite(data?.maintenant)) decalageServeur = data.maintenant - Date.now();
}

function heureServeur() {
  return Date.now() + decalageServeur;
}

// ---- Actions (POST) ----

async function envoyerAction(url, body) {
  const reponse = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    // agir_en : rôle joué (entraînement seul, ignoré sinon).
    body: JSON.stringify({ ...(body || {}), agir_en: monRole })
  });

  const data = await reponse.json().catch(() => ({}));

  if (!reponse.ok) {
    throw new Error(data.error || "Erreur lors de l'action.");
  }

  calerHeureServeur(data);
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

async function postEquilibrageVote(choix) {
  const data = await envoyerAction(`/api/rooms/${roomId}/equilibrage_vote`, { choix });
  await definirDraft(data.draft);
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

async function postActionDraft(persoId, element = null) {
  const data = await envoyerAction(`/api/rooms/${roomId}/action`, { perso_id: persoId, element });
  await definirDraft(data.draft);
}

// Entraînement : retour au coup précédent (dernier ban / pick annulé).
async function postAnnulerCoup() {
  const data = await envoyerAction(`/api/rooms/${roomId}/annuler_action`, {});
  selectionDraft = null;
  await definirDraft(data.draft);
}

// joker : ban joker choisi tout de suite (cf. modeJokerBonus).
async function postBonusToggle(persoId, joker = false) {
  const data = await envoyerAction(`/api/rooms/${roomId}/bonus_toggle`, { perso_id: persoId, ...(joker ? { joker: true } : {}) });
  await definirDraft(data.draft);
}

async function postBonusEchanger(annuler) {
  const data = await envoyerAction(`/api/rooms/${roomId}/bonus_echanger`, { annuler });
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

async function postTempsEntrainement(temps) {
  const data = await envoyerAction(`/api/rooms/${roomId}/temps_entrainement`, { temps });
  await definirDraft(data.draft);
}

async function postAbandon() {
  const data = await envoyerAction(`/api/rooms/${roomId}/temps`, { abandon: true });
  await definirDraft(data.draft);
}

// Abandon à la place d'un temps, après confirmation.
function declarerAbandon() {
  if (!confirm(`Déclarer un abandon ? Si ton adversaire a ${motsResultat().un}, il gagne ; s'il abandonne aussi, c'est une égalité.`)) return;
  postAbandon().catch(err => alert(err.message));
}

async function postConfirmerTemps() {
  const data = await envoyerAction(`/api/rooms/${roomId}/confirmer_temps`, {});
  await definirDraft(data.draft);
}

async function postLitige(commentaire) {
  const data = await envoyerAction(`/api/rooms/${roomId}/litige`, { commentaire });
  await definirDraft(data.draft);
}

// ---- Signaler un litige : raison obligatoire (500 caractères au plus,
// même limite que le serveur, cf. handleLitige) ----
const COMMENTAIRE_LITIGE_MAX = 500;

function ouvrirFenetreLitige() {
  const fenetre = document.getElementById("fenetre-litige");
  const champ = document.getElementById("commentaire-litige");
  champ.value = "";
  mettreAJourFenetreLitige();
  fenetre.classList.remove("cache");
  champ.focus();
}

function fermerFenetreLitige() {
  document.getElementById("fenetre-litige").classList.add("cache");
}

function mettreAJourFenetreLitige() {
  const longueur = document.getElementById("commentaire-litige").value.trim().length;
  document.getElementById("compteur-litige").textContent = `${document.getElementById("commentaire-litige").value.length} / ${COMMENTAIRE_LITIGE_MAX}`;
  document.getElementById("envoyer-litige").disabled = longueur === 0;
}

function initialiserFenetreLitige() {
  const fenetre = document.getElementById("fenetre-litige");
  const champ = document.getElementById("commentaire-litige");
  champ.maxLength = COMMENTAIRE_LITIGE_MAX;
  champ.addEventListener("input", mettreAJourFenetreLitige);
  document.getElementById("annuler-litige").addEventListener("click", fermerFenetreLitige);
  fenetre.addEventListener("click", event => {
    if (event.target === fenetre) fermerFenetreLitige();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !fenetre.classList.contains("cache")) fermerFenetreLitige();
  });
  document.getElementById("envoyer-litige").addEventListener("click", async () => {
    const bouton = document.getElementById("envoyer-litige");
    const commentaire = champ.value.trim();
    if (!commentaire) return;
    bouton.disabled = true;
    try {
      await postLitige(commentaire);
      fermerFenetreLitige();
    } catch (erreur) {
      alert(erreur.message);
      bouton.disabled = false;
    }
  });
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

  const nbActionsAvant = draft?.actions?.length ?? null;
  draft = nouveauDraft;
  if (nbActionsAvant !== null) annoncerChoixAleatoires((draft.actions || []).slice(nbActionsAvant));

  // Nouvelle manche (boss pas encore tiré) : on réarme l'animation pour le
  // prochain tirage, y compris si le prochain boss tiré tombe à nouveau sur
  // le même que la manche précédente (sinon nouveauBoss resterait faux).
  if (!draft.boss_id) {
    bossAnimeId = null;
  }

  // Profil rechargé aussi quand la box jouée est révélée (box opti
  // envoyées seulement à partir de là, cf. chargerCompte).
  if (draft.discord_j1 && joueur1?.cle !== cleChargementJoueur("j1")) {
    joueur1 = { ...await chargerJoueurDepuisId(draft.discord_j1), cle: cleChargementJoueur("j1") };
  }
  if (draft.discord_j2 && joueur2?.cle !== cleChargementJoueur("j2")) {
    joueur2 = { ...await chargerJoueurDepuisId(draft.discord_j2), cle: cleChargementJoueur("j2") };
  }
  if (draft.discord_j1 && draft.discord_j2) {
    // Ni j1 ni j2 : spectateur (lecture seule, filtres et tris utilisables).
    monRole = moiDiscordId === draft.discord_j1 ? "j1" : moiDiscordId === draft.discord_j2 ? "j2" : null;
    // Entraînement seul : rôle qui doit agir.
    if (monRole && estEntrainementSolo()) monRole = roleActifSolo();
  }
  if (draft.entrainement) {
    await chargerBoxesEntrainement();
    appliquerIdentitesEntrainement();
  }

  // Voyageur / Manekin : la grille montre les variantes du joueur connecté
  // (celles de j1 pour un spectateur) ; les picks, celles de leur joueur.
  const parametresVue = getJoueurDataParRole(monRole || "j1")?.parametres;
  const cleVariantes = JSON.stringify([parametresVue?.voyageur, parametresVue?.manekin]);
  if (cleVariantes !== derniereCleVariantes) {
    derniereCleVariantes = cleVariantes;
    // Logo du filtre Personnages : tête du même Voyageur que la grille.
    const logoPersonnages = document.querySelector('#filtres-vue [data-vue="characters"] img');
    if (logoPersonnages) logoPersonnages.src = `../DB/${getIconeVuePersonnages(parametresVue)}`;
    personnagesData = appliquerVariantes(regrouperPourDraft(personnagesBase), parametresVue);
    document.querySelectorAll(".grille-pool").forEach(grille => delete grille.dataset.cle);
  }

  rendrePhase();
}

// ---- Helpers d'affichage personnages ----

function getPersonnageParId(id) {
  return personnagesData.find(p => p.id === id) || null;
}

// Données de la box jouée par un rôle (profil du joueur ; en entraînement,
// celui de la personne simulée, cf. appliquerIdentitesEntrainement).
function getJoueurDataParRole(role) {
  return role === "j1" ? joueur1?.data : joueur2?.data;
}

// Box de l'adversaire (et des 2 joueurs pour un spectateur) : ni les noms
// donnés à ses box dans Mon compte, ni laquelle de ses box opti il a
// choisie (seulement "Opti"). Entraînement : box fixées à la création, rien
// de caché.
const LIBELLE_OPTI_CACHEE = "Opti";
const estBoxOpti = box => /^opti\d$/.test(box || "");

function boxCachee(role) {
  return !draft?.entrainement && role !== monRole;
}

// Première box opti proposée à ce joueur : celle qui porte le bouton "Opti".
function premiereOpti(role, permises) {
  return Object.keys(BOX_LABELS).find(box => estBoxOpti(box) && (!permises || permises.includes(box)));
}

// ---- Mode entraînement (cf. creerEntrainement, api/rooms/index.js) ----
// Box choisies à la création (celles du lanceur, d'un autre joueur, ou
// personnalisées). Seul, le lanceur tient les 2 rôles : monRole suit le
// rôle qui doit agir (envoyé au serveur dans agir_en).
let donneesBoxes = null; // { cle, moi, adverse } : { data, nom, avatar } des 2 box

function coteEntrainement(role) {
  return role === draft.entrainement.cote_moi ? "moi" : "adverse";
}

function estEntrainementSolo() {
  return !!draft?.entrainement && draft.discord_j1 === draft.discord_j2;
}

function roleActifSolo() {
  switch (draft.phase) {
    case "draft": return getProchaineActionLocale()?.joueur || "j1";
    case "bans_bonus": return acteurBansBonus() || "j1";
    case "temps": return !draft.temps_j1 ? "j1" : !draft.temps_j2 ? "j2" : "j1";
    case "verification": return !draft.temps_confirme_j1 ? "j1" : !draft.temps_confirme_j2 ? "j2" : "j1";
    default: return "j1";
  }
}

// Box personnalisée : persos et armes cochés ajoutés comme sélection
// "custom" (même règle que donneesBoxRole, api/_lib/boxes.js).
function donneesBox(profilData, source) {
  if (source.box !== "custom") return profilData;
  const characters = profilData?.characters || {};
  const weapons = profilData?.weapons || {};
  return {
    ...profilData,
    characters: { ...characters, selections: { ...(characters.selections || {}), custom: Object.fromEntries((source.persos || []).map(id => [id, true])) } },
    weapons: { ...weapons, selections: { ...(weapons.selections || {}), custom: Object.fromEntries((source.armes || []).map(instance => [instance, true])) } }
  };
}

async function chargerBoxesEntrainement() {
  const cle = JSON.stringify(draft.entrainement.boxes);
  if (donneesBoxes?.cle === cle) return;
  const [moi, adverse] = await Promise.all(["moi", "adverse"].map(async cote => {
    const source = draft.entrainement.boxes[cote];
    const compte = await chargerCompte(source.proprietaire);
    migrerCollectionPersos(compte.data?.characters);
    return {
      data: donneesBox(compte.data, source),
      nom: compte.discord_global_name || compte.discord_username || source.nom,
      avatar: compte.discord_avatar_url
    };
  }));
  donneesBoxes = { cle, moi, adverse };
}

// On joue à la place des propriétaires des box : pseudo, photo, namecard,
// bannière, médaille et box de la personne simulée pour chaque rôle
// (discordId : celui du joueur présent, pour le suivi des rôles).
function appliquerIdentitesEntrainement() {
  ["j1", "j2"].forEach(role => {
    const box = donneesBoxes[coteEntrainement(role)];
    const simule = { discordId: draft[`discord_${role}`], cle: cleChargementJoueur(role), nom: box.nom, avatar: box.avatar, pseudo: htmlPseudo(box.nom), data: box.data };
    if (role === "j1") joueur1 = simule;
    else joueur2 = simule;
  });
}

// Pseudo du joueur d'un rôle, dans la couleur de son rôle (bleu J1, rouge
// J2) : bulles de consignes du bas ("À ... de bannir", "En attente : ...").
function pseudoColore(role) {
  const joueur = role === "j1" ? joueur1 : joueur2;
  return `<span class="nom-${role}">${joueur?.pseudo || role.toUpperCase()}</span>`;
}

function libelleBoxEntrainement(role) {
  const source = draft.entrainement.boxes[coteEntrainement(role)];
  return `${BOX_LABELS[source.box] || source.box} de ${htmlPseudo(source.nom)}`;
}

// Raffinement (0 = R1 ... 4 = R5) de l'arme signature d'un personnage chez
// un joueur (meilleure copie de la box de son rôle), ou null s'il ne la
// possède pas.
function getRefinementArmeSignature(role, personnageId) {
  const personnage = getPersonnageParId(personnageId);
  const arme = personnage && trouverArmeSignature(armesData, personnage);
  if (!arme) return null;
  const raffinement = Math.max(-1, ...getArmesBox(getJoueurDataParRole(role), draft?.[`box_${role}`] || "full")
    .filter(copie => copie.id === arme.id).map(copie => copie.raffinement));
  return raffinement >= 0 ? raffinement : null;
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

// Constellation et points d'un perso chez un joueur (bonus du niveau 95 /
// 100 et du théâtre compris, cf. pointsPersonnage ; malus de synergie dans
// sa box, cf. pointsPersonnageBox), ou null s'il ne l'a pas. Voyageur : un par élément dans les comptes, un seul en draft ; on
// garde l'élément qui vaut le plus de points parmi ceux de sa box (ou
// l'élément donné, une fois pické).
function getPossession(role, persoId, element = null) {
  const pool = getPoolMatch(role);
  if (pool && !pool.has(persoId)) return null;

  const collection = getJoueurDataParRole(role)?.characters;
  const membres = membresGroupe(personnagesBase, persoId);
  // Niveau commun au groupe (Voyageur) : clé = id de la draft.
  const niveau = collection?.niveaux?.[persoId] ?? null;
  const box = draft?.[`box_${role}`];
  // Persos de sa box (synergies) : pool du match, sinon box choisie.
  const presents = pool || idsDraftCollection(collection, personnagesBase, box || "full");

  if (membres.length === 0) {
    const c = collection?.full?.[persoId];
    if (typeof c !== "number" || c < 0) return null;
    const personnage = getPersonnageParId(persoId);
    return { valeur: c, points: personnage ? pointsPersonnageBox(personnage, c, niveau, presents) : 0 };
  }

  // Éléments permis : celui pické, sinon ceux de la box du match (calculés
  // par le serveur), sinon ceux de la box choisie (choix de box en cours).
  const permis = element ? [element] : pool ? draft?.[`elements_${role}`]?.[persoId] || [] : null;

  let meilleur = null;
  membres.forEach(membre => {
    const c = collection?.full?.[membre.id];
    if (typeof c !== "number" || c < 0) return;
    if (permis && !permis.includes(membre.element)) return;
    if (!permis && box && box !== "full" && !collection.selections?.[box]?.[membre.id]) return;

    const points = pointsPersonnageBox(membre, c, niveau, presents);
    if (!meilleur || points > meilleur.points || (points === meilleur.points && c > meilleur.valeur)) {
      meilleur = { valeur: c, points, element: membre.element };
    }
  });
  return meilleur;
}

function getConstellation(role, persoId, element = null) {
  return getPossession(role, persoId, element)?.valeur ?? null;
}

// Perso de la box choisie par un joueur (aperçus pendant le choix des box).
function estDansBox(collection, persoId, box) {
  const membres = membresGroupe(personnagesBase, persoId);
  const ids = membres.length ? membres.map(membre => membre.id) : [persoId];
  return ids.some(id => (collection?.full?.[id] ?? -1) >= 0 &&
    (box === "full" || !!collection?.selections?.[box]?.[id]));
}

// Joueurs (parmi roles) qui possèdent le perso. Le filtre J1/J2 restreint
// à ce joueur-là, sauf pour les aperçus de box (une colonne = un joueur).
function getRolesProprietaires(persoId, roles = ["j1", "j2"], avecFiltre = true) {
  const candidats = avecFiltre && filtreProprietaire ? roles.filter(r => r === filtreProprietaire) : roles;
  return candidats.filter(r => getConstellation(r, persoId) !== null);
}

// Infos affichées sur une carte, pour chaque joueur (parmi roles) qui
// possède le perso : constellation, niveau, raffinement de l'arme signature.
function getInfosCarte(persoId, roles = ["j1", "j2"], element = null) {
  const infos = {};
  roles.forEach(role => {
    const constellation = getConstellation(role, persoId, element);
    if (constellation === null) return;
    const data = getJoueurDataParRole(role);
    const suffixe = role === "j1" ? "J1" : "J2";
    infos[`constellation${suffixe}`] = `C${constellation}`;
    infos[`niveau${suffixe}`] = getNiveauPersonnage(data, persoId);
    infos[`refinement${suffixe}`] = getRefinementArmeSignature(role, persoId);
  });
  return infos;
}

// ---- Tris ----
// Points / constellation / niveau : meilleure valeur parmi les
// propriétaires pris en compte (le joueur filtré, sinon les 2).
function getValeursTri(roles) {
  // Aperçu d'une box (un seul joueur) : le filtre J1/J2 ne s'applique pas.
  const possessions = personnage => getRolesProprietaires(personnage.id, roles, roles.length > 1)
    .map(r => getPossession(r, personnage.id));

  return {
    points: personnage => Math.max(-1, ...possessions(personnage).map(p => p.points)),
    constellation: personnage => Math.max(-1, ...possessions(personnage).map(p => p.valeur)),
    // 100 > 95 > non renseigné ; meilleur niveau parmi les propriétaires.
    niveau: personnage => Math.max(0, ...getRolesProprietaires(personnage.id, roles, roles.length > 1)
      .map(r => Number(getNiveauPersonnage(getJoueurDataParRole(r), personnage.id)) || 0)),
    // Arme signature : meilleur raffinement parmi les propriétaires du
    // personnage (-1 : arme non possédée ou pas d'arme signature).
    raffinement: personnage => Math.max(-1, ...getRolesProprietaires(personnage.id, roles, roles.length > 1)
      .map(r => getRefinementArmeSignature(r, personnage.id) ?? -1)),
    favoris: personnage => estFavori(personnage.id) ? 1 : 0,
    bonus_saison: personnage => aBonusSaisonPerso(personnage) ? 1 : 0
  };
}

// Favoris du joueur connecté (cœurs de Mon compte) ; Voyageur : favori si
// un de ses éléments l'est. Aucun pour un spectateur.
function estFavori(persoId) {
  const favoris = monRole ? getJoueurDataParRole(monRole)?.characters?.favoris : null;
  if (!favoris) return false;
  const membres = membresGroupe(personnagesBase, persoId);
  return membres.length ? membres.some(m => favoris[m.id]) : !!favoris[persoId];
}

// Groupes à afficher (cf. trierEtGrouper) ; le filtre J1/J2 compte comme un
// filtre "possédés" (regroupement par rareté par défaut).
function trierPersonnages(personnages, roles = ["j1", "j2"]) {
  return trierEtGrouper(personnages, etatTri, {
    vue: "characters",
    valeurs: getValeursTri(roles),
    elements: filtreElement,
    armes: filtreArme,
    soutiens: filtreSoutiens,
    rareteParDefaut: filtreEtoile.size > 0 || filtreVoeux.size > 0 || filtreFactions.size > 0 || (roles.length > 1 && (!!filtreProprietaire || !!filtrePossession))
  });
}

// Filtres + recherche. ignorerProprietaire : aperçus de box (colonne déjà
// propre à un joueur).
function personnageCorrespondFiltres(personnage, { ignorerProprietaire = false } = {}) {
  if (filtreElement.size > 0 && !filtreElement.has(personnage.element)) return false;
  if (filtreEtoile.size > 0 && !filtreEtoile.has(String(personnage.rarete))) return false;
  if (filtreVoeux.size > 0 && !filtreVoeux.has(getVoeu(personnage))) return false;
  if (filtreFactions.size > 0 && !filtreFactions.has(personnage.faction)) return false;
  if (!correspondSoutiens(personnage, filtreSoutiens)) return false;
  if (filtreArme.size > 0 && !filtreArme.has(personnage.arme)) return false;

  if (filtreProprietaire && !ignorerProprietaire) {
    if (getConstellation(filtreProprietaire, personnage.id) === null) return false;
  }

  // = : possédé par les 2 ; Δ : par un seul des 2.
  if (filtrePossession && !ignorerProprietaire) {
    const nb = ["j1", "j2"].filter(role => getConstellation(role, personnage.id) !== null).length;
    if (filtrePossession === "commun" ? nb !== 2 : nb !== 1) return false;
  }

  if (rechercheTexte.trim()) {
    const q = rechercheTexte.trim().toLowerCase();
    if (!personnage.nom.toLowerCase().includes(q)) return false;
  }

  return true;
}

// ---- Bonus de saison (match classé) : +3 trophées par perso de l'équipe
// coché dans l'admin ; cartes entourées de doré, tri dédié. Voyageur : si
// une de ses versions l'a (l'élément est choisi au pick).
function estMatchClasse() {
  return typeRoom === "classe";
}

function aBonusSaisonPerso(personnage) {
  if (!personnage) return false;
  if (personnage.bonusSaison) return true;
  return membresGroupe(personnagesBase, personnage.id).some(membre => membre.bonusSaison);
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
  refinementJ2 = null,
  selectionnee = false,
  titre = null,
  omni = false
} = {}) {
  const card = document.createElement("div");
  card.title = titre || personnage.nom;
  card.className = "character-card" +
    (estMatchClasse() && aBonusSaisonPerso(personnage) ? " bonus-saison" : "") +
    (selectionnable ? " selectionnable" : "") +
    (indisponible ? " indisponible" : "") +
    (selectionnee ? " selectionnee" : "");

  const raffinementHtml = [["j1", refinementJ1], ["j2", refinementJ2]]
    .map(([role, r]) => htmlArmeSignature(personnage.arme, r, {
      classe: `character-raffinement raffinement-${role}`,
      titre: `${role.toUpperCase()} : arme signature R${r + 1}`
    }))
    .join("");

  const constellationHtml = [
    constellationJ1 ? `<span class="character-constellation constellation-j1">${constellationJ1}</span>` : "",
    constellationJ2 ? `<span class="character-constellation constellation-j2">${constellationJ2}</span>` : ""
  ].join("");

  const niveauHtml = [
    niveauJ1 ? `<span class="character-niveau niveau-j1">${niveauJ1}</span>` : "",
    niveauJ2 ? `<span class="character-niveau niveau-j2">${niveauJ2}</span>` : ""
  ].join("");

  card.innerHTML = `
    <div class="character-visuel ${classeFondRarete(personnage.rarete)}">
      <img src="../DB/${personnage.image}" alt="${personnage.nom}" loading="lazy" decoding="async">
      ${constellationHtml}
      ${niveauHtml}
      ${raffinementHtml}
      ${omni ? `<button type="button" class="btn-omni-element" title="Éléments du Voyageur de chaque joueur"><img src="../DB/images/others/omni_element.webp" alt="Éléments"></button>` : ""}
    </div>
  `;

  if (selectionnable && onClick) {
    card.addEventListener("click", onClick);
  }
  // Bouton omni élément : fenêtre des éléments, sans sélectionner la carte.
  card.querySelector(".btn-omni-element")?.addEventListener("click", event => {
    event.stopPropagation();
    ouvrirElementsVoyageur(personnage);
  });

  return card;
}

// Bouton "omni élément" sur le Voyageur (groupe), de l'analyse à la fin de
// la draft : éléments de sa box du match chez chaque joueur
// (draft.elements_jX, calculés par le serveur).
const PHASES_OMNI = ["analyse", "non_equilibrable", "bans_bonus", "boss", "draft"];

function avecBoutonOmni(personnage) {
  return !!draft && PHASES_OMNI.includes(draft.phase) && membresGroupe(personnagesBase, personnage.id).length > 0;
}

// Fenêtre : pour chaque joueur, les éléments du Voyageur de sa box (avec
// leur constellation) et celui pické, le cas échéant.
function ouvrirElementsVoyageur(personnage) {
  document.getElementById("choix-element")?.remove();
  const membres = membresGroupe(personnagesBase, personnage.id);
  const ligne = role => {
    const elements = draft[`elements_${role}`]?.[personnage.id] || [];
    const collection = getJoueurDataParRole(role)?.characters;
    const pick = (draft.actions || []).find(a => a.type === "pick" && a.joueur === role && a.perso_id === personnage.id);
    const icones = Object.keys(ICONES_ELEMENTS_TRI).filter(e => elements.includes(e)).map(e => {
      const c = collection?.full?.[membres.find(m => m.element === e)?.id];
      const pique = pick?.element === e;
      return `<span class="element-voyageur${pique ? " pique" : ""}" title="${NOMS_ELEMENTS[e] || e}${pique ? " (pické)" : ""}">
        <img src="${ICONES_ELEMENTS_TRI[e]}" alt="${NOMS_ELEMENTS[e] || e}">
        ${typeof c === "number" ? `<span class="constellation-${role}">C${c}</span>` : ""}
      </span>`;
    }).join("");
    return `
      <div class="ligne-elements-voyageur">
        <p>${pseudoColore(role)}</p>
        <div class="choix-element-liste">${icones || `<span class="aucun-element">Aucun</span>`}</div>
      </div>`;
  };

  const fond = document.createElement("div");
  fond.id = "choix-element";
  fond.className = "choix-element";
  fond.innerHTML = `
    <div class="choix-element-contenu">
      <p>Éléments de ${personnage.nom}</p>
      ${ligne("j1")}
      ${ligne("j2")}
      <button type="button" class="choix-element-annuler">Fermer</button>
    </div>
  `;
  const fermer = () => {
    fond.remove();
    document.removeEventListener("keydown", surTouche);
  };
  const surTouche = event => {
    if (event.key === "Escape") fermer();
  };
  fond.addEventListener("click", event => {
    if (event.target === fond || event.target.closest(".choix-element-annuler")) fermer();
  });
  document.addEventListener("keydown", surTouche);
  document.body.appendChild(fond);
}

// Carte recyclée si rien de ce qu'elle affiche (ni son comportement au clic,
// cf. mode) n'a changé depuis le dernier rendu de la grille.
function obtenirCarteItem(grille, personnage, options = {}, mode = "") {
  options = { ...options, omni: avecBoutonOmni(personnage) };
  const { onClick, ...affichage } = options;
  const cle = JSON.stringify([personnage.id, personnage.nom, personnage.image, affichage, mode]);
  return obtenirCarte(grille, cle, () => creerCarteItem(personnage, options));
}

// Aperçu des personnages compris dans la box d'un joueur, avec ses infos
// (constellation, niveau, raffinement), filtres/recherche et tri.
function rendreApercuBox(containerId, role, boxChoisie) {
  const joueurData = getJoueurDataParRole(role);
  const container = document.getElementById(containerId);

  if (!boxChoisie) {
    container.innerHTML = `<p class="apercu-vide">Aucune box choisie pour l'instant.</p>`;
    return;
  }

  const collection = joueurData?.characters || { full: {}, selections: {} };

  const persosBox = personnagesData.filter(p => estDansBox(collection, p.id, boxChoisie));
  const armesBox = getArmesBox(joueurData, boxChoisie);

  if (persosBox.length === 0 && armesBox.length === 0) {
    container.innerHTML = `<p class="apercu-vide">Cette box est vide.</p>`;
    return;
  }

  // Personnages, puis armes à la suite (nouvelle ligne), selon le filtre
  // Personnages / Armes.
  const groupesPersos = filtreVue === "weapons" ? [] : trierPersonnages(
    persosBox.filter(p => personnageCorrespondFiltres(p, { ignorerProprietaire: true })), [role]
  );
  const groupesArmes = filtreVue === "characters" ? [] : trierEtGrouper(
    armesBox.filter(armeCorrespondFiltres), etatTri, {
      vue: "weapons",
      valeurs: {
        points: a => Number(a.PPW?.[a.raffinement] ?? 0),
        constellation: a => a.raffinement,
        raffinement: a => a.raffinement
      },
      elements: filtreElement,
      armes: filtreArme,
      rareteParDefaut: filtreEtoile.size > 0
    }
  ).map(groupe => ({
    ...groupe,
    section: "armes",
    items: groupe.items.map(arme => ({ ...arme, infosArme: { [role]: arme.raffinement } }))
  }));

  remplirGrilleGroupee(
    container,
    [...groupesPersos, ...groupesArmes],
    carteDraftOuArme(container, item => obtenirCarteItem(container, item, getInfosCarte(item.id, [role])), [role])
  );
}

// Armes (copies comprises) de la box choisie d'un joueur : Full Box = toutes
// ses armes possédées, autre box = sa sélection.
function getArmesBox(joueurData, box) {
  const collection = joueurData?.weapons || {};
  const armesParId = new Map(armesData.map(arme => [arme.id, arme]));
  return Object.entries(collection.full || {})
    .filter(([instanceId, valeur]) => valeur >= 0 &&
      (box === "full" || !!collection.selections?.[box]?.[instanceId]))
    .map(([instanceId, valeur]) => {
      const arme = armesParId.get(instanceId.split("#")[0]);
      return arme ? { ...arme, instanceId, raffinement: valeur } : null;
    })
    .filter(Boolean);
}

// Filtres appliqués aux armes : élément, type, étoiles, recherche ; les
// vœux, les factions et les rôles ne concernent que les personnages.
function armeCorrespondFiltres(arme) {
  if (filtreVoeux.size > 0 || filtreFactions.size > 0 || filtreSoutiens.size > 0) return false;
  if (filtreElement.size > 0 && !filtreElement.has(arme.element)) return false;
  if (filtreArme.size > 0 && !filtreArme.has(arme.type)) return false;
  if (filtreEtoile.size > 0 && !filtreEtoile.has(String(arme.rarete))) return false;
  const q = rechercheTexte.trim().toLowerCase();
  return !q || arme.nom.toLowerCase().includes(q);
}

// Joueurs (parmi roles) qui ont l'arme (R1 ou plus) ET le personnage dont
// c'est la signature (dans la box du match une fois les pools calculés).
function getProprietairesPersoLie(arme, roles) {
  const personnageLie = trouverPersonnageSignature(armesData, personnagesData, arme.id);
  return personnageLie
    ? roles.filter(role => arme.infosArme?.[role] != null && getConstellation(role, personnageLie.id) !== null)
    : [];
}

// Carte d'une arme (non cliquable) : raffinement de chaque joueur qui la
// possède en haut, de son côté et dans sa couleur (comme les
// constellations) ; en bas, le portrait du personnage dont c'est l'arme
// signature, à gauche si j1 a l'arme et ce personnage, à droite pour j2.
// raffinements : { j1?, j2? } (0 = R1 ... 4 = R5).
function creerCarteArme(arme, raffinements, proprietairesPerso = []) {
  const card = document.createElement("div");
  card.className = "character-card carte-arme";
  card.title = arme.instanceId?.includes("#") ? `${arme.nom} (copie)` : arme.nom;
  const personnageLie = trouverPersonnageSignature(armesData, personnagesData, arme.id);
  card.innerHTML = `
    <div class="character-visuel ${classeFondRarete(arme.rarete)}">
      <img src="../DB/${arme.image}" alt="${arme.nom}" loading="lazy" decoding="async">
      ${["j1", "j2"].filter(role => raffinements[role] != null)
        .map(role => `<span class="character-constellation constellation-${role}">R${raffinements[role] + 1}</span>`).join("")}
      ${personnageLie ? proprietairesPerso.map(role =>
        `<img class="perso-lie-icone lie-${role}" src="../DB/${getIconeLaterale(personnageLie)}" alt="${personnageLie.nom}" title="${role.toUpperCase()} : ${personnageLie.nom}">`).join("") : ""}
    </div>
  `;
  return card;
}

// Carte d'une grille qui mêle personnages et armes : les armes (champ
// infosArme) ont leur propre carte, recyclée elle aussi. rolesPersos :
// joueurs dont on regarde s'ils possèdent le perso lié (aperçu d'une box :
// son seul joueur ; draft : les 2).
function carteDraftOuArme(grille, creerCartePerso, rolesPersos = ["j1", "j2"]) {
  return item => {
    if (!item.infosArme) return creerCartePerso(item);
    const proprietaires = getProprietairesPersoLie(item, rolesPersos);
    return obtenirCarte(grille, JSON.stringify(["arme", item.instanceId || item.id, item.infosArme, proprietaires]),
      () => creerCarteArme(item, item.infosArme, proprietaires));
  };
}

// Draft et bans d'équilibrage : armes des box des 2 joueurs (chaque
// copie de chacun), à la suite des personnages ; filtre J1/J2 respecté.
function groupesArmesDraft() {
  // Copies d'une arme : une carte par copie, la n-ième meilleure copie de
  // chaque joueur sur la n-ième carte (J1 et J2 partagent les cartes).
  const parId = new Map();
  ["j1", "j2"].forEach(role => {
    if (filtreProprietaire && filtreProprietaire !== role) return;
    const copies = new Map();
    getArmesBox(getJoueurDataParRole(role), draft[`box_${role}`] || "full").forEach(arme => {
      copies.set(arme.id, [...(copies.get(arme.id) || []), arme]);
    });
    copies.forEach((liste, id) => {
      const cartes = parId.get(id) || [];
      liste.sort((a, b) => b.raffinement - a.raffinement).forEach((arme, n) => {
        cartes[n] ??= { ...arme, instanceId: n ? `${id}#${n}` : null, infosArme: {} };
        cartes[n].infosArme[role] = arme.raffinement;
      });
      parId.set(id, cartes);
    });
  });

  const raffinements = arme => Object.values(arme.infosArme);
  return trierEtGrouper([...parId.values()].flat().filter(armeCorrespondFiltres), etatTri, {
    vue: "weapons",
    valeurs: {
      points: arme => Math.max(...raffinements(arme).map(r => Number(arme.PPW?.[r] ?? 0))),
      constellation: arme => Math.max(...raffinements(arme)),
      raffinement: arme => Math.max(...raffinements(arme))
    },
    elements: filtreElement,
    armes: filtreArme,
    rareteParDefaut: filtreEtoile.size > 0
  }).map(groupe => ({ ...groupe, section: "armes" }));
}

// Groupes d'une grille de draft : personnages puis armes, selon le filtre
// Personnages / Armes.
// Δ : persos de j1 seul, puis ceux de j2 seul (nouvelle ligne), chaque
// partie triée (par rareté par défaut).
function groupesPersonnagesDraft(personnages) {
  if (filtrePossession !== "difference") return trierPersonnages(personnages);
  return ["j1", "j2"].flatMap(role => trierPersonnages(
    personnages.filter(p => getConstellation(role, p.id) !== null)
  ).map(groupe => ({ ...groupe, section: `seul-${role}` })));
}

function groupesDraft(personnages) {
  return [
    ...(filtreVue === "weapons" ? [] : groupesPersonnagesDraft(personnages)),
    ...(filtreVue === "characters" ? [] : groupesArmesDraft())
  ];
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
      <span class="pastille-presence pastille-${role} cache" data-role="${role}" title="Présence"></span>
      <img src="${joueur.avatar || ""}" alt="${echapperHtml(joueur.nom)}">
      <span class="nom-joueur">${echapperHtml(joueur.nom)}</span>
      ${htmlMedailleTheatre(palierTheatreProfil(joueur.data))}
      ${afficherRole ? `<span class="tag-role">${role.toUpperCase()}</span>` : ""}
      ${afficherPastille && pret ? `<span class="texte-pret">Prêt !</span>` : ""}
    `;
  });
  mettreAJourPastillesPresence();
}

// ---- Phases 1 et 2 : choix de box, puis analyse ----
// Colonnes fixes j1 (gauche) / j2 (droite), alignées sur les entêtes.
// choix_box : chacun ne voit et ne modifie que sa box (celle de
// l'adversaire n'est même pas envoyée par le serveur), "Je suis prêt" la
// valide. analyse : les 2 box sont verrouillées et visibles, chacun
// confirme quand il a fini de regarder celle de l'adversaire.

// Personnages (Voyageur compté une fois) qu'une box doit contenir pour être
// choisie (cf. NB_PERSOS_MIN_BOX, api/_lib/draft.js).
const NB_PERSOS_MIN_BOX = 16;
// Matchmaking classique (théâtre "auto") : full box seulement, ni stuff ni
// box opti (cf. BOX_MATCHMAKING_CLASSIQUE de api/rooms/[room_id]/[action].js).
const BOX_MATCHMAKING_CLASSIQUE = ["full"];

function estMatchmakingClassique() {
  return typeRoom === "matchmaking" && (draft?.mode_theatre || "auto") === "auto";
}
function nbPersosBox(role, box) {
  const collection = getJoueurDataParRole(role)?.characters || { full: {}, selections: {} };
  return personnagesData.filter(p => estDansBox(collection, p.id, box)).length;
}

// Points d'une box (persos + armes, copies comprises) : même calcul que
// calculerPointsBox + calculerPointsArmesBox (api/_lib/draft.js) ; Voyageur :
// seul son meilleur élément compte.
function pointsBoxJoueur(role, box) {
  const joueurData = getJoueurDataParRole(role);
  const collection = joueurData?.characters || { full: {}, selections: {} };
  const niveaux = collection.niveaux || {};
  let total = 0;
  const meilleurParGroupe = {};
  const presents = idsDraftCollection(collection, personnagesBase, box);
  personnagesBase.forEach(perso => {
    const c = collection.full?.[perso.id];
    if (typeof c !== "number" || c < 0) return;
    if (box !== "full" && !collection.selections?.[box]?.[perso.id]) return;
    const points = pointsPersonnageBox(perso, c, niveaux[perso.groupe || perso.id] ?? null, presents);
    if (perso.groupe) meilleurParGroupe[perso.groupe] = Math.max(meilleurParGroupe[perso.groupe] ?? 0, points);
    else total += points;
  });
  Object.values(meilleurParGroupe).forEach(points => { total += points; });
  // Armes : valeur alternative comprise (cf. pointsArmesBox, commun/cartes.js).
  total += pointsArmesBox(copiesArmesBox(joueurData?.weapons, armesData, box), clesPersosBox(collection, personnagesBase, box), armesData, personnagesBase);
  return total;
}

function rendreChoixBox() {
  const enAnalyse = draft.phase === "analyse";

  document.getElementById("message-choix-box").textContent = enAnalyse
    ? (draft.roles_tires
      ? "Revanche : mêmes box et mêmes bans d'équilibrage, rôles J1/J2 inversés. Analyse la box adverse puis clique sur \"Prêt\" pour tirer le boss."
      : "Analyse la box adverse puis clique sur \"Prêt\". Suite : bans d'équilibrage (si écart), puis tirage J1/J2 et du boss.")
    : draft.boxes_permises
      ? "Les box choisies ne s'équilibraient pas : choisis parmi les box qui s'équilibrent avec celles de ton adversaire, puis valide."
      : `Choisis ta box (au moins ${NB_PERSOS_MIN_BOX} personnages) et valide-la. La box adverse sera visible une fois les 2 box validées.`;
  if (enAnalyse && draft.entrainement && draft.equilibrable === false && !draft.mode_special) afficherAlerteEquilibrage();

  ["j1", "j2"].forEach(role => {
    const estMoi = role === monRole;
    const joueurObjet = role === "j1" ? joueur1 : joueur2;
    const nom = joueurObjet ? joueurObjet.pseudo : (role === "j1" ? "Joueur 1" : "Joueur 2");
    const points = enAnalyse && draft[`points_${role}`] != null ? ` · ${draft[`points_${role}`]} pts` : "";
    const peutChoisir = estMoi && !enAnalyse;

    document.getElementById(`titre-box-${role}`).innerHTML =
      `${nom}${estMoi ? '<span class="tag-toi">(toi)</span>' : ""}${points}`;

    const conteneur = document.getElementById(`box-select-${role}`);
    conteneur.innerHTML = "";
    conteneur.classList.toggle("desactive", !peutChoisir);

    // Box optimisées renommées par le joueur dans Mon compte (profil.nomsBoxes) :
    // seulement les siennes (cf. boxCachee).
    const nomsPerso = boxCachee(role) ? {} : getJoueurDataParRole(role)?.nomsBoxes || {};
    // Entraînement : seulement la box choisie à la création ; matchmaking
    // classique : full seulement (BOX_MATCHMAKING_CLASSIQUE) ; sinon toutes
    // sauf "Personnalisée".
    // Retour au choix des box (box non équilibrables) : seulement les box
    // des combinaisons qui s'équilibrent (draft.boxes_permises).
    const permises = draft.boxes_permises?.[role];
    Object.entries(BOX_LABELS).filter(([valeur]) => draft.entrainement ? draft[`box_${role}`] === valeur
      : permises ? permises.includes(valeur)
        : estMatchmakingClassique() ? BOX_MATCHMAKING_CLASSIQUE.includes(valeur) : !["custom", "stuff"].includes(valeur))
      // Adversaire : ses box opti en un seul bouton "Opti".
      .filter(([valeur]) => !boxCachee(role) || !estBoxOpti(valeur) || valeur === premiereOpti(role, permises))
      .forEach(([valeur, label]) => {
      const groupeOpti = boxCachee(role) && estBoxOpti(valeur);
      if (groupeOpti) label = LIBELLE_OPTI_CACHEE;
      const choisie = groupeOpti ? estBoxOpti(draft[`box_${role}`]) : draft[`box_${role}`] === valeur;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "box-btn" + (choisie ? " active" : "");
      btn.textContent = typeof nomsPerso[valeur] === "string" && nomsPerso[valeur] ? nomsPerso[valeur] : label;
      // Points de ses propres box seulement (celles de l'adversaire restent
      // cachées jusqu'à l'analyse).
      if (peutChoisir) {
        const pts = document.createElement("span");
        pts.className = "points-box";
        pts.textContent = `${pointsBoxJoueur(role, valeur)} pts`;
        btn.appendChild(pts);
      }
      // Box trop petite (ex. que des armes) ou trop chère (hors full box) :
      // pas choisissable.
      const nbPersos = peutChoisir ? nbPersosBox(role, valeur) : NB_PERSOS_MIN_BOX;
      const tropPetite = nbPersos < NB_PERSOS_MIN_BOX;
      // Hors full box : plafond du palier de la draft (pointsMaxBox,
      // commun/cartes.js).
      const maxBox = pointsMaxBox(theatreDeLaDraft());
      const tropChere = peutChoisir && valeur !== "full" && pointsBoxJoueur(role, valeur) > maxBox;
      btn.classList.toggle("trop-petite", tropPetite || tropChere);
      if (tropPetite) btn.title = `${nbPersos} personnage${nbPersos > 1 ? "s" : ""} : il en faut au moins ${NB_PERSOS_MIN_BOX}`;
      else if (tropChere) btn.title = `Hors full box, une box jouable en draft ${PALIERS_THEATRE[theatreDeLaDraft()]?.nom.toLowerCase() || "carpe"} vaut ${maxBox} points au plus`;
      btn.disabled = !peutChoisir || tropPetite || tropChere;
      if (peutChoisir && !tropPetite && !tropChere) {
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
    document.getElementById(`statut-pret-${role}`).innerHTML = statut;

    const btnPret = document.getElementById(`btn-pret-${role}`);
    placerBoutonPret(btnPret);
    if (estMoi) {
      btnPret.classList.remove("cache");
      if (enAnalyse) {
        btnPret.textContent = pret ? "Annuler (pas encore prêt)" : "Prêt";
      } else {
        btnPret.textContent = pret ? "Annuler (modifier ma box)" : "Valider ma box";
      }
      btnPret.classList.toggle("active", !!pret);
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

// Bouton "prêt" figé en bas de l'écran, au-dessus de la consigne (dans la
// pile de bulles), sur ordi comme sur téléphone.
function placerBoutonPret(bouton) {
  const bulles = document.getElementById("bulles-bas");
  // Sous le chrono figé, qui reste en haut de la pile.
  if (bouton.parentElement !== bulles) document.getElementById("chronos-flottant").after(bouton);
}

// ---- Phase 2 : bans bonus d'équilibrage ----
// Les bans choisis vont dans des emplacements dédiés, modifiables (on peut
// en retirer un et en reprendre un autre) tant qu'on n'a pas confirmé.

// Bans calculés (cf. calculerEquilibrageFixe, api/_lib/draft.js) : nombre
// imposé comme l'ancienne méthode, jokers compris (bans_joker_total).
// "fixe_horizontal" : les mêmes, puis les bans horizontaux.
function estEquilibrageFixe() {
  return draft.equilibrage === "fixe_joker" || draft.equilibrage === "fixe_horizontal";
}

// Phase bans_bonus : bans verticaux, puis bans horizontaux
// (draft.etape_bonus, cf. acteurBansBonus dans api/_lib/draft.js).
function estEtapeHorizontale() {
  return draft.phase === "bans_bonus" && draft.etape_bonus === "horizontal";
}

function acteurBansBonus() {
  return estEtapeHorizontale() ? draft.bans_horizontaux_joueur : draft.bans_bonus_joueur;
}

// Mêmes règles que ciblesHorizontales (api/_lib/draft.js) : persos
// horizontaux de l'adversaire encore jouables, sans faire passer une box
// sous le nombre de persos minimum (ban global).
function ciblesHorizontales(choix) {
  const banneur = draft.bans_horizontaux_joueur;
  if (!banneur) return [];
  const adverse = getAutreRole(banneur);
  const disponibles = new Set(draft.pool_disponible || []);
  const minimum = draft.min_persos_equilibrage || 0;
  const restants = (role, bannis) => (draft[`pool_${role}`] || []).filter(id => disponibles.has(id) && !bannis.includes(id)).length;
  return Object.keys(draft[`horizontaux_${adverse}`] || {}).filter(id =>
    disponibles.has(id) && (draft[`pool_${adverse}`] || []).includes(id) && !choix.includes(id) &&
    ["j1", "j2"].every(role => !(draft[`pool_${role}`] || []).includes(id) || restants(role, [...choix, id]) >= minimum));
}

// Échange de BANS_PAR_JOKER bans contre un joker (cf.
// echangerBansContreJoker, api/_lib/draft.js) : une fois par draft.
const BANS_PAR_JOKER = 5;

// Message court des bans d'équilibrage (le détail du calcul est dans
// Theorycraft) : "X a 3 bans verticaux (dont 1 joker) sur Y", puis la
// consigne de celui qui bannit ou l'attente des autres.
function pluriel(n, mot, motPluriel = `${mot}s`) {
  return `${n} ${n > 1 ? motPluriel : mot}`;
}

function messageBansEquilibrage(banneur, constat, restant, termine) {
  const cEstMonTour = banneur === monRole;
  const consigne = !cEstMonTour
    ? "En attente…"
    : !termine
      ? `${draft.entrainement ? `À ${pseudoColore(banneur)} de choisir` : "Choisis"} encore ${pluriel(restant, "perso")}, puis confirme.`
      : `${restant > 0 ? "Plus aucun perso ne peut être banni. " : ""}Clique sur « Confirmer les bans ».`;
  document.getElementById("message-equilibrage").innerHTML = `${constat} ${consigne}`;
}

// Bouton d'échange (ou d'annulation de l'échange), pour celui qui bannit.
function rendreEchangeJoker(cEstMonTour, nbNormaux) {
  const bouton = document.getElementById("btn-echanger-joker");
  const possible = !draft.echange_joker && nbNormaux >= BANS_PAR_JOKER;
  bouton.classList.toggle("cache", !cEstMonTour || (!possible && !draft.echange_joker));
  bouton.textContent = draft.echange_joker
    ? `Annuler l'échange (récupérer ${BANS_PAR_JOKER} bans)`
    : `Échanger ${BANS_PAR_JOKER} bans contre 1 joker`;
  bouton.title = draft.echange_joker
    ? "Rend les bans échangés et retire le joker obtenu"
    : `Une seule fois : ${BANS_PAR_JOKER} bans d'équilibrage en moins, 1 ban joker en plus (personnage de la box adverse, interdit à l'adversaire seulement)`;
  bouton.disabled = monTempsEcoule();
  bouton.onclick = () => postBonusEchanger(!!draft.echange_joker).catch(err => alert(err.message));
}

// Étape des bans horizontaux : persos horizontaux de l'adversaire
// seulement (jamais entrés dans le top 12 du calcul des bans verticaux),
// bans globaux, nombre figé (moins si plus aucune cible possible).
function rendreBansHorizontaux() {
  const choix = draft.bans_horizontaux_choix || [];
  const total = draft.bans_horizontaux_total || 0;
  const banneur = draft.bans_horizontaux_joueur;
  const adverse = getAutreRole(banneur);
  const cibles = ciblesHorizontales(choix);
  const restant = total - choix.length;
  const termine = restant === 0 || cibles.length === 0;
  const cEstMonTour = banneur === monRole;
  rendreEchangeJoker(false, 0);

  messageBansEquilibrage(banneur,
    `${pseudoColore(banneur)} a ${pluriel(total, "ban horizontal", "bans horizontaux")} sur ${pseudoColore(adverse)}.`,
    restant, termine);

  const slots = document.getElementById("bans-bonus-slots");
  slots.innerHTML = "";
  Array.from({ length: total }, (_, i) => choix[i]).forEach(persoId => {
    const slot = document.createElement("div");
    const personnage = persoId && getPersonnageParId(persoId);
    slot.className = `slot-bonus horizontal${personnage ? " rempli" : ""}`;
    slot.title = "Ban horizontal";
    if (personnage) {
      slot.innerHTML = `
        <img src="../DB/${personnage.image}" alt="${personnage.nom}">
        <span class="retirer">✕</span>
      `;
      if (cEstMonTour) {
        slot.title = "Ban horizontal — cliquer pour retirer";
        slot.addEventListener("click", () => postBonusToggle(persoId).catch(err => alert(err.message)));
      }
    }
    slots.appendChild(slot);
  });

  const btnConfirmer = document.getElementById("btn-confirmer-bonus");
  btnConfirmer.classList.toggle("cache", !monRole);
  btnConfirmer.classList.toggle("a-mon-tour", cEstMonTour);
  btnConfirmer.classList.toggle("pret", cEstMonTour && termine);
  btnConfirmer.disabled = !cEstMonTour || !termine || monTempsEcoule();
  btnConfirmer.onclick = () => postBonusConfirmer().catch(err => alert(err.message));

  const grille = document.getElementById("grille-bans-bonus");
  const cleGrille = JSON.stringify([
    "horizontal", choix, total, banneur, draft.pool_disponible,
    draft.pool_j1, draft.pool_j2, draft.discord_j1, draft.discord_j2, monRole,
    ...cleFiltres()
  ]);
  if (!grilleAChange(grille, cleGrille)) return;

  const personnages = draft.pool_disponible
    .map(id => getPersonnageParId(id))
    .filter(p => p && personnageCorrespondFiltres(p));

  remplirGrilleGroupee(grille, groupesDraft(personnages), carteDraftOuArme(grille, personnage => {
    const id = personnage.id;
    const dejaChoisi = choix.includes(id);
    const ciblable = cibles.includes(id);
    const peutCliquer = cEstMonTour && (dejaChoisi || (restant > 0 && ciblable));
    // Comme au pick : grisé s'il ne peut pas être banni (pas un perso
    // horizontal de l'adversaire), ou déjà sélectionné.
    return obtenirCarteItem(grille, personnage, {
      selectionnable: peutCliquer,
      indisponible: dejaChoisi || !ciblable,
      onClick: () => postBonusToggle(id).catch(err => alert(err.message)),
      ...getInfosCarte(id)
    });
  }));
}

// Bans d'équilibrage : prochain perso cliqué en ban joker (bouton "Choisir
// un ban joker" ou clic sur un emplacement joker vide), sans attendre
// d'avoir rempli les bans normaux.
let modeJokerBonus = false;

function rendreBansBonus() {
  if (estEtapeHorizontale()) return rendreBansHorizontaux();
  const choix = draft.bans_bonus_choix || [];
  const jokers = draft.bans_joker_choix || [];
  // Mode spécial (entraînement non équilibrable) : autant de jokers que
  // nécessaire pour équilibrer, calculés par le serveur.
  const special = !!draft.mode_special;
  const nbJokers = draft.bans_joker_total || 0;
  const nbNormaux = draft.bans_bonus_total - nbJokers;
  const restant = draft.bans_bonus_total - choix.length - jokers.length;
  const cEstMonTour = draft.bans_bonus_joueur === monRole;
  const jokerLibre = cEstMonTour && jokers.length < nbJokers;
  if (!jokerLibre) modeJokerBonus = false;
  rendreEchangeJoker(cEstMonTour, nbNormaux);
  const btnModeJoker = document.getElementById("btn-mode-joker");
  btnModeJoker.classList.toggle("cache", !jokerLibre);
  btnModeJoker.classList.toggle("actif", modeJokerBonus);
  btnModeJoker.textContent = modeJokerBonus ? "Joker : clique un perso adverse (annuler)" : "Choisir un ban joker";
  btnModeJoker.title = modeJokerBonus
    ? "Le prochain perso cliqué (box adverse) sera un ban joker. Clique ici pour revenir aux bans normaux."
    : "Le prochain perso cliqué (box adverse) sera un ban joker, sans attendre d'avoir fait tous les bans normaux";
  btnModeJoker.onclick = () => {
    modeJokerBonus = !modeJokerBonus;
    rendreBansBonus();
  };
  const joker = nbJokers ? ` (dont ${pluriel(nbJokers, "joker")})` : "";
  messageBansEquilibrage(draft.bans_bonus_joueur,
    `${special ? "Mode spécial : " : ""}${pseudoColore(draft.bans_bonus_joueur)} a ${pluriel(draft.bans_bonus_total, "ban vertical", "bans verticaux")}${joker} sur ${pseudoColore(getAutreRole(draft.bans_bonus_joueur))}.` +
      (special && draft.equilibrable_special === false ? " Même avec tous ces jokers, l'écart reste au-dessus de la tolérance." : ""),
    restant, restant === 0);

  const slots = document.getElementById("bans-bonus-slots");
  slots.innerHTML = "";

  const emplacements = [
    ...Array.from({ length: nbNormaux }, (_, i) => ({ persoId: choix[i], joker: false })),
    ...Array.from({ length: nbJokers }, (_, i) => ({ persoId: jokers[i], joker: true }))
  ];
  emplacements.forEach(({ persoId, joker }) => {
    const slot = document.createElement("div");
    const personnage = persoId && getPersonnageParId(persoId);

    if (personnage) {
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
      // Emplacement joker vide : clic = prochain perso en joker.
      if (joker && jokerLibre) {
        slot.classList.add("cliquable");
        slot.classList.toggle("arme", modeJokerBonus);
        slot.title = "Cliquer pour choisir ce ban joker maintenant";
        slot.addEventListener("click", () => {
          modeJokerBonus = !modeJokerBonus;
          rendreBansBonus();
        });
      }
    }
    if (joker) {
      slot.classList.add("joker");
      slot.title = `${slot.title ? `${slot.title} — ` : ""}Joker : interdit à l'adversaire seulement`;
    }

    slots.appendChild(slot);
  });

  // Même bouton que "Confirmer" de la draft, en rouge (ban) : grisé pour
  // l'autre joueur ; pour celui qui bannit, contour rouge puis rouge plein
  // une fois tous ses bans choisis. Masqué pour un spectateur.
  const btnConfirmer = document.getElementById("btn-confirmer-bonus");
  const tousChoisis = restant === 0;
  btnConfirmer.classList.toggle("cache", !monRole);
  btnConfirmer.classList.toggle("a-mon-tour", cEstMonTour);
  btnConfirmer.classList.toggle("pret", cEstMonTour && tousChoisis);
  btnConfirmer.disabled = !cEstMonTour || !tousChoisis || monTempsEcoule();
  btnConfirmer.onclick = () => postBonusConfirmer().catch(err => alert(err.message));

  const grille = document.getElementById("grille-bans-bonus");
  const cleGrille = JSON.stringify([
    choix, jokers, draft.bans_bonus_total, draft.bans_bonus_joueur, draft.pool_disponible, special, modeJokerBonus,
    draft.pool_j1, draft.pool_j2, draft.discord_j1, draft.discord_j2, monRole,
    ...cleFiltres()
  ]);
  if (!grilleAChange(grille, cleGrille)) return;

  const personnages = draft.pool_disponible
    .map(id => getPersonnageParId(id))
    .filter(p => p && personnageCorrespondFiltres(p));

  remplirGrilleGroupee(grille, groupesDraft(personnages), carteDraftOuArme(grille, personnage => {
    const id = personnage.id;
    const dejaChoisi = choix.includes(id) || jokers.includes(id);
    // Bans normaux d'abord, puis jokers (personnages de la box adverse) ;
    // joker demandé (modeJokerBonus) : persos de la box adverse seulement.
    const poolAdverse = draft[`pool_${getAutreRole(draft.bans_bonus_joueur)}`] || [];
    const placeLibre = modeJokerBonus
      ? poolAdverse.includes(id)
      : choix.length < nbNormaux || (jokers.length < nbJokers && poolAdverse.includes(id));
    const peutCliquer = cEstMonTour && (dejaChoisi || placeLibre);

    return obtenirCarteItem(grille, personnage, {
      selectionnable: peutCliquer,
      indisponible: dejaChoisi,
      onClick: () => {
        const enJoker = modeJokerBonus && !dejaChoisi;
        if (enJoker) modeJokerBonus = false;
        postBonusToggle(id, enJoker).catch(err => alert(err.message));
      },
      ...getInfosCarte(id)
    });
  }));
}

// ---- Phase 3 : draft (boss + bans/picks) ----

// Éléments proposés au pick : Voyageur = ceux de sa box, Manekin = tous ;
// null pour un personnage sans choix d'élément.
function getElementsAuPick(persoId) {
  if (membresGroupe(personnagesBase, persoId).length) {
    const elements = draft[`elements_${monRole}`]?.[persoId] || [];
    return Object.keys(ICONES_ELEMENTS_TRI).filter(e => elements.includes(e));
  }
  return ELEMENTS_LIBRES[persoId] || null;
}

// Fenêtre de choix de l'élément au pick (Voyageur / Manekin).
function ouvrirChoixElement(personnage, elements, valider) {
  document.getElementById("choix-element")?.remove();

  const fond = document.createElement("div");
  fond.id = "choix-element";
  fond.className = "choix-element";
  fond.innerHTML = `
    <div class="choix-element-contenu">
      <p>Élément de ${personnage.nom} :</p>
      <div class="choix-element-liste">
        ${elements.map(e => `<button type="button" class="filtre-icone-btn" data-element="${e}" title="${NOMS_ELEMENTS[e] || e}"><img src="${ICONES_ELEMENTS_TRI[e]}" alt="${NOMS_ELEMENTS[e] || e}"></button>`).join("")}
      </div>
      <button type="button" class="choix-element-annuler">Annuler</button>
    </div>
  `;

  const fermer = () => {
    fond.remove();
    document.removeEventListener("keydown", surTouche);
  };
  const surTouche = event => {
    if (event.key === "Escape") fermer();
  };

  fond.addEventListener("click", event => {
    const bouton = event.target.closest("[data-element]");
    if (bouton) {
      fermer();
      valider(bouton.dataset.element);
    } else if (event.target === fond || event.target.closest(".choix-element-annuler")) {
      fermer();
    }
  });
  document.addEventListener("keydown", surTouche);
  document.body.appendChild(fond);
}

// Séquence de picks / bans de la manche : fixée par le serveur au tirage du
// boss selon le mode de théâtre (cf. sequenceTheatre, api/_lib/draft.js) ;
// draft de la carpe avant le tirage.
function getSequence() {
  return Array.isArray(draft?.sequence) ? draft.sequence : SEQUENCE_FIXE;
}

function getProchaineActionLocale() {
  const action = getSequence()[draft.sequence_index];
  return action || null;
}

// Prochaine action d'un joueur dans la draft (la courante comprise) ->
// { action, index } ou null : cible d'une présélection hors de son tour.
function getProchaineActionDe(role) {
  const sequence = getSequence();
  for (let index = draft.sequence_index; index < sequence.length; index++) {
    if (sequence[index].joueur === role) return { action: sequence[index], index };
  }
  return null;
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
function remplirCaseTableau(slot, personnage, element = null) {
  slot.classList.add("avec-banniere");
  slot.style.setProperty("--banniere-perso", `url("${getBannierePersonnage(personnage)}")`);
  const nom = element ? `${personnage.nom} ${NOMS_ELEMENTS[element] || ""}`.trim() : personnage.nom;
  slot.innerHTML = `<img class="perso-case" src="../DB/${personnage.image}" alt="${nom}" title="${nom}">`;
}

// Présence des joueurs ({ j1, j2 } : en ligne ou afk, cf. noterPresence
// dans api/rooms/[room_id]/[action].js), ou null si inconnue.
let presences = null;

// Pastille en haut de la namecard (j1 à gauche, j2 à droite), pendant les
// picks et bans seulement : verte en ligne, grise afk. Soi-même : toujours
// en ligne (la page est ouverte).
// Pendant toute la draft (choix des box, analyse, bans d'équilibrage,
// picks / bans) : dans les rectangles des joueurs puis sur les namecards
// des tableaux. Choix des box / analyse : à côté de la pastille "prêt".
const PHASES_PRESENCE = ["choix_box", "analyse", "non_equilibrable", "bans_bonus", "boss", "draft"];

function mettreAJourPastillesPresence() {
  const visible = PHASES_PRESENCE.includes(draft?.phase) && !!presences;
  ["j1", "j2"].forEach(role => {
    const enLigne = role === monRole || !!presences?.[role];
    document.querySelectorAll(`.pastille-presence[data-role="${role}"]`).forEach(pastille => {
      pastille.classList.toggle("cache", !visible);
      pastille.classList.toggle("en-ligne", enLigne);
      pastille.title = enLigne ? "En ligne" : "AFK";
    });
  });
}

function afficherPresences(nouvelles) {
  presences = nouvelles || null;
  mettreAJourPastillesPresence();
}

// Namecard du tableau, puis trait de la couleur du joueur.
function titreTableauJoueur(role, nomJoueur) {
  const joueur = role === "j1" ? joueur1 : joueur2;
  const namecard = encodeURI(`/DB/images/${joueur?.data?.parametres?.banniere || NAMECARD_DEFAUT}`);
  const tagRole = draft?.roles_tires ? `<span class="tag-role">${role.toUpperCase()}</span>` : "";
  return `
    <div class="namecard-tableau" style="--namecard: url(&quot;${echapperHtml(namecard)}&quot;)">
      <span class="pastille-presence pastille-${role} cache" data-role="${role}"></span>
      ${joueur?.avatar ? `<img class="avatar-tableau" src="${joueur.avatar}" alt="">` : ""}
      <span class="nom-complet">${echapperHtml(nomJoueur)}</span>
      <span class="nom-court">${role.toUpperCase()}</span>
      ${htmlMedailleTheatre(palierTheatreProfil(joueur?.data))}
      ${tagRole}
    </div>
    <div class="trait-joueur trait-${role}"></div>
  `;
}

// Tableau d'un joueur, identique pendant la draft et en fin de match :
// namecard, 4 picks avec leurs infos
// (constellation, niveau, arme signature), puis ses bans. Chaque partie
// n'est redessinée que si elle change (pas à chaque rafraîchissement).
function rendreTableauJoueur(role) {
  const joueur = role === "j1" ? joueur1 : joueur2;
  const enRecap = PHASES_RECAP.includes(draft.phase);

  // Namecard redessinée seulement si elle change.
  const entete = document.getElementById(`entete-tableau-${role}`);
  const cleEntete = JSON.stringify([joueur.nom, joueur.avatar, joueur.data?.parametres?.banniere, draft.roles_tires]);
  if (entete.dataset.cle !== cleEntete) {
    entete.dataset.cle = cleEntete;
    entete.innerHTML = titreTableauJoueur(role, joueur.nom);
  }
  mettreAJourPastillesPresence();

  // Temps (fin de match) au-dessus du tableau ; le champ de saisie y est
  // déplacé sans être recréé (le texte tapé n'est pas perdu).
  const zone = document.getElementById(`recap-temps-${role}`);
  zone.classList.toggle("cache", !enRecap);

  document.getElementById(`titre-picks-${role}`).textContent = enRecap ? "Équipe" : "Picks";

  // Picks : personnage sur sa bannière avec ses infos chez ce joueur.
  const picks = draft.actions.filter(a => a.type === "pick" && a.joueur === role);
  const slotsPicks = document.getElementById(`slots-pick-${role}`);
  if (grilleAChange(slotsPicks, JSON.stringify([joueur.discordId, picks.map(a => [a.perso_id, a.element, !!a.aleatoire]), derniereCleVariantes]))) {
    slotsPicks.replaceChildren(...Array.from({ length: 4 }, (_, i) => {
      const personnage = picks[i] && getPersonnageParId(picks[i].perso_id);
      if (!personnage) return creerCaseVide("slot-pick");
      const slot = creerCaseRecap(personnage, role, picks[i].element);
      marquerAleatoire(slot, picks[i]);
      if (estMatchClasse() && aBonusSaisonPerso(personnage)) {
        slot.classList.add("bonus-saison");
        slot.title = `${slot.title || personnage.nom} — bonus de saison (+3 trophées)`;
      }
      return slot;
    }));
  }

  // Bans (hors bans d'équilibrage, dans leur propre bloc) : une case par
  // ban prévu pour ce joueur dans la séquence.
  const actionsBans = draft.actions.filter(a => a.type === "ban" && a.joueur === role && !a.bonus);
  const bans = actionsBans.map(a => a.perso_id);
  const nbBans = getSequence().filter(a => a.type === "ban" && a.joueur === role).length;
  const slotsBans = document.getElementById(`rangee-bans-${role}`);
  if (grilleAChange(slotsBans, JSON.stringify([joueur.discordId, actionsBans.map(a => [a.perso_id, !!a.aleatoire]), nbBans]))) {
    slotsBans.replaceChildren(...Array.from({ length: nbBans }, (_, i) => {
      const personnage = bans[i] && getPersonnageParId(bans[i]);
      if (!personnage) return creerCaseVide("slot-pick slot-ban");
      const slot = document.createElement("div");
      slot.className = "slot-pick slot-ban";
      remplirCaseTableau(slot, personnage);
      marquerAleatoire(slot, actionsBans[i]);
      // Comme les cartes de la draft : infos des 2 joueurs (chacun dans sa
      // couleur), à côté du personnage, j1 à gauche et j2 à droite (ordre
      // inversé dans le tableau de droite, qui est en miroir).
      (role === "j1" ? ["j1", "j2"] : ["j2", "j1"]).forEach(r => {
        const zone = creerInfosCase(personnage, r, getInfosCarte(personnage.id, [r]));
        if (zone) slot.appendChild(zone);
      });
      return slot;
    }));
  }

  if (enRecap) rendreTempsJoueur(role, zone);

  document.getElementById(`equipe-${role}`).classList.toggle(
    "gagnant", draft.phase === "termine" && draft.vainqueur === role
  );
}

// Choix fait au hasard (temps écoulé, draft classée) : carte entourée de
// doré, pour les 2 joueurs.
function marquerAleatoire(element, action) {
  if (!action?.aleatoire) return;
  element.classList.add("choix-aleatoire");
  element.title = `${element.title ? `${element.title} — ` : ""}choisi au hasard (temps écoulé)`;
}

function creerCaseVide(classes) {
  const slot = document.createElement("div");
  slot.className = `${classes} vide`;
  slot.textContent = "Vide";
  return slot;
}

function rendreTableaux() {
  rendreBansEquilibrage();
  rendreTableauJoueur("j1");
  rendreTableauJoueur("j2");
}

// Petit rappel persistant, pendant la draft, des bans d'équilibrage joués
// avant le tirage du boss (utile puisque la phase bans_bonus elle-même est
// passée à ce stade).
// Bans d'équilibrage : bloc au-dessus du tableau du joueur qui les a faits,
// bans horizontaux à part.
function rendreBansEquilibrage() {
  ["j1", "j2"].forEach(role => {
    const bans = draft.actions.filter(a => a.bonus && a.joueur === role);
    const verticaux = bans.filter(a => !a.horizontal);
    const horizontaux = bans.filter(a => a.horizontal);
    document.getElementById(`bans-eq-${role}`).classList.toggle("cache", bans.length === 0);
    document.getElementById(`titre-bans-eq-${role}`).classList.toggle("cache", verticaux.length === 0);
    document.getElementById(`titre-bans-h-${role}`).classList.toggle("cache", horizontaux.length === 0);

    [[`bans-eq-grille-${role}`, verticaux], [`bans-h-grille-${role}`, horizontaux]].forEach(([idGrille, liste]) => {
      const grille = document.getElementById(idGrille);
      if (!grilleAChange(grille, JSON.stringify(liste.map(a => [a.perso_id, !!a.aleatoire, !!a.joker])))) return;
      grille.replaceChildren(...liste
        .filter(a => getPersonnageParId(a.perso_id))
        .map(a => {
          const carte = creerBanMini(getPersonnageParId(a.perso_id));
          if (a.joker) {
            carte.classList.add("joker");
            carte.title += " — joker : interdit à l'adversaire seulement";
          }
          if (a.horizontal) {
            carte.classList.add("horizontal");
            carte.title += " — ban horizontal";
          }
          marquerAleatoire(carte, a);
          return carte;
        }));
    });
  });
}

// Boss tiré : image cliquable qui affiche / masque ses résistances et ses
// recommandations par-dessus, sauf en match classé (compétitif : image
// seule, cf. commun/recommandations_boss.js).
function htmlBossTire(boss) {
  if (!boss) return "";
  return `
    ${htmlImageInfosBoss(boss, estMatchClasse())}
    <span class="nom-boss">${echapperHtml(boss.nom)}</span>`;
}

// Théâtre de la draft : fixé par le serveur au tirage du boss ; avant,
// celui qui sera joué (palier imposé, carpe en mêlée générale et carnage, ou
// plus petit palier des 2 joueurs en mode auto, cf. resoudreTheatre dans
// api/_lib/draft.js).
function theatreDeLaDraft() {
  if (infosTheatreJoue(draft?.theatre)) return draft.theatre;
  if (draft?.mode_theatre === "carnage" || draft?.mode_theatre === "12") return THEATRE_CARPE;
  const impose = Object.keys(PALIERS_THEATRE).find(palier => PALIERS_THEATRE[palier].mode === draft?.mode_theatre);
  if (impose) return Number(impose);
  const paliers = [joueur1, joueur2].map(j => palierTheatreProfil(j?.data));
  return Math.min(...paliers.map(p => p ?? 1));
}

// Badge du théâtre de la draft, sous le titre, dès que les 2 joueurs sont
// dans la room.
function afficherModeTheatre() {
  const zone = document.getElementById("mode-theatre-room");
  const visible = !!(draft && joueur1 && joueur2) && draft.phase !== "annule";
  zone.classList.toggle("cache", !visible);
  if (!visible) return;
  // Entraînement : box jouées et rôle(s) tenu(s).
  const html = htmlModeTheatre(theatreDeLaDraft()) + (draft.entrainement
    ? `<span class="info-entrainement">${ICONE_ENTRAINEMENT} J1 : ${libelleBoxEntrainement("j1")} · J2 : ${libelleBoxEntrainement("j2")}` +
      `${estEntrainementSolo() ? " · tu joues les 2 rôles (partage le lien pour te faire aider)" : ""}</span>`
    : "");
  if (zone.dataset.html !== html) {
    zone.dataset.html = html;
    zone.innerHTML = html;
  }
}

// Théâtre de la draft (palier, nombre de bans) avec sa médaille.
function htmlModeTheatre(theatre) {
  const infos = infosTheatreJoue(theatre);
  if (!infos) return "";
  // "auto" : palier du joueur au plus petit palier ; sinon choisi à la
  // création de la room, ou mêlée générale (matchmaking / classé).
  const mode = draft.mode_theatre === "auto" ? "plus petit palier"
    : draft.mode_theatre === "carnage" ? "carnage, sans équilibrage"
      : draft.mode_theatre === "12" ? "classé" : "choisi pour la room";
  return `<span class="mode-theatre" title="Draft ${infos.nom} : 4 picks et ${infos.bans} bans par joueur (${mode})">` +
    `<img src="${urlMedailleTheatre(infos.medaille)}" alt="">${infos.nom} · ${mode}</span>`;
}

function initialiserResBoss() {
  document.getElementById("boss-affiche").addEventListener("click", event => {
    if (!event.target.closest(".image-boss-res, .indice-res-boss")) return;
    document.querySelector("#boss-affiche .image-boss-res")?.classList.toggle("res-visibles");
  });
}

// Affiche directement le boss final, sans animation (arrivée directe en
// phase "draft" : rechargement de page, ou 2e joueur qui a raté la
// transition entre 2 polls).
function afficherBossFinal(bossId) {
  const boss = bossData.find(b => b.id === bossId);
  const container = document.getElementById("boss-affiche");
  container.classList.remove("boss-tirage", "boss-revele");
  container.innerHTML = htmlBossTire(boss);
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
      ? `${htmlImagesBoss(propose)}<span class="nom-boss">?</span>`
      : "";

    tour += 1;

    if (tour < nbTours) {
      // Ralentit progressivement, comme une roue qui perd de la vitesse.
      setTimeout(etape, 80 + tour * 15);
    } else {
      container.classList.remove("boss-tirage");
      container.classList.add("boss-revele");
      container.innerHTML = htmlBossTire(bossFinal);

      setTimeout(() => container.classList.remove("boss-revele"), 700);

      animationBossEnCours = false;
      bossAnimeId = bossIdFinal;
      appliquerFondRoom();
      // Choix du boss : boutons de vote actifs une fois le boss révélé.
      if (draft?.phase === "boss") rendreChoixBoss();
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

// ---- Choix du boss (matchmaking non classé, room privée sans boss imposé) ----
// Animation du tirage à chaque boss proposé, puis vote : confirmer ou
// relancer (relancé si les 2 joueurs le veulent). Le tirage J1/J2 vient
// ensuite, au début de la draft (annonces séparées).
async function postVoteBoss(vote) {
  const data = await envoyerAction(`/api/rooms/${roomId}/boss_vote`, { vote });
  await definirDraft(data.draft);
}

function rendreChoixBoss() {
  if (draft.boss_id !== bossAnimeId && !animationBossEnCours) jouerAnimationBoss(draft.boss_id);

  const votes = draft.votes_boss || {};
  const nom = role => pseudoColore(role); // couleur de son rôle
  const libelle = vote => vote === "relancer" ? "veut relancer 🎲" : "confirme le boss ✓";
  const message = document.getElementById("message-boss");
  const relances = draft.relances_boss ? ` (${draft.relances_boss} relance${draft.relances_boss > 1 ? "s" : ""})` : "";

  document.getElementById("choix-boss").classList.toggle("cache", !monRole);
  if (!monRole) {
    message.innerHTML = `Choix du boss${relances} : ${["j1", "j2"].map(role => votes[role] ? `${nom(role)} ${libelle(votes[role])}` : `${nom(role)} réfléchit…`).join(" · ")}`;
    return;
  }

  const monVote = votes[monRole];
  const autre = getAutreRole(monRole);
  ["confirmer", "relancer"].forEach(vote => {
    const bouton = document.getElementById(vote === "confirmer" ? "btn-confirmer-boss" : "btn-relancer-boss");
    bouton.classList.toggle("active", monVote === vote);
    bouton.disabled = animationBossEnCours;
    bouton.onclick = () => postVoteBoss(vote).catch(err => alert(err.message));
  });

  message.innerHTML = !monVote
    ? `Boss tiré${relances}. Confirme-le, ou propose de le relancer : il ne change que si vous voulez tous les deux le relancer.`
    : votes[autre]
      ? "…"
      : `Tu ${monVote === "relancer" ? "veux relancer" : "confirmes le boss"}. En attente de ${nom(autre)}… (tu peux encore changer d'avis)`;
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

  rendreTableaux();

  const prochaine = getProchaineActionLocale();
  const cEstMonTour = !!prochaine && prochaine.joueur === monRole;
  // Action que vise une sélection : la courante à mon tour ; sinon ma
  // prochaine (présélection pendant le tour de l'adversaire, gardée pour
  // mon tour, que je confirme alors).
  const cible = monRole ? getProchaineActionDe(monRole) : null;
  const preselection = !!cible && !cEstMonTour;
  const restrictionPick = cible?.action.type === "pick";
  const monPool = monRole === "j1" ? draft.pool_j1 : draft.pool_j2;
  const jePeuxLePicker = id => !restrictionPick || !!monPool?.includes(id);

  // Sélection périmée (action jouée, personnage plus disponible) : oubliée.
  if (selectionDraft && (!cible || selectionDraft.index !== cible.index ||
      !draft.pool_disponible.includes(selectionDraft.persoId) || !jePeuxLePicker(selectionDraft.persoId))) {
    selectionDraft = null;
  }
  const persoSelectionne = selectionDraft && getPersonnageParId(selectionDraft.persoId);

  // Message de l'action : "pick" / "bannir" en gras ; à son tour, en
  // couleur de l'action (pick vert, ban rouge).
  const typeAction = prochaine?.type === "ban" ? "ban" : "pick";
  const tourContainer = document.getElementById("tour-actuel");
  tourContainer.classList.toggle("a-mon-tour", cEstMonTour);
  tourContainer.classList.toggle("action-ban", typeAction === "ban");
  tourContainer.classList.toggle("action-pick", typeAction === "pick");
  if (!prochaine) {
    tourContainer.innerHTML = "Draft terminée.";
  } else {
    const verbe = prochaine.type === "ban" ? "bannir" : "pick";
    if (draft.entrainement && cEstMonTour) {
      // Entraînement : on joue à la place de quelqu'un, consigne à son nom.
      const choix = persoSelectionne
        ? ` : <strong>${persoSelectionne.nom}${selectionDraft.element ? ` ${NOMS_ELEMENTS[selectionDraft.element] || ""}` : ""}</strong>`
        : " un personnage, puis confirme.";
      tourContainer.innerHTML = `À ${pseudoColore(prochaine.joueur)} de <strong class="verbe-action">${verbe}</strong>${choix}`;
    } else if (cEstMonTour) {
      const choix = persoSelectionne
        ? ` : <strong>${persoSelectionne.nom}${selectionDraft.element ? ` ${NOMS_ELEMENTS[selectionDraft.element] || ""}` : ""}</strong>`
        : " un personnage, puis confirme.";
      tourContainer.innerHTML = `À toi de <strong class="verbe-action">${verbe}</strong>${choix}`;
    } else {
      // Pseudo dans la couleur de son rôle ; action sans couleur (pas mon tour).
      const nomAdversaire = pseudoColore(prochaine.joueur);
      const monAction = cible?.action.type === "ban" ? "ban" : "pick";
      const textePreselection = !preselection ? ""
        : persoSelectionne
        ? `<br>Présélection pour ton ${monAction} : <strong>${persoSelectionne.nom}${selectionDraft.element ? ` ${NOMS_ELEMENTS[selectionDraft.element] || ""}` : ""}</strong> (à confirmer à ton tour).`
        : `<br>Tu peux présélectionner ton prochain ${monAction}.`;
      tourContainer.innerHTML = `En attente : ${nomAdversaire} doit <strong class="verbe-action">${verbe}</strong> un personnage.${textePreselection}`;
    }
  }

  // Bouton "Confirmer" au-dessus du message (joueurs seulement) : gris hors
  // de son tour ; à son
  // tour, contour de la couleur de l'action, puis rempli une fois un
  // personnage sélectionné.
  const btnConfirmer = document.getElementById("btn-confirmer-action");
  btnConfirmer.classList.toggle("cache", !prochaine || !monRole);
  btnConfirmer.classList.toggle("a-mon-tour", cEstMonTour);
  btnConfirmer.classList.toggle("action-ban", typeAction === "ban");
  btnConfirmer.classList.toggle("action-pick", typeAction === "pick");
  btnConfirmer.classList.toggle("pret", cEstMonTour && !!selectionDraft);
  btnConfirmer.disabled = !cEstMonTour || !selectionDraft || monTempsEcoule();
  btnConfirmer.textContent = typeAction === "ban" ? "Confirmer le ban" : "Confirmer le pick";
  btnConfirmer.onclick = () => {
    const selection = selectionDraft;
    if (!selection) return;
    btnConfirmer.disabled = true;
    postActionDraft(selection.persoId, selection.element)
      .then(() => { selectionDraft = null; })
      .catch(err => {
        btnConfirmer.disabled = false;
        alert(err.message);
      });
  };

  // Entraînement : retour au coup précédent, dès le 1er ban / pick fait.
  const btnAnnuler = document.getElementById("btn-annuler-coup");
  btnAnnuler.classList.toggle("cache", !draft.entrainement || !monRole || !(draft.actions || []).some(action => !action.bonus));
  btnAnnuler.onclick = () => {
    btnAnnuler.disabled = true;
    postAnnulerCoup()
      .catch(err => alert(err.message))
      .finally(() => { btnAnnuler.disabled = false; });
  };

  const grille = document.getElementById("grille-pool-draft");
  const cleGrille = JSON.stringify([
    draft.actions, draft.sequence_index, draft.pool_disponible, draft.pool_j1, draft.pool_j2,
    draft.discord_j1, draft.discord_j2, monRole, selectionDraft,
    ...cleFiltres()
  ]);
  if (!grilleAChange(grille, cleGrille)) return;

  const personnages = draft.pool_disponible
    .map(id => getPersonnageParId(id))
    .filter(p => p && personnageCorrespondFiltres(p));

  remplirGrilleGroupee(grille, groupesDraft(personnages), carteDraftOuArme(grille, personnage => {
    const peutLePicker = jePeuxLePicker(personnage.id);
    const selectionnable = !!cible && peutLePicker;

    return obtenirCarteItem(grille, personnage, {
      selectionnable,
      indisponible: !!cible && !peutLePicker,
      selectionnee: selectionDraft?.persoId === personnage.id,
      // Clic : sélectionne (ou désélectionne) le personnage ; l'action n'est
      // envoyée qu'avec "Confirmer". Pick du Voyageur / Manekin : élément
      // choisi à la sélection. Action visée relue au clic, pas au rendu :
      // une carte inchangée est recyclée avec ce gestionnaire (cf.
      // obtenirCarteItem), par exemple d'un pick au suivant d'un double pick.
      onClick: () => {
        if (selectionDraft?.persoId === personnage.id) {
          selectionDraft = null;
          rendrePhase();
          return;
        }
        const cibleClic = monRole ? getProchaineActionDe(monRole) : null;
        if (!cibleClic) return;
        const choisir = element => {
          selectionDraft = { persoId: personnage.id, element, index: cibleClic.index };
          rendrePhase();
        };
        const choix = cibleClic.action.type === "pick" ? getElementsAuPick(personnage.id) : null;
        if (!choix) choisir(null);
        else if (choix.length === 1) choisir(choix[0]);
        else ouvrirChoixElement(personnage, choix, choisir);
      },
      ...getInfosCarte(personnage.id)
    }, restrictionPick ? "pick" : "");
  }));
}

// ---- Grilles de persos : reconstruction seulement si nécessaire ----
// Le polling rappelle le rendu toutes les 2.5s : reconstruire la grille à
// chaque fois recrée la carte survolée, qui rejoue alors son animation de
// survol (effet "faux clic"). On ne la reconstruit que si ce qui l'affecte
// (état de la draft, filtres, rôles) a changé. Vide la grille si oui.

// Part de la clé de grille qui dépend de la barre recherche/tri/filtres.
function cleFiltres() {
  return [filtreVue, [...filtreElement], [...filtreArme], [...filtreEtoile], [...filtreVoeux], [...filtreFactions], [...filtreSoutiens], filtreProprietaire, filtrePossession, rechercheTexte, etatTri.tris];
}

// Le contenu est ensuite remplacé en une fois (remplirGrilleGroupee), en
// recyclant les cartes inchangées.
function grilleAChange(grille, cle) {
  if (grille.dataset.cle === cle) return false;
  grille.dataset.cle = cle;
  return true;
}

// ---- Grilles de persos : écarts homogènes, grille centrée (même écart sur
// les bords), cf. ajusterGrille (commun/cartes.js).

function initialiserGrillesPersos() {
  observerGrilles(document.querySelectorAll(".grille-pool"), { tailleDefaut: 130 });
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

  // Personnages / Armes (mêmes logos que Mon compte), en premier ; un seul à
  // la fois, un 2e clic le désactive.
  const zoneVue = document.createElement("div");
  zoneVue.className = "filtres-icones filtres-vue";
  zoneVue.id = "filtres-vue";
  // Personnages : tête du Voyageur, mise à jour avec les variantes (cf. definirDraft).
  [["characters", "Aether_Icon_Character.webp", "Personnages"], ["weapons", "Icon_Inventory_Weapons.webp", "Armes"]].forEach(([valeur, logo, nom]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.dataset.vue = valeur;
    btn.title = nom;
    btn.innerHTML = `<img src="../DB/images/others/${logo}" alt="${nom}">`;
    btn.addEventListener("click", () => {
      filtreVue = filtreVue === valeur ? null : valeur;
      zoneVue.querySelectorAll(".filtre-icone-btn").forEach(b => b.classList.toggle("active", b.dataset.vue === filtreVue));
      rendrePhase();
    });
    zoneVue.appendChild(btn);
  });
  zoneVue.dataset.filtre = "vue";
  figeables.appendChild(zoneVue);

  const zoneIcones = document.createElement("div");
  zoneIcones.className = "filtres-icones";
  Object.entries(iconesElements).forEach(([valeur, src]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.innerHTML = `<img src="${src}" alt="${valeur}">`;
    btn.addEventListener("click", () => {
      basculerSelection(filtreElement, valeur);
      btn.classList.toggle("active");
      rendrePhase();
    });
    zoneIcones.appendChild(btn);
  });
  zoneIcones.dataset.filtre = "elements";
  figeables.appendChild(zoneIcones);

  const zoneArmes = document.createElement("div");
  zoneArmes.className = "filtres-icones";
  Object.entries(ICONES_TYPES_ARMES_TRI).forEach(([valeur, src]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.innerHTML = `<img src="${src}" alt="${valeur}">`;
    btn.addEventListener("click", () => {
      basculerSelection(filtreArme, valeur);
      btn.classList.toggle("active");
      rendrePhase();
    });
    zoneArmes.appendChild(btn);
  });
  zoneArmes.dataset.filtre = "armes";
  figeables.appendChild(zoneArmes);

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
  zoneEtoiles.dataset.filtre = "etoiles";
  figeables.appendChild(zoneEtoiles);

  const zoneVoeux = document.createElement("div");
  zoneVoeux.className = "filtres-icones filtre-voeu";
  Object.entries(VOEUX).forEach(([valeur, voeu]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.title = voeu.nom;
    btn.innerHTML = `<img src="${voeu.image}" alt="${voeu.nom}">`;
    btn.addEventListener("click", () => {
      basculerSelection(filtreVoeux, valeur);
      btn.classList.toggle("active");
      rendrePhase();
    });
    zoneVoeux.appendChild(btn);
  });
  zoneVoeux.dataset.filtre = "voeux";
  figeables.appendChild(zoneVoeux);

  const zoneFactions = document.createElement("div");
  zoneFactions.className = "filtres-icones filtre-voeu";
  Object.entries(FACTIONS).forEach(([valeur, faction]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.title = faction.nom;
    btn.innerHTML = `<img src="${faction.image}" alt="${faction.nom}">`;
    btn.dataset.faction = valeur;
    btn.addEventListener("click", () => {
      basculerFiltreFaction(filtreFactions, valeur);
      zoneFactions.querySelectorAll(".filtre-icone-btn").forEach(b => b.classList.toggle("active", filtreFactions.has(b.dataset.faction)));
      rendrePhase();
    });
    zoneFactions.appendChild(btn);
  });
  zoneFactions.dataset.filtre = "factions";
  figeables.appendChild(zoneFactions);

  // Rôles (bouclier, soin) : cumulables, groupés dans l'ordre des clics.
  const zoneSoutiens = document.createElement("div");
  zoneSoutiens.className = "filtres-icones filtre-voeu";
  Object.entries(SOUTIENS).forEach(([valeur, soutien]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-icone-btn";
    btn.title = soutien.nom;
    btn.innerHTML = `<img src="${soutien.image}" alt="${soutien.nom}">`;
    btn.addEventListener("click", () => {
      basculerSelection(filtreSoutiens, valeur);
      btn.classList.toggle("active");
      rendrePhase();
    });
    zoneSoutiens.appendChild(btn);
  });
  zoneSoutiens.dataset.filtre = "soutiens";
  figeables.appendChild(zoneSoutiens);

  // Favoris du joueur connecté : filtre (seuls les favoris), activé /
  // désactivé, avec les autres filtres.
  const zoneFavoris = document.createElement("div");
  zoneFavoris.className = "filtres-icones";
  const btnFavoris = document.createElement("button");
  btnFavoris.type = "button";
  btnFavoris.className = "filtre-icone-btn tri-btn filtre-favoris";
  btnFavoris.dataset.tri = "favoris";
  majBoutonTri(btnFavoris, etatTri);
  btnFavoris.addEventListener("click", () => {
    cyclerTri(etatTri, "favoris");
    majBoutonTri(btnFavoris, etatTri);
    rendrePhase();
  });
  zoneFavoris.appendChild(btnFavoris);
  zoneFavoris.dataset.filtre = "favoris";
  figeables.appendChild(zoneFavoris);

  const zoneProprio = document.createElement("div");
  zoneProprio.className = "filtres-proprietaire";
  zoneProprio.id = "filtres-proprietaire";
  // J1, J2 (persos de ce joueur), = (en commun) et Δ (différents) : un seul
  // à la fois, un 2e clic le désactive.
  [["j1", "J1", "Persos de J1"], ["j2", "J2", "Persos de J2"], ["commun", "=", "Persos que les 2 joueurs ont"], ["difference", "Δ", "Persos qu'un seul des 2 joueurs a : ceux de J1, puis ceux de J2"]].forEach(([valeur, label, titre]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-proprietaire-btn";
    btn.dataset.role = valeur;
    btn.textContent = label;
    btn.title = titre;
    btn.addEventListener("click", () => {
      const actif = filtreProprietaire === valeur || filtrePossession === valeur;
      filtreProprietaire = !actif && (valeur === "j1" || valeur === "j2") ? valeur : null;
      filtrePossession = !actif && (valeur === "commun" || valeur === "difference") ? valeur : null;
      zoneProprio.querySelectorAll(".filtre-proprietaire-btn").forEach(b => b.classList.toggle("active", b === btn && !actif));
      rendrePhase();
    });
    zoneProprio.appendChild(btn);
  });
  zoneProprio.dataset.filtre = "proprietaire";
  figeables.appendChild(zoneProprio);

  const btnClear = document.createElement("button");
  btnClear.type = "button";
  btnClear.className = "btn-clear-filtres";
  btnClear.title = "Réinitialiser les filtres";
  btnClear.innerHTML = '<img src="../DB/images/others/remove_filters.webp" alt="Réinitialiser les filtres">';
  btnClear.addEventListener("click", () => {
    filtreVue = null;
    filtreElement.clear();
    filtreArme.clear();
    filtreEtoile.clear();
    filtreVoeux.clear();
    filtreFactions.clear();
    filtreSoutiens.clear();
    filtreProprietaire = null;
    filtrePossession = null;
    rechercheTexte = "";
    viderTris(etatTri);
    document.getElementById("barre-outils").querySelectorAll(".active").forEach(b => b.classList.remove("active"));
    document.querySelectorAll("#barre-outils .tri-btn").forEach(b => majBoutonTri(b, etatTri));
    const input = document.getElementById("recherche-personnage");
    if (input) input.value = "";
    rendrePhase();
  });
  btnClear.dataset.filtre = "clear";
  container.appendChild(btnClear);

  const inputRecherche = document.createElement("input");
  inputRecherche.type = "text";
  inputRecherche.id = "recherche-personnage";
  inputRecherche.className = "recherche-personnage";
  inputRecherche.placeholder = "Rechercher…";
  inputRecherche.dataset.filtre = "recherche";
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
  ["points", "constellation", "niveau", "raffinement", "rarete", "element", "bonus_saison"].forEach(valeur => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-etoile-btn tri-btn";
    btn.dataset.tri = valeur;
    btn.dataset.filtre = `tri_${valeur}`;
    majBoutonTri(btn, etatTri);
    btn.addEventListener("click", () => {
      cyclerTri(etatTri, valeur);
      document.querySelectorAll("#barre-outils .tris .tri-btn").forEach(b => majBoutonTri(b, etatTri));
      rendrePhase();
    });
    zoneTris.appendChild(btn);
  });
  zoneRecherche.appendChild(zoneTris);

  // Téléphone : filtres, tris, recherche et Réinitialiser non figés (bloc
  // au-dessus du bloc figé) et figés (dans le bloc figé), cf.
  // placerFiltresDraft.
  const libres = document.createElement("div");
  libres.className = "filtres-libres";
  container.insertBefore(libres, figeables);
  const trisFiges = document.createElement("div");
  trisFiges.className = "tris tris-figes";
  trisFiges.innerHTML = `<span class="tris-label">Trier :</span>`;
  barreFiltres = { container, figeables, libres, zoneRecherche, zoneTris, trisFiges, btnClear };
  placerFiltresDraft();
  MEDIA_TELEPHONE.addEventListener("change", placerFiltresDraft);
}

// ---- Filtres et tris choisis par le joueur (Personnalisation, cf.
// commun/filtres_draft.js) : masqués ou affichés, figés ou non en haut de
// l'écran sur téléphone. Sur ordi, toute la barre reste figée : chacun à
// sa place habituelle. ----
// MEDIA_TELEPHONE : commun/cartes.js.
let choixFiltresDraft = lireFiltresDraft(null);
let barreFiltres = null;

// Choix du joueur connecté (profil), lus au démarrage de la page.
async function chargerChoixFiltresDraft() {
  try {
    const reponse = await fetch("/api/auth/profile", { credentials: "include" });
    if (!reponse.ok) return;
    choixFiltresDraft = lireFiltresDraft((await reponse.json()).profil?.parametres?.filtres_draft);
  } catch (erreur) {
    console.error(erreur);
  }
}

function placerFiltresDraft() {
  if (!barreFiltres) return;
  const { container, figeables, libres, zoneRecherche, zoneTris, trisFiges, btnClear } = barreFiltres;
  const telephone = MEDIA_TELEPHONE.matches;
  const masques = new Set(choixFiltresDraft.masques);
  const fige = id => telephone && choixFiltresDraft.figes.includes(id);
  const element = id => container.closest("#barre-outils").querySelector(`[data-filtre="${id}"]`);

  // Recherche : en tête du bloc figé, sinon (téléphone) du bloc non figé,
  // sinon (ordi) avant les tris.
  const recherche = element("recherche");
  if (fige("recherche")) figeables.prepend(recherche);
  else (telephone ? libres : zoneRecherche).prepend(recherche);
  // Filtres, puis tris figés et Réinitialiser (dans l'ordre de la liste).
  FILTRES_DRAFT.forEach(filtre => {
    const el = element(filtre.id);
    if (!el) return;
    el.classList.toggle("filtre-masque", masques.has(filtre.id));
    if (filtre.id === "recherche" || filtre.id === "clear") return;
    if (filtre.groupe === "tris") (fige(filtre.id) ? trisFiges : zoneTris).appendChild(el);
    else (telephone && !fige(filtre.id) ? libres : figeables).appendChild(el);
  });
  figeables.appendChild(trisFiges);
  // Téléphone : tris non figés dans le bloc non figé (après ses filtres) ;
  // ordi : à droite de la recherche.
  if (telephone) libres.appendChild(zoneTris);
  else zoneRecherche.appendChild(zoneTris);
  if (fige("clear")) figeables.appendChild(btnClear);
  else (telephone ? libres : container).appendChild(btnClear);
  compacterFiltresFiges();
}

// Téléphone : blocs figé et non figé en grilles de COLONNES_FIGES boutons
// par ligne (cf. CSS). Éléments puis types d'arme : chacun en début de sa propre ligne,
// sans coupure ; la fin de ces lignes, puis les suivantes, sont remplies
// par les autres filtres puis par les tris (un groupe entier s'il tient
// dans la place restante, sinon le début du suivant). Recherche : seule
// sur la 1re ligne de son bloc. Seuls les boutons visibles comptent (refait à
// chaque rendu : J1/J2, favoris, bonus de saison changent selon la phase).
const COLONNES_FIGES = 8;

function compacterFiltresFiges() {
  if (!barreFiltres) return;
  compacterBlocFiltres(barreFiltres.figeables);
  compacterBlocFiltres(barreFiltres.libres);
}

function compacterBlocFiltres(figeables) {
  figeables.querySelectorAll("button, input").forEach(el => {
    el.style.gridRow = "";
    el.style.gridColumn = "";
  });
  if (!MEDIA_TELEPHONE.matches) return;

  const visible = el => !el.closest(".cache, .filtre-masque, [hidden]");
  const poser = (el, ligne, colonne) => {
    el.style.gridRow = String(ligne + 1);
    el.style.gridColumn = String(colonne + 1);
  };
  let ligne = 0;
  const recherche = figeables.querySelector('[data-filtre="recherche"]');
  if (recherche && visible(recherche)) {
    recherche.style.gridRow = "1";
    recherche.style.gridColumn = "1 / -1";
    ligne = 1;
  }

  // Groupes de boutons visibles, dans l'ordre : filtres puis tris (un tri
  // = un groupe).
  const groupes = [];
  [...figeables.children].forEach(enfant => {
    if (enfant === recherche) return;
    const boutons = enfant.classList.contains("tris")
      ? [...enfant.querySelectorAll(".tri-btn")].filter(visible).map(bouton => ({ id: bouton.dataset.filtre, boutons: [bouton] }))
      : [{ id: enfant.dataset.filtre, boutons: (enfant.matches("button") ? [enfant] : [...enfant.querySelectorAll("button")]).filter(visible) }];
    groupes.push(...boutons.filter(groupe => groupe.boutons.length));
  });

  const remplir = (colonne) => {
    while (colonne < COLONNES_FIGES && groupes.length) {
      const libre = COLONNES_FIGES - colonne;
      const index = groupes.findIndex(groupe => groupe.boutons.length <= libre);
      const boutons = index >= 0 ? groupes.splice(index, 1)[0].boutons : groupes[0].boutons.splice(0, libre);
      boutons.forEach(bouton => poser(bouton, ligne, colonne++));
    }
    ligne++;
  };
  ["elements", "armes"].forEach(id => {
    const index = groupes.findIndex(groupe => groupe.id === id && groupe.boutons.length <= COLONNES_FIGES);
    if (index < 0) return;
    const { boutons } = groupes.splice(index, 1)[0];
    boutons.forEach((bouton, colonne) => poser(bouton, ligne, colonne));
    remplir(boutons.length);
  });
  while (groupes.length) remplir(0);
}

// Filtre J1/J2 : inutile pendant le choix de box et l'analyse (une colonne
// par joueur) ; avant le tirage, j1/j2 ne sont que des places provisoires,
// donc les boutons portent le nom des joueurs.
function mettreAJourFiltreProprietaire() {
  // Favoris : ceux du joueur connecté, pas de sens pour un spectateur.
  const btnFavoris = document.querySelector('#barre-outils .tri-btn[data-tri="favoris"]');
  if (btnFavoris) btnFavoris.hidden = !monRole;
  // Après les changements de visibilité ci-dessous (fin de fonction).
  queueMicrotask(compacterFiltresFiges);
  // Bonus de saison : matchs classés seulement.
  const btnBonus = document.querySelector('#barre-outils .tri-btn[data-tri="bonus_saison"]');
  if (btnBonus) btnBonus.hidden = !estMatchClasse();

  const enBox = draft.phase === "choix_box" || draft.phase === "analyse";

  const zone = document.getElementById("filtres-proprietaire");
  if (!zone) return;
  zone.classList.toggle("cache", enBox);
  zone.querySelectorAll('.filtre-proprietaire-btn[data-role="j1"], .filtre-proprietaire-btn[data-role="j2"]').forEach(btn => {
    const joueur = btn.dataset.role === "j1" ? joueur1 : joueur2;
    const avecNom = !draft.roles_tires && !!joueur;
    btn.textContent = avecNom ? joueur.nom : btn.dataset.role.toUpperCase();
    btn.classList.toggle("pseudo", avecNom);
  });
}

// ---- Annonce du rôle au tirage ----
// Affichée 5 s quand la draft démarre (tirage J1/J2 en 1re manche, rôles
// inversés en revanche). L'animation CSS gère l'apparition/disparition.
// Draft classée : affichée jusqu'au départ du chrono du premier joueur
// (draft.chrono.tour_debut, heure du serveur), qui démarre donc quand elle
// disparaît.
function annoncerRole() {
  // Entraînement seul : il joue les 2 rôles, pas d'annonce.
  if (!monRole || estEntrainementSolo()) return;
  const premiere = getSequence()[0];
  const verbe = premiere?.type === "pick" ? "pickes" : "bannis";
  const verbeAdversaire = premiere?.type === "pick" ? "picke" : "bannit";
  const duree = draft.chrono && draft.sequence_index === 0
    ? Math.min(10000, Math.max(3000, draft.chrono.tour_debut - heureServeur()))
    : 5000;
  const annonce = document.createElement("div");
  annonce.className = `annonce-role annonce-${monRole}`;
  annonce.style.animationDuration = `${duree}ms`;
  annonce.innerHTML = `
    <div class="annonce-titre">Tu es ${monRole.toUpperCase()}</div>
    <div class="annonce-sous-titre">${premiere?.joueur === monRole ? `Tu ${verbe} en premier.` : `Ton adversaire ${verbeAdversaire} en premier.`}</div>
  `;
  document.body.appendChild(annonce);
  setTimeout(() => annonce.remove(), duree);
}

// ---- Phases 4 et 5 : saisie du temps, vérification, résultat ----
// Mêmes tableaux qu'en draft (cf. rendreTableauJoueur) ; résultat, boss et
// Rejouer au centre. Les 2 temps saisis sont d'abord vérifiés par les 2
// joueurs (verification) : confirmés -> termine, contestés -> litige (manche
// invalidée, pas dans l'historique).
const PHASES_RECAP = ["temps", "verification", "termine", "litige"];

// Case d'un pick : personnage sur sa bannière + ses infos chez ce joueur
// (constellation, niveau, arme signature) ; élément pour le Voyageur /
// Manekin.
function creerCaseRecap(personnage, role, element = null) {
  const slot = document.createElement("div");
  slot.className = "slot-pick";
  remplirCaseTableau(slot, appliquerVariante(personnage, getJoueurDataParRole(role)?.parametres), element);

  // À côté du personnage, côté centre de l'écran : à sa droite pour j1, à
  // sa gauche pour j2 (la case de j2 est en miroir).
  const zoneInfos = creerInfosCase(personnage, role, getInfosCarte(personnage.id, [role], element), element);
  if (zoneInfos) slot.appendChild(zoneInfos);
  return slot;
}

// Infos d'un personnage chez un joueur dans une case de tableau :
// constellation, niveau, arme signature, élément (Voyageur / Manekin).
// null si le joueur ne le possède pas.
function creerInfosCase(personnage, role, infos, element = null) {
  const suffixe = role === "j1" ? "J1" : "J2";
  if (!infos[`constellation${suffixe}`]) return null;

  const zoneInfos = document.createElement("div");
  zoneInfos.className = `infos-case infos-${role}`;
  zoneInfos.innerHTML = [
    `<span class="pastille-case">${infos[`constellation${suffixe}`]}</span>`,
    infos[`niveau${suffixe}`] ? `<span class="pastille-case">${infos[`niveau${suffixe}`]}</span>` : "",
    htmlArmeSignature(personnage.arme, infos[`refinement${suffixe}`], {
      classe: "arme-case",
      titre: `${role.toUpperCase()} : arme signature R${(infos[`refinement${suffixe}`] ?? 0) + 1}`
    }),
    element && ICONES_ELEMENTS_TRI[element]
      ? `<img class="element-case" src="${ICONES_ELEMENTS_TRI[element]}" alt="${element}" title="${NOMS_ELEMENTS[element] || element}">`
      : ""
  ].join("");
  return zoneInfos;
}

// Temps d'un joueur, au-dessus de son tableau : champ de saisie pour le joueur
// connecté pendant la saisie (et pour corriger pendant la vérification) ;
// sinon un texte (temps de l'adversaire masqué jusqu'à la vérification).
function rendreTempsJoueur(role, zone) {
  const temps = draft[`temps_${role}`];
  const saisie = document.getElementById("saisie-temps");
  const roleSaisie = roleSaisieTemps();
  const saisieIci = role === roleSaisie && (!!draft.entrainement ||
    (draft.phase === "temps" && !temps) || (draft.phase === "verification" && !draft[`temps_confirme_${role}`]));
  // Entraînement : pas d'abandon (le temps est facultatif).
  document.getElementById("btn-abandon").classList.toggle("cache", !!draft.entrainement);

  const mots = motsResultat();
  let texte = "";
  if (draft.phase === "verification") {
    texte = temps ? `${mots.Le} : ${temps.affiche}${draft[`temps_confirme_${role}`] ? " · confirmé ✓" : ""}` : "";
  } else if (draft.phase === "termine" || draft.phase === "litige") {
    texte = temps?.affiche ? `${mots.Le} : ${temps.affiche}` : "";
  } else if (role === monRole) {
    texte = temps ? `Ton ${mots.le} : ${temps.affiche}` : "";
  } else {
    texte = temps ? `${mots.Le} enregistré ✓` : `En attente de son ${mots.le}…`;
  }

  let ligne = zone.querySelector(".texte-temps");
  if (!ligne) {
    ligne = document.createElement("div");
    ligne.className = "texte-temps";
    zone.prepend(ligne);
  }
  ligne.textContent = texte;
  ligne.classList.toggle("cache", !texte);

  rendreLienStream(role, zone);

  if (saisieIci && saisie.parentElement !== zone) zone.appendChild(saisie);
  if (role === roleSaisie) saisie.classList.toggle("cache", !saisieIci);
}

// Lien de stream du joueur (Mon compte, menu du compte), sous son temps :
// pour revoir sa partie et vérifier le temps. Nouvel onglet ; http(s)
// seulement (déjà filtré à l'enregistrement, cf. api/auth/profile.js).
// Revérifié avant affichage (anciens liens enregistrés avant la règle
// Twitch / YouTube) : cf. lienStreamAutorise, commun/cartes.js.
function lienStreamValide(texte) {
  return lienStreamAutorise(texte) || null;
}

function rendreLienStream(role, zone) {
  const joueur = role === "j1" ? joueur1 : joueur2;
  // Entraînement : personne ne joue la partie, pas de stream.
  const href = draft.entrainement ? null : lienStreamValide(joueur?.data?.stream);
  let lien = zone.querySelector(".lien-stream");
  if (!href) {
    lien?.remove();
    return;
  }
  if (!lien) {
    lien = document.createElement("a");
    lien.className = "lien-stream";
    lien.target = "_blank";
    lien.rel = "noopener noreferrer";
    zone.querySelector(".texte-temps").after(lien);
  }
  lien.href = href;
  lien.innerHTML = `📺 Stream de ${joueur.pseudo}`;
  lien.title = href;
}

// ---- Localisation d'une légende locale sur la carte ----
// Image DB/images/boss/legend_local/carte/<id du boss>.webp (pas encore
// toutes prises : message à la place si elle manque).
function htmlBoutonCarteLegende() {
  return `<button type="button" class="btn-carte-legende" title="Où trouver cette légende locale">
    <img src="../DB/images/others/Icon_Map.webp" alt="">Localisation
  </button>`;
}

function ouvrirCarteLegende(boss) {
  const fenetre = document.getElementById("carte-legende");
  fenetre.querySelector(".titre-carte-legende").textContent = boss.nom;
  const image = fenetre.querySelector("img");
  const absente = fenetre.querySelector(".carte-absente");
  image.classList.remove("cache");
  absente.classList.add("cache");
  image.onerror = () => {
    image.classList.add("cache");
    absente.classList.remove("cache");
  };
  image.src = `../DB/images/boss/legend_local/carte/${boss.id}.webp`;
  image.alt = `Localisation de ${boss.nom}`;
  fenetre.classList.remove("cache");
}

function initialiserCarteLegende() {
  const fenetre = document.getElementById("carte-legende");
  fenetre.addEventListener("click", event => {
    if (event.target === fenetre || event.target.closest(".fermer-carte-legende")) fenetre.classList.add("cache");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") fenetre.classList.add("cache");
  });
}

// Défi (cf. estDefiEnnemis, commun/cartes.js) : nombre d'ennemis tués saisi
// à la place d'un temps.
function defiEnCours() {
  return estDefiEnnemis(bossData.find(b => b.id === draft?.boss_id));
}

// Mots des textes de la saisie : "temps" ou "score" (défi).
function motsResultat() {
  return defiEnCours()
    ? { un: "un score", le: "score", Le: "Score", les: "scores", Les: "Scores" }
    : { un: "un temps", le: "temps", Le: "Temps", les: "temps", Les: "Temps" };
}

// Valeur du champ de saisie pour un résultat déjà enregistré : "7:32", ou
// le nombre d'ennemis seul pour un défi (affiché "42 ennemis").
function valeurSaisie(temps) {
  if (!temps || temps.abandon) return "";
  return defiEnCours() ? String(temps.secondes) : temps.affiche || "";
}

// Libellés de la saisie et de la vérification selon le boss (temps ou
// nombre d'ennemis tués).
function rendreLibellesResultat() {
  const defi = defiEnCours();
  const input = document.getElementById("input-temps");
  const libelle = defi ? "Ennemis tués" : "Ton temps";
  document.querySelector("#saisie-temps label").textContent = libelle;
  input.placeholder = libelle;
  input.inputMode = defi ? "numeric" : "decimal";
  document.querySelector("#verification-temps .titre-verification").textContent = `Vérifie les deux ${motsResultat().les}`;
}

// Rôle dont le connecté saisit le temps : le sien ; en entraînement, celui
// de sa box pour le lanceur seulement, une fois la draft terminée
// (facultatif, cf. handleTempsEntrainement). null : pas de saisie.
function roleSaisieTemps() {
  // Tournoi : c'est l'arbitre qui saisit les temps (cf. rendreArbitre).
  if (draft.tournoi) return null;
  if (!draft.entrainement) return monRole;
  return draft.phase === "termine" && moiDiscordId === draft.entrainement.lanceur ? draft.entrainement.cote_moi : null;
}

function rendreRecap() {
  assurerBossAffiche();
  rendreTableaux();
  if (!roleSaisieTemps()) document.getElementById("saisie-temps").classList.add("cache");
  rendreLibellesResultat();

  const boss = bossData.find(b => b.id === draft.boss_id);
  const blocBoss = document.getElementById("recap-boss");
  const cleBoss = boss ? boss.id : "";
  if (blocBoss.dataset.cle !== cleBoss) {
    blocBoss.dataset.cle = cleBoss;
    blocBoss.innerHTML = boss
      ? `${htmlImagesBoss(boss)}<span class="nom-boss">${boss.nom}</span>${htmlBoutonChrono(boss)}${estLegendeLocale(boss) ? htmlBoutonCarteLegende() : ""}`
      : "";
    blocBoss.querySelector(".btn-chrono")?.addEventListener("click", event => basculerChrono(event.currentTarget));
    blocBoss.querySelector(".btn-carte-legende")?.addEventListener("click", () => ouvrirCarteLegende(boss));
  }

  const fini = draft.phase === "termine" || draft.phase === "litige";
  document.getElementById("resultat-final").classList.toggle("cache", !fini);
  document.getElementById("btn-rejouer").classList.toggle("cache", !fini);
  document.getElementById("verification-temps").classList.toggle("cache", draft.phase !== "verification");
}

function rendreTemps() {
  rendreRecap();
  if (draft.tournoi) {
    rendreArbitre();
    return;
  }

  if (!monRole) {
    const enAttente = ["j1", "j2"].filter(role => !draft[`temps_${role}`]).length;
    const { le, les } = motsResultat();
    document.getElementById("etat-temps").textContent =
      `En attente ${enAttente === 2 ? `des ${les} des 2 joueurs` : `du dernier ${le}`}…`;
    return;
  }

  const monTemps = draft[`temps_${monRole}`];
  const tempsAdversaire = draft[`temps_${getAutreRole(monRole)}`];

  const input = document.getElementById("input-temps");
  const btn = document.getElementById("btn-valider-temps");
  const etat = document.getElementById("etat-temps");

  input.disabled = !!monTemps;
  btn.disabled = !!monTemps;
  btn.textContent = "Valider";
  const btnAbandon = document.getElementById("btn-abandon");
  btnAbandon.disabled = !!monTemps;
  btnAbandon.textContent = "Abandonner";
  btnAbandon.onclick = declarerAbandon;

  const mots = motsResultat();
  if (monTemps && !tempsAdversaire) {
    etat.textContent = `${mots.Le} enregistré. En attente du ${mots.le} de l'adversaire…`;
  } else if (!monTemps) {
    etat.textContent = defiEnCours()
      ? "Entre le nombre d'ennemis que tu as tués pendant les 2 minutes du défi (ex : 42). Celui qui en tue le plus gagne."
      : "Entre ton temps en minutes et secondes (ex : 7:32, 7,32 ou 7.32).";
  } else {
    etat.textContent = "";
  }

  btn.onclick = envoyerTempsSaisi;
}

function envoyerTempsSaisi() {
  if (defiEnCours()) {
    const ennemis = document.getElementById("input-temps").value.trim();
    if (!/^[0-9]{1,4}$/.test(ennemis)) {
      alert("Nombre invalide. Entre le nombre d'ennemis tués, par exemple 42.");
      return;
    }
    (draft.entrainement ? postTempsEntrainement : postTemps)(ennemis).catch(err => alert(err.message));
    return;
  }
  // "7,32" et "7.32" (clavier numérique du téléphone) valent "7:32".
  const valeur = document.getElementById("input-temps").value.trim().replace(/[.,]/, ":");
  if (!/^[0-9]{1,3}:[0-5][0-9]$/.test(valeur)) {
    alert("Format invalide. Entre les minutes puis les secondes sur 2 chiffres, par exemple 7:32, 7,32 ou 7.32.");
    return;
  }
  (draft.entrainement ? postTempsEntrainement : postTemps)(valeur).catch(err => alert(err.message));
}

// ---- Phase 4 bis : vérification des temps ----
// Les 2 temps sont visibles : chaque joueur confirme qu'ils sont bons (son
// temps lui a été donné par l'adversaire, qui le chronométrait), peut encore
// corriger le sien (les confirmations sont alors à refaire) ou signale un
// litige.
function rendreVerification() {
  rendreRecap();
  const etat = document.getElementById("etat-temps");
  const confirmes = ["j1", "j2"].filter(role => draft[`temps_confirme_${role}`]).length;

  const mots = motsResultat();
  if (!monRole) {
    etat.textContent = `Vérification des ${mots.les} par les joueurs (${confirmes}/2)…`;
    document.querySelector("#verification-temps .boutons-verification").classList.add("cache");
    return;
  }

  const autreRole = getAutreRole(monRole);
  const nomAutre = pseudoColore(autreRole); // couleur de son rôle (bulles du bas)
  const jaiConfirme = draft[`temps_confirme_${monRole}`];
  const autreAConfirme = draft[`temps_confirme_${autreRole}`];

  // Correction de son temps (champ prérempli, envoyé seulement s'il change).
  const input = document.getElementById("input-temps");
  const btn = document.getElementById("btn-valider-temps");
  const monTemps = draft[`temps_${monRole}`];
  input.disabled = false;
  btn.disabled = false;
  btn.textContent = "Corriger";
  if (input.dataset.pour !== monTemps?.affiche) {
    input.dataset.pour = monTemps?.affiche || "";
    // Abandon : champ vide pour pouvoir saisir un temps à la place.
    input.value = monTemps?.abandon ? "" : valeurSaisie(monTemps);
  }
  btn.onclick = envoyerTempsSaisi;
  const btnAbandon = document.getElementById("btn-abandon");
  btnAbandon.disabled = !!monTemps?.abandon;
  btnAbandon.textContent = monTemps?.abandon ? "Abandon déclaré" : "Abandonner";
  btnAbandon.onclick = declarerAbandon;

  const btnConfirmer = document.getElementById("btn-confirmer-temps");
  btnConfirmer.disabled = jaiConfirme;
  btnConfirmer.classList.toggle("active", jaiConfirme);
  btnConfirmer.textContent = jaiConfirme ? `${mots.Les} confirmés ✓` : `Les ${mots.les} sont corrects`;
  btnConfirmer.onclick = () => postConfirmerTemps().catch(err => alert(err.message));

  document.getElementById("btn-litige").onclick = ouvrirFenetreLitige;

  if (jaiConfirme && !autreAConfirme) {
    etat.innerHTML = `${mots.Les} confirmés. En attente de la confirmation de ${nomAutre}…`;
  } else if (!jaiConfirme && autreAConfirme) {
    etat.innerHTML = `${nomAutre} a confirmé les ${mots.les}. Vérifie-les puis confirme, ou signale un litige.`;
  } else {
    etat.textContent = `Vérifie que les deux ${mots.les} sont les bons, puis confirme. En cas de désaccord, signale un litige.`;
  }
}

// ---- Phase 5 : résultat ----

// Litige : manche invalidée, pas de vainqueur ; revanche possible.
function rendreLitige() {
  rendreRecap();
  // Anti-triche : pas de détail de la détection côté joueurs (visible par
  // les administrateurs seulement, page Historique).
  if (draft.triche) {
    document.getElementById("resultat-final").innerHTML = `
      <p class="ligne-vainqueur"><span class="litige">Match invalidé</span></p>
      <p class="ligne-temps">Ce match est suspecté de triche : il ne compte pas et est transmis aux administrateurs.</p>
    `;
    rendreRejouer();
    return;
  }
  const nomLitige = draft.litige_par === "j1" ? joueur1.pseudo : draft.litige_par === "j2" ? joueur2.pseudo : null;
  const parQui = draft.litige_par === monRole ? "par toi" : nomLitige ? `par ${nomLitige}` : "";
  document.getElementById("resultat-final").innerHTML = `
    <p class="ligne-vainqueur"><span class="litige">Match invalidé</span></p>
    <p class="ligne-temps">Litige signalé ${parQui} sur les ${motsResultat().les} : ce match ne compte pas. Les administrateurs vérifieront les ${motsResultat().les} et pourront le republier${typeRoom === "classe" ? " (les trophées seront alors attribués)" : ""}.</p>
  `;
  rendreRejouer();
}

function rendreTermine() {
  rendreRecap();
  const container = document.getElementById("resultat-final");

  // Entraînement : pas de vainqueur, on peut relancer. Le lanceur peut
  // saisir son temps s'il a fait le boss (légende locale alors tuée).
  if (draft.entrainement) {
    const roleSaisie = roleSaisieTemps();
    const monTemps = roleSaisie && draft[`temps_${roleSaisie}`];
    let ligneBoss = "";
    if (roleSaisie) {
      const input = document.getElementById("input-temps");
      const btn = document.getElementById("btn-valider-temps");
      input.disabled = false;
      btn.disabled = false;
      btn.textContent = monTemps ? "Corriger" : "Valider";
      btn.onclick = envoyerTempsSaisi;
      if (input.dataset.pour !== (monTemps?.affiche || "")) {
        input.dataset.pour = monTemps?.affiche || "";
        input.value = valeurSaisie(monTemps);
      }
      ligneBoss = monTemps
        ? `<p class="ligne-temps">${messageLegendeTuee() || `Ton ${motsResultat().le} est enregistré dans l'historique.`}</p>`
        : defiEnCours()
          ? `<p class="ligne-temps">Tu as fait le défi avec ton équipe ? Entre le nombre d'ennemis tués au-dessus de ton tableau (facultatif).</p>`
          : `<p class="ligne-temps">Tu as fait le boss avec ton équipe ? Entre ton temps au-dessus de ton tableau (facultatif).</p>`;
    }
    container.innerHTML = `
      <p class="ligne-vainqueur"><span class="egalite">Entraînement terminé ${ICONE_ENTRAINEMENT}</span></p>
      <p class="ligne-temps">Draft de ${pseudoColore("j1")} contre ${pseudoColore("j2")}. Relance pour rejouer avec les mêmes box (rôles inversés).</p>
      ${ligneBoss}
    `;
    rendreRejouer();
    return;
  }

  // Résultat au-dessus du boss (les temps sont dans les tableaux).
  let ligneVainqueur;
  if (draft.vainqueur === "egalite") {
    ligneVainqueur = `<span class="egalite">Égalité !</span>`;
  } else if (monRole) {
    const gagne = draft.vainqueur === monRole;
    ligneVainqueur = `<span class="${gagne ? "vainqueur" : "perdant"}">${gagne ? "Tu as gagné !" : "Tu as perdu."}</span>`;
  } else {
    const nomGagnant = draft.vainqueur === "j1" ? joueur1.pseudo : joueur2.pseudo;
    ligneVainqueur = `<span class="vainqueur">${nomGagnant} gagne !</span>`;
  }

  // Classé : trophées gagnés / perdus, calculés par le serveur (bonus de
  // série et plancher à 0 compris) ; à défaut, trophées en jeu sans bonus.
  let ligneTrophees = "";
  if (typeRoom === "classe") {
    const resultat = draft.resultat_trophees;
    const enJeu = calculerTrophees();
    const delta = role => resultat ? resultat[role] : (draft.vainqueur === role ? enJeu : -enJeu);
    const signe = n => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
    const bonus = (resultat?.bonus ? ` (dont +${resultat.bonus} de série 🔥)` : "") +
      (resultat?.prime ? ` (dont +${resultat.prime} de prime ${ICONE_ENTRAINEMENT} : tu as battu la plus longue série en cours)` : "") +
      (resultat?.ecart ? ` (dont +${resultat.ecart} de bonus d'écart : adversaire mieux classé)` : "");
    // Bonus de saison (persos cochés dans l'admin) : gain augmenté, perte réduite.
    const saison = role => resultat?.saison?.[role]
      ? ` (bonus de saison : ${draft.vainqueur === role ? "+" : "−"}${resultat.saison[role]} ${draft.vainqueur === role ? "" : "de perte "}🌟)`
      : "";
    if (enJeu === 0) {
      ligneTrophees = `<p class="ligne-trophees">${ICONE_TROPHEE} Aucun trophée en jeu</p>`;
    } else if (monRole) {
      const n = delta(monRole);
      const gagne = draft.vainqueur === monRole;
      ligneTrophees = `<p class="ligne-trophees ${gagne ? "gain" : "perte"}">${ICONE_TROPHEE} ${signe(n)} trophée${Math.abs(n) > 1 ? "s" : ""}${gagne ? bonus : ""}${saison(monRole)}</p>`;
    } else {
      ligneTrophees = `<p class="ligne-trophees">${ICONE_TROPHEE} ${joueur1.pseudo} ${signe(delta("j1"))}, ${joueur2.pseudo} ${signe(delta("j2"))}${bonus}</p>`;
    }
  }

  const legende = messageLegendeTuee();
  // Classé : victoires du jour de chacun contre l'autre (premier à 2).
  const serie = draft.serie_classe;
  const ligneSerie = typeRoom === "classe" && serie
    ? `<p class="ligne-temps">Victoires du jour entre vous : ${joueur1.pseudo} ${serie.j1} – ${serie.j2} ${joueur2.pseudo}${serie.terminee ? " · série terminée, plus de match classé entre vous avant 4 h" : ""}</p>`
    : "";
  container.innerHTML = `
    <p class="ligne-vainqueur">${ligneVainqueur}</p>
    <p class="ligne-temps">${joueur1.pseudo} : ${draft.temps_j1.affiche} — ${joueur2.pseudo} : ${draft.temps_j2.affiche}</p>
    ${ligneTrophees}
    ${monRole ? htmlGainKoyns(draft.koyns?.[draft[`discord_${monRole}`]]) : ""}
    ${ligneSerie}
    ${legende ? `<p class="ligne-temps">${legende}</p>` : ""}
  `;
  rendreRejouer();
}

// ---- Tournois (cf. api/_lib/tournois.js) ----
// Les joueurs ne saisissent pas leur temps : un arbitre du tournoi
// (spectateur de la room) saisit les 2. Bo3 : il lance la manche suivante.

function estArbitreTournoi() {
  return !!draft.tournoi && (draft.tournoi.arbitres || []).includes(moiDiscordId);
}

function rendreArbitre() {
  // Un arbitre qui joue ce match ne saisit pas les temps (refusé par le
  // serveur) : un autre arbitre le fait.
  const arbitre = estArbitreTournoi() && !monRole;
  const zone = document.getElementById("saisie-arbitre");
  zone.classList.toggle("cache", !arbitre);
  document.getElementById("etat-temps").textContent = arbitre
    ? ""
    : `Combat en cours : un arbitre du tournoi${monRole && estArbitreTournoi() ? " (pas toi : tu joues ce match)" : ""} saisira les ${motsResultat().les}.`;
  if (!arbitre) return;
  ["j1", "j2"].forEach(role => {
    document.getElementById(`arbitre-nom-${role}`).innerHTML = pseudoColore(role);
    document.getElementById(`arbitre-temps-${role}`).placeholder = defiEnCours() ? "ennemis" : "7:32";
  });
  document.getElementById("btn-valider-arbitre").onclick = envoyerTempsArbitre;
}

function envoyerTempsArbitre() {
  const corps = {};
  for (const role of ["j1", "j2"]) {
    const abandon = document.getElementById(`arbitre-abandon-${role}`).checked;
    const brut = document.getElementById(`arbitre-temps-${role}`).value.trim();
    const valeur = defiEnCours() ? brut : brut.replace(/[.,]/, ":");
    if (!abandon && !(defiEnCours() ? /^[0-9]{1,4}$/ : /^[0-9]{1,3}:[0-5][0-9]$/).test(valeur)) {
      alert(`${role === "j1" ? "J1" : "J2"} : ${defiEnCours() ? "nombre d'ennemis invalide (ex : 42)" : "temps invalide (ex : 7:32)"}.`);
      return;
    }
    corps[`abandon_${role}`] = abandon;
    corps[`temps_${role}`] = abandon ? null : valeur;
  }
  // Pseudos en texte (joueurX.pseudo est du HTML).
  const texte = html => { const el = document.createElement("span"); el.innerHTML = html; return el.textContent; };
  if (!confirm(`Valider ${texte(joueur1.pseudo)} : ${corps.abandon_j1 ? "abandon" : corps.temps_j1} et ${texte(joueur2.pseudo)} : ${corps.abandon_j2 ? "abandon" : corps.temps_j2} ?`)) return;
  envoyerAction(`/api/rooms/${roomId}/temps_arbitre`, corps)
    .then(data => definirDraft(data.draft))
    .catch(err => alert(err.message));
}

// Fin d'une manche de tournoi : score (bo3), manche suivante (arbitre),
// retour au tournoi.
function rendreFinMancheTournoi() {
  document.getElementById("btn-rejouer").classList.add("cache");
  document.getElementById("etat-rejouer").classList.add("cache");
  const t = draft.tournoi;
  const zone = document.getElementById("fin-manche-tournoi");
  zone.classList.remove("cache");
  const score = t.score && t.manches_a_gagner > 1
    ? `Manches : ${pseudoColore(draft.discord_j1 === t.a ? "j1" : "j2")} ${t.score[t.a] ?? 0} – ${t.score[t.b] ?? 0} ${pseudoColore(draft.discord_j1 === t.a ? "j2" : "j1")}. `
    : "";
  const suite = t.termine ? "Match terminé." : t.egalite ? "Égalité : manche à rejouer." : "Le match continue.";
  zone.innerHTML = `<p>${score}${suite}</p>
    <div class="boutons-fin-tournoi">
      ${estArbitreTournoi() && !t.termine ? `<button type="button" id="btn-manche-tournoi" class="btn-valider-temps">Manche suivante</button>` : ""}
      <a class="btn-valider-temps" href="/tournoi?id=${encodeURIComponent(t.id)}">Retour au tournoi</a>
    </div>`;
  document.getElementById("btn-manche-tournoi")?.addEventListener("click", () => {
    envoyerAction(`/api/rooms/${roomId}/tournoi_manche`, {})
      .then(data => definirDraft(data.draft))
      .catch(err => alert(err.message));
  });
}

// Légende locale "une fois par jour" tuée (temps saisi) : plus tirée avant
// le reset de 4 h (cf. api/_lib/legendes.js). "" sinon.
function messageLegendeTuee() {
  const boss = bossData.find(b => b.id === draft.boss_id);
  if (boss?.type !== "legende_locale_jour") return "";
  if (draft.entrainement) return `${boss.nom} est tuée pour aujourd'hui : elle ne sera plus tirée pour toi avant le prochain reset (4 h).`;
  return `${boss.nom} est tuée pour aujourd'hui par ceux qui ont saisi un temps : elle ne sera plus tirée pour eux avant le prochain reset (4 h).`;
}

// ---- Classé ----

// Trophées en jeu (cf. api/_lib/trophees.js) : un demi par seconde d'écart,
// arrondi au supérieur (défi : un par ennemi d'écart), 30 au plus ;
// égalité : 0.
function calculerTrophees() {
  if (draft.vainqueur !== "j1" && draft.vainqueur !== "j2") return 0;
  // Abandon : écart "infini", trophées au maximum.
  if (draft.temps_j1.abandon || draft.temps_j2.abandon) return 30;
  const ecart = Math.abs(draft.temps_j1.secondes - draft.temps_j2.secondes);
  return Math.min(30, defiEnCours() ? ecart : Math.ceil(ecart / 2));
}

function definirTypeRoom(type) {
  if (!type || type === typeRoom) return;
  typeRoom = type;
  document.querySelector(".titre-page").innerHTML =
    typeRoom === "classe" ? `Match classé ${ICONE_TROPHEE}` : typeRoom === "entrainement" ? `Entraînement ${ICONE_ENTRAINEMENT}` : typeRoom === "tournoi" ? `Match de tournoi ${ICONE_TROPHEE}` : "Match";
}

// Revanche (fin de match ou litige).
function rendreRejouer() {
  if (draft.tournoi) {
    rendreFinMancheTournoi();
    return;
  }
  // Spectateur : pas de revanche à demander.
  if (!monRole) {
    document.getElementById("btn-rejouer").classList.add("cache");
    const etat = document.getElementById("etat-rejouer");
    const demandes = ["j1", "j2"].filter(role => draft[`rejouer_${role}`]).length;
    etat.textContent = demandes ? `Revanche demandée (${demandes}/2)…` : "";
    etat.classList.toggle("cache", !demandes);
    return;
  }

  // Un des joueurs a démarré un autre match : plus de revanche possible.
  if (draft.quitte_par) {
    const quitte = draft.quitte_par === "j1" ? joueur1 : joueur2;
    document.getElementById("btn-rejouer").classList.add("cache");
    const etat = document.getElementById("etat-rejouer");
    etat.innerHTML = draft.quitte_par === monRole
      ? "Tu as démarré un autre match : revanche impossible."
      : `${pseudoColore(draft.quitte_par)} a démarré un autre match : revanche impossible.`;
    etat.classList.remove("cache");
    return;
  }

  // Classé : l'un des deux a déjà 2 victoires aujourd'hui contre l'autre.
  if (typeRoom === "classe" && draft.serie_classe?.terminee) {
    document.getElementById("btn-rejouer").classList.add("cache");
    const etat = document.getElementById("etat-rejouer");
    etat.textContent = "Série du jour terminée (2 victoires) : plus de match classé entre vous avant 4 h.";
    etat.classList.remove("cache");
    return;
  }

  // Revanche : ready-check des 2 joueurs, puis retour direct à l'analyse
  // avec les mêmes box et bans d'équilibrage, j1/j2 échangés côté serveur.
  const dejaOk = draft[`rejouer_${monRole}`];
  const autreRole = getAutreRole(monRole);
  const autreOk = draft[`rejouer_${autreRole}`];
  const nomAutre = pseudoColore(autreRole); // couleur de son rôle (bulles du bas)

  const btn = document.getElementById("btn-rejouer");
  btn.textContent = dejaOk ? "Annuler la demande de revanche"
    : draft.entrainement ? "Relancer l'entraînement (mêmes box, rôles inversés)" : "Rejouer (mêmes box, rôles inversés)";
  btn.classList.toggle("active", dejaOk);
  btn.onclick = () => postRejouer(!dejaOk).catch(err => alert(err.message));

  const etat = document.getElementById("etat-rejouer");
  if (dejaOk && !autreOk) {
    etat.innerHTML = `En attente que ${nomAutre} accepte la revanche…`;
    etat.classList.remove("cache");
  } else if (!dejaOk && autreOk) {
    etat.innerHTML = `${nomAutre} veut rejouer. Clique sur "Rejouer" pour confirmer.`;
    etat.classList.remove("cache");
  } else {
    etat.classList.add("cache");
  }
}

// Match annulé : un des joueurs a démarré un autre match (un seul match à la
// fois, cf. annulerAutresMatchs dans api/_lib/room.js).
// Classé (abandon_classe) : compté comme un abandon de celui qui est parti,
// trophées perdus par lui et gagnés par l'adversaire.
function rendreAnnule() {
  const parti = draft.annule_par === "j1" ? joueur1 : draft.annule_par === "j2" ? joueur2 : null;
  const titre = document.querySelector("#phase-annule .litige");
  const texte = document.getElementById("texte-annule");

  if (draft.abandon_classe) {
    titre.textContent = "Abandon";
    const autre = draft.annule_par === "j1" ? "j2" : "j1";
    const resultat = draft.resultat_trophees;
    const signe = n => n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0";
    const trophees = role => resultat ? ` (${signe(resultat[role])} ${ICONE_TROPHEE})` : "";
    texte.innerHTML = draft.annule_par === monRole
      ? `Tu as quitté ce match classé : défaite par abandon${trophees(monRole)}.`
      : monRole
        ? `${parti?.pseudo || "Ton adversaire"} a quitté le match classé : victoire par abandon${trophees(monRole)}.`
        : `${parti?.pseudo || "Un joueur"} a quitté le match classé : défaite par abandon${trophees(draft.annule_par)}, victoire de l'adversaire${trophees(autre)}.`;
    return;
  }

  titre.textContent = "Match annulé";
  if (draft.annule_raison === "equilibrage") {
    texte.innerHTML = "Aucune combinaison de vos box ne s'équilibre : le match est annulé et ne compte pas. Les administrateurs en sont prévenus pour vérifier ce cas.";
    return;
  }
  if (draft.annule_raison === "equilibrage_refuse") {
    texte.innerHTML = draft.annule_par === monRole
      ? "Tu as annulé le match : les box choisies ne s'équilibraient pas. Il ne compte pas."
      : `${parti?.pseudo || "Ton adversaire"} a annulé le match : les box choisies ne s'équilibraient pas. Il ne compte pas.`;
    return;
  }
  if (draft.annule_raison === "crash") {
    texte.innerHTML = draft.annule_par === monRole
      ? "Tu n'es pas revenu dans les 10 minutes après ton crash : la draft est annulée et ne compte pas."
      : `${parti?.pseudo || "Ton adversaire"} n'est pas revenu dans les 10 minutes après son crash : la draft est annulée et ne compte pas.`;
    return;
  }
  texte.innerHTML = draft.annule_par === monRole
    ? "Tu as démarré un autre match : celui-ci est annulé et ne compte pas."
    : parti
      ? `${parti.pseudo} a démarré un autre match : celui-ci est annulé et ne compte pas.`
      : "Ce match a été annulé et ne compte pas.";
}

// ---- Box non équilibrables (cf. traiterNonEquilibrable,
// api/rooms/[room_id]/[action].js) ----
// D'autres combinaisons de box s'équilibrent : chacun vote pour y revenir
// (les 2 doivent accepter) ou annule le match.
function libelleBox(role, box) {
  if (boxCachee(role) && estBoxOpti(box)) return LIBELLE_OPTI_CACHEE;
  const noms = boxCachee(role) ? {} : getJoueurDataParRole(role)?.nomsBoxes || {};
  return typeof noms[box] === "string" && noms[box] ? noms[box] : BOX_LABELS[box] || box;
}

function rendreNonEquilibrable() {
  const combinaisons = draft.combinaisons_equilibrables || [];
  const nom = role => pseudoColore(role);
  const e = draft.ecart_prevu || {};
  document.getElementById("texte-non-equilibrable").innerHTML =
    `Les box choisies ne s'équilibrent pas (écart d'équipe prévu ${e.avant ?? "?"} pts, encore ${e.apres ?? "?"} après tous les bans possibles). ` +
    (combinaisons.length === 1
      ? "Une seule combinaison de vos box s'équilibre : en revenant au choix des box, elle vous est imposée."
      : `${combinaisons.length} combinaisons de vos box s'équilibrent : en revenant au choix des box, vous choisissez parmi elles.`);
  document.getElementById("combinaisons-equilibrables").innerHTML = combinaisons
    .map(c => `<li>${nom("j1")} : ${echapperHtml(libelleBox("j1", c.j1))} — ${nom("j2")} : ${echapperHtml(libelleBox("j2", c.j2))}</li>`)
    .join("");

  const votes = draft.votes_equilibrage || {};
  const autre = monRole ? getAutreRole(monRole) : null;
  const revenir = document.getElementById("btn-revenir-box");
  const annuler = document.getElementById("btn-annuler-match");
  [revenir, annuler].forEach(b => b.classList.toggle("cache", !monRole));
  revenir.disabled = votes[monRole] === "revenir";
  revenir.textContent = votes[monRole] === "revenir" ? "En attente de ton adversaire…" : "Revenir au choix des box";
  revenir.onclick = () => postEquilibrageVote("revenir").catch(err => alert(err.message));
  annuler.onclick = () => {
    if (confirm("Annuler le match ? Il ne comptera pas.")) postEquilibrageVote("annuler").catch(err => alert(err.message));
  };
  document.getElementById("etat-non-equilibrable").innerHTML = autre && votes[autre] === "revenir"
    ? `${nom(autre)} veut revenir au choix des box.`
    : "";
}

// Entraînement dont les box ne s'équilibrent pas : en classé, le match
// aurait été annulé ; le lanceur continue ou change de box (une fois par
// room et par onglet).
// Continuer quand même : mode spécial (serveur, cf. handleModeSpecial),
// la box la plus faible fait ses bans d'équilibrage avec des bans joker
// illimités.
function afficherAlerteEquilibrage() {
  if (moiDiscordId !== draft.entrainement?.lanceur) return;
  const message = document.getElementById("message-choix-box");
  message.innerHTML = `⚠ Ces box ne s'équilibrent pas : en match normal ou classé, ce match aurait été annulé. ` +
    `<button type="button" class="btn-alerte-equilibrage" id="btn-continuer-equilibrage">Continuer quand même (mode spécial)</button> ` +
    `<a class="btn-alerte-equilibrage" href="/match#entrainement">Changer de box</a>` +
    `<br><small>Mode spécial : la box la plus faible reçoit autant de bans joker que nécessaire pour équilibrer, même sous les seuils.</small>`;
  document.getElementById("btn-continuer-equilibrage").onclick = () => {
    envoyerAction(`/api/rooms/${roomId}/mode_special`, {})
      .then(data => definirDraft(data.draft))
      .catch(err => alert(err.message));
  };
}

// ---- Chronos de la draft classée (cf. api/_lib/chronos.js) ----
// Analyse 2 min, bans d'équilibrage 15 s par ban (entre 1 min et 5 min par
// phase), picks /
// bans 30 s par action du joueur (sardine : 3 min 30 ; baleine : 5 min) en
// pendule. C'est la page du joueur dont c'est le tour qui
// déclare le temps écoulé, à 0 sur SON chrono : bouton grisé, notification,
// choix aléatoire fait par le serveur. La page de l'adversaire ne le fait
// que 5 s plus tard (joueur parti), pour ne jamais passer avant lui.
const DELAI_ADVERSAIRE_MS = 5000;
const PAUSE_MAX_MS = 10 * 60 * 1000;
const PHASES_PAUSABLES = ["choix_box", "analyse", "bans_bonus", "draft"];
const expirationsEnvoyees = new Set();

function formaterChrono(ms) {
  const secondes = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}`;
}

// Heure de référence des chronos : figée pendant une pause.
function heureChrono() {
  return draft?.pause ? draft.pause.debut : heureServeur();
}

// Temps restant de chaque chrono en cours -> { phase, acteur, restants }.
function etatChronos() {
  if (!draft?.chronometre) return null;
  const maintenant = heureChrono();
  if (draft.phase === "analyse" && draft.fin_analyse) {
    return { phase: "analyse", acteur: null, reste: draft.fin_analyse - maintenant };
  }
  if (draft.phase === "bans_bonus" && draft.fin_bans_bonus) {
    return { phase: "bans_bonus", acteur: acteurBansBonus(), reste: draft.fin_bans_bonus - maintenant };
  }
  if (draft.phase === "draft" && draft.chrono) {
    const acteur = getProchaineActionLocale()?.joueur || null;
    // Avant tour_debut (annonce du début de draft) : chrono à l'arrêt.
    const restant = role => draft.chrono[role] - (role === acteur ? Math.max(0, maintenant - draft.chrono.tour_debut) : 0);
    return { phase: "draft", acteur, reste: acteur ? restant(acteur) : 0, restants: { j1: restant("j1"), j2: restant("j2") } };
  }
  return null;
}

// Mon temps est écoulé (bans d'équilibrage ou draft) : bouton Confirmer
// grisé, jusqu'à la fin de la draft si mon chrono de draft est à 0.
function monTempsEcoule() {
  if (!monRole || !draft?.chronometre) return false;
  if (draft.chrono?.[`epuise_${monRole}`]) return true;
  const etat = etatChronos();
  return !!etat && etat.acteur === monRole && etat.reste <= 0;
}

function envoyerExpiration(cle) {
  if (expirationsEnvoyees.has(cle)) return;
  expirationsEnvoyees.add(cle);
  envoyerAction(`/api/rooms/${roomId}/expirer`, {})
    .then(data => definirDraft(data.draft))
    // Trop tôt côté serveur (décalage d'horloge) : nouvel essai 1 s plus tard.
    .catch(() => setTimeout(() => expirationsEnvoyees.delete(cle), 1000));
}

function afficherNotification(texte) {
  const notif = document.getElementById("notif-match");
  notif.innerHTML = texte;
  notif.classList.remove("cache");
  clearTimeout(afficherNotification.minuteur);
  afficherNotification.minuteur = setTimeout(() => notif.classList.add("cache"), 5000);
}

// Nouvelles actions jouées au hasard : notification (la carte est aussi
// entourée de doré dans les tableaux).
function annoncerChoixAleatoires(nouvelles) {
  const aleatoires = nouvelles.filter(a => a.aleatoire);
  if (!aleatoires.length) return;
  const noms = aleatoires.map(a => getPersonnageParId(a.perso_id)?.nom || a.perso_id).join(", ");
  const quoi = aleatoires.every(a => a.type === "ban") ? "ban" : aleatoires.every(a => a.type === "pick") ? "pick" : "choix";
  const joueur = aleatoires[0].joueur;
  afficherNotification(joueur === monRole
    ? `⏱ Temps écoulé : ${quoi} aléatoire pour toi (${echapperHtml(noms)}).`
    : `⏱ Temps écoulé pour ${(joueur === "j1" ? joueur1 : joueur2)?.pseudo || "ton adversaire"} : ${quoi} aléatoire (${echapperHtml(noms)}).`);
}

// Chronos sortis de l'écran (défilement) : copie figée en bas, en haut de
// la pile des bulles (pas en haut de l'écran, où sont figés les filtres).
let chronosHorsEcran = false;
function observerChronos() {
  if (!("IntersectionObserver" in window)) return;
  new IntersectionObserver(([entree]) => {
    chronosHorsEcran = !entree.isIntersecting;
    majChronosFlottant();
  }).observe(document.getElementById("chronos"));
}

function majChronosFlottant() {
  const zone = document.getElementById("chronos");
  const flottant = document.getElementById("chronos-flottant");
  const visible = chronosHorsEcran && !zone.classList.contains("cache");
  flottant.classList.toggle("cache", !visible);
  if (visible && flottant.dataset.html !== zone.dataset.html) {
    flottant.dataset.html = zone.dataset.html;
    flottant.innerHTML = zone.dataset.html;
  }
}

// Chrono qui tourne avec 10 s ou moins : rouge.
const CHRONO_URGENT_MS = 10 * 1000;
const classeUrgent = reste => reste > 0 && reste <= CHRONO_URGENT_MS ? " urgent" : "";

function majChronos() {
  const zone = document.getElementById("chronos");
  const etat = etatChronos();
  majPause();
  zone.classList.toggle("cache", !etat);
  if (!etat) {
    majChronosFlottant();
    return;
  }

  const nom = role => (role === "j1" ? joueur1 : joueur2)?.pseudo || role.toUpperCase();
  let html;
  if (etat.phase === "analyse") {
    html = `<span class="chrono actif${classeUrgent(etat.reste)}">⏱ Analyse des box : ${formaterChrono(etat.reste)}</span>`;
  } else if (etat.phase === "bans_bonus") {
    html = `<span class="chrono actif${classeUrgent(etat.reste)}">⏱ Bans d'équilibrage de ${nom(etat.acteur)} : ${formaterChrono(etat.reste)}</span>`;
  } else {
    html = ["j1", "j2"].map(role => {
      const epuise = draft.chrono[`epuise_${role}`];
      const classes = ["chrono", `chrono-${role}`, role === etat.acteur ? `actif${classeUrgent(etat.restants[role])}` : "", epuise || etat.restants[role] <= 0 ? "epuise" : ""].join(" ");
      return `<span class="${classes}">${nom(role)} ${formaterChrono(etat.restants[role])}${epuise ? " · aléatoire" : ""}</span>`;
    }).join("");
  }
  if (zone.dataset.html !== html) {
    zone.dataset.html = html;
    zone.innerHTML = html;
  }
  majChronosFlottant();

  if (!monRole || draft.pause) return;
  const cleTour = `${draft.phase}:${draft.sequence_index}:${draft.chrono?.tour_debut || draft.fin_analyse || draft.fin_bans_bonus}`;
  if (etat.phase === "analyse") {
    if (etat.reste <= 0) envoyerExpiration(cleTour);
    return;
  }
  if (etat.acteur === monRole && etat.reste <= 0 && !draft.chrono?.[`epuise_${monRole}`]) {
    // Trop tard de MON point de vue : bouton grisé, notification, choix
    // aléatoire demandé au serveur.
    if (!expirationsEnvoyees.has(cleTour)) {
      afficherNotification("⏱ Temps écoulé : un choix aléatoire est fait pour toi.");
      document.querySelectorAll("#btn-confirmer-action, #btn-confirmer-bonus").forEach(b => { b.disabled = true; });
    }
    envoyerExpiration(cleTour);
  } else if (etat.acteur && etat.acteur !== monRole && etat.reste <= -DELAI_ADVERSAIRE_MS) {
    // Adversaire parti ou planté : relance après le délai.
    envoyerExpiration(cleTour);
  }
}

// ---- Pause "Mon adversaire a crash" (draft classée) ----
// Bouton visible seulement si l'adversaire n'est plus en ligne (pastille
// grise : sa page ne relit plus la draft depuis 15 s, cf. noterPresence).
function majPause() {
  const adversaireHorsLigne = !!monRole && !!presences && presences[getAutreRole(monRole)] === false;
  const visibleBouton = !!(monRole && draft?.chronometre && PHASES_PAUSABLES.includes(draft.phase) && !draft.pause && adversaireHorsLigne);
  document.getElementById("zone-crash").classList.toggle("cache", !visibleBouton);

  const bandeau = document.getElementById("bandeau-pause");
  bandeau.classList.toggle("cache", !draft?.pause);
  if (!draft?.pause) return;
  const absent = draft.pause.absent === "j1" ? joueur1 : joueur2;
  const reste = PAUSE_MAX_MS - (heureServeur() - draft.pause.debut);
  const html = `⏸ Draft en pause : ${absent?.pseudo || "un joueur"} a crash. Elle reprend dès son retour ` +
    `(annulée dans ${formaterChrono(reste)} s'il ne revient pas).`;
  if (bandeau.dataset.html !== html) {
    bandeau.dataset.html = html;
    bandeau.innerHTML = html;
  }
}

function initialiserCrash() {
  document.getElementById("btn-crash").addEventListener("click", () => {
    if (!confirm("Ton adversaire a crash ? La draft est mise en pause jusqu'à son retour (annulée après 10 minutes sans retour).")) return;
    envoyerAction(`/api/rooms/${roomId}/crash`, {})
      .then(data => definirDraft(data.draft))
      .catch(err => alert(err.message));
  });
}

// ---- Dispatch de phase ----

// Bulles figées en bas de l'écran (#bulles-bas) -> phases où elles s'affichent.
const BULLES_PAR_PHASE = {
  "btn-pret-j1": ["choix_box", "analyse"],
  "btn-pret-j2": ["choix_box", "analyse"],
  "message-choix-box": ["choix_box", "analyse"],
  "btn-confirmer-bonus": ["bans_bonus"],
  "message-equilibrage": ["bans_bonus"],
  "btn-confirmer-action": ["draft"],
  "btn-annuler-coup": ["draft"],
  "tour-actuel": ["draft"],
  "etat-temps": ["temps", "verification"],
  "saisie-arbitre": ["temps", "verification"],
  "fin-manche-tournoi": ["termine", "litige"],
  "choix-boss": ["boss"],
  "message-boss": ["boss"],
  "etat-rejouer": ["termine", "litige"]
};

// ---- Fond d'écran de la room ----
// Fond par défaut, puis, une fois le boss tiré (et son animation finie), une
// des images de DB/images/bg_web/boss_hebdo/ nommées "<boss>_<n>" (id du
// boss sans "_boss"), ou celle de DB/images/bg_web/legendes_locales/
// nommée "<id de la légende>", ou celle de DB/images/bg_web/carnage_chtonien/
// nommée "<id du boss de carnage>" (boss_1 à boss_3), plus ses
// fonds_supplementaires (DB/boss.json,
// ex. "totem_interieur" pour les légendes des défis de totem). Le choix
// dépend de la room et du boss : les deux joueurs voient la même image. Boss
// sans fond : fond par défaut.

const FOND_ROOM_DEFAUT = "/DB/images/bg_web/autres/default_bg.webp";
let fondsBoss = null;
let fondRoomApplique = null;

// cosmetiques.json : fonds des boss + bannières des personnages.
async function chargerFondsBoss() {
  try {
    const reponse = await fetch("/DB/images/cosmetiques.json");
    const cosmetiques = await reponse.json();
    fondsBoss = cosmetiques.fonds.filter(fond => ["boss_hebdo", "legendes_locales", "carnage_chtonien"].includes(fond.categorie));
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
    // "apep_2.webp" -> "apep" ; "churldric_ll.webp" -> "churldric_ll".
    const nomFond = fond => fond.image.split("/").pop().replace(/\.webp$/, "");
    const supplementaires = bossData.find(b => b.id === draft.boss_id)?.fonds_supplementaires || [];
    const images = fondsBoss.filter(fond => nomFond(fond) === prefixe || nomFond(fond).replace(/_\d+$/, "") === prefixe ||
      supplementaires.includes(nomFond(fond)));
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
  afficherModeTheatre();

  const phasePrecedente = dernierePhaseVue;
  dernierePhaseVue = draft.phase;

  rendreEntetesJoueurs();

  document.querySelectorAll(".phase").forEach(el => el.classList.add("cache"));

  const idsParPhase = {
    choix_box: "phase-choix-box",
    analyse: "phase-choix-box",
    bans_bonus: "phase-bans-bonus",
    draft: "phase-draft",
    temps: "phase-draft",
    verification: "phase-draft",
    termine: "phase-draft",
    litige: "phase-draft",
    annule: "phase-annule",
    non_equilibrable: "phase-non-equilibrable",
    boss: "phase-boss"
  };

  const idAffiche = idsParPhase[draft.phase];
  if (!idAffiche) return;

  document.getElementById(idAffiche).classList.remove("cache");

  // Boss tiré (draft, temps) : entêtes réduites à 1/3 de leur largeur, le
  // boss occupe le centre libéré (et déborde vers le bas pendant la draft).
  // Temps / résultat : le boss est au centre du récap, plus d'entêtes.
  // Choix du boss (hors classé) : boss au centre, joueurs toujours visibles.
  const avecBoss = draft.phase === "draft" || draft.phase === "boss";
  const enRecap = PHASES_RECAP.includes(draft.phase);
  const entetes = document.querySelector(".entetes-joueurs");
  entetes.classList.toggle("cache", enRecap || draft.phase === "annule");
  entetes.classList.toggle("compact", avecBoss);
  entetes.classList.toggle("boss-deborde", draft.phase === "draft");
  // Boss tiré : plus de rectangles joueurs (namecard, photo et pseudo sont
  // en haut des tableaux).
  entetes.classList.toggle("sans-joueurs", draft.phase === "draft");
  // Draft sur ordi : tableaux à gauche / droite (figés), boss, filtres et
  // grille au centre (cf. CSS #zone-match.mode-draft).
  // Fin de match : mêmes colonnes que la draft, résultat et boss au centre.
  const zoneMatch = document.getElementById("zone-match");
  zoneMatch.classList.toggle("mode-draft", draft.phase === "draft" || enRecap);
  zoneMatch.classList.toggle("mode-recap", enRecap);
  // Choix et analyse des box, bans d'équilibrage : barre des filtres et
  // tris figée en haut au défilement, comme pendant la draft.
  zoneMatch.classList.toggle("outils-figes", ["choix_box", "analyse", "bans_bonus"].includes(draft.phase));
  document.getElementById("grille-pool-draft").classList.toggle("cache", enRecap);
  document.getElementById("recap-centre").classList.toggle("cache", !enRecap);
  document.getElementById("entete-centre").classList.toggle("cache", !avecBoss);

  // Bulles du bas : seules celles de la phase en cours sont visibles.
  Object.entries(BULLES_PAR_PHASE).forEach(([id, phases]) => {
    document.getElementById(id).classList.toggle("hors-phase", !phases.includes(draft.phase));
  });
  document.getElementById("etat-spectateur").classList.toggle("cache", !!monRole || !draft.discord_j2);

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
  else if (draft.phase === "verification") rendreVerification();
  else if (draft.phase === "termine") rendreTermine();
  else if (draft.phase === "litige") rendreLitige();
  else if (draft.phase === "annule") rendreAnnule();
  else if (draft.phase === "non_equilibrable") rendreNonEquilibrable();
  else if (draft.phase === "boss") rendreChoixBoss();
  // Mode Équilibrage de l'entraînement (cf. matchmaking/equilibrage.js).
  window.DetailEquilibrage?.verifier();
}

// ---- Polling ----

async function rafraichirEtatRoomEtJoueurs() {
  const room = await rejoindreOuConsulterRoom(roomId);

  // Room d'un mode en équipe : sa propre page.
  if (room.type === "equipe") {
    window.location.replace(`/equipe?room=${encodeURIComponent(roomId)}`);
    return;
  }

  if (room.player1_discord_id && room.player2_discord_id) {
    arreterMatchmaking();
    document.getElementById("etat-attente").classList.add("cache");
    document.getElementById("zone-match").classList.remove("cache");

    const donnees = await chargerDraft();
    definirTypeRoom(donnees.type);
    afficherSpectateurs(donnees.nb_spectateurs);
    await definirDraft(donnees.draft);
    afficherPresences(donnees.presences);
  } else {
    definirTypeRoom(room.type);
    afficherAttente(room);
    rendreEntetesJoueurs();
  }
}

// Relectures en chaîne : la suivante est programmée après la fin de la
// précédente, au délai de la phase affichée (cf. delaiPolling).
function programmerPolling() {
  clearTimeout(intervalPolling);
  intervalPolling = null;
  if (!pollingActif) return;
  intervalPolling = setTimeout(async () => {
    await tick();
    programmerPolling();
  }, delaiPolling());
}

function demarrerPolling() {
  pollingActif = true;
  programmerPolling();
}

function arreterPolling() {
  pollingActif = false;
  clearTimeout(intervalPolling);
  intervalPolling = null;
}

async function tick() {
  try {
    if (!(joueur1 && joueur2)) {
      await rafraichirEtatRoomEtJoueurs();
    } else {
      const donnees = await chargerDraft();
      definirTypeRoom(donnees.type);
      afficherSpectateurs(donnees.nb_spectateurs);
      await definirDraft(donnees.draft);
      afficherPresences(donnees.presences);
    }
  } catch (error) {
    console.error(error);
  }
}

// ---- Nombre de spectateurs (joueurs seulement, cf. handleDraftGet) ----

function afficherSpectateurs(nombre) {
  const indicateur = document.getElementById("indicateur-spectateurs");
  const visible = Number.isInteger(nombre) && nombre > 0;
  indicateur.classList.toggle("cache", !visible);
  if (visible) {
    indicateur.textContent = `👁 ${nombre}`;
    indicateur.title = `${nombre} spectateur${nombre > 1 ? "s" : ""}`;
  }
}

// ---- Attente de l'adversaire ----
// Match privé : lien à partager. Matchmaking : recherche relancée toutes
// les MATCHMAKING_INTERVALLE_MS (api/_lib/matchmaking.js, via api/rooms) ; si un autre joueur
// attendait déjà, on rejoint sa room.

const MATCHMAKING_INTERVALLE_MS = 5000;
let intervalleMatchmaking = null;

function afficherAttente(room) {
  // Matchmaking normal ou classé (file séparée, cf. api/_lib/matchmaking.js).
  const matchmaking = room.type === "matchmaking" || room.type === "classe";
  const createur = room.player1_discord_id === moiDiscordId;
  const adversaire = room.type === "classe" ? "un adversaire classé" : "un adversaire";
  document.getElementById("texte-attente").textContent = matchmaking
    ? (createur ? `Recherche d'${adversaire}…` : `Ce joueur cherche encore ${adversaire}…`)
    : "En attente du second joueur…";
  document.getElementById("btn-partager").classList.toggle("cache", matchmaking);
  document.getElementById("btn-annuler-matchmaking").classList.toggle("cache", !(matchmaking && createur));
  if (matchmaking && createur && !intervalleMatchmaking) {
    intervalleMatchmaking = setInterval(relancerMatchmaking, MATCHMAKING_INTERVALLE_MS);
  }
}

function arreterMatchmaking() {
  clearInterval(intervalleMatchmaking);
  intervalleMatchmaking = null;
  document.getElementById("btn-annuler-matchmaking").classList.add("cache");
}

async function relancerMatchmaking() {
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: typeRoom === "classe" ? "classe" : "matchmaking", room_id: roomId })
    });
    if (!reponse.ok) return;
    const { room_id: nouvelleRoom } = await reponse.json();
    if (nouvelleRoom && nouvelleRoom !== roomId) {
      arreterMatchmaking();
      window.location.replace(`/match?room=${encodeURIComponent(nouvelleRoom)}`);
    }
  } catch (error) {
    console.error(error);
  }
}

function initialiserAnnulationMatchmaking() {
  document.getElementById("btn-annuler-matchmaking").addEventListener("click", async () => {
    arreterMatchmaking();
    try {
      await fetch("/api/rooms", { method: "DELETE", credentials: "include" });
    } catch (error) {
      console.error(error);
    }
    window.location.href = "/match";
  });
}

// ---- Partage du lien de la room (copié dans le presse-papiers) ----

function initialiserPartage() {
  const bouton = document.getElementById("btn-partager");
  const texteInitial = bouton.innerHTML; // icône comprise

  bouton.addEventListener("click", async () => {
    const lien = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(lien);
      bouton.querySelector(".texte-partager").textContent = "Lien copié";
      bouton.classList.add("copie");
    } catch {
      // Presse-papiers indisponible : on affiche le lien à copier à la main.
      window.prompt("Copie ce lien et envoie-le à ton adversaire :", lien);
    }
    setTimeout(() => {
      bouton.innerHTML = texteInitial;
      bouton.classList.remove("copie");
    }, 2000);
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
    initialiserAnnulationMatchmaking();
    initialiserCrash();

    appliquerFondRoom();

    [personnagesBase, bossData, armesData] = await Promise.all([
      chargerPersonnages(),
      chargerBoss(),
      chargerArmes(),
      chargerFondsBoss(),
      chargerChoixFiltresDraft()
    ]);
    personnagesData = regrouperPourDraft(personnagesBase);

    initialiserFiltresTri();
    initialiserGrillesPersos();
    initialiserResBoss();
    initialiserCarteLegende();
    initialiserFenetreLitige();

    await tick();

    demarrerPolling();
    // Chronos de la draft classée : affichage et fin de temps, 4 fois par
    // seconde (sans requête tant que rien n'expire).
    observerChronos();
    setInterval(majChronos, 250);

    // Onglet masqué : plus de requêtes ; au retour, état rafraîchi tout de
    // suite puis polling normal.
    document.addEventListener("visibilitychange", () => {
      arreterPolling();
      if (!document.hidden) {
        tick();
        demarrerPolling();
      }
    });
  } catch (error) {
    console.error(error);
    alert(error.message || "Erreur lors du chargement du match.");
  }
}

demarrer();