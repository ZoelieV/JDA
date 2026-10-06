// Légendes locales tuées (table legendes_tuees, cf. sql/legendes_locales.sql).
//
// En jeu, une légende locale "une fois par jour" (TYPE_LEGENDE_JOUR) ne se
// tue qu'une fois par jour, avec un reset à 4 h (heure de Paris). Chaque
// joueur a son propre monde : une légende tuée aujourd'hui par un des 2
// joueurs n'est plus tirée pour leur match.
// Tuée = temps saisi (pas un abandon) à la fin d'un match, litige compris ;
// en entraînement, temps saisi par le lanceur (cf. handleTempsEntrainement).
const { supabase } = require("./supabase");
const { TYPE_LEGENDE_JOUR, estLegendeLocale, idsLegendesLocales, getBossParId } = require("./boss");
const { debutJournee } = require("./journee");

// Ids des légendes "une fois par jour" tuées depuis le reset par au moins un
// de ces joueurs (table absente : aucune).
async function legendesTueesAujourdhui(discordIds) {
  const ids = [...new Set(discordIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data, error } = await supabase
    .from("legendes_tuees")
    .select("boss_id")
    .in("discord_id", ids)
    .gte("tuee_le", new Date(debutJournee()).toISOString());
  if (error) {
    console.error("Erreur lecture legendes_tuees :", error);
    return [];
  }
  return [...new Set(data.map(l => l.boss_id))].filter(id => getBossParId(id)?.type === TYPE_LEGENDE_JOUR);
}

// Par joueur : Map discord_id -> Set des légendes "une fois par jour" qu'il
// a tuées depuis le reset (matchs en équipe : seul le monde de l'hôte
// compte, cf. _lib/equipe.js). Table absente : aucune.
async function legendesTueesParJoueur(discordIds) {
  const ids = [...new Set(discordIds.filter(Boolean))];
  const parJoueur = new Map(ids.map(id => [id, new Set()]));
  if (!ids.length) return parJoueur;
  const { data, error } = await supabase
    .from("legendes_tuees")
    .select("discord_id, boss_id")
    .in("discord_id", ids)
    .gte("tuee_le", new Date(debutJournee()).toISOString());
  if (error) {
    console.error("Erreur lecture legendes_tuees :", error);
    return parJoueur;
  }
  (data || [])
    .filter(l => getBossParId(l.boss_id)?.type === TYPE_LEGENDE_JOUR)
    .forEach(l => parJoueur.get(l.discord_id)?.add(l.boss_id));
  return parJoueur;
}

// Niveau du monde : les PV des légendes locales en dépendent. Deux joueurs
// qui ne sont pas au même niveau du monde (ou dont l'un ne l'a pas
// renseigné) ne peuvent pas tomber sur une légende locale : match pas
// équitable. -> ids des légendes locales à exclure du tirage ([] si les 2
// niveaux sont renseignés et identiques).
async function legendesHorsNiveauMonde(idA, idB) {
  const { data, error } = await supabase
    .from("profiles")
    .select("discord_id, niveau:data->>niveau_monde")
    .in("discord_id", [idA, idB]);
  if (error) {
    console.error("Erreur lecture niveaux du monde :", error);
    return idsLegendesLocales();
  }
  const niveau = id => (data || []).find(p => p.discord_id === id)?.niveau || "";
  return niveau(idA) && niveau(idA) === niveau(idB) ? [] : idsLegendesLocales();
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

module.exports = { legendesTueesAujourdhui, legendesTueesParJoueur, legendesHorsNiveauMonde, enregistrerMorts };
