// Détermine si l'utilisateur connecté est j1, j2, ou ni l'un ni l'autre
// pour une room donnée.
function determinerRole(room, discordId) {
  if (room.player1_discord_id === discordId) return "j1";
  if (room.player2_discord_id === discordId) return "j2";
  return null;
}

function getAutreJoueur(joueur) {
  return joueur === "j1" ? "j2" : "j1";
}

function getDiscordIdJoueur(room, joueur) {
  return joueur === "j1" ? room.player1_discord_id : room.player2_discord_id;
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

  const joueur = determinerRole(room, discordId);

  if (!joueur) {
    throw { status: 403, message: "Tu ne fais pas partie de cette room" };
  }

  if (!room.player1_discord_id || !room.player2_discord_id) {
    throw { status: 400, message: "La room n'est pas encore complète (2 joueurs requis)" };
  }

  return { room, joueur };
}

module.exports = {
  determinerRole,
  getAutreJoueur,
  getDiscordIdJoueur,
  chargerRoomAvecRole
};