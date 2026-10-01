// Historique des matchs (page Historique) : les matchs en cours (rooms
// actives, à regarder en spectateur) et les derniers matchs terminés, avec
// pour chaque joueur son nom, sa photo, sa deuxième bannière, son temps, son
// équipe, ses bans et ses bans d'équilibrage.
// Administrateurs : en plus, les matchs invalidés par un litige et le nombre
// de litiges par joueur (modération) ; PATCH ?id= corrige les temps d'un
// litige et republie le match (dans ce fichier pour rester sous la limite de
// fonctions serverless du plan Hobby de Vercel).
const { supabase } = require("./_lib/supabase");
const { infosPersoJoueur } = require("./_lib/personnages");
const { parseCookies, verifySessionToken } = require("./_lib/session");
const { estAdmin } = require("./_lib/admin");
const { parserTempsMMSS, determinerVainqueur } = require("./_lib/temps");
const { calculerTrophees, rejouerClasse, chargerMatchsClasses } = require("./_lib/trophees");

const NB_MATCHS_MAX = 200;
const NB_ROOMS_MAX = 30;
// Room sans activité depuis plus longtemps : considérée comme abandonnée
// (le nettoyage automatique la supprime après 1 h).
const INACTIVITE_MAX_MS = 60 * 60 * 1000;
const BANNIERE2_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";
// Théâtre clear du profil : valeur stockée ("1"..."4") -> palier.
const PALIERS_THEATRE = { 1: 6, 2: 8, 3: 10, 4: 12 };

async function chargerMatchs() {
  // Colonnes optionnelles (id, created_at, actions, litige) : "*" les
  // renvoie si elles existent. Litiges ouverts exclus, tri par date si
  // possible ; sans ces colonnes, pas de litige possible ni de tri.
  const requete = () => supabase.from("match_history").select("*");
  let { data, error } = await requete()
    .or("litige.is.null,litige.neq.ouvert")
    .order("created_at", { ascending: false })
    .limit(NB_MATCHS_MAX);

  if (error) {
    ({ data, error } = await requete().order("created_at", { ascending: false }).limit(NB_MATCHS_MAX));
  }
  if (error) {
    ({ data, error } = await requete().limit(NB_MATCHS_MAX));
  }
  if (error) throw error;
  return data || [];
}

// Administrateurs : litiges ouverts (plus récents d'abord).
async function chargerLitigesOuverts() {
  const { data, error } = await supabase
    .from("match_history")
    .select("*")
    .eq("litige", "ouvert")
    .order("created_at", { ascending: false });
  if (error) {
    // Colonnes litige pas encore créées (sql/litiges.sql) : aucun litige.
    console.error("Erreur lecture litiges :", error);
    return [];
  }
  return data || [];
}

// Administrateurs : litiges par joueur (ouverts et republiés), en
// distinguant ceux qu'il a signalés de ceux signalés par son adversaire.
async function chargerStatsLitiges() {
  const { data, error } = await supabase
    .from("match_history")
    .select("player1_discord_id, player2_discord_id, litige, litige_par")
    .not("litige", "is", null);
  if (error) {
    console.error("Erreur lecture stats litiges :", error);
    return [];
  }

  const stats = new Map();
  (data || []).forEach(match => {
    ["j1", "j2"].forEach(role => {
      const discordId = match[`player${role === "j1" ? 1 : 2}_discord_id`];
      if (!discordId) return;
      if (!stats.has(discordId)) {
        stats.set(discordId, { discord_id: discordId, total: 0, ouverts: 0, republies: 0, signales: 0, subis: 0 });
      }
      const s = stats.get(discordId);
      s.total += 1;
      s[match.litige === "ouvert" ? "ouverts" : "republies"] += 1;
      s[match.litige_par === role ? "signales" : "subis"] += 1;
    });
  });
  return [...stats.values()];
}

