// Anti-triche : temps minimum de chaque boss (config.temps_suspects, page
// admin, tuile « Temps anti-triche »). Partagé avec le serveur
// (api/_lib/sanctions.js, api/points.js), seul juge.
// { <boss_id>: { suspect, triche } } en secondes, chacun facultatif :
//   temps < suspect -> danger 1 (temps suspect) ;
//   temps < triche  -> danger 2 (triche confirmée), triche <= suspect.
// Défis (score "ennemis" dans DB/boss.json, ex. Mer d'Antan) : nombre
// d'ennemis éliminés, où le plus grand gagne ; mêmes champs, mais ce sont des
// maximums : au-dessus de suspect -> danger 1, au-dessus de triche -> danger
// 2 (triche >= suspect).
// Classé et Little Cup : match transmis aux administrateurs ; autres
// matchs : sans Rikoyns (cf. api/_lib/sanctions.js). Réglage jamais
// enregistré : valeurs par défaut ci-dessous (boss hebdomadaires).
// Jamais envoyé aux joueurs (cf. versionPublique, api/points.js).

const TEMPS_SUSPECTS_DEFAUT = {
  signora_boss: { suspect: 37, triche: 37 },
  raiden_boss: { suspect: 8, triche: 6 },
  scara_boss: { suspect: 101, triche: 100 },
  apep_boss: { suspect: 55, triche: 42 },
  narwhal_boss: { suspect: 40, triche: 16 },
  arle_boss: { suspect: 27, triche: 25 },
  erode_boss: { suspect: 22, triche: 14 },
  dottoreI_boss: { suspect: 38, triche: 21 },
  dottoreII_boss: { suspect: 53, triche: 47 },
  chess_boss: { suspect: 41, triche: 39 }
};

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
