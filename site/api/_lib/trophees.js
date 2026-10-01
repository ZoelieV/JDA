// Trophées des matchs classés (matchmaking "Classé", rooms de type
// "classe") : le gagnant gagne des trophées, le perdant en perd autant.
// Un demi-trophée par seconde d'écart entre les 2 temps, arrondi au
// supérieur, au plus TROPHEES_MAX ; égalité (cf. determinerVainqueur) : 0.
// Le total d'un joueur part de 0 et ne descend jamais sous 0 : il est
// recalculé en rejouant ses matchs classés dans l'ordre (un litige
// republié plus tard reprend sa place à sa date).
const TROPHEES_MAX = 30;

// Trophées en jeu dans un match terminé (vainqueur "j1" | "j2" | "egalite").
function calculerTrophees(tempsJ1, tempsJ2, vainqueur) {
  if (vainqueur !== "j1" && vainqueur !== "j2") return 0;
  const ecart = Math.abs(tempsJ1.secondes - tempsJ2.secondes);
  return Math.min(TROPHEES_MAX, Math.ceil(ecart / 2));
}

// Match classé qui compte : classé, terminé (pas un litige ouvert).
function compteEnClasse(match) {
  return !!match.classe && match.litige !== "ouvert" && !!match.vainqueur;
}

// matchs : lignes de match_history (player1/2_discord_id, vainqueur,
// classe, trophees, litige, created_at, id).
// -> Map discord_id -> { trophees, matchs, victoires } (joueurs ayant au
// moins un match classé).
function totauxTrophees(matchs) {
  const ordre = match => [match.created_at ? Date.parse(match.created_at) : 0, Number(match.id) || 0];
  const classes = matchs.filter(compteEnClasse).sort((a, b) => {
    const [da, ia] = ordre(a);
    const [db, ib] = ordre(b);
    return da - db || ia - ib;
  });

  const totaux = new Map();
  const joueur = discordId => {
    if (!totaux.has(discordId)) totaux.set(discordId, { trophees: 0, matchs: 0, victoires: 0 });
    return totaux.get(discordId);
  };

  classes.forEach(match => {
    const enJeu = Number(match.trophees) || 0;
    ["j1", "j2"].forEach(role => {
      const discordId = match[`player${role === "j1" ? 1 : 2}_discord_id`];
      if (!discordId) return;
      const t = joueur(discordId);
      t.matchs += 1;
      if (match.vainqueur === role) {
        t.victoires += 1;
        t.trophees += enJeu;
      } else if (match.vainqueur !== "egalite") {
        t.trophees = Math.max(0, t.trophees - enJeu);
      }
    });
  });
  return totaux;
}

module.exports = { TROPHEES_MAX, calculerTrophees, totauxTrophees };
