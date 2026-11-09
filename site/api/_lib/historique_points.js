// Historique des modifications de l'équilibrage (tuile « Historique des
// points » de la page Équilibrage, pour rédiger les patchs) : table
// historique_points, une ligne par perso ou arme modifié à chaque
// enregistrement du tableau des points (cf. api/points.js), avec l'admin,
// la date et les valeurs avant / après.
//   champ "points"      : PPC (C0..C6, niv. 95, niv. 100, théâtre) ou PPW (R1..R5) ;
//   champ "alternative" : valeur alternative d'une arme { reste, groupes } ;
//   champ "synergie"    : valeur alternative d'un perso { persos, malus, par_absent? } ;
//   champ "theatre"     : perso buffé par le théâtre du mois (avant / après : booléens) ;
//   champ "masque"      : perso ou arme masqué (pas encore sorti ; booléens).
// Une valeur absente (null) : pas de valeur alternative / de synergie.
const { supabase } = require("./supabase");

const LIMITE_LECTURE = 2000;

// Points effectifs : ceux de la config, sinon ceux du JSON ou de l'ajout.
function pointsEffectifs(config, genre, entree, taille) {
  const brut = Array.isArray(config?.[genre]?.[entree.id]) ? config[genre][entree.id] : entree[genre === "characters" ? "PPC" : "PPW"];
  return Array.from({ length: taille }, (_, i) => {
    const n = Number(brut?.[i]);
    return Number.isFinite(n) ? n : 0;
  });
}

const egal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Lignes à enregistrer entre deux configs. catalogue : { characters: [...],
// weapons: [...] } (entrées des JSON et ajouts, points d'origine) ;
// tailles : { characters, weapons }.
function differencesPoints(ancienne, nouvelle, catalogue, tailles) {
  const lignes = [];
  for (const genre of ["characters", "weapons"]) {
    for (const entree of catalogue[genre]) {
      const avant = pointsEffectifs(ancienne, genre, entree, tailles[genre]);
      const apres = pointsEffectifs(nouvelle, genre, entree, tailles[genre]);
      if (!egal(avant, apres)) lignes.push({ genre, cible: entree.id, champ: "points", avant, apres });
    }
  }
  const comparer = (genre, champ, cle) => {
    const a = ancienne?.[cle] || {};
    const b = nouvelle?.[cle] || {};
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach(id => {
      if (!egal(a[id], b[id])) lignes.push({ genre, cible: id, champ, avant: a[id] ?? null, apres: b[id] ?? null });
    });
  };
  comparer("weapons", "alternative", "alternatives_armes");
  comparer("characters", "synergie", "synergies");
  // Listes d'ids : une ligne par id ajouté ou retiré.
  const listes = (genre, champ, a, b) => {
    const avant = new Set(Array.isArray(a) ? a : []);
    const apres = new Set(Array.isArray(b) ? b : []);
    new Set([...avant, ...apres]).forEach(id => {
      if (avant.has(id) !== apres.has(id)) lignes.push({ genre, cible: id, champ, avant: avant.has(id), apres: apres.has(id) });
    });
  };
  listes("characters", "theatre", ancienne?.theatre, nouvelle?.theatre);
  for (const genre of ["characters", "weapons"]) listes(genre, "masque", ancienne?.masques?.[genre], nouvelle?.masques?.[genre]);
  return lignes;
}

// N'empêche jamais l'enregistrement des points : erreur seulement notée.
async function noterModifications(lignes, adminId) {
  if (!lignes.length) return;
  const cree_le = new Date().toISOString();
  const { error } = await supabase.from("historique_points")
    .insert(lignes.map(l => ({ ...l, admin_id: adminId, cree_le })));
  if (error) console.error("Historique des points non enregistré :", error);
}

// Du plus récent au plus ancien, avec le nom des admins.
async function lireHistoriquePoints() {
  const { data, error } = await supabase.from("historique_points")
    .select("id, cree_le, admin_id, genre, cible, champ, avant, apres")
    .order("cree_le", { ascending: false }).order("id", { ascending: true })
    .limit(LIMITE_LECTURE);
  if (error) throw error;
  const ids = [...new Set((data || []).map(l => l.admin_id))];
  const { data: profils } = ids.length
    ? await supabase.from("profiles").select("discord_id, discord_username, discord_global_name").in("discord_id", ids)
    : { data: [] };
  const admins = Object.fromEntries((profils || []).map(p => [p.discord_id, p.discord_global_name || p.discord_username || p.discord_id]));
  return { lignes: data || [], admins, limite: LIMITE_LECTURE };
}

module.exports = { differencesPoints, noterModifications, lireHistoriquePoints };
