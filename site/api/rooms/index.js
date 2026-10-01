const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");
const { TYPES_FILE, chercher, annuler } = require("../_lib/matchmaking");
const { annulerAutresMatchs } = require("../_lib/room");
const { verifierFrequence } = require("../_lib/limites");

// Match privé : une création par minute et par adresse IP au plus.
const DELAI_ROOM_PRIVEE_MS = 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function genererRoomId() {
  return crypto.randomBytes(4).toString("hex"); // ex: "a1b2c3d4"
}

// POST {}                                   : match privé (nouvelle room ;
//                                             1 par minute et par IP, la
//                                             précédente est supprimée)
// Démarrer un match (privé ou matchmaking) annule le match en cours du
// joueur (un seul match à la fois, cf. annulerAutresMatchs).
// POST { type: "matchmaking" | "classe", room_id? } : matchmaking normal ou
//                                             classé (cf. _lib/matchmaking.js)
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

    if (TYPES_FILE.includes(req.body?.type)) {
      const roomIdAttente = typeof req.body.room_id === "string" ? req.body.room_id : null;
      return res.status(200).json(await chercher(user.id, roomIdAttente, req.body.type));
    }

    const attente = await verifierFrequence(req, "room_privee", DELAI_ROOM_PRIVEE_MS);
    if (attente > 0) {
      const secondes = Math.ceil(attente / 1000);
      res.setHeader("Retry-After", String(secondes));
      return res.status(429).json({ error: `Une room privée par minute au maximum : réessaie dans ${secondes} s.`, attente: secondes });
    }

    // Ancienne room en attente supprimée, match en cours annulé.
    await annulerAutresMatchs(supabase, user.id);

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
