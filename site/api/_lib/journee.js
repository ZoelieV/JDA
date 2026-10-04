// Journée du site : reset à 4 h, heure de Paris (heure d'été / d'hiver
// comprises). Sert aux légendes locales "une fois par jour" (_lib/legendes.js)
// et à la limite de victoires en classé contre un même joueur
// (_lib/serie_classe.js).
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

// Début de la journée en cours : dernier passage à 4 h, heure
// de Paris (heure d'été / d'hiver comprises).
function debutJournee(maintenant = Date.now()) {
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

module.exports = { debutJournee };
