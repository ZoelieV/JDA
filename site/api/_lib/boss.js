// Hypothèse : DB/boss.json, comme characters.json / weapons.json.
const bossList = require("../../DB/boss.json");

// Légende locale tuable une fois par jour (reset à 4 h, cf. _lib/legendes.js)
// ou à l'infini.
const TYPE_LEGENDE_JOUR = "legende_locale_jour";
const TYPE_LEGENDE_INFINIE = "legende_locale_infinie";
// Mode classé : boss hebdomadaires et légendes locales sans limite par jour.
const TYPES_BOSS_CLASSE = ["weekly_boss", TYPE_LEGENDE_INFINIE];

function estLegendeLocale(boss) {
  return boss?.type === TYPE_LEGENDE_JOUR || boss?.type === TYPE_LEGENDE_INFINIE;
}

// exclureId : boss de la manche précédente (revanche), jamais retiré deux
// fois de suite. Seul le précédent est exclu, pas tout l'historique, pour
// ne jamais épuiser la liste sur une longue série de revanches.
// classe : boss du mode classé seulement (TYPES_BOSS_CLASSE).
// exclus : ids des légendes locales déjà tuées aujourd'hui par un des
// joueurs (cf. legendesTueesAujourdhui), jamais tirées.
function tirerBossAleatoire(exclureId = null, { classe = false, exclus = [] } = {}) {
  const tirables = bossList.filter(b => (!classe || TYPES_BOSS_CLASSE.includes(b.type)) && !exclus.includes(b.id));
  const candidats = tirables.filter(b => b.id !== exclureId);
  const liste = candidats.length > 0 ? candidats : tirables;
  return liste[Math.floor(Math.random() * liste.length)];
}

function getBossParId(id) {
  return bossList.find(b => b.id === id) || null;
}

module.exports = { TYPE_LEGENDE_JOUR, TYPES_BOSS_CLASSE, estLegendeLocale, tirerBossAleatoire, getBossParId };
