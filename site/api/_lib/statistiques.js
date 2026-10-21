// Statistiques du site (page Administration, bouton Statistiques ; tables :
// cf. sql/statistiques.sql) :
// - inscriptions : profiles.inscrit_le (première connexion Discord) et
//   profiles.source (lien de pub ?src=..., cf. api/auth/discord/callback.js) ;
// - connexions : connexions_jour, une ligne par joueur et par journée du
//   site (reset à 4 h, cf. _lib/journee.js), écrite par noterConnexion ;
// - activité : matchs (match_history, hors entraînement) et Random world boss
//   (world_boss_history) par journée.
// Tables / colonnes absentes (SQL pas lancé) : rien d'écrit, statistiques
// vides avec un message.
const { supabase } = require("./supabase");
const { jourJournee } = require("./journee");

// ---- Connexions ----
// Une écriture au plus par joueur et par journée et par instance de
// fonction (cache mémoire) : la ligne existe déjà le plus souvent
// (ignoreDuplicates).
const connexionsNotees = new Set();

async function noterConnexion(discordId) {
  if (!discordId) return;
  const jour = jourJournee();
  const cle = `${discordId}:${jour}`;
  if (connexionsNotees.has(cle)) return;
  connexionsNotees.add(cle);
  const { error } = await supabase
    .from("connexions_jour")
    .upsert({ discord_id: discordId, jour }, { onConflict: "discord_id,jour", ignoreDuplicates: true });
  if (error) console.error("Erreur écriture connexions_jour :", error);
}

// ---- Lecture ----
const JOURS_STATISTIQUES = 90;
const TAILLE_PAGE = 1000;
const CACHE_MS = 60 * 1000;
let cache = null;

// Toutes les lignes d'une requête (Supabase : 1000 au plus par appel).
async function lireTout(requete) {
  const lignes = [];
  for (let debut = 0; ; debut += TAILLE_PAGE) {
    const { data, error } = await requete().range(debut, debut + TAILLE_PAGE - 1);
    if (error) throw error;
    lignes.push(...(data || []));
    if (!data || data.length < TAILLE_PAGE) return lignes;
  }
}

// -> { genere_le, jours: [{ jour, inscriptions, inscrits, connexions,
//      matchs, world_boss }], totaux: {...}, sources: [{ source, total,
//      sept_jours }], erreur? }
async function lireStatistiques() {
  if (cache && Date.now() - cache.lu < CACHE_MS) return cache.donnees;
  const maintenant = Date.now();
  const depuis = new Date(maintenant - JOURS_STATISTIQUES * 24 * 3600 * 1000);
  const premierJour = jourJournee(depuis);
  const aujourdhui = jourJournee(maintenant);

  let profils, connexions, matchs, worldBoss;
  try {
    [profils, connexions, matchs, worldBoss] = await Promise.all([
      lireTout(() => supabase.from("profiles").select("discord_id, inscrit_le, source").order("discord_id")),
      lireTout(() => supabase.from("connexions_jour").select("discord_id, jour").gte("jour", premierJour).order("jour")),
      lireTout(() => supabase.from("match_history").select("created_at, entrainement").gte("created_at", depuis.toISOString()).order("created_at")),
      lireTout(() => supabase.from("world_boss_history").select("created_at").gte("created_at", depuis.toISOString()).order("created_at"))
    ]);
  } catch (erreur) {
    console.error("Erreur lecture des statistiques :", erreur);
    return { erreur: "Statistiques indisponibles : lance sql/statistiques.sql dans Supabase." };
  }

  // Journées de la fenêtre, de la plus ancienne à aujourd'hui.
  const jours = new Map();
  for (let t = depuis.getTime(); jourJournee(t) <= aujourdhui; t += 24 * 3600 * 1000) {
    const jour = jourJournee(t);
    if (!jours.has(jour)) jours.set(jour, { jour, inscriptions: 0, inscrits: 0, connexions: 0, matchs: 0, world_boss: 0 });
  }
  if (!jours.has(aujourdhui)) jours.set(aujourdhui, { jour: aujourdhui, inscriptions: 0, inscrits: 0, connexions: 0, matchs: 0, world_boss: 0 });

  const ilYa = ms => maintenant - ms;
  const JOUR_MS = 24 * 3600 * 1000;
  let inscritsAvant = 0;
  const sources = new Map();
  profils.forEach(p => {
    const date = p.inscrit_le ? new Date(p.inscrit_le).getTime() : null;
    const jour = date !== null ? jourJournee(date) : null;
    if (jour && jours.has(jour)) jours.get(jour).inscriptions += 1;
    else inscritsAvant += 1;
    const source = p.source || "(inconnue)";
    const s = sources.get(source) || { source, total: 0, sept_jours: 0 };
    s.total += 1;
    if (date !== null && ilYa(date) < 7 * JOUR_MS) s.sept_jours += 1;
    sources.set(source, s);
  });
  let cumul = inscritsAvant;
  [...jours.values()].forEach(j => { cumul += j.inscriptions; j.inscrits = cumul; });

  const actifs = n => {
    const limite = jourJournee(maintenant - (n - 1) * JOUR_MS);
    return new Set(connexions.filter(c => c.jour >= limite).map(c => c.discord_id)).size;
  };
  connexions.forEach(c => { if (jours.has(c.jour)) jours.get(c.jour).connexions += 1; });
  matchs.filter(m => !m.entrainement).forEach(m => {
    const j = jours.get(jourJournee(new Date(m.created_at).getTime()));
    if (j) j.matchs += 1;
  });
  worldBoss.forEach(m => {
    const j = jours.get(jourJournee(new Date(m.created_at).getTime()));
    if (j) j.world_boss += 1;
  });

  const liste = [...jours.values()];
  const somme = (cle, n) => liste.slice(-n).reduce((t, j) => t + j[cle], 0);
  const donnees = {
    genere_le: new Date(maintenant).toISOString(),
    jours: liste,
    totaux: {
      inscrits: profils.length,
      nouveaux_aujourdhui: jours.get(aujourdhui).inscriptions,
      nouveaux_7j: somme("inscriptions", 7),
      connectes_aujourdhui: jours.get(aujourdhui).connexions,
      actifs_7j: actifs(7),
      actifs_30j: actifs(30),
      matchs_7j: somme("matchs", 7),
      world_boss_7j: somme("world_boss", 7)
    },
    sources: [...sources.values()].sort((a, b) => b.total - a.total)
  };
  cache = { lu: Date.now(), donnees };
  return donnees;
}

module.exports = { noterConnexion, lireStatistiques };
