// Tournois (pages /tournois et /tournoi?id=, cf. tournois/) : créés par les
// administrateurs, les mini admins et les tournoitateurs (liste désignée par
// les administrateurs et mini admins depuis la page Administration).
//
// Stockage, sans table à créer : table points, une ligne par tournoi
// ("tournoi:<id>", data = le tournoi) et la ligne "tournoitateurs"
// ({ ids: { <discord id>: { nom, ajoute_par, ajoute_le } } }). Écritures
// conditionnées à updated_at (deux inscriptions au même moment ne s'écrasent
// pas, cf. modifierTournoi).
//
// Déroulé (tournoi.statut) :
//   inscriptions : 1v1 : inscription des joueurs ; en équipe : chaque joueur
//                  crée une équipe (il en est le capitaine) ou demande à en
//                  rejoindre une (une seule demande à la fois, acceptée par
//                  le capitaine) ; jusqu'à la date de verrouillage.
//   verrouille   : plus d'inscription (date de verrouillage passée ou
//                  verrouillé à la main) ; le gestionnaire génère la suite.
//   qualifs      : plus de participants que l'arbre n'a de places
//                  (arbre_max) : qualif_matchs matchs chacun, en parallèle,
//                  lancés par les joueurs, temps saisis par un arbitre ;
//                  trophées comme en classé (cf. calculerTrophees) ; les
//                  arbre_max meilleurs vont dans l'arbre.
//   arbre        : élimination directe, 1 match à la fois, lancé par le
//                  gestionnaire (« Prochain match »), ou en parallèle si
//                  arbre_parallele (lancés par les joueurs du match ou un
//                  arbitre, comme les qualifs), bo1 ou bo3 ; premier
//                  tour tiré au hasard, chaque paire équilibrable en full
//                  box (1v1) ; le gestionnaire peut échanger des places
//                  avant le premier match.
//   termine      : vainqueur connu. annule : annulé par le gestionnaire.
//
// Gestionnaire : créateur du tournoi (ou administrateur). Arbitres :
// gestionnaire et joueurs désignés par lui ; ils saisissent les temps des
// matchs (les joueurs ne les saisissent pas), cf. tempsArbitre.
// Matchs : rooms de type "tournoi" (1v1, page match.html) ou "equipe"
// (page equipe.html), draft.tournoi = { id, phase, match, arbitres, ... } ;
// archivés comme un match normal (historique, Rikoyns), sans trophées du
// classé.
const crypto = require("crypto");
const { supabase } = require("./supabase");
const { estAdmin, estModerateur } = require("./admin");
const { MODES_THEATRE } = require("./draft");
const { estEquilibrableFullBox } = require("./boxes");
const { calculerTrophees } = require("./trophees");
const { actualiserPoints } = require("./personnages");
const { lireDonneesProprietaire } = require("./boxes_fictives");
const { verifierFrequenceCompte } = require("./limites");

const PREFIXE = "tournoi:";
const LIGNE_TOURNOITATEURS = "tournoitateurs";
const FORMATS = ["1v1", "equipe"];
const TAILLES_EQUIPE = [2, 3, 4];
const BOX_TOURNOI = ["full", "libre"];
const AFFRONTEMENTS = ["bo1", "bo3"];
// La finale (dernier match) : au choix, bo1, bo3 ou bo5.
const AFFRONTEMENTS_FINALE = ["bo1", "bo3", "bo5"];
const MANCHES_A_GAGNER = { bo1: 1, bo3: 2, bo5: 3 };
const RECOMPENSES = ["cosmetiques", "battle_pass", "faveur", "pack", "rien"];
// Places de l'arbre : finale (2) à 64e de finale (128).
const TAILLES_ARBRE = [2, 4, 8, 16, 32, 64, 128];
const MAX_PARTICIPANTS = 256;
const LONGUEUR_NOM = 60;
const LONGUEUR_DESCRIPTION = 1000;
const LONGUEUR_RECOMPENSE = 300;
const LONGUEUR_NOM_EQUIPE = 30;
const MAX_ARBITRES = 20;
// Tournois pas terminés (ni annulés) par créateur, administrateurs à part.
const MAX_TOURNOIS_EN_COURS = 10;
// Actions des joueurs et du gestionnaire (écritures) : une par seconde au
// plus par compte (quota Supabase protégé d'un envoi en boucle).
const DELAI_ACTION_MS = 1000;
const MAX_QUALIF_MATCHS = 10;
// Qualifications : rondes (adversaires au hasard, qualif_matchs chacun) ou
// poules (tous contre tous dans chaque poule, les meilleurs de chaque poule
// qualifiés).
const FORMATS_QUALIFS = ["rondes", "poules"];
const BORNES_POULES = { nombre: [2, 64], taille: [3, 16] };
// Chronos personnalisables (secondes) : analyse des box, par pick / ban,
// par ban d'équilibrage.
const BORNES_CHRONOS = { analyse_s: [30, 600], action_s: [10, 120], ban_s: [5, 60] };

function erreur(status, message) {
  return { status, message };
}

// ---- Rôles ----

async function lireTournoitateurs() {
  const { data, error } = await supabase.from("points").select("data").eq("id", LIGNE_TOURNOITATEURS).maybeSingle();
  if (error) throw error;
  return data?.data?.ids || {};
}

async function ecrireTournoitateurs(ids) {
  const { error } = await supabase.from("points").upsert({ id: LIGNE_TOURNOITATEURS, data: { ids }, updated_at: new Date().toISOString() });
  if (error) throw error;
}

async function estTournoitateur(discordId) {
  if (!discordId) return false;
  return !!(await lireTournoitateurs())[discordId];
}

async function peutCreerTournoi(discordId) {
  return await estModerateur(discordId) || await estTournoitateur(discordId);
}

function estGestionnaire(tournoi, discordId) {
  return !!discordId && (tournoi.createur === discordId || estAdmin(discordId));
}

function estArbitre(tournoi, discordId) {
  return estGestionnaire(tournoi, discordId) || (tournoi.arbitres || []).includes(discordId);
}

// ---- Lecture / écriture ----

async function lireTournoi(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}$/.test(id)) return null;
  const { data, error } = await supabase.from("points").select("data, updated_at").eq("id", PREFIXE + id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { tournoi: data.data, lu: data.updated_at };
}

async function listerTournois() {
  const { data, error } = await supabase.from("points").select("data").like("id", `${PREFIXE}%`);
  if (error) throw error;
  return (data || []).map(ligne => ligne.data).filter(Boolean);
}

