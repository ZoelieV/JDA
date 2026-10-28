// Synergies des personnages (config.synergies, réglées sur la page admin,
// fenêtre "Synergie" d'un perso) : { id du perso: { persos: [ids de la
// draft (Voyageur : "traveler")], malus } }.
// Dans une box qui contient le perso, chaque perso en synergie absent de
// cette même box lui retire malus / nombre de persos en synergie (arrondi),
// après les bonus niveau / théâtre, sans descendre sous 0 : sa valeur
// alternative. Ex. Lauma (Nefer, Columbina), malus 20 : sans Columbina -10,
// sans les 2 -20.
// Même fichier côté pages (commun/cartes.js, mon compte...) et serveur
// (api/_lib/personnages.js).

// Config enregistrée -> synergies valides (persos en synergie distincts,
// malus entier positif ; sans perso en synergie : retirée).
function lireSynergies(brutes) {
  const propres = {};
  if (!brutes || typeof brutes !== "object") return propres;
  Object.entries(brutes).forEach(([id, synergie]) => {
    const persos = Array.isArray(synergie?.persos)
      ? [...new Set(synergie.persos.filter(p => typeof p === "string" && p && p !== id))]
      : [];
    const malus = Math.round(Number(synergie?.malus));
    if (!persos.length || !Number.isFinite(malus) || malus < 0) return;
    propres[id] = { persos, malus };
  });
  return propres;
}

// Points retirés à ce perso dans une box (presents : Set des ids de la
// draft des persos de la box ; null : pas de malus, ex. les vitrines des
// modes en équipe, où les alliés apportent les persos qui manquent).
function malusSynergie(synergies, perso, presents) {
  const synergie = synergies?.[perso?.id];
  if (!synergie || !presents) return 0;
  const absents = synergie.persos.filter(id => !presents.has(id)).length;
  return Math.round(synergie.malus * absents / synergie.persos.length);
}

function appliquerSynergie(points, synergies, perso, presents) {
  return Math.max(0, points - malusSynergie(synergies, perso, presents));
}

if (typeof module !== "undefined") module.exports = { lireSynergies, malusSynergie, appliquerSynergie };
