const { migrerCollectionPersos, pointsPersonnageBox, palierTheatre, getPersonnages } = require("./personnages");

// ---- Équilibrage ----
//
// Nombre de bans bonus accordés au joueur avec la box la plus faible,
// tous les SEUIL_EQUILIBRAGE points d'écart (palier fixe simple pour
// l'instant : floor(ecart / seuil), donc 399 pts d'écart = 1 ban bonus).
//
// Pensé pour rester modulable : si un système à paliers multiples ou non
// linéaires est voulu plus tard, il suffit de remplacer le corps de
// calculerBansBonus() par une lecture de table de paliers — rien d'autre
// dans ce fichier n'a besoin de changer.
const SEUIL_EQUILIBRAGE = 200;

function calculerBansBonus(ecart) {
  return Math.floor(Math.abs(ecart) / SEUIL_EQUILIBRAGE);
}

// Bans d'équilibrage encore à faire (nombre imposé, jokers compris).
function bansBonusDus(draft) {
  return (draft.bans_bonus_faits || 0) < (draft.bans_bonus_total || 0);
}

// ---- Échange de bans contre un joker (toutes les drafts 1v1) ----
//
// Pendant la phase des bans d'équilibrage, celui qui bannit peut échanger
// BANS_PAR_JOKER de ses bans d'équilibrage normaux contre un ban joker
// (interdit à l'adversaire seulement, cf. appliquerBansBonus). Une seule
// fois par draft, cumulable avec le joker donné par "fixe_joker" ;
// annulable tant que les bans ne sont pas confirmés (draft.echange_joker).
const BANS_PAR_JOKER = 5;

function bansNormaux(draft) {
  return (draft.bans_bonus_total || 0) - (draft.bans_joker_total || 0);
}

function echangeJokerPossible(draft) {
  return draft.phase === "bans_bonus" && !draft.echange_joker && bansNormaux(draft) >= BANS_PAR_JOKER;
}

// Échange (annuler = false) ou annulation (annuler = true). Choix en trop
// retirés de la sélection (les derniers ajoutés).
function echangerBansContreJoker(draft, annuler = false) {
  const signe = annuler ? -1 : 1;
  draft.bans_bonus_total = (draft.bans_bonus_total || 0) - signe * (BANS_PAR_JOKER - 1);
  draft.bans_joker_total = (draft.bans_joker_total || 0) + signe;
  draft.echange_joker = !annuler;
  draft.bans_bonus_choix = (draft.bans_bonus_choix || []).slice(0, bansNormaux(draft));
  draft.bans_joker_choix = (draft.bans_joker_choix || []).slice(0, draft.bans_joker_total);
}

// ---- Bans calculés ("fixe_joker") ----
//
// Le nombre de bans d'équilibrage est calculé par l'algorithme (pas de
// plafond) ; le joueur ne choisit que les persos. Calibré par simulation de
// drafts entre les vraies box (cf. scripts/simulation_equilibrage.js) :
// équipes de 4, valeur d'un perso = points + arme signature, plus une arme
// libre pour les persos sans signature (cf. modeleEquilibrage ; calibrage
// fait avant les armes libres).
//   horizontalité = nombre de persos qui valent des points ;
//   verticalité   = moyenne des VERTICALITE_PERSOS meilleurs persos (ce qui
//                   reste à un joueur une fois les bans et les picks
//                   adverses passés : prédit le mieux l'écart des équipes).
// Écart d'équipe prévu = TAILLE_EQUIPE × écart de verticalité.
// Celui qui a la verticalité la plus faible bannit ; nombre de bans : on
// retire un à un le perso qui réduit le plus l'écart prévu (ban global : un
// perso que les 2 ont est retiré des 2 box), jusqu'à un écart prévu de
// MARGE_FIXE ou moins, dans les limites de getLimitesEquilibrage (top 12
// du petit joueur, nombre de persos) : un ban joker au plus (retiré de la
// box adverse seulement, le banneur peut encore le picker), et match non
// équilibrable si l'écart reste trop grand (cf. calculerEquilibrageFixe).
const VERTICALITE_PERSOS = 12;
const TAILLE_EQUIPE = 4;
const MARGE_FIXE = 25;

// Méthodes à bans calculés : "fixe_joker", et "fixe_horizontal" (la même,
// suivie des bans horizontaux, cf. calculerBansHorizontaux).
const METHODES_FIXES = ["fixe_joker", "fixe_horizontal"];

function estEquilibrageFixe(draft) {
  return METHODES_FIXES.includes(draft?.equilibrage);
}

function estEquilibrageHorizontal(draft) {
  return draft?.equilibrage === "fixe_horizontal";
}

// ---- Modèle d'une box pour la verticalité ----
//
// valeur d'un perso = ses points (Voyageur : son meilleur élément) + la
// meilleure copie de son arme signature dans la box (pleine valeur).
// Armes libres, à la même valeur que dans les points de la box (cf.
// calculerPointsArmesBox) : copies en double d'une signature et signatures
// dont le perso n'est pas dans la box (valeur alternative, arme.alternatif),
// armes signature d'aucun perso (perma, Ultime soupir... : 1re copie pleine
// valeur, doublons valeur alternative). Chaque arme libre est attribuée à un
// perso sans sa signature, du même type d'arme (arme support : persos
// support ou sub-dps ; autre arme : persos sub-dps ou dps), un perso par
// arme, au plus grand gain de verticalité (cf. attribuerArmesLibres).
// -> { persos: { id: { valeur, type, support, attaque, signature: { pleine,
//      alternative, type, support } | null } }, libres: [{ cle, valeur, type,
//      support }] } (cle : repère de l'arme libre, cf. armesVerticales).
const CATEGORIES_ARME_SUPPORT = ["support", "subdps"];
const CATEGORIES_ARME_ATTAQUE = ["subdps", "dps"];

function modeleEquilibrage(profilData, boxChoisie, personnages, armes) {
  const persos = {};
  const liste = getPersonnagesBox(profilData, personnages, boxChoisie);
  const presents = idsDraftBox(liste);
  liste.forEach(({ personnage, valeur, niveau }) => {
    const id = personnage.groupe || personnage.id;
    const points = pointsPersonnageBox(personnage, valeur, niveau, presents);
    if (persos[id] && persos[id].valeur >= points) return;
    persos[id] = {
      valeur: points,
      type: personnage.arme,
      support: CATEGORIES_ARME_SUPPORT.includes(personnage.categorie),
      attaque: CATEGORIES_ARME_ATTAQUE.includes(personnage.categorie),
      signature: null
    };
  });

  const collection = profilData?.weapons || {};
  const parId = new Map(armes.map(arme => [arme.id, arme]));
  const clesCatalogue = new Set(personnages.map(p => p.groupe || p.id));
  const copies = new Map();
  Object.entries(collection.full || {}).forEach(([instance, valeur]) => {
    const arme = parId.get(instance.split("#")[0]);
    const raffinement = Number(valeur);
    if (!arme || !Number.isInteger(raffinement) || raffinement < 0) return;
    if (boxChoisie !== "full" && !collection.selections?.[boxChoisie]?.[instance]) return;
    if (!copies.has(arme.id)) copies.set(arme.id, []);
    copies.get(arme.id).push(raffinement);
  });

  const libres = [];
  copies.forEach((raffinements, id) => {
    const arme = parId.get(id);
    const cle = typeof arme.image === "string" && arme.image.match(/([^/]+)_w\.webp$/)?.[1];
    const signature = clesCatalogue.has(cle);
    const support = Array.isArray(arme.categories) && arme.categories.includes("support");
    raffinements.sort((a, b) => b - a).forEach((raffinement, index) => {
      const pleine = Number(arme.PPW?.[raffinement] ?? 0);
      const alternative = Math.round(pleine * (arme.alternatif ?? 100) / 100);
      const libre = { cle: `l${libres.length}`, type: arme.type, support };
      if (!signature) libres.push({ ...libre, valeur: index === 0 ? pleine : alternative });
      else if (index === 0 && persos[cle]) persos[cle].signature = { pleine, alternative, type: arme.type, support };
      else libres.push({ ...libre, valeur: alternative });
    });
  });
  return { persos, libres };
}

