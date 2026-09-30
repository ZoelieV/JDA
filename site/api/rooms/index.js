const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");
const { chercher, annuler } = require("../_lib/matchmaking");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function genererRoomId() {
  return crypto.randomBytes(4).toString("hex"); // ex: "a1b2c3d4"
}

// POST {}                                   : match privé (nouvelle room)
// POST { type: "matchmaking", room_id? }    : matchmaking (cf. _lib/matchmaking.js)
// DELETE                                    : annule la recherche du matchmaking
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST" && req.method !== "DELETE") {
      res.setHeader("Allow", "POST, DELETE");
      return res.status(405).json({ error: "Méthode non autorisée" });
    }

    const cookies = parseCookies(req);
    const user = verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    if (req.method === "DELETE") {
      await annuler(user.id);
      return res.status(200).json({ ok: true });
    }

    if (req.body?.type === "matchmaking") {
      const roomIdAttente = typeof req.body.room_id === "string" ? req.body.room_id : null;
      return res.status(200).json(await chercher(user.id, roomIdAttente));
    }

    const roomId = genererRoomId();

    // Match privé : l'adversaire est le premier à ouvrir le lien partagé.
    const { error } = await supabase.from("rooms").insert({
      room_id: roomId,
      player1_discord_id: user.id,
      type: "prive"
    });

    if (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur création de la room" });
    }

    return res.status(200).json({ room_id: roomId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};
