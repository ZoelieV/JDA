const { etatInitialDraft } = require("./draft");
const { archiverMatch, resultatTrophees } = require("./archive");
const { TEMPS_ABANDON, determinerVainqueur } = require("./temps");

// Détermine si l'utilisateur connecté est j1, j2, ou ni l'un ni l'autre
// pour une room donnée. j1/j2 sont les rôles DE LA MANCHE EN COURS
// (draft.discord_j1 / draft.discord_j2 : places provisoires, puis tirées
// au sort et échangées à chaque revanche — cf. lancerTirage et
// etatRevanche dans _lib/draft.js), pas
// forcément "qui a créé la room" (room.player1_discord_id). Le repli sur
// les colonnes de room sert uniquement de filet avant que les rôles de
// la manche n'aient été assignés (ex : tout premier accès).
function determinerRole(room, discordId) {
  const draft = room.draft || {};
  const idJ1 = draft.discord_j1 || room.player1_discord_id;
  const idJ2 = draft.discord_j2 || room.player2_discord_id;

  if (idJ1 === discordId) return "j1";
  if (idJ2 === discordId) return "j2";
  return null;
}

function getAutreJoueur(joueur) {
  return joueur === "j1" ? "j2" : "j1";
}

function getDiscordIdJoueur(room, joueur) {
  const draft = room.draft || {};
  if (joueur === "j1") return draft.discord_j1 || room.player1_discord_id;
  return draft.discord_j2 || room.player2_discord_id;
}

// Écriture de la draft d'une room, seulement si personne ne l'a modifiée
// depuis sa lecture : draft.version augmente à chaque écriture et la mise à
// jour est conditionnée à la version lue. Deux requêtes simultanées (double
// clic, envois en parallèle) ne peuvent donc pas appliquer deux fois la
// même transition (ex. un match archivé deux fois, trophées doublés).
// colonnes : autres colonnes de la room écrites en même temps (ex. membres
// d'une room d'équipe).
// -> true si écrite (draft.version mise à jour), false si la room a changé
// entre-temps ; erreur Supabase levée.
async function ecrireDraft(supabase, roomId, draft, colonnes = {}) {
  const lue = draft.version ?? null;
  const suivante = { ...draft, version: (Number(lue) || 0) + 1 };
  let requete = supabase.from("rooms").update({ ...colonnes, draft: suivante }).eq("room_id", roomId);
  requete = lue === null ? requete.is("draft->>version", null) : requete.eq("draft->>version", String(lue));
  const { data, error } = await requete.select("room_id");
  if (error) throw error;
  if (!data?.length) return false;
  draft.version = suivante.version;
  return true;
}

// Place provisoirement les 2 joueurs (créateur de la room en j1) au 1er
// accès à une room complète. Le vrai tirage j1/j2 n'a lieu qu'après les
// bans d'équilibrage (lancerTirage dans _lib/draft.js), qui échange ou non
// ces places. Idempotent : ne fait rien si déjà assigné.
async function assurerRolesDraft(supabase, room) {
  if (room.draft && room.draft.discord_j1 && room.draft.discord_j2) {
    return room;
  }

  const draft = { ...etatInitialDraft(), ...(room.draft || {}) };
  draft.discord_j1 = room.player1_discord_id;
  draft.discord_j2 = room.player2_discord_id;
  draft.roles_tires = false;

  try {
    if (await ecrireDraft(supabase, room.room_id, draft)) return { ...room, draft };
    // Rôles assignés entre-temps par une autre requête : draft relue.
    const { data } = await supabase.from("rooms").select("draft").eq("room_id", room.room_id).maybeSingle();
    if (data?.draft) return { ...room, draft: data.draft };
  } catch (error) {
    console.error("Erreur assignation des rôles :", error);
  }
  return room;
}

// Charge la room (avec sa draft) et vérifie que l'utilisateur en fait
// partie. Retourne { room, joueur } ou lève une erreur { status, message }
// à catcher dans la route pour répondre directement au client.
// autoriserSpectateur : lecture seule ouverte à tous (joueur = null pour
// quelqu'un qui n'est ni j1 ni j2).
// agirEn : entraînement joué seul (même compte en j1 et j2) -> rôle dans
// lequel le lanceur agit ("j1" | "j2", celui dont c'est le tour, envoyé par
// sa page).
async function chargerRoomAvecRole(supabase, roomId, discordId, { autoriserSpectateur = false, agirEn = null } = {}) {
  const { data: room, error } = await supabase
    .from("rooms")
    .select("room_id, player1_discord_id, player2_discord_id, type, draft, spectateurs")
    .eq("room_id", roomId)
    .single();

  if (error || !room) {
    throw { status: 404, message: "Room introuvable" };
  }

  if (!room.player1_discord_id || !room.player2_discord_id) {
    throw { status: 400, message: "La room n'est pas encore complète (2 joueurs requis)" };
  }

  const roomAvecRoles = await assurerRolesDraft(supabase, room);
  let joueur = determinerRole(roomAvecRoles, discordId);
  const d = roomAvecRoles.draft;
  if (joueur && d?.entrainement && d.discord_j1 === d.discord_j2 && ["j1", "j2"].includes(agirEn)) joueur = agirEn;

  if (!joueur && !autoriserSpectateur) {
    throw { status: 403, message: "Tu ne fais pas partie de cette room (spectateur)" };
  }

  return { room: roomAvecRoles, joueur };
}