// Modification d'un tournoi : relu, modifié par changer(tournoi) (qui lève
// une erreur { status, message } pour refuser), écrit seulement s'il n'a
// pas changé entre-temps (sinon rejoué, 3 essais). -> tournoi écrit.
async function modifierTournoi(id, changer) {
  for (let essai = 0; essai < 3; essai++) {
    const lecture = await lireTournoi(id);
    if (!lecture) throw erreur(404, "Tournoi introuvable");
    const { tournoi, lu } = lecture;
    avancerSelonDates(tournoi);
    const resultat = await changer(tournoi);
    tournoi.maj_le = new Date().toISOString();
    const { data, error } = await supabase.from("points")
      .update({ data: tournoi, updated_at: tournoi.maj_le })
      .eq("id", PREFIXE + id).eq("updated_at", lu).select("id");
    if (error) throw error;
    if (data?.length) return resultat ?? tournoi;
  }
  throw erreur(409, "Le tournoi a été modifié en même temps : réessaie.");
}

// Verrouillage automatique à sa date.
function avancerSelonDates(tournoi) {
  if (tournoi.statut === "inscriptions" && tournoi.verrouillage && Date.now() >= Date.parse(tournoi.verrouillage)) {
    tournoi.statut = "verrouille";
  }
}

// ---- Configuration (création, modification) ----

const texte = (valeur, max) => (typeof valeur === "string" ? valeur.trim().slice(0, max) : "");
const entier = (valeur, min, max, defaut) => {
  const n = Number(valeur);
  return Number.isInteger(n) && n >= min && n <= max ? n : defaut;
};
const date = valeur => {
  const ms = Date.parse(valeur);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// Configuration envoyée par la page -> { config } ou { erreur }.
function lireConfig(brut) {
  const nom = texte(brut?.nom, LONGUEUR_NOM);
  if (!nom) return { erreur: "Donne un nom au tournoi." };
  const format = FORMATS.includes(brut?.format) ? brut.format : "1v1";
  const debut = date(brut?.debut);
  const verrouillage = date(brut?.verrouillage) || debut;
  if (!debut) return { erreur: "Indique la date et l'heure de début." };
  if (Date.parse(verrouillage) > Date.parse(debut)) return { erreur: "Le verrouillage des inscriptions doit être avant le début." };
  const fin = date(brut?.fin);
  if (fin && Date.parse(fin) < Date.parse(debut)) return { erreur: "La fin doit être après le début." };
  const recompense = RECOMPENSES.includes(brut?.recompense?.type) ? brut.recompense.type : "rien";
  let chronos = null;
  if (brut?.chronos) {
    chronos = {};
    for (const [cle, [min, max]] of Object.entries(BORNES_CHRONOS)) {
      const valeur = entier(brut.chronos[cle], min, max, null);
      if (valeur === null) return { erreur: `Chronos : ${cle === "analyse_s" ? "analyse" : cle === "action_s" ? "pick / ban" : "ban d'équilibrage"} entre ${min} et ${max} s.` };
      chronos[cle] = valeur;
    }
  }
  return {
    config: {
      nom,
      description: texte(brut?.description, LONGUEUR_DESCRIPTION),
      format,
      taille_equipe: format === "equipe" ? entier(brut?.taille_equipe, 2, 4, 2) : null,
      // En équipe : draft de la carpe (mode des équipes, cf. _lib/equipe.js).
      mode: format === "equipe" ? "carpe" : (MODES_THEATRE.includes(brut?.mode) ? brut.mode : "auto"),
      box: format === "equipe" ? "vitrine" : (BOX_TOURNOI.includes(brut?.box) ? brut.box : "full"),
      affrontement: AFFRONTEMENTS.includes(brut?.affrontement) ? brut.affrontement : "bo1",
      // Le dernier match (la finale) : bo1, bo3 ou bo5 (anciens tournois :
      // finale_bo5, sinon comme le reste de l'arbre).
      finale_affrontement: AFFRONTEMENTS_FINALE.includes(brut?.finale_affrontement) ? brut.finale_affrontement
        : brut?.finale_bo5 === true ? "bo5" : (AFFRONTEMENTS.includes(brut?.affrontement) ? brut.affrontement : "bo1"),
      // Phase finale : matchs en parallèle (sinon un à la fois).
      arbre_parallele: brut?.arbre_parallele === true,
      chronos,
      recompense: { type: recompense, texte: texte(brut?.recompense?.texte, LONGUEUR_RECOMPENSE) },
      max_participants: entier(brut?.max_participants, 2, MAX_PARTICIPANTS, 16),
      debut,
      fin,
      verrouillage,
      arbre_max: TAILLES_ARBRE.includes(Number(brut?.arbre_max)) ? Number(brut.arbre_max) : 16,
      qualif_matchs: entier(brut?.qualif_matchs, 1, MAX_QUALIF_MATCHS, 3),
      qualifs_format: FORMATS_QUALIFS.includes(brut?.qualifs_format) ? brut.qualifs_format : "rondes",
      poules: brut?.poules ? {
        nombre: entier(brut.poules.nombre, 0, 999, 0),
        taille: entier(brut.poules.taille, 0, 999, 0),
        qualifies: entier(brut.poules.qualifies, 0, 999, 0)
      } : null
    }
  };
}

// Réglages incohérents -> message, sinon null : phase finale plus grande
// que le tournoi ; poules qui ne remplissent pas exactement la phase finale
// ou n'ont pas de place pour tout le monde.
function erreurCoherence(config) {
  const { max_participants: max, arbre_max: places } = config;
  const nomPhase = places === 2 ? "la finale seule" : `les ${nomTour(places).toLowerCase()}`;
  if (places > taillePuissance2(max)) {
    return `Phase finale à ${places} places (${nomPhase}) pour ${max} participants au plus : choisis une phase finale plus petite ou plus de participants.`;
  }
  // Pas de qualifications possibles (jamais plus d'inscrits que de places).
  if (max <= places) return null;
  if (config.qualifs_format !== "poules") return null;
  const { nombre, taille, qualifies } = config.poules || {};
  const [minN, maxN] = BORNES_POULES.nombre;
  const [minT, maxT] = BORNES_POULES.taille;
  if (!(nombre >= minN && nombre <= maxN)) return `Poules : entre ${minN} et ${maxN} poules.`;
  if (!(taille >= minT && taille <= maxT)) return `Poules : entre ${minT} et ${maxT} participants par poule.`;
  if (!(qualifies >= 1 && qualifies < taille)) return `Poules : entre 1 et ${taille - 1} qualifiés par poule (moins que les participants d'une poule).`;
  if (nombre * qualifies !== places) {
    return `Poules : ${nombre} poules × ${qualifies} qualifiés = ${nombre * qualifies} qualifiés, mais ${nomPhase} demandent exactement ${places} qualifiés.`;
  }
  if (nombre * taille < max) {
    return `Poules : ${nombre} poules de ${taille} = ${nombre * taille} places pour ${max} participants au plus : agrandis les poules ou baisse le nombre de participants.`;
  }
  if ((nombre - 1) * taille >= max) {
    return `Poules : ${max} participants tiennent dans ${nombre - 1} poules de ${taille} ; avec ${nombre} poules, certaines seraient presque vides.`;
  }
  return null;
}

function nouvelId() {
  return crypto.randomBytes(4).toString("hex");
}

async function creerTournoi(brut, user) {
  if (!await peutCreerTournoi(user.id)) throw erreur(403, "Seuls les tournoitateurs (et les administrateurs) créent des tournois.");
  if (!estAdmin(user.id)) {
    const enCours = (await listerTournois()).filter(t => t.createur === user.id && !["termine", "annule"].includes(t.statut));
    if (enCours.length >= MAX_TOURNOIS_EN_COURS) throw erreur(409, `${MAX_TOURNOIS_EN_COURS} tournois en cours au plus : termine ou annule d'abord un des tiens.`);
  }
  const { config, erreur: message } = lireConfig(brut);
  if (message) throw erreur(400, message);
  const incoherence = erreurCoherence(config);
  if (incoherence) throw erreur(400, incoherence);
  const id = nouvelId();
  const maintenant = new Date().toISOString();
  const tournoi = {
    id,
    createur: user.id,
    createur_nom: user.global_name || user.username || "",
    cree_le: maintenant,
    maj_le: maintenant,
    ...config,
    arbitres: [],
    statut: "inscriptions",
    inscrits: [],
    equipes: [],
    qualifs: null,
    arbre: null,
    vainqueur: null
  };
  const { error } = await supabase.from("points").insert({ id: PREFIXE + id, data: tournoi, updated_at: maintenant });
  if (error) throw error;
  return tournoi;
}

// Modification par le gestionnaire : tout tant que les inscriptions sont
// ouvertes ; ensuite seulement le texte (nom, description, récompense) et
// la date de fin.
async function modifierConfig(id, brut, user) {
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi le modifie.");
    const { config, erreur: message } = lireConfig({ ...tournoi, ...brut });
    if (message) throw erreur(400, message);
    if (tournoi.statut === "inscriptions") {
      const incoherence = erreurCoherence(config);
      if (incoherence) throw erreur(400, incoherence);
      if (config.format === tournoi.format && config.max_participants < nbParticipants(tournoi)) {
        throw erreur(400, `Il y a déjà ${nbParticipants(tournoi)} inscrits : le maximum ne peut pas descendre en dessous.`);
      }
      // Format changé : inscriptions de l'autre format retirées.
      if (config.format !== tournoi.format) {
        tournoi.inscrits = [];
        tournoi.equipes = [];
      }
      Object.assign(tournoi, config);
    } else {
      Object.assign(tournoi, { nom: config.nom, description: config.description, recompense: config.recompense, fin: config.fin, arbre_parallele: config.arbre_parallele });
    }
  });
}