// Verticalité d'un modèle sans les persos bannis -> { verticalite, top (ids
// des VERTICALITE_PERSOS meilleurs), armes (cles des armes libres données
// à un perso du top) }. garderArmes : la signature d'un perso banni reste
// dans la box comme arme libre (sinon elle part avec lui).
function mesurerVerticalite(modele, bannis = new Set(), garderArmes = true) {
  const libres = [...modele.libres];
  const persos = [];
  Object.entries(modele.persos).forEach(([id, p]) => {
    if (bannis.has(id)) {
      if (garderArmes && p.signature) libres.push({ cle: `s:${id}`, valeur: p.signature.alternative, type: p.signature.type, support: p.signature.support });
      return;
    }
    persos.push({ id, valeur: p.valeur + (p.signature?.pleine || 0), receveur: !p.signature, type: p.type, support: p.support, attaque: p.attaque });
  });
  attribuerArmesLibres(persos, libres);
  persos.sort((a, b) => b.valeur - a.valeur);
  const top = persos.slice(0, VERTICALITE_PERSOS);
  return {
    verticalite: top.reduce((somme, p) => somme + p.valeur, 0) / VERTICALITE_PERSOS,
    top: top.map(p => p.id),
    armes: top.filter(p => p.arme).map(p => p.arme)
  };
}

// Attribution gloutonne, de l'arme libre la plus forte à la plus faible :
// au perso compatible qui fait le plus monter la somme du top (dans le top :
// toute la valeur de l'arme ; hors du top : ce qui dépasse le dernier du
// top) ; ex aequo : le mieux classé. Arme sans gain : pas attribuée.
function attribuerArmesLibres(persos, libres) {
  libres.sort((a, b) => b.valeur - a.valeur).forEach(arme => {
    if (arme.valeur <= 0) return;
    persos.sort((a, b) => b.valeur - a.valeur);
    const dernier = persos.length >= VERTICALITE_PERSOS ? persos[VERTICALITE_PERSOS - 1].valeur : 0;
    let meilleur = null;
    persos.forEach((p, rang) => {
      if (!p.receveur || p.type !== arme.type || !(arme.support ? p.support : p.attaque)) return;
      const gain = rang < VERTICALITE_PERSOS ? arme.valeur : Math.max(0, p.valeur + arme.valeur - dernier);
      if (gain > 0 && (!meilleur || gain > meilleur.gain)) meilleur = { p, gain };
    });
    if (!meilleur) return;
    meilleur.p.valeur += arme.valeur;
    meilleur.p.receveur = false;
    meilleur.p.arme = arme.cle;
  });
}

function verticalite(modele) {
  return mesurerVerticalite(modele).verticalite;
}

function horizontalite(modele) {
  return Object.values(modele?.persos || {}).filter(p => p.valeur > 0).length;
}

// Écart de points entre les 2 box (draft.points_jX) à partir duquel la
// signature d'un perso banni part avec lui au lieu de rester comme arme
// libre : face à une box bien plus investie, chaque ban doit retirer plus,
// sinon il en faudrait tant que la draft se jouerait presque sans 5★.
const SEUIL_ARMES_BANNIES = 4000;

// Écart prévu accepté en fin de calcul (objectif MARGE_FIXE) : au-delà, le
// match n'est pas équilibrable.
const TOLERANCE_FIXE = 30;

// Cas du calcul selon le top 12 (somme des VERTICALITE_PERSOS meilleurs) des
// 2 box au départ (limites : cf. getLimitesEquilibrage, _lib/personnages.js) :
//   "normal"   : petit joueur au-dessus de seuil_bas ; joker dès qu'un ban
//                optimal ferait passer son top 12 sous seuil_bas ;
//   "petit"    : petit joueur sous seuil_bas, gros au-dessus de seuil_haut ;
//                joker dès qu'un ban optimal touche un de ses persos ;
//   "plancher" : petit joueur sous seuil_bas, gros entre les deux seuils ;
//                pas de joker, les 2 top 12 restent au-dessus de plancher ;
//   "deux_petits" : les 2 sous seuil_bas ; pas de joker.
function casEquilibrage(topFaible, topFort, limites) {
  if (topFaible >= limites.seuil_bas) return "normal";
  if (topFort > limites.seuil_haut) return "petit";
  if (topFort >= limites.seuil_bas) return "plancher";
  return "deux_petits";
}

