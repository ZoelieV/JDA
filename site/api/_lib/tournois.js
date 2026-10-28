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
//                  gestionnaire (« Prochain match »), bo1 ou bo3 ; premier
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

const PREFIXE = "tournoi:";
const LIGNE_TOURNOITATEURS = "tournoitateurs";
const FORMATS = ["1v1", "equipe"];
const TAILLES_EQUIPE = [2, 3, 4];
const BOX_TOURNOI = ["full", "libre"];
const AFFRONTEMENTS = ["bo1", "bo3"];
const RECOMPENSES = ["cosmetiques", "battle_pass", "faveur", "pack", "rien"];
// Places de l'arbre : finale (2) à 64e de finale (128).
const TAILLES_ARBRE = [2, 4, 8, 16, 32, 64, 128];
const MAX_PARTICIPANTS = 256;
const LONGUEUR_NOM = 60;
const LONGUEUR_DESCRIPTION = 1000;
const LONGUEUR_RECOMPENSE = 300;
const LONGUEUR_NOM_EQUIPE = 30;
const MAX_ARBITRES = 20;
const MAX_QUALIF_MATCHS = 10;
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
      chronos,
      recompense: { type: recompense, texte: texte(brut?.recompense?.texte, LONGUEUR_RECOMPENSE) },
      max_participants: entier(brut?.max_participants, 2, MAX_PARTICIPANTS, 16),
      debut,
      fin,
      verrouillage,
      arbre_max: TAILLES_ARBRE.includes(Number(brut?.arbre_max)) ? Number(brut.arbre_max) : 16,
      qualif_matchs: entier(brut?.qualif_matchs, 1, MAX_QUALIF_MATCHS, 3)
    }
  };
}

function nouvelId() {
  return crypto.randomBytes(4).toString("hex");
}

