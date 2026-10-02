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

const POLL_INTERVAL_MS = 2500;

let roomId = null;
let typeRoom = "prive"; // "prive" | "matchmaking" | "classe" (trophées en fin de match)
let moiDiscordId = null;
let monRole = null; // "j1" | "j2" | null (spectateur)
let personnagesBase = [];   // characters.json (un Voyageur par élément)
let personnagesData = [];   // catalogue de draft (un seul Voyageur), variantes (Voyageur, Manekin) du joueur connecté
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

// ---- Filtres / recherche / tris de la grille de draft ----
// Filtre élément : ordre des clics = ordre des groupes. Tris combinables :
// cf. commun/tri.js.
const filtreElement = new Set();
const filtreEtoile = new Set();
const filtreVoeux = new Set();
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
  // compte pour le renseigner.
  if (reponse.status === 409) {
    const { error } = await reponse.json().catch(() => ({}));
    clearInterval(intervalPolling);
    alert(error || "Impossible de rejoindre cette room.");
    window.location.href = "/my_account/my_account.html";
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

async function chargerCompte(discordId) {
  const reponse = await fetch(`/api/accounts/${discordId}`);
  if (!reponse.ok) throw new Error("Impossible de charger ce compte.");
  return await reponse.json();
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

async function postAbandon() {
  const data = await envoyerAction(`/api/rooms/${roomId}/temps`, { abandon: true });
  await definirDraft(data.draft);
}

// Abandon à la place d'un temps, après confirmation.
function declarerAbandon() {
  if (!confirm("Déclarer un abandon ? Si ton adversaire a un temps, il gagne ; s'il abandonne aussi, c'est une égalité.")) return;
  postAbandon().catch(err => alert(err.message));
}

async function postConfirmerTemps() {
  const data = await envoyerAction(`/api/rooms/${roomId}/confirmer_temps`, {});
  await definirDraft(data.draft);
}

async function postLitige() {
  const data = await envoyerAction(`/api/rooms/${roomId}/litige`, {});
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

  const nbActionsAvant = draft?.actions?.length ?? null;
  draft = nouveauDraft;
  if (nbActionsAvant !== null) annoncerChoixAleatoires((draft.actions || []).slice(nbActionsAvant));

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
    case "bans_bonus": return draft.bans_bonus_joueur || "j1";
    case "temps": return !draft.temps_j1 ? "j1" : !draft.temps_j2 ? "j2" : "j1";
    case "verification": return !draft.temps_confirme_j1 ? "j1" : !draft.temps_confirme_j2 ? "j2" : "j1";
    default: return "j1";
  }
}

// Box personnalisée : persos cochés ajoutés comme sélection "custom" (même
// règle que donneesBoxRole, api/_lib/boxes.js).
function donneesBox(profilData, source) {
  if (source.box !== "custom") return profilData;
  const characters = profilData?.characters || {};
  return {
    ...profilData,
    characters: { ...characters, selections: { ...(characters.selections || {}), custom: Object.fromEntries((source.persos || []).map(id => [id, true])) } }
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
    const simule = { discordId: draft[`discord_${role}`], nom: box.nom, avatar: box.avatar, pseudo: htmlPseudo(box.nom), data: box.data };
    if (role === "j1") joueur1 = simule;
    else joueur2 = simule;
  });
}

// Pseudo du joueur d'un rôle, dans la couleur de son rôle (bleu J1, rouge
// J2) : consignes de l'entraînement ("À ... de bannir").
function pseudoColore(role) {
  const joueur = role === "j1" ? joueur1 : joueur2;
  return `<span class="nom-${role}">${joueur?.pseudo || role.toUpperCase()}</span>`;
}

function libelleBoxEntrainement(role) {
  const source = draft.entrainement.boxes[coteEntrainement(role)];
  return `${BOX_LABELS[source.box] || source.box} de ${htmlPseudo(source.nom)}`;
}

