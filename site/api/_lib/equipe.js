// Modes 2v2, 3v3 et 4v4 : deux équipes, chacune dans un monde (co-op) avec
// 4 persos. Rooms de type "equipe" (cf. sql/equipes.sql), page
// matchmaking/equipe.html, routes /api/rooms/{room_id}/equipe_* (cf.
// api/rooms/[room_id]/[action].js).
//
// Déroulé (draft.phase) :
//   lobby       : les joueurs rejoignent par le lien (vitrine conforme, cf.
//                 _lib/vitrine.js) ; formation "choix" : chacun choisit son
//                 équipe ; le créateur lance quand c'est complet.
//   chefs       : chaque équipe vote pour son chef (DUREE_VOTE_CHEF_MS) ;
//                 pas de vote ou égalité : chef tiré au hasard (parmi les
//                 ex aequo). Seul le chef fait les picks, les bans, la
//                 déclaration et la saisie du temps.
//   hotes       : 3v3 seulement, si plusieurs joueurs de l'équipe ont une
//                 full box de HOTE_3V3_FULL_BOX_MAX points au plus : le chef
//                 choisit lequel joue 2 persos (DUREE_CHOIX_HOTE_MS, sinon au
//                 hasard). Aucun : la plus petite full box.
//   draft       : théâtre 12, même séquence que le 1v1 (une équipe à la
//                 place de chaque joueur). Bannir un perso le retire pour
//                 tout le monde ; le picker aussi (personne d'autre ne peut
//                 le prendre). Pick refusé s'il rend impossible de répartir
//                 les persos de l'équipe entre ses joueurs (cf.
//                 trouverAttribution).
//   declaration : chaque chef dit quel joueur joue quel pick (sa version :
//                 constellation...) ; 1 C6 et 2 C3+ de 5★ limités au plus
//                 par équipe. Cachée à l'autre équipe jusqu'à ce que les 2
//                 soient faites.
//   temps -> verification -> termine | litige : comme le 1v1, par les chefs.
//   annule      : un joueur est parti (autre match démarré).
// Rejouer (créateur) : retour au lobby avec les mêmes joueurs.
const { supabase } = require("./supabase");
const { ecrireDraft } = require("./room");
const { actualiserPoints, getPersonnages, getArmes, getPersonnageDraftParId, estGroupe, ELEMENTS_LIBRES } = require("./personnages");
const { sequenceTheatre, calculerPointsBox, calculerPointsArmesBox } = require("./draft");
const { tirerBossAleatoire, getBossParId, idsLegendesLocales, bossCarnageExclus, ERREUR_CARNAGE_DESACTIVE } = require("./boss");
const { legendesTueesParJoueur, enregistrerMorts } = require("./legendes");
const { TEMPS_ABANDON, parserTempsMMSS, determinerVainqueur } = require("./temps");
const { analyserVitrine, erreurVitrine } = require("./vitrine");
const { saisonActuelle } = require("./saisons");

const TAILLES = [2, 3, 4];
const FORMATIONS = ["aleatoire", "choix"];
const ROLES = ["j1", "j2"];
const DUREE_VOTE_CHEF_MS = 30 * 1000;
const DUREE_CHOIX_HOTE_MS = 30 * 1000;
const HOTE_3V3_FULL_BOX_MAX = 3000;
// Règle du match : 5★ limités, par équipe, dans les versions déclarées.
const C6_MAX_EQUIPE = 1;
const C3_MAX_EQUIPE = 2;
const THEATRE_EQUIPE = 12;
const COMMENTAIRE_LITIGE_MAX = 500;
const PHASES_EN_COURS = ["chefs", "hotes", "draft", "declaration", "temps", "verification"];
const PHASES_FINIES = ["termine", "litige", "annule"];
const TEMPS_MASQUE = { affiche: null, secondes: null, masque: true };
const MODES = { 2: "2v2", 3: "3v3", 4: "4v4" };
// Boss pas faisables en co-op : jamais tirés ni imposés en équipe.
const BOSS_HORS_COOP = ["ichcahuipilli_ll", "potapo_ll", "defi_mer_dantan"];
// Spectateurs (colonne rooms.spectateurs, comme le 1v1) : présents s'ils ont
// lu l'état il y a moins de PRESENCE_SPECTATEUR_MS ; réécrit au plus toutes
// les ECRITURE_SPECTATEUR_MS.
const PRESENCE_SPECTATEUR_MS = 30 * 1000;
const ECRITURE_SPECTATEUR_MS = 10 * 1000;

const auHasard = liste => liste[Math.floor(Math.random() * liste.length)];

function erreur(status, message) {
  return { status, message };
}

// ---- État ----

function etatLobby({ taille, formation, createur, bossImpose = null, membres = [createur], camps = {}, infos = {}, bossPrecedent = null, version = null }) {
  return {
    mode: "equipe",
    phase: "lobby",
    taille,
    formation,
    createur,
    boss_impose: bossImpose,
    boss_precedent_id: bossPrecedent,
    membres,
    // Formation au choix : équipe choisie dans le lobby ("j1" | "j2" | null).
    camps: Object.fromEntries(membres.map(id => [id, camps[id] ?? null])),
    // Pseudo, photo, namecard et niveau du monde de chaque joueur.
    infos,
    version
  };
}

// Profils (pseudo, photo, namecard, niveau du monde, données) des joueurs.
async function lireProfils(ids) {
  const { data, error } = await supabase
    .from("profiles")
    .select("discord_id, discord_username, discord_global_name, discord_avatar_url, data")
    .in("discord_id", ids);
  if (error) throw error;
  return new Map((data || []).map(p => [p.discord_id, p]));
}

