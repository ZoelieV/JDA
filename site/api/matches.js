// Historique des matchs (page Historique) : les derniers matchs terminés,
// avec pour chaque joueur son nom, sa photo, sa deuxième bannière, son temps,
// son équipe, ses bans et ses bans d'équilibrage.
const { supabase } = require("./_lib/supabase");

const NB_MATCHS_MAX = 200;
const BANNIERE2_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";

async function chargerMatchs() {
  // Colonnes optionnelles (id, created_at, actions) : "*" les renvoie si
  // elles existent. Tri par date si possible, sinon par id.
  let { data, error } = await supabase
    .from("match_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(NB_MATCHS_MAX);

  if (error) {
    ({ data, error } = await supabase.from("match_history").select("*").limit(NB_MATCHS_MAX));
  }
  if (error) throw error;
  return data || [];
}

async function chargerJoueurs(ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("profiles")
    .select("discord_id, discord_username, discord_global_name, discord_avatar_url, data")
    .in("discord_id", ids);
  if (error) throw error;
  return new Map((data || []).map(profil => [profil.discord_id, profil]));
}

// Côté d'un joueur dans un match. Sans la colonne "actions" (anciens
// matchs) : équipe seulement, bans inconnus.
function resumerJoueur(match, role, profil) {
  const actions = Array.isArray(match.actions) ? match.actions : null;
  const siennes = actions ? actions.filter(a => a.joueur === role) : [];
  const parametres = profil?.data?.parametres || {};

  return {
    discord_id: match[`player${role === "j1" ? 1 : 2}_discord_id`],
    nom: profil?.discord_global_name || profil?.discord_username || "Joueur inconnu",
    avatar: profil?.discord_avatar_url || null,
    banniere2: parametres.banniere2 || BANNIERE2_DEFAUT,
    // Variantes affichées (Voyageur, Manekin), cf. commun/variantes.js.
    parametres: { voyageur: parametres.voyageur || null, manekin: parametres.manekin || null },
    box: match[`box_${role}`] || null,
    temps: match[`temps_${role}_affiche`]
      ? { affiche: match[`temps_${role}_affiche`], secondes: match[`temps_${role}_secondes`] }
      : null,
    equipe: actions
      ? siennes.filter(a => a.type === "pick").map(a => ({ id: a.perso_id, element: a.element || null }))
      : (match[`team_${role}`] || []).map(id => ({ id, element: null })),
    bans: siennes.filter(a => a.type === "ban" && !a.bonus).map(a => a.perso_id),
    bans_equilibrage: siennes.filter(a => a.type === "ban" && a.bonus).map(a => a.perso_id)
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const matchs = await chargerMatchs();
    const ids = [...new Set(matchs.flatMap(m => [m.player1_discord_id, m.player2_discord_id]).filter(Boolean))];
    const joueurs = await chargerJoueurs(ids);

    return res.status(200).json(matchs.map((match, index) => ({
      id: match.id ?? index,
      date: match.created_at || null,
      boss_id: match.boss_id,
      vainqueur: match.vainqueur,
      bans_connus: Array.isArray(match.actions),
      j1: resumerJoueur(match, "j1", joueurs.get(match.player1_discord_id)),
      j2: resumerJoueur(match, "j2", joueurs.get(match.player2_discord_id))
    })));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur chargement de l'historique" });
  }
};