// Raffinement (0 = R1 ... 4 = R5) de l'arme signature d'un personnage chez
// un joueur donné (meilleure copie), ou null s'il ne la possède pas.
function getRefinementArmeSignature(joueurData, personnageId) {
  const personnage = getPersonnageParId(personnageId);
  const arme = personnage && trouverArmeSignature(armesData, personnage);
  const raffinement = arme ? meilleurRaffinement(joueurData?.weapons?.full, arme.id) : -1;
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
// 100 et du théâtre compris, cf. pointsPersonnage), ou null s'il ne l'a
// pas. Voyageur : un par élément dans les comptes, un seul en draft ; on
// garde l'élément qui vaut le plus de points parmi ceux de sa box (ou
// l'élément donné, une fois pické).
function getPossession(role, persoId, element = null) {
  const pool = getPoolMatch(role);
  if (pool && !pool.has(persoId)) return null;

  const collection = getJoueurDataParRole(role)?.characters;
  const membres = membresGroupe(personnagesBase, persoId);
  // Niveau commun au groupe (Voyageur) : clé = id de la draft.
  const niveau = collection?.niveaux?.[persoId] ?? null;

  if (membres.length === 0) {
    const c = collection?.full?.[persoId];
    if (typeof c !== "number" || c < 0) return null;
    const personnage = getPersonnageParId(persoId);
    return { valeur: c, points: personnage ? pointsPersonnage(personnage, c, niveau) : 0 };
  }

  // Éléments permis : celui pické, sinon ceux de la box du match (calculés
  // par le serveur), sinon ceux de la box choisie (choix de box en cours).
  const box = draft?.[`box_${role}`];
  const permis = element ? [element] : pool ? draft?.[`elements_${role}`]?.[persoId] || [] : null;

  let meilleur = null;
  membres.forEach(membre => {
    const c = collection?.full?.[membre.id];
    if (typeof c !== "number" || c < 0) return;
    if (permis && !permis.includes(membre.element)) return;
    if (!permis && box && box !== "full" && !collection.selections?.[box]?.[membre.id]) return;

    const points = pointsPersonnage(membre, c, niveau);
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
    infos[`refinement${suffixe}`] = getRefinementArmeSignature(data, persoId);
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
      .map(r => getRefinementArmeSignature(getJoueurDataParRole(r), personnage.id) ?? -1)),
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
    rareteParDefaut: filtreEtoile.size > 0 || filtreVoeux.size > 0 || (roles.length > 1 && (!!filtreProprietaire || !!filtrePossession))
  });
}

