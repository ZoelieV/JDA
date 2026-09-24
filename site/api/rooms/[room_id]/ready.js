const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole } = require("../../_lib/room");
const { getPersonnages } = require("../../_lib/personnages");
const { tirerBossAleatoire } = require("../../_lib/boss");
const {
  calculerPointsBox,
  calculerPoolDisponible,
  calculerBansBonus,
  demarrerDraftApresBonus
} = require("../../_lib/draft");

function getRoomIdFromUrl(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/");
  return parts[parts.length - 2]; // .../rooms/{room_id}/ready
}

// Une fois les 2 joueurs prêts : calcule les points, détermine les bans
// bonus, et démarre soit la phase "bans_bonus", soit directement la draft
// (boss tiré) s'il n'y a pas d'écart suffisant pour un bonus.
async function lancerEquilibrage(room, draft) {
  const [profilJ1, profilJ2] = await Promise.all([
    supabase.from("profiles").select("data").eq("discord_id", room.player1_discord_id).single(),
    supabase.from("profiles").select("data").eq("discord_id", room.player2_discord_id).single()
  ]);

  const personnages = getPersonnages();

  const pointsJ1 = calculerPointsBox(profilJ1.data?.data, draft.box_j1, personnages);
  const pointsJ2 = calculerPointsBox(profilJ2.data?.data, draft.box_j2, personnages);

  draft.points_j1 = pointsJ1;
  draft.points_j2 = pointsJ2;

  const ecart = pointsJ1 - pointsJ2;
  const bansBonus = calculerBansBonus(ecart);

  // Seuls les persos possédés par au moins un des 2 joueurs sont draftables.
  draft.pool_disponible = calculerPoolDisponible(
    profilJ1.data?.data,
    profilJ2.data?.data,
    personnages
  );

  if (bansBonus > 0) {
    draft.bans_bonus_total = bansBonus;
    draft.bans_bonus_faits = 0;
    draft.bans_bonus_joueur = ecart > 0 ? "j2" : "j1"; // box la plus FAIBLE
    draft.phase = "bans_bonus";
  } else {
    demarrerDraftApresBonus(draft, tirerBossAleatoire);
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

    const pret = req.body?.pret !== undefined ? !!req.body.pret : true;

    const roomId = getRoomIdFromUrl(req);
    const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
    const draft = room.draft;

    if (draft.phase !== "choix_box") {
      return res.status(409).json({ error: "Impossible de changer son statut prêt à ce stade" });
    }

    if (!draft[`box_${joueur}`]) {
      return res.status(400).json({ error: "Choisis d'abord ta box avant de te marquer prêt" });
    }

    draft[`pret_${joueur}`] = pret;

    if (draft.pret_j1 && draft.pret_j2) {
      await lancerEquilibrage(room, draft);
    }

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ draft })
      .eq("room_id", roomId);

    if (updateError) {
      console.error(updateError);
      return res.status(500).json({ error: "Erreur lors de la mise à jour du statut prêt" });
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