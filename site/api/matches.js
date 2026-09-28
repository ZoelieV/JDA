// Historique des matchs (page Historique) : les matchs en cours (rooms
// actives, à regarder en spectateur) et les derniers matchs terminés, avec
// pour chaque joueur son nom, sa photo, sa deuxième bannière, son temps, son
// équipe, ses bans et ses bans d'équilibrage.
const { supabase } = require("./_lib/supabase");

const NB_MATCHS_MAX = 200;
const NB_ROOMS_MAX = 30;
// Room sans activité depuis plus longtemps : considérée comme abandonnée
// (le nettoyage automatique la supprime après 1 h).
const INACTIVITE_MAX_MS = 60 * 60 * 1000;
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

// Rooms à 2 joueurs dont la manche n'est pas terminée.
async function chargerRoomsEnCours() {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .not("player2_discord_id", "is", null)
    .order("last_active_at", { ascending: false })
    .limit(NB_ROOMS_MAX);

  if (error) {
    // Pas bloquant : l'historique reste affiché sans les matchs en cours.
    console.error("Erreur lecture rooms :", error);
    return [];
  }

  const limite = Date.now() - INACTIVITE_MAX_MS;
  return (data || []).filter(room =>
    room.draft?.phase && room.draft.phase !== "termine" &&
    (!room.last_active_at || Date.parse(room.last_active_at) >= limite)
  );
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
  const discordId = match[`player${role === "j1" ? 1 : 2}_discord_id`];
  const siennes = actions ? actions.filter(a => a.joueur === role) : [];
  const parametres = profil?.data?.parametres || {};

  return {
    discord_id: discordId,
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
    const [matchs, rooms] = await Promise.all([chargerMatchs(), chargerRoomsEnCours()]);

    // Rooms en cours au même format que les matchs : j1/j2 de la manche,
    // actions de la draft jusqu'ici.
    const enCours = rooms.map(room => ({
      room_id: room.room_id,
      phase: room.draft.phase,
      boss_id: room.draft.boss_id || null,
      player1_discord_id: room.draft.discord_j1 || room.player1_discord_id,
      player2_discord_id: room.draft.discord_j2 || room.player2_discord_id,
      box_j1: room.draft.phase === "choix_box" ? null : room.draft.box_j1,
      box_j2: room.draft.phase === "choix_box" ? null : room.draft.box_j2,
      temps_j1_affiche: null,
      temps_j2_affiche: null,
      actions: room.draft.actions || [],
      date: room.last_active_at || null
    }));

    const ids = [...new Set([...matchs, ...enCours]
      .flatMap(m => [m.player1_discord_id, m.player2_discord_id]).filter(Boolean))];
    const joueurs = await chargerJoueurs(ids);
    const deuxJoueurs = match => ({
      j1: resumerJoueur(match, "j1", joueurs.get(match.player1_discord_id)),
      j2: resumerJoueur(match, "j2", joueurs.get(match.player2_discord_id))
    });

    return res.status(200).json({
      en_cours: enCours.map(room => ({
        room_id: room.room_id,
        phase: room.phase,
        boss_id: room.boss_id,
        date: room.date,
        ...deuxJoueurs(room)
      })),
      termines: matchs.map((match, index) => ({
        id: match.id ?? index,
        date: match.created_at || null,
        boss_id: match.boss_id,
        vainqueur: match.vainqueur,
        bans_connus: Array.isArray(match.actions),
        ...deuxJoueurs(match)
      }))
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur chargement de l'historique" });
  }
};