// Filtres + recherche. ignorerProprietaire : aperçus de box (colonne déjà
// propre à un joueur).
function personnageCorrespondFiltres(personnage, { ignorerProprietaire = false } = {}) {
  if (filtreElement.size > 0 && !filtreElement.has(personnage.element)) return false;
  if (filtreEtoile.size > 0 && !filtreEtoile.has(String(personnage.rarete))) return false;
  if (filtreVoeux.size > 0 && !filtreVoeux.has(getVoeu(personnage))) return false;
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
  selectionnee = false
} = {}) {
  const card = document.createElement("div");
  card.title = personnage.nom;
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
    </div>
  `;

  if (selectionnable && onClick) {
    card.addEventListener("click", onClick);
  }

  return card;
}

// Carte recyclée si rien de ce qu'elle affiche (ni son comportement au clic,
// cf. mode) n'a changé depuis le dernier rendu de la grille.
function obtenirCarteItem(grille, personnage, options = {}, mode = "") {
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
// vœux ne concernent que les personnages.
function armeCorrespondFiltres(arme) {
  if (filtreVoeux.size > 0) return false;
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

// Draft et bans d'équilibrage : armes des box des 2 joueurs (meilleure
// copie de chacun), à la suite des personnages ; filtre J1/J2 respecté.
function groupesArmesDraft() {
  const parId = new Map();
  ["j1", "j2"].forEach(role => {
    if (filtreProprietaire && filtreProprietaire !== role) return;
    getArmesBox(getJoueurDataParRole(role), draft[`box_${role}`] || "full").forEach(arme => {
      const entree = parId.get(arme.id) || { ...arme, instanceId: null, infosArme: {} };
      entree.infosArme[role] = Math.max(entree.infosArme[role] ?? -1, arme.raffinement);
      parId.set(arme.id, entree);
    });
  });

  const raffinements = arme => Object.values(arme.infosArme);
  return trierEtGrouper([...parId.values()].filter(armeCorrespondFiltres), etatTri, {
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
      ${afficherPastille ? `<span class="pastille ${pret ? "pret" : ""}" title="${pret ? "Prêt" : "Pas encore prêt"}"></span>` : ""}
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

function nbPersosBox(role, box) {
  const collection = getJoueurDataParRole(role)?.characters || { full: {}, selections: {} };
  return personnagesData.filter(p => estDansBox(collection, p.id, box)).length;
}

function rendreChoixBox() {
  const enAnalyse = draft.phase === "analyse";

  document.getElementById("message-choix-box").textContent = enAnalyse
    ? (draft.roles_tires
      ? "Revanche : mêmes box et mêmes bans d'équilibrage, rôles J1/J2 inversés. Analyse la box adverse puis clique sur \"Prêt\" pour tirer le boss."
      : "Analyse la box adverse puis clique sur \"Prêt\". Suite : bans d'équilibrage (si écart), puis tirage J1/J2 et du boss.")
    : `Choisis ta box (au moins ${NB_PERSOS_MIN_BOX} personnages) et valide-la. La box adverse sera visible une fois les 2 box validées.`;

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

    // Box optimisées renommées par le joueur dans Mon compte (profil.nomsBoxes).
    const nomsPerso = getJoueurDataParRole(role)?.nomsBoxes || {};
    // Entraînement : seulement la box choisie à la création ; sinon toutes
    // sauf "Personnalisée".
    Object.entries(BOX_LABELS).filter(([valeur]) => draft.entrainement ? draft[`box_${role}`] === valeur : valeur !== "custom").forEach(([valeur, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "box-btn" + (draft[`box_${role}`] === valeur ? " active" : "");
      btn.textContent = typeof nomsPerso[valeur] === "string" && nomsPerso[valeur] ? nomsPerso[valeur] : label;
      // Box trop petite (ex. que des armes) : pas choisissable.
      const nbPersos = peutChoisir ? nbPersosBox(role, valeur) : NB_PERSOS_MIN_BOX;
      const tropPetite = nbPersos < NB_PERSOS_MIN_BOX;
      btn.classList.toggle("trop-petite", tropPetite);
      if (tropPetite) btn.title = `${nbPersos} personnage${nbPersos > 1 ? "s" : ""} : il en faut au moins ${NB_PERSOS_MIN_BOX}`;
      btn.disabled = !peutChoisir || tropPetite;
      if (peutChoisir && !tropPetite) {
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
  if (bouton.parentElement !== bulles) bulles.prepend(bouton);
}

// ---- Phase 2 : bans bonus d'équilibrage ----
// Les bans choisis vont dans des emplacements dédiés, modifiables (on peut
// en retirer un et en reprendre un autre) tant qu'on n'a pas confirmé.

function rendreBansBonus() {
  const choix = draft.bans_bonus_choix || [];
  const restant = draft.bans_bonus_total - choix.length;
  const nomJoueurConcerne = draft.bans_bonus_joueur === "j1" ? joueur1.pseudo : joueur2.pseudo;
  const ecart = Math.abs((draft.points_j1 ?? 0) - (draft.points_j2 ?? 0));
  const cEstMonTour = draft.bans_bonus_joueur === monRole;

  const message = document.getElementById("message-equilibrage");
  if (draft.entrainement && cEstMonTour) {
    message.innerHTML = restant > 0
      ? `Écart de ${ecart} pts entre les 2 box : à ${pseudoColore(draft.bans_bonus_joueur)} de choisir encore ${restant} personnage(s) à bannir, puis confirme.`
      : `Écart de ${ecart} pts entre les 2 box : les ${draft.bans_bonus_total} ban(s) bonus de ${pseudoColore(draft.bans_bonus_joueur)} sont sélectionnés. Clique sur "Confirmer les bans".`;
  } else if (cEstMonTour) {
    message.textContent = restant > 0
      ? `Écart de ${ecart} pts entre les 2 box : choisis encore ${restant} personnage(s) à bannir avant le tirage J1/J2 et du boss (tu peux revenir sur ton choix avant de confirmer).`
      : `Écart de ${ecart} pts entre les 2 box : tes ${draft.bans_bonus_total} ban(s) bonus sont sélectionnés. Clique sur "Confirmer les bans" pour lancer le tirage J1/J2 et du boss.`;
  } else {
    message.innerHTML = `Écart de ${ecart} pts entre les 2 box : ${nomJoueurConcerne} choisit ${draft.bans_bonus_total} ban(s) bonus. En attente…`;
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

  // Même bouton que "Confirmer" de la draft, en rouge (ban) : grisé pour
  // l'autre joueur ; pour celui qui bannit, contour rouge puis rouge plein
  // une fois tous ses bans choisis. Masqué pour un spectateur.
  const btnConfirmer = document.getElementById("btn-confirmer-bonus");
  const tousChoisis = choix.length === draft.bans_bonus_total;
  btnConfirmer.classList.toggle("cache", !monRole);
  btnConfirmer.classList.toggle("a-mon-tour", cEstMonTour);
  btnConfirmer.classList.toggle("pret", cEstMonTour && tousChoisis);
  btnConfirmer.disabled = !cEstMonTour || !tousChoisis || monTempsEcoule();
  btnConfirmer.onclick = () => postBonusConfirmer().catch(err => alert(err.message));

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

  remplirGrilleGroupee(grille, groupesDraft(personnages), carteDraftOuArme(grille, personnage => {
    const id = personnage.id;
    const dejaChoisi = choix.includes(id);
    const peutCliquer = cEstMonTour && (dejaChoisi || choix.length < draft.bans_bonus_total);

    return obtenirCarteItem(grille, personnage, {
      selectionnable: peutCliquer,
      indisponible: dejaChoisi,
      onClick: () => postBonusToggle(id).catch(err => alert(err.message)),
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
// draft classique (théâtre 12) avant le tirage.
function getSequence() {
  return Array.isArray(draft?.sequence) ? draft.sequence : SEQUENCE_FIXE;
}

function getProchaineActionLocale() {
  const action = getSequence()[draft.sequence_index];
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
const PHASES_PRESENCE = ["choix_box", "analyse", "bans_bonus", "draft"];

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
        slot.title = `${slot.title || personnage.nom} — bonus de saison (+3 🏆)`;
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
// Bans d'équilibrage : bloc au-dessus du tableau du joueur qui les a faits.
function rendreBansEquilibrage() {
  ["j1", "j2"].forEach(role => {
    const bans = draft.actions.filter(a => a.bonus && a.joueur === role);
    const bloc = document.getElementById(`bans-eq-${role}`);
    bloc.classList.toggle("cache", bans.length === 0);

    const grille = document.getElementById(`bans-eq-grille-${role}`);
    if (!grilleAChange(grille, JSON.stringify(bans.map(a => [a.perso_id, !!a.aleatoire])))) return;
    grille.replaceChildren(...bans
      .filter(a => getPersonnageParId(a.perso_id))
      .map(a => {
        const carte = creerBanMini(getPersonnageParId(a.perso_id));
        marquerAleatoire(carte, a);
        return carte;
      }));
  });
}

// Boss tiré : image cliquable qui affiche / masque ses résistances
// élémentaires par-dessus (en %, même ordre que boss.res, cf.
// admin_ppc/admin_ajout.js), avec une petite indication sous l'image.
const ELEMENTS_RES_BOSS = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];

function htmlBossTire(boss) {
  if (!boss) return "";
  const res = ELEMENTS_RES_BOSS.map((element, i) => {
    const valeur = Number(boss.res?.[i] ?? 0);
    const nom = element.charAt(0).toUpperCase() + element.slice(1);
    return `<span class="res-boss" title="Résistance ${nom}"><img src="${ICONES_ELEMENTS_TRI[element]}" alt="${nom}">${valeur}%</span>`;
  }).join("");
  return `
    <button type="button" class="image-boss-res" title="Voir les résistances">
      <img src="../DB/${boss.image}" alt="${boss.nom}">
      <span class="resistances-boss">${res}</span>
    </button>
    <span class="indice-res-boss">Voir les Res</span>
    <span class="nom-boss">${boss.nom}</span>`;
}

// Théâtre de la draft : fixé par le serveur au tirage du boss ; avant,
// celui qui sera joué (mode imposé, ou plus petit clear des 2 joueurs en
// mode auto, cf. resoudreTheatre dans api/_lib/draft.js).
function theatreDeLaDraft() {
  if ([6, 8, 10, 12].includes(draft?.theatre)) return draft.theatre;
  if (draft?.mode_theatre === "carnage") return 12;
  const mode = Number(draft?.mode_theatre);
  if ([6, 8, 10, 12].includes(mode)) return mode;
  const paliers = [joueur1, joueur2].map(j => palierTheatreProfil(j?.data));
  return Math.min(...paliers.map(p => p ?? 6));
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
    ? `<span class="info-entrainement">🎯 J1 : ${libelleBoxEntrainement("j1")} · J2 : ${libelleBoxEntrainement("j2")}` +
      `${estEntrainementSolo() ? " · tu joues les 2 rôles (partage le lien pour te faire aider)" : ""}</span>`
    : "");
  if (zone.dataset.html !== html) {
    zone.dataset.html = html;
    zone.innerHTML = html;
  }
}

// Théâtre de la draft (nombre de bans) avec sa médaille.
function htmlModeTheatre(theatre) {
  if (![6, 8, 10, 12].includes(theatre)) return "";
  const nbBans = { 6: 1, 8: 2, 10: 3, 12: 4 }[theatre];
  // "auto" : théâtre du joueur au plus petit clear ; sinon choisi à la
  // création de la room, ou mêlée générale (matchmaking / classé).
  const mode = draft.mode_theatre === "auto" ? "plus petit clear"
    : draft.mode_theatre === "carnage" ? "carnage, sans bans d'équilibrage"
      : typeRoom === "prive" ? "choisi pour la room" : "mêlée générale";
  return `<span class="mode-theatre" title="Draft du théâtre ${theatre} : 4 picks et ${nbBans} ban${nbBans > 1 ? "s" : ""} par joueur (${mode})">` +
    `<img src="/DB/images/others/Imaginarium_Theater_Medal_${theatre}.webp" alt="">Théâtre ${theatre} · ${mode}</span>`;
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
      ? `<img src="../DB/${propose.image}" alt=""><span class="nom-boss">?</span>`
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

  rendreTableaux();

  const prochaine = getProchaineActionLocale();
  const cEstMonTour = !!prochaine && prochaine.joueur === monRole;
  const restrictionPick = cEstMonTour && prochaine.type === "pick";

  // Sélection périmée (action jouée, personnage plus disponible) : oubliée.
  if (selectionDraft && (!cEstMonTour || selectionDraft.index !== draft.sequence_index ||
      !draft.pool_disponible.includes(selectionDraft.persoId))) {
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
      const nomAdversaire = prochaine.joueur === "j1" ? joueur1.pseudo : joueur2.pseudo;
      tourContainer.innerHTML = `En attente : ${nomAdversaire} doit <strong class="verbe-action">${verbe}</strong> un personnage.`;
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

  const grille = document.getElementById("grille-pool-draft");
  const cleGrille = JSON.stringify([
    draft.actions, draft.sequence_index, draft.pool_disponible, draft.pool_j1, draft.pool_j2,
    draft.discord_j1, draft.discord_j2, monRole, selectionDraft,
    ...cleFiltres()
  ]);
  if (!grilleAChange(grille, cleGrille)) return;

  const monPool = monRole === "j1" ? draft.pool_j1 : draft.pool_j2;

  const personnages = draft.pool_disponible
    .map(id => getPersonnageParId(id))
    .filter(p => p && personnageCorrespondFiltres(p));

  remplirGrilleGroupee(grille, groupesDraft(personnages), carteDraftOuArme(grille, personnage => {
    const jePeuxLePicker = !restrictionPick || (monPool && monPool.includes(personnage.id));
    const selectionnable = cEstMonTour && jePeuxLePicker;

    return obtenirCarteItem(grille, personnage, {
      selectionnable,
      indisponible: cEstMonTour && !jePeuxLePicker,
      selectionnee: selectionDraft?.persoId === personnage.id,
      // Clic : sélectionne (ou désélectionne) le personnage ; l'action n'est
      // envoyée qu'avec "Confirmer". Pick du Voyageur / Manekin : élément
      // choisi à la sélection.
      onClick: () => {
        if (selectionDraft?.persoId === personnage.id) {
          selectionDraft = null;
          rendrePhase();
          return;
        }
        const choisir = element => {
          selectionDraft = { persoId: personnage.id, element, index: draft.sequence_index };
          rendrePhase();
        };
        const choix = restrictionPick ? getElementsAuPick(personnage.id) : null;
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
  return [filtreVue, [...filtreElement], [...filtreArme], [...filtreEtoile], [...filtreVoeux], filtreProprietaire, filtrePossession, rechercheTexte, etatTri.tris];
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
  figeables.appendChild(zoneVoeux);

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
  ["points", "constellation", "niveau", "raffinement", "rarete", "element", "favoris", "bonus_saison"].forEach(valeur => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "filtre-etoile-btn tri-btn";
    btn.dataset.tri = valeur;
    majBoutonTri(btn, etatTri);
    btn.addEventListener("click", () => {
      cyclerTri(etatTri, valeur);
      zoneTris.querySelectorAll(".tri-btn").forEach(b => majBoutonTri(b, etatTri));
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
  // Favoris : ceux du joueur connecté, pas de sens pour un spectateur.
  const btnFavoris = document.querySelector('#barre-outils .tri-btn[data-tri="favoris"]');
  if (btnFavoris) btnFavoris.hidden = !monRole;
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
  const saisieIci = role === monRole &&
    ((draft.phase === "temps" && !temps) || (draft.phase === "verification" && !draft[`temps_confirme_${role}`]));

  let texte = "";
  if (draft.phase === "verification") {
    texte = temps ? `Temps : ${temps.affiche}${draft[`temps_confirme_${role}`] ? " · confirmé ✓" : ""}` : "";
  } else if (draft.phase === "termine" || draft.phase === "litige") {
    texte = temps?.affiche ? `Temps : ${temps.affiche}` : "";
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

  rendreLienStream(role, zone);

  if (saisieIci && saisie.parentElement !== zone) zone.appendChild(saisie);
  if (role === monRole) saisie.classList.toggle("cache", !saisieIci);
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

function rendreRecap() {
  assurerBossAffiche();
  rendreTableaux();
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

  const fini = draft.phase === "termine" || draft.phase === "litige";
  document.getElementById("resultat-final").classList.toggle("cache", !fini);
  document.getElementById("btn-rejouer").classList.toggle("cache", !fini);
  document.getElementById("verification-temps").classList.toggle("cache", draft.phase !== "verification");
}

function rendreTemps() {
  rendreRecap();

  if (!monRole) {
    const enAttente = ["j1", "j2"].filter(role => !draft[`temps_${role}`]).length;
    document.getElementById("etat-temps").textContent =
      `En attente ${enAttente === 2 ? "des temps des 2 joueurs" : "du dernier temps"}…`;
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

  if (monTemps && !tempsAdversaire) {
    etat.textContent = "Temps enregistré. En attente du temps de l'adversaire…";
  } else if (!monTemps) {
    etat.textContent = "Entre ton temps en minutes et secondes (ex : 7:32, 7,32 ou 7.32).";
  } else {
    etat.textContent = "";
  }

  btn.onclick = envoyerTempsSaisi;
}

function envoyerTempsSaisi() {
  // "7,32" et "7.32" (clavier numérique du téléphone) valent "7:32".
  const valeur = document.getElementById("input-temps").value.trim().replace(/[.,]/, ":");
  if (!/^[0-9]{1,3}:[0-5][0-9]$/.test(valeur)) {
    alert("Format invalide. Entre les minutes puis les secondes sur 2 chiffres, par exemple 7:32, 7,32 ou 7.32.");
    return;
  }
  postTemps(valeur).catch(err => alert(err.message));
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

  if (!monRole) {
    etat.textContent = `Vérification des temps par les joueurs (${confirmes}/2)…`;
    document.querySelector("#verification-temps .boutons-verification").classList.add("cache");
    return;
  }

  const autreRole = getAutreRole(monRole);
  const nomAutre = autreRole === "j1" ? joueur1.pseudo : joueur2.pseudo;
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
    input.value = monTemps?.abandon ? "" : monTemps?.affiche || "";
  }
  btn.onclick = envoyerTempsSaisi;
  const btnAbandon = document.getElementById("btn-abandon");
  btnAbandon.disabled = !!monTemps?.abandon;
  btnAbandon.textContent = monTemps?.abandon ? "Abandon déclaré" : "Abandonner";
  btnAbandon.onclick = declarerAbandon;

  const btnConfirmer = document.getElementById("btn-confirmer-temps");
  btnConfirmer.disabled = jaiConfirme;
  btnConfirmer.classList.toggle("active", jaiConfirme);
  btnConfirmer.textContent = jaiConfirme ? "Temps confirmés ✓" : "Les temps sont corrects";
  btnConfirmer.onclick = () => postConfirmerTemps().catch(err => alert(err.message));

  document.getElementById("btn-litige").onclick = () => {
    if (!confirm("Signaler un litige sur les temps ? Le match sera invalidé et transmis aux administrateurs.")) return;
    postLitige().catch(err => alert(err.message));
  };

  if (jaiConfirme && !autreAConfirme) {
    etat.innerHTML = `Temps confirmés. En attente de la confirmation de ${nomAutre}…`;
  } else if (!jaiConfirme && autreAConfirme) {
    etat.innerHTML = `${nomAutre} a confirmé les temps. Vérifie-les puis confirme, ou signale un litige.`;
  } else {
    etat.textContent = "Vérifie que les deux temps sont les bons, puis confirme. En cas de désaccord, signale un litige.";
  }
}

// ---- Phase 5 : résultat ----

// Litige : manche invalidée, pas de vainqueur ; revanche possible.
function rendreLitige() {
  rendreRecap();
  const nomLitige = draft.litige_par === "j1" ? joueur1.pseudo : draft.litige_par === "j2" ? joueur2.pseudo : null;
  const parQui = draft.litige_par === monRole ? "par toi" : nomLitige ? `par ${nomLitige}` : "";
  document.getElementById("resultat-final").innerHTML = `
    <p class="ligne-vainqueur"><span class="litige">Match invalidé</span></p>
    <p class="ligne-temps">Litige signalé ${parQui} sur les temps : ce match ne compte pas. Les administrateurs vérifieront les temps et pourront le republier${typeRoom === "classe" ? " (les trophées seront alors attribués)" : ""}.</p>
  `;
  rendreRejouer();
}

function rendreTermine() {
  rendreRecap();
  const container = document.getElementById("resultat-final");

  // Entraînement : pas de temps ni de vainqueur, on peut relancer.
  if (draft.entrainement) {
    container.innerHTML = `
      <p class="ligne-vainqueur"><span class="egalite">Entraînement terminé 🎯</span></p>
      <p class="ligne-temps">Draft de ${pseudoColore("j1")} contre ${pseudoColore("j2")}. Relance pour rejouer avec les mêmes box (rôles inversés).</p>
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
    const bonus = resultat?.bonus ? ` (dont +${resultat.bonus} de série 🔥)` : "";
    // Bonus de saison (persos cochés dans l'admin) : gain augmenté, perte réduite.
    const saison = role => resultat?.saison?.[role]
      ? ` (bonus de saison : ${draft.vainqueur === role ? "+" : "−"}${resultat.saison[role]} ${draft.vainqueur === role ? "" : "de perte "}🌟)`
      : "";
    if (enJeu === 0) {
      ligneTrophees = `<p class="ligne-trophees">🏆 Aucun trophée en jeu</p>`;
    } else if (monRole) {
      const n = delta(monRole);
      const gagne = draft.vainqueur === monRole;
      ligneTrophees = `<p class="ligne-trophees ${gagne ? "gain" : "perte"}">🏆 ${signe(n)} trophée${Math.abs(n) > 1 ? "s" : ""}${gagne ? bonus : ""}${saison(monRole)}</p>`;
    } else {
      ligneTrophees = `<p class="ligne-trophees">🏆 ${joueur1.pseudo} ${signe(delta("j1"))}, ${joueur2.pseudo} ${signe(delta("j2"))}${bonus}</p>`;
    }
  }

  container.innerHTML = `
    <p class="ligne-vainqueur">${ligneVainqueur}</p>
    <p class="ligne-temps">${joueur1.pseudo} : ${draft.temps_j1.affiche} — ${joueur2.pseudo} : ${draft.temps_j2.affiche}</p>
    ${ligneTrophees}
  `;
  rendreRejouer();
}

