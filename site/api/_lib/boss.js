// Hypothèse : DB/boss.json, comme characters.json / weapons.json.
const bossList = require("../../DB/boss.json");

// Légende locale tuable une fois par jour (reset à 4 h, cf. _lib/legendes.js)
// ou à l'infini.
const TYPE_LEGENDE_JOUR = "legende_locale_jour";
const TYPE_LEGENDE_INFINIE = "legende_locale_infinie";
// Mode classé : boss hebdomadaires, légendes locales sans limite par jour et
// boss de carnage (salles 1 à 3 du carnage chtonien en cours),
// sauf ceux marqués "classe": false dans DB/boss.json (ex. Tartaglia, trop
// dépendant des patterns).
const TYPES_BOSS_CLASSE = ["weekly_boss", TYPE_LEGENDE_INFINIE, "carnage_boss"];

function estTirableEnClasse(boss) {
  return TYPES_BOSS_CLASSE.includes(boss?.type) && boss.classe !== false;
}

function estLegendeLocale(boss) {
  return boss?.type === TYPE_LEGENDE_JOUR || boss?.type === TYPE_LEGENDE_INFINIE;
}

// Hors classé : catégorie de boss tirée d'abord (sur 30 : légendes locales
// 10, boss de carnage 3, boss hebdomadaires et autres 17), puis un boss au
// hasard dans la catégorie. Une catégorie vide (ex. légendes toutes exclues)
// est ignorée, les autres se partagent sa probabilité.
// En classé : tous les boss tirables sont équiprobables.
// Mêmes poids dans theorycraft/theorycraft.js (POIDS_CATEGORIES_BOSS).
const POIDS_CATEGORIES = [
  { poids: 10, contient: estLegendeLocale },
  { poids: 3, contient: estBossCarnage },
  { poids: 17, contient: boss => !estLegendeLocale(boss) && !estBossCarnage(boss) }
];

function auHasard(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

// exclureId : boss de la manche précédente (revanche), jamais retiré deux
// fois de suite. Seul le précédent est exclu, pas tout l'historique, pour
// ne jamais épuiser la liste sur une longue série de revanches.
// classe : boss du mode classé seulement (estTirableEnClasse).
// exclus : ids des légendes locales déjà tuées aujourd'hui par un des
// joueurs (cf. legendesTueesAujourdhui), jamais tirées.
function tirerBossAleatoire(exclureId = null, { classe = false, exclus = [] } = {}) {
  const tirables = bossList.filter(b => (!classe || estTirableEnClasse(b)) && !exclus.includes(b.id));
  const candidats = tirables.filter(b => b.id !== exclureId);
  const liste = candidats.length > 0 ? candidats : tirables;
  if (classe) return auHasard(liste);

  const groupes = POIDS_CATEGORIES
    .map(({ poids, contient }) => ({ poids, boss: liste.filter(contient) }))
    .filter(groupe => groupe.boss.length > 0);
  let tirage = Math.random() * groupes.reduce((total, groupe) => total + groupe.poids, 0);
  const groupe = groupes.find(g => (tirage -= g.poids) < 0) || groupes[groupes.length - 1];
  return groupe ? auHasard(groupe.boss) : undefined;
}

function estBossCarnage(boss) {
  return boss?.type === "carnage_boss";
}

// Ids des boss du carnage quand un admin les a désactivés (plus disponibles
// dans le jeu, environ une semaine tous les 40 jours, cf.
// config.carnage_desactive), à exclure de tous les tirages et boss imposés
// sauf en entraînement ; [] sinon.
async function bossCarnageExclus() {
  const { actualiserPoints, estCarnageDesactive } = require("./personnages");
  await actualiserPoints();
  return estCarnageDesactive() ? bossList.filter(estBossCarnage).map(b => b.id) : [];
}

function getBossParId(id) {
  return bossList.find(b => b.id === id) || null;
}

// Ids de toutes les légendes locales (une fois par jour ou à l'infini).
function idsLegendesLocales() {
  return bossList.filter(estLegendeLocale).map(b => b.id);
}

const ERREUR_CARNAGE_DESACTIVE = "Les boss du carnage sont désactivés en ce moment (plus disponibles dans le jeu).";

module.exports = { bossCarnageExclus, ERREUR_CARNAGE_DESACTIVE, TYPE_LEGENDE_JOUR, TYPES_BOSS_CLASSE, estTirableEnClasse, estLegendeLocale, idsLegendesLocales, tirerBossAleatoire, getBossParId };
