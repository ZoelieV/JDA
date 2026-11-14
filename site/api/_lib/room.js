const { etatInitialDraft } = require("./draft");
const { archiverMatch, resultatTrophees } = require("./archive");
const { TEMPS_ABANDON, determinerVainqueur } = require("./temps");

// Détermine si l'utilisateur connecté est j1, j2, ou ni l'un ni l'autre
// pour une room donnée. j1/j2 sont les rôles DE LA MANCHE EN COURS
// (draft.discord_j1 / draft.discord_j2 : places provisoires, puis tirées
// au sort et échangées à chaque revanche — cf. lancerTirage et
// etatRevanche dans _lib/draft.js), pas
// forcément "qui a créé la room" (room.player1_discord_id). Le repli sur
// les colonnes de room sert uniquement de filet avant que les rôles de
// la manche n'aient été assignés (ex : tout premier accès).
function determinerRole(room, discordId) {
  const draft = room.draft || {};
  const idJ1 = draft.discord_j1 || room.player1_discord_id;
  const idJ2 = draft.discord_j2 || room.player2_discord_id;

  if (idJ1 === discordId) return "j1";
  if (idJ2 === discordId) return "j2";
  return null;
}

function getAutreJoueur(joueur) {
  return joueur === "j1" ? "j2" : "j1";
}

function getDiscordIdJoueur(room, joueur) {
  const draft = room.draft || {};
  if (joueur === "j1") return draft.discord_j1 || room.player1_discord_id;
  return draft.discord_j2 || room.player2_discord_id;
}

// Écriture de la draft d'une room, seulement si personne ne l'a modifiée
// depuis sa lecture : draft.version augmente à chaque écriture et la mise à
// jour est conditionnée à la version lue. Deux requêtes simultanées (double
// clic, envois en parallèle) ne peuvent donc pas appliquer deux fois la
// même transition (ex. un match archivé deux fois, trophées doublés).
// colonnes : autres colonnes de la room écrites en même temps (ex. membres
// d'une room d'équipe).
// -> true si écrite (draft.version mise à jour), false si la room a changé
// entre-temps ; erreur Supabase levée.
async function ecrireDraft(supabase, roomId, draft, colonnes = {}) {
  const lue = draft.version ?? null;
  const suivante = { ...draft, version: (Number(lue) || 0) + 1 };
  let requete = supabase.from("rooms").update({ ...colonnes, draft: suivante }).eq("room_id", roomId);
  requete = lue === null ? requete.is("draft->>version", null) : requete.eq("draft->>version", String(lue));
  const { data, error } = await requete.select("room_id");
  if (error) throw error;
  if (!data?.length) return false;
  draft.version = suivante.version;
  return true;
}

// Place provisoirement les 2 joueurs (créateur de la room en j1) au 1er
// accès à une room complète. Le vrai tirage j1/j2 n'a lieu qu'après les
// bans d'équilibrage (lancerTirage dans _lib/draft.js), qui échange ou non
// ces places. Idempotent : ne fait rien si déjà assigné.
async function assurerRolesDraft(supabase, room) {
  if (room.draft && room.draft.discord_j1 && room.draft.discord_j2) {
    return room;
  }

  const draft = { ...etatInitialDraft(), ...(room.draft || {}) };
  draft.discord_j1 = room.player1_discord_id;
  draft.discord_j2 = room.player2_discord_id;
  draft.roles_tires = false;

  try {
    if (await ecrireDraft(supabase, room.room_id, draft)) return { ...room, draft };
    // Rôles assignés entre-temps par une autre requête : draft relue.
    const { data } = await supabase.from("rooms").select("draft").eq("room_id", room.room_id).maybeSingle();
    if (data?.draft) return { ...room, draft: data.draft };
  } catch (error) {
    console.error("Erreur assignation des rôles :", error);
  }
  return room;
}

