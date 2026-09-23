const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getRoomIdFromUrl(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/");
  return parts[parts.length - 1];
}

module.exports = async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const user = verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    const roomId = getRoomIdFromUrl(req);

    // ---- Consultation de l'état actuel de la room ----
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("rooms")
        .select("room_id, player1_discord_id, player2_discord_id")
        .eq("room_id", roomId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: "Room introuvable" });
      }

      return res.status(200).json(data);
    }

    // ---- Rejoindre la room en tant que player2 ----
    if (req.method === "POST") {
      const { data: room, error: fetchError } = await supabase
        .from("rooms")
        .select("room_id, player1_discord_id, player2_discord_id")
        .eq("room_id", roomId)
        .single();

      if (fetchError || !room) {
        return res.status(404).json({ error: "Room introuvable" });
      }

      // Déjà player1 ou déjà player2 : on renvoie juste l'état actuel, rien à faire
      if (room.player1_discord_id === user.id || room.player2_discord_id === user.id) {
        return res.status(200).json(room);
      }

      // La place de player2 est déjà prise par quelqu'un d'autre
      if (room.player2_discord_id) {
        return res.status(403).json({ error: "Room déjà complète" });
      }

      const { data: updated, error: updateError } = await supabase
        .from("rooms")
        .update({ player2_discord_id: user.id })
        .eq("room_id", roomId)
        .select("room_id, player1_discord_id, player2_discord_id")
        .single();

      if (updateError) {
        console.error(updateError);
        return res.status(500).json({ error: "Erreur en rejoignant la room" });
      }

      return res.status(200).json(updated);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};