function infosProfil(profil) {
  return {
    nom: profil?.discord_global_name || profil?.discord_username || "Joueur",
    avatar: profil?.discord_avatar_url || null,
    banniere: profil?.data?.parametres?.banniere || null,
    banniere2: profil?.data?.parametres?.banniere2 || null,
    niveau_monde: profil?.data?.niveau_monde || ""
  };
}

async function chargerRoom(roomId) {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("room_id, type, player1_discord_id, draft, last_active_at, spectateurs")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (!room || room.type !== "equipe" || room.draft?.mode !== "equipe") throw erreur(404, "Room introuvable");
  return room;
}

// Écriture conditionnelle (cf. ecrireDraft) ; conflit : la route est
// rejouée (cf. dispatch de api/rooms/[room_id]/[action].js).
async function sauvegarder(roomId, draft, colonnes = {}) {
  let ecrite;
  try {
    ecrite = await ecrireDraft(supabase, roomId, draft, colonnes);
  } catch (e) {
    console.error(e);
    throw erreur(500, "Erreur lors de la mise à jour de la room");
  }
  if (!ecrite) throw { status: 409, conflit: true, message: "La room a changé entre-temps : réessaie." };
}

function campDe(draft, discordId) {
  return ROLES.find(role => draft.equipes?.[role]?.includes(discordId)) || null;
}

function estChef(draft, discordId) {
  const camp = campDe(draft, discordId);
  return !!camp && draft.chefs?.[camp] === discordId;
}

// ---- Équipes ----

// Équipes équilibrées : somme des full box la plus proche possible entre
// les 2 (au hasard parmi les meilleures répartitions).
function equipesEquilibrees(membres, fullBox, taille) {
  const [premier, ...autres] = membres;
  let meilleures = [];
  let meilleurEcart = Infinity;
  const total = membres.reduce((s, id) => s + (fullBox[id] || 0), 0);
  // Équipe du 1er joueur (évite de compter chaque répartition 2 fois).
  const parcourir = (debut, equipe) => {
    if (equipe.length === taille) {
      const somme = equipe.reduce((s, id) => s + (fullBox[id] || 0), 0);
      const ecart = Math.abs(total - 2 * somme);
      if (ecart < meilleurEcart) {
        meilleurEcart = ecart;
        meilleures = [];
      }
      if (ecart === meilleurEcart) meilleures.push([...equipe]);
      return;
    }
    for (let i = debut; i < autres.length; i++) parcourir(i + 1, [...equipe, autres[i]]);
  };
  parcourir(0, [premier]);
  const j1 = auHasard(meilleures);
  return { j1, j2: membres.filter(id => !j1.includes(id)) };
}

function pointsFullBox(data) {
  return calculerPointsBox(data, "full", getPersonnages()) + calculerPointsArmesBox(data, "full", getArmes());
}

// ---- Persos et versions ----

// Version d'un pick chez un joueur (sa copie dans sa vitrine), ou null.
// Voyageur : de l'élément choisi ; Manekin : élément libre.
function versionChez(draft, membre, pick) {
  return (draft.vitrines?.[membre]?.persos || []).find(p =>
    p.draft_id === pick.perso_id && (!p.element || !pick.element || p.element === pick.element)) || null;
}

// Persos joués par chaque joueur : 2v2 2 + 2, 3v3 hôte 2 + 1 + 1, 4v4 1
// chacun.
function capacites(draft, role) {
  return Object.fromEntries(draft.equipes[role].map(id => [id,
    draft.taille === 2 ? 2 : draft.taille === 4 ? 1 : id === draft.hotes?.[role] ? 2 : 1]));
}

// Répartition des picks d'une équipe entre ses joueurs (chacun joue un
// perso de sa vitrine, nombre de persos par joueur, 1 C6 et 2 C3+ de 5★
// limités au plus) : { perso_id: joueur }, ou null si impossible.
// imposee : répartition déjà choisie pour certains picks (déclaration).
function trouverAttribution(draft, role, picks, imposee = {}) {
  const capacite = capacites(draft, role);
  const membres = draft.equipes[role];
  const charge = Object.fromEntries(membres.map(id => [id, 0]));
  const choix = {};
  let c6 = 0;
  let c3 = 0;
  const essayer = i => {
    if (i === picks.length) return true;
    const pick = picks[i];
    const candidats = imposee[pick.perso_id] ? [imposee[pick.perso_id]] : membres;
    for (const membre of candidats) {
      if (!(membre in charge) || charge[membre] >= capacite[membre]) continue;
      const version = versionChez(draft, membre, pick);
      if (!version) continue;
      const estC6 = version.limite && version.constellation >= 6 ? 1 : 0;
      const estC3 = version.limite && version.constellation >= 3 ? 1 : 0;
      if (c6 + estC6 > C6_MAX_EQUIPE || c3 + estC3 > C3_MAX_EQUIPE) continue;
      charge[membre]++;
      c6 += estC6;
      c3 += estC3;
      choix[pick.perso_id] = membre;
      if (essayer(i + 1)) return true;
      charge[membre]--;
      c6 -= estC6;
      c3 -= estC3;
      delete choix[pick.perso_id];
    }
    return false;
  };
  return essayer(0) ? choix : null;
}

function picksEquipe(draft, role) {
  return (draft.actions || []).filter(a => a.type === "pick" && a.joueur === role && a.perso_id);
}