// ---- Un seul match à la fois ----
// Un joueur qui démarre un autre match (match privé créé ou rejoint,
// recherche de matchmaking) quitte ses autres rooms :
// - room encore en attente d'un adversaire : supprimée ;
// - manche en cours : annulée (phase "annule", annule_par = son rôle),
//   rien dans l'historique ; en classé, comptée comme un abandon : défaite
//   archivée avec perte des trophées, victoire de l'adversaire
//   (abandon_classe, cf. abandonnerMatchClasse) ;
// - manche terminée (termine / litige) : résultat gardé, revanche
//   impossible (quitte_par = son rôle).
// sauf : room à garder (celle qu'il rejoint ou sa room d'attente).
const PHASES_FINIES = ["termine", "litige", "annule"];

// Match classé quitté en cours : abandon de ce joueur (temps "Abandon"),
// l'adversaire garde son temps s'il l'avait saisi. Archivé comme un match
// classé (trophées au maximum, cf. calculerTrophees) ; la room passe en
// "annule" avec le résultat pour l'écran de l'adversaire. Room d'abord
// passée en "annule" (écriture conditionnelle), archivée ensuite : jamais
// deux archivages pour un même abandon.
// -> false si la room a changé entre-temps (rien archivé).
async function abandonnerMatchClasse(supabase, roomId, draft, role) {
  const autre = role === "j1" ? "j2" : "j1";
  const tempsAutre = draft[`temps_${autre}`] || { affiche: "—", secondes: null };
  const final = {
    ...draft,
    [`temps_${role}`]: { ...TEMPS_ABANDON },
    [`temps_${autre}`]: tempsAutre
  };
  final.vainqueur = determinerVainqueur(final.temps_j1, final.temps_j2);
  const annule = {
    ...final,
    phase: "annule",
    annule_par: role,
    abandon_classe: true,
    resultat_trophees: null
  };
  if (!await ecrireDraft(supabase, roomId, annule)) return false;

  const idMatch = await archiverMatch(final, { classe: true });
  annule.resultat_trophees = await resultatTrophees(idMatch);
  if (!await ecrireDraft(supabase, roomId, annule)) console.error("Résultat de l'abandon pas enregistré (room modifiée) :", roomId);
  return true;
}

async function annulerAutresMatchs(supabase, discordId, { sauf = null } = {}) {
  let requete = supabase
    .from("rooms")
    .select("room_id, player1_discord_id, player2_discord_id, type, draft")
    .or(`player1_discord_id.eq.${discordId},player2_discord_id.eq.${discordId}`)
    // Rooms d'équipe : cf. quitterEquipes (_lib/equipe.js).
    .neq("type", "equipe");
  if (sauf) requete = requete.neq("room_id", sauf);
  // Chargé ici (equipe.js utilise aussi ce fichier).
  await require("./equipe").quitterEquipes(discordId, { sauf });
  const { data, error } = await requete;
  if (error) {
    console.error("Erreur lecture des matchs du joueur :", error);
    return;
  }

  for (const room of data || []) {
    if (!room.player2_discord_id) {
      await supabase.from("rooms").delete().eq("room_id", room.room_id).is("player2_discord_id", null);
      continue;
    }
    try {
      await quitterRoom(supabase, room, discordId);
    } catch (erreur) {
      console.error("Erreur annulation du match :", erreur);
    }
  }
}

// Une room complète quittée (cf. annulerAutresMatchs) ; room modifiée
// entre-temps par une autre requête : relue, jusqu'à 3 essais.
async function quitterRoom(supabase, room, discordId) {
  for (let essai = 0; essai < 3; essai++) {
    // Room complète pas encore ouverte (draft pas encore créée).
    const draft = room.draft || { ...etatInitialDraft(), discord_j1: room.player1_discord_id, discord_j2: room.player2_discord_id };
    const role = determinerRole({ ...room, draft }, discordId);
    if (!role) return;
    if (draft.phase === "annule" || draft.quitte_par) return;

    let ecrite;
    if (PHASES_FINIES.includes(draft.phase)) {
      ecrite = await ecrireDraft(supabase, room.room_id, { ...draft, quitte_par: role, rejouer_j1: false, rejouer_j2: false });
    } else if (room.type === "classe") {
      ecrite = await abandonnerMatchClasse(supabase, room.room_id, draft, role);
    } else {
      ecrite = await ecrireDraft(supabase, room.room_id, { ...draft, phase: "annule", annule_par: role });
    }
    if (ecrite) return;

    const { data } = await supabase
      .from("rooms")
      .select("room_id, player1_discord_id, player2_discord_id, type, draft")
      .eq("room_id", room.room_id)
      .maybeSingle();
    if (!data) return;
    room = data;
  }
  console.error("Match pas annulé (room modifiée en continu) :", room.room_id);
}

module.exports = {
  ecrireDraft,
  annulerAutresMatchs,
  determinerRole,
  getAutreJoueur,
  getDiscordIdJoueur,
  assurerRolesDraft,
  chargerRoomAvecRole
};