async function creerTournoi(brut, user) {
  if (!await peutCreerTournoi(user.id)) throw erreur(403, "Seuls les tournoitateurs (et les administrateurs) créent des tournois.");
  const { config, erreur: message } = lireConfig(brut);
  if (message) throw erreur(400, message);
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
      // Format changé : inscriptions de l'autre format retirées.
      if (config.format !== tournoi.format) {
        tournoi.inscrits = [];
        tournoi.equipes = [];
      }
      Object.assign(tournoi, config);
    } else {
      Object.assign(tournoi, { nom: config.nom, description: config.description, recompense: config.recompense, fin: config.fin });
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
function tirerPremierTour(tournoi, liste, donnees) {
  const taille = taillePuissance2(liste.length);
  const exempts = taille - liste.length;
  let meilleur = null;
  for (let essai = 0; essai < 500; essai++) {
    const ordre = melanger(liste);
    const paires = [];
    for (let i = 0; i < exempts; i++) paires.push([ordre[i], null]);
    for (let i = exempts; i < ordre.length; i += 2) paires.push([ordre[i], ordre[i + 1]]);
    const ratees = paires.filter(([a, b]) => !equilibrable(tournoi, donnees, a, b)).length;
    if (!meilleur || ratees < meilleur.ratees) meilleur = { paires: melanger(paires), ratees };
    if (!ratees) break;
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

// Classement des qualifications : trophées, puis victoires.
function classementQualifs(tournoi) {
  const lignes = new Map(participants(tournoi).map(p => [p, { id: p, trophees: 0, victoires: 0, joues: 0 }]));
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
    const qualifies = classementQualifs(tournoi).slice(0, tournoi.arbre_max).map(ligne => ligne.id);
    tournoi.qualifies = qualifies;
    const { paires, equilibre } = tirerPremierTour(tournoi, qualifies, donnees);
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

function manchesAGagner(tournoi, phase) {
  return phase === "arbre" && tournoi.affrontement === "bo3" ? 2 : 1;
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
    manches_a_gagner: manchesAGagner(tournoi, phase),
    arbitres: [tournoi.createur, ...(tournoi.arbitres || [])]
  };
}

// Création de la room d'un match (1v1 : room "tournoi", équipe : lobby
// "equipe" déjà rempli, cf. creerRoomEquipeTournoi).
async function creerRoomMatch(tournoi, match, phase) {
  const roomId = crypto.randomBytes(4).toString("hex");
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
// match précis) ; qualifications = un des joueurs du match ou un arbitre.
async function lancerMatch(id, user, matchId = null) {
  const lecture = await lireTournoi(id);
  if (!lecture) throw erreur(404, "Tournoi introuvable");
  const { tournoi } = lecture;
  avancerSelonDates(tournoi);
  let trouve;
  if (tournoi.statut === "arbre") {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi lance les matchs de l'arbre.");
    if (tournoi.arbre.tours.flat().some(match => match.statut === "en_cours")) throw erreur(409, "Un match est déjà en cours : termine-le d'abord.");
    const match = matchId ? trouverMatch(tournoi, matchId)?.match : prochainMatchArbre(tournoi);
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
  const roomId = await creerRoomMatch(tournoi, trouve.match, trouve.phase);
  await modifierTournoi(id, t => {
    const { match } = trouverMatch(t, trouve.match.id);
    if (match.statut !== "pret") throw erreur(409, "Ce match vient d'être lancé.");
    match.statut = "en_cours";
    match.room_id = roomId;
  });
  return roomId;
}

// Résultat d'une manche (appelé à l'archivage d'un match de tournoi, cf.
// tempsArbitre et equipe.js) : vainqueur (participant), trophées (qualifs),
// id du match archivé. Bo3 : match terminé à 2 manches gagnées.
// -> { termine, score } pour la room.
async function enregistrerManche(infos, { vainqueur, trophees = 0, idMatch = null }) {
  return modifierTournoi(infos.id, tournoi => {
    const trouve = trouverMatch(tournoi, infos.match);
    if (!trouve) throw erreur(404, "Match du tournoi introuvable.");
    const { match, phase } = trouve;
    match.manches.push({ vainqueur, trophees, match_id: idMatch });
    const gagnees = participant => match.manches.filter(manche => manche.vainqueur === participant).length;
    const aGagner = manchesAGagner(tournoi, phase);
    const score = { [match.a]: gagnees(match.a), [match.b]: gagnees(match.b) };
    if (gagnees(vainqueur) >= aGagner) {
      match.statut = "termine";
      match.vainqueur = vainqueur;
      match.trophees = match.manches.reduce((total, manche) => total + (manche.vainqueur === vainqueur ? manche.trophees : -manche.trophees), 0);
      if (phase === "arbre") {
        propager(tournoi.arbre, match);
        const finale = tournoi.arbre.tours[tournoi.arbre.tours.length - 1][0];
        if (finale.statut === "termine") {
          tournoi.vainqueur = finale.vainqueur;
          tournoi.statut = "termine";
        }
      }
      return { termine: true, score };
    }
    return { termine: false, score };
  });
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
  return modifierTournoi(id, tournoi => {
    if (!estGestionnaire(tournoi, user.id)) throw erreur(403, "Seul le créateur du tournoi déclare un forfait.");
    const trouve = trouverMatch(tournoi, matchId);
    if (!trouve) throw erreur(404, "Match introuvable.");
    const { match, phase } = trouve;
    if (match.statut === "termine") throw erreur(409, "Ce match est terminé.");
    if (![match.a, match.b].includes(vainqueur) || !vainqueur) throw erreur(400, "Vainqueur invalide.");
    match.statut = "termine";
    match.vainqueur = vainqueur;
    match.forfait = true;
    match.trophees = phase === "qualif" ? 30 : 0;
    match.room_id = null;
    if (phase === "arbre") {
      propager(tournoi.arbre, match);
      const finale = tournoi.arbre.tours[tournoi.arbre.tours.length - 1][0];
      if (finale.statut === "termine") {
        tournoi.vainqueur = finale.vainqueur;
        tournoi.statut = "termine";
      }
    }
  });
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
  return { ...reste, nb_participants: nbParticipants(tournoi) };
}

async function vueTournoi(tournoi, user) {
  avancerSelonDates(tournoi);
  return {
    tournoi,
    joueurs: await lireJoueurs(idsCites(tournoi)),
    classement_qualifs: tournoi.qualifs ? classementQualifs(tournoi) : null,
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
        createurs: await lireJoueurs(tournois.map(t => t.createur)),
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
  estTournoitateur,
  peutCreerTournoi,
  enregistrerManche,
  tropheesManche,
  joueursDe,
  routeTournoi
};
