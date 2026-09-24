const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole } = require("../../_lib/room");
const { etatInitialDraft } = require("../../_lib/draft");

function getRoomIdFromUrl(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/");
  return parts[parts.length - 2]; // .../rooms/{room_id}/rejouer
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Méthode non autorisée" });
    }

    const cookies = parseCookies(req);
    const user = verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    const roomId = getRoomIdFromUrl(req);
    const { room } = await chargerRoomAvecRole(supabase, roomId, user.id);

    if (room.draft.phase !== "termine") {
      return res.status(409).json({ error: "La manche en cours n'est pas terminée" });
    }

    const draft = etatInitialDraft();

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ draft })
      .eq("room_id", roomId);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: "Erreur lors de la réinitialisation de la room" });
    }

    return res.status(200).json({ draft });
  } catch (error) {
    if (error && error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};