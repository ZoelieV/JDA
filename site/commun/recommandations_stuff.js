// Recommandations de la box stuff ("Personnages stuff" de Mon compte : les
// persos montés). Règles : une ligne par DPS, avec ses supports par
// priorité (config.recommandations_stuff, modifiables sur la page admin ;
// par défaut DB/recommandations_stuff.json, tiré de la feuille "box stuff",
// cf. scripts/recommandations_ods_vers_json.py).
// Ids du catalogue (Voyageur : par élément, "traveler_cryo"...) ;
// constellation_min : support pas compté sous cette constellation.
//
// Calcul (gain marginal) : l'équipe d'un DPS monté vaut la somme des poids
// de ses NB_SUPPORTS_EQUIPE meilleurs supports montés (5 et non 3 : en
// draft, les bans empêchent presque toujours la meilleure équipe), poids
// d'un support = (L + 1 - rang) / L (L = longueur de la liste : prio 1 = 1).
// Monter un support possédé rapporte, pour chaque DPS monté, ce que son
// équipe gagne, multiplié par les points du DPS dans la full box ; on
// additionne sur tous les DPS (un support versatile cumule). DPS à monter :
// DPS possédés pas montés, valeur de leur équipe avec les supports déjà
// montés, multipliée par leurs points.
// Partagé avec le serveur (validation, api/points.js).

const NB_SUPPORTS_EQUIPE = 5;
const CONSTELLATION_MAX = 6;

// Règles enregistrées -> règles valides : DPS distincts, supports distincts
// (ni le DPS lui-même), constellation_min entière de 1 à 6 (sinon absente).
// idsConnus (Set, facultatif) : persos inconnus retirés.
function lireRecommandationsStuff(brutes, idsConnus = null) {
  if (!Array.isArray(brutes)) return [];
  const connu = id => typeof id === "string" && id && (!idsConnus || idsConnus.has(id));
  const dpsVus = new Set();
  const regles = [];
  brutes.forEach(ligne => {
    if (!connu(ligne?.dps) || dpsVus.has(ligne.dps)) return;
    dpsVus.add(ligne.dps);
    const vus = new Set([ligne.dps]);
    const supports = [];
    (Array.isArray(ligne.supports) ? ligne.supports : []).forEach(support => {
      if (!connu(support?.id) || vus.has(support.id)) return;
      vus.add(support.id);
      const constellation = Number(support.constellation_min);
      supports.push(Number.isInteger(constellation) && constellation >= 1 && constellation <= CONSTELLATION_MAX
        ? { id: support.id, constellation_min: constellation }
        : { id: support.id });
    });
    regles.push({ dps: ligne.dps, supports });
  });
  return regles;
}

// collection : profil.characters (full : constellations, selections.stuff) ;
// pointsDps(id) : points du DPS dans la full box.
// -> { supports: [{ id, gain, dps: [{ id, rang }] }], dps: [{ id, valeur,
//      supports: [ids montés comptés] }] }, du plus utile au moins utile.
function calculerRecommandationsStuff(regles, collection, pointsDps) {
  const full = collection?.full || {};
  const stuff = collection?.selections?.stuff || {};
  const possede = (id, constellation = 0) => typeof full[id] === "number" && full[id] >= constellation;
  const monte = id => possede(id) && !!stuff[id];

  // Supports comptables d'une ligne, dans l'ordre : { id, poids, rang }.
  const comptables = ligne => ligne.supports
    .map((support, index) => ({ ...support, rang: index + 1, poids: (ligne.supports.length - index) / ligne.supports.length }))
    .filter(support => possede(support.id, support.constellation_min || 0));
  const valeurEquipe = (liste, estMonte) => liste.filter(s => estMonte(s.id))
    .slice(0, NB_SUPPORTS_EQUIPE)
    .reduce((somme, s) => somme + s.poids, 0);

  const gains = new Map();
  const dpsAMonter = [];
  regles.forEach(ligne => {
    if (!possede(ligne.dps)) return;
    const liste = comptables(ligne);
    const poidsDps = Math.max(1, Number(pointsDps(ligne.dps)) || 0);
    const actuelle = valeurEquipe(liste, monte);
    if (!monte(ligne.dps)) {
      if (actuelle > 0) {
        dpsAMonter.push({
          id: ligne.dps,
          valeur: actuelle * poidsDps,
          supports: liste.filter(s => monte(s.id)).slice(0, NB_SUPPORTS_EQUIPE).map(s => s.id)
        });
      }
      return;
    }
    liste.filter(s => !monte(s.id)).forEach(support => {
      const gain = valeurEquipe(liste, id => id === support.id || monte(id)) - actuelle;
      if (gain <= 0) return;
      const entree = gains.get(support.id) || { id: support.id, gain: 0, dps: [] };
      entree.gain += gain * poidsDps;
      entree.dps.push({ id: ligne.dps, rang: support.rang });
      gains.set(support.id, entree);
    });
  });
  return {
    supports: [...gains.values()].sort((a, b) => b.gain - a.gain || b.dps.length - a.dps.length),
    dps: dpsAMonter.sort((a, b) => b.valeur - a.valeur)
  };
}

if (typeof module !== "undefined") {
  module.exports = { NB_SUPPORTS_EQUIPE, lireRecommandationsStuff, calculerRecommandationsStuff };
}
