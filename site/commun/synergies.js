// Synergies des personnages (config.synergies, réglées sur la page admin,
// fenêtre "Synergie" d'un perso) : { id du perso: { persos: [ids de la
// draft (Voyageur : "traveler")], malus } }.
// Dans une box qui contient le perso, chaque perso en synergie absent de
// cette même box lui retire malus / nombre de persos en synergie (arrondi),
// après les bonus niveau / théâtre, sans descendre sous 0 : sa valeur
// alternative. Ex. Lauma (Nefer, Columbina), malus 20 : sans Columbina -10,
// sans les 2 -20.
// Même fichier côté pages (commun/cartes.js, mon compte...) et serveur
// (api/_lib/personnages.js). Contient aussi les valeurs alternatives des
// armes (plus bas).

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

// ---- Valeurs alternatives des armes (config.alternatives_armes, réglées
// sur la page admin) ----
// { id de l'arme: { reste: %, groupes: [{ pourcentage, persos: [clés
// signature (Voyageur : "traveler")] }] } } : part des points d'une copie
// portée par un autre perso que celui de sa signature (copie en double,
// signature sans son perso, cf. pointsCopiesArmes) ; persos d'un groupe : le
// pourcentage du groupe (le plus haut s'il est dans plusieurs) ; les autres :
// « le reste ». Ancien format (un nombre) : le reste seul. 100 % par défaut.
const POURCENTAGES_ALTERNATIFS = [0, 25, 50, 75, 100, 125, 150, 175, 200];
const ALTERNATIVE_PAR_DEFAUT = { reste: 100, groupes: [] };

const pourcentageValide = p => POURCENTAGES_ALTERNATIFS.includes(Number(p));

// Une valeur alternative enregistrée -> { reste, groupes } valide
// (clesPersos : Set des clés connues, sinon toutes acceptées).
function lireAlternativeArme(brute, clesPersos = null) {
  if (typeof brute === "number") return { reste: pourcentageValide(brute) ? brute : 100, groupes: [] };
  const reste = pourcentageValide(brute?.reste) ? Number(brute.reste) : 100;
  const groupes = (Array.isArray(brute?.groupes) ? brute.groupes : [])
    .map(groupe => ({
      pourcentage: Number(groupe?.pourcentage),
      persos: [...new Set((Array.isArray(groupe?.persos) ? groupe.persos : [])
        .filter(cle => typeof cle === "string" && cle && (!clesPersos || clesPersos.has(cle))))]
    }))
    .filter(groupe => pourcentageValide(groupe.pourcentage) && groupe.persos.length);
  return { reste, groupes };
}

// Config enregistrée -> { id: { reste, groupes } } sans les valeurs par
// défaut (100 %, aucun groupe).
function lireAlternativesArmes(brutes, idsArmes = null, clesPersos = null) {
  const propres = {};
  if (!brutes || typeof brutes !== "object") return propres;
  Object.entries(brutes).forEach(([id, brute]) => {
    if (idsArmes && !idsArmes.has(id)) return;
    const alternative = lireAlternativeArme(brute, clesPersos);
    if (alternative.reste !== 100 || alternative.groupes.length) propres[id] = alternative;
  });
  return propres;
}

// % d'une copie portée par le perso de cette clé.
function pourcentageAlternatifPerso(alternative, cle) {
  const a = alternative || ALTERNATIVE_PAR_DEFAUT;
  const groupes = a.groupes.filter(groupe => groupe.persos.includes(cle));
  return groupes.length ? Math.max(...groupes.map(groupe => groupe.pourcentage)) : a.reste;
}

// % d'une copie libre dans une box (portée par personne en particulier) :
// le meilleur des persos de la box qui peuvent la porter (persos : [{ cle,
// type }], type d'arme ; sauf la clé exclue, celle de sa signature) ;
// aucun : le reste.
function pourcentageAlternatifBox(alternative, typeArme, persos, exclue = null) {
  const a = alternative || ALTERNATIVE_PAR_DEFAUT;
  const porteurs = persos.filter(p => p.type === typeArme && p.cle !== exclue);
  return porteurs.length ? Math.max(...porteurs.map(p => pourcentageAlternatifPerso(a, p.cle))) : a.reste;
}

if (typeof module !== "undefined") {
  module.exports = {
    lireSynergies, malusSynergie, appliquerSynergie,
    POURCENTAGES_ALTERNATIFS, lireAlternativeArme, lireAlternativesArmes, pourcentageAlternatifPerso, pourcentageAlternatifBox
  };
}