// modeleFaible / modeleFort : cf. modeleEquilibrage ; ecartPoints : écart
// de points entre les 2 box (cf. SEUIL_ARMES_BANNIES) ; limites : cf.
// getLimitesEquilibrage. Bans optimaux un à un (le plus grand gain d'écart
// prévu) jusqu'à un écart prévu de MARGE_FIXE ou moins. Un ban qui ne
// respecte pas les limites du cas (cf. casEquilibrage) ou qui ferait passer
// une box sous min_persos : joker à la place si le cas le permet (une fois),
// sinon arrêt. Après le joker, seuls les bans à sens unique (persos que le
// petit joueur n'a pas) continuent : le prochain ban optimal qui le touche
// arrête le calcul. Écart prévu final au-delà de TOLERANCE_FIXE : pas
// équilibrable.
// -> { bans, jokers, ecart_avant, ecart_apres, suggestion (bans puis joker
// supposés par le calcul), equilibrable, cas, top_faible, top_fort,
// top_faible_apres, top_fort_apres, verticaux: { faible, fort } (cf.
// valeursHorizontales) }.
// special (mode spécial de l'entraînement, cf. handleModeSpecial) : autant
// de jokers que nécessaire, dans tous les cas (même les 2 box sous les
// seuils) ; un joker n'est limité que par min_persos de la box forte.
function calculerEquilibrageFixe(modeleFaible, modeleFort, ecartPoints, limites, marge = MARGE_FIXE, { special = false } = {}) {
  const garderArmes = Math.abs(ecartPoints) < SEUIL_ARMES_BANNIES;
  const bannisFort = new Set();
  const bannisFaible = new Set();
  const restants = (modele, bannis) => Object.keys(modele.persos).filter(id => !bannis.has(id)).length;
  const mesure = () => ({
    fort: mesurerVerticalite(modeleFort, bannisFort, garderArmes),
    faible: mesurerVerticalite(modeleFaible, bannisFaible, garderArmes)
  });
  const top = m => Math.round(m.verticalite * VERTICALITE_PERSOS);
  const prevu = () => {
    const { fort, faible } = mesure();
    return Math.round(TAILLE_EQUIPE * (fort.verticalite - faible.verticalite));
  };
  const depart = mesure();
  // Persos et armes libres entrés au moins une fois dans le top 12 de
  // chaque box au fil du calcul (départ, puis après chaque ban / joker).
  const verticaux = { faible: { persos: new Set(), armes: new Set() }, fort: { persos: new Set(), armes: new Set() } };
  const noterVerticaux = m => ["faible", "fort"].forEach(cote => {
    m[cote].top.forEach(id => verticaux[cote].persos.add(id));
    m[cote].armes.forEach(cle => verticaux[cote].armes.add(cle));
  });
  noterVerticaux(depart);
  const cas = casEquilibrage(top(depart.faible), top(depart.fort), limites);
  const jokerPermis = special || cas === "normal" || cas === "petit";
  const resultat = {
    bans: 0, jokers: 0, ecart_avant: prevu(), ecart_apres: null, suggestion: [], equilibrable: true,
    cas, top_faible: top(depart.faible), top_fort: top(depart.fort)
  };

  // Retrait candidat (persos du top de la box forte : en retirer un autre ne
  // la fait pas baisser) -> { id, gain, commun, valide } ; joker : retiré
  // de la box forte seulement.
  const essayer = (id, joker) => {
    const commun = !joker && id in modeleFaible.persos && !bannisFaible.has(id);
    const avant = prevu();
    bannisFort.add(id);
    if (commun) bannisFaible.add(id);
    const gain = avant - prevu();
    const apres = mesure();
    bannisFort.delete(id);
    if (commun) bannisFaible.delete(id);
    const persosOk = restants(modeleFort, bannisFort) - 1 >= limites.min_persos &&
      (!commun || restants(modeleFaible, bannisFaible) - 1 >= limites.min_persos);
    const limitesOk = cas === "normal" ? !commun || top(apres.faible) >= limites.seuil_bas
      : cas === "petit" ? !commun
        : cas === "plancher" ? top(apres.faible) >= limites.plancher && top(apres.fort) >= limites.plancher
          : true;
    return { id, gain, commun, persosOk, valide: persosOk && limitesOk };
  };
  const valeur = id => modeleFort.persos[id].valeur + (modeleFort.persos[id].signature?.pleine || 0);
  const meilleur = joker => mesure().fort.top
    .map(id => essayer(id, joker))
    .filter(r => r.gain > 0)
    .reduce((m, r) => (!m || r.gain > m.gain || (r.gain === m.gain && valeur(r.id) > valeur(m.id)) ? r : m), null);

  while (prevu() > marge) {
    const ban = meilleur(false);
    if (!ban) break;
    if (ban.valide && !(resultat.jokers && ban.commun)) {
      bannisFort.add(ban.id);
      if (ban.commun) bannisFaible.add(ban.id);
      resultat.bans++;
      resultat.suggestion.push(ban.id);
      noterVerticaux(mesure());
      continue;
    }
    // Ban impossible : joker (une fois, si le cas le permet ; mode spécial :
    // autant que nécessaire), sinon fin.
    if (!jokerPermis || (resultat.jokers && !special)) break;
    const joker = meilleur(true);
    if (!joker || !(special ? joker.persosOk : joker.valide)) break;
    bannisFort.add(joker.id);
    resultat.jokers++;
    resultat.suggestion.push(joker.id);
    noterVerticaux(mesure());
  }
  const fin = mesure();
  resultat.ecart_apres = prevu();
  resultat.top_faible_apres = top(fin.faible);
  resultat.top_fort_apres = top(fin.fort);
  resultat.equilibrable = resultat.ecart_apres <= TOLERANCE_FIXE;
  resultat.verticaux = verticaux;
  return resultat;
}

// ---- Bans horizontaux ("fixe_horizontal") ----
//
// Persos horizontaux d'une box : ceux qui ne sont jamais entrés dans son
// top 12 pendant le calcul des bans verticaux (verticaux : cf.
// calculerEquilibrageFixe), figés à ce moment-là. Valeur = points + arme
// signature, plus une arme libre jamais entrée dans le top 12 pour les
// persos sans signature (même type d'arme et mêmes rôles que pour la
// verticalité, la plus forte arme au perso compatible qui vaut le plus).
// -> { id: valeur }
function valeursHorizontales(modele, verticaux) {
  const persos = Object.entries(modele.persos)
    .filter(([id]) => !verticaux.persos.has(id))
    .map(([id, p]) => ({ id, valeur: p.valeur + (p.signature?.pleine || 0), receveur: !p.signature, type: p.type, support: p.support, attaque: p.attaque }));
  modele.libres
    .filter(arme => !verticaux.armes.has(arme.cle) && arme.valeur > 0)
    .sort((a, b) => b.valeur - a.valeur)
    .forEach(arme => {
      const receveur = persos
        .filter(p => p.receveur && p.type === arme.type && (arme.support ? p.support : p.attaque))
        .sort((a, b) => b.valeur - a.valeur)[0];
      if (!receveur) return;
      receveur.valeur += arme.valeur;
      receveur.receveur = false;
    });
  return Object.fromEntries(persos.map(p => [p.id, p.valeur]));
}

// Seuil par défaut : 1 ban horizontal tous les SEUIL_HORIZONTAL points
// d'écart entre les sommes horizontales (réglable sur la page admin, cf.
// getSeuilHorizontal dans _lib/personnages.js).
const SEUIL_HORIZONTAL = 200;

// Persos horizontaux encore jouables par ce rôle (ni bannis pendant les
// bans verticaux, ni retirés de sa box par un joker).
function horizontauxDisponibles(draft, role) {
  const pool = new Set(draft[`pool_${role}`] || []);
  const disponibles = new Set(draft.pool_disponible || []);
  return Object.keys(draft[`horizontaux_${role}`] || {}).filter(id => pool.has(id) && disponibles.has(id));
}

// Persos d'une box encore jouables après ces bans (globaux).
function restantsApres(draft, role, bannis) {
  const disponibles = new Set(draft.pool_disponible || []);
  return (draft[`pool_${role}`] || []).filter(id => disponibles.has(id) && !bannis.includes(id)).length;
}

// Cibles encore possibles d'un ban horizontal, après les choix en cours :
// persos horizontaux de l'adversaire, sans faire passer une box sous le
// nombre de persos minimum de la draft (ban global : la box du banneur
// perd aussi le perso s'il l'a).
function ciblesHorizontales(draft, choix = draft.bans_horizontaux_choix || []) {
  const banneur = draft.bans_horizontaux_joueur;
  if (!banneur) return [];
  const adverse = banneur === "j1" ? "j2" : "j1";
  const minimum = draft.min_persos_equilibrage || 0;
  return horizontauxDisponibles(draft, adverse).filter(id => !choix.includes(id) &&
    ["j1", "j2"].every(role => !(draft[`pool_${role}`] || []).includes(id) || restantsApres(draft, role, [...choix, id]) >= minimum));
}