// ---- Participants ----

function participants(tournoi) {
  return tournoi.format === "equipe" ? tournoi.equipes.map(equipe => equipe.id) : [...tournoi.inscrits];
}

function nbParticipants(tournoi) {
  return tournoi.format === "equipe" ? tournoi.equipes.length : tournoi.inscrits.length;
}

function equipeDe(tournoi, discordId) {
  return tournoi.equipes.find(equipe => equipe.membres.includes(discordId)) || null;
}

function demandeDe(tournoi, discordId) {
  return tournoi.equipes.find(equipe => equipe.demandes.includes(discordId)) || null;
}

function verifierInscriptionsOuvertes(tournoi) {
  if (tournoi.statut !== "inscriptions") throw erreur(409, "Les inscriptions sont fermées.");
}

// Joueur inscrit sur le site avec une full box jouable (1v1) : sinon
// refusé.
async function verifierJoueur(discordId) {
  const data = await lireDonneesProprietaire(discordId);
  if (!data) throw erreur(409, "Crée d'abord ton compte (Mon compte).");
  return data;
}

async function inscrire(id, user, inscrire = true) {
  if (inscrire) await verifierJoueur(user.id);
  return modifierTournoi(id, tournoi => {
    if (tournoi.format !== "1v1") throw erreur(400, "Tournoi en équipe : crée ou rejoins une équipe.");
    verifierInscriptionsOuvertes(tournoi);
    const deja = tournoi.inscrits.includes(user.id);
    if (inscrire) {
      if (deja) return;
      if (tournoi.inscrits.length >= tournoi.max_participants) throw erreur(409, "Le tournoi est complet.");
      tournoi.inscrits.push(user.id);
    } else {
      tournoi.inscrits = tournoi.inscrits.filter(autre => autre !== user.id);
    }
  });
}

// Actions sur les équipes ({ action, equipe?, joueur?, nom? }).
async function actionEquipe(id, user, corps) {
  const { action } = corps || {};
  if (action === "creer" || action === "demander") await verifierJoueur(user.id);
  return modifierTournoi(id, tournoi => {
    if (tournoi.format !== "equipe") throw erreur(400, "Ce tournoi n'est pas en équipe.");
    verifierInscriptionsOuvertes(tournoi);
    const mienne = equipeDe(tournoi, user.id);
    const capitaine = mienne?.capitaine === user.id ? mienne : null;
    const retirerDemandes = discordId => tournoi.equipes.forEach(equipe => {
      equipe.demandes = equipe.demandes.filter(autre => autre !== discordId);
    });

    switch (action) {
      case "creer": {
        if (mienne) throw erreur(409, "Tu es déjà dans une équipe.");
        if (tournoi.equipes.length >= tournoi.max_participants) throw erreur(409, "Le tournoi est complet (nombre d'équipes maximum).");
        const nom = texte(corps.nom, LONGUEUR_NOM_EQUIPE);
        if (!nom) throw erreur(400, "Donne un nom à ton équipe.");
        if (tournoi.equipes.some(equipe => equipe.nom.toLowerCase() === nom.toLowerCase())) throw erreur(409, "Ce nom d'équipe est déjà pris.");
        retirerDemandes(user.id);
        tournoi.equipes.push({ id: `e${nouvelId()}`, nom, capitaine: user.id, membres: [user.id], demandes: [] });
        return;
      }
      case "demander": {
        if (mienne) throw erreur(409, "Tu es déjà dans une équipe.");
        const equipe = tournoi.equipes.find(e => e.id === corps.equipe);
        if (!equipe) throw erreur(404, "Équipe introuvable.");
        if (equipe.membres.length >= tournoi.taille_equipe) throw erreur(409, "Cette équipe est complète.");
        // Une seule demande à la fois : l'ancienne est retirée.
        retirerDemandes(user.id);
        equipe.demandes.push(user.id);
        return;
      }
      case "annuler_demande":
        retirerDemandes(user.id);
        return;
      case "accepter":
      case "refuser": {
        if (!capitaine) throw erreur(403, "Seul le capitaine gère les demandes.");
        if (!capitaine.demandes.includes(corps.joueur)) throw erreur(404, "Demande introuvable.");
        capitaine.demandes = capitaine.demandes.filter(autre => autre !== corps.joueur);
        if (action === "accepter") {
          if (capitaine.membres.length >= tournoi.taille_equipe) throw erreur(409, "Ton équipe est complète.");
          if (equipeDe(tournoi, corps.joueur)) throw erreur(409, "Ce joueur est déjà dans une équipe.");
          capitaine.membres.push(corps.joueur);
          retirerDemandes(corps.joueur);
        }
        return;
      }
      case "exclure": {
        if (!capitaine) throw erreur(403, "Seul le capitaine exclut un joueur.");
        if (corps.joueur === user.id) throw erreur(400, "Dissous l'équipe pour la quitter.");
        capitaine.membres = capitaine.membres.filter(autre => autre !== corps.joueur);
        return;
      }
      case "quitter": {
        if (!mienne) throw erreur(409, "Tu n'es dans aucune équipe.");
        // Capitaine : l'équipe est dissoute.
        if (capitaine) tournoi.equipes = tournoi.equipes.filter(e => e.id !== capitaine.id);
        else mienne.membres = mienne.membres.filter(autre => autre !== user.id);
        return;
      }
      default:
        throw erreur(400, "Action inconnue.");
    }
  });
}

