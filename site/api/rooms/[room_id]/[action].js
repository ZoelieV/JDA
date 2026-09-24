// Fusion de 6 routes (box, ready, action, temps, rejouer, draft) en un
// seul fichier, pour rester sous la limite de fonctions serverless du
// plan Hobby de Vercel. Le nom de fichier dynamique [action].js capte
// tous les segments d'URL /api/rooms/{room_id}/{quoi que ce soit} qui ne
// correspondent à aucun autre fichier plus spécifique dans ce dossier —
// les URLs appelées côté front ne changent donc pas.
const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole } = require("../../_lib/room");
const { getPersonnages, getPersonnageParId } = require("../../_lib/personnages");
const { tirerBossAleatoire } = require("../../_lib/boss");
const { parserTempsMMSS } = require("../../_lib/temps");
const {
  SEQUENCE_FIXE,
  calculerPointsBox,
  calculerPoolDisponible,
  calculerBansBonus,
  demarrerDraftApresBonus,
  getProchaineAction,
  getEquipeJoueur,
  etatInitialDraft
} = require("../../_lib/draft");

const BOX_AUTORISEES = new Set([
  "full", "stuff", "opti1", "opti2", "opti3", "opti4", "opti5"
]);

function getSegments(req) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean); // ["api","rooms","{room_id}","{action}"]
  return {
    roomId: parts[parts.length - 2],
    action: parts[parts.length - 1]
  };
}

async function sauvegarderDraft(roomId, draft) {
  const { error } = await supabase.from("rooms").update({ draft }).eq("room_id", roomId);
  if (error) {
    console.error(error);
    throw { status: 500, message: "Erreur lors de la mise à jour de la room" };
  }
}

// ---- box ----
async function handleBox(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { box } = req.body || {};
  if (!BOX_AUTORISEES.has(box)) {
    return res.status(400).json({ error: "Box invalide" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
  const draft = room.draft;

  if (draft.phase !== "choix_box") {
    return res.status(409).json({ error: "Le choix de box n'est plus possible à ce stade" });
  }

  draft[`box_${joueur}`] = box;
  draft[`pret_${joueur}`] = false;

  await sauvegarderDraft(roomId, draft);
  return res.status(200).json({ draft });
}

// ---- ready ----
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

  draft.pool_disponible = calculerPoolDisponible(
    profilJ1.data?.data,
    profilJ2.data?.data,
    personnages
  );

  if (bansBonus > 0) {
    draft.bans_bonus_total = bansBonus;
    draft.bans_bonus_faits = 0;
    draft.bans_bonus_joueur = ecart > 0 ? "j2" : "j1";
    draft.phase = "bans_bonus";
  } else {
    demarrerDraftApresBonus(draft, tirerBossAleatoire);
  }
}

async function handleReady(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const pret = req.body?.pret !== undefined ? !!req.body.pret : true;

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

  await sauvegarderDraft(roomId, draft);
  return res.status(200).json({ draft });
}

// ---- action (ban/pick) ----
async function handleAction(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { perso_id: persoId } = req.body || {};

  if (!persoId || typeof persoId !== "string") {
    return res.status(400).json({ error: "perso_id manquant" });
  }

  if (!getPersonnageParId(persoId)) {
    return res.status(400).json({ error: "Personnage inconnu" });
  }

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

  await sauvegarderDraft(roomId, draft);
  return res.status(200).json({ draft });
}

// ---- temps ----
function determinerVainqueur(tempsJ1, tempsJ2) {
  if (tempsJ1.secondes === tempsJ2.secondes) return "egalite";
  return tempsJ1.secondes < tempsJ2.secondes ? "j1" : "j2";
}

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
    console.error("Erreur archivage match_history :", error);
  }
}

async function handleTemps(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const tempsParsed = parserTempsMMSS(req.body?.temps);

  if (!tempsParsed) {
    return res.status(400).json({ error: "Format de temps invalide (attendu mm:ss)" });
  }

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

  await sauvegarderDraft(roomId, draft);
  return res.status(200).json({ draft });
}

// ---- rejouer ----
async function handleRejouer(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room } = await chargerRoomAvecRole(supabase, roomId, user.id);

  if (room.draft.phase !== "termine") {
    return res.status(409).json({ error: "La manche en cours n'est pas terminée" });
  }

  const draft = etatInitialDraft();
  await sauvegarderDraft(roomId, draft);
  return res.status(200).json({ draft });
}

// ---- draft (lecture seule) ----
async function handleDraftGet(req, res, roomId, user) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room } = await chargerRoomAvecRole(supabase, roomId, user.id);

  return res.status(200).json({
    room_id: room.room_id,
    player1_discord_id: room.player1_discord_id,
    player2_discord_id: room.player2_discord_id,
    draft: room.draft
  });
}

// ---- dispatch ----
module.exports = async (req, res) => {
  try {
    const cookies = parseCookies(req);
    const user = verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    const { roomId, action } = getSegments(req);

    switch (action) {
      case "box":
        return await handleBox(req, res, roomId, user);
      case "ready":
        return await handleReady(req, res, roomId, user);
      case "action":
        return await handleAction(req, res, roomId, user);
      case "temps":
        return await handleTemps(req, res, roomId, user);
      case "rejouer":
        return await handleRejouer(req, res, roomId, user);
      case "draft":
        return await handleDraftGet(req, res, roomId, user);
      default:
        return res.status(404).json({ error: "Route inconnue" });
    }
  } catch (error) {
    if (error && error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error(error);
    return res.status(500).json({ error: "Erreur serveur" });
  }
};