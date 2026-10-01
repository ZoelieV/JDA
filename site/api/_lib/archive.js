// Archivage d'une manche dans match_history (historique, classement) :
// fin de match, litige, ou abandon d'un match classé quitté en cours (cf.
// annulerAutresMatchs dans _lib/room.js).
const { supabase } = require("./supabase");
const { infosPersoJoueur } = require("./personnages");
const { getEquipeJoueur, getBansJoueur } = require("./draft");
const { calculerTrophees, rejouerClasse, chargerMatchsClasses } = require("./trophees");

// Codes "colonne inexistante" (Postgres / PostgREST).
const COLONNES_INEXISTANTES = new Set(["42703", "PGRST204"]);

// litige : manche contestée, archivée sans vainqueur avec litige = "ouvert"
// (visible des administrateurs seulement, qui peuvent corriger les temps et
// la republier, cf. api/matches.js).
// classe : room du matchmaking classé, trophées en jeu enregistrés (calculés
// à la republication pour un litige).
// Renvoie l'id du match archivé (null si l'archivage a échoué).
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

  const inserer = ligne => supabase.from("match_history").insert(ligne).select("id").single();
  let { data, error } = await inserer(match);

  // Colonne "actions" pas encore créée dans la table : archivage sans elle
  // (les bans restent enregistrés dans bans_j1 / bans_j2). Colonnes litige
  // absentes (sql/litiges.sql pas lancé) : nouvelle erreur, le litige n'est
  // pas archivé (jamais publié comme un match normal) ; idem pour un match
  // classé sans les colonnes classe / trophees (sql/classe.sql).
  if (error && COLONNES_INEXISTANTES.has(error.code)) {
    const { actions, ...sansActions } = match;
    ({ data, error } = await inserer(sansActions));
  }

  if (error) {
    console.error(`Erreur archivage match_history${litige ? " (litige)" : ""} :`, error);
    return null;
  }
  return data?.id ?? null;
}

// Match classé archivé : trophées réellement gagnés / perdus par chaque
// joueur (bonus de série et plancher à 0 compris), affichés en fin de match.
async function resultatTrophees(idMatch) {
  if (idMatch == null) return null;
  return rejouerClasse(await chargerMatchsClasses(supabase)).deltas.get(String(idMatch)) || null;
}

module.exports = { archiverMatch, resultatTrophees };