// ---- Gestion (gestionnaire) ----

async function definirArbitres(id, user, ids) {
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi choisit les arbitres.");
    if (!Array.isArray(ids)) throw erreur(400, "Liste d'arbitres invalide.");
    tournoi.arbitres = [...new Set(ids.filter(arbitre => typeof arbitre === "string" && /^\d{5,25}$/.test(arbitre)))].slice(0, MAX_ARBITRES);
  });
}

async function verrouiller(id, user) {
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi le verrouille.");
    if (tournoi.statut !== "inscriptions") throw erreur(409, "Les inscriptions sont déjà fermées.");
    tournoi.statut = "verrouille";
  });
}

async function annulerTournoi(id, user) {
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi l'annule.");
    if (tournoi.statut === "termine") throw erreur(409, "Le tournoi est terminé.");
    tournoi.statut = "annule";
  });
}

// Suppression définitive (annulé, ou rien commencé) : la ligne est retirée.
async function supprimerTournoi(id, user) {
  const lecture = await lireTournoi(id);
  if (!lecture) throw erreur(404, "Tournoi introuvable");
  const { tournoi } = lecture;
  if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi le supprime.");
  if (!["inscriptions", "verrouille", "annule"].includes(tournoi.statut)) throw erreur(409, "Annule d'abord le tournoi.");
  const { error } = await supabase.from("points").delete().eq("id", PREFIXE + id);
  if (error) throw error;
}

// ---- Équilibrage des paires (1v1) ----

// Données de profil des participants (1v1) -> Map id -> data.
async function donneesParticipants(tournoi) {
  if (tournoi.format !== "1v1") return new Map();
  const ids = participants(tournoi);
  const { data, error } = await supabase.from("profiles").select("discord_id, data").in("discord_id", ids);
  if (error) throw error;
  return new Map((data || []).map(ligne => [ligne.discord_id, ligne.data]));
}

function equilibrable(tournoi, donnees, a, b) {
  if (tournoi.format !== "1v1" || !a || !b) return true;
  const dataA = donnees.get(a);
  const dataB = donnees.get(b);
  return !!dataA && !!dataB && estEquilibrableFullBox(dataA, dataB, tournoi.mode);
}

function melanger(liste) {
  const copie = [...liste];
  for (let i = copie.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copie[i], copie[j]] = [copie[j], copie[i]];
  }
  return copie;
}

// ---- Arbre ----

const NOMS_TOURS = { 2: "Finale", 4: "Demi-finales", 8: "Quarts de finale" };

function nomTour(nbPlaces) {
  return NOMS_TOURS[nbPlaces] || `${nbPlaces / 2}es de finale`;
}

function taillePuissance2(n) {
  let taille = 2;
  while (taille < n) taille *= 2;
  return taille;
}

// Paires du premier tour : exempts (adversaire null) répartis, chaque paire
// équilibrable si possible (500 tirages) -> { paires, equilibre }.
// pouleDe (après des poules) : 2 qualifiés de la même poule évités au
// premier tour si possible.
function tirerPremierTour(tournoi, liste, donnees, pouleDe = null) {
  const taille = taillePuissance2(liste.length);
  const exempts = taille - liste.length;
  let meilleur = null;
  for (let essai = 0; essai < 500; essai++) {
    const ordre = melanger(liste);
    const paires = [];
    for (let i = 0; i < exempts; i++) paires.push([ordre[i], null]);
    for (let i = exempts; i < ordre.length; i += 2) paires.push([ordre[i], ordre[i + 1]]);
    const ratees = paires.filter(([a, b]) => !equilibrable(tournoi, donnees, a, b)).length;
    const memePoule = pouleDe ? paires.filter(([a, b]) => b && pouleDe.get(a) === pouleDe.get(b)).length : 0;
    const cout = ratees * 10 + memePoule;
    if (!meilleur || cout < meilleur.cout) meilleur = { paires: melanger(paires), ratees, cout };
    if (!cout) break;
  }
  return { paires: meilleur.paires, equilibre: meilleur.ratees === 0 };
}

function nouveauMatch(id, a = null, b = null) {
  return { id, a, b, statut: "attente", vainqueur: null, room_id: null, manches: [] };
}

// Arbre complet depuis les paires du premier tour ; exempts qualifiés
// d'office.
function construireArbre(paires) {
  const tours = [paires.map(([a, b], i) => nouveauMatch(`a0m${i}`, a, b))];
  for (let n = paires.length / 2, t = 1; n >= 1; n /= 2, t++) {
    tours.push(Array.from({ length: n }, (_, i) => nouveauMatch(`a${t}m${i}`)));
  }
  const arbre = { tours };
  tours[0].forEach(match => majStatutMatch(arbre, match));
  return arbre;
}

function trouverMatchArbre(arbre, matchId) {
  for (const [t, tour] of arbre.tours.entries()) {
    const i = tour.findIndex(match => match.id === matchId);
    if (i >= 0) return { match: tour[i], t, i };
  }
  return null;
}

// Statut d'un match de l'arbre selon ses participants : exempt (un seul
// participant au premier tour) -> qualifié d'office.
function majStatutMatch(arbre, match) {
  if (match.statut === "termine" || match.statut === "en_cours") return;
  const { t } = trouverMatchArbre(arbre, match.id);
  if (t === 0 && match.a && !match.b) {
    match.statut = "termine";
    match.vainqueur = match.a;
    match.exempt = true;
    propager(arbre, match);
    return;
  }
  match.statut = match.a && match.b ? "pret" : "attente";
}

