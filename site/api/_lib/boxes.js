// Box jouée par chaque rôle (j1 / j2) d'une manche.
// Match normal : la box choisie par le joueur (draft.box_j1 / box_j2) dans
// son propre profil. Entraînement (draft.entrainement) : la box choisie à
// la création, qui peut appartenir à un autre joueur (full ou stuff) ou être
// une box personnalisée ("custom" : persos cochés dans la full box d'un
// joueur, sans dévoiler ses box opti), ou une box fictive (cf.
// _lib/boxes_fictives.js).
const { lireDonneesProprietaire } = require("./boxes_fictives");
const { getPersonnages, getArmes, actualiserPoints, getModeEquilibrage } = require("./personnages");
const {
  calculerPointsBox,
  calculerPointsArmesBox,
  calculerPoolJoueur,
  calculerElementsGroupes,
  calculerPoolDisponible,
  calculerBansBonus,
  MARGE_EQUILIBRAGE,
  valeursBansBox,
  valeursCinqEtoiles,
  estEquilibrageVH,
  banVHPossible,
  estEquilibrageFixe,
  verticalite,
  horizontalite,
  calculerEquilibrageFixe,
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
  // Méthode d'équilibrage choisie par les administrateurs, figée ici pour
  // toute la draft (et ses revanches).
  draft.equilibrage = getModeEquilibrage();
  const carnage = draft.mode_theatre === "carnage";
  draft.pool_disponible = calculerPoolDisponible(draft.pool_j1, draft.pool_j2);
  draft.bans_bonus_faits = 0;
  draft.bans_bonus_choix = [];
  draft.bans_bonus_confirmes = false;

  if (draft.equilibrage === "ancien") {
    // Mode carnage : jamais de bans d'équilibrage.
    const bansBonus = carnage ? 0 : calculerBansBonus(ecart);
    draft.bans_bonus_total = bansBonus;
    draft.bans_bonus_joueur = bansBonus > 0 ? (ecart > 0 ? "j2" : "j1") : null;
    draft.valeurs_bans_j1 = null;
    draft.valeurs_bans_j2 = null;
    return;
  }

  // Bans fixes (cf. calculerEquilibrageFixe, _lib/draft.js) : la box à la
  // verticalité la plus faible bannit (nombre imposé, jokers compris).
  if (estEquilibrageFixe(draft)) {
    const valeurs = {};
    ["j1", "j2"].forEach(role => {
      const { data, box } = boxes[role];
      valeurs[role] = valeursBansBox(data, box, personnages, armes, true);
      draft[`verticalite_${role}`] = Math.round(verticalite(valeurs[role]) * 10) / 10;
      draft[`horizontalite_${role}`] = horizontalite(valeurs[role]);
    });
    const faible = verticalite(valeurs.j1) <= verticalite(valeurs.j2) ? "j1" : "j2";
    const fort = faible === "j1" ? "j2" : "j1";
    const resultat = calculerEquilibrageFixe(valeurs[faible], valeurs[fort], draft.equilibrage);
    // Mode carnage : jamais de bans d'équilibrage.
    const total = carnage ? 0 : resultat.bans + resultat.jokers;
    draft.bans_bonus_total = total;
    draft.bans_joker_total = carnage ? 0 : resultat.jokers;
    draft.bans_joker_choix = [];
    draft.theatre_bonus = carnage ? null : resultat.theatre_bonus;
    draft.ecart_prevu = { avant: resultat.ecart_avant, apres: resultat.ecart_apres };
    draft.bans_bonus_joueur = total > 0 ? faible : null;
    draft.valeurs_bans_j1 = null;
    draft.valeurs_bans_j2 = null;
    return;
  }

  // Méthodes libres (cf. pointsApresBansBonus, _lib/draft.js) : bans si
  // l'écart dépasse la marge ; bans_bonus_total = nombre de l'ancienne
  // méthode, pour le temps des bans en classé seulement.
  const avecSignature = draft.equilibrage === "perso_signature";
  ["j1", "j2"].forEach(role => {
    const { data, box } = boxes[role];
    draft[`valeurs_bans_${role}`] = valeursBansBox(data, box, personnages, armes, avecSignature);
  });
  draft.bans_bonus_total = calculerBansBonus(ecart);
  if (estEquilibrageVH(draft)) {
    // Verticalité / horizontalité : celui qui a la box la plus faible
    // (points) bannit, s'il peut faire au moins un ban (cf. banVHPossible).
    ["j1", "j2"].forEach(role => {
      const { data, box } = boxes[role];
      draft[`cinq_${role}`] = valeursCinqEtoiles(data, box, personnages);
    });
    draft.bans_bonus_joueur = carnage || ecart === 0 ? null : ecart > 0 ? "j2" : "j1";
    if (draft.bans_bonus_joueur && !banVHPossible(draft)) draft.bans_bonus_joueur = null;
    return;
  }
  draft.bans_bonus_joueur = !carnage && Math.abs(ecart) > MARGE_EQUILIBRAGE ? (ecart > 0 ? "j2" : "j1") : null;
}

module.exports = { coteEntrainement, sourceBoxRole, donneesBoxRole, chargerDonneesBoxes, calculerEquilibrage };
