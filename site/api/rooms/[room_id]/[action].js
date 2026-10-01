// Fusion de 10 routes (box, ready, action, bonus_toggle, bonus_confirmer,
// temps, confirmer_temps, litige, rejouer, draft) en un seul fichier, pour rester sous la limite de
// fonctions serverless du plan Hobby de Vercel. Le nom de fichier dynamique
// [action].js capte tous les segments d'URL /api/rooms/{room_id}/{quoi que
// ce soit} qui ne correspondent à aucun autre fichier plus spécifique dans
// ce dossier — les URLs appelées côté front ne changent donc pas.
const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole, getAutreJoueur } = require("../../_lib/room");
const { getPersonnages, getPersonnageDraftParId, estGroupe, ELEMENTS_LIBRES, infosPersoJoueur, actualiserPoints } = require("../../_lib/personnages");
const { tirerBossAleatoire } = require("../../_lib/boss");
const { parserTempsMMSS, determinerVainqueur } = require("../../_lib/temps");
const { calculerTrophees } = require("../../_lib/trophees");
const {
  NB_PERSOS_MIN_BOX,
  SEQUENCE_FIXE,
  calculerPointsBox,
  calculerPoolJoueur,
  calculerElementsGroupes,
  calculerPoolDisponible,
  calculerBansBonus,
  lancerTirage,
  etatRevanche,
  vuePourJoueur,
  getProchaineAction,
  getEquipeJoueur,
  getBansJoueur
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

// Nombre de personnages (Voyageur compté une fois) de la box d'un joueur.
async function compterPersosBox(discordId, box) {
  // Catalogue déjà à jour (actualiserPoints dans le dispatch).
  const { data: profil } = await supabase.from("profiles").select("data").eq("discord_id", discordId).single();
  return calculerPoolJoueur(profil?.data, getPersonnages(), box).length;
}

function erreurBoxTropPetite(nbPersos) {
  return `Une box doit contenir au moins ${NB_PERSOS_MIN_BOX} personnages pour être choisie (celle-ci en a ${nbPersos}).`;
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

  const nbPersos = await compterPersosBox(user.id, box);
  if (nbPersos < NB_PERSOS_MIN_BOX) {
    return res.status(400).json({ error: erreurBoxTropPetite(nbPersos) });
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
    supabase.from("profiles").select("data").eq("discord_id", draft.discord_j2).single(),
    actualiserPoints()
  ]);

  const personnages = getPersonnages();

  const pointsJ1 = calculerPointsBox(profilJ1.data?.data, draft.box_j1, personnages);
  const pointsJ2 = calculerPointsBox(profilJ2.data?.data, draft.box_j2, personnages);

  draft.points_j1 = pointsJ1;
  draft.points_j2 = pointsJ2;

  const ecart = pointsJ1 - pointsJ2;
  const bansBonus = calculerBansBonus(ecart);

  // Pools = personnages de la box choisie par chaque joueur (et non sa Full Box).
  const poolJ1 = calculerPoolJoueur(profilJ1.data?.data, personnages, draft.box_j1);
  const poolJ2 = calculerPoolJoueur(profilJ2.data?.data, personnages, draft.box_j2);

  draft.pool_j1 = poolJ1;
  draft.pool_j2 = poolJ2;
  draft.elements_j1 = calculerElementsGroupes(profilJ1.data?.data, personnages, draft.box_j1);
  draft.elements_j2 = calculerElementsGroupes(profilJ2.data?.data, personnages, draft.box_j2);
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

  // Box vidée depuis son choix (Mon compte modifié entre-temps).
  if (draft.phase === "choix_box" && pret) {
    const nbPersos = await compterPersosBox(user.id, draft[`box_${joueur}`]);
    if (nbPersos < NB_PERSOS_MIN_BOX) {
      return res.status(400).json({ error: erreurBoxTropPetite(nbPersos) });
    }
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

  const { perso_id: persoId, element } = req.body || {};

  if (!persoId || typeof persoId !== "string") {
    return res.status(400).json({ error: "perso_id manquant" });
  }

  if (!getPersonnageDraftParId(persoId)) {
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

    // Voyageur : un des éléments mis dans sa box ; Manekin : élément libre.
    const elementsPossibles = estGroupe(persoId)
      ? draft[`elements_${joueur}`]?.[persoId] || []
      : ELEMENTS_LIBRES[persoId];
    if (elementsPossibles && !elementsPossibles.includes(element)) {
      return res.status(400).json({ error: "Choisis l'élément de ce personnage" });
    }
  }

  draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
  const action = { joueur, type: prochaine.type, perso_id: persoId, bonus: false };
  if (prochaine.type === "pick" && (estGroupe(persoId) || ELEMENTS_LIBRES[persoId])) {
    action.element = element;
  }
  draft.actions.push(action);

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
// Codes "colonne inexistante" (Postgres / PostgREST).
const COLONNES_INEXISTANTES = new Set(["42703", "PGRST204"]);

// litige : manche contestée, archivée sans vainqueur avec litige = "ouvert"
// (visible des administrateurs seulement, qui peuvent corriger les temps et
// la republier, cf. api/matches.js).
// classe : room du matchmaking classé, trophées en jeu enregistrés (calculés
// à la republication pour un litige).
async function archiverMatch(draft, { litige = false, classe = false } = {}) {
  // Picks figés avec les infos du joueur à la fin du match (constellation,
  // niveau, raffinement de l'arme signature) pour l'historique ; bans avec
  // les infos des 2 joueurs (comme les cartes de la draft).
  const [profilJ1, profilJ2] = await Promise.all([
    supabase.from("profiles").select("data").eq("discord_id", draft.discord_j1).single(),
    supabase.from("profiles").select("data").eq("discord_id", draft.discord_j2).single()
  ]);
  const profils = { j1: profilJ1.data?.data, j2: profilJ2.data?.data };
  const actions = draft.actions.map(action => action.type === "pick"
    ? { ...action, ...infosPersoJoueur(profils[action.joueur], action.perso_id, action.element) }
    : {
      ...action,
      infos: {
        j1: infosPersoJoueur(profils.j1, action.perso_id),
        j2: infosPersoJoueur(profils.j2, action.perso_id)
      }
    });

  const match = {
    boss_id: draft.boss_id,
    player1_discord_id: draft.discord_j1,
    player2_discord_id: draft.discord_j2,
    box_j1: draft.box_j1,
    box_j2: draft.box_j2,
    team_j1: getEquipeJoueur(draft, "j1"),
    team_j2: getEquipeJoueur(draft, "j2"),
    // Bans de draft et d'équilibrage de chaque joueur, avec les infos des
    // 2 joueurs sur le personnage (colonnes jsonb bans_j1 / bans_j2).
    bans_j1: getBansJoueur(actions, "j1"),
    bans_j2: getBansJoueur(actions, "j2"),
    temps_j1_affiche: draft.temps_j1.affiche,
    temps_j1_secondes: draft.temps_j1.secondes,
    temps_j2_affiche: draft.temps_j2.affiche,
    temps_j2_secondes: draft.temps_j2.secondes,
    vainqueur: draft.vainqueur,
    ...(litige ? { litige: "ouvert", litige_par: draft.litige_par } : {}),
    ...(classe ? {
      classe: true,
      trophees: litige ? null : calculerTrophees(draft.temps_j1, draft.temps_j2, draft.vainqueur)
    } : {}),
    // Toutes les actions (bans, bans d'équilibrage, picks avec l'élément du
    // Voyageur / Manekin) : affichées dans l'historique des matchs.
    actions
  };

  let { error } = await supabase.from("match_history").insert(match);

  // Colonne "actions" pas encore créée dans la table : archivage sans elle
  // (les bans restent enregistrés dans bans_j1 / bans_j2). Colonnes litige
  // absentes (sql/litiges.sql pas lancé) : nouvelle erreur, le litige n'est
  // pas archivé (jamais publié comme un match normal) ; idem pour un match
  // classé sans les colonnes classe / trophees (sql/classe.sql).
  if (error && COLONNES_INEXISTANTES.has(error.code)) {
    const { actions, ...sansActions } = match;
    ({ error } = await supabase.from("match_history").insert(sansActions));
  }

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

  // Correction possible pendant la vérification : les 2 confirmations sont
  // alors à refaire.
  if (draft.phase !== "temps" && draft.phase !== "verification") {
    return res.status(409).json({ error: "La saisie du temps n'est pas ouverte" });
  }

  const ancien = draft[`temps_${joueur}`];
  draft[`temps_${joueur}`] = tempsParsed;

  if (draft.phase === "verification") {
    if (ancien?.secondes !== tempsParsed.secondes) {
      draft.temps_confirme_j1 = false;
      draft.temps_confirme_j2 = false;
    }
  } else if (draft.temps_j1 && draft.temps_j2) {
    draft.phase = "verification";
    draft.temps_confirme_j1 = false;
    draft.temps_confirme_j2 = false;
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- confirmer_temps : les 2 temps affichés sont les bons ; une fois
// confirmés par les 2 joueurs, résultat et archivage ----
async function handleConfirmerTemps(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
  const draft = room.draft;

  if (draft.phase !== "verification") {
    return res.status(409).json({ error: "Les temps ne sont pas en cours de vérification" });
  }

  draft[`temps_confirme_${joueur}`] = true;

  if (draft.temps_confirme_j1 && draft.temps_confirme_j2) {
    draft.vainqueur = determinerVainqueur(draft.temps_j1, draft.temps_j2);
    draft.phase = "termine";
    await archiverMatch(draft, { classe: room.type === "classe" });
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- litige : un joueur conteste les temps ; la manche est invalidée (pas
// de vainqueur) et archivée pour les administrateurs seulement ----
async function handleLitige(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id);
  const draft = room.draft;

  if (draft.phase !== "verification") {
    return res.status(409).json({ error: "Les temps ne sont pas en cours de vérification" });
  }

  draft.phase = "litige";
  draft.litige_par = joueur;
  draft.vainqueur = null;
  await archiverMatch(draft, { litige: true, classe: room.type === "classe" });

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

  if (draft.phase !== "termine" && draft.phase !== "litige") {
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

// ---- Spectateurs présents (colonne rooms.spectateurs : { discord_id:
// dernière lecture de la draft en ms }, joueurs compris pour leur pastille
// de présence, cf. noterPresence) ----
// Un spectateur compte tant qu'il a lu la draft il y a moins de
// PRESENCE_SPECTATEUR_MS (sa page la relit toutes les 2,5 s). Sa présence
// n'est réécrite qu'au plus toutes les ECRITURE_SPECTATEUR_MS, et seulement
// cette colonne (jamais la draft).
const PRESENCE_SPECTATEUR_MS = 30 * 1000;
const ECRITURE_SPECTATEUR_MS = 10 * 1000;

function spectateursPresents(room, maintenant = Date.now()) {
  const joueurs = [room.draft?.discord_j1, room.draft?.discord_j2, room.player1_discord_id, room.player2_discord_id];
  return Object.entries(room.spectateurs || {})
    .filter(([id, vu]) => !joueurs.includes(id) && maintenant - Number(vu) < PRESENCE_SPECTATEUR_MS);
}

async function noterSpectateur(room, discordId) {
  const maintenant = Date.now();
  if (maintenant - Number(room.spectateurs?.[discordId] || 0) < ECRITURE_SPECTATEUR_MS) return;
  // Spectateurs partis retirés ; présence des joueurs gardée.
  const joueurs = [room.draft?.discord_j1, room.draft?.discord_j2];
  const spectateurs = Object.fromEntries([
    ...spectateursPresents(room, maintenant),
    ...Object.entries(room.spectateurs || {}).filter(([id]) => joueurs.includes(id))
  ]);
  spectateurs[discordId] = maintenant;
  const { error } = await supabase.from("rooms").update({ spectateurs }).eq("room_id", room.room_id);
  // Pas bloquant : le compteur des joueurs sera juste un peu en retard.
  if (error) console.error("Erreur présence spectateur :", error);
}

// ---- Présence des joueurs (dans la colonne rooms.spectateurs, à côté des
// spectateurs : { discord_id: dernière lecture de la draft en ms }) ----
// La page du match relit la draft toutes les 2,5 s, et plus du tout quand
// son onglet est masqué : un joueur est "en ligne" tant qu'il l'a lue il y a
// moins de PRESENCE_JOUEUR_MS, "afk" sinon (page fermée ou en arrière-plan).
// Réécrite au plus toutes les ECRITURE_PRESENCE_MS, seulement cette colonne.
const PRESENCE_JOUEUR_MS = 15 * 1000;
const ECRITURE_PRESENCE_MS = 5 * 1000;

async function noterPresence(room, discordId) {
  const maintenant = Date.now();
  if (maintenant - Number(room.spectateurs?.[discordId] || 0) < ECRITURE_PRESENCE_MS) return;
  const spectateurs = { ...(room.spectateurs || {}), [discordId]: maintenant };
  room.spectateurs = spectateurs;
  const { error } = await supabase.from("rooms").update({ spectateurs }).eq("room_id", room.room_id);
  // Pas bloquant : la pastille sera juste un peu en retard.
  if (error) console.error("Erreur présence joueur :", error);
}

// { j1: bool, j2: bool }.
function presencesJoueurs(room, maintenant = Date.now()) {
  const enLigne = discordId => !!discordId && maintenant - Number(room.spectateurs?.[discordId] || 0) < PRESENCE_JOUEUR_MS;
  return {
    j1: enLigne(room.draft?.discord_j1 || room.player1_discord_id),
    j2: enLigne(room.draft?.discord_j2 || room.player2_discord_id)
  };
}

// ---- draft (lecture seule) ----
async function handleDraftGet(req, res, roomId, user) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // Lecture ouverte aux spectateurs (joueur = null).
  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { autoriserSpectateur: true });

  if (joueur) await noterPresence(room, user.id);
  else await noterSpectateur(room, user.id);

  return res.status(200).json({
    spectateur: !joueur,
    room_id: room.room_id,
    player1_discord_id: room.player1_discord_id,
    player2_discord_id: room.player2_discord_id,
    // "prive" | "matchmaking" | "classe" (trophées en fin de match).
    type: room.type || "prive",
    draft: vuePourJoueur(room.draft, joueur),
    // Pastilles en ligne / afk des namecards (joueurs et spectateurs).
    presences: presencesJoueurs(room),
    // Nombre de spectateurs : pour les joueurs seulement (indicateur 👁).
    ...(joueur ? { nb_spectateurs: spectateursPresents(room).length } : {})
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

    // Personnages / boss ajoutés par les admins et points à jour (cache 30 s).
    if (action !== "draft") await actualiserPoints();

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
      case "confirmer_temps":
        return await handleConfirmerTemps(req, res, roomId, user);
      case "litige":
        return await handleLitige(req, res, roomId, user);
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