// Éléments jouables d'un perso par l'équipe (Voyageur : ceux de ses
// vitrines ; Manekin : tous), ou null pour un perso sans élément à choisir.
function elementsEquipe(draft, role, persoId) {
  if (ELEMENTS_LIBRES[persoId]) return ELEMENTS_LIBRES[persoId];
  if (!estGroupe(persoId)) return null;
  const elements = new Set();
  draft.equipes[role].forEach(id => (draft.vitrines[id]?.persos || [])
    .filter(p => p.draft_id === persoId && p.element)
    .forEach(p => elements.add(p.element)));
  return [...elements];
}

// Pick (perso, élément) possible pour cette équipe : encore disponible,
// dans ses vitrines, et répartition toujours possible.
function pickPossible(draft, role, persoId, element) {
  if (!draft.pool_disponible.includes(persoId) || !draft[`pool_${role}`].includes(persoId)) return false;
  return !!trouverAttribution(draft, role, [...picksEquipe(draft, role), { perso_id: persoId, element }]);
}

function aUnPickPossible(draft, role) {
  return draft[`pool_${role}`].some(persoId => {
    if (!draft.pool_disponible.includes(persoId)) return false;
    const elements = elementsEquipe(draft, role, persoId);
    return elements ? elements.some(e => pickPossible(draft, role, persoId, e)) : pickPossible(draft, role, persoId, null);
  });
}

// Après chaque action : pick sans aucun choix possible passé (case vide),
// fin de la draft -> déclaration.
function avancerDraft(draft) {
  for (;;) {
    const action = draft.sequence[draft.sequence_index];
    if (!action) {
      draft.phase = "declaration";
      draft.declaration_j1 = null;
      draft.declaration_j2 = null;
      return;
    }
    if (action.type !== "pick" || aUnPickPossible(draft, action.joueur)) return;
    draft.actions.push({ joueur: action.joueur, type: "pick", perso_id: null, aucun: true });
    draft.sequence_index++;
  }
}

// ---- Chefs, hôtes, tirage ----

function resoudreChefs(draft) {
  draft.chefs = {};
  draft.chefs_au_hasard = {};
  ROLES.forEach(role => {
    const membres = draft.equipes[role];
    const voix = Object.fromEntries(membres.map(id => [id, 0]));
    membres.forEach(votant => {
      const candidat = draft.votes?.[votant];
      if (candidat in voix) voix[candidat]++;
    });
    const max = Math.max(...Object.values(voix));
    const enTete = membres.filter(id => voix[id] === max);
    draft.chefs[role] = auHasard(enTete);
    draft.chefs_au_hasard[role] = enTete.length > 1;
  });
}

// 3v3 : joueur à 2 persos de chaque équipe. -> true si les 2 sont connus.
function preparerHotes(draft) {
  draft.hotes = { j1: null, j2: null };
  draft.eligibles_hote = { j1: [], j2: [] };
  draft.hotes_au_hasard = {};
  ROLES.forEach(role => {
    const membres = draft.equipes[role];
    const eligibles = membres.filter(id => (draft.full_box[id] ?? Infinity) <= HOTE_3V3_FULL_BOX_MAX);
    if (eligibles.length === 1) draft.hotes[role] = eligibles[0];
    else if (eligibles.length === 0) {
      const min = Math.min(...membres.map(id => draft.full_box[id] ?? Infinity));
      draft.hotes[role] = auHasard(membres.filter(id => (draft.full_box[id] ?? Infinity) === min));
    } else draft.eligibles_hote[role] = eligibles;
  });
  return ROLES.every(role => draft.hotes[role]);
}

// Paires d'hôtes possibles (un joueur de chaque équipe, même niveau du
// monde), de la meilleure à la moins bonne : niveau du monde le plus haut,
// puis chefs d'abord. 3v3 : seulement les 2 hôtes déjà choisis (joueurs à 2
// persos). Aucune : pas de légende locale (niveaux différents).
function pairesHotes(draft) {
  const niveau = id => draft.infos?.[id]?.niveau_monde || "";
  const candidats = role => draft.taille === 3 ? [draft.hotes[role]] : draft.equipes[role];
  const paires = [];
  candidats("j1").forEach(a => candidats("j2").forEach(b => {
    if (niveau(a) && niveau(a) === niveau(b)) paires.push({ j1: a, j2: b });
  }));
  const chefs = paire => (paire.j1 === draft.chefs.j1) + (paire.j2 === draft.chefs.j2);
  return paires.sort((x, y) => Number(niveau(y.j1)) - Number(niveau(x.j1)) || chefs(y) - chefs(x));
}

function echangerEquipes(draft) {
  ["equipes", "chefs", "hotes", "chefs_au_hasard", "eligibles_hote"].forEach(cle => {
    if (draft[cle]) draft[cle] = { j1: draft[cle].j2, j2: draft[cle].j1 };
  });
}