// Fin des bans verticaux : sommes horizontales des 2 box (après les bans
// verticaux réellement faits), puis ⌊ écart / seuil ⌋ bans horizontaux pour
// la plus petite somme, nombre figé, plafonné par les cibles possibles. Une
// seule fois par draft (revanches : bans gardés).
function calculerBansHorizontaux(draft) {
  draft.horizontal_calcule = true;
  const somme = role => horizontauxDisponibles(draft, role)
    .reduce((total, id) => total + (draft[`horizontaux_${role}`][id] || 0), 0);
  draft.somme_horizontale_j1 = somme("j1");
  draft.somme_horizontale_j2 = somme("j2");
  const ecart = draft.somme_horizontale_j1 - draft.somme_horizontale_j2;
  const nombre = Math.floor(Math.abs(ecart) / (draft.seuil_horizontal || SEUIL_HORIZONTAL));
  draft.bans_horizontaux_joueur = nombre > 0 ? (ecart < 0 ? "j1" : "j2") : null;
  draft.bans_horizontaux_total = nombre > 0 ? Math.min(nombre, ciblesHorizontales(draft, []).length) : 0;
  if (!draft.bans_horizontaux_total) draft.bans_horizontaux_joueur = null;
  draft.bans_horizontaux_faits = 0;
  draft.bans_horizontaux_choix = [];
}

// Bans horizontaux à faire maintenant (calculés au premier appel, après
// les bans verticaux). Pas en carnage ni avec les autres méthodes.
function preparerBansHorizontaux(draft) {
  if (!estEquilibrageHorizontal(draft) || draft.mode_theatre === "carnage") return false;
  if (!draft.horizontal_calcule) calculerBansHorizontaux(draft);
  return (draft.bans_horizontaux_faits || 0) < (draft.bans_horizontaux_total || 0);
}

// Bans horizontaux confirmés (ou complétés au hasard) : bans globaux.
function appliquerBansHorizontaux(draft, choix, aleatoires = new Set()) {
  const joueur = draft.bans_horizontaux_joueur;
  choix.forEach(persoId => {
    draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
    draft.actions.push({ joueur, type: "ban", perso_id: persoId, bonus: true, horizontal: true, ...(aleatoires.has(persoId) ? { aleatoire: true } : {}) });
  });
  // Moins de bans que prévu si plus aucune cible n'était possible.
  draft.bans_horizontaux_faits = draft.bans_horizontaux_total;
  draft.bans_horizontaux_choix = [];
}

// Phase "bans_bonus" : étape des bans verticaux, ou des bans horizontaux
// (draft.etape_bonus = "horizontal") -> joueur qui bannit.
function acteurBansBonus(draft) {
  return draft.etape_bonus === "horizontal" ? draft.bans_horizontaux_joueur : draft.bans_bonus_joueur;
}

// Bans d'équilibrage confirmés (ou tirés au hasard à la fin du temps) :
// bans normaux retirés pour les 2 joueurs ; jokers retirés de la box
// adverse seulement (le banneur peut encore le picker, l'adversaire peut
// encore le bannir en draft).
function appliquerBansBonus(draft, joueur, choix, jokers = [], aleatoires = new Set()) {
  const adverse = joueur === "j1" ? "j2" : "j1";
  const hasard = id => (aleatoires.has(id) ? { aleatoire: true } : {});
  choix.forEach(persoId => {
    draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
    draft.actions.push({ joueur, type: "ban", perso_id: persoId, bonus: true, ...hasard(persoId) });
  });
  jokers.forEach(persoId => {
    draft[`pool_${adverse}`] = (draft[`pool_${adverse}`] || []).filter(id => id !== persoId);
    // Plus personne ne l'a (le banneur ne l'a pas) : retiré de la draft
    // aussi, pour ne pas pouvoir le bannir une 2e fois pour rien.
    if (!(draft[`pool_${joueur}`] || []).includes(persoId)) {
      draft.pool_disponible = draft.pool_disponible.filter(id => id !== persoId);
    }
    draft.actions.push({ joueur, type: "ban", perso_id: persoId, bonus: true, joker: true, ...hasard(persoId) });
  });
  draft.bans_bonus_faits = choix.length + jokers.length;
  draft.bans_bonus_choix = [];
  draft.bans_joker_choix = [];
}

// ---- Séquence fixe de la draft (hors bans bonus) ----
//
// Décrite en "blocs" pour rester lisible, puis aplatie en actions
// individuelles pour être consommée une à la fois via sequence_index.
const BLOCS_SEQUENCE = [
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "pick", nombre: 1 },
  { joueur: "j2", type: "pick", nombre: 2 },
  { joueur: "j1", type: "pick", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "ban", nombre: 1 },
  { joueur: "j1", type: "ban", nombre: 1 },
  { joueur: "j2", type: "pick", nombre: 1 },
  { joueur: "j1", type: "pick", nombre: 2 },
  { joueur: "j2", type: "pick", nombre: 1 }
];

const SEQUENCE_FIXE = BLOCS_SEQUENCE.flatMap(bloc =>
  Array.from({ length: bloc.nombre }, () => ({ joueur: bloc.joueur, type: bloc.type }))
);

// ---- Paliers de théâtre : nombre de bans de la draft ----
//
// Même squelette pour tous : bans du 1er tour (j1, j2, j1...), picks j1,
// j2, j2, j1, bans du 2e tour (j2, j1...), picks j2, j1, j1, j2. Seul le
// nombre de bans par joueur change (palier du compte, cf. palierTheatre
// dans _lib/personnages.js) :
//   1 sardine : 2 + 1 (ancien théâtre 10)
//   2 carpe   : 2 + 2 (ancien théâtre 12, = SEQUENCE_FIXE ; mêlée générale,
//               carnage et mode en équipe)
//   3 dauphin : 3 + 2
//   4 baleine : 3 + 3
// Ne s'applique qu'après le tirage du boss : les bans d'équilibrage ne
// changent pas. Anciens matchs (historique) : théâtre 6, 8, 10 ou 12.
const PALIERS_THEATRE = {
  1: { mode: "sardine", bans: [2, 1] },
  2: { mode: "carpe", bans: [2, 2] },
  3: { mode: "dauphin", bans: [3, 2] },
  4: { mode: "baleine", bans: [3, 3] }
};
const THEATRE_CARPE = 2;
// Mode "12" : mêlée générale (matchmaking, classé, entraînement), draft de
// la carpe pour tous ; valeur gardée pour les anciens matchs (classement).
const MODE_MELEE = "12";
// Mode d'une room : "auto" (palier du joueur au plus petit palier), un
// palier imposé (room privée, entraînement), la mêlée générale ou
// "carnage" (carpe sans bans d'équilibrage, hors classé).
const MODES_THEATRE = ["auto", ...Object.values(PALIERS_THEATRE).map(p => p.mode), MODE_MELEE, "carnage"];
// Ancienne draft sans palier enregistré : considéré comme le plus petit.
const THEATRE_PAR_DEFAUT = 1;

function sequenceTheatre(theatre) {
  const [bans1, bans2] = (PALIERS_THEATRE[theatre] || PALIERS_THEATRE[THEATRE_CARPE]).bans;
  const bans = (nombre, premier) => {
    const second = premier === "j1" ? "j2" : "j1";
    const reste = { [premier]: nombre, [second]: nombre };
    const res = [];
    for (let joueur = premier; reste.j1 + reste.j2 > 0; joueur = joueur === "j1" ? "j2" : "j1") {
      if (reste[joueur] > 0) {
        res.push({ joueur, type: "ban" });
        reste[joueur]--;
      }
    }
    return res;
  };
  const picks = ordre => ordre.map(joueur => ({ joueur, type: "pick" }));
  return [
    ...bans(bans1, "j1"),
    ...picks(["j1", "j2", "j2", "j1"]),
    ...bans(bans2, "j2"),
    ...picks(["j2", "j1", "j1", "j2"])
  ];
}

