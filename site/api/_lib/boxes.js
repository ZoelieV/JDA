// Box jouée par chaque rôle (j1 / j2) d'une manche.
// Match normal : la box choisie par le joueur (draft.box_j1 / box_j2) dans
// son propre profil. Entraînement (draft.entrainement) : la box choisie à
// la création, qui peut appartenir à un autre joueur (full ou stuff) ou être
// une box personnalisée ("custom" : persos cochés dans la full box d'un
// joueur, sans dévoiler ses box opti), ou une box fictive (cf.
// _lib/boxes_fictives.js).
const { lireDonneesProprietaire } = require("./boxes_fictives");
const { filtrerDonneesLittleCup } = require("../../commun/little_cup.js");
const { pointsPersonnage, getPersonnages, getArmes, actualiserPoints, getModeEquilibrage, getLimitesEquilibrage, getPointsMaxBox, getSeuilHorizontal } = require("./personnages");
const {
  calculerPointsBox,
  calculerPointsArmesBox,
  calculerPoolJoueur,
  calculerElementsGroupes,
  calculerPoolDisponible,
  calculerBansBonus,
  modeleEquilibrage,
  estEquilibrageFixe,
  estEquilibrageHorizontal,
  valeursHorizontales,
  prevoirBansHorizontaux,
  verticalite,
  horizontalite,
  calculerEquilibrageFixe,
  theatreProfil,
  resoudreTheatre,
  calculerPoolJoueur: poolJoueur,
  NB_PERSOS_MIN_BOX,
  SEUIL_ARMES_BANNIES
} = require("./draft");

// ---- Armes bannies d'office (cf. evaluerEquilibrageFixe) ----
// Ids des armes d'un modèle (signatures et armes libres, toutes copies).
function idsArmesModele(modele) {
  return new Set([
    ...Object.values(modele.persos).map(p => p.signature?.arme).filter(Boolean),
    ...modele.libres.map(l => l.arme)
  ]);
}

// Modèle sans ces armes (signature retirée : le perso peut recevoir une
// arme libre).
function retirerArmesModele(modele, ids) {
  return {
    persos: Object.fromEntries(Object.entries(modele.persos).map(([id, p]) =>
      [id, p.signature && ids.has(p.signature.arme) ? { ...p, signature: null } : p])),
    libres: modele.libres.filter(l => !ids.has(l.arme))
  };
}

// Copies de ces armes dans un modèle, au format de armes_bannies_jX (cf.
// bannirArmesPerso, _lib/draft.js ; perso null : bannie d'office).
function copiesArmesModele(modele, ids) {
  return [
    ...Object.entries(modele.persos).filter(([, p]) => p.signature && ids.has(p.signature.arme))
      .map(([id, p]) => ({ cle: `s:${id}`, arme: p.signature.arme, copie: p.signature.copie ?? 0, perso: null })),
    ...modele.libres.filter(l => ids.has(l.arme)).map(l => ({ cle: l.cle, arme: l.arme, copie: l.copie ?? 0, perso: null }))
  ];
}

// Armes bannies d'office de la grosse box (et chez la petite si elle a les
// mêmes) : 5★ support (catégorie "support" des administrateurs) ; avec
// signatures : aussi les signatures 5★.
function armesBanniesOffice(modeleFort, armes, personnages, signatures = false) {
  const cles = new Set(personnages.map(p => p.groupe || p.id));
  const parId = new Map(armes.map(a => [a.id, a]));
  return new Set([...idsArmesModele(modeleFort)].filter(id => {
    const arme = parId.get(id);
    if (String(arme?.rarete) !== "5") return false;
    if (Array.isArray(arme.categories) && arme.categories.includes("support")) return true;
    const cle = typeof arme.image === "string" && arme.image.match(/([^/]+)_w\.webp$/)?.[1];
    return signatures && cles.has(cle);
  }));
}

