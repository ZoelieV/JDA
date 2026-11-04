// Boss de chaque mode de jeu et chances de tirage (config.boss_modes, page
// admin) : { <mode>: { boss: [ids], probas: { legende, carnage, hebdo, world }
// en % | null } }. probas null : même chance pour chaque boss. Mode jamais
// réglé : valeurs par défaut ci-dessous. Partagé avec le serveur (_lib/boss.js,
// api/points.js), seul juge du tirage.

const MODES_TIRAGE_BOSS = [
  { id: "classe", nom: "Classé" },
  { id: "matchmaking", nom: "Amical (matchmaking)" },
  { id: "prive", nom: "Room privée" },
  { id: "equipe", nom: "En équipe" },
  { id: "entrainement", nom: "Entraînement" },
  { id: "little_cup", nom: "Little Cup" },
  { id: "world_boss", nom: "Random world boss" }
];

const TYPES_TIRAGE_BOSS = [
  { id: "legende", nom: "Légendes locales" },
  { id: "carnage", nom: "Boss de carnage" },
  { id: "hebdo", nom: "Boss hebdomadaires" },
  { id: "world", nom: "World boss" }
];

const PROBAS_TIRAGE_DEFAUT = { legende: 33.33, carnage: 10, hebdo: 56.67, world: 0 };

function typeTirageBoss(boss) {
  if (boss?.type === "legende_locale_jour" || boss?.type === "legende_locale_infinie") return "legende";
  if (boss?.type === "carnage_boss") return "carnage";
  return boss?.type === "world_boss" ? "world" : "hebdo";
}

// Boss d'un mode jamais réglé. Classé : boss hebdomadaires, légendes locales
// sans limite par jour et boss de carnage, sauf "classe": false dans
// DB/boss.json. Le reste des drafts : sans les world boss et les légendes
// "world_boss_seulement" ; en équipe, aussi sans les boss pas faisables en co-op.
function bossTirageParDefaut(modeId, boss) {
  if (modeId === "world_boss") return true;
  if (boss.type === "world_boss" || boss.world_boss_seulement === true) return false;
  if (modeId === "classe") return ["weekly_boss", "legende_locale_infinie", "carnage_boss"].includes(boss.type) && boss.classe !== false;
  return modeId !== "equipe" || boss.coop !== false;
}

// -> { boss: [ids], probas }. littleCup : ancienne liste de boss de l'event
// (config.little_cup.boss), gardée tant que le mode n'est pas réglé ici.
function reglageBossMode(modeId, bossModes, tousBoss, littleCup = null) {
  const regle = bossModes?.[modeId];
  if (Array.isArray(regle?.boss) && regle.boss.length) return { boss: regle.boss, probas: regle.probas || null };
  const probas = modeId === "classe" || modeId === "world_boss" ? null : { ...PROBAS_TIRAGE_DEFAUT };
  if (modeId === "little_cup" && littleCup?.boss?.length) return { boss: littleCup.boss, probas };
  return { boss: tousBoss.filter(b => bossTirageParDefaut(modeId, b)).map(b => b.id), probas };
}

// Liste de boss -> Map(id -> chance entre 0 et 1). Par type : le type est tiré
// d'abord, puis un boss au hasard dans le type. Un type sans boss dans la
// liste laisse sa part aux autres, au prorata ; aucune part restante : même
// chance pour chaque boss.
function chancesBoss(liste, probas) {
  const groupes = probas
    ? TYPES_TIRAGE_BOSS.map(({ id }) => ({ id, poids: Number(probas[id]) || 0, boss: liste.filter(b => typeTirageBoss(b) === id) }))
      .filter(g => g.poids > 0 && g.boss.length)
    : [];
  const chances = new Map(liste.map(b => [b.id, 0]));
  if (!groupes.length) {
    liste.forEach(b => chances.set(b.id, 1 / liste.length));
    return chances;
  }
  const total = groupes.reduce((somme, g) => somme + g.poids, 0);
  groupes.forEach(g => g.boss.forEach(b => chances.set(b.id, g.poids / total / g.boss.length)));
  return chances;
}

// Réglage envoyé par la page admin -> { reglage } ou { erreur }.
function lireReglageBossMode(modeId, brut, tousBoss) {
  const parId = new Map(tousBoss.map(b => [b.id, b]));
  const ids = Array.isArray(brut?.boss) ? [...new Set(brut.boss)] : [];
  if (!ids.length || ids.some(id => !parId.has(id))) return { erreur: "Coche au moins un boss valide." };
  if (modeId === "equipe" && ids.some(id => parId.get(id).coop === false)) return { erreur: "Ce boss n'est pas faisable en co-op." };
  if (!brut.probas) return { reglage: { boss: ids, probas: null } };
  const probas = {};
  for (const { id, nom } of TYPES_TIRAGE_BOSS) {
    const valeur = Number(brut.probas[id] ?? 0);
    if (!Number.isFinite(valeur) || valeur < 0 || valeur > 100) return { erreur: `${nom} : entre 0 et 100 %.` };
    probas[id] = valeur;
  }
  const total = Object.values(probas).reduce((somme, valeur) => somme + valeur, 0);
  if (Math.abs(total - 100) > 0.011) return { erreur: `Le total des probabilités doit faire 100 % (actuellement ${Math.round(total * 100) / 100} %).` };
  if (!ids.some(id => probas[typeTirageBoss(parId.get(id))] > 0)) return { erreur: "Aucun boss coché n'a de chance d'être tiré." };
  return { reglage: { boss: ids, probas } };
}

if (typeof module !== "undefined") {
  module.exports = { MODES_TIRAGE_BOSS, TYPES_TIRAGE_BOSS, PROBAS_TIRAGE_DEFAUT, typeTirageBoss, bossTirageParDefaut, reglageBossMode, chancesBoss, lireReglageBossMode };
}
