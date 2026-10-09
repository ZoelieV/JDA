const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { parseCookies, verifySessionToken } = require("../_lib/session");
const { TYPES_FILE, chercher, annuler } = require("../_lib/matchmaking");
const { annulerAutresMatchs } = require("../_lib/room");
const { verifierFrequence } = require("../_lib/limites");
const { MODES_THEATRE, NB_PERSOS_MIN_BOX, erreurModeAuto, etatInitialDraft, calculerPoolJoueur } = require("../_lib/draft");
const { calculerEquilibrage, donneesBoxRole } = require("../_lib/boxes");
const { demarrerAnalyse } = require("../_lib/chronos");
const { getPersonnages, actualiserPoints, migrerCollectionPersos } = require("../_lib/personnages");
const { getBossParId, bossCarnageExclus, estWorldBoss, ERREUR_CARNAGE_DESACTIVE, ERREUR_WORLD_BOSS } = require("../_lib/boss");
const { legendesTueesAujourdhui } = require("../_lib/legendes");
const { preparerCreation } = require("../_lib/equipe");
const { preparerCreation: preparerWorldBoss } = require("../_lib/world_boss");
const { estModerateur } = require("../_lib/admin");
const { estIdFictif, lireBoxFictive } = require("../_lib/boxes_fictives");

// Entraînement : une création toutes les 10 s par IP au plus.
const DELAI_ENTRAINEMENT_MS = 10 * 1000;
const BOX_OPTI = ["opti1", "opti2", "opti3", "opti4", "opti5"];
const PREMIERS = ["moi", "adverse", "aleatoire"];
// Room privée : J1 choisi par le créateur.
const PREMIERS_ROOM = ["createur", "adversaire", "aleatoire"];

// Boss imposé à la création : inconnu, légende locale déjà tuée
// aujourd'hui par le créateur ou boss du carnage désactivé (sauf en
// entraînement) -> message d'erreur ; null sinon.
async function erreurBossImpose(bossId, discordId, { entrainement = false } = {}) {
  if (!bossId) return null;
  const boss = getBossParId(bossId);
  if (!boss) return "Boss inconnu";
  if (estWorldBoss(boss)) return ERREUR_WORLD_BOSS;
  if (!entrainement && (await bossCarnageExclus()).includes(bossId)) return ERREUR_CARNAGE_DESACTIVE;
  if ((await legendesTueesAujourdhui([discordId])).includes(bossId)) {
    return `Tu as déjà tué ${boss.nom} aujourd'hui : cette légende locale revient demain à 4 h.`;
  }
  return null;
}

async function lireProfil(discordId) {
  const { data } = await supabase.from("profiles").select("data").eq("discord_id", discordId).maybeSingle();
  return data?.data || null;
}

// Box d'un côté de l'entraînement -> { source } ou { erreur }.
// Box du lanceur : n'importe laquelle ; d'un autre joueur : full ou stuff
// (ses box opti restent privées) ; personnalisée ("custom") : persos cochés
// parmi ceux de la full box du joueur. NB_PERSOS_MIN_BOX persos minimum.
// Box fictive (cf. _lib/boxes_fictives.js) : administrateurs et mini admins
// seulement, full box ou personnalisée.
async function validerBoxEntrainement(brut, lanceurId, libelle) {
  const proprietaire = typeof brut?.proprietaire === "string" ? brut.proprietaire : null;
  const box = brut?.box;
  if (!proprietaire) return { erreur: `${libelle} : joueur manquant` };
  const fictive = estIdFictif(proprietaire);
  const autorisees = fictive ? ["full", "custom"] : ["full", "stuff", "custom", ...(proprietaire === lanceurId ? BOX_OPTI : [])];
  if (!autorisees.includes(box)) return { erreur: `${libelle} : box non autorisée` };

  let profil;
  if (fictive) {
    if (!await estModerateur(lanceurId)) return { erreur: `${libelle} : box fictive réservée aux administrateurs` };
    const boxFictive = await lireBoxFictive(proprietaire);
    profil = boxFictive && { discord_global_name: boxFictive.nom, data: boxFictive.data };
  } else {
    ({ data: profil } = await supabase
      .from("profiles")
      .select("discord_global_name, discord_username, data")
      .eq("discord_id", proprietaire)
      .maybeSingle());
  }
  if (!profil) return { erreur: `${libelle} : joueur introuvable` };

  const source = { proprietaire, box, nom: profil.discord_global_name || profil.discord_username || "Joueur" };
  if (box === "custom") {
    const full = migrerCollectionPersos(profil.data?.characters)?.full || {};
    const persos = Array.isArray(brut.persos) ? [...new Set(brut.persos.filter(id => typeof id === "string"))] : [];
    source.persos = persos.filter(id => (full[id] ?? -1) >= 0).slice(0, 300);
  }
  const nbPersos = calculerPoolJoueur(donneesBoxRole(profil.data, source), getPersonnages(), box).length;
  if (nbPersos < NB_PERSOS_MIN_BOX) {
    return { erreur: `${libelle} : ${nbPersos} personnage(s), il en faut au moins ${NB_PERSOS_MIN_BOX}` };
  }
  return { source };
}