// Palier de théâtre du compte, calculé sur le cost de sa full box
// (cf. palierTheatre, _lib/personnages.js).
function theatreProfil(profilData) {
  return palierTheatre(profilData);
}

// Théâtre de la draft (palier 1..4) : imposé par le mode, sinon ("auto")
// celui du joueur au plus petit palier. Palier inconnu (room d'avant les
// paliers actuels) : le plus petit.
function resoudreTheatre(mode, theatreJ1, theatreJ2) {
  if (mode === "carnage" || mode === MODE_MELEE) return THEATRE_CARPE;
  const impose = Object.keys(PALIERS_THEATRE).find(palier => PALIERS_THEATRE[palier].mode === mode);
  if (impose) return Number(impose);
  const palier = theatre => (PALIERS_THEATRE[theatre] ? Number(theatre) : THEATRE_PAR_DEFAUT);
  return Math.min(palier(theatreJ1), palier(theatreJ2));
}


// Entraînement joué seul : le lanceur tient les 2 rôles (mêmes comptes en
// j1 et j2), chacun à son tour (cf. agirEn dans _lib/room.js).
function estEntrainementSolo(draft) {
  return !!draft?.entrainement && draft.discord_j1 === draft.discord_j2;
}

// Séquence de la manche (fixée au tirage du boss) ; draft de la carpe
// avant le tirage ou pour une ancienne manche.
function getSequence(draft) {
  return Array.isArray(draft?.sequence) ? draft.sequence : SEQUENCE_FIXE;
}

// ---- État initial d'une manche ----
//
// Déroulé : choix_box (box adverse cachée) -> analyse (les 2 box visibles,
// ready-check) -> bans_bonus (si écart) -> tirage j1/j2 + boss -> draft ->
// temps -> verification -> termine (ou litige).
// verification : les 2 temps saisis sont visibles des 2 joueurs, qui les
// confirment chacun (chaque temps est chronométré par l'adversaire) ; un
// litige invalide la manche (archivée pour les administrateurs seulement). Une revanche (etatRevanche) repart directement en
// "analyse" avec les mêmes box et bans d'équilibrage, rôles inversés.
//
// discord_j1 / discord_j2 : qui est "j1" et "j2". Avant le tirage
// (roles_tires = false) ce ne sont que des places provisoires (créateur de
// la room en j1, cf. _lib/room.js) ; le tirage les échange ou non au hasard
// (lancerTirage). En revanche, ils sont échangés sans tirage.
function etatInitialDraft() {
  return {
    phase: "choix_box", // choix_box -> [non_equilibrable ->] analyse -> bans_bonus (si écart) -> draft -> temps -> verification -> termine | litige | annule
    discord_j1: null,
    discord_j2: null,
    roles_tires: false, // true une fois j1/j2 définitifs pour la manche
    boss_precedent_id: null, // boss de la manche précédente, exclu du tirage
    box_j1: null,
    box_j2: null,
    pret_j1: false,
    pret_j2: false,
    points_j1: null,
    points_j2: null,
    bans_bonus_total: 0,
    bans_bonus_faits: 0,
    bans_bonus_joueur: null, // "j1" | "j2" | null si pas d'écart suffisant
    bans_bonus_choix: [], // ids en cours de sélection, pas encore confirmés
    equilibrage: "ancien", // méthode figée au calcul de l'équilibrage (cf. getModeEquilibrage)
    bans_joker_total: 0, // bans joker (compris dans bans_bonus_total), interdits à l'adversaire seulement
    bans_joker_choix: [], // jokers en cours de sélection, pas encore confirmés
    echange_joker: false, // BANS_PAR_JOKER bans échangés contre un joker (cf. echangerBansContreJoker)
    equilibrable: true, // équilibrage calculé : false si les box ne s'équilibrent pas (cf. calculerEquilibrageFixe)
    combinaisons_equilibrables: null, // phase non_equilibrable : [{ j1, j2 }] box qui s'équilibrent
    votes_equilibrage: { j1: null, j2: null }, // phase non_equilibrable : "revenir" | "annuler"
    boxes_permises: null, // choix des box après non_equilibrable : { j1: [box], j2: [box] }
    alerte_equilibrage_vue: false, // entraînement non équilibrable : alerte acceptée
    verticalite_j1: null, // équilibrage fixe : verticalité / horizontalité de la box de j1 (cf. verticalite)
    verticalite_j2: null,
    horizontalite_j1: null,
    horizontalite_j2: null,
    ecart_prevu: null, // équilibrage fixe : { avant, apres, cas, top, top_apres } écart d'équipe prévu et top 12 des box
    etape_bonus: null, // phase bans_bonus : "vertical" | "horizontal" (cf. acteurBansBonus)
    min_persos_equilibrage: null, // équilibrage fixe : persos min d'une box (limites du palier de la draft)
    horizontaux_j1: null, // "fixe_horizontal" : { id: valeur } persos horizontaux de la box de j1 (cf. valeursHorizontales)
    horizontaux_j2: null,
    seuil_horizontal: null, // "fixe_horizontal" : points d'écart par ban horizontal (figé au calcul)
    horizontal_calcule: false, // bans horizontaux calculés (après les bans verticaux, cf. calculerBansHorizontaux)
    somme_horizontale_j1: null, // sommes horizontales après les bans verticaux
    somme_horizontale_j2: null,
    bans_horizontaux_total: 0,
    bans_horizontaux_faits: 0,
    bans_horizontaux_joueur: null, // "j1" | "j2" | null : la plus petite somme horizontale
    bans_horizontaux_choix: [], // ids en cours de sélection, pas encore confirmés
    boss_id: null,
    pool_disponible: null, // liste d'ids (union), remplie une fois les 2 joueurs prêts
    pool_j1: null, // ids de la box choisie par j1 — restreint ses picks
    pool_j2: null, // ids de la box choisie par j2 — restreint ses picks
    elements_j1: null, // { traveler: ["pyro", ...] } : éléments du Voyageur dans la box de j1
    elements_j2: null,
    actions: [], // { joueur, type: "ban" | "pick", perso_id, bonus: bool, element? (pick Voyageur / Manekin) }
    sequence_index: 0,
    mode_theatre: "auto", // cf. MODES_THEATRE (choisi à la création de la room)
    theatre_j1: null, // palier de théâtre du compte de j1 (1..4, cf. theatreProfil)
    theatre_j2: null,
    theatre: null, // théâtre de la draft, fixé au tirage du boss
    sequence: null, // séquence de picks / bans de ce théâtre (cf. sequenceTheatre)
    chronometre: false, // draft classée : chronos (cf. _lib/chronos.js)
    fin_analyse: null, // fin du temps d'analyse (ms)
    fin_bans_bonus: null, // fin du temps des bans d'équilibrage (ms)
    chrono: null, // pendule de la draft : { j1, j2 (ms restants), tour_debut, epuise_j1, epuise_j2 }
    pause: null, // "Mon adversaire a crash" : { par, absent, debut }
    boss_impose: null, // room privée : boss choisi à la création (sinon au hasard)
    votes_boss: { j1: null, j2: null }, // phase "boss" : "confirmer" | "relancer" de chacun
    boss_valide: false, // boss confirmé en phase "boss" (gardé au tirage)
    relances_boss: 0, // nombre de boss relancés dans la manche
    premier: "aleatoire", // room privée : J1 = "createur" | "adversaire" | "aleatoire"
    createur: null, // room privée : discord_id du créateur (choix du J1)
    entrainement: null, // mode entraînement : { lanceur, aide, cote_moi, boxes: { moi, adverse }, boss_id, premier } (cf. api/rooms/index.js)
    id_match: null, // entraînement : id du match archivé (temps du lanceur ajouté ensuite)
    temps_j1: null, // { affiche: "mm:ss", secondes: number } une fois saisi
    temps_j2: null,
    temps_confirme_j1: false, // verification : j1 a confirmé les 2 temps
    temps_confirme_j2: false,
    litige_par: null, // "j1" | "j2" : qui a signalé le litige (phase litige)
    litige_commentaire: null, // raison du litige donnée par litige_par (500 caractères au plus)
    debut_temps: null, // début de la saisie des temps (ms) : anti-triche
    triche: null, // anti-triche : true si temps incohérents (détails dans l'archive, cf. _lib/archive.js)
    vainqueur: null, // "j1" | "j2" | "egalite" une fois les 2 temps confirmés
    resultat_trophees: null, // classé : { j1, j2, bonus } trophées gagnés / perdus (cf. _lib/trophees.js)
    koyns: null, // { discordId: { montant, raison } } Rikoyns gagnés en fin de match (cf. _lib/koyns.js)
    serie_classe: null, // classé : { j1, j2, terminee } victoires du jour de chacun contre l'autre (cf. _lib/serie_classe.js)
    rejouer_j1: false, // ready-check pour la revanche, même principe que pret_j1/pret_j2
    rejouer_j2: false
  };
}