// Équilibrage calculé ("fixe_joker") de 2 box (cf. calculerEquilibrageFixe,
// _lib/draft.js) : { j1: { data, box }, j2: {...} } et palier de théâtre de
// la draft -> { faible, fort, modeles (ceux du calcul retenu : sans les
// armes bannies d'office), resultat (resultat.armes_office : { j1, j2 }
// copies bannies d'office, ou null) }.
// - SEUIL_ARMES_BANNIES points d'écart ou plus : armes 5★ support bannies
//   d'office dès le départ ;
// - pas équilibrable avec un joker : second essai avec 2 jokers
//   (deux_jokers : pas d'échange de bans contre un joker supplémentaire, cf.
//   echangeJokerPossible) ;
// - toujours pas équilibrable : armes 5★ support et signatures 5★ bannies
//   d'office, puis de nouveau 1 joker, puis 2.
// Les armes bannies d'office ne sont pas des jokers.
function evaluerEquilibrageFixe(boxes, palier, options = {}) {
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
  const ecart = points.j1 - points.j2;
  // Modèles du calcul et copies bannies d'office, selon les armes retirées.
  const sans = ids => ids.size
    ? {
      modeles: { [faible]: retirerArmesModele(modeles[faible], ids), [fort]: retirerArmesModele(modeles[fort], ids) },
      office: { [faible]: copiesArmesModele(modeles[faible], ids), [fort]: copiesArmesModele(modeles[fort], ids) }
    }
    : { modeles, office: null };
  const calculer = (version, maxJokers, trace, extreme = false) => calculerEquilibrageFixe(version.modeles[faible], version.modeles[fort], ecart, getLimitesEquilibrage(palier), undefined, { ...options, trace, maxJokers, extreme });
  const special = !!options.special;
  // Essais dans l'ordre : le premier équilibrable est retenu (sinon le
  // premier, pour l'affichage du non équilibrable).
  const versions = [sans(Math.abs(ecart) >= SEUIL_ARMES_BANNIES && !special ? armesBanniesOffice(modeles[fort], armes, personnages) : new Set())];
  const essais = [{ version: versions[0], maxJokers: 1 }];
  if (!special) {
    essais.push({ version: versions[0], maxJokers: 2 });
    const toutes = sans(armesBanniesOffice(modeles[fort], armes, personnages, true));
    essais.push({ version: toutes, maxJokers: 1 }, { version: toutes, maxJokers: 2 });
    // Dernier recours (aucun essai équilibrable) : 2 jokers et armes
    // bannies d'office, puis bans non optimaux qui ne touchent que la box
    // forte, tolérance 45 (cf. extreme, calculerEquilibrageFixe).
    essais.push({ version: toutes, maxJokers: 2, extreme: true });
  }
  let retenu = null;
  let premier = null;
  const tentatives = [];
  for (const essai of essais) {
    const trace = options.trace ? [] : null;
    const resultat = calculer(essai.version, essai.maxJokers, trace, !!essai.extreme);
    const tentative = { ...essai, resultat, trace };
    premier ||= tentative;
    tentatives.push(tentative);
    if (resultat.equilibrable) { retenu = tentative; break; }
  }
  const choisi = retenu || premier;
  // Déroulé montré (mode Équilibrage, options.trace) : l'essai retenu, ou,
  // si aucun n'est équilibrable, celui qui va le plus loin (plus petit
  // écart final ; à égalité, le premier), avec la liste de tous les essais
  // (detail.essais).
  const montre = retenu || tentatives.reduce((m, t) => (t.resultat.ecart_apres < m.resultat.ecart_apres ? t : m));
  if (options.trace) options.trace.splice(0, options.trace.length, ...montre.trace);
  const detail = {
    resultat: { ...montre.resultat, deux_jokers: montre.maxJokers === 2, armes_office: montre.version.office },
    essais: tentatives.map(t => ({
      max_jokers: t.maxJokers, armes_office: !!t.version.office, extreme: !!t.extreme,
      ecart_apres: t.resultat.ecart_apres, equilibrable: t.resultat.equilibrable, montre: t === montre
    }))
  };
  const resultat = { ...choisi.resultat, deux_jokers: choisi.maxJokers === 2, armes_office: choisi.version.office };
  return { faible, fort, modeles: choisi.version.modeles, resultat, detail };
}

// Profil d'un joueur pour une draft : filtré pour la Little Cup (cf.
// commun/little_cup.js).
function filtrerProfilDraft(draft, data) {
  return draft?.little_cup ? filtrerDonneesLittleCup(data, getPersonnages(), getArmes(), pointsPersonnage) : data;
}

async function donneesDraft(draft, id) {
  return filtrerProfilDraft(draft, await lireDonneesProprietaire(id));
}

// Box de match d'un joueur : la full box et ses box opti (la box "stuff"
// n'est qu'une indication pour Tous les comptes, plus jouable).
const BOX_MATCH = ["full", "opti1", "opti2", "opti3", "opti4", "opti5", "opti6", "opti7", "opti8"];