// ---- PATCH ?id= (administrateurs) : temps corrigés d'un litige ouvert,
// vainqueur recalculé, match republié dans l'historique public ----
async function republierLitige(req, res, user) {
  const id = req.query?.id;
  const tempsJ1 = parserTempsMMSS(req.body?.temps_j1);
  const tempsJ2 = parserTempsMMSS(req.body?.temps_j2);
  if (!id) return res.status(400).json({ error: "Match manquant" });
  if (!tempsJ1 || !tempsJ2) {
    return res.status(400).json({ error: "Format de temps invalide (attendu mm:ss)" });
  }

  // Match classé : trophées calculés avec les temps corrigés.
  const { data: litige, error: erreurLecture } = await supabase
    .from("match_history")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (erreurLecture) throw erreurLecture;
  const vainqueur = determinerVainqueur(tempsJ1, tempsJ2);

  // Seulement un litige encore ouvert (pas de double republication).
  const { data, error } = await supabase
    .from("match_history")
    .update({
      ...(litige?.classe ? { trophees: calculerTrophees(tempsJ1, tempsJ2, vainqueur) } : {}),
      temps_j1_affiche: tempsJ1.affiche,
      temps_j1_secondes: tempsJ1.secondes,
      temps_j2_affiche: tempsJ2.affiche,
      temps_j2_secondes: tempsJ2.secondes,
      vainqueur,
      litige: "republie",
      republie_par: user.id,
      republie_le: new Date().toISOString()
    })
    .eq("id", id)
    .eq("litige", "ouvert")
    .select("id");

  if (error) throw error;
  if (!data || data.length === 0) {
    return res.status(404).json({ error: "Litige introuvable ou déjà republié" });
  }
  return res.status(200).json({ ok: true });
}

// Rooms à 2 joueurs dont la manche n'est pas terminée (ni invalidée par un
// litige).
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
    room.draft?.phase && !["termine", "litige"].includes(room.draft.phase) &&
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

// Côté d'un joueur dans un match. Bans : colonne "actions" si elle existe,
// sinon colonnes bans_j1 / bans_j2. Anciens matchs sans l'une ni l'autre :
// équipe seulement, bans inconnus.
// profils : { j1, j2 } (profils des 2 joueurs du match).
function resumerJoueur(match, role, profils) {
  const profil = profils[role];
  const actions = Array.isArray(match.actions) ? match.actions : null;
  const discordId = match[`player${role === "j1" ? 1 : 2}_discord_id`];
  const siennes = actions ? actions.filter(a => a.joueur === role) : [];
  const bansColonne = Array.isArray(match[`bans_${role}`]) ? match[`bans_${role}`] : [];
  const bans = actions
    ? siennes.filter(a => a.type === "ban")
    : bansColonne.map(b => ({ ...b, type: "ban", joueur: role }));
  const parametres = profil?.data?.parametres || {};

  return {
    discord_id: discordId,
    nom: profil?.discord_global_name || profil?.discord_username || "Joueur inconnu",
    avatar: profil?.discord_avatar_url || null,
    banniere2: parametres.banniere2 || BANNIERE2_DEFAUT,
    // Palier de théâtre actuel (médaille à côté du pseudo), ou null.
    theatre: PALIERS_THEATRE[profil?.data?.theatre] ?? null,
    // Variantes affichées (Voyageur, Manekin), cf. commun/variantes.js.
    parametres: { voyageur: parametres.voyageur || null, manekin: parametres.manekin || null },
    box: match[`box_${role}`] || null,
    temps: match[`temps_${role}_affiche`]
      ? { affiche: match[`temps_${role}_affiche`], secondes: match[`temps_${role}_secondes`] }
      : null,
    // Infos figées à l'archivage si présentes, sinon celles du profil actuel.
    equipe: (actions
      ? siennes.filter(a => a.type === "pick").map(a => ({ ...a, id: a.perso_id }))
      : (match[`team_${role}`] || []).map(id => ({ id }))
    ).map(pick => ({
      id: pick.id,
      element: pick.element || null,
      ...("constellation" in pick
        ? { constellation: pick.constellation, niveau: pick.niveau, raffinement: pick.raffinement }
        : infosPersoJoueur(profil?.data, pick.id, pick.element))
    })),
    bans: bans.filter(a => !a.bonus).map(a => resumerBan(a, profils)),
    bans_equilibrage: bans.filter(a => a.bonus).map(a => resumerBan(a, profils))
  };
}