// Personnages (catalogue complet, un Voyageur par élément) de la box
// choisie : Full Box = tout ce qui est possédé ; autre box = la sélection.
// niveau : 95 / 100 renseigné par le joueur (Voyageur : niveau du groupe).
function getPersonnagesBox(profilData, personnages, boxChoisie = "full") {
  const collection = migrerCollectionPersos(profilData?.characters) || { full: {}, selections: {} };
  return personnages
    .filter(p => {
      if ((collection.full?.[p.id] ?? -1) < 0) return false;
      if (boxChoisie === "full") return true;
      return !!collection.selections?.[boxChoisie]?.[p.id];
    })
    .map(p => ({ personnage: p, valeur: collection.full[p.id], niveau: collection.niveaux?.[p.groupe || p.id] ?? null }));
}

// Ids de la draft (Voyageur : "traveler") des persos d'une box (liste de
// getPersonnagesBox) : synergies présentes (cf. commun/synergies.js).
function idsDraftBox(liste) {
  return new Set(liste.map(({ personnage }) => personnage.groupe || personnage.id));
}

// ---- Points des personnages d'une box (PPC, bonus niveau 95 / 100 et
// théâtre compris, cf. pointsPersonnage ; malus de synergie compris, cf.
// pointsPersonnageBox) ----
// Groupe (Voyageur) : seul l'élément qui vaut le plus de points compte.
function calculerPointsBox(profilData, boxChoisie, personnages) {
  let total = 0;
  const meilleurParGroupe = {};

  const liste = getPersonnagesBox(profilData, personnages, boxChoisie);
  // Vitrines (modes en équipe, co-op : les alliés apportent les persos qui
  // manquent) : pas de malus de synergie (cf. malusSynergie).
  const presents = ["vitrine", "vitrine2"].includes(boxChoisie) ? null : idsDraftBox(liste);
  liste.forEach(({ personnage, valeur, niveau }) => {
    const points = pointsPersonnageBox(personnage, valeur, niveau, presents);
    if (personnage.groupe) {
      meilleurParGroupe[personnage.groupe] = Math.max(meilleurParGroupe[personnage.groupe] ?? 0, points);
    } else {
      total += points;
    }
  });

  return total + Object.values(meilleurParGroupe).reduce((somme, points) => somme + points, 0);
}

// ---- Valeur de chaque perso d'une box (verticalité de l'équilibrage
// "fixe_joker") : { id de la draft: points } ----
// Points du perso (Voyageur : son meilleur élément) ; avecSignature : plus
// sa meilleure copie d'arme signature présente dans la box.
function valeursBansBox(profilData, boxChoisie, personnages, armes, avecSignature = false) {
  const valeurs = {};
  const liste = getPersonnagesBox(profilData, personnages, boxChoisie);
  const presents = idsDraftBox(liste);
  liste.forEach(({ personnage, valeur, niveau }) => {
    const id = personnage.groupe || personnage.id;
    valeurs[id] = Math.max(valeurs[id] ?? 0, pointsPersonnageBox(personnage, valeur, niveau, presents));
  });
  if (avecSignature) {
    Object.keys(valeurs).forEach(id => { valeurs[id] += pointsSignatureBox(profilData, boxChoisie, armes, id); });
  }
  return valeurs;
}

// Arme signature d'un perso : image "<id du perso ou du groupe>_w.webp"
// (cf. getCleSignature, commun/cartes.js) ; meilleure copie de la box.
function pointsSignatureBox(profilData, boxChoisie, armes, persoId) {
  const arme = armes.find(a => typeof a.image === "string" && a.image.endsWith(`/${persoId}_w.webp`));
  if (!arme) return 0;
  const collection = profilData?.weapons || {};
  let meilleur = 0;
  Object.entries(collection.full || {}).forEach(([instance, valeur]) => {
    const raffinement = Number(valeur);
    if (instance.split("#")[0] !== arme.id || !Number.isInteger(raffinement) || raffinement < 0) return;
    if (boxChoisie !== "full" && !collection.selections?.[boxChoisie]?.[instance]) return;
    meilleur = Math.max(meilleur, Number(arme.PPW?.[raffinement] ?? 0));
  });
  return meilleur;
}

// ---- Points des armes d'une box (PPW du raffinement), copies comprises
// ("idArme#2"...) : même sélection que Mon compte et l'aperçu des box du
// match. Box personnalisée (entraînement) : armes cochées (cf. donneesBoxRole).
// Valeur alternative (arme.alternatif, % réglé sur la page admin, 100 par
// défaut) : chaque copie en double (toutes sauf la meilleure) et une arme
// signature dont le perso n'est pas dans la box (une seule fois si les 2),
// arrondi à l'entier. Même calcul côté client : pointsArmesBox
// (commun/cartes.js). ----
function calculerPointsArmesBox(profilData, boxChoisie, armes) {
  const collection = profilData?.weapons || {};
  const parId = new Map(armes.map(arme => [arme.id, arme]));
  const persos = new Set(getPersonnagesBox(profilData, getPersonnages(), boxChoisie)
    .map(({ personnage }) => personnage.groupe || personnage.id));
  // Une arme n'est une signature que si un perso du catalogue a sa clé.
  const clesCatalogue = new Set(getPersonnages().map(p => p.groupe || p.id));
  const copies = new Map();
  Object.entries(collection.full || {}).forEach(([instance, valeur]) => {
    const arme = parId.get(instance.split("#")[0]);
    const raffinement = Number(valeur);
    if (!arme || !Number.isInteger(raffinement) || raffinement < 0) return;
    if (boxChoisie !== "full" && !collection.selections?.[boxChoisie]?.[instance]) return;
    if (!copies.has(arme.id)) copies.set(arme.id, []);
    copies.get(arme.id).push(raffinement);
  });
  let total = 0;
  copies.forEach((raffinements, id) => {
    const arme = parId.get(id);
    const signature = typeof arme.image === "string" && arme.image.match(/([^/]+)_w\.webp$/)?.[1];
    raffinements.sort((a, b) => b - a).forEach((raffinement, index) => {
      const points = Number(arme.PPW?.[raffinement] ?? 0);
      const reduite = index > 0 || (clesCatalogue.has(signature) && !persos.has(signature));
      total += reduite ? Math.round(points * (arme.alternatif ?? 100) / 100) : points;
    });
  });
  return total;
}

