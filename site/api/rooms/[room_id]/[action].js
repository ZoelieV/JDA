// Fusion de 12 routes (box, ready, action, bonus_toggle, bonus_confirmer,
// temps, confirmer_temps, litige, rejouer, expirer, crash, draft) en un seul fichier, pour rester sous la limite de
// fonctions serverless du plan Hobby de Vercel. Le nom de fichier dynamique
// [action].js capte tous les segments d'URL /api/rooms/{room_id}/{quoi que
// ce soit} qui ne correspondent à aucun autre fichier plus spécifique dans
// ce dossier — les URLs appelées côté front ne changent donc pas.
const { supabase } = require("../../_lib/supabase");
const { parseCookies, verifySessionToken } = require("../../_lib/session");
const { chargerRoomAvecRole, getAutreJoueur } = require("../../_lib/room");
const { getPersonnages, getPersonnageDraftParId, estGroupe, ELEMENTS_LIBRES, actualiserPoints } = require("../../_lib/personnages");
const { tirerBossAleatoire } = require("../../_lib/boss");
const { TEMPS_ABANDON, parserTempsMMSS, determinerVainqueur } = require("../../_lib/temps");
const { archiverMatch, resultatTrophees } = require("../../_lib/archive");
const { calculerEquilibrage } = require("../../_lib/boxes");
const {
  PHASES_PAUSABLES,
  estChronometre,
  demarrerAnalyse,
  demarrerBansBonus,
  demarrerChronoDraft,
  consommerTemps,
  peutExpirer,
  estEnPause,
  mettreEnPause,
  reprendre,
  pauseExpiree
} = require("../../_lib/chronos");
const {
  NB_PERSOS_MIN_BOX,
  getSequence,
  estEntrainementSolo,
  calculerPoolJoueur,
  lancerTirage,
  etatRevanche,
  vuePourJoueur,
  getProchaineAction
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
// maintenant : heure du serveur, pour que la page cale ses chronos dessus.
function repondreDraft(res, draft, joueur, extra = {}) {
  return res.status(200).json({ draft: vuePourJoueur(draft, joueur), maintenant: Date.now(), ...extra });
}

// Draft classée en pause ("Mon adversaire a crash") : rien ne bouge.
function refuserSiPause(res, draft) {
  if (!estEnPause(draft)) return false;
  res.status(409).json({ error: "Draft en pause : en attente du retour du joueur qui a crash." });
  return true;
}

// Tirage j1/j2 + boss, puis chronos de la draft (classé).
function tirageEtDraft(draft) {
  lancerTirage(draft, tirerBossAleatoire);
  demarrerChronoDraft(draft);
}

// Les 2 joueurs sont prêts (ou le temps d'analyse est écoulé) : phase
// suivante.
async function passerApresPrets(draft) {
  draft.pret_j1 = false;
  draft.pret_j2 = false;

  if (draft.phase === "choix_box") {
    await calculerEquilibrage(draft);
    draft.phase = "analyse";
    demarrerAnalyse(draft);
  } else if ((draft.bans_bonus_faits || 0) < (draft.bans_bonus_total || 0)) {
    draft.phase = "bans_bonus";
    demarrerBansBonus(draft);
  } else {
    // Pas de ban d'équilibrage dû, ou déjà faits (revanche).
    tirageEtDraft(draft);
  }
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

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  if (draft.phase !== "choix_box") {
    return res.status(409).json({ error: "Le choix de box n'est plus possible à ce stade" });
  }
  if (refuserSiPause(res, draft)) return;

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
async function handleReady(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const pret = req.body?.pret !== undefined ? !!req.body.pret : true;

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  // Même ready-check pour 2 phases : validation de la box (choix_box), puis
  // fin du temps d'analyse des box (analyse).
  if (draft.phase !== "choix_box" && draft.phase !== "analyse") {
    return res.status(409).json({ error: "Impossible de changer son statut prêt à ce stade" });
  }
  if (refuserSiPause(res, draft)) return;

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
  // Entraînement seul : un clic vaut pour les 2 rôles.
  if (estEntrainementSolo(draft)) {
    draft.pret_j1 = pret;
    draft.pret_j2 = pret;
  }

  if (draft.pret_j1 && draft.pret_j2) await passerApresPrets(draft);

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

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  if (draft.phase !== "draft") {
    return res.status(409).json({ error: "Ce n'est pas le moment de bannir/picker" });
  }
  if (refuserSiPause(res, draft)) return;

  const prochaine = getProchaineAction(draft);

  if (!prochaine) {
    return res.status(409).json({ error: "Aucune action attendue à ce stade" });
  }

  if (prochaine.joueur !== joueur) {
    return res.status(403).json({ error: "Ce n'est pas ton tour" });
  }

  // Classé : chrono à 0, toutes ses actions restantes sont aléatoires.
  if (draft.chrono?.[`epuise_${joueur}`]) {
    return res.status(409).json({ error: "Ton temps est écoulé : tes actions restantes sont aléatoires." });
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

  // Classé : temps décompté ; arrivée trop tardive (au-delà de la grâce) :
  // choix aléatoire à la place, et chrono épuisé.
  const tropTard = consommerTemps(draft, joueur);
  if (tropTard) {
    jouerActionAleatoire(draft);
  } else {
    appliquerActionDraft(draft, joueur, prochaine.type, persoId, element);
  }
  jouerActionsAuto(draft);

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur, tropTard ? { trop_tard: true } : {});
}

// Ban / pick de la séquence : personnage retiré du pool, action suivante.
function appliquerActionDraft(draft, joueur, type, persoId, element, aleatoire = false) {
  draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
  const action = { joueur, type, perso_id: persoId, bonus: false };
  if (type === "pick" && (estGroupe(persoId) || ELEMENTS_LIBRES[persoId])) {
    action.element = element;
  }
  // Choix fait au hasard (temps écoulé) : carte entourée de doré.
  if (aleatoire) action.aleatoire = true;
  draft.actions.push(action);

  draft.sequence_index += 1;

  if (draft.sequence_index >= getSequence(draft).length) {
    draft.phase = "temps";
  }
}

function auHasard(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

// Action en cours jouée au hasard : ban parmi tout le pool disponible (même
// un perso que seul ce joueur possède) ; pick parmi ses propres persos
// encore disponibles (élément au hasard parmi ceux permis).
function jouerActionAleatoire(draft) {
  const prochaine = getProchaineAction(draft);
  if (!prochaine) return false;
  const { joueur, type } = prochaine;
  const possedes = new Set(draft[`pool_${joueur}`] || []);
  const candidats = type === "pick"
    ? draft.pool_disponible.filter(id => possedes.has(id))
    : draft.pool_disponible;
  if (candidats.length === 0) return false;

  const persoId = auHasard(candidats);
  let element = null;
  if (type === "pick") {
    const elements = estGroupe(persoId) ? draft[`elements_${joueur}`]?.[persoId] || [] : ELEMENTS_LIBRES[persoId];
    if (elements?.length) element = auHasard(elements);
  }
  appliquerActionDraft(draft, joueur, type, persoId, element, true);
  if (draft.chrono) draft.chrono.tour_debut = Date.now();
  return true;
}

// Tant que c'est le tour d'un joueur dont le chrono est épuisé : actions
// aléatoires (jusqu'au tour de l'autre ou la fin de la draft).
function jouerActionsAuto(draft) {
  while (draft.phase === "draft" && draft.chrono) {
    const prochaine = getProchaineAction(draft);
    if (!prochaine || !draft.chrono[`epuise_${prochaine.joueur}`]) return;
    if (!jouerActionAleatoire(draft)) return;
  }
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

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  if (draft.phase !== "bans_bonus") {
    return res.status(409).json({ error: "Aucun ban d'équilibrage à faire à ce stade" });
  }
  if (refuserSiPause(res, draft)) return;

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

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  if (draft.phase !== "bans_bonus") {
    return res.status(409).json({ error: "Aucun ban d'équilibrage à confirmer à ce stade" });
  }
  if (refuserSiPause(res, draft)) return;

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

  tirageEtDraft(draft);

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
}

// ---- temps ----
async function handleTemps(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // { temps: "mm:ss" } ou { abandon: true } (abandon à la place d'un temps).
  const tempsParsed = req.body?.abandon === true ? { ...TEMPS_ABANDON } : parserTempsMMSS(req.body?.temps);

  if (!tempsParsed) {
    return res.status(400).json({ error: "Format de temps invalide (attendu mm:ss)" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  // Correction possible pendant la vérification : les 2 confirmations sont
  // alors à refaire.
  if (draft.phase !== "temps" && draft.phase !== "verification") {
    return res.status(409).json({ error: "La saisie du temps n'est pas ouverte" });
  }

  const ancien = draft[`temps_${joueur}`];
  draft[`temps_${joueur}`] = tempsParsed;

  if (draft.phase === "verification") {
    if (ancien?.affiche !== tempsParsed.affiche) {
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

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  if (draft.phase !== "verification") {
    return res.status(409).json({ error: "Les temps ne sont pas en cours de vérification" });
  }

  draft[`temps_confirme_${joueur}`] = true;

  if (draft.temps_confirme_j1 && draft.temps_confirme_j2) {
    draft.vainqueur = determinerVainqueur(draft.temps_j1, draft.temps_j2);
    draft.phase = "termine";
    const classe = room.type === "classe";
    const idMatch = await archiverMatch(draft, { classe });
    // { j1, j2, bonus } (null hors classé) : écran de fin de match.
    draft.resultat_trophees = classe ? await resultatTrophees(idMatch) : null;
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

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  if (draft.phase !== "verification") {
    return res.status(409).json({ error: "Les temps ne sont pas en cours de vérification" });
  }

  draft.phase = "litige";
  draft.litige_par = joueur;
  draft.vainqueur = null;
  // Entraînement : rien à transmettre aux administrateurs.
  if (!draft.entrainement) await archiverMatch(draft, { litige: true, classe: room.type === "classe" });

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

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;

  if (draft.phase !== "termine" && draft.phase !== "litige") {
    return res.status(409).json({ error: "La manche en cours n'est pas terminée" });
  }

  // Un joueur a démarré un autre match (cf. annulerAutresMatchs).
  if (draft.quitte_par) {
    return res.status(409).json({ error: "Ton adversaire a quitté la room : revanche impossible" });
  }

  draft[`rejouer_${joueur}`] = veutRejouer;
  // Entraînement seul : un clic vaut pour les 2 rôles.
  if (estEntrainementSolo(draft)) {
    draft.rejouer_j1 = veutRejouer;
    draft.rejouer_j2 = veutRejouer;
  }

  if (draft.rejouer_j1 && draft.rejouer_j2) {
    // Mêmes box et bans d'équilibrage, rôles inversés (le 1er pick ne reste
    // pas du même côté), retour direct à l'analyse ; boss différent du
    // précédent au prochain tirage.
    const nouveau = etatRevanche(draft);
    demarrerAnalyse(nouveau);

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

// ---- expirer : temps écoulé (draft classée) ----
// Envoyé par la page du joueur dont c'est le tour quand SON chrono atteint
// 0, ou par celle de l'adversaire DELAI_ADVERSAIRE_MS plus tard (cf.
// peutExpirer). Analyse : passage à la suite comme si les 2 étaient prêts ;
// bans d'équilibrage : bans manquants au hasard ; draft : chrono épuisé,
// actions restantes du joueur au hasard.
async function handleExpirer(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;
  if (!estChronometre(draft)) return res.status(409).json({ error: "Pas de chrono dans ce match" });
  if (refuserSiPause(res, draft)) return;
  const pasEncore = () => res.status(409).json({ error: "Le temps n'est pas encore écoulé" });

  if (draft.phase === "analyse") {
    if (!draft.fin_analyse || !peutExpirer(draft.fin_analyse, true)) return pasEncore();
    await passerApresPrets(draft);
  } else if (draft.phase === "bans_bonus") {
    const acteur = draft.bans_bonus_joueur;
    if (!draft.fin_bans_bonus || !peutExpirer(draft.fin_bans_bonus, joueur === acteur)) return pasEncore();
    // Choix déjà sélectionnés gardés, le reste au hasard.
    const choix = [...(draft.bans_bonus_choix || [])];
    const libres = draft.pool_disponible.filter(id => !choix.includes(id));
    const aleatoires = new Set();
    while (choix.length < draft.bans_bonus_total && libres.length) {
      const persoId = libres.splice(Math.floor(Math.random() * libres.length), 1)[0];
      choix.push(persoId);
      aleatoires.add(persoId);
    }
    choix.forEach(persoId => {
      draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
      draft.actions.push({ joueur: acteur, type: "ban", perso_id: persoId, bonus: true, ...(aleatoires.has(persoId) ? { aleatoire: true } : {}) });
    });
    draft.bans_bonus_faits = choix.length;
    draft.bans_bonus_choix = [];
    tirageEtDraft(draft);
  } else if (draft.phase === "draft" && draft.chrono) {
    const prochaine = getProchaineAction(draft);
    if (!prochaine) return pasEncore();
    const acteur = prochaine.joueur;
    const fin = draft.chrono.tour_debut + draft.chrono[acteur];
    if (!peutExpirer(fin, joueur === acteur)) return pasEncore();
    draft.chrono[acteur] = 0;
    draft.chrono[`epuise_${acteur}`] = true;
    jouerActionsAuto(draft);
  } else {
    return res.status(409).json({ error: "Aucun chrono en cours" });
  }

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur, { expire: true });
}

// ---- crash : "Mon adversaire a crash" (draft classée) ----
// Pause de la draft jusqu'au retour de l'adversaire (sa page relit la
// draft, cf. handleDraftGet) ; annulée après PAUSE_MAX_MS sans retour. Le
// délai ne démarre qu'à ce clic (après la draft, les joueurs quittent le
// site pour jouer : pas d'annulation automatique).
async function handleCrash(req, res, roomId, user) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { agirEn: user.agirEn });
  const draft = room.draft;
  if (!estChronometre(draft) || !PHASES_PAUSABLES.includes(draft.phase)) {
    return res.status(409).json({ error: "La draft ne peut pas être mise en pause à ce stade" });
  }
  // Seulement si l'adversaire n'est plus en ligne (même règle que sa
  // pastille de présence).
  const adversaire = joueur === "j1" ? "j2" : "j1";
  if (!estEnPause(draft) && presencesJoueurs(room)[adversaire]) {
    return res.status(409).json({ error: "Ton adversaire est toujours en ligne : pas de pause possible." });
  }
  if (!estEnPause(draft)) mettreEnPause(draft, joueur);

  await sauvegarderDraft(roomId, draft);
  return repondreDraft(res, draft, joueur);
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
  const { room, joueur } = await chargerRoomAvecRole(supabase, roomId, user.id, { autoriserSpectateur: true, agirEn: user.agirEn });

  if (joueur) await noterPresence(room, user.id);
  else await noterSpectateur(room, user.id);

  // Draft en pause : le joueur absent est revenu (sa page relit la draft)
  // -> reprise, chronos décalés ; sinon, annulation après le délai.
  const draftPause = room.draft;
  if (estEnPause(draftPause)) {
    if (joueur && joueur === draftPause.pause.absent) {
      reprendre(draftPause);
      await sauvegarderDraft(room.room_id, draftPause);
    } else if (pauseExpiree(draftPause)) {
      draftPause.annule_par = draftPause.pause.absent;
      draftPause.annule_raison = "crash";
      draftPause.phase = "annule";
      draftPause.pause = null;
      await sauvegarderDraft(room.room_id, draftPause);
    }
  }

  return res.status(200).json({
    spectateur: !joueur,
    room_id: room.room_id,
    player1_discord_id: room.player1_discord_id,
    player2_discord_id: room.player2_discord_id,
    // "prive" | "matchmaking" | "classe" (trophées en fin de match).
    type: room.type || "prive",
    draft: vuePourJoueur(room.draft, joueur),
    // Heure du serveur : la page cale ses chronos dessus.
    maintenant: Date.now(),
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
    // Entraînement joué seul : rôle dans lequel la page agit (cf.
    // chargerRoomAvecRole).
    user.agirEn = req.body?.agir_en || new URL(req.url, "http://x").searchParams.get("agir_en");

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
      case "expirer":
        return await handleExpirer(req, res, roomId, user);
      case "crash":
        return await handleCrash(req, res, roomId, user);
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