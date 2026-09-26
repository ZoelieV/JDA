// Hypothèse : DB/boss.json, comme characters.json / weapons.json.
const bossList = require("../../DB/boss.json");

// exclureId : boss de la manche précédente (revanche), jamais retiré deux
// fois de suite. Seul le précédent est exclu, pas tout l'historique, pour
// ne jamais épuiser la liste sur une longue série de revanches.
function tirerBossAleatoire(exclureId = null) {
  const candidats = bossList.filter(b => b.id !== exclureId);
  const liste = candidats.length > 0 ? candidats : bossList;
  return liste[Math.floor(Math.random() * liste.length)];
}

function getBossParId(id) {
  return bossList.find(b => b.id === id) || null;
}

module.exports = { tirerBossAleatoire, getBossParId };