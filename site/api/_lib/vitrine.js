// Vitrine d'un joueur (profil.characters.selections.vitrine et
// profil.weapons.selections.vitrine) : les persos qu'il apporte dans les
// modes 2v2, 3v3 et 4v4 (cf. _lib/equipe.js). Même règles dans Mon compte
// (cf. my_account/my_account.js, analyserVitrine).
//   - exactement 12 personnages ;
//   - 1400 points au plus (persos et armes de la vitrine, même total que
//     Mon compte) ;
//   - 6 constellations temporaires au plus (somme des constellations des
//     5★ limités, sans les persos standards) ;
//   - 2 persos C2 ou plus parmi ces 5★ limités.
const { getPersonnages, getArmes, migrerCollectionPersos } = require("./personnages");
const { calculerPointsBox, calculerPointsArmesBox } = require("./draft");

const NB_PERSOS_VITRINE = 12;
const POINTS_MAX_VITRINE = 1400;
const CONSTELLATIONS_TEMPORAIRES_MAX = 6;
const C2_MAX_VITRINE = 2;

// 5★ limité (constellations "temporaires") : ni standard, ni 4★.
function estLimite5(personnage) {
  return String(personnage?.rarete) === "5" && !personnage.standard;
}

// -> { persos: [{ id, draft_id, element, constellation, niveau, limite }],
//      armes: { instance: raffinement }, points, erreurs: [texte] }
// (catalogue à jour : actualiserPoints avant).
function analyserVitrine(profilData) {
  const personnages = getPersonnages();
  const parId = new Map(personnages.map(p => [p.id, p]));
  const collection = migrerCollectionPersos(profilData?.characters) || {};
  const full = collection.full || {};
  const selection = collection.selections?.vitrine || {};

  const persos = Object.keys(selection)
    .filter(id => selection[id] && parId.has(id) && (full[id] ?? -1) >= 0)
    .map(id => {
      const personnage = parId.get(id);
      const niveau = collection.niveaux?.[personnage.groupe || id];
      return {
        id,
        // Id de la draft (Voyageur : le groupe) et élément de ce Voyageur.
        draft_id: personnage.groupe || id,
        element: personnage.groupe ? personnage.element : null,
        constellation: full[id],
        niveau: niveau === 95 || niveau === 100 ? niveau : null,
        limite: estLimite5(personnage)
      };
    });

  const armesFull = profilData?.weapons?.full || {};
  const armesSelection = profilData?.weapons?.selections?.vitrine || {};
  const armes = Object.fromEntries(Object.keys(armesSelection)
    .filter(instance => armesSelection[instance] && Number.isInteger(armesFull[instance]) && armesFull[instance] >= 0)
    .map(instance => [instance, armesFull[instance]]));

  const points = calculerPointsBox(profilData, "vitrine", personnages) + calculerPointsArmesBox(profilData, "vitrine", getArmes());
  const limites = persos.filter(p => p.limite);
  const constellations = limites.reduce((somme, p) => somme + p.constellation, 0);
  const c2 = limites.filter(p => p.constellation >= 2).length;

  const erreurs = [];
  if (persos.length !== NB_PERSOS_VITRINE) erreurs.push(`${NB_PERSOS_VITRINE} personnages exactement (${persos.length} actuellement)`);
  if (points > POINTS_MAX_VITRINE) erreurs.push(`${POINTS_MAX_VITRINE} points au maximum (${points} actuellement)`);
  if (constellations > CONSTELLATIONS_TEMPORAIRES_MAX) erreurs.push(`${CONSTELLATIONS_TEMPORAIRES_MAX} constellations de 5★ limités au maximum (${constellations} actuellement)`);
  if (c2 > C2_MAX_VITRINE) erreurs.push(`${C2_MAX_VITRINE} persos 5★ limités C2 ou plus au maximum (${c2} actuellement)`);

  return { persos, armes, points, erreurs };
}

// Message d'erreur d'une vitrine non conforme, ou null.
function erreurVitrine(profilData) {
  const { erreurs } = analyserVitrine(profilData);
  return erreurs.length ? `Vitrine non conforme aux modes en équipe : ${erreurs.join(", ")}. Modifie-la dans Mon compte.` : null;
}

module.exports = { NB_PERSOS_VITRINE, POINTS_MAX_VITRINE, CONSTELLATIONS_TEMPORAIRES_MAX, C2_MAX_VITRINE, estLimite5, analyserVitrine, erreurVitrine };