// ---- Classé ----

// Trophées en jeu (cf. api/_lib/trophees.js) : un demi par seconde d'écart,
// arrondi au supérieur, 30 au plus ; égalité : 0.
function calculerTrophees() {
  if (draft.vainqueur !== "j1" && draft.vainqueur !== "j2") return 0;
  // Abandon : écart "infini", trophées au maximum.
  if (draft.temps_j1.abandon || draft.temps_j2.abandon) return 30;
  return Math.min(30, Math.ceil(Math.abs(draft.temps_j1.secondes - draft.temps_j2.secondes) / 2));
}

function definirTypeRoom(type) {
  if (!type || type === typeRoom) return;
  typeRoom = type;
  document.querySelector(".titre-page").textContent =
    typeRoom === "classe" ? "Match classé 🏆" : typeRoom === "entrainement" ? "Entraînement 🎯" : "Match";
}

// Revanche (fin de match ou litige).
function rendreRejouer() {
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
      : `${quitte.pseudo} a démarré un autre match : revanche impossible.`;
    etat.classList.remove("cache");
    return;
  }

  // Revanche : ready-check des 2 joueurs, puis retour direct à l'analyse
  // avec les mêmes box et bans d'équilibrage, j1/j2 échangés côté serveur.
  const dejaOk = draft[`rejouer_${monRole}`];
  const autreRole = getAutreRole(monRole);
  const autreOk = draft[`rejouer_${autreRole}`];
  const nomAutre = autreRole === "j1" ? joueur1.pseudo : joueur2.pseudo;

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
    const trophees = role => resultat ? ` (${signe(resultat[role])} 🏆)` : "";
    texte.innerHTML = draft.annule_par === monRole
      ? `Tu as quitté ce match classé : défaite par abandon${trophees(monRole)}.`
      : monRole
        ? `${parti?.pseudo || "Ton adversaire"} a quitté le match classé : victoire par abandon${trophees(monRole)}.`
        : `${parti?.pseudo || "Un joueur"} a quitté le match classé : défaite par abandon${trophees(draft.annule_par)}, victoire de l'adversaire${trophees(autre)}.`;
    return;
  }

  titre.textContent = "Match annulé";
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

