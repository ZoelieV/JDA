// Détermine si l'utilisateur connecté est j1, j2, ou ni l'un ni l'autre
// pour une room donnée. j1/j2 sont les rôles DE LA MANCHE EN COURS
// (draft.discord_j1 / draft.discord_j2, tirés au sort puis échangés à
// chaque revanche — cf. assurerRolesDraft et handleRejouer), pas
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

// Tire au sort, une seule fois par manche, qui est j1 (1er pick) et qui
// est j2. Idempotent : ne fait rien si déjà assigné (revanche y compris,
// où handleRejouer positionne directement discord_j1/discord_j2 en les
// échangeant, sans repasser par un tirage aléatoire).
async function assurerRolesDraft(supabase, room) {
  if (room.draft && room.draft.discord_j1 && room.draft.discord_j2) {
    return room;
  }

  const inverser = Math.random() < 0.5;
  const draft = { ...(room.draft || {}) };
  draft.discord_j1 = inverser ? room.player2_discord_id : room.player1_discord_id;
  draft.discord_j2 = inverser ? room.player1_discord_id : room.player2_discord_id;

  const { error } = await supabase.from("rooms").update({ draft }).eq("room_id", room.room_id);

  if (!error) {
    room = { ...room, draft };
  }

  return room;
}

// Charge la room (avec sa draft) et vérifie que l'utilisateur en fait
// partie. Retourne { room, joueur } ou lève une erreur { status, message }
// à catcher dans la route pour répondre directement au client.
async function chargerRoomAvecRole(supabase, roomId, discordId) {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("room_id, player1_discord_id, player2_discord_id, draft")
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

  if (!joueur) {
    throw { status: 403, message: "Tu ne fais pas partie de cette room" };
  }

  return { room: roomAvecRoles, joueur };
}

module.exports = {
  determinerRole,
  getAutreJoueur,
  getDiscordIdJoueur,
  assurerRolesDraft,
  chargerRoomAvecRole
};