// Toute box jouable autre que la full box (opti, personnalisée, opti d'une
// box fictive) : getPointsMaxBox(palier) points au plus (persos + armes),
// palier = celui de la draft (cf. resoudreTheatre) ; réglé par palier sur
// la page admin (3000 sardine, 5000 carpe, 7000 dauphin, 9000 baleine par
// défaut).
function pointsBoxProfil(data, box) {
  return calculerPointsBox(data, box, getPersonnages()) + calculerPointsArmesBox(data, box, getArmes());
}

const NOMS_PALIERS = { 1: "sardine", 2: "carpe", 3: "dauphin", 4: "baleine" };

// Message d'erreur si la box dépasse le plafond du palier de la draft,
// sinon null.
function erreurPointsBox(data, box, palier) {
  if (box === "full") return null;
  const points = pointsBoxProfil(data, box);
  const max = getPointsMaxBox(palier);
  const nom = NOMS_PALIERS[palier] || NOMS_PALIERS[2];
  return points > max
    ? `Hors full box, une box jouable en draft ${nom} vaut ${max} points au plus (celle-ci en vaut ${points}).`
    : null;
}

// Palier de la draft d'une room de match (pas un entraînement) : mode de
// la room et paliers des 2 joueurs (cf. resoudreTheatre).
async function palierDraftRoom(draft) {
  const [dataJ1, dataJ2] = await Promise.all([
    donneesDraft(draft, draft.discord_j1),
    donneesDraft(draft, draft.discord_j2)
  ]);
  return resoudreTheatre(draft.mode_theatre, theatreProfil(dataJ1), theatreProfil(dataJ2));
}

// Combinaisons de box (non entraînement) dont l'équilibrage calculé marche,
// pour proposer de revenir au choix des box -> [{ j1, j2 }]. boxesPermises :
// box autorisées dans cette room (ex. full seulement en matchmaking
// classique).
async function combinaisonsEquilibrables(draft, boxesPermises = BOX_MATCH) {
  const [dataJ1, dataJ2] = await Promise.all([
    donneesDraft(draft, draft.discord_j1),
    donneesDraft(draft, draft.discord_j2)
  ]);
  const personnages = getPersonnages();
  const palier = resoudreTheatre(draft.mode_theatre, theatreProfil(dataJ1), theatreProfil(dataJ2));
  const jouables = data => boxesPermises.filter(box =>
    poolJoueur(data, personnages, box).length >= NB_PERSOS_MIN_BOX && !erreurPointsBox(data, box, palier));
  const combinaisons = [];
  jouables(dataJ1).forEach(boxJ1 => {
    jouables(dataJ2).forEach(boxJ2 => {
      const { resultat } = evaluerEquilibrageFixe({ j1: { data: dataJ1, box: boxJ1 }, j2: { data: dataJ2, box: boxJ2 } }, palier);
      if (resultat.equilibrable) combinaisons.push({ j1: boxJ1, j2: boxJ2 });
    });
  });
  return combinaisons;
}

// Mode spécial de l'entraînement (box non équilibrables, cf.
// handleModeSpecial) : équilibrage recalculé avec autant de bans joker que
// nécessaire (cf. calculerEquilibrageFixe), imposés à la box la plus
// faible. Méthode d'équilibrage calculée seulement (les autres
// s'équilibrent toujours).
async function calculerModeSpecial(draft) {
  if (!estEquilibrageFixe(draft)) return;
  const boxes = await chargerDonneesBoxes(draft);
  const palier = resoudreTheatre(draft.mode_theatre, draft.theatre_j1, draft.theatre_j2);
  const trace = draft.entrainement?.detail_equilibrage && draft.mode_theatre !== "carnage" ? [] : null;
  const { faible, fort, resultat, detail } = evaluerEquilibrageFixe(boxes, palier, { special: true, trace });
  // Horizontal : inchangé (persos horizontaux figés au 1er calcul).
  if (trace) {
    const horizontal = draft.detail_equilibrage?.horizontal || null;
    draft.detail_equilibrage = { ...detailEquilibrage(faible, fort, detail, trace), horizontal };
    if (horizontal) draft.detail_equilibrage.horizontal_prevu = horizontalPrevu(draft, faible, trace);
  }
  draft.bans_bonus_total = resultat.bans + resultat.jokers;
  draft.bans_joker_total = resultat.jokers;
  draft.bans_bonus_joueur = draft.bans_bonus_total > 0 ? faible : null;
  draft.joueur_faible = faible;
  draft.bans_bonus_choix = [];
  draft.bans_joker_choix = [];
  draft.ecart_prevu = { ...(draft.ecart_prevu || {}), avant: resultat.ecart_avant, apres: resultat.ecart_apres, cas: resultat.cas };
  // Toujours pas équilibrable (plus rien à bannir sans vider une box).
  draft.equilibrable_special = resultat.equilibrable;
}

