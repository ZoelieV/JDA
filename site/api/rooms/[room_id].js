const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");
const { TYPES_FILE } = require("../_lib/matchmaking");
const { annulerAutresMatchs } = require("../_lib/room");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const COLONNES = "room_id, player1_discord_id, player2_discord_id, type";
const { erreurModeAuto } = require("../_lib/draft");

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
    // n'est attribué que par api/_lib/matchmaking.js. Venu de l'historique
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

      // Entraînement : le premier joueur (autre que le lanceur) qui ouvre le
      // lien l'aide en prenant le côté "box adverse" ; les suivants
      // regardent.
      if (room.type === "entrainement") {
        if (enSpectateur) return res.status(200).json({ ...room, spectateur: true });
        const { data: complet } = await supabase.from("rooms").select("draft").eq("room_id", roomId).maybeSingle();
        const draft = complet?.draft;
        const e = draft?.entrainement;
        if (e && !e.aide && user.id !== e.lanceur) {
          const coteAdverse = e.cote_moi === "j1" ? "j2" : "j1";
          const nouveau = { ...draft, entrainement: { ...e, aide: user.id }, [`discord_${coteAdverse}`]: user.id };
          const { data: rejoint } = await supabase
            .from("rooms")
            .update({ draft: nouveau, player2_discord_id: user.id })
            .eq("room_id", roomId)
            .eq("player2_discord_id", e.lanceur)
            .select(COLONNES)
            .maybeSingle();
          if (rejoint) return res.status(200).json(rejoint);
        }
        return res.status(200).json({ ...room, spectateur: true });
      }

      // Room complète, matchmaking (normal ou classé) ou spectateur voulu :
      // lecture seule.
      if (room.player2_discord_id || TYPES_FILE.includes(room.type) || enSpectateur) {
        return res.status(200).json({ ...room, spectateur: true });
      }

      // Room en mode auto (classique) : théâtre renseigné obligatoire pour
      // devenir l'adversaire.
      const { data: complements } = await supabase.from("rooms").select("draft").eq("room_id", roomId).maybeSingle();
      const { data: profil } = await supabase.from("profiles").select("data").eq("discord_id", user.id).maybeSingle();
      const erreurMode = erreurModeAuto(complements?.draft?.mode_theatre || "auto", profil?.data);
      if (erreurMode) return res.status(409).json({ error: erreurMode });

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

      // Devenu adversaire : un seul match à la fois, ses autres matchs sont
      // annulés.
      if (updated) await annulerAutresMatchs(supabase, user.id, { sauf: roomId });

      return res.status(200).json(updated || { ...room, spectateur: true });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};