// Vainqueur placé dans le match suivant.
function propager(arbre, match) {
  const { t, i } = trouverMatchArbre(arbre, match.id);
  const suivant = arbre.tours[t + 1]?.[Math.floor(i / 2)];
  if (!suivant) return;
  suivant[i % 2 === 0 ? "a" : "b"] = match.vainqueur;
  majStatutMatch(arbre, suivant);
}

// Après le verrouillage : qualifications si trop de participants, sinon
// l'arbre directement.
async function generer(id, user) {
  await actualiserPoints();
  const lecture = await lireTournoi(id);
  if (!lecture) throw erreur(404, "Tournoi introuvable");
  const donnees = await donneesParticipants(lecture.tournoi);
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi lance la suite.");
    if (tournoi.statut !== "verrouille") throw erreur(409, tournoi.statut === "inscriptions" ? "Verrouille d'abord les inscriptions." : "Le tournoi a déjà commencé.");
    if (tournoi.format === "equipe") {
      const incompletes = tournoi.equipes.filter(equipe => equipe.membres.length !== tournoi.taille_equipe);
      if (incompletes.length) {
        // Équipes incomplètes au verrouillage : retirées du tournoi.
        tournoi.equipes_retirees = incompletes.map(equipe => equipe.nom);
        tournoi.equipes = tournoi.equipes.filter(equipe => equipe.membres.length === tournoi.taille_equipe);
      }
    }
    const liste = participants(tournoi);
    if (liste.length < 2) throw erreur(409, "Il faut au moins 2 participants.");
    if (liste.length > tournoi.arbre_max) {
      tournoi.qualifs = genererQualifs(tournoi, liste, donnees);
      tournoi.statut = "qualifs";
    } else {
      const { paires, equilibre } = tirerPremierTour(tournoi, liste, donnees);
      tournoi.arbre = construireArbre(paires);
      tournoi.arbre_equilibre = equilibre;
      tournoi.statut = "arbre";
    }
  });
}

// Échange de 2 participants du premier tour (avant tout match joué).
async function echangerPlaces(id, user, a, b) {
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi modifie l'arbre.");
    if (tournoi.statut !== "arbre") throw erreur(409, "L'arbre n'est pas encore généré.");
    const commence = tournoi.arbre.tours.flat().some(match => !match.exempt && (match.statut === "en_cours" || match.statut === "termine"));
    if (commence) throw erreur(409, "Un match de l'arbre a déjà été joué : l'arbre ne se modifie plus.");
    const paires = tournoi.arbre.tours[0].map(match => [match.a, match.b]);
    const position = participant => {
      for (const [i, paire] of paires.entries()) {
        const j = paire.indexOf(participant);
        if (j >= 0) return [i, j];
      }
      return null;
    };
    const pa = position(a);
    const pb = position(b);
    if (!pa || !pb) throw erreur(404, "Participant introuvable dans l'arbre.");
    paires[pa[0]][pa[1]] = b;
    paires[pb[0]][pb[1]] = a;
    // Exempt toujours en première place de sa paire.
    paires.forEach(paire => { if (!paire[0] && paire[1]) paire.reverse(); });
    tournoi.arbre = construireArbre(paires);
  });
}

// ---- Qualifications ----

// qualif_matchs rondes : chaque ronde, paires tirées au hasard, sans revoir
// un adversaire déjà rencontré ni une paire pas équilibrable si possible ;
// nombre impair : un exempt par ronde (celui qui l'a le moins été).
function genererQualifs(tournoi, liste, donnees) {
  if (tournoi.qualifs_format === "poules" && tournoi.poules) return genererPoules(tournoi, liste, donnees);
  const matchs = [];
  const rencontres = new Set();
  const exemptions = new Map(liste.map(p => [p, 0]));
  const cle = (a, b) => [a, b].sort().join("|");
  for (let ronde = 1; ronde <= tournoi.qualif_matchs; ronde++) {
    let meilleur = null;
    for (let essai = 0; essai < 300; essai++) {
      let ordre = melanger(liste);
      let exempt = null;
      if (ordre.length % 2) {
        const min = Math.min(...ordre.map(p => exemptions.get(p)));
        exempt = ordre.find(p => exemptions.get(p) === min);
        ordre = ordre.filter(p => p !== exempt);
      }
      const paires = [];
      for (let i = 0; i < ordre.length; i += 2) paires.push([ordre[i], ordre[i + 1]]);
      const cout = paires.reduce((total, [a, b]) => total + (rencontres.has(cle(a, b)) ? 10 : 0) + (equilibrable(tournoi, donnees, a, b) ? 0 : 1), 0);
      if (!meilleur || cout < meilleur.cout) meilleur = { paires, exempt, cout };
      if (!cout) break;
    }
    if (meilleur.exempt) exemptions.set(meilleur.exempt, exemptions.get(meilleur.exempt) + 1);
    meilleur.paires.forEach(([a, b]) => {
      rencontres.add(cle(a, b));
      matchs.push({ id: `q${matchs.length}`, ronde, a, b, statut: "pret", vainqueur: null, room_id: null, trophees: 0, manches: [] });
    });
  }
  return { matchs };
}

// Poules : participants répartis au hasard en poules équilibrées en taille
// (paires pas équilibrables évitées si possible, 200 tirages), puis tous
// contre tous dans chaque poule (rondes de la méthode du cercle).
function genererPoules(tournoi, liste, donnees) {
  const nombre = tournoi.poules.nombre;
  let meilleur = null;
  for (let essai = 0; essai < 200; essai++) {
    const ordre = melanger(liste);
    const poules = Array.from({ length: nombre }, () => []);
    ordre.forEach((p, i) => poules[i % nombre].push(p));
    let ratees = 0;
    poules.forEach(poule => poule.forEach((a, i) => poule.slice(i + 1).forEach(b => {
      if (!equilibrable(tournoi, donnees, a, b)) ratees++;
    })));
    if (!meilleur || ratees < meilleur.ratees) meilleur = { poules, ratees };
    if (!ratees) break;
  }
  const matchs = [];
  meilleur.poules.forEach((poule, numero) => {
    // Méthode du cercle : n - 1 rondes (n pair ; impair : un exempt par ronde).
    const tour = poule.length % 2 ? [...poule, null] : [...poule];
    for (let ronde = 1; ronde < tour.length; ronde++) {
      for (let i = 0; i < tour.length / 2; i++) {
        const a = tour[i];
        const b = tour[tour.length - 1 - i];
        if (a && b) matchs.push({ id: `q${matchs.length}`, poule: numero, ronde, a, b, statut: "pret", vainqueur: null, room_id: null, trophees: 0, manches: [] });
      }
      tour.splice(1, 0, tour.pop());
    }
  });
  return { format: "poules", poules: meilleur.poules, matchs, equilibre: meilleur.ratees === 0 };
}

