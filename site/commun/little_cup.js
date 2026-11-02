// Little Cup (nom réglable, config.little_cup, page admin) : draft sur la
// full box filtrée. Persos 5★ : COUT_MAX_LITTLE_CUP points au plus chez le
// joueur (constellation, niveau, buff théâtre ; 4★ libres). Armes 5★ :
// seulement celle du Voyageur et les permanentes (catégorie "standard").
// Partagé avec le serveur (_lib/boxes.js), seul juge des pools.

const COUT_MAX_LITTLE_CUP = 50;
const ARME_VOYAGEUR_LITTLE_CUP = "traveler_w";

function persoAutoriseLittleCup(perso, points) {
  return String(perso?.rarete) !== "5" || points <= COUT_MAX_LITTLE_CUP;
}

function armeAutoriseeLittleCup(arme) {
  return String(arme?.rarete) !== "5" || arme.id === ARME_VOYAGEUR_LITTLE_CUP || !!arme.categories?.includes("standard");
}

// Profil -> copie sans les persos et armes interdits (collections full).
// pointsPerso(perso, constellation, niveau) : points avant synergie.
function filtrerDonneesLittleCup(data, personnages, armes, pointsPerso) {
  if (!data) return data;
  const parIdPerso = new Map(personnages.map(p => [p.id, p]));
  const parIdArme = new Map(armes.map(a => [a.id, a]));
  const niveaux = data.characters?.niveaux || {};
  const persos = Object.entries(data.characters?.full || {}).filter(([id, constellation]) => {
    const perso = parIdPerso.get(id);
    return !!perso && (constellation < 0 || persoAutoriseLittleCup(perso, pointsPerso(perso, constellation, niveaux[perso.groupe || perso.id] ?? null)));
  });
  const armesGardees = Object.entries(data.weapons?.full || {}).filter(([instance]) => {
    const arme = parIdArme.get(instance.split("#")[0]);
    return !!arme && armeAutoriseeLittleCup(arme);
  });
  return {
    ...data,
    characters: { ...data.characters, full: Object.fromEntries(persos) },
    weapons: { ...data.weapons, full: Object.fromEntries(armesGardees) }
  };
}

if (typeof module !== "undefined") {
  module.exports = { COUT_MAX_LITTLE_CUP, persoAutoriseLittleCup, armeAutoriseeLittleCup, filtrerDonneesLittleCup };
}
