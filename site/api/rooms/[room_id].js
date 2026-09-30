const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COLONNES = "room_id, player1_discord_id, player2_discord_id, type";

function getRoomIdFromUrl(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/");
  return parts[parts.length - 1];
}

// Marque la room comme "vivante" à chaque consultation/join : c'est ce
// timestamp que le nettoyage automatique (pg_cron) utilise pour repérer
// les rooms inactives depuis plus d'1h.
async function toucherActivite(roomId) {
  try {
    await supabase
      .from("rooms")
      .update({ last_active_at: new Date().toISOString() })
      .eq("room_id", roomId);
  } catch (error) {
    // Un heartbeat manqué n'est pas grave, on ne bloque jamais la requête pour ça
    console.error("Erreur mise à jour last_active_at :", error);
  }
}

module.exports = async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const user = verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    const roomId = getRoomIdFromUrl(req);
    await toucherActivite(roomId);

    // ---- Consultation de l'état actuel de la room ----
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("rooms")
        .select(COLONNES)
        .eq("room_id", roomId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Room introuvable" });
      }

      return res.status(200).json(data);
    }

    // ---- Rejoindre la room ----
    // Match privé : le créateur est player1, le premier à ouvrir le lien
    // player2, tous les suivants sont spectateurs. Matchmaking : player2
    // n'est attribué que par api/matchmaking.js. Venu de l'historique
    // (?spectateur=1) : toujours spectateur.
    if (req.method === "POST") {
      const { data: room, error: fetchError } = await supabase
        .from("rooms")
        .select(COLONNES)
        .eq("room_id", roomId)
        .single();

      if (fetchError || !room) {
        return res.status(404).json({ error: "Room introuvable" });
      }

      // Déjà player1 ou déjà player2 : on renvoie juste l'état actuel, rien à faire
      if (room.player1_discord_id === user.id || room.player2_discord_id === user.id) {
        return res.status(200).json(room);
      }

      const enSpectateur = new URL(req.url, `https://${req.headers.host}`).searchParams.get("spectateur") === "1";

      // Room complète, matchmaking ou spectateur voulu : lecture seule.
      if (room.player2_discord_id || room.type === "matchmaking" || enSpectateur) {
        return res.status(200).json({ ...room, spectateur: true });
      }

      // Mise à jour conditionnelle : si deux personnes ouvrent le lien en
      // même temps, une seule devient player2.
      const { data: updated, error: updateError } = await supabase
        .from("rooms")
        .update({ player2_discord_id: user.id })
        .eq("room_id", roomId)
        .is("player2_discord_id", null)
        .select(COLONNES)
        .maybeSingle();

      if (updateError) {
        console.error(updateError);
        return res.status(500).json({ error: "Erreur en rejoignant la room" });
      }

      return res.status(200).json(updated || { ...room, spectateur: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};