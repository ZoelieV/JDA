const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole } = require("../../_lib/room");
const { parserTempsMMSS } = require("../../_lib/temps");
const { getEquipeJoueur } = require("../../_lib/draft");

function getRoomIdFromUrl(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/");
  return parts[parts.length - 2]; // .../rooms/{room_id}/temps
}

function determinerVainqueur(tempsJ1, tempsJ2) {
  if (tempsJ1.secondes === tempsJ2.secondes) return "egalite";
  return tempsJ1.secondes < tempsJ2.secondes ? "j1" : "j2";
}

// Archive la manche terminée dans match_history, indépendamment du cycle
// de vie de la room (qui peut être supprimée après 1h d'inactivité, ou
// remise à zéro par "Rejouer").
async function archiverMatch(room, draft) {
  const { error } = await supabase.from("match_history").insert({
    boss_id: draft.boss_id,
    player1_discord_id: room.player1_discord_id,
    player2_discord_id: room.player2_discord_id,
    box_j1: draft.box_j1,
    box_j2: draft.box_j2,
    team_j1: getEquipeJoueur(draft, "j1"),
    team_j2: getEquipeJoueur(draft, "j2"),
    temps_j1_affiche: draft.temps_j1.affiche,
    temps_j1_secondes: draft.temps_j1.secondes,
    temps_j2_affiche: draft.temps_j2.affiche,
    temps_j2_secondes: draft.temps_j2.secondes,
    vainqueur: draft.vainqueur
  });

  if (error) {
    // On ne bloque pas la réponse pour ça : le résultat reste affichable
    // aux joueurs même si l'archivage échoue, mais on log pour investiguer.
    console.error("Erreur archivage match_history :", error);
  }
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

    const tempsParsed = parserTempsMMSS(req.body?.temps);

    if (!tempsParsed) {
      return res.status(400).json({ error: "Format de temps invalide (attendu mm:ss)" });
    }

    const roomId = getRoomIdFromUrl(req);
    const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
    const draft = room.draft;

    if (draft.phase !== "temps") {
      return res.status(409).json({ error: "La saisie du temps n'est pas encore ouverte" });
    }

    draft[`temps_${joueur}`] = tempsParsed;

    if (draft.temps_j1 && draft.temps_j2) {
      draft.vainqueur = determinerVainqueur(draft.temps_j1, draft.temps_j2);
      draft.phase = "termine";
      await archiverMatch(room, draft);
    }

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ draft })
      .eq("room_id", roomId);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: "Erreur lors de l'enregistrement du temps" });
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