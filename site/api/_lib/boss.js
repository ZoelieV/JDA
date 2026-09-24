// Hypothèse : DB/boss.json, comme characters.json / weapons.json.
const bossList = require("../../DB/boss.json");

function tirerBossAleatoire() {
  const index = Math.floor(Math.random() * bossList.length);
  return bossList[index];
}

function getBossParId(id) {
  return bossList.find(b => b.id === id) || null;
}

module.exports = { tirerBossAleatoire, getBossParId };