// Équipe qui commence (au hasard ; revanche : l'autre équipe), boss, hôtes
// des mondes, pools et début de la draft.
// Légendes locales : en co-op, seul le monde de l'hôte compte. Une légende
// "une fois par jour" reste tirable s'il existe une paire d'hôtes (même
// niveau du monde) dont aucun ne l'a tuée aujourd'hui ; 2v2 / 4v4 : les
// hôtes sont choisis après le tirage, parmi les paires qui peuvent jouer ce
// boss (rotation d'une revanche à l'autre si les hôtes l'ont déjà tuée).
async function lancerDraft(draft, { revanche = false } = {}) {
  if (revanche || Math.random() < 0.5) echangerEquipes(draft);

  const paires = pairesHotes(draft);
  const tuees = await legendesTueesParJoueur([...draft.equipes.j1, ...draft.equipes.j2]);
  const libre = (paire, bossId) => !tuees.get(paire.j1)?.has(bossId) && !tuees.get(paire.j2)?.has(bossId);
  const legendes = idsLegendesLocales();
  const exclus = [...legendes.filter(id => !paires.some(paire => libre(paire, id))), ...BOSS_HORS_COOP, ...await bossCarnageExclus()];
  const impose = draft.boss_impose && getBossParId(draft.boss_impose) && !exclus.includes(draft.boss_impose) ? draft.boss_impose : null;
  draft.boss_id = impose || tirerBossAleatoire(draft.boss_precedent_id, { exclus })?.id || null;
  draft.legendes = paires.length > 0;

  if (draft.taille !== 3) {
    const estLegende = legendes.includes(draft.boss_id);
    const paire = paires.find(p => !estLegende || libre(p, draft.boss_id));
    draft.hotes = paire ? { ...paire } : { j1: draft.chefs.j1, j2: draft.chefs.j2 };
  }

  ROLES.forEach(role => {
    draft[`pool_${role}`] = [...new Set(draft.equipes[role].flatMap(id => (draft.vitrines[id]?.persos || []).map(p => p.draft_id)))];
  });
  draft.pool_disponible = [...new Set([...draft.pool_j1, ...draft.pool_j2])];
  draft.theatre = THEATRE_EQUIPE;
  draft.sequence = sequenceTheatre(THEATRE_EQUIPE);
  draft.sequence_index = 0;
  draft.actions = [];
  draft.phase = "draft";
  avancerDraft(draft);
}

// Fins de temps (vote du chef, choix de l'hôte) : appliquées à la lecture.
// -> true si la draft a changé.
async function avancerSelonTemps(draft, maintenant = Date.now()) {
  if (draft.phase === "chefs") {
    const tousOntVote = [...draft.equipes.j1, ...draft.equipes.j2].every(id => draft.votes?.[id]);
    if (!tousOntVote && maintenant < draft.fin_vote) return false;
    resoudreChefs(draft);
    if (draft.taille === 3 && !preparerHotes(draft)) {
      draft.phase = "hotes";
      draft.fin_hote = maintenant + DUREE_CHOIX_HOTE_MS;
      return true;
    }
    await lancerDraft(draft);
    return true;
  }
  if (draft.phase === "hotes") {
    const choisis = ROLES.every(role => draft.hotes[role]);
    if (!choisis && maintenant < draft.fin_hote) return false;
    ROLES.forEach(role => {
      if (!draft.hotes[role]) {
        draft.hotes[role] = auHasard(draft.eligibles_hote[role]);
        (draft.hotes_au_hasard ??= {})[role] = true;
      }
    });
    // Revanche en 3v3 : hôtes rechoisis, puis draft de revanche.
    const revanche = !!draft.revanche_hotes;
    draft.revanche_hotes = false;
    await lancerDraft(draft, { revanche });
    return true;
  }
  return false;
}

// ---- Vue d'un joueur ----
// Votes des autres, déclaration et temps de l'autre équipe cachés tant que
// la phase n'est pas finie.
function vueEquipe(draft, discordId) {
  const camp = campDe(draft, discordId);
  const vue = { ...draft };
  if (draft.phase === "chefs") {
    vue.votes = Object.fromEntries(Object.keys(draft.votes || {}).map(id => [id, id === discordId ? draft.votes[id] : true]));
  }
  if (draft.phase === "declaration") {
    ROLES.forEach(role => {
      if (role !== camp) vue[`declaration_${role}`] = draft[`declaration_${role}`] ? true : null;
    });
  }
  if (draft.phase === "temps") {
    ROLES.forEach(role => {
      if (role !== camp && vue[`temps_${role}`]) vue[`temps_${role}`] = TEMPS_MASQUE;
    });
  }
  return vue;
}

// ---- Archivage ----

function raffinementSignature(draft, membre, persoId) {
  const arme = getArmes().find(a => typeof a.image === "string" && a.image.endsWith(`/${persoId}_w.webp`));
  if (!arme) return null;
  let meilleur = null;
  Object.entries(draft.vitrines?.[membre]?.armes || {}).forEach(([instance, valeur]) => {
    if ((instance === arme.id || instance.startsWith(`${arme.id}#`)) && (meilleur === null || valeur > meilleur)) meilleur = valeur;
  });
  return meilleur;
}

