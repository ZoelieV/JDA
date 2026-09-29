// Charge le catalogue de personnages côté serveur (nécessaire pour calculer
// les points de box et valider les actions de draft : on ne fait jamais
// confiance à des points ou une liste de persos envoyés par le client).
//
// Hypothèse : le fichier se trouve à la racine du projet dans DB/characters.json,
// comme pour le reste du site. Le require() d'un JSON est repéré et inclus
// automatiquement par Vercel au build (pas besoin de config supplémentaire).
const personnages = require("../../DB/characters.json");
const armes = require("../../DB/weapons.json");

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

// ---- Infos d'un personnage chez un joueur (historique des matchs) ----
// Constellation (Voyageur : de l'élément donné, sinon du meilleur),
// niveau 95 / 100 et meilleur raffinement de son arme signature (image
// "[id]_w.webp", copies "idArme#2"... comprises). null si inconnu.
function infosPersoJoueur(profilData, persoId, element = null) {
  const collection = migrerCollectionPersos(profilData?.characters) || {};
  const full = collection.full || {};
  const membres = personnages.filter(p => p.groupe === persoId);

  let constellation = null;
  const valeurs = membres.length
    ? membres.filter(p => !element || p.element === element).map(p => full[p.id])
    : [full[persoId]];
  valeurs.forEach(c => {
    if (typeof c === "number" && c >= 0 && (constellation === null || c > constellation)) constellation = c;
  });

  const niveau = collection.niveaux?.[persoId];

  const arme = armes.find(a => typeof a.image === "string" && a.image.endsWith(`/${persoId}_w.webp`));
  let raffinement = null;
  if (arme) {
    Object.entries(profilData?.weapons?.full || {}).forEach(([cle, valeur]) => {
      if ((cle === arme.id || cle.startsWith(`${arme.id}#`)) && valeur >= 0 && (raffinement === null || valeur > raffinement)) {
        raffinement = valeur;
      }
    });
  }

  return {
    constellation,
    niveau: niveau === 95 || niveau === 100 ? niveau : null,
    raffinement
  };
}

module.exports = {
  infosPersoJoueur,
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
