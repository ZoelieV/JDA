// Saisons du classé (table saisons, cf. sql/saisons.sql) : la saison en
// cours est celle au plus grand numéro. Chaque match archivé garde le
// numéro de la saison où il a été joué (match_history.saison) : trophées,
// séries et primes repartent de 0 à chaque saison (cf. rejouerClasse).
// Table absente (SQL pas lancé) : une seule saison, la 0.
const { supabase } = require("./supabase");

const SAISON_DEFAUT = { numero: 0, nom: "Tests", debut: null };
// Liste relue au plus toutes les 30 s.
const CACHE_SAISONS_MS = 30 * 1000;
let cache = null;

// -> [{ numero, nom, debut }], de la plus ancienne à la saison en cours.
async function lireSaisons() {
  if (!cache || Date.now() - cache.lu > CACHE_SAISONS_MS) {
    const { data, error } = await supabase
      .from("saisons")
      .select("numero, nom, debut")
      .order("numero", { ascending: true });
    if (error) console.error("Erreur lecture saisons :", error);
    const saisons = (data || []).map(s => ({ numero: Number(s.numero), nom: s.nom || "", debut: s.debut || null }));
    cache = { saisons: saisons.length ? saisons : [SAISON_DEFAUT], lu: Date.now() };
  }
  return cache.saisons;
}

async function saisonActuelle() {
  const saisons = await lireSaisons();
  return saisons[saisons.length - 1].numero;
}

// Saison d'un match (ligne de match_history) ; sans colonne saison : 0.
function saisonDuMatch(match) {
  const numero = Number(match?.saison);
  return Number.isInteger(numero) ? numero : 0;
}

module.exports = { lireSaisons, saisonActuelle, saisonDuMatch };
