// Recommandations de la box stuff ("Box stuff" de Mon compte : les
// persos montés). Règles : une ligne par DPS, avec ses supports par
// priorité (config.recommandations_stuff, modifiables sur la page admin ;
// par défaut DB/recommandations_stuff.json, tiré de la feuille "box stuff",
// cf. scripts/recommandations_ods_vers_json.py).
// Ids du catalogue (Voyageur : par élément, "traveler_cryo"...) ;
// constellation_min : support pas compté sous cette constellation.
//
// Calcul : tout perso possédé pas encore monté est candidat, même si rien
// n'est monté autour de lui. Les points du perso dans la full box pèsent le
// plus : score = points x (1 + POIDS_SYNERGIE x synergie), synergie de 0 à 1.
// Poids d'un support dans une ligne = (L + 1 - rang) / L (L = longueur de la
// liste : prio 1 = 1) ; une équipe compte ses NB_SUPPORTS_EQUIPE meilleurs
// supports (5 et non 3 : en draft, les bans empêchent presque toujours la
// meilleure équipe). Un partenaire pas encore monté compte
// FACTEUR_NON_MONTE : c'est ce qui casse le cercle « pas de support sans DPS
// monté, pas de DPS sans support monté ».
// - DPS d'une ligne : valeur de son équipe parmi ses supports possédés,
//   rapportée à son équipe idéale.
// - Support d'une ligne : ce qu'il apporte à ses 3 meilleurs DPS possédés
//   (DPS forts d'abord), rien si l'équipe du DPS est déjà complète sans lui.
// Partagé avec le serveur (validation, api/points.js).

const NB_SUPPORTS_EQUIPE = 5;
const POIDS_SYNERGIE = 0.5;
const FACTEUR_NON_MONTE = 0.5;
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
// personnages : catalogue { id, categorie } ; pointsPerso(id) : points du
// perso dans la full box.
// -> { dps: [...], supports: [...] }, du plus utile au moins utile :
//    { id, points, score, partenaires: [{ id, monte, rang }] } (partenaires :
//    avec qui d'autre le monter, les plus utiles d'abord).
function calculerRecommandationsStuff(regles, collection, personnages, pointsPerso) {
  const full = collection?.full || {};
  const stuff = collection?.selections?.stuff || {};
  const possede = (id, constellation = 0) => typeof full[id] === "number" && full[id] >= constellation;
  const monte = id => possede(id) && !!stuff[id];
  const points = id => Math.max(0, Number(pointsPerso(id)) || 0);

  // Supports d'une ligne, dans l'ordre : { id, poids, rang }.
  const avecPoids = ligne => ligne.supports.map((support, index) => ({
    ...support, rang: index + 1, poids: (ligne.supports.length - index) / ligne.supports.length
  }));
  const comptables = ligne => avecPoids(ligne).filter(support => possede(support.id, support.constellation_min || 0));
  const valeur = (liste, facteur) => liste.map(s => s.poids * facteur(s.id))
    .filter(v => v > 0).sort((a, b) => b - a).slice(0, NB_SUPPORTS_EQUIPE).reduce((somme, v) => somme + v, 0);
  const facteurPartenaire = id => (monte(id) ? 1 : FACTEUR_NON_MONTE);

  const lignesPossedees = regles.filter(ligne => possede(ligne.dps));
  const pointsMax = Math.max(1, ...lignesPossedees.map(ligne => points(ligne.dps)));
  const lignesDps = new Set(regles.map(ligne => ligne.dps));
  const candidats = personnages.filter(p => possede(p.id) && !monte(p.id) && points(p.id) > 0);

  const recommandation = perso => {
    const ligne = regles.find(l => l.dps === perso.id);
    let synergie = 0;
    let partenaires = [];
    if (ligne) {
      const liste = comptables(ligne);
      const ideale = valeur(avecPoids(ligne), () => 1);
      synergie = ideale ? valeur(liste, facteurPartenaire) / ideale : 0;
      partenaires = liste.map(s => ({ id: s.id, monte: monte(s.id), rang: s.rang }));
    } else {
      // Ce qu'il apporte à chaque DPS possédé dont il est un support.
      const apports = lignesPossedees.flatMap(l => {
        const liste = comptables(l);
        const lui = liste.find(s => s.id === perso.id);
        if (!lui) return [];
        const sansLui = liste.filter(s => s.id !== perso.id && monte(s.id));
        if (valeur([...sansLui, lui], () => 1) <= valeur(sansLui, () => 1)) return [];
        return [{
          id: l.dps, monte: monte(l.dps), rang: lui.rang,
          apport: lui.poids * facteurPartenaire(l.dps) * points(l.dps) / pointsMax
        }];
      }).sort((a, b) => b.apport - a.apport);
      synergie = apports.slice(0, 3).reduce((somme, a) => somme + a.apport, 0) / 3;
      partenaires = apports.map(({ id, monte: m, rang }) => ({ id, monte: m, rang }));
    }
    return { id: perso.id, points: points(perso.id), score: points(perso.id) * (1 + POIDS_SYNERGIE * synergie), partenaires };
  };

  const parScore = (a, b) => b.score - a.score || b.partenaires.length - a.partenaires.length;
  const estDps = perso => lignesDps.has(perso.id) || perso.categorie === "dps";
  return {
    dps: candidats.filter(estDps).map(recommandation).sort(parScore),
    supports: candidats.filter(perso => !estDps(perso)).map(recommandation).sort(parScore)
  };
}

if (typeof module !== "undefined") {
  module.exports = { NB_SUPPORTS_EQUIPE, lireRecommandationsStuff, calculerRecommandationsStuff };
}
