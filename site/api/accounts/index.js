const { createClient } = require("@supabase/supabase-js");
const { calculerPointsBox, calculerPointsArmesBox } = require("../_lib/draft");
const { getPersonnages, getArmes, migrerCollectionPersos, actualiserPoints, palierTheatre } = require("../_lib/personnages");
const { CLASSEMENT_AFFICHE, rejouerClasse, seriePrime } = require("../_lib/trophees");
const { lireSaisons, saisonActuelle } = require("../_lib/saisons");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CHAMPS = "discord_id, discord_username, discord_global_name, discord_avatar_url, updated_at, data";

// Code Postgres "colonne inexistante".
const COLONNE_INEXISTANTE = "42703";

async function chargerProfils() {
  // created_at (date d'arrivée, tri "Arrivée") : si la colonne n'existe pas
  // encore dans la table profiles, on s'en passe (tri masqué côté page).
  let { data, error } = await supabase
    .from("profiles")
    .select(`${CHAMPS}, created_at`)
    .order("updated_at", { ascending: false });

  if (error && error.code === COLONNE_INEXISTANTE) {
    ({ data, error } = await supabase
      .from("profiles")
      .select(CHAMPS)
      .order("updated_at", { ascending: false }));
  }

  if (error) throw error;
  return data;
}

// Matchs joués et victoires par joueur, d'après l'historique des matchs,
// plus trophées, matchs et victoires en classé (page Classement).
// Litiges ouverts (matchs invalidés) non comptés ; sans colonnes litige /
// classe (sql/litiges.sql, sql/classe.sql pas lancés), tous les matchs et
// pas de classé.
async function chargerResultats() {
  const champs = "player1_discord_id, player2_discord_id, vainqueur";
  // Ni les matchs invalidés après un signalement (cf. _lib/signalements.js).
  const litigeOuvert = "litige.is.null,litige.not.in.(ouvert,invalide)";
  // Entraînements jamais comptés (filtrés plus bas) ; sans la colonne
  // entrainement (sql/entrainement.sql pas lancé), il n'y en a pas.
  // Matchs d'équipe (colonne mode_equipe, sql/equipes.sql) : pas comptés
  // ici (stats des matchs 1v1).
  let { data, error } = await supabase
    .from("match_history")
    .select(`${champs}, id, created_at, litige, classe, trophees, mode_theatre, entrainement, bonus_saison_j1, bonus_saison_j2, saison, mode_equipe`)
    .or(litigeOuvert);

  if (error) {
    ({ data, error } = await supabase
      .from("match_history")
      .select(`${champs}, id, created_at, litige, classe, trophees, mode_theatre, entrainement, bonus_saison_j1, bonus_saison_j2, saison`)
      .or(litigeOuvert));
  }

  // Sans colonne saison (sql/saisons.sql pas lancé) : tout en saison 0.
  if (error) {
    ({ data, error } = await supabase
      .from("match_history")
      .select(`${champs}, id, created_at, litige, classe, trophees, mode_theatre, entrainement, bonus_saison_j1, bonus_saison_j2`)
      .or(litigeOuvert));
  }

  // Sans colonnes du bonus de saison (sql/bonus_saison.sql pas lancé).
  if (error) {
    ({ data, error } = await supabase
      .from("match_history")
      .select(`${champs}, id, created_at, litige, classe, trophees, mode_theatre, entrainement`)
      .or(litigeOuvert));
  }

  if (error) {
    ({ data, error } = await supabase
      .from("match_history")
      .select(`${champs}, id, created_at, litige, classe, trophees, mode_theatre`)
      .or(litigeOuvert));
  }

  // Sans colonne mode_theatre (sql/theatre.sql pas lancé) : tout en
  // classement Classique.
  if (error) {
    ({ data, error } = await supabase.from("match_history").select(`${champs}, id, created_at, litige, classe, trophees`).or(litigeOuvert));
  }

  // Sans colonne litige (sql/litiges.sql pas lancé) : classé quand même.
  if (error) {
    ({ data, error } = await supabase.from("match_history").select(`${champs}, id, created_at, classe, trophees`));
  }
  if (error) {
    ({ data, error } = await supabase.from("match_history").select(champs).or(litigeOuvert));
  }
  if (error) {
    ({ data, error } = await supabase.from("match_history").select(champs));
  }

  if (error) {
    // Pas bloquant : la liste reste utilisable sans ces tris.
    console.error("Erreur lecture match_history :", error);
    return {};
  }

  data = data.filter(match => !match.entrainement && !match.mode_equipe);

  const resultats = {};
  const compter = (discordId, gagne) => {
    if (!discordId) return;
    resultats[discordId] ??= { matchs: 0, victoires: 0 };
    resultats[discordId].matchs += 1;
    if (gagne) resultats[discordId].victoires += 1;
  };

  data.forEach(match => {
    compter(match.player1_discord_id, match.vainqueur === "j1");
    compter(match.player2_discord_id, match.vainqueur === "j2");
  });

  // Classé (mêlée générale seulement, cf. CLASSEMENT_AFFICHE) : saison en
  // cours dans classements, saisons passées dans saisons_passees (trophées,
  // matchs et victoires, sans série ni prime).
  const actuelle = await saisonActuelle();
  rejouerClasse(data).parSaison.forEach((tables, saison) => {
    [CLASSEMENT_AFFICHE].forEach(classement => {
      // Porteur(s) de la prime : plus longue série en cours de ce classement.
      const prime = saison === actuelle ? seriePrime(tables[classement]) : 0;
      tables[classement].forEach((stats, discordId) => {
        resultats[discordId] ??= { matchs: 0, victoires: 0 };
        if (saison === actuelle) {
          (resultats[discordId].classements ??= {})[classement] = { ...stats, prime: !!prime && stats.serie === prime };
        } else {
          const passee = ((resultats[discordId].saisons_passees ??= {})[saison] ??= {});
          passee[classement] = { trophees: stats.trophees, matchs: stats.matchs, victoires: stats.victoires };
        }
      });
    });
  });

  return resultats;
}