// POST { type: "entrainement", config } : room d'entraînement, créée
// directement en analyse (box choisies d'avance). Le lanceur joue seul les
// 2 rôles (j1 et j2 = lui) jusqu'à ce qu'un joueur ouvre le lien et prenne
// le côté "box adverse" (cf. api/rooms/[room_id].js).
async function creerEntrainement(req, res, user) {
  const config = req.body?.config || {};
  const mode = MODES_THEATRE.includes(config.mode) ? config.mode : "auto";
  const premier = PREMIERS.includes(config.premier) ? config.premier : "aleatoire";

  await actualiserPoints();
  const [moi, adverse] = await Promise.all([
    validerBoxEntrainement(config.boxes?.moi, user.id, "Ta box"),
    validerBoxEntrainement(config.boxes?.adverse, user.id, "Box adverse")
  ]);
  if (moi.erreur || adverse.erreur) return res.status(400).json({ error: moi.erreur || adverse.erreur });

  const bossId = config.boss_id ? String(config.boss_id) : null;
  const erreurBoss = await erreurBossImpose(bossId, user.id, { entrainement: true });
  if (erreurBoss) return res.status(400).json({ error: erreurBoss });

  const attente = await verifierFrequence(req, "entrainement", DELAI_ENTRAINEMENT_MS);
  if (attente > 0) {
    return res.status(429).json({ error: `Un entraînement toutes les 10 s au maximum : réessaie dans ${Math.ceil(attente / 1000)} s.` });
  }

  const draft = {
    ...etatInitialDraft(),
    discord_j1: user.id,
    discord_j2: user.id,
    roles_tires: false,
    mode_theatre: mode,
    chronometre: config.classe === true,
    entrainement: {
      lanceur: user.id,
      aide: null,
      cote_moi: "j1",
      boxes: { moi: moi.source, adverse: adverse.source },
      boss_id: bossId,
      premier
    },
    box_j1: moi.source.box,
    box_j2: adverse.source.box
  };
  await calculerEquilibrage(draft);
  draft.phase = "analyse";
  demarrerAnalyse(draft);

  const roomId = genererRoomId();
  const { error } = await supabase.from("rooms").insert({
    room_id: roomId,
    player1_discord_id: user.id,
    player2_discord_id: user.id,
    type: "entrainement",
    draft
  });
  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur création de l'entraînement" });
  }
  return res.status(200).json({ room_id: roomId });
}

// POST { type: "equipe", taille: 2 | 3 | 4, formation: "aleatoire" |
// "choix", boss_id? } : lobby d'un match en équipe (cf. _lib/equipe.js),
// même limite de création que les rooms privées.
async function creerEquipe(req, res, user) {
  const { draft, erreur } = await preparerCreation(req.body, user);
  if (erreur) return res.status(400).json({ error: erreur });

  const attente = await verifierFrequence(req, "room_privee", DELAI_ROOM_PRIVEE_MS);
  if (attente > 0) {
    const secondes = Math.ceil(attente / 1000);
    res.setHeader("Retry-After", String(secondes));
    return res.status(429).json({ error: `Une room par minute au maximum : réessaie dans ${secondes} s.`, attente: secondes });
  }

  await annulerAutresMatchs(supabase, user.id);
  const roomId = genererRoomId();
  const { error } = await supabase.from("rooms").insert({
    room_id: roomId,
    player1_discord_id: user.id,
    type: "equipe",
    membres: [user.id],
    draft
  });
  if (error) {
    console.error(error);
    const sqlManquant = ["42703", "PGRST204"].includes(error.code);
    return res.status(500).json({ error: sqlManquant ? "Modes en équipe pas encore activés (sql/equipes.sql à lancer dans Supabase)." : "Erreur création de la room" });
  }
  return res.status(200).json({ room_id: roomId, equipe: true });
}

