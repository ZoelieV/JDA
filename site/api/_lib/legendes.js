// Légendes locales tuées (table legendes_tuees, cf. sql/legendes_locales.sql).
//
// En jeu, une légende locale "une fois par jour" (TYPE_LEGENDE_JOUR) ne se
// tue qu'une fois par jour, avec un reset à 4 h (heure de Paris). Chaque
// joueur a son propre monde : une légende tuée aujourd'hui par un des 2
// joueurs n'est plus tirée pour leur match.
// Tuée = temps saisi (pas un abandon) à la fin d'un match, litige compris ;
// en entraînement, temps saisi par le lanceur (cf. handleTempsEntrainement).
const { supabase } = require("./supabase");
const { TYPE_LEGENDE_JOUR, estLegendeLocale, getBossParId } = require("./boss");

const HEURE_RESET = 4;
const FUSEAU = "Europe/Paris";
const HEURE_MS = 60 * 60 * 1000;
const FORMAT_PARIS = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSEAU, hourCycle: "h23",
  year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric"
});

// Heure de Paris d'un instant, écrite comme si c'était de l'UTC (ms).
function heureMurale(instant) {
  const p = Object.fromEntries(FORMAT_PARIS.formatToParts(new Date(instant)).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

// Début de la journée en cours des légendes : dernier passage à 4 h, heure
// de Paris (heure d'été / d'hiver comprises).
function debutJourneeLegendes(maintenant = Date.now()) {
  const murale = heureMurale(maintenant);
  const jour = new Date(murale);
  let reset = Date.UTC(jour.getUTCFullYear(), jour.getUTCMonth(), jour.getUTCDate(), HEURE_RESET);
  if (murale < reset) reset -= 24 * HEURE_MS;
  // Heure murale -> instant : décalage de Paris à cette date (recalculé une
  // fois, au cas où le changement d'heure tombe entre les deux).
  let instant = reset - (murale - maintenant);
  instant = reset - (heureMurale(instant) - instant);
  return instant;
}

// Ids des légendes "une fois par jour" tuées depuis le reset par au moins un
// de ces joueurs (table absente : aucune).
async function legendesTueesAujourdhui(discordIds) {
  const ids = [...new Set(discordIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("legendes_tuees")
    .select("boss_id")
    .in("discord_id", ids)
    .gte("tuee_le", new Date(debutJourneeLegendes()).toISOString());
  if (error) {
    console.error("Erreur lecture legendes_tuees :", error);
    return [];
  }
  return [...new Set(data.map(l => l.boss_id))].filter(id => getBossParId(id)?.type === TYPE_LEGENDE_JOUR);
}

// Morts d'une légende locale : [{ discord_id, temps_secondes }] (temps
// saisis, pas les abandons). Rien si le boss n'est pas une légende locale.
async function enregistrerMorts(bossId, matchId, morts, { entrainement = false } = {}) {
  if (!estLegendeLocale(getBossParId(bossId))) return;
  const lignes = morts
    .filter(m => m.discord_id && Number.isFinite(m.temps_secondes))
    .map(m => ({ ...m, boss_id: bossId, match_id: matchId, entrainement }));
  if (!lignes.length) return;
  const { error } = await supabase.from("legendes_tuees").upsert(lignes, { onConflict: "match_id,discord_id" });
  if (error) console.error("Erreur enregistrement legendes_tuees :", error);
}

module.exports = { debutJourneeLegendes, legendesTueesAujourdhui, enregistrerMorts };