async function archiverEquipe(draft, { litige = false } = {}) {
  const actions = draft.actions.map(action => {
    if (action.type === "ban") return { ...action, infos: { j1: null, j2: null } };
    if (!action.perso_id) return action;
    const membre = draft[`declaration_${action.joueur}`]?.[action.perso_id] || null;
    const version = membre ? versionChez(draft, membre, action) : null;
    return {
      ...action,
      joue_par: membre,
      constellation: version?.constellation ?? null,
      niveau: version?.niveau ?? null,
      raffinement: membre ? raffinementSignature(draft, membre, action.perso_id) : null
    };
  });
  const equipe = role => ({
    membres: draft.equipes[role].map(id => ({ discord_id: id, nom: draft.infos?.[id]?.nom || "Joueur", avatar: draft.infos?.[id]?.avatar || null })),
    chef: draft.chefs[role],
    hote: draft.hotes?.[role] || null
  });
  const ligne = {
    boss_id: draft.boss_id,
    player1_discord_id: draft.chefs.j1,
    player2_discord_id: draft.chefs.j2,
    box_j1: "vitrine",
    box_j2: "vitrine",
    team_j1: picksEquipe(draft, "j1").map(a => a.perso_id),
    team_j2: picksEquipe(draft, "j2").map(a => a.perso_id),
    bans_j1: actions.filter(a => a.type === "ban" && a.joueur === "j1").map(a => ({ perso_id: a.perso_id, bonus: false, infos: a.infos })),
    bans_j2: actions.filter(a => a.type === "ban" && a.joueur === "j2").map(a => ({ perso_id: a.perso_id, bonus: false, infos: a.infos })),
    temps_j1_affiche: draft.temps_j1?.affiche ?? null,
    temps_j1_secondes: draft.temps_j1?.secondes ?? null,
    temps_j2_affiche: draft.temps_j2?.affiche ?? null,
    temps_j2_secondes: draft.temps_j2?.secondes ?? null,
    vainqueur: draft.vainqueur,
    theatre: THEATRE_EQUIPE,
    mode_theatre: "12",
    actions,
    mode_equipe: MODES[draft.taille],
    equipes: { j1: equipe("j1"), j2: equipe("j2") },
    saison: await saisonActuelle(),
    ...(litige ? { litige: "ouvert", litige_par: draft.litige_par_role || null, litige_commentaire: draft.litige_commentaire || null } : {})
  };
  const { data, error } = await supabase.from("match_history").insert(ligne).select("id").single();
  if (error) {
    console.error("Erreur archivage match d'équipe :", error);
    return null;
  }
  // Légendes locales : tuées dans le monde de l'hôte de chaque équipe qui a
  // saisi un temps (les autres joueurs peuvent la refaire chez un autre
  // hôte, cf. lancerDraft).
  await enregistrerMorts(draft.boss_id, data.id, ROLES.filter(role => draft.hotes?.[role]).map(role => ({
    discord_id: draft.hotes[role],
    temps_secondes: draft[`temps_${role}`]?.secondes ?? null
  })));
  return data.id;
}

// ---- Un seul match à la fois ----
// Joueur qui démarre un autre match : il quitte ses rooms d'équipe (lobby :
// retiré, room supprimée si c'est le créateur ; match en cours : annulé).
async function quitterEquipes(discordId, { sauf = null } = {}) {
  let requete = supabase
    .from("rooms")
    .select("room_id, draft")
    .eq("type", "equipe")
    .contains("membres", [discordId]);
  if (sauf) requete = requete.neq("room_id", sauf);
  const { data, error } = await requete;
  if (error) {
    // Colonne membres absente (sql/equipes.sql pas lancé) : aucune room d'équipe.
    if (!["42703", "PGRST204", "42P01"].includes(error.code)) console.error("Erreur lecture rooms d'équipe :", error);
    return;
  }
  for (const room of data || []) {
    try {
      await retirerMembre(room.room_id, room.draft, discordId);
    } catch (e) {
      console.error("Erreur en quittant la room d'équipe :", e);
    }
  }
}

// Retire un joueur d'une room d'équipe (3 essais si elle change entre-temps).
async function retirerMembre(roomId, draft, discordId) {
  for (let essai = 0; essai < 3; essai++) {
    if (!draft?.membres?.includes(discordId)) return;
    if (draft.phase === "lobby" && draft.createur === discordId) {
      await supabase.from("rooms").delete().eq("room_id", roomId);
      return;
    }
    const membres = draft.membres.filter(id => id !== discordId);
    const camps = { ...draft.camps };
    delete camps[discordId];
    const nouveau = { ...draft, membres, camps };
    if (PHASES_EN_COURS.includes(draft.phase)) {
      nouveau.phase = "annule";
      nouveau.annule_par = discordId;
    }
    if (await ecrireDraft(supabase, roomId, nouveau, { membres })) return;
    const { data } = await supabase.from("rooms").select("draft").eq("room_id", roomId).maybeSingle();
    if (!data) return;
    draft = data.draft;
  }
}

// ---- Création (POST /api/rooms { type: "equipe", ... }, cf. api/rooms/index.js) ----
// -> { draft, erreur }
async function preparerCreation(body, user) {
  const taille = Number(body?.taille);
  if (!TAILLES.includes(taille)) return { erreur: "Mode inconnu (2v2, 3v3 ou 4v4)" };
  const formation = FORMATIONS.includes(body?.formation) ? body.formation : "aleatoire";
  const bossImpose = body?.boss_id ? String(body.boss_id) : null;
  if (bossImpose && !getBossParId(bossImpose)) return { erreur: "Boss inconnu" };
  if (BOSS_HORS_COOP.includes(bossImpose)) return { erreur: "Ce boss n'est pas faisable en co-op." };
  if ((await bossCarnageExclus()).includes(bossImpose)) return { erreur: ERREUR_CARNAGE_DESACTIVE };

  await actualiserPoints();
  const profils = await lireProfils([user.id]);
  const profil = profils.get(user.id);
  const erreurV = erreurVitrine(profil?.data);
  if (erreurV) return { erreur: erreurV };
  return {
    draft: etatLobby({ taille, formation, createur: user.id, bossImpose, infos: { [user.id]: infosProfil(profil) } })
  };
}

// ---- Routes ----

