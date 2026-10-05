// Classé : au plus 2 victoires par jour contre un même joueur ("premier à 2
// victoires", journée de 4 h à 4 h, heure de Paris, cf. _lib/journee.js).
// Victoire, défaite, égalité : personne n'a 2 victoires, ils peuvent
// continuer. Dès que l'un des deux en a 2, plus de match classé entre eux ce
// jour-là : le matchmaking ne les remet pas face à face (_lib/matchmaking.js)
// et la revanche est refusée (handleRejouer).
//
// Compté depuis match_history : matchs classés de la journée entre les 2
// joueurs, avec un vainqueur (litige ouvert : pas encore de vainqueur ;
// abandon d'un match classé quitté en cours compris), sauf les matchs
// invalidés après un signalement (cf. _lib/signalements.js).
const { supabase } = require("./supabase");
const { debutJournee } = require("./journee");

const VICTOIRES_MAX = 2;

// -> { [idA]: victoires, [idB]: victoires, terminee }.
async function serieDuJour(idA, idB) {
  const serie = { [idA]: 0, [idB]: 0, terminee: false };
  if (!idA || !idB || idA === idB) return serie;
  const { data, error } = await supabase
    .from("match_history")
    .select("player1_discord_id, player2_discord_id, vainqueur, litige")
    .eq("classe", true)
    .gte("created_at", new Date(debutJournee()).toISOString())
    .in("vainqueur", ["j1", "j2"])
    .or(`and(player1_discord_id.eq.${idA},player2_discord_id.eq.${idB}),and(player1_discord_id.eq.${idB},player2_discord_id.eq.${idA})`);
  if (error) {
    // Colonnes du classé absentes : pas de limite.
    console.error("Erreur lecture série classée :", error);
    return serie;
  }
  (data || []).filter(match => match.litige !== "invalide").forEach(match => {
    const gagnant = match.vainqueur === "j1" ? match.player1_discord_id : match.player2_discord_id;
    if (gagnant in serie) serie[gagnant] += 1;
  });
  serie.terminee = serie[idA] >= VICTOIRES_MAX || serie[idB] >= VICTOIRES_MAX;
  return serie;
}

// Série du jour vue par les rôles d'une manche -> { j1, j2, terminee }.
async function serieDraft(draft) {
  const serie = await serieDuJour(draft.discord_j1, draft.discord_j2);
  return { j1: serie[draft.discord_j1] || 0, j2: serie[draft.discord_j2] || 0, terminee: serie.terminee };
}

module.exports = { VICTOIRES_MAX, serieDuJour, serieDraft };
