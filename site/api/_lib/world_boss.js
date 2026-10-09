// Mode Random world boss : de 2 à 4 joueurs en co-op contre un boss tiré au
// hasard, avec 4 persos tirés au hasard dans leurs full box. Rooms de type
// "world_boss" (colonne membres, cf. sql/equipes.sql), page
// matchmaking/world_boss.html, routes /api/rooms/{room_id}/wb_* (cf.
// api/rooms/[room_id]/[action].js). Parties archivées dans la table
// world_boss_history (cf. sql/world_boss.sql).
//
// Déroulé (draft.phase) :
//   lobby   : les joueurs rejoignent par le lien (TAILLE_MIN à TAILLE_MAX) ;
//             le créateur (chef) lance quand il est prêt.
//   jeu     : boss tiré parmi les world boss, les boss hebdomadaires, les
//             légendes locales faisables en co-op et les salles du carnage
//             (tous équiprobables) ; 4 persos tirés dans l'union des full
//             box, toujours répartissables entre les joueurs (à 2 : 2
//             persos chacun ; à 3 : 2 + 1 + 1 ; à 4 : 1 chacun) sans imposer
//             qui joue quoi. Après le combat, chaque joueur déclare les
//             persos qu'il a joués, le chef déclare la réussite ou l'échec.
//   termine : tout est déclaré -> partie archivée.
//   annule  : un joueur est parti (autre match démarré).
// Retour au lobby (chef) à tout moment : mêmes joueurs, nouveau tirage au
// lancement (partie en cours pas archivée).
const { supabase } = require("./supabase");
const { ecrireDraft } = require("./room");
const { actualiserPoints, getPersonnages, migrerCollectionPersos, ELEMENTS_LIBRES } = require("./personnages");
const { listeBoss, estWorldBoss, estLegendeLocale, bossCarnageExclus } = require("./boss");
const { saisonActuelle } = require("./saisons");

const TAILLE_MIN = 2;
const TAILLE_MAX = 4;
const NB_PERSOS = 4;
// Tirages des persos essayés avant d'abandonner (tirage rejeté s'il est
// impossible à répartir entre les joueurs).
const ESSAIS_TIRAGE = 500;
const PHASES_EN_COURS = ["jeu"];

const auHasard = liste => liste[Math.floor(Math.random() * liste.length)];

function erreur(status, message) {
  return { status, message };
}

// ---- État ----

function etatLobby({ createur, membres = [createur], infos = {}, bossPrecedent = null, version = null }) {
  return {
    mode: "world_boss",
    phase: "lobby",
    createur,
    boss_precedent_id: bossPrecedent,
    membres,
    infos,
    version
  };
}

async function lireProfils(ids) {
  const { data, error } = await supabase
    .from("profiles")
    .select("discord_id, discord_username, discord_global_name, discord_avatar_url, data")
    .in("discord_id", ids);
  if (error) throw error;
  return new Map((data || []).map(p => [p.discord_id, p]));
}

function infosProfil(profil) {
  return {
    nom: profil?.discord_global_name || profil?.discord_username || "Joueur",
    avatar: profil?.discord_avatar_url || null,
    banniere2: profil?.data?.parametres?.banniere2 || null
  };
}

