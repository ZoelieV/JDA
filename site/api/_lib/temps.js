const { estDefiEnnemis } = require("./boss");

// Parsing du temps de complétion, saisi au format "mm:ss" (ex: "7:32", "12:05").
// Séparateur ":", "," ou "." (clavier numérique des téléphones : "1,35" et
// "1.35" valent "1:35"). Autorise 1 à 3 chiffres de minutes (jusqu'à
// 999 min) et 2 chiffres de secondes entre 00 et 59.
const FORMAT_MMSS = /^([0-9]{1,3})[:.,]([0-5][0-9])$/;

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

// Défi (cf. estDefiEnnemis) : nombre d'ennemis tués à la place d'un temps,
// entier de 0 à 9999. Rangé dans le même champ "secondes" (colonnes
// temps_jX_secondes de match_history) : le sens de comparaison dépend du
// boss du match.
const FORMAT_ENNEMIS = /^[0-9]{1,4}$/;

function parserEnnemis(texte) {
  const valeur = String(texte).trim();
  if (!FORMAT_ENNEMIS.test(valeur)) return null;
  const ennemis = Number(valeur);
  return { affiche: `${ennemis} ennemi${ennemis > 1 ? "s" : ""}`, secondes: ennemis };
}

// Temps ou nombre d'ennemis (défi) selon le boss.
function parserResultat(texte, bossId) {
  return estDefiEnnemis(bossId) ? parserEnnemis(texte) : parserTempsMMSS(texte);
}

function messageFormatInvalide(bossId, abandon = false) {
  if (estDefiEnnemis(bossId)) return `Nombre d'ennemis invalide (attendu un nombre entier${abandon ? " ou abandon" : ""})`;
  return `Format de temps invalide (attendu mm:ss${abandon ? " ou abandon" : ""})`;
}

// Abandon déclaré à la saisie des temps (à la place d'un temps).
const TEMPS_ABANDON = { affiche: "Abandon", secondes: null, abandon: true };

// Saisie d'un administrateur (correction d'un litige) : "mm:ss" (nombre
// d'ennemis pour un défi) ou "abandon".
function parserTempsOuAbandon(texte, bossId) {
  return /^\s*abandon\s*$/i.test(String(texte)) ? { ...TEMPS_ABANDON } : parserResultat(texte, bossId);
}

// Temps chronométrés à la main par les joueurs : un écart d'une seconde ou
// moins relève du temps de réaction, le match est alors une égalité.
// Défi : de même, un ennemi d'écart ou moins.
const ECART_EGALITE_SECONDES = 1;

// tempsJ1 / tempsJ2 : { secondes } ou abandon -> "j1" | "j2" | "egalite".
// 2 abandons : égalité ; un abandon : l'autre joueur gagne. Temps le plus
// court gagnant ; défi (bossId) : le plus d'ennemis tués.
function determinerVainqueur(tempsJ1, tempsJ2, bossId = null) {
  if (tempsJ1.abandon || tempsJ2.abandon) {
    if (tempsJ1.abandon && tempsJ2.abandon) return "egalite";
    return tempsJ1.abandon ? "j2" : "j1";
  }
  if (Math.abs(tempsJ1.secondes - tempsJ2.secondes) <= ECART_EGALITE_SECONDES) return "egalite";
  if (estDefiEnnemis(bossId)) return tempsJ1.secondes > tempsJ2.secondes ? "j1" : "j2";
  return tempsJ1.secondes < tempsJ2.secondes ? "j1" : "j2";
}

module.exports = { TEMPS_ABANDON, parserTempsMMSS, parserResultat, parserTempsOuAbandon, messageFormatInvalide, determinerVainqueur };