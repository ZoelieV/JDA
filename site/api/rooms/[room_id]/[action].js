// Fusion de 8 routes (box, ready, action, bonus_toggle, bonus_confirmer,
// temps, rejouer, draft) en un seul fichier, pour rester sous la limite de
// fonctions serverless du plan Hobby de Vercel. Le nom de fichier dynamique
// [action].js capte tous les segments d'URL /api/rooms/{room_id}/{quoi que
// ce soit} qui ne correspondent à aucun autre fichier plus spécifique dans
// ce dossier — les URLs appelées côté front ne changent donc pas.
const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole, getAutreJoueur } = require("../../_lib/room");
const { getPersonnages, getPersonnageParId } = require("../../_lib/personnages");
const { tirerBossAleatoire } = require("../../_lib/boss");
const { parserTempsMMSS } = require("../../_lib/temps");
const {
  SEQUENCE_FIXE,
  calculerPointsBox,
  calculerPoolJoueur,
  calculerPoolDisponible,
  calculerBansBonus,
  lancerTirage,
  etatRevanche,
  vuePourJoueur,
  getProchaineAction,
  getEquipeJoueur
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

// Réponse standard des routes : la draft vue par ce joueur (box adverse
// masquée pendant le choix des box).
function repondreDraft(res, draft, joueur) {
  return res.status(200).json({ draft: vuePourJoueur(draft, joueur) });
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
  return repondreDraft(res, draft, joueur);
}

// ---- ready ----
// Fin du choix des box : points, pools et nombre de bans d'équilibrage.
// Les places j1/j2 sont encore provisoires ici (le tirage vient après).
async function calculerEquilibrage(draft) {
  // Les rôles j1/j2 (donc les comptes concernés) sont ceux de LA MANCHE en
  // cours, tirés au sort ou échangés à la revanche — pas forcément
  // room.player1_discord_id/player2_discord_id.
  const [profilJ1, profilJ2] = await Promise.all([
    supabase.from("profiles").select("data").eq("discord_id", draft.discord_j1).single(),
    supabase.from("profiles").select("data").eq("discord_id", draft.discord_j2).single()
  ]);

  const personnages = getPersonnages();

  const pointsJ1 = calculerPointsBox(profilJ1.data?.data, draft.box_j1, personnages);
  const pointsJ2 = calculerPointsBox(profilJ2.data?.data, draft.box_j2, personnages);

  draft.points_j1 = pointsJ1;
  draft.points_j2 = pointsJ2;

  const ecart = pointsJ1 - pointsJ2;
  const bansBonus = calculerBansBonus(ecart);

  const poolJ1 = calculerPoolJoueur(profilJ1.data?.data, personnages);
  const poolJ2 = calculerPoolJoueur(profilJ2.data?.data, personnages);

  draft.pool_j1 = poolJ1;
  draft.pool_j2 = poolJ2;
  draft.pool_disponible = calculerPoolDisponible(poolJ1, poolJ2);

  draft.bans_bonus_total = bansBonus;
  draft.bans_bonus_faits = 0;
  draft.bans_bonus_choix = [];
  draft.bans_bonus_joueur = bansBonus > 0 ? (ecart > 0 ? "j2" : "j1") : null;
}

async function handleReady(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const pret = req.body?.pret !== undefined ? !!req.body.pret : true;

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
  const draft = room.draft;

  // Même ready-check pour 2 phases : validation de la box (choix_box), puis
  // fin du temps d'analyse des box (analyse).
  if (draft.phase !== "choix_box" && draft.phase !== "analyse") {
    return res.status(409).json({ error: "Impossible de changer son statut prêt à ce stade" });
  }

  if (draft.phase === "choix_box" && !draft[`box_${joueur}`]) {
    return res.status(400).json({ error: "Choisis d'abord ta box avant de te marquer prêt" });
  }

  draft[`pret_${joueur}`] = pret;

  if (draft.pret_j1 && draft.pret_j2) {
    draft.pret_j1 = false;
    draft.pret_j2 = false;

    if (draft.phase === "choix_box") {
      await calculerEquilibrage(draft);
      draft.phase = "analyse";
    } else if ((draft.bans_bonus_faits || 0) < (draft.bans_bonus_total || 0)) {
      draft.phase = "bans_bonus";
    } else {
      // Pas de ban d'équilibrage dû, ou déjà faits (revanche).
      lancerTirage(draft, tirerBossAleatoire);
    }
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- action (ban/pick de la séquence fixe) ----
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

  if (draft.phase !== "draft") {
    return res.status(409).json({ error: "Ce n'est pas le moment de bannir/picker" });
  }

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

  // On ne peut PICKER que ses propres personnages (possédés dans sa Full
  // box) — même si le pool affiché est la fusion des 2 box. Les bans, eux,
  // restent globaux et sans restriction de possession.
  if (prochaine.type === "pick") {
    const poolJoueur = joueur === "j1" ? draft.pool_j1 : draft.pool_j2;
    if (!poolJoueur || !poolJoueur.includes(persoId)) {
      return res.status(403).json({ error: "Tu ne possèdes pas ce personnage : impossible de le picker" });
    }
  }

  draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
  draft.actions.push({
    joueur,
    type: prochaine.type,
    perso_id: persoId,
    bonus: false
  });

  draft.sequence_index += 1;

  if (draft.sequence_index >= SEQUENCE_FIXE.length) {
    draft.phase = "temps";
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- bonus_toggle (bans d'équilibrage : sélection/désélection avant confirmation) ----
async function handleBonusToggle(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { perso_id: persoId } = req.body || {};

  if (!persoId || typeof persoId !== "string") {
    return res.status(400).json({ error: "perso_id manquant" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
  const draft = room.draft;

  if (draft.phase !== "bans_bonus") {
    return res.status(409).json({ error: "Aucun ban d'équilibrage à faire à ce stade" });
  }

  if (draft.bans_bonus_joueur !== joueur) {
    return res.status(403).json({ error: "Ce n'est pas à toi de choisir les bans d'équilibrage" });
  }

  draft.bans_bonus_choix = draft.bans_bonus_choix || [];
  const index = draft.bans_bonus_choix.indexOf(persoId);

  if (index >= 0) {
    // Déjà sélectionné : on le retire (annulation/remplacement).
    draft.bans_bonus_choix.splice(index, 1);
  } else {
    if (!draft.pool_disponible.includes(persoId)) {
      return res.status(409).json({ error: "Ce personnage n'est plus disponible" });
    }
    if (draft.bans_bonus_choix.length >= draft.bans_bonus_total) {
      return res.status(409).json({ error: `Tu as déjà sélectionné tes ${draft.bans_bonus_total} ban(s) bonus` });
    }
    draft.bans_bonus_choix.push(persoId);
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- bonus_confirmer (verrouille les bans d'équilibrage choisis, tire le boss) ----
async function handleBonusConfirmer(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
  const draft = room.draft;

  if (draft.phase !== "bans_bonus") {
    return res.status(409).json({ error: "Aucun ban d'équilibrage à confirmer à ce stade" });
  }

  if (draft.bans_bonus_joueur !== joueur) {
    return res.status(403).json({ error: "Ce n'est pas à toi de confirmer les bans d'équilibrage" });
  }

  const choix = draft.bans_bonus_choix || [];

  if (choix.length !== draft.bans_bonus_total) {
    return res.status(409).json({ error: `Sélectionne exactement ${draft.bans_bonus_total} personnage(s) avant de confirmer` });
  }

  choix.forEach(persoId => {
    draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
    draft.actions.push({ joueur, type: "ban", perso_id: persoId, bonus: true });
  });

  draft.bans_bonus_faits = choix.length;
  draft.bans_bonus_choix = [];

  lancerTirage(draft, tirerBossAleatoire);

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- temps ----
function determinerVainqueur(tempsJ1, tempsJ2) {
  if (tempsJ1.secondes === tempsJ2.secondes) return "egalite";
  return tempsJ1.secondes < tempsJ2.secondes ? "j1" : "j2";
}

async function archiverMatch(draft) {
  const { error } = await supabase.from("match_history").insert({
    boss_id: draft.boss_id,
    player1_discord_id: draft.discord_j1,
    player2_discord_id: draft.discord_j2,
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
    await archiverMatch(draft);
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- rejouer (ready-check : il faut les 2 joueurs "ok" pour relancer) ----
async function handleRejouer(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const veutRejouer = req.body?.rejouer !== undefined ? !!req.body.rejouer : true;

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
  const draft = room.draft;

  if (draft.phase !== "termine") {
    return res.status(409).json({ error: "La manche en cours n'est pas terminée" });
  }

  draft[`rejouer_${joueur}`] = veutRejouer;

  if (draft.rejouer_j1 && draft.rejouer_j2) {
    // Mêmes box et bans d'équilibrage, rôles inversés (le 1er pick ne reste
    // pas du même côté), retour direct à l'analyse ; boss différent du
    // précédent au prochain tirage.
    const nouveau = etatRevanche(draft);

    await sauvegarderDraft(roomId, nouveau);
    return repondreDraft(res, nouveau, getAutreJoueur(joueur));
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- draft (lecture seule) ----
async function handleDraftGet(req, res, roomId, user) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);

  return res.status(200).json({
    room_id: room.room_id,
    player1_discord_id: room.player1_discord_id,
    player2_discord_id: room.player2_discord_id,
    draft: vuePourJoueur(room.draft, joueur)
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
      case "bonus_toggle":
        return await handleBonusToggle(req, res, roomId, user);
      case "bonus_confirmer":
        return await handleBonusConfirmer(req, res, roomId, user);
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