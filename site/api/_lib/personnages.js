// Charge le catalogue de personnages côté serveur (nécessaire pour calculer
// les points de box et valider les actions de draft : on ne fait jamais
// confiance à des points ou une liste de persos envoyés par le client).
//
// Hypothèse : le fichier se trouve à la racine du projet dans DB/characters.json,
// comme pour le reste du site. Le require() d'un JSON est repéré et inclus
// automatiquement par Vercel au build (pas besoin de config supplémentaire).
const personnages = require("../../DB/characters.json");

function getPersonnages() {
  return personnages;
}

function getPersonnageParId(id) {
  return personnages.find(p => p.id === id) || null;
}

function getTousLesIds() {
  return personnages.map(p => p.id);
}

module.exports = { getPersonnages, getPersonnageParId, getTousLesIds };