async function lireCorps(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function repondre(res, draft, discordId, extra = {}) {
  return res.status(200).json({ draft: vueEquipe(draft, discordId), maintenant: Date.now(), ...extra });
}

// GET : état (fins de temps appliquées), dernière activité notée.
async function routeEtat(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (await avancerSelonTemps(draft)) await sauvegarder(roomId, draft);
  const maintenant = Date.now();
  const membre = draft.membres.includes(user.id);
  const colonnes = {};
  // Activité de la room (nettoyage des rooms inactives) : au plus 1 fois par minute.
  if (!room.last_active_at || maintenant - Date.parse(room.last_active_at) > 60 * 1000) {
    colonnes.last_active_at = new Date(maintenant).toISOString();
  }
  // Spectateur : présence notée (seulement cette colonne, jamais la draft).
  const presents = Object.entries(room.spectateurs || {})
    .filter(([id, vu]) => !draft.membres.includes(id) && maintenant - Number(vu) < PRESENCE_SPECTATEUR_MS);
  if (!membre && maintenant - Number(room.spectateurs?.[user.id] || 0) >= ECRITURE_SPECTATEUR_MS) {
    colonnes.spectateurs = Object.fromEntries([...presents.filter(([id]) => id !== user.id), [user.id, maintenant]]);
  }
  if (Object.keys(colonnes).length) {
    const { error } = await supabase.from("rooms").update(colonnes).eq("room_id", roomId);
    if (error) console.error("Erreur activité / spectateurs :", error);
  }
  const nbSpectateurs = new Set([...presents.map(([id]) => id), ...(membre ? [] : [user.id])]).size;
  // Nombre de spectateurs : pour les joueurs (indicateur 👁).
  return repondre(res, draft, user.id, { room_id: roomId, ...(membre ? { nb_spectateurs: nbSpectateurs } : {}) });
}

async function routeRejoindre(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.membres.includes(user.id)) return repondre(res, draft, user.id);
  if (draft.phase !== "lobby") throw erreur(409, "Le match a déjà commencé : tu peux le regarder en spectateur.");
  if (draft.membres.length >= draft.taille * 2) throw erreur(409, "Le lobby est complet : tu peux regarder en spectateur.");

  await actualiserPoints();
  const profil = (await lireProfils([user.id])).get(user.id);
  const erreurV = erreurVitrine(profil?.data);
  if (erreurV) throw erreur(409, erreurV);

  const membres = [...draft.membres, user.id];
  const nouveau = {
    ...draft,
    membres,
    camps: { ...draft.camps, [user.id]: null },
    infos: { ...draft.infos, [user.id]: infosProfil(profil) }
  };
  await sauvegarder(roomId, nouveau, { membres });
  // Un seul match à la fois : ses autres matchs sont quittés.
  const { annulerAutresMatchs } = require("./room");
  await annulerAutresMatchs(supabase, user.id, { sauf: roomId });
  return repondre(res, nouveau, user.id);
}

async function routeQuitter(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  if (room.draft.phase !== "lobby") throw erreur(409, "Le match a commencé : tu ne peux plus quitter le lobby.");
  await retirerMembre(roomId, room.draft, user.id);
  return res.status(200).json({ ok: true });
}

async function routeCamp(req, res, roomId, user) {
  const { camp } = await lireCorps(req);
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "lobby" || draft.formation !== "choix") throw erreur(409, "Le choix des équipes n'est pas ouvert.");
  if (!draft.membres.includes(user.id)) throw erreur(403, "Tu n'es pas dans ce lobby.");
  const nouveauCamp = ROLES.includes(camp) ? camp : null;
  if (nouveauCamp && draft.camps[user.id] !== nouveauCamp &&
    draft.membres.filter(id => draft.camps[id] === nouveauCamp).length >= draft.taille) {
    throw erreur(409, "Cette équipe est complète.");
  }
  draft.camps = { ...draft.camps, [user.id]: nouveauCamp };
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

// Le créateur lance : vitrines et profils figés, équipes formées, vote des
// chefs.
async function routeLancer(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.createur !== user.id) throw erreur(403, "Seul le créateur de la room peut lancer le match.");
  if (draft.phase !== "lobby") throw erreur(409, "Le match a déjà commencé.");
  if (draft.membres.length !== draft.taille * 2) throw erreur(409, `Il faut ${draft.taille * 2} joueurs (${draft.membres.length} actuellement).`);
  if (draft.formation === "choix" && ROLES.some(role => draft.membres.filter(id => draft.camps[id] === role).length !== draft.taille)) {
    throw erreur(409, "Les 2 équipes doivent être complètes.");
  }

  await actualiserPoints();
  const profils = await lireProfils(draft.membres);
  const nonConformes = draft.membres.filter(id => erreurVitrine(profils.get(id)?.data));
  if (nonConformes.length) {
    const noms = nonConformes.map(id => infosProfil(profils.get(id)).nom).join(", ");
    throw erreur(409, `Vitrine non conforme (à corriger dans Mon compte) : ${noms}.`);
  }

  const vitrines = {};
  const fullBox = {};
  const infos = {};
  draft.membres.forEach(id => {
    const data = profils.get(id)?.data;
    const { persos, armes, points } = analyserVitrine(data);
    vitrines[id] = { persos, armes, points };
    fullBox[id] = pointsFullBox(data);
    infos[id] = infosProfil(profils.get(id));
  });

  const equipes = draft.formation === "choix"
    ? Object.fromEntries(ROLES.map(role => [role, draft.membres.filter(id => draft.camps[id] === role)]))
    : equipesEquilibrees(draft.membres, fullBox, draft.taille);

  Object.assign(draft, {
    phase: "chefs",
    equipes,
    vitrines,
    full_box: fullBox,
    infos,
    votes: {},
    fin_vote: Date.now() + DUREE_VOTE_CHEF_MS,
    chefs: null,
    hotes: null,
    boss_id: null,
    actions: [],
    temps_j1: null,
    temps_j2: null,
    vainqueur: null
  });
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