// Charge la room (avec sa draft) et vérifie que l'utilisateur en fait
// partie. Retourne { room, joueur } ou lève une erreur { status, message }
// à catcher dans la route pour répondre directement au client.
// autoriserSpectateur : lecture seule ouverte à tous (joueur = null pour
// quelqu'un qui n'est ni j1 ni j2).
// agirEn : entraînement joué seul (même compte en j1 et j2) -> rôle dans
// lequel le lanceur agit ("j1" | "j2", celui dont c'est le tour, envoyé par
// sa page).
async function chargerRoomAvecRole(supabase, roomId, discordId, { autoriserSpectateur = false, agirEn = null } = {}) {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("room_id, player1_discord_id, player2_discord_id, type, draft, spectateurs")
    .eq("room_id", roomId)
    .single();

  if (error || !room) {
    throw { status: 404, message: "Room introuvable" };
  }

  if (!room.player1_discord_id || !room.player2_discord_id) {
    throw { status: 400, message: "La room n'est pas encore complète (2 joueurs requis)" };
  }

  const roomAvecRoles = await assurerRolesDraft(supabase, room);
  let joueur = determinerRole(roomAvecRoles, discordId);
  const d = roomAvecRoles.draft;
  if (joueur && d?.entrainement && d.discord_j1 === d.discord_j2 && ["j1", "j2"].includes(agirEn)) joueur = agirEn;

  if (!joueur && !autoriserSpectateur) {
    throw { status: 403, message: "Tu ne fais pas partie de cette room (spectateur)" };
  }

  return { room: roomAvecRoles, joueur };
}

// ---- Un seul match à la fois ----
// Un joueur qui démarre un autre match (match privé créé ou rejoint,
// recherche de matchmaking) quitte ses autres rooms :
// - room encore en attente d'un adversaire : supprimée ;
// - manche en cours : annulée (phase "annule", annule_par = son rôle),
//   rien dans l'historique ; en classé, comptée comme un abandon : défaite
//   archivée avec perte des trophées, victoire de l'adversaire
//   (abandon_classe, cf. abandonnerMatchClasse) ;
// - manche terminée (termine / litige) : résultat gardé, revanche
//   impossible (quitte_par = son rôle).
// sauf : room à garder (celle qu'il rejoint ou sa room d'attente).
const PHASES_FINIES = ["termine", "litige", "annule"];

// Match classé quitté en cours : abandon de ce joueur (temps "Abandon"),
// l'adversaire garde son temps s'il l'avait saisi. Archivé comme un match
// classé (trophées au maximum, cf. calculerTrophees) ; la room passe en
// "annule" avec le résultat pour l'écran de l'adversaire. Room d'abord
// passée en "annule" (écriture conditionnelle), archivée ensuite : jamais
// deux archivages pour un même abandon.
// -> false si la room a changé entre-temps (rien archivé).
async function abandonnerMatchClasse(supabase, roomId, draft, role) {
  const autre = role === "j1" ? "j2" : "j1";
  const tempsAutre = draft[`temps_${autre}`] || { affiche: "—", secondes: null };
  const final = {
    ...draft,
    [`temps_${role}`]: { ...TEMPS_ABANDON },
    [`temps_${autre}`]: tempsAutre
  };
  final.vainqueur = determinerVainqueur(final.temps_j1, final.temps_j2, final.boss_id);
  const annule = {
    ...final,
    phase: "annule",
    annule_par: role,
    abandon_classe: true,
    resultat_trophees: null
  };
  if (!await ecrireDraft(supabase, roomId, annule)) return false;

  const idMatch = await archiverMatch(final, { classe: true });
  annule.resultat_trophees = await resultatTrophees(idMatch);
  if (!await ecrireDraft(supabase, roomId, annule)) console.error("Résultat de l'abandon pas enregistré (room modifiée) :", roomId);
  return true;
}

// Match classé en cours du joueur (room complète, manche pas finie, room
// active depuis moins de ACTIVITE_MATCH_CLASSE_MS) : il n'est jamais
// quitté en démarrant ou rejoignant un autre match (ce serait un abandon,
// cf. abandonnerMatchClasse) ; la recherche y renvoie, le reste est refusé.
// Active : room ouverte (last_active_at, écrit à l'ouverture de la page)
// ou draft relue par un des 2 joueurs (présence dans rooms.spectateurs,
// écrite par le polling de la page du match, cf. noterPresence) : un match
// long (draft + combat > 10 min) reste bloquant tant qu'un joueur est
// encore sur la page. Room inactive (match laissé à l'abandon) : plus
// bloquante.
// -> id de la room, ou null.
const ACTIVITE_MATCH_CLASSE_MS = 10 * 60 * 1000;
const ERREUR_MATCH_CLASSE = "Tu as un match classé en cours : termine-le d'abord.";

