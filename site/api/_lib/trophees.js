// Trophées des matchs classés (matchmaking "Classé", rooms de type
// "classe") : le gagnant gagne des trophées, le perdant en perd autant.
// Un demi-trophée par seconde d'écart entre les 2 temps, arrondi au
// supérieur, au plus TROPHEES_MAX ; égalité (cf. determinerVainqueur) : 0.
// Série de victoires en classé (matchs consécutifs du joueur, revanche ou
// nouveau match) : bonus pour le gagnant, +1 à la 2e victoire, +2 à la 3e,
// +3 à la 4e et au-delà ; une défaite ou une égalité remet la série à 0.
// Le total d'un joueur part de 0 et ne descend jamais sous 0 : il est
// recalculé en rejouant ses matchs classés dans l'ordre (un litige
// republié plus tard reprend sa place à sa date).
const TROPHEES_MAX = 30;
const BONUS_SERIE_MAX = 3;

// Trophées en jeu dans un match terminé (vainqueur "j1" | "j2" | "egalite"),
// sans le bonus de série (colonne match_history.trophees).
// Abandon d'un joueur : écart "infini", trophées au maximum.
function calculerTrophees(tempsJ1, tempsJ2, vainqueur) {
  if (vainqueur !== "j1" && vainqueur !== "j2") return 0;
  if (tempsJ1.abandon || tempsJ2.abandon) return TROPHEES_MAX;
  const ecart = Math.abs(tempsJ1.secondes - tempsJ2.secondes);
  return Math.min(TROPHEES_MAX, Math.ceil(ecart / 2));
}

// Bonus de la n-ième victoire d'affilée (1 -> 0, 2 -> 1, 3 -> 2, 4+ -> 3).
function bonusSerie(victoiresDAffilee) {
  return Math.min(BONUS_SERIE_MAX, Math.max(0, victoiresDAffilee - 1));
}

// Deux classements séparés (trophées et séries indépendants) : Classique
// (mode "auto", théâtre du plus petit clear) et Mêlée générale (mode "12").
// Ancien match sans mode : Classique.
const CLASSEMENTS = ["classique", "melee"];

function classementDuMatch(match) {
  return match.mode_theatre === "12" ? "melee" : "classique";
}

// Match classé qui compte : classé, terminé (pas un litige ouvert).
function compteEnClasse(match) {
  return !!match.classe && match.litige !== "ouvert" && !!match.vainqueur;
}

// matchs : lignes de match_history (player1/2_discord_id, vainqueur,
// classe, trophees, litige, created_at, id).
// -> {
//   joueurs : { classique: Map, melee: Map }, chaque Map discord_id ->
//             { trophees, matchs, victoires, serie } (joueurs ayant au moins
//             un match dans ce classement ; serie = victoires d'affilée en
//             cours),
//   deltas  : Map id du match -> { j1, j2, bonus } (trophées réellement
//             gagnés / perdus, plancher à 0 compris ; bonus de série du
//             gagnant)
// }
function rejouerClasse(matchs) {
  const ordre = match => [match.created_at ? Date.parse(match.created_at) : 0, Number(match.id) || 0];
  const classes = matchs.filter(compteEnClasse).sort((a, b) => {
    const [da, ia] = ordre(a);
    const [db, ib] = ordre(b);
    return da - db || ia - ib;
  });

  const joueurs = Object.fromEntries(CLASSEMENTS.map(c => [c, new Map()]));
  const deltas = new Map();

  classes.forEach(match => {
    const table = joueurs[classementDuMatch(match)];
    const joueur = discordId => {
      if (!table.has(discordId)) table.set(discordId, { trophees: 0, matchs: 0, victoires: 0, serie: 0 });
      return table.get(discordId);
    };
    const enJeu = Number(match.trophees) || 0;
    const delta = { j1: 0, j2: 0, bonus: 0 };
    ["j1", "j2"].forEach(role => {
      const discordId = match[`player${role === "j1" ? 1 : 2}_discord_id`];
      if (!discordId) return;
      const j = joueur(discordId);
      j.matchs += 1;
      if (match.vainqueur === role) {
        j.victoires += 1;
        j.serie += 1;
        delta.bonus = bonusSerie(j.serie);
        delta[role] = enJeu + delta.bonus;
        j.trophees += delta[role];
      } else {
        // Défaite ou égalité : fin de la série.
        j.serie = 0;
        if (match.vainqueur !== "egalite") {
          const avant = j.trophees;
          j.trophees = Math.max(0, j.trophees - enJeu);
          delta[role] = j.trophees - avant;
        }
      }
    });
    if (match.id != null) deltas.set(String(match.id), delta);
  });
  return { joueurs, deltas };
}

// Tous les matchs classés (colonnes utiles au calcul), ou [] sans la
// colonne classe (sql/classe.sql pas lancé). Sans colonne litige
// (sql/litiges.sql pas lancé), aucun litige possible : lecture sans elle.
async function chargerMatchsClasses(supabase) {
  // Colonnes facultatives (litige, mode_theatre) : lecture sans elles si
  // elles n'existent pas encore.
  const champs = "id, created_at, player1_discord_id, player2_discord_id, vainqueur, classe, trophees";
  const lire = select => supabase.from("match_history").select(select).eq("classe", true);
  let { data, error } = await lire(`${champs}, litige, mode_theatre`);
  if (error) ({ data, error } = await lire(`${champs}, litige`));
  if (error) ({ data, error } = await lire(champs));
  if (error) {
    console.error("Erreur lecture matchs classés :", error);
    return [];
  }
  return data || [];
}

module.exports = { TROPHEES_MAX, CLASSEMENTS, calculerTrophees, bonusSerie, rejouerClasse, chargerMatchsClasses };
