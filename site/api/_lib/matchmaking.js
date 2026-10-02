// Matchmaking : met automatiquement face à face deux joueurs qui cliquent
// sur "Matchmaking" ou sur "Classé" (page Créer un match).
//
// Files séparées (un joueur en matchmaking normal ne tombe jamais sur un
// joueur en classé, ni un joueur en mode classique sur un joueur en mêlée
// générale) : rooms de type "matchmaking" ou "classe" sans player2
// (colonnes type et created_at, cf. sql/rooms_matchmaking.sql), mode de
// théâtre dans draft.mode_theatre ("auto" = classique, "12" = mêlée). Une
// room "classe" le reste pour les revanches ; ses matchs rapportent des
// trophées (cf. _lib/trophees.js). Le premier joueur crée sa
// room et attend dessus ; le suivant prend la plus ancienne room en attente
// (mise à jour conditionnelle "player2 encore vide" : deux joueurs ne
// peuvent pas prendre la même). Une room en attente reste vivante tant que
// sa page tourne (last_active_at, mis à jour par le polling de match.js).
//
// Appelé par api/rooms/index.js (pas de fonction serveur à part : le plan
// Hobby de Vercel en limite le nombre à 12) :
// POST   { type: "matchmaking" | "classe", room_id? } -> chercher() : cherche un
//        adversaire. room_id = room en attente du joueur (page d'attente,
//        rappel toutes les quelques secondes). Si deux joueurs ont créé leur
//        room en même temps, celui dont la room est la plus récente prend
//        l'autre : la sienne est supprimée. -> { room_id, trouve }
// DELETE -> annuler() : supprime les rooms en attente du joueur (2 files).
const crypto = require("crypto");
const { supabase } = require("./supabase");
const { annulerAutresMatchs } = require("./room");

// Room en attente sans nouvelles de sa page depuis plus longtemps : joueur
// parti, ignorée.
const ATTENTE_VIVANTE_MS = 20 * 1000;
const COLONNES = "room_id, player1_discord_id, player2_discord_id, created_at, draft";
// Types de room du matchmaking (une file chacun).
const TYPES_FILE = ["matchmaking", "classe"];

function genererRoomId() {
  return crypto.randomBytes(4).toString("hex");
}

async function mesRoomsEnAttente(discordId, types) {
  const { data, error } = await supabase
    .from("rooms")
    .select(COLONNES)
    .in("type", types)
    .eq("player1_discord_id", discordId)
    .is("player2_discord_id", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function supprimerRooms(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from("rooms").delete().in("room_id", ids).is("player2_discord_id", null);
  if (error) console.error("Erreur suppression rooms en attente :", error);
}

// Prend la room si elle attend encore un adversaire ; null sinon.
async function prendreRoom(roomId, discordId) {
  const { data, error } = await supabase
    .from("rooms")
    .update({ player2_discord_id: discordId, last_active_at: new Date().toISOString() })
    .eq("room_id", roomId)
    .is("player2_discord_id", null)
    .select(COLONNES)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function chercher(discordId, roomIdAttente, type = "matchmaking", mode = "auto") {
  // Début d'une recherche (pas un rappel de la page d'attente) : un seul
  // match à la fois, le match en cours du joueur est annulé.
  if (!roomIdAttente) await annulerAutresMatchs(supabase, discordId);

  // Room d'attente déjà prise par un adversaire : match trouvé.
  if (roomIdAttente) {
    const { data: room } = await supabase
      .from("rooms")
      .select(COLONNES)
      .eq("room_id", roomIdAttente)
      .maybeSingle();
    if (room?.player1_discord_id === discordId && room.player2_discord_id) {
      return { room_id: room.room_id, trouve: true };
    }
    // Rappel de la page d'attente : même mode que la room d'attente.
    if (room?.draft?.mode_theatre) mode = room.draft.mode_theatre;
  }

  // Attente dans l'autre file abandonnée : une seule recherche à la fois.
  await supprimerRooms((await mesRoomsEnAttente(discordId, TYPES_FILE.filter(t => t !== type))).map(r => r.room_id));

  const miennes = await mesRoomsEnAttente(discordId, [type]);
  const maRoom = miennes[0] || null;

  // Rooms des autres, les plus anciennes d'abord (plus anciennes que la
  // mienne seulement, pour que deux joueurs en attente ne se prennent pas
  // chacun la room de l'autre).
  let requete = supabase
    .from("rooms")
    .select(COLONNES)
    .eq("type", type)
    .eq("draft->>mode_theatre", mode)
    .is("player2_discord_id", null)
    .neq("player1_discord_id", discordId)
    .gte("last_active_at", new Date(Date.now() - ATTENTE_VIVANTE_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(5);
  if (maRoom) requete = requete.lt("created_at", maRoom.created_at);
  const { data: candidates, error } = await requete;
  if (error) throw error;

  for (const candidate of candidates || []) {
    const prise = await prendreRoom(candidate.room_id, discordId);
    if (prise) {
      await supprimerRooms(miennes.map(r => r.room_id));
      return { room_id: prise.room_id, trouve: true };
    }
  }

  // Personne : on attend sur sa room (une seule).
  if (maRoom) {
    await supprimerRooms(miennes.slice(1).map(r => r.room_id));
    await supabase.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("room_id", maRoom.room_id);
    return { room_id: maRoom.room_id, trouve: false };
  }

  const roomId = genererRoomId();
  const { error: erreurCreation } = await supabase.from("rooms").insert({
    room_id: roomId,
    player1_discord_id: discordId,
    type,
    // Classé : draft chronométrée (cf. _lib/chronos.js).
    draft: { mode_theatre: mode, chronometre: type === "classe" },
    last_active_at: new Date().toISOString()
  });
  if (erreurCreation) throw erreurCreation;
  return { room_id: roomId, trouve: false };
}

async function annuler(discordId) {
  const miennes = await mesRoomsEnAttente(discordId, TYPES_FILE);
  await supprimerRooms(miennes.map(r => r.room_id));
}

module.exports = { TYPES_FILE, chercher, annuler };
