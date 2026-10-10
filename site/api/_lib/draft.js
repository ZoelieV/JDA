const { migrerCollectionPersos, pointsPersonnage, palierTheatre } = require("./personnages");

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

// Méthodes libres (draft.equilibrage, cf. getModeEquilibrage dans
// _lib/personnages.js) : celui qui a la box la plus faible bannit autant de
// persos qu'il veut, sans faire passer la box adverse sous la sienne ;
// objectif : box adverse entre +0 et +MARGE_EQUILIBRAGE points. Pas de bans
// si l'écart est déjà dans la marge. Temps des bans en classé : celui de
// l'ancienne méthode (calculerBansBonus, cf. dureeBansBonus).
const MARGE_EQUILIBRAGE = 100;

function equilibrageLibre(draft) {
  return !!draft.equilibrage && draft.equilibrage !== "ancien";
}

// Bans d'équilibrage encore à faire (ancienne méthode : nombre imposé ;
// libre : pas encore confirmés).
function bansBonusDus(draft) {
  if (equilibrageLibre(draft)) return !!draft.bans_bonus_joueur && !draft.bans_bonus_confirmes;
  return (draft.bans_bonus_faits || 0) < (draft.bans_bonus_total || 0);
}

// Méthodes libres : points des 2 box si ces persos sont bannis ->
// { banneur, adverse }. valeurs_bans_jX : points que perd la box de jX par
// perso banni (cf. valeursBansBox) ; "deux_box" : celle de celui qui
// bannit aussi.
function pointsApresBansBonus(draft, choix = draft.bans_bonus_choix || []) {
  const banneur = draft.bans_bonus_joueur;
  const adverse = banneur === "j1" ? "j2" : "j1";
  const retire = role => choix.reduce((somme, id) => somme + (Number(draft[`valeurs_bans_${role}`]?.[id]) || 0), 0);
  return {
    banneur: (draft[`points_${banneur}`] || 0) - (draft.equilibrage === "deux_box" ? retire(banneur) : 0),
    adverse: (draft[`points_${adverse}`] || 0) - retire(adverse)
  };
}

function bansBonusPermis(draft, choix) {
  const points = pointsApresBansBonus(draft, choix);
  return points.adverse >= points.banneur;
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
    return Array.from({ length: nombre * 2 }, (_, i) => ({ joueur: i % 2 === 0 ? premier : second, type: "ban" }));
  };
  const picks = ordre => ordre.map(joueur => ({ joueur, type: "pick" }));
  return [
    ...bans(bans1, "j1"),
    ...picks(["j1", "j2", "j2", "j1"]),
    ...bans(bans2, "j2"),
    ...picks(["j2", "j1", "j1", "j2"])
  ];
}

// Palier de théâtre du compte, calculé sur les 5★ limités de sa full box
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
    phase: "choix_box", // choix_box -> analyse -> bans_bonus (si écart) -> draft -> temps -> verification -> termine | litige
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
    bans_bonus_confirmes: false, // méthodes libres : bans confirmés (nombre libre)
    valeurs_bans_j1: null, // méthodes libres : { perso: points perdus par la box de j1 s'il est banni }
    valeurs_bans_j2: null,
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

// ---- Points des personnages d'une box (PPC, bonus niveau 95 / 100 et
// théâtre compris, cf. pointsPersonnage) ----
// Groupe (Voyageur) : seul l'élément qui vaut le plus de points compte.
function calculerPointsBox(profilData, boxChoisie, personnages) {
  let total = 0;
  const meilleurParGroupe = {};

  getPersonnagesBox(profilData, personnages, boxChoisie).forEach(({ personnage, valeur, niveau }) => {
    const points = pointsPersonnage(personnage, valeur, niveau);
    if (personnage.groupe) {
      meilleurParGroupe[personnage.groupe] = Math.max(meilleurParGroupe[personnage.groupe] ?? 0, points);
    } else {
      total += points;
    }
  });

  return total + Object.values(meilleurParGroupe).reduce((somme, points) => somme + points, 0);
}

// ---- Points perdus par une box si un perso est banni (méthodes
// d'équilibrage libres) : { id de la draft: points } ----
// Points du perso (Voyageur : son meilleur élément) ; avecSignature : plus
// sa meilleure copie d'arme signature présente dans la box.
function valeursBansBox(profilData, boxChoisie, personnages, armes, avecSignature = false) {
  const valeurs = {};
  getPersonnagesBox(profilData, personnages, boxChoisie).forEach(({ personnage, valeur, niveau }) => {
    const id = personnage.groupe || personnage.id;
    valeurs[id] = Math.max(valeurs[id] ?? 0, pointsPersonnage(personnage, valeur, niveau));
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
// match. Box personnalisée (entraînement, persos seulement) : aucune arme. ----
function calculerPointsArmesBox(profilData, boxChoisie, armes) {
  const collection = profilData?.weapons || {};
  const parId = new Map(armes.map(arme => [arme.id, arme]));
  return Object.entries(collection.full || {}).reduce((total, [instance, valeur]) => {
    const arme = parId.get(instance.split("#")[0]);
    const raffinement = Number(valeur);
    if (!arme || !Number.isInteger(raffinement) || raffinement < 0) return total;
    if (boxChoisie !== "full" && !collection.selections?.[boxChoisie]?.[instance]) return total;
    return total + Number(arme.PPW?.[raffinement] ?? 0);
  }, 0);
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
  const bannis = new Set(bansBonus.map(a => a.perso_id));

  const suivant = {
    ...etatInitialDraft(),
    phase: "analyse",
    discord_j1: precedent.discord_j1,
    discord_j2: precedent.discord_j2,
    roles_tires: true,
    boss_precedent_id: precedent.boss_id,
    mode_theatre: precedent.mode_theatre || "auto",
    chronometre: !!precedent.chronometre,
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
    bans_bonus_joueur: precedent.bans_bonus_joueur,
    // Méthode d'équilibrage de la 1re manche, bans déjà confirmés.
    equilibrage: precedent.equilibrage || "ancien",
    bans_bonus_confirmes: !!precedent.bans_bonus_confirmes,
    valeurs_bans_j1: precedent.valeurs_bans_j1 || null,
    valeurs_bans_j2: precedent.valeurs_bans_j2 || null,
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
  MARGE_EQUILIBRAGE,
  equilibrageLibre,
  bansBonusDus,
  bansBonusPermis,
  pointsApresBansBonus,
  valeursBansBox,
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