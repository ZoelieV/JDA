// Vitrines d'un joueur (profil.characters.selections.vitrine / vitrine2 et
// pareil pour weapons) : 2 vitrines privées (comme les box opti), il en
// choisit une dans le lobby des modes 2v2, 3v3 et 4v4 : les persos qu'il y
// apporte (cf. _lib/equipe.js). Même règles dans Mon compte
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
const BOX_VITRINES = ["vitrine", "vitrine2"];
const NOMS_VITRINES = { vitrine: "Vitrine 1", vitrine2: "Vitrine 2" };

function estBoxVitrine(box) {
  return BOX_VITRINES.includes(box);
}

// 5★ limité (constellations "temporaires") : ni standard, ni 4★.
function estLimite5(personnage) {
  return String(personnage?.rarete) === "5" && !personnage.standard;
}

// -> { persos: [{ id, draft_id, element, constellation, niveau, limite }],
//      armes: { instance: raffinement }, points, erreurs: [texte] }
// (catalogue à jour : actualiserPoints avant).
function analyserVitrine(profilData, box = "vitrine") {
  const personnages = getPersonnages();
  const parId = new Map(personnages.map(p => [p.id, p]));
  const collection = migrerCollectionPersos(profilData?.characters) || {};
  const full = collection.full || {};
  const selection = collection.selections?.[box] || {};

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
  const armesSelection = profilData?.weapons?.selections?.[box] || {};
  const armes = Object.fromEntries(Object.keys(armesSelection)
    .filter(instance => armesSelection[instance] && Number.isInteger(armesFull[instance]) && armesFull[instance] >= 0)
    .map(instance => [instance, armesFull[instance]]));

  const points = calculerPointsBox(profilData, box, personnages) + calculerPointsArmesBox(profilData, box, getArmes());
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
function erreurVitrine(profilData, box = "vitrine") {
  const { erreurs } = analyserVitrine(profilData, box);
  return erreurs.length ? `${NOMS_VITRINES[box] || "Vitrine"} non conforme aux modes en équipe : ${erreurs.join(", ")}. Modifie-la dans Mon compte.` : null;
}

// Vitrine jouée par défaut : la préférée si elle est conforme, sinon la
// première conforme, sinon null.
function vitrineConforme(profilData, prefere = null) {
  const ordre = estBoxVitrine(prefere) ? [prefere, ...BOX_VITRINES.filter(box => box !== prefere)] : BOX_VITRINES;
  return ordre.find(box => !erreurVitrine(profilData, box)) || null;
}

// Aucune vitrine conforme : message (erreurs de chacune).
function erreurAucuneVitrine(profilData) {
  if (vitrineConforme(profilData)) return null;
  return `Aucune vitrine conforme aux modes en équipe. ${BOX_VITRINES.map(box => `${NOMS_VITRINES[box]} : ${analyserVitrine(profilData, box).erreurs.join(", ")}.`).join(" ")} Modifie-les dans Mon compte.`;
}

module.exports = { NB_PERSOS_VITRINE, POINTS_MAX_VITRINE, CONSTELLATIONS_TEMPORAIRES_MAX, C2_MAX_VITRINE, BOX_VITRINES, NOMS_VITRINES, estBoxVitrine, estLimite5, analyserVitrine, erreurVitrine, vitrineConforme, erreurAucuneVitrine };