// Classement des qualifications (d'une poule si numero donné) : trophées,
// puis victoires.
function classementQualifs(tournoi, numero = null) {
  const membres = numero === null ? participants(tournoi) : tournoi.qualifs.poules[numero];
  const lignes = new Map(membres.map(p => [p, { id: p, trophees: 0, victoires: 0, joues: 0 }]));
  (tournoi.qualifs?.matchs || []).forEach(match => {
    if (match.statut !== "termine" || !match.vainqueur) return;
    const perdant = match.vainqueur === match.a ? match.b : match.a;
    const gagnant = lignes.get(match.vainqueur);
    const battu = lignes.get(perdant);
    if (gagnant) { gagnant.trophees += match.trophees; gagnant.victoires++; gagnant.joues++; }
    if (battu) { battu.trophees -= match.trophees; battu.joues++; }
  });
  return [...lignes.values()].sort((x, y) => y.trophees - x.trophees || y.victoires - x.victoires || x.id.localeCompare(y.id));
}

// Fin des qualifications : les arbre_max premiers dans l'arbre.
async function terminerQualifs(id, user) {
  await actualiserPoints();
  const lecture = await lireTournoi(id);
  if (!lecture) throw erreur(404, "Tournoi introuvable");
  const donnees = await donneesParticipants(lecture.tournoi);
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi termine les qualifications.");
    if (tournoi.statut !== "qualifs") throw erreur(409, "Pas de qualifications en cours.");
    if (tournoi.qualifs.matchs.some(match => match.statut === "en_cours")) throw erreur(409, "Un match de qualification est en cours : attends sa fin.");
    // Poules : les meilleurs de chaque poule ; sinon les meilleurs au total.
    const poules = tournoi.qualifs.format === "poules" ? tournoi.qualifs.poules : null;
    const qualifies = poules
      ? poules.flatMap((_, numero) => classementQualifs(tournoi, numero).slice(0, tournoi.poules.qualifies).map(ligne => ligne.id))
      : classementQualifs(tournoi).slice(0, tournoi.arbre_max).map(ligne => ligne.id);
    tournoi.qualifies = qualifies;
    const pouleDe = poules ? new Map(poules.flatMap((poule, numero) => poule.map(p => [p, numero]))) : null;
    const { paires, equilibre } = tirerPremierTour(tournoi, qualifies, donnees, pouleDe);
    tournoi.arbre = construireArbre(paires);
    tournoi.arbre_equilibre = equilibre;
    tournoi.statut = "arbre";
  });
}

// ---- Matchs : lancement et résultats ----

function trouverMatch(tournoi, matchId) {
  if (typeof matchId !== "string") return null;
  if (matchId.startsWith("q")) {
    const match = tournoi.qualifs?.matchs.find(m => m.id === matchId);
    return match ? { match, phase: "qualif" } : null;
  }
  const trouve = tournoi.arbre && trouverMatchArbre(tournoi.arbre, matchId);
  return trouve ? { match: trouve.match, phase: "arbre" } : null;
}

// Joueurs (discord ids) d'un participant.
function joueursDe(tournoi, participant) {
  if (tournoi.format !== "equipe") return [participant];
  return tournoi.equipes.find(equipe => equipe.id === participant)?.membres || [];
}

// Format de la finale (anciens tournois : finale_bo5, sinon comme l'arbre).
function affrontementFinale(tournoi) {
  return tournoi.finale_affrontement || (tournoi.finale_bo5 ? "bo5" : tournoi.affrontement);
}

// Manches à gagner : qualifs 1 ; arbre 1 (bo1) ou 2 (bo3) ; la finale selon
// son format (bo1, bo3, bo5).
function manchesAGagner(tournoi, phase, matchId = null) {
  if (phase !== "arbre") return 1;
  const tours = tournoi.arbre?.tours;
  if (tours && tours[tours.length - 1][0].id === matchId) return MANCHES_A_GAGNER[affrontementFinale(tournoi)] || 1;
  return MANCHES_A_GAGNER[tournoi.affrontement] || 1;
}

// Prochain match de l'arbre à jouer (ordre des tours, puis de l'arbre).
function prochainMatchArbre(tournoi) {
  return tournoi.arbre?.tours.flat().find(match => match.statut === "pret") || null;
}

// Draft initiale d'une room de tournoi 1v1 (complétée par
// assurerRolesDraft au premier accès, cf. _lib/room.js).
function draftTournoi1v1(tournoi, match, phase) {
  return {
    mode_theatre: tournoi.mode,
    boss_impose: null,
    premier: "aleatoire",
    createur: tournoi.createur,
    chronometre: !!tournoi.chronos,
    chronos_config: tournoi.chronos || null,
    // Full box imposée : déjà choisie (seule autorisée, cf. handleBox).
    ...(tournoi.box === "full" ? { box_j1: "full", box_j2: "full" } : {}),
    tournoi: infosDraft(tournoi, match, phase)
  };
}

function infosDraft(tournoi, match, phase) {
  return {
    id: tournoi.id,
    nom: tournoi.nom,
    phase,
    match: match.id,
    a: match.a,
    b: match.b,
    box: tournoi.box,
    manches_a_gagner: manchesAGagner(tournoi, phase, match.id),
    arbitres: [tournoi.createur, ...(tournoi.arbitres || [])]
  };
}

// Création de la room d'un match (1v1 : room "tournoi", équipe : lobby
// "equipe" déjà rempli, cf. creerRoomEquipeTournoi).
async function creerRoomMatch(roomId, tournoi, match, phase) {
  if (tournoi.format === "equipe") {
    const { creerRoomEquipeTournoi } = require("./equipe");
    await creerRoomEquipeTournoi(roomId, tournoi, match, infosDraft(tournoi, match, phase));
    return roomId;
  }
  const { error } = await supabase.from("rooms").insert({
    room_id: roomId,
    player1_discord_id: match.a,
    player2_discord_id: match.b,
    type: "tournoi",
    draft: draftTournoi1v1(tournoi, match, phase)
  });
  if (error) throw error;
  return roomId;
}

