const { migrerCollectionPersos, pointsPersonnage } = require("./personnages");

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

// ---- Modes de théâtre : nombre de bans de la draft ----
//
// Même squelette que la draft classique (théâtre 12) : bans du 1er tour
// (j1, j2, j1...), picks j1, j2, j2, j1, bans du 2e tour (j2, j1...),
// picks j2, j1, j1, j2. Seul le nombre de bans par joueur change :
//   théâtre 6  : 0 + 1 (le ban arrive après les 2 premiers picks)
//   théâtre 8  : 1 + 1
//   théâtre 10 : 2 + 1
//   théâtre 12 : 2 + 2 (draft classique, = SEQUENCE_FIXE)
// Ne s'applique qu'après le tirage du boss : les bans d'équilibrage ne
// changent pas.
const BANS_PAR_THEATRE = { 6: [0, 1], 8: [1, 1], 10: [2, 1], 12: [2, 2] };
const THEATRES = [6, 8, 10, 12];
// Mode d'une room : "auto" (théâtre du joueur au plus petit clear), un
// théâtre imposé ("12" = mêlée générale) ou "carnage" (théâtre 12 sans bans
// d'équilibrage, hors classé).
const MODES_THEATRE = ["auto", "6", "8", "10", "12", "carnage"];
// Théâtre clear du profil : valeur stockée ("1".."4") -> palier.
const PALIERS_THEATRE = { 1: 6, 2: 8, 3: 10, 4: 12 };
// Théâtre non renseigné dans le profil : considéré comme le plus petit.
const THEATRE_PAR_DEFAUT = 6;

function sequenceTheatre(theatre) {
  const [bans1, bans2] = BANS_PAR_THEATRE[theatre] || BANS_PAR_THEATRE[12];
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

function theatreProfil(profilData) {
  return PALIERS_THEATRE[profilData?.theatre] ?? null;
}

// Théâtre de la draft : imposé par le mode, sinon ("auto") celui du joueur
// au plus petit clear.
function resoudreTheatre(mode, theatreJ1, theatreJ2) {
  if (mode === "carnage") return 12;
  if (THEATRES.includes(Number(mode))) return Number(mode);
  return Math.min(theatreJ1 ?? THEATRE_PAR_DEFAUT, theatreJ2 ?? THEATRE_PAR_DEFAUT);
}

// Mode "auto" (classique) : interdit sans théâtre clear renseigné dans le
// profil (sinon un gros compte pourrait ne rien renseigner pour imposer
// moins de bans). Message d'erreur, ou null si le joueur peut jouer.
function erreurModeAuto(mode, profilData) {
  if (mode !== "auto" || theatreProfil(profilData) !== null) return null;
  return "Renseigne ton théâtre clear (menu du compte ou Mon compte) pour jouer en mode classique / auto.";
}

// Entraînement joué seul : le lanceur tient les 2 rôles (mêmes comptes en
// j1 et j2), chacun à son tour (cf. agirEn dans _lib/room.js).
function estEntrainementSolo(draft) {
  return !!draft?.entrainement && draft.discord_j1 === draft.discord_j2;
}

// Séquence de la manche (fixée au tirage du boss) ; draft classique avant
// le tirage ou pour une ancienne manche.
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
    boss_id: null,
    pool_disponible: null, // liste d'ids (union), remplie une fois les 2 joueurs prêts
    pool_j1: null, // ids de la box choisie par j1 — restreint ses picks
    pool_j2: null, // ids de la box choisie par j2 — restreint ses picks
    elements_j1: null, // { traveler: ["pyro", ...] } : éléments du Voyageur dans la box de j1
    elements_j2: null,
    actions: [], // { joueur, type: "ban" | "pick", perso_id, bonus: bool, element? (pick Voyageur / Manekin) }
    sequence_index: 0,
    mode_theatre: "auto", // "auto" | "6" | "8" | "10" | "12" (choisi à la création de la room)
    theatre_j1: null, // théâtre clear du profil de j1 (6..12, null si non renseigné)
    theatre_j2: null,
    theatre: null, // théâtre de la draft, fixé au tirage du boss
    sequence: null, // séquence de picks / bans de ce théâtre (cf. sequenceTheatre)
    chronometre: false, // draft classée : chronos (cf. _lib/chronos.js)
    fin_analyse: null, // fin du temps d'analyse (ms)
    fin_bans_bonus: null, // fin du temps des bans d'équilibrage (ms)
    chrono: null, // pendule de la draft : { j1, j2 (ms restants), tour_debut, epuise_j1, epuise_j2 }
    pause: null, // "Mon adversaire a crash" : { par, absent, debut }
    boss_impose: null, // room privée : boss choisi à la création (sinon au hasard)
    premier: "aleatoire", // room privée : J1 = "createur" | "adversaire" | "aleatoire"
    createur: null, // room privée : discord_id du créateur (choix du J1)
    entrainement: null, // mode entraînement : { lanceur, aide, cote_moi, boxes: { moi, adverse }, boss_id, premier } (cf. api/rooms/index.js)
    temps_j1: null, // { affiche: "mm:ss", secondes: number } une fois saisi
    temps_j2: null,
    temps_confirme_j1: false, // verification : j1 a confirmé les 2 temps
    temps_confirme_j2: false,
    litige_par: null, // "j1" | "j2" : qui a signalé le litige (phase litige)
    debut_temps: null, // début de la saisie des temps (ms) : anti-triche
    triche: null, // anti-triche : { duree_saisie, somme_temps } si temps incohérents
    vainqueur: null, // "j1" | "j2" | "egalite" une fois les 2 temps confirmés
    resultat_trophees: null, // classé : { j1, j2, bonus } trophées gagnés / perdus (cf. _lib/trophees.js)
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

// ---- Points d'une box (uniquement personnages / PPC, bonus niveau 95 /
// 100 et théâtre compris, cf. pointsPersonnage) ----
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
    if (draft.bans_bonus_faits < draft.bans_bonus_total) {
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

  // Boss choisi à la création (entraînement, room privée), sinon au hasard.
  draft.boss_id = draft.entrainement?.boss_id || draft.boss_impose || tirerBossAleatoire(draft.boss_precedent_id || null).id;
  draft.phase = "draft";
  draft.sequence_index = 0;
  // Mode de théâtre : nombre de bans de la draft (après le boss seulement).
  draft.theatre = resoudreTheatre(draft.mode_theatre, draft.theatre_j1, draft.theatre_j2);
  draft.sequence = sequenceTheatre(draft.theatre);
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
    actions: bansBonus
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
  sequenceTheatre,
  theatreProfil,
  resoudreTheatre,
  erreurModeAuto,
  estEntrainementSolo,
  getSequence,
  calculerBansBonus,
  etatInitialDraft,
  calculerPointsBox,
  calculerPoolJoueur,
  calculerElementsGroupes,
  calculerPoolDisponible,
  getProchaineAction,
  echangerRoles,
  lancerTirage,
  etatRevanche,
  vuePourJoueur,
  getEquipeJoueur,
  getBansJoueur
};