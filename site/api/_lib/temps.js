// Parsing du temps de complétion, saisi au format "mm:ss" (ex: "7:32", "12:05").
// Autorise 1 à 3 chiffres de minutes (jusqu'à 999 min) et 2 chiffres de
// secondes entre 00 et 59.
const FORMAT_MMSS = /^([0-9]{1,3}):([0-5][0-9])$/;

function parserTempsMMSS(texte) {
  const valeur = String(texte).trim();
  const match = valeur.match(FORMAT_MMSS);

  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  const secondes = Number(match[2]);

  return {
    affiche: `${minutes}:${String(secondes).padStart(2, "0")}`,
    secondes: minutes * 60 + secondes
  };
}

module.exports = { parserTempsMMSS };