// Lancement d'un match : arbre = gestionnaire (« Prochain match », ou un
// match précis), un seul à la fois ; arbre en parallèle et qualifications
// = un des joueurs du match ou un arbitre (gestionnaire : aussi « Prochain
// match »).
async function lancerMatch(id, user, matchId = null) {
  const lecture = await lireTournoi(id);
  if (!lecture) throw erreur(404, "Tournoi introuvable");
  const { tournoi } = lecture;
  avancerSelonDates(tournoi);
  let trouve;
  if (tournoi.statut === "arbre") {
    const trouveId = matchId ? trouverMatch(tournoi, matchId) : null;
    if (trouveId && trouveId.phase !== "arbre") throw erreur(404, "Match introuvable.");
    const match = matchId ? trouveId?.match : prochainMatchArbre(tournoi);
    if (tournoi.arbre_parallele) {
      const joue = !!match && [match.a, match.b].some(p => joueursDe(tournoi, p).includes(user.id));
      if (!(matchId ? joue || estArbitre(tournoi, user.id) : estGestionnaire(tournoi, user.id))) {
        throw erreur(403, "Seuls les joueurs du match ou un arbitre le lancent.");
      }
    } else {
      if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi lance les matchs de l'arbre.");
      if (tournoi.arbre.tours.flat().some(m => m.statut === "en_cours")) throw erreur(409, "Un match est déjà en cours : termine-le d'abord.");
    }
    if (!match || match.statut !== "pret") throw erreur(409, "Aucun match prêt à jouer.");
    trouve = { match, phase: "arbre" };
  } else if (tournoi.statut === "qualifs") {
    trouve = trouverMatch(tournoi, matchId);
    if (!trouve) throw erreur(404, "Match introuvable.");
    const joue = [trouve.match.a, trouve.match.b].some(p => joueursDe(tournoi, p).includes(user.id));
    if (!joue && !estArbitre(tournoi, user.id)) throw erreur(403, "Seuls les joueurs du match ou un arbitre le lancent.");
    if (trouve.match.statut !== "pret") throw erreur(409, trouve.match.statut === "en_cours" ? "Ce match est déjà lancé." : "Ce match est terminé.");
  } else {
    throw erreur(409, "Aucun match à lancer à ce stade.");
  }
  // Match réservé d'abord (écriture conditionnelle) : 2 lancements en même
  // temps ne créent pas 2 rooms ; room pas créée : match remis à jouer.
  const roomId = crypto.randomBytes(4).toString("hex");
  await modifierTournoi(id, t => {
    const { match } = trouverMatch(t, trouve.match.id);
    if (match.statut !== "pret") throw erreur(409, "Ce match vient d'être lancé.");
    match.statut = "en_cours";
    match.room_id = roomId;
  });
  try {
    await creerRoomMatch(roomId, tournoi, trouve.match, trouve.phase);
  } catch (e) {
    await modifierTournoi(id, t => {
      const { match } = trouverMatch(t, trouve.match.id);
      if (match.room_id === roomId) {
        match.statut = "pret";
        match.room_id = null;
      }
    }).catch(() => {});
    throw e;
  }
  return roomId;
}

// Arbitre du tournoi à cet instant (liste à jour, pas celle recopiée dans
// la room à son lancement : un arbitre retiré ne saisit plus rien).
async function estArbitreActuel(infos, discordId) {
  const lecture = infos?.id ? await lireTournoi(infos.id) : null;
  return !!lecture && estArbitre(lecture.tournoi, discordId);
}

// Finale jouée : tournoi terminé. -> joueurs vainqueurs (discord ids), ou
// null.
function verifierFin(tournoi) {
  const finale = tournoi.arbre.tours[tournoi.arbre.tours.length - 1][0];
  if (finale.statut !== "termine") return null;
  tournoi.vainqueur = finale.vainqueur;
  tournoi.statut = "termine";
  return joueursDe(tournoi, finale.vainqueur);
}

// Vainqueurs prévenus (fenêtre des récompenses, cf. lireNouveautes dans
// _lib/koyns.js).
async function annoncerVictoire(id, gagnants) {
  if (!gagnants?.length) return;
  const { noterVictoireTournoi } = require("./koyns");
  await noterVictoireTournoi(gagnants, id).catch(e => console.error("Erreur annonce du vainqueur :", e));
}

// Résultat d'une manche (appelé à l'archivage d'un match de tournoi, cf.
// handleTempsArbitre et equipe.js) : vainqueur (participant), trophées
// (qualifs), id du match archivé. Bo3 / bo5 : match terminé aux manches
// gagnées. -> { termine, score } pour la room.
async function enregistrerManche(infos, { vainqueur, trophees = 0, idMatch = null }) {
  let gagnants = null;
  const resultat = await modifierTournoi(infos.id, tournoi => {
    gagnants = null;
    const trouve = trouverMatch(tournoi, infos.match);
    if (!trouve) throw erreur(404, "Match du tournoi introuvable.");
    const { match, phase } = trouve;
    match.manches.push({ vainqueur, trophees, match_id: idMatch });
    const gagnees = participant => match.manches.filter(manche => manche.vainqueur === participant).length;
    const aGagner = manchesAGagner(tournoi, phase, match.id);
    const score = { [match.a]: gagnees(match.a), [match.b]: gagnees(match.b) };
    if (gagnees(vainqueur) >= aGagner) {
      match.statut = "termine";
      match.vainqueur = vainqueur;
      match.trophees = match.manches.reduce((total, manche) => total + (manche.vainqueur === vainqueur ? manche.trophees : -manche.trophees), 0);
      if (phase === "arbre") {
        propager(tournoi.arbre, match);
        gagnants = verifierFin(tournoi);
      }
      return { termine: true, score };
    }
    return { termine: false, score };
  });
  await annoncerVictoire(infos.id, gagnants);
  return resultat;
}

// Manche annulée ou room abandonnée : match remis à jouer (gestionnaire).
async function relancerMatch(id, user, matchId) {
  return modifierTournoi(id, tournoi => {
    if (!estArbitre(tournoi, user.id)) throw erreur(403, "Seul un arbitre remet un match à jouer.");
    const trouve = trouverMatch(tournoi, matchId);
    if (!trouve) throw erreur(404, "Match introuvable.");
    if (trouve.match.statut !== "en_cours") throw erreur(409, "Ce match n'est pas en cours.");
    trouve.match.statut = "pret";
    trouve.match.room_id = null;
  });
}

// Forfait : le gestionnaire désigne le vainqueur d'un match pas terminé
// (adversaire absent...). Qualifications : trophées maximum.
async function declarerForfait(id, user, matchId, vainqueur) {
  let gagnants = null;
  await modifierTournoi(id, tournoi => {
    gagnants = null;
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi déclare un forfait.");
    const trouve = trouverMatch(tournoi, matchId);
    if (!trouve) throw erreur(404, "Match introuvable.");
    const { match, phase } = trouve;
    // Pas de forfait déclaré par un joueur du match (arbitre lui-même).
    if ([match.a, match.b].some(p => joueursDe(tournoi, p).includes(user.id))) throw erreur(403, "Tu joues ce match : un autre admin doit déclarer le forfait.");
    if (match.statut === "termine") throw erreur(409, "Ce match est terminé.");
    if (![match.a, match.b].includes(vainqueur) || !vainqueur) throw erreur(400, "Vainqueur invalide.");
    match.statut = "termine";
    match.vainqueur = vainqueur;
    match.forfait = true;
    match.trophees = phase === "qualif" ? 30 : 0;
    match.room_id = null;
    if (phase === "arbre") {
      propager(tournoi.arbre, match);
      gagnants = verifierFin(tournoi);
    }
  });
  await annoncerVictoire(id, gagnants);
}