async function chargerRoom(roomId) {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("room_id, type, player1_discord_id, draft, last_active_at")
    .eq("room_id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (!room || room.type !== "world_boss" || room.draft?.mode !== "world_boss") throw erreur(404, "Room introuvable");
  return room;
}

// Écriture conditionnelle (cf. ecrireDraft) ; conflit : la route est
// rejouée (cf. dispatch de api/rooms/[room_id]/[action].js).
async function sauvegarder(roomId, draft, colonnes = {}) {
  let ecrite;
  try {
    ecrite = await ecrireDraft(supabase, roomId, draft, colonnes);
  } catch (e) {
    console.error(e);
    throw erreur(500, "Erreur lors de la mise à jour de la room");
  }
  if (!ecrite) throw { status: 409, conflit: true, message: "La room a changé entre-temps : réessaie." };
}

// ---- Tirage du boss ----

// Boss du mode : world boss, boss hebdomadaires, légendes locales faisables
// en co-op et salles du carnage (sauf désactivées), tous équiprobables ;
// jamais deux fois de suite le même.
async function tirerBoss(precedent) {
  const { BOSS_HORS_COOP } = require("./equipe");
  const carnageExclus = await bossCarnageExclus();
  const candidats = listeBoss().filter(b =>
    estWorldBoss(b) || b.type === "weekly_boss" || b.type === "carnage_boss" || estLegendeLocale(b))
    .filter(b => !BOSS_HORS_COOP.includes(b.id) && !carnageExclus.includes(b.id));
  const sansPrecedent = candidats.filter(b => b.id !== precedent);
  return auHasard(sansPrecedent.length ? sansPrecedent : candidats)?.id || null;
}

// ---- Full box et tirage des persos ----

// Persos possédés (full box) : [{ draft_id, element, constellation, niveau }]
// (Voyageur : un par élément, regroupés sous l'id de la draft).
function persosFullBox(profilData) {
  const parId = new Map(getPersonnages().map(p => [p.id, p]));
  const collection = migrerCollectionPersos(profilData?.characters) || {};
  const full = collection.full || {};
  return Object.keys(full)
    .filter(id => parId.has(id) && Number.isInteger(full[id]) && full[id] >= 0)
    .map(id => {
      const personnage = parId.get(id);
      const niveau = collection.niveaux?.[personnage.groupe || id];
      return {
        draft_id: personnage.groupe || id,
        element: personnage.groupe ? personnage.element : null,
        constellation: full[id],
        niveau: niveau === 95 || niveau === 100 ? niveau : null
      };
    });
}

// Version d'un perso tiré chez un joueur, ou null. Voyageur : de l'élément
// tiré ; Manekin : élément libre.
function versionDe(box, perso) {
  return (box || []).find(p => p.draft_id === perso.perso_id && (!p.element || !perso.element || p.element === perso.element)) || null;
}

// Nombre de persos joués par chaque joueur : à 2, 2 chacun ; à 4, 1
// chacun ; à 3, un joueur (n'importe lequel) en joue 2.
function capacitesPossibles(membres) {
  if (membres.length === 2) return [Object.fromEntries(membres.map(id => [id, 2]))];
  if (membres.length === 4) return [Object.fromEntries(membres.map(id => [id, 1]))];
  return membres.map(double => Object.fromEntries(membres.map(id => [id, id === double ? 2 : 1])));
}

// Les persos tirés peuvent-ils être répartis entre les joueurs (chacun joue
// des persos de sa full box, nombre de persos par joueur respecté) ?
function repartissable(persos, membres, boxes) {
  return capacitesPossibles(membres).some(capacite => {
    const charge = Object.fromEntries(membres.map(id => [id, 0]));
    const essayer = i => {
      if (i === persos.length) return true;
      for (const membre of membres) {
        if (charge[membre] >= capacite[membre] || !versionDe(boxes[membre], persos[i])) continue;
        charge[membre]++;
        if (essayer(i + 1)) return true;
        charge[membre]--;
      }
      return false;
    };
    return essayer(0);
  });
}

// Élément d'un perso tiré : Voyageur, parmi les éléments possédés par au
// moins un joueur ; Manekin, au hasard ; sinon null.
function elementTire(draftId, boxes) {
  if (ELEMENTS_LIBRES[draftId]) return auHasard(ELEMENTS_LIBRES[draftId]);
  const elements = [...new Set(Object.values(boxes).flatMap(box =>
    box.filter(p => p.draft_id === draftId && p.element).map(p => p.element)))];
  return elements.length ? auHasard(elements) : null;
}

function melanger(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

// 4 persos différents tirés uniformément dans l'union des full box, parmi
// les tirages répartissables (tirage rejeté et refait sinon). -> liste de
// { perso_id, element } ou null.
function tirerPersos(membres, boxes) {
  const ids = [...new Set(Object.values(boxes).flatMap(box => box.map(p => p.draft_id)))];
  if (ids.length < NB_PERSOS) return null;
  for (let essai = 0; essai < ESSAIS_TIRAGE; essai++) {
    const persos = melanger(ids).slice(0, NB_PERSOS).map(id => ({ perso_id: id, element: elementTire(id, boxes) }));
    if (repartissable(persos, membres, boxes)) return persos;
  }
  return null;
}

// ---- Déclarations ----

// Nombre de persos que ce joueur peut encore déclarer (cf.
// capacitesPossibles) : à 3, un seul joueur en déclare 2.
function maxPersosJoueur(draft, discordId) {
  const taille = draft.joueurs.length;
  if (taille === 2) return 2;
  if (taille === 4) return 1;
  const autreADeux = draft.joueurs.some(id => id !== discordId && (draft.joues?.[id] || []).length >= 2);
  return autreADeux ? 1 : 2;
}

// Tout déclaré : les 4 persos ont un joueur, chaque joueur au moins un perso
// (avec les maximums, la répartition est alors la bonne), et le résultat.
function toutDeclare(draft) {
  const declares = draft.joueurs.flatMap(id => draft.joues?.[id] || []);
  return declares.length === NB_PERSOS &&
    draft.joueurs.every(id => (draft.joues?.[id] || []).length >= 1) &&
    typeof draft.reussite === "boolean";
}

// ---- Archivage ----

async function archiver(draft) {
  const joueParPerso = {};
  draft.joueurs.forEach(id => (draft.joues?.[id] || []).forEach(persoId => { joueParPerso[persoId] = id; }));
  const ligne = {
    boss_id: draft.boss_id,
    reussite: draft.reussite,
    createur: draft.createur,
    membres: draft.joueurs.map(id => ({ discord_id: id, nom: draft.infos?.[id]?.nom || "Joueur", avatar: draft.infos?.[id]?.avatar || null })),
    persos: draft.persos.map(perso => {
      const joueur = joueParPerso[perso.perso_id] || null;
      const version = joueur ? draft.versions?.[perso.perso_id]?.[joueur] : null;
      return {
        perso_id: perso.perso_id,
        element: perso.element,
        joue_par: joueur,
        constellation: version?.constellation ?? null,
        niveau: version?.niveau ?? null
      };
    }),
    saison: await saisonActuelle()
  };
  const { data, error } = await supabase.from("world_boss_history").insert(ligne).select("id").single();
  if (error) {
    console.error("Erreur archivage Random world boss :", error);
    return null;
  }
  return data.id;
}

// ---- Un seul match à la fois ----
// Joueur qui démarre un autre match : il quitte ses rooms Random world boss
// (lobby : retiré, room supprimée si c'est le créateur ; partie en cours :
// annulée).
async function quitterWorldBoss(discordId, { sauf = null } = {}) {
  let requete = supabase
    .from("rooms")
    .select("room_id, draft")
    .eq("type", "world_boss")
    .contains("membres", [discordId]);
  if (sauf) requete = requete.neq("room_id", sauf);
  const { data, error } = await requete;
  if (error) {
    if (!["42703", "PGRST204", "42P01"].includes(error.code)) console.error("Erreur lecture rooms Random world boss :", error);
    return;
  }
  for (const room of data || []) {
    try {
      await retirerMembre(room.room_id, room.draft, discordId);
    } catch (e) {
      console.error("Erreur en quittant la room Random world boss :", e);
    }
  }
}

// Retire un joueur d'une room (3 essais si elle change entre-temps).
async function retirerMembre(roomId, draft, discordId) {
  for (let essai = 0; essai < 3; essai++) {
    if (!draft?.membres?.includes(discordId)) return;
    if (draft.phase === "lobby" && draft.createur === discordId) {
      await supabase.from("rooms").delete().eq("room_id", roomId);
      return;
    }
    const membres = draft.membres.filter(id => id !== discordId);
    const nouveau = { ...draft, membres };
    if (PHASES_EN_COURS.includes(draft.phase)) {
      nouveau.phase = "annule";
      nouveau.annule_par = discordId;
    }
    if (await ecrireDraft(supabase, roomId, nouveau, { membres })) return;
    const { data } = await supabase.from("rooms").select("draft").eq("room_id", roomId).maybeSingle();
    if (!data) return;
    draft = data.draft;
  }
}

// ---- Création (POST /api/rooms { type: "world_boss" }, cf. api/rooms/index.js) ----
async function preparerCreation(user) {
  const profil = (await lireProfils([user.id])).get(user.id);
  return { draft: etatLobby({ createur: user.id, infos: { [user.id]: infosProfil(profil) } }) };
}

// ---- Routes ----

function lireCorps(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function repondre(res, draft, extra = {}) {
  return res.status(200).json({ draft, maintenant: Date.now(), ...extra });
}

// GET : état, dernière activité notée (au plus 1 fois par minute).
async function routeEtat(req, res, roomId) {
  const room = await chargerRoom(roomId);
  if (!room.last_active_at || Date.now() - Date.parse(room.last_active_at) > 60 * 1000) {
    const { error } = await supabase.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("room_id", roomId);
    if (error) console.error("Erreur activité de la room :", error);
  }
  return repondre(res, room.draft, { room_id: roomId });
}

async function routeRejoindre(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.membres.includes(user.id)) return repondre(res, draft);
  if (draft.phase !== "lobby") throw erreur(409, "La partie a déjà commencé.");
  if (draft.membres.length >= TAILLE_MAX) throw erreur(409, `La room est complète (${TAILLE_MAX} joueurs au maximum).`);

  const profil = (await lireProfils([user.id])).get(user.id);
  const membres = [...draft.membres, user.id];
  const nouveau = { ...draft, membres, infos: { ...draft.infos, [user.id]: infosProfil(profil) } };
  await sauvegarder(roomId, nouveau, { membres });
  // Un seul match à la fois : ses autres matchs sont quittés.
  const { annulerAutresMatchs } = require("./room");
  await annulerAutresMatchs(supabase, user.id, { sauf: roomId });
  return repondre(res, nouveau);
}

async function routeQuitter(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  if (room.draft.phase !== "lobby") throw erreur(409, "La partie a commencé : tu ne peux plus quitter la room.");
  await retirerMembre(roomId, room.draft, user.id);
  return res.status(200).json({ ok: true });
}

// Le chef est prêt : boss et persos tirés (full box lues maintenant).
async function routeLancer(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.createur !== user.id) throw erreur(403, "Seul le chef de la room lance la partie.");
  if (draft.phase !== "lobby") throw erreur(409, "La partie a déjà commencé.");
  if (draft.membres.length < TAILLE_MIN) throw erreur(409, `Il faut au moins ${TAILLE_MIN} joueurs.`);

  await actualiserPoints();
  const profils = await lireProfils(draft.membres);
  const boxes = Object.fromEntries(draft.membres.map(id => [id, persosFullBox(profils.get(id)?.data)]));
  const vides = draft.membres.filter(id => boxes[id].length === 0);
  if (vides.length) {
    throw erreur(409, `Full box vide (à remplir dans Mon compte) : ${vides.map(id => infosProfil(profils.get(id)).nom).join(", ")}.`);
  }
  const persos = tirerPersos(draft.membres, boxes);
  if (!persos) throw erreur(409, "Impossible de tirer 4 persos jouables avec vos full box (chaque joueur doit pouvoir jouer ses persos).");

  // Versions des persos tirés chez chaque joueur (constellation, niveau) :
  // pour la déclaration et l'archive, sans garder les full box entières.
  const versions = Object.fromEntries(persos.map(perso => [perso.perso_id, Object.fromEntries(draft.membres
    .map(id => [id, versionDe(boxes[id], perso)])
    .filter(([, version]) => version)
    .map(([id, version]) => [id, { constellation: version.constellation, niveau: version.niveau }]))]));

  Object.assign(draft, {
    phase: "jeu",
    joueurs: [...draft.membres],
    infos: Object.fromEntries(draft.membres.map(id => [id, infosProfil(profils.get(id))])),
    boss_id: await tirerBoss(draft.boss_precedent_id),
    persos,
    versions,
    joues: {},
    reussite: null,
    id_partie: null
  });
  await sauvegarder(roomId, draft);
  return repondre(res, draft);
}

async function terminerSiComplet(roomId, draft) {
  if (!toutDeclare(draft)) return;
  // Partie réservée (écriture conditionnelle) avant d'être archivée : une
  // seule archive même si 2 déclarations arrivent en même temps.
  draft.phase = "termine";
  await sauvegarder(roomId, draft);
  draft.id_partie = await archiver(draft);
  try {
    await sauvegarder(roomId, draft);
  } catch (e) {
    if (!e?.conflit) throw e;
  }
}

// { persos: [perso_id] } : persos joués par ce joueur (remplace sa
// déclaration précédente).
async function routeDeclarer(req, res, roomId, user) {
  const { persos } = lireCorps(req);
  if (!Array.isArray(persos)) throw erreur(400, "Persos manquants");
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "jeu") throw erreur(409, "Ce n'est pas le moment de déclarer les persos.");
  if (!draft.joueurs.includes(user.id)) throw erreur(403, "Tu ne joues pas cette partie.");

  const choisis = [...new Set(persos)];
  for (const persoId of choisis) {
    const perso = draft.persos.find(p => p.perso_id === persoId);
    if (!perso) throw erreur(400, "Ce perso n'a pas été tiré.");
    if (!draft.versions?.[persoId]?.[user.id]) throw erreur(409, "Tu n'as pas ce perso dans ta full box.");
    const autre = draft.joueurs.find(id => id !== user.id && (draft.joues?.[id] || []).includes(persoId));
    if (autre) throw erreur(409, `${draft.infos?.[autre]?.nom || "Un autre joueur"} a déjà déclaré ce perso.`);
  }
  const max = maxPersosJoueur(draft, user.id);
  if (choisis.length > max) {
    throw erreur(409, draft.joueurs.length === 3
      ? "À 3, un seul joueur joue 2 persos (les autres en jouent 1)."
      : `${max} perso${max > 1 ? "s" : ""} au maximum par joueur.`);
  }
  draft.joues = { ...draft.joues, [user.id]: choisis };
  await terminerSiComplet(roomId, draft);
  if (draft.phase === "jeu") await sauvegarder(roomId, draft);
  return repondre(res, draft);
}