async function matchClasseEnCours(supabase, discordId, { sauf = null } = {}) {
  let requete = supabase
    .from("rooms")
    .select("room_id, player1_discord_id, player2_discord_id, draft, last_active_at, spectateurs")
    .eq("type", "classe")
    .not("player2_discord_id", "is", null)
    .or(`player1_discord_id.eq.${discordId},player2_discord_id.eq.${discordId}`);
  if (sauf) requete = requete.neq("room_id", sauf);
  const { data, error } = await requete;
  if (error) {
    console.error("Erreur lecture des matchs classés du joueur :", error);
    return null;
  }
  const limite = Date.now() - ACTIVITE_MATCH_CLASSE_MS;
  const active = room => Date.parse(room.last_active_at || 0) >= limite ||
    [room.player1_discord_id, room.player2_discord_id].some(id => Number(room.spectateurs?.[id] || 0) >= limite);
  const enCours = (data || []).find(room => {
    const draft = room.draft || {};
    return active(room) && !PHASES_FINIES.includes(draft.phase) && draft.phase !== "non_equilibrable" && !draft.quitte_par;
  });
  return enCours?.room_id || null;
}

async function annulerAutresMatchs(supabase, discordId, { sauf = null } = {}) {
  let requete = supabase
    .from("rooms")
    .select("room_id, player1_discord_id, player2_discord_id, type, draft")
    .or(`player1_discord_id.eq.${discordId},player2_discord_id.eq.${discordId}`)
    // Rooms d'équipe et Random world boss : cf. quitterEquipes
    // (_lib/equipe.js) et quitterWorldBoss (_lib/world_boss.js). Matchs de
    // tournoi : jamais annulés ainsi (relancés par un arbitre au besoin).
    .not("type", "in", "(equipe,world_boss,tournoi)");
  if (sauf) requete = requete.neq("room_id", sauf);
  // Chargés ici (equipe.js et world_boss.js utilisent aussi ce fichier).
  await require("./equipe").quitterEquipes(discordId, { sauf });
  await require("./world_boss").quitterWorldBoss(discordId, { sauf });
  const { data, error } = await requete;
  if (error) {
    console.error("Erreur lecture des matchs du joueur :", error);
    return;
  }

  for (const room of data || []) {
    if (!room.player2_discord_id) {
      await supabase.from("rooms").delete().eq("room_id", room.room_id).is("player2_discord_id", null);
      continue;
    }
    try {
      await quitterRoom(supabase, room, discordId);
    } catch (erreur) {
      console.error("Erreur annulation du match :", erreur);
    }
  }
}

// Une room complète quittée (cf. annulerAutresMatchs) ; room modifiée
// entre-temps par une autre requête : relue, jusqu'à 3 essais.
async function quitterRoom(supabase, room, discordId) {
  for (let essai = 0; essai < 3; essai++) {
    // Room complète pas encore ouverte : draft absente, ou partielle (créée
    // par le matchmaking avec ses seuls réglages, cf. _lib/matchmaking.js) ;
    // complétée comme dans assurerRolesDraft (sinon l'archivage d'un
    // abandon classé échoue : pas d'actions).
    const draft = { ...etatInitialDraft(), ...(room.draft || {}) };
    draft.discord_j1 ||= room.player1_discord_id;
    draft.discord_j2 ||= room.player2_discord_id;
    const role = determinerRole({ ...room, draft }, discordId);
    if (!role) return;
    if (draft.phase === "annule" || draft.quitte_par) return;

    let ecrite;
    if (PHASES_FINIES.includes(draft.phase)) {
      ecrite = await ecrireDraft(supabase, room.room_id, { ...draft, quitte_par: role, rejouer_j1: false, rejouer_j2: false });
    } else if (room.type === "classe" && draft.phase !== "non_equilibrable") {
      // Box non équilibrables (pas encore de match) : simple annulation.
      ecrite = await abandonnerMatchClasse(supabase, room.room_id, draft, role);
    } else {
      ecrite = await ecrireDraft(supabase, room.room_id, { ...draft, phase: "annule", annule_par: role });
    }
    if (ecrite) return;

    const { data } = await supabase
      .from("rooms")
      .select("room_id, player1_discord_id, player2_discord_id, type, draft")
      .eq("room_id", room.room_id)
      .maybeSingle();
    if (!data) return;
    room = data;
  }
  console.error("Match pas annulé (room modifiée en continu) :", room.room_id);
}