async function routeVote(req, res, roomId, user) {
  const { candidat } = await lireCorps(req);
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "chefs") throw erreur(409, "Le vote du chef est terminé.");
  const camp = campDe(draft, user.id);
  if (!camp) throw erreur(403, "Tu ne joues pas ce match.");
  if (!draft.equipes[camp].includes(candidat)) throw erreur(400, "Vote pour un joueur de ton équipe.");
  draft.votes = { ...draft.votes, [user.id]: candidat };
  await avancerSelonTemps(draft);
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

async function routeHote(req, res, roomId, user) {
  const { hote } = await lireCorps(req);
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "hotes") throw erreur(409, "Le choix de l'hôte est terminé.");
  const camp = campDe(draft, user.id);
  if (!estChef(draft, user.id)) throw erreur(403, "Seul le chef choisit l'hôte.");
  if (draft.hotes[camp]) throw erreur(409, "L'hôte de ton équipe est déjà choisi.");
  if (!draft.eligibles_hote[camp].includes(hote)) throw erreur(400, `L'hôte doit avoir une full box de ${HOTE_3V3_FULL_BOX_MAX} points au plus.`);
  draft.hotes = { ...draft.hotes, [camp]: hote };
  await avancerSelonTemps(draft);
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

async function routeAction(req, res, roomId, user) {
  const { perso_id: persoId, element = null } = await lireCorps(req);
  if (typeof persoId !== "string" || !getPersonnageDraftParId(persoId)) throw erreur(400, "Personnage inconnu");
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "draft") throw erreur(409, "Ce n'est pas le moment de bannir / picker");
  const action = draft.sequence[draft.sequence_index];
  const camp = campDe(draft, user.id);
  if (!action || action.joueur !== camp) throw erreur(403, "Ce n'est pas le tour de ton équipe");
  if (!estChef(draft, user.id)) throw erreur(403, "Seul le chef de l'équipe fait les picks et les bans");
  if (!draft.pool_disponible.includes(persoId)) throw erreur(409, "Ce personnage n'est plus disponible");

  if (action.type === "pick") {
    if (!draft[`pool_${camp}`].includes(persoId)) throw erreur(403, "Personne de ton équipe n'a ce personnage dans sa vitrine");
    const elements = elementsEquipe(draft, camp, persoId);
    if (elements && !elements.includes(element)) throw erreur(400, "Choisis l'élément de ce personnage");
    if (!pickPossible(draft, camp, persoId, elements ? element : null)) {
      throw erreur(409, "Pick impossible : tes joueurs ne pourraient plus se répartir les persos (persos de chaque vitrine, nombre de persos par joueur, 1 C6 et 2 C3+ de 5★ limités au maximum).");
    }
    draft.actions.push({ joueur: camp, type: "pick", perso_id: persoId, ...(elements ? { element } : {}) });
  } else {
    draft.actions.push({ joueur: camp, type: "ban", perso_id: persoId });
  }
  draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
  draft.sequence_index++;
  avancerDraft(draft);
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

// { attributions: { perso_id: discord_id } } : qui joue quel pick.
async function routeDeclarer(req, res, roomId, user) {
  const { attributions } = await lireCorps(req);
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "declaration") throw erreur(409, "Ce n'est pas le moment de déclarer les persos");
  const camp = campDe(draft, user.id);
  if (!estChef(draft, user.id)) throw erreur(403, "Seul le chef déclare qui joue quel perso");
  const picks = picksEquipe(draft, camp);
  const imposee = {};
  for (const pick of picks) {
    const membre = attributions?.[pick.perso_id];
    if (!draft.equipes[camp].includes(membre)) throw erreur(400, "Choisis un joueur pour chaque perso");
    imposee[pick.perso_id] = membre;
  }
  if (!trouverAttribution(draft, camp, picks, imposee)) {
    throw erreur(409, "Déclaration impossible : chaque joueur joue un perso de sa vitrine, avec le bon nombre de persos par joueur, et 1 C6 et 2 C3+ de 5★ limités au maximum par équipe.");
  }
  draft[`declaration_${camp}`] = imposee;
  if (ROLES.every(role => draft[`declaration_${role}`])) {
    draft.phase = "temps";
    draft.debut_temps = Date.now();
  }
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

async function routeTemps(req, res, roomId, user) {
  const corps = await lireCorps(req);
  const temps = corps.abandon === true ? { ...TEMPS_ABANDON } : parserTempsMMSS(corps.temps);
  if (!temps) throw erreur(400, "Format de temps invalide (attendu mm:ss)");
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "temps" && draft.phase !== "verification") throw erreur(409, "La saisie du temps n'est pas ouverte");
  const camp = campDe(draft, user.id);
  if (!estChef(draft, user.id)) throw erreur(403, "Seul le chef saisit le temps de l'équipe");
  const ancien = draft[`temps_${camp}`];
  draft[`temps_${camp}`] = temps;
  if (draft.phase === "verification") {
    if (ancien?.affiche !== temps.affiche) {
      draft.temps_confirme_j1 = false;
      draft.temps_confirme_j2 = false;
    }
  } else if (draft.temps_j1 && draft.temps_j2) {
    draft.phase = "verification";
    draft.temps_confirme_j1 = false;
    draft.temps_confirme_j2 = false;
  }
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

async function routeConfirmer(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "verification") throw erreur(409, "Les temps ne sont pas en cours de vérification");
  const camp = campDe(draft, user.id);
  if (!estChef(draft, user.id)) throw erreur(403, "Seul le chef confirme les temps");
  draft[`temps_confirme_${camp}`] = true;
  if (!(draft.temps_confirme_j1 && draft.temps_confirme_j2)) {
    await sauvegarder(roomId, draft);
    return repondre(res, draft, user.id);
  }
  // Manche réservée (écriture conditionnelle) avant d'être archivée.
  draft.vainqueur = determinerVainqueur(draft.temps_j1, draft.temps_j2);
  draft.phase = "termine";
  await sauvegarder(roomId, draft);
  draft.id_match = await archiverEquipe(draft);
  try {
    await sauvegarder(roomId, draft);
  } catch (e) {
    if (!e?.conflit) throw e;
  }
  return repondre(res, draft, user.id);
}

