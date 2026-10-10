// Archivage d'une manche dans match_history (historique, classement) :
// fin de match, litige, ou abandon d'un match classé quitté en cours (cf.
// annulerAutresMatchs dans _lib/room.js).
const { supabase } = require("./supabase");
const { infosPersoJoueur, aBonusSaison } = require("./personnages");
const { getEquipeJoueur, getBansJoueur } = require("./draft");
const { calculerTrophees, rejouerClasse, chargerMatchsClasses } = require("./trophees");
const { chargerDonneesBoxes } = require("./boxes");
const { enregistrerMorts } = require("./legendes");
const { saisonActuelle } = require("./saisons");

// Codes "colonne inexistante" (Postgres / PostgREST).
const COLONNES_INEXISTANTES = new Set(["42703", "PGRST204"]);

// litige : manche contestée, archivée sans vainqueur avec litige = "ouvert"
// (visible des administrateurs seulement, qui peuvent corriger les temps et
// la republier, cf. api/matches.js).
// classe : room du matchmaking classé, trophées en jeu enregistrés (calculés
// à la republication pour un litige).
// Renvoie l'id du match archivé (null si l'archivage a échoué).
// triche : { duree_saisie, somme_temps } (anti-triche, cf. _lib/sanctions.js).
// suspicion : temps sous les meilleurs temps connus (cf.
// detecterTempsSuspects, _lib/sanctions.js).
async function archiverMatch(draft, { litige = false, classe = false, triche = null, suspicion = null } = {}) {
  // Liste du bonus de saison à jour (cache 30 s).
  await require("./personnages").actualiserPoints();
  // Picks figés avec les infos du joueur à la fin du match (constellation,
  // niveau, raffinement de l'arme signature) pour l'historique ; bans avec
  // les infos des 2 joueurs (comme les cartes de la draft).
  // Profils des box jouées (entraînement : celles des propriétaires des box
  // choisies, pas forcément les joueurs présents).
  const boxes = await chargerDonneesBoxes(draft);
  const profils = { j1: boxes.j1.data, j2: boxes.j2.data };
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
    // Entraînement : propriétaires des box jouées ; visible du lanceur
    // seulement (entrainement, lanceur_discord_id, cf. sql/entrainement.sql).
    player1_discord_id: draft.entrainement ? boxes.j1.proprietaire : draft.discord_j1,
    player2_discord_id: draft.entrainement ? boxes.j2.proprietaire : draft.discord_j2,
    ...(draft.entrainement ? { entrainement: true, lanceur_discord_id: draft.entrainement.lanceur } : {}),
    box_j1: draft.box_j1,
    box_j2: draft.box_j2,
    team_j1: getEquipeJoueur(draft, "j1"),
    team_j2: getEquipeJoueur(draft, "j2"),
    // Bans de draft et d'équilibrage de chaque joueur, avec les infos des
    // 2 joueurs sur le personnage (colonnes jsonb bans_j1 / bans_j2).
    bans_j1: getBansJoueur(actions, "j1"),
    bans_j2: getBansJoueur(actions, "j2"),
    // Entraînement : pas de temps saisis.
    temps_j1_affiche: draft.temps_j1?.affiche ?? null,
    temps_j1_secondes: draft.temps_j1?.secondes ?? null,
    temps_j2_affiche: draft.temps_j2?.affiche ?? null,
    temps_j2_secondes: draft.temps_j2?.secondes ?? null,
    vainqueur: draft.vainqueur,
    // Théâtre joué (palier 1..4, nombre de bans ; anciens matchs : 6 à 12)
    // et mode de la room (cf. MODES_THEATRE, _lib/draft.js).
    theatre: draft.theatre ?? null,
    mode_theatre: draft.mode_theatre || "auto",
    ...(litige ? { litige: "ouvert", litige_par: draft.litige_par } : {}),
    // Raison donnée par le joueur qui a signalé le litige (sql/litiges_commentaire.sql).
    ...(litige && draft.litige_commentaire ? { litige_commentaire: draft.litige_commentaire } : {}),
    ...(triche ? { triche: true, duree_saisie: triche.duree_saisie, somme_temps: triche.somme_temps } : {}),
    ...(suspicion ? { triche: true, suspicion } : {}),
    ...(classe ? {
      classe: true,
      // Persos de l'équipe avec le bonus de saison au moment du match (la
      // liste change d'une saison à l'autre ; cf. sql/bonus_saison.sql).
      bonus_saison_j1: draft.actions.filter(a => a.type === "pick" && a.joueur === "j1" && aBonusSaison(a.perso_id, a.element)).length,
      bonus_saison_j2: draft.actions.filter(a => a.type === "pick" && a.joueur === "j2" && aBonusSaison(a.perso_id, a.element)).length,
      trophees: litige ? null : calculerTrophees(draft.temps_j1, draft.temps_j2, draft.vainqueur, draft.boss_id)
    } : {}),
    // Toutes les actions (bans, bans d'équilibrage, picks avec l'élément du
    // Voyageur / Manekin) : affichées dans l'historique des matchs.
    actions,
    // Saison en cours (cf. _lib/saisons.js, sql/saisons.sql).
    saison: await saisonActuelle()
  };

  const inserer = ligne => supabase.from("match_history").insert(ligne).select("id").single();
  let { data, error } = await inserer(match);

  // Colonnes facultatives (actions, theatre, mode_theatre) pas encore
  // créées dans la table : archivage sans elles (les bans restent
  // enregistrés dans bans_j1 / bans_j2 ; cf. sql/theatre.sql). Colonnes litige
  // absentes (sql/litiges.sql pas lancé) : nouvelle erreur, le litige n'est
  // pas archivé (jamais publié comme un match normal) ; idem pour un match
  // classé sans les colonnes classe / trophees (sql/classe.sql).
  // Colonnes récentes absentes (SQL pas lancé) : archivage sans elles
  // seulement, une à une (suspicion : sql/temps_suspects.sql ; saison :
  // sql/saisons.sql, match compté en saison 0).
  let reduit = match;
  for (const colonne of ["suspicion", "saison"]) {
    if (!error || !COLONNES_INEXISTANTES.has(error.code)) break;
    reduit = Object.fromEntries(Object.entries(reduit).filter(([cle]) => cle !== colonne));
    ({ data, error } = await inserer(reduit));
  }
  if (error && COLONNES_INEXISTANTES.has(error.code)) {
    const { actions, theatre, mode_theatre, bonus_saison_j1, bonus_saison_j2, triche, duree_saisie, somme_temps, litige_commentaire, saison, suspicion, ...sansFacultatives } = match;
    ({ data, error } = await inserer(sansFacultatives));
  }

  if (error) {
    console.error(`Erreur archivage match_history${litige ? " (litige)" : ""} :`, error);
    return null;
  }
  // Légende locale : tuée par chaque joueur qui a saisi un temps (pas un
  // abandon), même en litige. Entraînement : temps saisi plus tard par le
  // lanceur (cf. handleTempsEntrainement).
  if (!draft.entrainement) {
    await enregistrerMorts(draft.boss_id, data?.id ?? null, ["j1", "j2"].map(role => ({
      discord_id: draft[`discord_${role}`],
      temps_secondes: draft[`temps_${role}`]?.secondes ?? null
    })));
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
