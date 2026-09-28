// Charge le catalogue de personnages côté serveur (nécessaire pour calculer
// les points de box et valider les actions de draft : on ne fait jamais
// confiance à des points ou une liste de persos envoyés par le client).
//
// Hypothèse : le fichier se trouve à la racine du projet dans DB/characters.json,
// comme pour le reste du site. Le require() d'un JSON est repéré et inclus
// automatiquement par Vercel au build (pas besoin de config supplémentaire).
const personnages = require("../../DB/characters.json");

// ---- Groupes (Voyageur) ----
// Un personnage par élément dans les comptes ("traveler_pyro"...,
// champ "groupe"), chacun avec ses constellations et ses points ; un seul
// personnage (id = le groupe) en draft, dont on choisit l'élément au pick.
// Niveau commun : profil.characters.niveaux[groupe].

// Personnages dont on choisit l'élément au pick. Manekin : élément libre
// (non suivi dans les comptes).
const ELEMENTS = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];
const ELEMENTS_LIBRES = { manekin: ELEMENTS };

function getPersonnages() {
  return personnages;
}

function getPersonnageParId(id) {
  return personnages.find(p => p.id === id) || null;
}

function getTousLesIds() {
  return personnages.map(p => p.id);
}

// Catalogue de la draft : chaque groupe réduit à un seul personnage.
let personnagesDraft = null;

function getPersonnagesDraft() {
  if (!personnagesDraft) {
    const vus = new Set();
    personnagesDraft = [];
    personnages.forEach(p => {
      if (!p.groupe) {
        personnagesDraft.push(p);
      } else if (!vus.has(p.groupe)) {
        vus.add(p.groupe);
        personnagesDraft.push({ ...p, id: p.groupe, element: "all", groupe: undefined });
      }
    });
  }
  return personnagesDraft;
}

function getPersonnageDraftParId(id) {
  return getPersonnagesDraft().find(p => p.id === id) || null;
}

function estGroupe(id) {
  return personnages.some(p => p.groupe === id);
}

// Ancien format : un seul "traveler" (avant la séparation par élément).
// Sa constellation et ses sélections passent au Voyageur Anemo ; son niveau
// reste sous "traveler" (niveau commun du groupe).
function migrerCollectionPersos(collection) {
  if (!collection?.full || collection.full.traveler === undefined) return collection;

  const full = { ...collection.full };
  if (full.traveler_anemo === undefined) full.traveler_anemo = full.traveler;
  delete full.traveler;

  const selections = {};
  Object.entries(collection.selections || {}).forEach(([box, selection]) => {
    selections[box] = { ...selection };
    if (selections[box].traveler) {
      selections[box].traveler_anemo = true;
      delete selections[box].traveler;
    }
  });

  return { ...collection, full, selections };
}

module.exports = {
  ELEMENTS,
  ELEMENTS_LIBRES,
  getPersonnages,
  getPersonnageParId,
  getTousLesIds,
  getPersonnagesDraft,
  getPersonnageDraftParId,
  estGroupe,
  migrerCollectionPersos
};