async function routeLitige(req, res, roomId, user) {
  const { commentaire: brut } = await lireCorps(req);
  const commentaire = typeof brut === "string" ? brut.trim() : "";
  if (!commentaire) throw erreur(400, "Explique la raison du litige.");
  if (commentaire.length > COMMENTAIRE_LITIGE_MAX) throw erreur(400, `Commentaire trop long (${COMMENTAIRE_LITIGE_MAX} caractères au maximum).`);
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "verification") throw erreur(409, "Les temps ne sont pas en cours de vérification");
  const camp = campDe(draft, user.id);
  if (!estChef(draft, user.id)) throw erreur(403, "Seul le chef signale un litige");
  draft.phase = "litige";
  draft.litige_par_role = camp;
  draft.litige_commentaire = commentaire;
  draft.vainqueur = null;
  await sauvegarder(roomId, draft);
  await archiverEquipe(draft, { litige: true });
  return repondre(res, draft, user.id);
}

// Revanche (chefs) : mêmes équipes, chefs, hôtes et vitrines, nouveau boss
// (différent du précédent), l'autre équipe commence ; lancée quand les 2
// chefs l'ont demandée.
async function routeRevanche(req, res, roomId, user) {
  const { rejouer = true } = await lireCorps(req);
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (!["termine", "litige"].includes(draft.phase)) throw erreur(409, "Le match n'est pas terminé.");
  const camp = campDe(draft, user.id);
  if (!estChef(draft, user.id)) throw erreur(403, "Seul le chef demande la revanche pour son équipe.");
  draft[`revanche_${camp}`] = !!rejouer;
  if (draft.revanche_j1 && draft.revanche_j2) {
    Object.assign(draft, {
      boss_precedent_id: draft.boss_id,
      boss_id: null,
      actions: [],
      declaration_j1: null,
      declaration_j2: null,
      temps_j1: null,
      temps_j2: null,
      temps_confirme_j1: false,
      temps_confirme_j2: false,
      debut_temps: null,
      vainqueur: null,
      litige_par_role: null,
      litige_commentaire: null,
      id_match: null,
      revanche_j1: false,
      revanche_j2: false
    });
    await actualiserPoints();
    // 3v3 : l'hôte (joueur à 2 persos) peut changer d'une revanche à l'autre
    // (légende déjà tuée chez lui...) : rechoisi par le chef s'il y a le choix.
    if (draft.taille === 3 && !preparerHotes(draft)) {
      draft.phase = "hotes";
      draft.fin_hote = Date.now() + DUREE_CHOIX_HOTE_MS;
      draft.revanche_hotes = true;
    } else {
      await lancerDraft(draft, { revanche: true });
    }
  }
  await sauvegarder(roomId, draft);
  return repondre(res, draft, user.id);
}

// Créateur : retour au lobby, mêmes joueurs (équipes gardées en formation
// au choix).
async function routeRejouer(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.createur !== user.id) throw erreur(403, "Seul le créateur de la room peut relancer.");
  if (!PHASES_FINIES.includes(draft.phase)) throw erreur(409, "Le match n'est pas terminé.");
  const camps = {};
  draft.membres.forEach(id => { camps[id] = draft.formation === "choix" ? campDe(draft, id) : null; });
  const nouveau = etatLobby({
    taille: draft.taille,
    formation: draft.formation,
    createur: draft.createur,
    bossImpose: draft.boss_impose,
    membres: draft.membres,
    camps,
    infos: draft.infos,
    bossPrecedent: draft.boss_id || null,
    version: draft.version
  });
  await sauvegarder(roomId, nouveau, { membres: nouveau.membres });
  return repondre(res, nouveau, user.id);
}

const ROUTES = {
  equipe_etat: { methode: "GET", route: routeEtat },
  equipe_rejoindre: { methode: "POST", route: routeRejoindre },
  equipe_quitter: { methode: "POST", route: routeQuitter },
  equipe_camp: { methode: "POST", route: routeCamp },
  equipe_lancer: { methode: "POST", route: routeLancer },
  equipe_vote: { methode: "POST", route: routeVote },
  equipe_hote: { methode: "POST", route: routeHote },
  equipe_action: { methode: "POST", route: routeAction },
  equipe_declarer: { methode: "POST", route: routeDeclarer },
  equipe_temps: { methode: "POST", route: routeTemps },
  equipe_confirmer: { methode: "POST", route: routeConfirmer },
  equipe_litige: { methode: "POST", route: routeLitige },
  equipe_rejouer: { methode: "POST", route: routeRejouer },
  equipe_revanche: { methode: "POST", route: routeRevanche }
};

function estRouteEquipe(action) {
  return Object.hasOwn(ROUTES, action);
}

async function executerRouteEquipe(action, req, res, roomId, user) {
  const { methode, route } = ROUTES[action];
  if (req.method !== methode) {
    res.setHeader("Allow", methode);
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
  return route(req, res, roomId, user);
}

module.exports = {
  MODES,
  estRouteEquipe,
  executerRouteEquipe,
  preparerCreation,
  quitterEquipes,
  // Tests.
  trouverAttribution,
  equipesEquilibrees,
  versionChez
};