// ---- Pool d'un joueur : les personnages de la box choisie pour le match,
// un seul Voyageur (id du groupe) quel que soit le nombre d'éléments ----
// Personnages (Voyageur compté une fois) qu'une box doit contenir pour
// être choisie en match (une box d'armes seules ne suffit pas).
const NB_PERSOS_MIN_BOX = 16;

function calculerPoolJoueur(profilData, personnages, boxChoisie = "full") {
  const ids = getPersonnagesBox(profilData, personnages, boxChoisie)
    .map(({ personnage }) => personnage.groupe || personnage.id);
  return Array.from(new Set(ids));
}

// Éléments de chaque groupe présents dans la box : { traveler: ["pyro", ...] }.
// Seuls ceux-là peuvent être choisis au pick.
function calculerElementsGroupes(profilData, personnages, boxChoisie = "full") {
  const elements = {};
  getPersonnagesBox(profilData, personnages, boxChoisie).forEach(({ personnage }) => {
    if (!personnage.groupe) return;
    (elements[personnage.groupe] ??= []).push(personnage.element);
  });
  return elements;
}

// ---- Pool de personnages draftables (union des 2 joueurs) ----
//
// Seuls les personnages possédés par AU MOINS un des 2 joueurs sont
// proposables au ban/pick. Le reste du catalogue n'a simplement pas
// d'intérêt en draft puisque personne ne peut le jouer. Les PICKS restent
// ensuite individuellement restreints à pool_j1 / pool_j2 (cf. handleAction) :
// on ne peut jouer que ce qu'on possède, même si l'adversaire l'a banni.
function calculerPoolDisponible(poolJ1, poolJ2) {
  return Array.from(new Set([...poolJ1, ...poolJ2]));
}

// ---- Prochaine action attendue ----
//
// Retourne { joueur, type, bonus } ou null si rien n'est attendu dans la
// phase actuelle (draft terminée, ou bans bonus épuisés en attente de
// passage à la phase suivante).
function getProchaineAction(draft) {
  if (draft.phase === "bans_bonus") {
    if (draft.etape_bonus === "horizontal") {
      return (draft.bans_horizontaux_faits || 0) < (draft.bans_horizontaux_total || 0)
        ? { joueur: draft.bans_horizontaux_joueur, type: "ban", bonus: true, horizontal: true }
        : null;
    }
    if (bansBonusDus(draft)) {
      return { joueur: draft.bans_bonus_joueur, type: "ban", bonus: true };
    }
    return null;
  }

  if (draft.phase === "draft") {
    const action = getSequence(draft)[draft.sequence_index];
    if (!action) return null;
    return { ...action, bonus: false };
  }

  return null;
}

// ---- Échange des rôles j1 <-> j2 ----
//
// Échange toutes les paires de champs *_j1 / *_j2 et tout ce qui désigne
// un rôle ("j1"/"j2"), pour que chaque donnée reste attachée au même
// joueur. Sert au tirage (si le hasard inverse les places provisoires) et
// à la revanche.
function echangerRoles(draft) {
  Object.keys(draft)
    .filter(cle => cle.endsWith("_j1"))
    .forEach(cleJ1 => {
      const cleJ2 = cleJ1.slice(0, -3) + "_j2";
      const tmp = draft[cleJ1];
      draft[cleJ1] = draft[cleJ2];
      draft[cleJ2] = tmp;
    });

  const inverser = role => (role === "j1" ? "j2" : role === "j2" ? "j1" : role);
  draft.bans_bonus_joueur = inverser(draft.bans_bonus_joueur);
  draft.bans_horizontaux_joueur = inverser(draft.bans_horizontaux_joueur);
  draft.vainqueur = inverser(draft.vainqueur);
  // Entraînement : la box du lanceur suit son rôle.
  if (draft.entrainement) draft.entrainement = { ...draft.entrainement, cote_moi: inverser(draft.entrainement.cote_moi) };
  draft.actions = (draft.actions || []).map(a => ({ ...a, joueur: inverser(a.joueur) }));
}

// ---- Tirage : rôles j1/j2 (1re manche seulement) puis boss ----
//
// Appelé après l'analyse (si aucun ban bonus n'est dû) ou une fois les
// bans bonus confirmés. En revanche, roles_tires est déjà vrai : seul le
// boss est tiré, différent de celui de la manche précédente.
function lancerTirage(draft, tirerBossAleatoire) {
  if (!draft.roles_tires) {
    // J1 choisi à la création : entraînement ("moi" = box du lanceur en J1,
    // "adverse") ou room privée ("createur", "adversaire") ; sinon au hasard.
    const premier = draft.entrainement?.premier;
    const createurEstJ1 = draft.discord_j1 === draft.createur;
    const echanger = premier === "moi" ? draft.entrainement.cote_moi !== "j1"
      : premier === "adverse" ? draft.entrainement.cote_moi === "j1"
        : draft.premier === "createur" && draft.createur ? !createurEstJ1
          : draft.premier === "adversaire" && draft.createur ? createurEstJ1
            : Math.random() < 0.5;
    if (echanger) echangerRoles(draft);
    draft.roles_tires = true;
  }

  // Boss choisi à la création (entraînement, room privée) ou confirmé en
  // phase "boss", sinon au hasard.
  draft.boss_id = draft.entrainement?.boss_id || draft.boss_impose ||
    (draft.boss_valide && draft.boss_id) || tirerBossAleatoire(draft.boss_precedent_id || null).id;
  draft.phase = "draft";
  draft.sequence_index = 0;
  // Mode de théâtre : nombre de bans de la draft (après le boss seulement).
  draft.theatre = resoudreTheatre(draft.mode_theatre, draft.theatre_j1, draft.theatre_j2);
  draft.sequence = sequenceTheatre(draft.theatre);
}

// ---- Boss proposé (matchmaking non classé, room privée sans boss imposé) ----
//
// Phase "boss" avant le tirage J1/J2 : le boss tiré est montré aux 2
// joueurs, qui votent "confirmer" ou "relancer" ; relancé seulement si les
// 2 veulent relancer (cf. handleBossVote).
function proposerBoss(draft, tirerBossAleatoire) {
  // Différent du boss proposé juste avant (relance) ou de la manche
  // précédente (revanche).
  draft.boss_id = tirerBossAleatoire(draft.boss_id || draft.boss_precedent_id || null).id;
  draft.phase = "boss";
  draft.votes_boss = { j1: null, j2: null };
  draft.boss_valide = false;
}

