// Seuils des alertes de temps par boss (config.temps_suspects, réglés dans
// l'admin). Partagé avec le serveur, seul juge. Jamais envoyé aux joueurs.
// Valeurs par défaut : côté serveur seulement (api/_lib/temps_suspects_defaut.js) ;
// dans le navigateur, objet vide rempli par la page admin avec la config
// (temps_suspects_defaut, administrateurs seulement).
const TEMPS_SUSPECTS_DEFAUT = typeof module !== "undefined" ? require("../api/_lib/temps_suspects_defaut.js") : {};

const TEMPS_SUSPECT_MAX = 3600;
const ENNEMIS_SUSPECT_MAX = 9999;

// Seuils de tous les boss (enregistrés, sinon par défaut).
function reglageTempsSuspects(config) {
  const regle = config?.temps_suspects;
  return regle && typeof regle === "object" && !Array.isArray(regle) ? regle : TEMPS_SUSPECTS_DEFAUT;
}

// Seuils d'un boss -> { suspect, triche } (null = pas de seuil), ou null.
function seuilsTempsSuspects(bossId, reglage) {
  const s = reglage?.[bossId];
  if (!s) return null;
  const suspect = Number.isInteger(s.suspect) ? s.suspect : null;
  const triche = Number.isInteger(s.triche) ? s.triche : null;
  return suspect === null && triche === null ? null : { suspect, triche };
}

// Danger d'un temps (secondes) : 0, 1 (suspect) ou 2 (triche confirmée).
// ennemis : défi, la valeur est un nombre d'ennemis et les seuils des maximums.
function dangerTemps(secondes, seuils, { ennemis = false } = {}) {
  if (!seuils || typeof secondes !== "number") return 0;
  const franchi = seuil => seuil !== null && (ennemis ? secondes > seuil : secondes < seuil);
  if (franchi(seuils.triche)) return 2;
  if (franchi(seuils.suspect)) return 1;
  return 0;
}

// Réglage envoyé par la page admin -> { reglage } ou { erreur }.
// defis : Set des ids des défis (seuils en nombre d'ennemis).
function lireReglageTempsSuspects(brut, nomsBoss, defis = new Set()) {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return { erreur: "Réglage invalide." };
  const reglage = {};
  for (const [id, valeurs] of Object.entries(brut)) {
    const nom = nomsBoss.get(id);
    if (!nom) return { erreur: `Boss inconnu (${id}).` };
    const lire = v => (v === null || v === undefined || v === "" ? null : Number(v));
    const suspect = lire(valeurs?.suspect);
    const triche = lire(valeurs?.triche);
    const defi = defis.has(id);
    const max = defi ? ENNEMIS_SUSPECT_MAX : TEMPS_SUSPECT_MAX;
    for (const v of [suspect, triche]) {
      if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= max)) return { erreur: defi ? `${nom} : nombre d'ennemis entre 1 et ${max}.` : `${nom} : temps entre 1 s et ${max} s.` };
    }
    if (suspect !== null && triche !== null && (defi ? triche < suspect : triche > suspect)) {
      return { erreur: defi ? `${nom} : le seuil de triche confirmée doit être supérieur ou égal au seuil suspect.` : `${nom} : le temps de triche confirmée doit être inférieur ou égal au temps suspect.` };
    }
    if (suspect !== null || triche !== null) reglage[id] = { ...(suspect !== null ? { suspect } : {}), ...(triche !== null ? { triche } : {}) };
  }
  return { reglage };
}

if (typeof module !== "undefined") module.exports = { TEMPS_SUSPECTS_DEFAUT, TEMPS_SUSPECT_MAX, ENNEMIS_SUSPECT_MAX, reglageTempsSuspects, seuilsTempsSuspects, dangerTemps, lireReglageTempsSuspects };
