// Hypothèse : DB/boss.json, comme characters.json / weapons.json.
const bossList = require("../../DB/boss.json");
const { chancesBoss, reglageBossMode } = require("../../commun/boss_modes.js");

// Légende locale tuable une fois par jour (reset à 4 h, cf. _lib/legendes.js)
// ou à l'infini.
const TYPE_LEGENDE_JOUR = "legende_locale_jour";
const TYPE_LEGENDE_INFINIE = "legende_locale_infinie";
// World boss : par défaut seulement dans le mode Random world boss (cf.
// commun/boss_modes.js).
const TYPE_WORLD_BOSS = "world_boss";

function estWorldBoss(boss) {
  return boss?.type === TYPE_WORLD_BOSS;
}

// Pas faisable en co-op ("coop": false dans DB/boss.json, ex. défis de
// totem de Natlan) : jamais en équipe, en Random world boss seulement seul.
function estHorsCoop(boss) {
  return boss?.coop === false;
}

function estLegendeLocale(boss) {
  return boss?.type === TYPE_LEGENDE_JOUR || boss?.type === TYPE_LEGENDE_INFINIE;
}

function auHasard(liste) {
  return liste[Math.floor(Math.random() * liste.length)];
}

// Boss et chances d'un mode (config.boss_modes, cf. commun/boss_modes.js).
// mode null (tournois) : valeurs par défaut de l'amical, jamais les réglages
// de la page admin. Points à jour : actualiserPoints avant.
function reglageBoss(mode) {
  const { getBossModes, getLittleCup } = require("./personnages");
  return mode ? reglageBossMode(mode, getBossModes(), bossList, getLittleCup()) : reglageBossMode("matchmaking", null, bossList);
}

// Tirage selon les chances (cf. chancesBoss) ; undefined si la liste est vide.
function tirerSelonChances(liste, probas) {
  const chances = chancesBoss(liste, probas);
  let tirage = Math.random();
  const gardes = liste.filter(b => chances.get(b.id) > 0);
  return gardes.find(b => (tirage -= chances.get(b.id)) < 0) || gardes[gardes.length - 1];
}

// exclureId : boss de la manche précédente (revanche), jamais retiré deux
// fois de suite. Seul le précédent est exclu, pas tout l'historique, pour
// ne jamais épuiser la liste sur une longue série de revanches.
// mode : cf. reglageBoss.
// exclus : ids jamais tirés (légendes locales déjà tuées aujourd'hui, boss du
// carnage désactivés...). Plus aucun boss du mode sans eux (ex. le mode n'a
// que des légendes déjà tuées) : tirés quand même, plutôt qu'aucun boss.
function tirerBossAleatoire(exclureId = null, { mode = null, exclus = [] } = {}) {
  const { boss, probas } = reglageBoss(mode);
  const permis = new Set(boss);
  const duMode = bossList.filter(b => permis.has(b.id));
  const sansExclus = duMode.filter(b => !exclus.includes(b.id));
  const tirables = sansExclus.length ? sansExclus : duMode;
  const candidats = tirables.filter(b => b.id !== exclureId);
  return tirerSelonChances(candidats.length ? candidats : tirables, probas);
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

// Tous les boss (ajouts des administrateurs compris, cf. _lib/personnages.js).
function listeBoss() {
  return bossList;
}

function getBossParId(id) {
  return bossList.find(b => b.id === id) || null;
}

// Défi (ex. Défi mystérieux de la Mer d'Antan, "score": "ennemis" dans
// DB/boss.json) : salle de 2 minutes où l'on tue le plus d'ennemis possible.
// Nombre d'ennemis tués saisi à la place d'un temps (cf. _lib/temps.js), le
// plus grand gagne.
const DUREE_DEFI_SECONDES = 120;

function estDefiEnnemis(bossId) {
  return getBossParId(bossId)?.score === "ennemis";
}

// Ids de toutes les légendes locales (une fois par jour ou à l'infini).
function idsLegendesLocales() {
  return bossList.filter(estLegendeLocale).map(b => b.id);
}

const ERREUR_BOSS_MODE = "Ce boss n'est pas disponible dans ce mode.";
const ERREUR_CARNAGE_DESACTIVE = "Les boss du carnage sont désactivés en ce moment (plus disponibles dans le jeu).";

module.exports = { bossCarnageExclus, DUREE_DEFI_SECONDES, ERREUR_CARNAGE_DESACTIVE, ERREUR_BOSS_MODE, estDefiEnnemis, estHorsCoop, estWorldBoss, listeBoss, TYPE_LEGENDE_JOUR, estLegendeLocale, idsLegendesLocales, tirerBossAleatoire, reglageBoss, tirerSelonChances, getBossParId };
