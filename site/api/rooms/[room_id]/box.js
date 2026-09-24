const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole } = require("../../_lib/room");

const BOX_AUTORISEES = new Set([
  "full",
  "stuff",
  "opti1",
  "opti2",
  "opti3",
  "opti4",
  "opti5"
]);

function getRoomIdFromUrl(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/");
  return parts[parts.length - 2]; // .../rooms/{room_id}/box
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

    const { box } = req.body || {};

    if (!BOX_AUTORISEES.has(box)) {
      return res.status(400).json({ error: "Box invalide" });
    }

    const roomId = getRoomIdFromUrl(req);
    const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
    const draft = room.draft;

    if (draft.phase !== "choix_box") {
      return res.status(409).json({ error: "Le choix de box n'est plus possible à ce stade" });
    }

    draft[`box_${joueur}`] = box;
    // Changer de box invalide le statut "prêt" précédent : il faut se
    // remarquer prêt pour confirmer la nouvelle box.
    draft[`pret_${joueur}`] = false;

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ draft })
      .eq("room_id", roomId);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: "Erreur lors de la mise à jour de la box" });
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