// ---- Revanche ----
//
// Mêmes box, points, pools et bans d'équilibrage (déjà confirmés) que la
// manche terminée ; rôles inversés ; retour direct en phase "analyse".
function etatRevanche(precedent) {
  const bansBonus = (precedent.actions || []).filter(a => a.bonus);
  // Jokers : déjà retirés de la box adverse (pool_jX), pas du pool commun.
  const bannis = new Set(bansBonus.filter(a => !a.joker).map(a => a.perso_id));

  const suivant = {
    ...etatInitialDraft(),
    phase: "analyse",
    discord_j1: precedent.discord_j1,
    discord_j2: precedent.discord_j2,
    roles_tires: true,
    boss_precedent_id: precedent.boss_id,
    mode_theatre: precedent.mode_theatre || "auto",
    chronometre: !!precedent.chronometre,
    // Chronos personnalisés (tournois) et match de tournoi gardés.
    chronos_config: precedent.chronos_config || null,
    tournoi: precedent.tournoi || null,
    entrainement: precedent.entrainement || null,
    boss_impose: precedent.boss_impose || null,
    premier: precedent.premier || "aleatoire",
    createur: precedent.createur || null,
    theatre_j1: precedent.theatre_j1 ?? null,
    theatre_j2: precedent.theatre_j2 ?? null,
    box_j1: precedent.box_j1,
    box_j2: precedent.box_j2,
    points_j1: precedent.points_j1,
    points_j2: precedent.points_j2,
    pool_j1: precedent.pool_j1,
    pool_j2: precedent.pool_j2,
    elements_j1: precedent.elements_j1,
    elements_j2: precedent.elements_j2,
    pool_disponible: calculerPoolDisponible(precedent.pool_j1 || [], precedent.pool_j2 || [])
      .filter(id => !bannis.has(id)),
    bans_bonus_total: precedent.bans_bonus_total,
    bans_bonus_faits: precedent.bans_bonus_faits,
    // Mode spécial de l'entraînement (bans calculés avec jokers illimités).
    mode_special: !!precedent.mode_special,
    joueur_faible: precedent.joueur_faible || null,
    bans_bonus_joueur: precedent.bans_bonus_joueur,
    // Méthode d'équilibrage de la 1re manche, bans déjà confirmés.
    equilibrage: precedent.equilibrage || "ancien",
    bans_joker_total: precedent.bans_joker_total || 0,
    echange_joker: !!precedent.echange_joker,
    verticalite_j1: precedent.verticalite_j1 ?? null,
    verticalite_j2: precedent.verticalite_j2 ?? null,
    horizontalite_j1: precedent.horizontalite_j1 ?? null,
    horizontalite_j2: precedent.horizontalite_j2 ?? null,
    ecart_prevu: precedent.ecart_prevu || null,
    min_persos_equilibrage: precedent.min_persos_equilibrage ?? null,
    horizontaux_j1: precedent.horizontaux_j1 || null,
    horizontaux_j2: precedent.horizontaux_j2 || null,
    seuil_horizontal: precedent.seuil_horizontal ?? null,
    horizontal_calcule: !!precedent.horizontal_calcule,
    somme_horizontale_j1: precedent.somme_horizontale_j1 ?? null,
    somme_horizontale_j2: precedent.somme_horizontale_j2 ?? null,
    bans_horizontaux_total: precedent.bans_horizontaux_total || 0,
    bans_horizontaux_faits: precedent.bans_horizontaux_faits || 0,
    bans_horizontaux_joueur: precedent.bans_horizontaux_joueur || null,
    actions: bansBonus,
    // Même room : la version continue (écriture conditionnelle, cf.
    // ecrireDraft dans _lib/room.js).
    version: precedent.version ?? null
  };

  echangerRoles(suivant);
  return suivant;
}

// ---- Vue d'un joueur ----
//
// Pendant le choix des box, la box de l'adversaire n'est pas envoyée
// (seul son statut "prêt" l'est) : elle ne se découvre qu'en analyse.
// Spectateur (joueur = null) : aucune des 2 box.
// Pendant la saisie, le temps de l'adversaire (et les 2 pour un spectateur)
// est masqué : on sait seulement qu'il est saisi.
const TEMPS_MASQUE = { affiche: null, secondes: null, masque: true };

function vuePourJoueur(draft, joueur) {
  // Entraînement seul : il tient les 2 rôles, rien à lui cacher.
  if (estEntrainementSolo(draft)) return draft;
  const autre = joueur === "j1" ? "j2" : "j1";
  if (draft.phase === "temps") {
    const vue = { ...draft };
    ["j1", "j2"].forEach(role => {
      if (role !== joueur && vue[`temps_${role}`]) vue[`temps_${role}`] = TEMPS_MASQUE;
    });
    return vue;
  }
  if (draft.phase !== "choix_box") return draft;
  if (!joueur) return { ...draft, box_j1: null, box_j2: null };
  return { ...draft, [`box_${autre}`]: null };
}

// ---- Équipe (picks) d'un joueur, reconstruite depuis l'historique ----
function getEquipeJoueur(draft, joueur) {
  return draft.actions
    .filter(a => a.type === "pick" && a.joueur === joueur)
    .map(a => a.perso_id);
}

// ---- Bans d'un joueur (bans de draft et d'équilibrage), reconstruits
// depuis l'historique : colonnes bans_j1 / bans_j2 de match_history ----
function getBansJoueur(actions, joueur) {
  return actions
    .filter(a => a.type === "ban" && a.joueur === joueur)
    .map(a => ({
      perso_id: a.perso_id,
      bonus: !!a.bonus,
      ...(a.joker ? { joker: true } : {}),
      ...(a.horizontal ? { horizontal: true } : {}),
      ...(a.aleatoire ? { aleatoire: true } : {}),
      ...(a.infos ? { infos: a.infos } : {})
    }));
}

module.exports = {
  SEUIL_EQUILIBRAGE,
  NB_PERSOS_MIN_BOX,
  SEQUENCE_FIXE,
  MODES_THEATRE,
  MODE_MELEE,
  THEATRE_CARPE,
  sequenceTheatre,
  theatreProfil,
  resoudreTheatre,
  estEntrainementSolo,
  getSequence,
  calculerBansBonus,
  bansBonusDus,
  BANS_PAR_JOKER,
  bansNormaux,
  echangeJokerPossible,
  echangerBansContreJoker,
  valeursBansBox,
  estEquilibrageFixe,
  estEquilibrageHorizontal,
  valeursHorizontales,
  SEUIL_HORIZONTAL,
  ciblesHorizontales,
  preparerBansHorizontaux,
  appliquerBansHorizontaux,
  acteurBansBonus,
  verticalite,
  horizontalite,
  calculerEquilibrageFixe,
  modeleEquilibrage,
  mesurerVerticalite,
  SEUIL_ARMES_BANNIES,
  TOLERANCE_FIXE,
  appliquerBansBonus,
  MARGE_FIXE,
  etatInitialDraft,
  calculerPointsBox,
  calculerPointsArmesBox,
  calculerPoolJoueur,
  calculerElementsGroupes,
  calculerPoolDisponible,
  getProchaineAction,
  echangerRoles,
  lancerTirage,
  proposerBoss,
  etatRevanche,
  vuePourJoueur,
  getEquipeJoueur,
  getBansJoueur
};