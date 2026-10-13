// Box jouée par chaque rôle (j1 / j2) d'une manche.
// Match normal : la box choisie par le joueur (draft.box_j1 / box_j2) dans
// son propre profil. Entraînement (draft.entrainement) : la box choisie à
// la création, qui peut appartenir à un autre joueur (full ou stuff) ou être
// une box personnalisée ("custom" : persos cochés dans la full box d'un
// joueur, sans dévoiler ses box opti), ou une box fictive (cf.
// _lib/boxes_fictives.js).
const { lireDonneesProprietaire } = require("./boxes_fictives");
const { getPersonnages, getArmes, actualiserPoints, getModeEquilibrage, getLimitesEquilibrage } = require("./personnages");
const {
  calculerPointsBox,
  calculerPointsArmesBox,
  calculerPoolJoueur,
  calculerElementsGroupes,
  calculerPoolDisponible,
  calculerBansBonus,
  modeleEquilibrage,
  estEquilibrageFixe,
  verticalite,
  horizontalite,
  calculerEquilibrageFixe,
  theatreProfil,
  resoudreTheatre,
  calculerPoolJoueur: poolJoueur,
  NB_PERSOS_MIN_BOX
} = require("./draft");

// Équilibrage calculé ("fixe_joker") de 2 box (cf. calculerEquilibrageFixe,
// _lib/draft.js) : { j1: { data, box }, j2: {...} } et palier de théâtre de
// la draft -> { faible, fort, modeles, resultat }.
function evaluerEquilibrageFixe(boxes, palier) {
  const personnages = getPersonnages();
  const armes = getArmes();
  const modeles = {};
  const points = {};
  ["j1", "j2"].forEach(role => {
    const { data, box } = boxes[role];
    modeles[role] = modeleEquilibrage(data, box, personnages, armes);
    points[role] = calculerPointsBox(data, box, personnages) + calculerPointsArmesBox(data, box, armes);
  });
  const faible = verticalite(modeles.j1) <= verticalite(modeles.j2) ? "j1" : "j2";
  const fort = faible === "j1" ? "j2" : "j1";
  const resultat = calculerEquilibrageFixe(modeles[faible], modeles[fort], points.j1 - points.j2, getLimitesEquilibrage(palier));
  return { faible, fort, modeles, resultat };
}

// Box de match d'un joueur : celles qu'il peut choisir (BOX_MATCH dans
// boxesPermises) avec assez de persos.
const BOX_MATCH = ["full", "stuff", "opti1", "opti2", "opti3", "opti4", "opti5"];

// Combinaisons de box (non entraînement) dont l'équilibrage calculé marche,
// pour proposer de revenir au choix des box -> [{ j1, j2 }]. boxesPermises :
// box autorisées dans cette room (ex. full seulement en matchmaking
// classique).
async function combinaisonsEquilibrables(draft, boxesPermises = BOX_MATCH) {
  const [dataJ1, dataJ2] = await Promise.all([
    lireDonneesProprietaire(draft.discord_j1),
    lireDonneesProprietaire(draft.discord_j2)
  ]);
  const personnages = getPersonnages();
  const palier = resoudreTheatre(draft.mode_theatre, theatreProfil(dataJ1), theatreProfil(dataJ2));
  const jouables = data => boxesPermises.filter(box => poolJoueur(data, personnages, box).length >= NB_PERSOS_MIN_BOX);
  const combinaisons = [];
  jouables(dataJ1).forEach(boxJ1 => {
    jouables(dataJ2).forEach(boxJ2 => {
      const { resultat } = evaluerEquilibrageFixe({ j1: { data: dataJ1, box: boxJ1 }, j2: { data: dataJ2, box: boxJ2 } }, palier);
      if (resultat.equilibrable) combinaisons.push({ j1: boxJ1, j2: boxJ2 });
    });
  });
  return combinaisons;
}

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
  draft.bans_joker_choix = [];
  draft.bans_joker_total = 0;
  draft.echange_joker = false;
  draft.equilibrable = true;
  draft.ecart_prevu = null;

  // Bans calculés (cf. calculerEquilibrageFixe, _lib/draft.js) : la box à la
  // verticalité la plus faible bannit (nombre imposé, jokers compris).
  if (estEquilibrageFixe(draft)) {
    // Armes libres attribuées aux persos sans signature (cf.
    // modeleEquilibrage, _lib/draft.js) ; limites du palier de la draft.
    const palier = resoudreTheatre(draft.mode_theatre, draft.theatre_j1, draft.theatre_j2);
    const { faible, modeles, resultat } = evaluerEquilibrageFixe(boxes, palier);
    ["j1", "j2"].forEach(role => {
      draft[`verticalite_${role}`] = Math.round(verticalite(modeles[role]) * 10) / 10;
      draft[`horizontalite_${role}`] = horizontalite(modeles[role]);
    });
    // Mode carnage : jamais de bans d'équilibrage (toujours jouable).
    const total = carnage ? 0 : resultat.bans + resultat.jokers;
    draft.bans_bonus_total = total;
    draft.bans_joker_total = carnage ? 0 : resultat.jokers;
    draft.ecart_prevu = {
      avant: resultat.ecart_avant,
      apres: resultat.ecart_apres,
      cas: resultat.cas,
      top: { [faible]: resultat.top_faible, [faible === "j1" ? "j2" : "j1"]: resultat.top_fort },
      top_apres: { [faible]: resultat.top_faible_apres, [faible === "j1" ? "j2" : "j1"]: resultat.top_fort_apres }
    };
    draft.equilibrable = carnage || resultat.equilibrable;
    draft.bans_bonus_joueur = total > 0 ? faible : null;
    return;
  }

  // Ancienne méthode (et méthode inconnue) : ⌊ écart / SEUIL_EQUILIBRAGE ⌋
  // bans. Mode carnage : jamais de bans d'équilibrage.
  const bansBonus = carnage ? 0 : calculerBansBonus(ecart);
  draft.bans_bonus_total = bansBonus;
  draft.bans_bonus_joueur = bansBonus > 0 ? (ecart > 0 ? "j2" : "j1") : null;
}

module.exports = { coteEntrainement, sourceBoxRole, donneesBoxRole, chargerDonneesBoxes, calculerEquilibrage, combinaisonsEquilibrables, BOX_MATCH };