// ---- Profil complet avant de jouer ----
// Match privé (créé ou rejoint), matchmaking, classé, mode en équipe et
// inscription à un tournoi : tutoriel terminé (nouveaux comptes), box stuff,
// niveau du monde et UID renseignés dans Mon compte, et assez de persos
// montés pour le type de match. Pas exigé pour l'entraînement ni le Random
// world boss. Erreur 409 avec profil_incomplet: true (la page propose d'aller
// dans Mon compte).
function manquesProfil(data) {
  const manques = [];
  if (!Object.values(data?.characters?.selections?.stuff || {}).some(Boolean)) manques.push("ta box stuff");
  if (!data?.niveau_monde) manques.push("ton niveau du monde");
  if (!data?.uid) manques.push("ton UID");
  return manques;
}

// Persos montés (box stuff) exigés par palier de draft (mêmes valeurs :
// MIN_PERSOS_MONTES de commun/tutoriel.js).
const MIN_PERSOS_MONTES = { 1: 3, 2: 8, 3: 12, 4: 16 };
const NOMS_PALIERS = { 1: "Sardine", 2: "Carpe", 3: "Dauphin", 4: "Baleine" };
// Palier de draft d'un mode ("12" : mêlée, carnage : draft de la carpe, cf.
// resoudreTheatre). "auto" : celui de l'adversaire n'est pas encore connu,
// c'est celui du joueur qui compte.
const PALIERS_MODES = { sardine: 1, carpe: 2, dauphin: 3, baleine: 4, carnage: 2, 12: 2 };
const palierDuMatch = (mode, data) => PALIERS_MODES[mode] || Number(data?.theatre) || 1;

// Voyageur : un seul perso, quels que soient ses éléments.
function compterPersosMontes(data) {
  const montes = Object.entries(data?.characters?.selections?.stuff || {}).filter(([, coche]) => coche).map(([id]) => id);
  return new Set(montes.map(id => id.replace(/^traveler_.*/, "traveler"))).size;
}

// -> message d'erreur, ou null si le joueur peut lancer ce type de match
// (mode : mode de la draft).
async function erreurProfilIncomplet(supabase, discordId, { mode = null } = {}) {
  const { data } = await supabase.from("profiles").select("data, tutoriel_etape").eq("discord_id", discordId).maybeSingle();
  if (data?.tutoriel_etape != null) return "Avant de jouer, termine le tutoriel.";
  const manques = manquesProfil(data?.data);
  if (!manques.length) {
    const palier = palierDuMatch(mode, data?.data);
    const montes = compterPersosMontes(data?.data);
    if (montes >= MIN_PERSOS_MONTES[palier]) return null;
    return `Pour jouer en ${NOMS_PALIERS[palier]}, il faut au moins ${MIN_PERSOS_MONTES[palier]} persos montés dans ta box stuff (tu en as ${montes}).`;
  }
  const liste = manques.length > 1 ? `${manques.slice(0, -1).join(", ")} et ${manques[manques.length - 1]}` : manques[0];
  return `Avant de jouer, renseigne ${liste} dans Mon compte.`;
}

module.exports = {
  erreurProfilIncomplet,
  compterPersosMontes,
  palierDuMatch,
  ecrireDraft,
  ERREUR_MATCH_CLASSE,
  matchClasseEnCours,
  annulerAutresMatchs,
  quitterRoom,
  determinerRole,
  getAutreJoueur,
  getDiscordIdJoueur,
  assurerRolesDraft,
  chargerRoomAvecRole
};