// Statistiques d'équilibrage (page admin Équilibrage, tuile « Stats du
// classé ») : équipes des matchs classés valides, pour régler les points des
// persos. Le calcul (record par boss, fenêtre autour du record, persos les
// plus présents) se fait dans la page (admin_ppc/admin_stats_classe.js), pour
// changer la période et les écarts sans rappeler le serveur.
//
// Équipe comptée : match classé 1v1 terminé (vainqueur connu), sans litige
// ni triche détectée, ou litige résolu (corrigé et republié par un
// administrateur : compté même marqué triche ou suspect) ; joueur avec un
// temps (pas d'abandon) qui n'a pas été jugé suspect par l'anti-triche.
// Hors entraînement, modes en équipe, Little Cup et tournois.
const { supabase } = require("./supabase");
const { lireSaisons } = require("./saisons");
const { lirePatchs } = require("./patchs");
const { actualiserPoints } = require("./personnages");
const { reglageBoss, estDefiEnnemis, listeBoss } = require("./boss");

const TAILLE_PAGE = 1000;
const CACHE_MS = 30 * 1000;
let cache = null;

async function lireMatchsClasses() {
  const lignes = [];
  for (let debut = 0; ; debut += TAILLE_PAGE) {
    const { data, error } = await supabase.from("match_history")
      .select("id, created_at, saison, boss_id, player1_discord_id, player2_discord_id, temps_j1_secondes, temps_j2_secondes, vainqueur, litige, triche, suspicion, actions, entrainement, mode_equipe, little_cup, tournoi")
      .eq("classe", true)
      .not("vainqueur", "is", null)
      .order("id", { ascending: true })
      .range(debut, debut + TAILLE_PAGE - 1);
    if (error) throw error;
    lignes.push(...(data || []));
    if (!data || data.length < TAILLE_PAGE) return lignes;
  }
}

// Litige résolu (temps republiés par un administrateur) : compté, même
// marqué triche.
const matchValide = m => !m.entrainement && !m.mode_equipe && !m.little_cup && !m.tournoi &&
  (m.litige === "republie" || (m.litige == null && !m.triche));

// -> { equipes: [{ match, date, saison, boss, joueur, temps, resultat
//      ("victoire" | "defaite" | "egalite"), persos: [{ id, element, c, r,
//      niveau }] }], joueurs: { id: nom }, boss_classe: [ids], defis: [ids],
//      saisons: [{ numero, nom, debut }], patchs: [dates ISO] }
async function lireStatsEquilibrage() {
  if (cache && Date.now() - cache.lu < CACHE_MS) return cache.donnees;
  await actualiserPoints();
  const [matchs, saisons, patchs] = await Promise.all([lireMatchsClasses(), lireSaisons(), lirePatchs()]);
  const equipes = [];
  matchs.filter(matchValide).forEach(m => {
    ["j1", "j2"].forEach(role => {
      const temps = m[`temps_${role}_secondes`];
      if (temps == null || (m.suspicion?.[role] && m.litige !== "republie")) return;
      const persos = (Array.isArray(m.actions) ? m.actions : [])
        .filter(a => a.type === "pick" && a.joueur === role && a.perso_id)
        .map(a => ({ id: a.perso_id, element: a.element || null, c: a.constellation ?? null, r: a.raffinement ?? null, niveau: a.niveau ?? null }));
      if (!persos.length) return;
      const autre = role === "j1" ? "j2" : "j1";
      equipes.push({
        match: m.id,
        date: m.created_at,
        saison: Number.isInteger(Number(m.saison)) ? Number(m.saison) : 0,
        boss: m.boss_id,
        joueur: m[role === "j1" ? "player1_discord_id" : "player2_discord_id"],
        temps: Number(temps),
        resultat: m.vainqueur === role ? "victoire" : m.vainqueur === autre ? "defaite" : "egalite",
        persos
      });
    });
  });
  const ids = [...new Set(equipes.map(e => e.joueur).filter(Boolean))];
  const { data: profils, error } = ids.length
    ? await supabase.from("profiles").select("discord_id, discord_username, discord_global_name").in("discord_id", ids)
    : { data: [] };
  if (error) throw error;
  const joueurs = Object.fromEntries((profils || []).map(p => [p.discord_id, p.discord_global_name || p.discord_username || p.discord_id]));
  const donnees = {
    equipes,
    joueurs,
    boss_classe: reglageBoss("classe").boss,
    defis: listeBoss().filter(b => estDefiEnnemis(b.id)).map(b => b.id),
    saisons,
    patchs: patchs.map(p => p.date).filter(Boolean).sort()
  };
  cache = { lu: Date.now(), donnees };
  return donnees;
}

module.exports = { lireStatsEquilibrage };