// Ban : infos des 2 joueurs pour ce personnage (figées à l'archivage si
// présentes, sinon celles des profils actuels).
function resumerBan(action, profils) {
  return {
    id: action.perso_id,
    infos: action.infos || {
      j1: infosPersoJoueur(profils.j1?.data, action.perso_id),
      j2: infosPersoJoueur(profils.j2?.data, action.perso_id)
    }
  };
}

module.exports = async (req, res) => {
  if (req.method !== "GET" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const user = verifySessionToken(parseCookies(req).session);
  const admin = !!user && estAdmin(user.id);

  if (req.method === "PATCH") {
    if (!admin) return res.status(403).json({ error: "Réservé aux administrateurs" });
    try {
      return await republierLitige(req, res, user);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Erreur republication du match" });
    }
  }

  try {
    const [matchs, rooms, litiges, statsLitiges] = await Promise.all([
      chargerMatchs(),
      chargerRoomsEnCours(),
      admin ? chargerLitigesOuverts() : [],
      admin ? chargerStatsLitiges() : []
    ]);

    // Rooms en cours au même format que les matchs : j1/j2 de la manche,
    // actions de la draft jusqu'ici.
    const enCours = rooms.map(room => ({
      room_id: room.room_id,
      phase: room.draft.phase,
      classe: room.type === "classe",
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

    // Trophées réellement gagnés / perdus par match classé (bonus de série
    // et plancher à 0 compris) : tous les matchs classés rejoués.
    const deltasClasse = [...matchs, ...litiges].some(m => m.classe)
      ? rejouerClasse(await chargerMatchsClasses(supabase)).deltas
      : new Map();

    const ids = [...new Set([
      ...[...matchs, ...enCours, ...litiges].flatMap(m => [m.player1_discord_id, m.player2_discord_id]),
      ...statsLitiges.map(s => s.discord_id)
    ].filter(Boolean))];
    const joueurs = await chargerJoueurs(ids);
    const deuxJoueurs = match => {
      const profils = { j1: joueurs.get(match.player1_discord_id), j2: joueurs.get(match.player2_discord_id) };
      return { j1: resumerJoueur(match, "j1", profils), j2: resumerJoueur(match, "j2", profils) };
    };

    const resumerMatch = (match, index) => ({
      id: match.id ?? index,
      date: match.created_at || null,
      boss_id: match.boss_id,
      vainqueur: match.vainqueur,
      // Match classé : trophées gagnés par le vainqueur (perdus par l'autre).
      classe: !!match.classe,
      trophees: match.classe ? match.trophees ?? null : null,
      // { j1, j2, bonus } : trophées gagnés (+) / perdus (−) par chaque joueur.
      trophees_joueurs: match.classe ? deltasClasse.get(String(match.id)) || null : null,
      // Bans enregistrés (colonne actions, ou bans_j1 / bans_j2 remplies).
      bans_connus: Array.isArray(match.actions) ||
        (Array.isArray(match.bans_j1) && match.bans_j1.length > 0) ||
        (Array.isArray(match.bans_j2) && match.bans_j2.length > 0),
      // Litige (ouvert ou republié) : administrateurs seulement.
      ...(admin && match.litige ? { litige: match.litige, litige_par: match.litige_par || null } : {}),
      ...deuxJoueurs(match)
    });

    return res.status(200).json({
      en_cours: enCours.map(room => ({
        room_id: room.room_id,
        phase: room.phase,
        classe: room.classe,
        boss_id: room.boss_id,
        date: room.date,
        ...deuxJoueurs(room)
      })),
      termines: matchs.map(resumerMatch),
      // Administrateurs seulement.
      ...(admin ? {
        litiges: litiges.map(resumerMatch),
        stats_litiges: statsLitiges.map(s => {
          const profil = joueurs.get(s.discord_id);
          return {
            ...s,
            nom: profil?.discord_global_name || profil?.discord_username || "Joueur inconnu",
            avatar: profil?.discord_avatar_url || null
          };
        })
      } : {})
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur chargement de l'historique" });
  }
};