// Trophées d'une manche de qualification (même calcul qu'en classé).
function tropheesManche(draft) {
  return calculerTrophees(draft.temps_j1, draft.temps_j2, draft.vainqueur, draft.boss_id);
}

// ---- Vues ----

// Noms, photos des joueurs cités dans les tournois.
async function lireJoueurs(ids) {
  const uniques = [...new Set(ids.filter(Boolean))];
  if (!uniques.length) return {};
  const { data, error } = await supabase.from("profiles")
    .select("discord_id, discord_username, discord_global_name, discord_avatar_url").in("discord_id", uniques);
  if (error) throw error;
  return Object.fromEntries((data || []).map(p => [p.discord_id, {
    nom: p.discord_global_name || p.discord_username || "Joueur",
    avatar: p.discord_avatar_url || null
  }]));
}

function idsCites(tournoi) {
  return [
    tournoi.createur,
    ...(tournoi.arbitres || []),
    ...tournoi.inscrits,
    ...tournoi.equipes.flatMap(equipe => [...equipe.membres, ...equipe.demandes])
  ];
}

function resume(tournoi) {
  const { inscrits, equipes, qualifs, arbre, ...reste } = tournoi;
  // Vainqueur : nom de l'équipe (en équipe), sinon son id (cf. joueurs).
  const equipeGagnante = tournoi.format === "equipe" ? equipes.find(e => e.id === tournoi.vainqueur) : null;
  return { ...reste, nb_participants: nbParticipants(tournoi), ...(equipeGagnante ? { vainqueur_nom: equipeGagnante.nom } : {}) };
}

async function vueTournoi(tournoi, user) {
  avancerSelonDates(tournoi);
  return {
    tournoi,
    joueurs: await lireJoueurs(idsCites(tournoi)),
    classement_qualifs: tournoi.qualifs ? classementQualifs(tournoi) : null,
    classements_poules: tournoi.qualifs?.format === "poules" ? tournoi.qualifs.poules.map((_, numero) => classementQualifs(tournoi, numero)) : null,
    noms_tours: tournoi.arbre ? tournoi.arbre.tours.map(tour => nomTour(tour.length * 2)) : null,
    moi: user ? {
      id: user.id,
      gestionnaire: estGestionnaire(tournoi, user.id),
      arbitre: estArbitre(tournoi, user.id)
    } : null
  };
}

// ---- Routes (/api/rooms/tournoi/<action>?id=<tournoi>, cf.
// api/rooms/[room_id]/[action].js) ----

async function routeTournoi(action, req, res, user) {
  const url = new URL(req.url, "http://x");
  const id = url.searchParams.get("id");
  const corps = req.body && typeof req.body === "object" ? req.body : {};
  const repondreTournoi = async () => {
    const lecture = await lireTournoi(id);
    if (!lecture) throw erreur(404, "Tournoi introuvable");
    return res.status(200).json(await vueTournoi(lecture.tournoi, user));
  };

  if (req.method === "GET") {
    if (action === "liste") {
      const tournois = (await listerTournois()).map(t => { avancerSelonDates(t); return resume(t); })
        .sort((a, b) => Date.parse(b.debut) - Date.parse(a.debut));
      return res.status(200).json({
        tournois,
        createurs: await lireJoueurs(tournois.flatMap(t => [t.createur, t.format === "1v1" ? t.vainqueur : null])),
        peut_creer: user ? await peutCreerTournoi(user.id) : false
      });
    }
    if (action === "detail") return repondreTournoi();
    if (action === "tournoitateurs") {
      if (!user || !await estModerateur(user.id)) throw erreur(403, "Réservé aux administrateurs.");
      return res.status(200).json({ tournoitateurs: await lireTournoitateurs() });
    }
    throw erreur(404, "Route inconnue");
  }

  if (req.method !== "POST") throw erreur(405, "Méthode non autorisée");
  if (!user) throw erreur(401, "Non connecté");
  const attente = await verifierFrequenceCompte(user.id, "tournoi", DELAI_ACTION_MS);
  if (attente > 0) throw erreur(429, "Doucement : une action par seconde au plus.");

  switch (action) {
    case "creer": {
      const tournoi = await creerTournoi(corps.config, user);
      return res.status(200).json({ id: tournoi.id });
    }
    case "modifier": await modifierConfig(id, corps.config, user); break;
    case "inscrire": await inscrire(id, user, true); break;
    case "desinscrire": await inscrire(id, user, false); break;
    case "equipe": await actionEquipe(id, user, corps); break;
    case "arbitres": await definirArbitres(id, user, corps.arbitres); break;
    case "verrouiller": await verrouiller(id, user); break;
    case "generer": await generer(id, user); break;
    case "echanger": await echangerPlaces(id, user, corps.a, corps.b); break;
    case "terminer_qualifs": await terminerQualifs(id, user); break;
    case "lancer": {
      const roomId = await lancerMatch(id, user, corps.match || null);
      return res.status(200).json({ room_id: roomId, equipe: (await lireTournoi(id))?.tournoi.format === "equipe" });
    }
    case "relancer": await relancerMatch(id, user, corps.match); break;
    case "forfait": await declarerForfait(id, user, corps.match, corps.vainqueur); break;
    case "annuler": await annulerTournoi(id, user); break;
    case "supprimer":
      await supprimerTournoi(id, user);
      return res.status(200).json({ ok: true });
    case "tournoitateurs": {
      if (!await estModerateur(user.id)) throw erreur(403, "Réservé aux administrateurs et mini admins.");
      const ids = await lireTournoitateurs();
      const cible = typeof corps.discord_id === "string" ? corps.discord_id.trim() : "";
      if (!/^\d{5,25}$/.test(cible)) throw erreur(400, "ID Discord invalide.");
      if (corps.retirer) delete ids[cible];
      else {
        const joueurs = await lireJoueurs([cible]);
        if (!joueurs[cible]) throw erreur(404, "Joueur introuvable (il doit s'être connecté au site).");
        ids[cible] = { nom: joueurs[cible].nom, ajoute_par: user.id, ajoute_le: new Date().toISOString() };
      }
      await ecrireTournoitateurs(ids);
      return res.status(200).json({ tournoitateurs: ids });
    }
    default:
      throw erreur(404, "Route inconnue");
  }
  return repondreTournoi();
}

module.exports = {
  BORNES_CHRONOS,
  estArbitre,
  estArbitreActuel,
  estTournoitateur,
  peutCreerTournoi,
  enregistrerManche,
  tropheesManche,
  joueursDe,
  routeTournoi
};
