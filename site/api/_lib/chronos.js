// Chronos de la draft classée (draft.chronometre, rooms de type "classe") :
//   - analyse des box : ANALYSE_MS, écourtée si les 2 joueurs sont prêts ;
//   - bans d'équilibrage : BANS_BONUS_MS pour le joueur qui les choisit ;
//   - picks / bans : DRAFT_JOUEUR_MS au total par joueur, en pendule
//     d'échecs (son chrono tourne pendant ses tours, s'arrête pendant ceux
//     de l'adversaire).
// Temps écoulé : choix aléatoires (cf. handleExpirer). Chrono de draft à 0 :
// toutes les actions restantes de ce joueur sont aléatoires
// (draft.chrono.epuise_j1 / _j2).
//
// Équité : c'est la page du joueur dont c'est le tour qui décide qu'il est
// trop tard (à 0 sur SON chrono). Une action qui arrive juste après 0 côté
// serveur (latence) est acceptée pendant GRACE_ACTION_MS ; la page de
// l'adversaire ne peut déclencher le choix aléatoire qu'après
// DELAI_ADVERSAIRE_MS de plus (joueur parti ou planté), pour ne jamais
// passer avant lui.
//
// Pause "Mon adversaire a crash" (draft.pause) : chronos figés jusqu'au
// retour du joueur absent (sa page relit la draft) ; draft annulée après
// PAUSE_MAX_MS sans retour.
const ANALYSE_MS = 2 * 60 * 1000;
const BANS_BONUS_MS = 90 * 1000;
const DRAFT_JOUEUR_MS = 5 * 60 * 1000;
const GRACE_ACTION_MS = 2000;
const TOLERANCE_ACTEUR_MS = 1500;
const DELAI_ADVERSAIRE_MS = 5000;
const PAUSE_MAX_MS = 10 * 60 * 1000;

// Phases où la draft classée peut être mise en pause (avant la partie : les
// joueurs quittent ensuite le site pour jouer).
const PHASES_PAUSABLES = ["choix_box", "analyse", "bans_bonus", "draft"];

function estChronometre(draft) {
  return !!draft?.chronometre;
}

function demarrerAnalyse(draft, maintenant = Date.now()) {
  if (estChronometre(draft)) draft.fin_analyse = maintenant + ANALYSE_MS;
}

function demarrerBansBonus(draft, maintenant = Date.now()) {
  if (estChronometre(draft)) draft.fin_bans_bonus = maintenant + BANS_BONUS_MS;
}

function demarrerChronoDraft(draft, maintenant = Date.now()) {
  if (!estChronometre(draft)) return;
  draft.chrono = {
    j1: DRAFT_JOUEUR_MS,
    j2: DRAFT_JOUEUR_MS,
    tour_debut: maintenant,
    epuise_j1: false,
    epuise_j2: false
  };
}

// Temps écoulé depuis le début du tour en cours (ms).
function tempsDuTour(draft, maintenant = Date.now()) {
  return draft.chrono ? maintenant - draft.chrono.tour_debut : 0;
}

// Action du joueur à son tour : temps décompté de son chrono, tour suivant
// démarré. -> true si l'action arrive trop tard (au-delà de la grâce).
function consommerTemps(draft, joueur, maintenant = Date.now()) {
  if (!draft.chrono) return false;
  const ecoule = tempsDuTour(draft, maintenant);
  const restant = draft.chrono[joueur];
  const enRetard = ecoule > restant + GRACE_ACTION_MS;
  draft.chrono[joueur] = Math.max(0, restant - ecoule);
  if (draft.chrono[joueur] === 0) draft.chrono[`epuise_${joueur}`] = true;
  draft.chrono.tour_debut = maintenant;
  return enRetard;
}

// Le demandeur peut-il déclarer le temps écoulé ? Le joueur concerné dès
// la fin de son temps (à la tolérance d'horloge près) ; l'adversaire
// seulement DELAI_ADVERSAIRE_MS plus tard.
function peutExpirer(finMs, estActeur, maintenant = Date.now()) {
  return estActeur
    ? maintenant >= finMs - TOLERANCE_ACTEUR_MS
    : maintenant >= finMs + DELAI_ADVERSAIRE_MS;
}

function estEnPause(draft) {
  return !!draft?.pause;
}

function mettreEnPause(draft, par, maintenant = Date.now()) {
  draft.pause = { par, absent: par === "j1" ? "j2" : "j1", debut: maintenant };
}

// Retour du joueur absent : chronos décalés de la durée de la pause.
function reprendre(draft, maintenant = Date.now()) {
  if (!draft.pause) return;
  const duree = maintenant - draft.pause.debut;
  if (draft.fin_analyse) draft.fin_analyse += duree;
  if (draft.fin_bans_bonus) draft.fin_bans_bonus += duree;
  if (draft.chrono) draft.chrono.tour_debut += duree;
  draft.pause = null;
}

function pauseExpiree(draft, maintenant = Date.now()) {
  return !!draft.pause && maintenant - draft.pause.debut >= PAUSE_MAX_MS;
}

module.exports = {
  ANALYSE_MS,
  BANS_BONUS_MS,
  DRAFT_JOUEUR_MS,
  PAUSE_MAX_MS,
  PHASES_PAUSABLES,
  estChronometre,
  demarrerAnalyse,
  demarrerBansBonus,
  demarrerChronoDraft,
  tempsDuTour,
  consommerTemps,
  peutExpirer,
  estEnPause,
  mettreEnPause,
  reprendre,
  pauseExpiree
};