// { reussite: true | false } : le chef déclare le résultat du combat.
async function routeResultat(req, res, roomId, user) {
  const { reussite } = lireCorps(req);
  if (typeof reussite !== "boolean") throw erreur(400, "Résultat manquant");
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.phase !== "jeu") throw erreur(409, "Ce n'est pas le moment de déclarer le résultat.");
  if (draft.createur !== user.id) throw erreur(403, "Seul le chef déclare la réussite ou l'échec.");
  draft.reussite = reussite;
  await terminerSiComplet(roomId, draft);
  if (draft.phase === "jeu") await sauvegarder(roomId, draft);
  return repondre(res, draft);
}

// Chef : retour au lobby avec les mêmes joueurs (partie en cours abandonnée,
// pas archivée).
async function routeRejouer(req, res, roomId, user) {
  const room = await chargerRoom(roomId);
  const draft = room.draft;
  if (draft.createur !== user.id) throw erreur(403, "Seul le chef de la room peut relancer.");
  if (draft.phase === "lobby") return repondre(res, draft);
  const nouveau = etatLobby({
    createur: draft.createur,
    membres: draft.membres,
    infos: draft.infos,
    bossPrecedent: draft.boss_id || draft.boss_precedent_id || null,
    version: draft.version
  });
  await sauvegarder(roomId, nouveau, { membres: nouveau.membres });
  return repondre(res, nouveau);
}

const ROUTES = {
  wb_etat: { methode: "GET", route: routeEtat },
  wb_rejoindre: { methode: "POST", route: routeRejoindre },
  wb_quitter: { methode: "POST", route: routeQuitter },
  wb_lancer: { methode: "POST", route: routeLancer },
  wb_declarer: { methode: "POST", route: routeDeclarer },
  wb_resultat: { methode: "POST", route: routeResultat },
  wb_rejouer: { methode: "POST", route: routeRejouer }
};

function estRouteWorldBoss(action) {
  return Object.hasOwn(ROUTES, action);
}

async function executerRouteWorldBoss(action, req, res, roomId, user) {
  const { methode, route } = ROUTES[action];
  if (req.method !== methode) {
    res.setHeader("Allow", methode);
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
  return route(req, res, roomId, user);
}

module.exports = {
  estRouteWorldBoss,
  executerRouteWorldBoss,
  preparerCreation,
  quitterWorldBoss,
  // Tests.
  tirerPersos,
  repartissable
};
