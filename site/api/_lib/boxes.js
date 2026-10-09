// Box jouée par chaque rôle (j1 / j2) d'une manche.
// Match normal : la box choisie par le joueur (draft.box_j1 / box_j2) dans
// son propre profil. Entraînement (draft.entrainement) : la box choisie à
// la création, qui peut appartenir à un autre joueur (full ou stuff) ou être
// une box personnalisée ("custom" : persos cochés dans la full box d'un
// joueur, sans dévoiler ses box opti), ou une box fictive (cf.
// _lib/boxes_fictives.js).
const { lireDonneesProprietaire } = require("./boxes_fictives");
const { getPersonnages, getArmes, actualiserPoints } = require("./personnages");
const {
  calculerPointsBox,
  calculerPointsArmesBox,
  calculerPoolJoueur,
  calculerElementsGroupes,
  calculerPoolDisponible,
  calculerBansBonus,
  theatreProfil
} = require("./draft");

// Côté d'un rôle en entraînement : "moi" (box du lanceur) ou "adverse".
function coteEntrainement(draft, role) {
  return role === draft.entrainement.cote_moi ? "moi" : "adverse";
}

// -> { proprietaire, box, persos? } : profil à lire et box à y prendre.
function sourceBoxRole(draft, role) {
  if (draft.entrainement) return draft.entrainement.boxes[coteEntrainement(draft, role)];
  return { proprietaire: draft[`discord_${role}`], box: draft[`box_${role}`] };
}

// Données du profil avec la box personnalisée ajoutée comme sélection
// "custom" (copie : le profil n'est pas modifié).
function donneesBoxRole(profilData, source) {
  if (source?.box !== "custom") return profilData;
  const characters = profilData?.characters || {};
  return {
    ...profilData,
    characters: {
      ...characters,
      selections: {
        ...(characters.selections || {}),
        custom: Object.fromEntries((source.persos || []).map(id => [id, true]))
      }
    }
  };
}

// -> { j1: { data, box, proprietaire }, j2: {...} }
async function chargerDonneesBoxes(draft) {
  const sources = { j1: sourceBoxRole(draft, "j1"), j2: sourceBoxRole(draft, "j2") };
  const [profilJ1, profilJ2] = await Promise.all([
    lireDonneesProprietaire(sources.j1.proprietaire),
    lireDonneesProprietaire(sources.j2.proprietaire)
  ]);
  const profils = { j1: profilJ1, j2: profilJ2 };
  return Object.fromEntries(["j1", "j2"].map(role => [role, {
    data: donneesBoxRole(profils[role], sources[role]),
    box: sources[role].box,
    proprietaire: sources[role].proprietaire
  }]));
}

// Fin du choix des box : points, pools, théâtres et bans d'équilibrage.
// Les places j1/j2 sont encore provisoires ici (le tirage vient après).
async function calculerEquilibrage(draft) {
  const [boxes] = await Promise.all([chargerDonneesBoxes(draft), actualiserPoints()]);
  const personnages = getPersonnages();
  const armes = getArmes();

  ["j1", "j2"].forEach(role => {
    const { data, box } = boxes[role];
    // Points totaux de la box choisie : personnages + armes.
    draft[`points_${role}`] = calculerPointsBox(data, box, personnages) + calculerPointsArmesBox(data, box, armes);
    // Palier de théâtre du propriétaire de la box (calculé sur sa full box) :
    // mode de théâtre "auto".
    draft[`theatre_${role}`] = theatreProfil(data);
    // Pool = personnages de la box choisie (et non toute la Full Box).
    draft[`pool_${role}`] = calculerPoolJoueur(data, personnages, box);
    draft[`elements_${role}`] = calculerElementsGroupes(data, personnages, box);
  });

  const ecart = draft.points_j1 - draft.points_j2;
  // Mode carnage : jamais de bans d'équilibrage.
  const bansBonus = draft.mode_theatre === "carnage" ? 0 : calculerBansBonus(ecart);
  draft.pool_disponible = calculerPoolDisponible(draft.pool_j1, draft.pool_j2);
  draft.bans_bonus_total = bansBonus;
  draft.bans_bonus_faits = 0;
  draft.bans_bonus_choix = [];
  draft.bans_bonus_joueur = bansBonus > 0 ? (ecart > 0 ? "j2" : "j1") : null;
}

module.exports = { coteEntrainement, sourceBoxRole, donneesBoxRole, chargerDonneesBoxes, calculerEquilibrage };