// ---- Chronos de la draft classée (cf. api/_lib/chronos.js) ----
// Analyse 2 min, bans d'équilibrage 1 min 30, picks / bans 5 min par
// joueur en pendule. C'est la page du joueur dont c'est le tour qui
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
    return { phase: "bans_bonus", acteur: draft.bans_bonus_joueur, reste: draft.fin_bans_bonus - maintenant };
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

function majChronos() {
  const zone = document.getElementById("chronos");
  const etat = etatChronos();
  majPause();
  zone.classList.toggle("cache", !etat);
  if (!etat) return;

  const nom = role => (role === "j1" ? joueur1 : joueur2)?.pseudo || role.toUpperCase();
  let html;
  if (etat.phase === "analyse") {
    html = `<span class="chrono actif">⏱ Analyse des box : ${formaterChrono(etat.reste)}</span>`;
  } else if (etat.phase === "bans_bonus") {
    html = `<span class="chrono actif">⏱ Bans d'équilibrage de ${nom(etat.acteur)} : ${formaterChrono(etat.reste)}</span>`;
  } else {
    html = ["j1", "j2"].map(role => {
      const epuise = draft.chrono[`epuise_${role}`];
      const classes = ["chrono", `chrono-${role}`, role === etat.acteur ? "actif" : "", epuise || etat.restants[role] <= 0 ? "epuise" : ""].join(" ");
      return `<span class="${classes}">${nom(role)} ${formaterChrono(etat.restants[role])}${epuise ? " · aléatoire" : ""}</span>`;
    }).join("");
  }
  if (zone.dataset.html !== html) {
    zone.dataset.html = html;
    zone.innerHTML = html;
  }

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
  "tour-actuel": ["draft"],
  "etat-temps": ["temps", "verification"],
  "etat-rejouer": ["termine", "litige"]
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
    annule: "phase-annule"
  };

  const idAffiche = idsParPhase[draft.phase];
  if (!idAffiche) return;

  document.getElementById(idAffiche).classList.remove("cache");

  // Boss tiré (draft, temps) : entêtes réduites à 1/3 de leur largeur, le
  // boss occupe le centre libéré (et déborde vers le bas pendant la draft).
  // Temps / résultat : le boss est au centre du récap, plus d'entêtes.
  const avecBoss = draft.phase === "draft";
  const enRecap = PHASES_RECAP.includes(draft.phase);
  const entetes = document.querySelector(".entetes-joueurs");
  entetes.classList.toggle("cache", enRecap || draft.phase === "annule");
  entetes.classList.toggle("compact", avecBoss);
  entetes.classList.toggle("boss-deborde", draft.phase === "draft");
  // Boss tiré : plus de rectangles joueurs (namecard, photo et pseudo sont
  // en haut des tableaux).
  entetes.classList.toggle("sans-joueurs", avecBoss);
  // Draft sur ordi : tableaux à gauche / droite (figés), boss, filtres et
  // grille au centre (cf. CSS #zone-match.mode-draft).
  // Fin de match : mêmes colonnes que la draft, résultat et boss au centre.
  const zoneMatch = document.getElementById("zone-match");
  zoneMatch.classList.toggle("mode-draft", draft.phase === "draft" || enRecap);
  zoneMatch.classList.toggle("mode-recap", enRecap);
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
}

// ---- Polling ----

async function rafraichirEtatRoomEtJoueurs() {
  const room = await rejoindreOuConsulterRoom(roomId);

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
      window.location.replace(`match.html?room=${encodeURIComponent(nouvelleRoom)}`);
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
    window.location.href = "matchmaking.html";
  });
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
    initialiserAnnulationMatchmaking();
    initialiserCrash();

    appliquerFondRoom();

    [personnagesBase, bossData, armesData] = await Promise.all([
      chargerPersonnages(),
      chargerBoss(),
      chargerArmes(),
      chargerFondsBoss()
    ]);
    personnagesData = regrouperPourDraft(personnagesBase);

    initialiserFiltresTri();
    initialiserGrillesPersos();
    initialiserResBoss();

    await tick();

    intervalPolling = setInterval(tick, POLL_INTERVAL_MS);
    // Chronos de la draft classée : affichage et fin de temps, 4 fois par
    // seconde (sans requête tant que rien n'expire).
    setInterval(majChronos, 250);

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