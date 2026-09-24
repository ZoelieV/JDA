const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole } = require("../../_lib/room");
const { getPersonnageParId } = require("../../_lib/personnages");
const { tirerBossAleatoire } = require("../../_lib/boss");
const {
  SEQUENCE_FIXE,
  getProchaineAction,
  demarrerDraftApresBonus
} = require("../../_lib/draft");

function getRoomIdFromUrl(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/");
  return parts[parts.length - 2]; // .../rooms/{room_id}/action
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

    const { perso_id: persoId } = req.body || {};

    if (!persoId || typeof persoId !== "string") {
      return res.status(400).json({ error: "perso_id manquant" });
    }

    if (!getPersonnageParId(persoId)) {
      return res.status(400).json({ error: "Personnage inconnu" });
    }

    const roomId = getRoomIdFromUrl(req);
    const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
    const draft = room.draft;

    const prochaine = getProchaineAction(draft);

    if (!prochaine) {
      return res.status(409).json({ error: "Aucune action attendue à ce stade" });
    }

    if (prochaine.joueur !== joueur) {
      return res.status(403).json({ error: "Ce n'est pas ton tour" });
    }

    if (!draft.pool_disponible.includes(persoId)) {
      return res.status(409).json({ error: "Ce personnage n'est plus disponible" });
    }

    // Retire le perso du pool commun (ban ou pick, dans les 2 cas il
    // devient indisponible pour les 2 joueurs) et journalise l'action.
    draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
    draft.actions.push({
      joueur,
      type: prochaine.type,
      perso_id: persoId,
      bonus: prochaine.bonus
    });

    if (prochaine.bonus) {
      draft.bans_bonus_faits += 1;

      if (draft.bans_bonus_faits >= draft.bans_bonus_total) {
        demarrerDraftApresBonus(draft, tirerBossAleatoire);
      }
    } else {
      draft.sequence_index += 1;

      if (draft.sequence_index >= SEQUENCE_FIXE.length) {
        draft.phase = "temps";
      }
    }

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ draft })
      .eq("room_id", roomId);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: "Erreur lors de l'enregistrement de l'action" });
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