// Stats calculées ici : on ne renvoie pas les box complètes à la page.
function resumerProfil(profil, resultats) {
  const data = profil.data || {};
  const full = migrerCollectionPersos(data.characters)?.full || {};
  // Voyageur (un par élément) compté une seule fois.
  const possedes = getPersonnages().filter(p => (full[p.id] ?? -1) >= 0);
  const nbPersos = new Set(possedes.map(p => p.groupe || p.id)).size;
  // C6 : 5★ limités uniquement (pas les persos de la bannière standard).
  const nbC6 = new Set(possedes
    .filter(p => String(p.rarete) === "5" && !p.standard && full[p.id] === 6)
    .map(p => p.groupe || p.id)).size;
  const { matchs = 0, victoires = 0, classements = {}, saisons_passees: saisonsPassees = {} } = resultats[profil.discord_id] || {};

  return {
    discord_id: profil.discord_id,
    discord_username: profil.discord_username,
    discord_global_name: profil.discord_global_name,
    discord_avatar_url: profil.discord_avatar_url,
    updated_at: profil.updated_at,
    created_at: profil.created_at ?? null,
    banniere2: data.parametres?.banniere2 || null,
    // Full Box : persos + armes (même total que Mon compte).
    points: calculerPointsBox(data, "full", getPersonnages()) + calculerPointsArmesBox(data, "full", getArmes()),
    nb_persos: nbPersos,
    nb_c6: nbC6,
    // Somme des constellations des 5★ limités (Full Box, sans les persos
    // standards) : C0 ne compte pas, C3 + C2 = 5.
    constellations_5: possedes
      .filter(p => String(p.rarete) === "5" && !p.standard)
      .reduce((somme, p) => somme + full[p.id], 0),
    // Palier de théâtre calculé sur la full box (cf. palierTheatre).
    theatre: palierTheatre(data),
    matchs,
    victoires,
    // Classé, par classement ("melee" seulement) : { trophees, matchs,
    // victoires, serie (victoires d'affilée en cours) }, absent si aucun
    // match classé dans ce classement. Saison en cours seulement.
    classements,
    // Saisons passées : { numéro: { melee? } } ({ trophees,
    // matchs, victoires }).
    saisons_passees: saisonsPassees
  };
}

module.exports = async (req, res) => {
  try {
    // ?saisons=1 : liste des saisons (page Classement, menu Saison).
    if (req.query?.saisons) {
      const saisons = await lireSaisons();
      res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
      return res.status(200).json({ actuelle: saisons[saisons.length - 1].numero, saisons });
    }

    const [profils, resultats] = await Promise.all([chargerProfils(), chargerResultats(), actualiserPoints()]);
    // Même liste pour tout le monde : gardée 30 s par le CDN de Vercel
    // (tous les profils et tout l'historique relus au plus une fois par
    // tranche de 30 s, quel que soit le nombre de visites).
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json(profils.map(profil => resumerProfil(profil, resultats)));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erreur chargement comptes" });
  }
};
