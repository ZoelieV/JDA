const { etatInitialDraft } = require("./draft");

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

  const { error } = await supabase.from("rooms").update({ draft }).eq("room_id", room.room_id);

  if (!error) {
    room = { ...room, draft };
  }

  return room;
}

// Charge la room (avec sa draft) et vérifie que l'utilisateur en fait
// partie. Retourne { room, joueur } ou lève une erreur { status, message }
// à catcher dans la route pour répondre directement au client.
// autoriserSpectateur : lecture seule ouverte à tous (joueur = null pour
// quelqu'un qui n'est ni j1 ni j2).
async function chargerRoomAvecRole(supabase, roomId, discordId, { autoriserSpectateur = false } = {}) {
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
  const joueur = determinerRole(roomAvecRoles, discordId);

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
//   rien dans l'historique ;
// - manche terminée (termine / litige) : résultat gardé, revanche
//   impossible (quitte_par = son rôle).
// sauf : room à garder (celle qu'il rejoint ou sa room d'attente).
const PHASES_FINIES = ["termine", "litige", "annule"];

async function annulerAutresMatchs(supabase, discordId, { sauf = null } = {}) {
  let requete = supabase
    .from("rooms")
    .select("room_id, player1_discord_id, player2_discord_id, draft")
    .or(`player1_discord_id.eq.${discordId},player2_discord_id.eq.${discordId}`);
  if (sauf) requete = requete.neq("room_id", sauf);
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
    // Room complète pas encore ouverte (draft pas encore créée).
    const draft = room.draft || { ...etatInitialDraft(), discord_j1: room.player1_discord_id, discord_j2: room.player2_discord_id };
    const role = determinerRole({ ...room, draft }, discordId);
    if (!role) continue;
    if (draft.phase === "annule" || draft.quitte_par) continue;

    const nouveau = PHASES_FINIES.includes(draft.phase)
      ? { ...draft, quitte_par: role, rejouer_j1: false, rejouer_j2: false }
      : { ...draft, phase: "annule", annule_par: role };
    const { error: erreurMaj } = await supabase.from("rooms").update({ draft: nouveau }).eq("room_id", room.room_id);
    if (erreurMaj) console.error("Erreur annulation du match :", erreurMaj);
  }
}

module.exports = {
  annulerAutresMatchs,
  determinerRole,
  getAutreJoueur,
  getDiscordIdJoueur,
  assurerRolesDraft,
  chargerRoomAvecRole
};