// Deux joueurs (données de profil) peuvent-ils s'affronter en full box dans
// ce mode (arbres des tournois, cf. _lib/tournois.js) ? Carnage et ancienne
// méthode d'équilibrage : toujours ; sinon l'équilibrage calculé doit
// marcher, et chaque full box avoir NB_PERSOS_MIN_BOX persos.
function estEquilibrableFullBox(dataA, dataB, mode) {
  const personnages = getPersonnages();
  if ([dataA, dataB].some(data => poolJoueur(data, personnages, "full").length < NB_PERSOS_MIN_BOX)) return false;
  if (mode === "carnage" || !estEquilibrageFixe({ equilibrage: getModeEquilibrage() })) return true;
  const palier = resoudreTheatre(mode, theatreProfil(dataA), theatreProfil(dataB));
  return evaluerEquilibrageFixe({ j1: { data: dataA, box: "full" }, j2: { data: dataB, box: "full" } }, palier).resultat.equilibrable;
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
// "custom" des persos et des armes (copie : le profil n'est pas modifié).
function donneesBoxRole(profilData, source) {
  if (source?.box !== "custom") return profilData;
  const characters = profilData?.characters || {};
  const weapons = profilData?.weapons || {};
  return {
    ...profilData,
    characters: {
      ...characters,
      selections: {
        ...(characters.selections || {}),
        custom: Object.fromEntries((source.persos || []).map(id => [id, true]))
      }
    },
    weapons: {
      ...weapons,
      selections: {
        ...(weapons.selections || {}),
        custom: Object.fromEntries((source.armes || []).map(instance => [instance, true]))
      }
    }
  };
}

// -> { j1: { data, box, proprietaire }, j2: {...} }
async function chargerDonneesBoxes(draft) {
  const sources = { j1: sourceBoxRole(draft, "j1"), j2: sourceBoxRole(draft, "j2") };
  const [profilJ1, profilJ2] = await Promise.all([
    donneesDraft(draft, sources.j1.proprietaire),
    donneesDraft(draft, sources.j2.proprietaire)
  ]);
  const profils = { j1: profilJ1, j2: profilJ2 };
  return Object.fromEntries(["j1", "j2"].map(role => [role, {
    data: donneesBoxRole(profils[role], sources[role]),
    box: sources[role].box,
    proprietaire: sources[role].proprietaire
  }]));
}

// Mode Équilibrage de l'entraînement (administrateurs et mini admins) :
// déroulé complet du calcul des bans verticaux (trace de
// calculerEquilibrageFixe, _lib/draft.js), montré avant les bans (cf.
// matchmaking/equilibrage.js). Rôles du calcul : places provisoires, les
// mêmes pendant les bans (le tirage J1 / J2 vient après). id : nouveau à
// chaque calcul (le déroulé est remontré).
// detail : { resultat (essai montré), essais } (cf. evaluerEquilibrageFixe).
function detailEquilibrage(faible, fort, { resultat, essais }, trace) {
  return {
    essais,
    armes_office: !!resultat.armes_office,
    id: Date.now(),
    faible,
    fort,
    ...resultat.contexte,
    ecart_avant: resultat.ecart_avant,
    ecart_apres: resultat.ecart_apres,
    top_faible: resultat.top_faible,
    top_fort: resultat.top_fort,
    bans: resultat.bans,
    jokers: resultat.jokers,
    suggestion: resultat.suggestion,
    equilibrable: resultat.equilibrable,
    etapes: trace
  };
}

// Bans horizontaux prévus si les bans verticaux sont ceux de l'optimiseur
// (trace : bans normaux et jokers, cf. prevoirBansHorizontaux).
function horizontalPrevu(draft, faible, trace) {
  const retraits = type => trace.filter(e => e.type === type).map(e => e.choix);
  const choix = retraits("ban");
  const jokers = retraits("joker");
  return prevoirBansHorizontaux(draft, choix.length || jokers.length ? faible : null, choix, jokers);
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
  draft.deux_jokers = false;
  draft.equilibrable = true;
  draft.ecart_prevu = null;
  draft.etape_bonus = null;
  draft.horizontaux_j1 = null;
  draft.horizontaux_j2 = null;
  draft.horizontal_calcule = false;
  draft.bans_horizontaux_total = 0;
  draft.bans_horizontaux_faits = 0;
  draft.bans_horizontaux_joueur = null;
  draft.bans_horizontaux_choix = [];
  ["j1", "j2"].forEach(role => {
    draft[`modele_armes_${role}`] = null;
    draft[`porteurs_h_${role}`] = null;
    draft[`armes_bannies_${role}`] = [];
  });

  // Bans calculés (cf. calculerEquilibrageFixe, _lib/draft.js) : la box à la
  // verticalité la plus faible bannit (nombre imposé, jokers compris).
  if (estEquilibrageFixe(draft)) {
    // Armes libres attribuées aux persos sans signature (cf.
    // modeleEquilibrage, _lib/draft.js) ; limites du palier de la draft.
    const palier = resoudreTheatre(draft.mode_theatre, draft.theatre_j1, draft.theatre_j2);
    const trace = draft.entrainement?.detail_equilibrage && draft.mode_theatre !== "carnage" ? [] : null;
    const { faible, fort, modeles, resultat, detail } = evaluerEquilibrageFixe(boxes, palier, { trace });
    draft.min_persos_equilibrage = getLimitesEquilibrage(palier).min_persos;
    if (trace) draft.detail_equilibrage = detailEquilibrage(faible, fort, detail, trace);
    // Gros écart de points : les armes d'un perso banni pendant les bans
    // d'équilibrage partent avec lui (cf. bannirArmesPerso, _lib/draft.js).
    const armesBannies = !carnage && Math.abs(ecart) >= SEUIL_ARMES_BANNIES;
    const porteurs = { [faible]: armesBannies ? {} : null, [fort]: armesBannies ? {} : null };
    if (armesBannies) ["j1", "j2"].forEach(role => { draft[`modele_armes_${role}`] = modeles[role]; });
    // Armes bannies d'office (5★ support ; match pas équilibrable sinon :
    // aussi les signatures 5★), pour les 2 joueurs (cf.
    // evaluerEquilibrageFixe) : pas des jokers, gardées en revanche.
    if (resultat.armes_office && !carnage) {
      ["j1", "j2"].forEach(role => { draft[`armes_bannies_${role}`] = resultat.armes_office[role].map(copie => ({ ...copie })); });
    }
    // Bans horizontaux : persos jamais entrés dans le top 12 pendant le
    // calcul, figés ici (cf. calculerBansHorizontaux, _lib/draft.js).
    if (estEquilibrageHorizontal(draft)) {
      const details = { faible: trace ? [] : null, fort: trace ? [] : null };
      draft[`horizontaux_${faible}`] = valeursHorizontales(modeles[faible], resultat.verticaux.faible, details.faible, porteurs[faible]);
      draft[`horizontaux_${fort}`] = valeursHorizontales(modeles[fort], resultat.verticaux.fort, details.fort, porteurs[fort]);
      if (armesBannies) ["j1", "j2"].forEach(role => { draft[`porteurs_h_${role}`] = porteurs[role]; });
      draft.seuil_horizontal = getSeuilHorizontal();
      if (trace) {
        draft.detail_equilibrage.horizontal = details;
        draft.detail_equilibrage.horizontal_prevu = horizontalPrevu(draft, faible, trace);
      }
    }
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
    draft.deux_jokers = !carnage && !!resultat.deux_jokers;
    // Box la plus faible (mode spécial de l'entraînement, cf.
    // handleModeSpecial) : celle qui bannit même sans ban calculé.
    draft.joueur_faible = faible;
    return;
  }

  // Ancienne méthode (et méthode inconnue) : ⌊ écart / SEUIL_EQUILIBRAGE ⌋
  // bans. Mode carnage : jamais de bans d'équilibrage.
  const bansBonus = carnage ? 0 : calculerBansBonus(ecart);
  draft.bans_bonus_total = bansBonus;
  draft.bans_bonus_joueur = bansBonus > 0 ? (ecart > 0 ? "j2" : "j1") : null;
  draft.joueur_faible = ecart > 0 ? "j2" : "j1";
}

module.exports = {
  filtrerProfilDraft,
  coteEntrainement,
  sourceBoxRole,
  donneesBoxRole,
  chargerDonneesBoxes,
  calculerEquilibrage,
  combinaisonsEquilibrables,
  estEquilibrableFullBox,
  calculerModeSpecial,
  BOX_MATCH,
  erreurPointsBox,
  palierDraftRoom
};