// POST { type: "world_boss" } : room Random world boss (cf.
// _lib/world_boss.js), même limite de création que les rooms privées.
async function creerWorldBoss(req, res, user) {
  const { draft } = await preparerWorldBoss(user);

  const attente = await verifierFrequence(req, "room_privee", DELAI_ROOM_PRIVEE_MS);
  if (attente > 0) {
    const secondes = Math.ceil(attente / 1000);
    res.setHeader("Retry-After", String(secondes));
    return res.status(429).json({ error: `Une room par minute au maximum : réessaie dans ${secondes} s.`, attente: secondes });
  }

  await annulerAutresMatchs(supabase, user.id);
  const roomId = genererRoomId();
  const { error } = await supabase.from("rooms").insert({
    room_id: roomId,
    player1_discord_id: user.id,
    type: "world_boss",
    membres: [user.id],
    draft
  });
  if (error) {
    console.error(error);
    const sqlManquant = ["42703", "PGRST204"].includes(error.code);
    return res.status(500).json({ error: sqlManquant ? "Mode pas encore activé (sql/equipes.sql à lancer dans Supabase)." : "Erreur création de la room" });
  }
  return res.status(200).json({ room_id: roomId, world_boss: true });
}

// Modes de théâtre : room privée = au choix ("auto", un théâtre ou
// "carnage") ; matchmaking = classique ("auto"), mêlée générale ("12") ou
// carnage ; classé = classique ou mêlée générale seulement.
const MODES_MATCHMAKING = { matchmaking: ["auto", "12", "carnage"], classe: ["auto", "12"] };

// Match privé : une création par minute et par adresse IP au plus.
const DELAI_ROOM_PRIVEE_MS = 60 * 1000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function genererRoomId() {
  return crypto.randomBytes(4).toString("hex"); // ex: "a1b2c3d4"
}

// POST { mode? }                            : match privé (nouvelle room ;
//                                             1 par minute et par IP, la
//                                             précédente est supprimée)
//   mode : "auto" (théâtre du plus petit clear), "6", "8", "10", "12" ou
//   "carnage" ; boss_id : boss imposé (sinon au hasard) ; premier : J1 =
//   "createur" | "adversaire" | "aleatoire"
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
    const user = await verifySessionToken(cookies.session);

    if (!user) {
      return res.status(401).json({ error: "Non connecté" });
    }

    if (req.method === "DELETE") {
      await annuler(user.id);
      return res.status(200).json({ ok: true });
    }

    if (req.body?.type === "entrainement") return await creerEntrainement(req, res, user);
    if (req.body?.type === "equipe") return await creerEquipe(req, res, user);
    if (req.body?.type === "world_boss") return await creerWorldBoss(req, res, user);

    if (TYPES_FILE.includes(req.body?.type)) {
      const roomIdAttente = typeof req.body.room_id === "string" ? req.body.room_id : null;
      const mode = MODES_MATCHMAKING[req.body.type].includes(req.body.mode) ? req.body.mode : "auto";
      // Début de recherche en classique : théâtre renseigné obligatoire.
      if (!roomIdAttente) {
        const erreur = erreurModeAuto(mode, await lireProfil(user.id));
        if (erreur) return res.status(409).json({ error: erreur });
      }
      try {
        return res.status(200).json(await chercher(user.id, roomIdAttente, req.body.type, mode));
      } catch (erreur) {
        if (erreur?.status) return res.status(erreur.status).json({ error: erreur.message });
        throw erreur;
      }
    }

    const mode = MODES_THEATRE.includes(req.body?.mode) ? req.body.mode : "auto";
    const erreurMode = erreurModeAuto(mode, await lireProfil(user.id));
    if (erreurMode) return res.status(409).json({ error: erreurMode });

    // Boss et J1 choisis à la création (sinon au hasard au tirage).
    await actualiserPoints();
    const bossImpose = req.body?.boss_id ? String(req.body.boss_id) : null;
    const erreurBoss = await erreurBossImpose(bossImpose, user.id);
    if (erreurBoss) return res.status(400).json({ error: erreurBoss });
    const premier = PREMIERS_ROOM.includes(req.body?.premier) ? req.body.premier : "aleatoire";

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
    // Mode de théâtre gardé dans la draft (complétée à l'arrivée du 2e
    // joueur, cf. assurerRolesDraft).
    const { error } = await supabase.from("rooms").insert({
      room_id: roomId,
      player1_discord_id: user.id,
      type: "prive",
      draft: { mode_theatre: mode, boss_impose: bossImpose, premier, createur: user.id }
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
