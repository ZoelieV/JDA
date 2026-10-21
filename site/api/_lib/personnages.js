// Charge le catalogue de personnages côté serveur (nécessaire pour calculer
// les points de box et valider les actions de draft : on ne fait jamais
// confiance à des points ou une liste de persos envoyés par le client).
//
// Hypothèse : le fichier se trouve à la racine du projet dans DB/characters.json,
// comme pour le reste du site. Le require() d'un JSON est repéré et inclus
// automatiquement par Vercel au build (pas besoin de config supplémentaire).
const personnages = require("../../DB/characters.json");
const armes = require("../../DB/weapons.json");
const bossList = require("../../DB/boss.json"); // même tableau que _lib/boss.js
const { lireSynergies, appliquerSynergie } = require("../../commun/synergies.js");

// ---- Groupes (Voyageur) ----
// Un personnage par élément dans les comptes ("traveler_pyro"...,
// champ "groupe"), chacun avec ses constellations et ses points ; un seul
// personnage (id = le groupe) en draft, dont on choisit l'élément au pick.
// Niveau commun : profil.characters.niveaux[groupe].

// Personnages dont on choisit l'élément au pick. Manekin : élément libre
// (non suivi dans les comptes).
const ELEMENTS = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];
const ELEMENTS_LIBRES = { manekin: ELEMENTS };

// ---- Personnages et armes masqués par les administrateurs (config.masques,
// cf. api/points.js) : pas encore sortis dans le jeu, absents de tout le site
// (points des box, draft...) sauf de la page admin ----
let masques = { characters: new Set(), weapons: new Set() };

// ---- Points d'un personnage chez un joueur ----
// PPC : C0..C6, puis bonus niveau 95, niveau 100 et théâtre. Aux points de
// constellation s'appliquent le bonus du niveau renseigné par le joueur (95
// ou 100, profil.characters.niveaux[groupe || id]), puis le bonus théâtre si
// le personnage est buffé ce mois-ci (config.theatre) ; chacun ajouté ou
// multiplié selon config.modes, en multiplication 0 = pas de bonus. Résultat
// arrondi. Même calcul que pointsPersonnage (commun/cartes.js).
let modesBonus = {};
let buffsTheatre = new Set();
// Bonus de saison (config.bonus_saison, page admin) : trophées en classé.
let bonusSaison = new Set();
// Boss du carnage désactivés (config.carnage_desactive, page admin) : plus
// disponibles dans le jeu, jamais tirés hors entraînement (cf. _lib/boss.js).
let carnageDesactive = false;
// Mode Random world boss ouvert à tous (config.world_boss_public, page
// admin) ; sinon réservé aux administrateurs (cf. _lib/world_boss.js).
let worldBossPublic = false;

function estCarnageDesactive() {
  return carnageDesactive;
}

function estWorldBossPublic() {
  return worldBossPublic;
}

// Méthode des bans d'équilibrage (config.equilibrage, choisie par un
// administrateur sur la page admin) : figée dans chaque draft au calcul de
// l'équilibrage (cf. calculerEquilibrage, _lib/boxes.js), une draft en cours
// ne change donc pas de méthode.
//   ancien     : ⌊ écart / SEUIL_EQUILIBRAGE ⌋ bans, nombre imposé ;
//   fixe_joker : nombre de bans calculé d'après les 2 box (verticalité),
//                plus un ban joker si les bans ne suffisent pas (cf.
//                calculerEquilibrageFixe, _lib/draft.js) ;
//   fixe_horizontal : fixe_joker, puis des bans horizontaux sur les persos
//                jamais entrés dans le top 12 (cf. calculerBansHorizontaux,
//                _lib/draft.js ; seuil : getSeuilHorizontal).
// Dans les 2 cas, celui qui bannit peut échanger 5 bans contre un joker
// (cf. echangerBansContreJoker, _lib/draft.js). Ancienne méthode
// enregistrée qui n'existe plus : "ancien".
const MODES_EQUILIBRAGE = ["ancien", "fixe_joker", "fixe_horizontal"];
// Valeurs alternatives permises pour les armes (% des points, cf.
// api/points.js) ; 100 = aucune réduction.
const ALTERNATIVES_ARMES = [0, 25, 50, 75, 100];
let modeEquilibrage = "ancien";

function getModeEquilibrage() {
  return modeEquilibrage;
}

// Points d'écart entre les sommes horizontales par ban horizontal
// ("fixe_horizontal"), réglable sur la page admin (config.seuil_horizontal).
const SEUIL_HORIZONTAL_DEFAUT = 200;
let seuilHorizontal = SEUIL_HORIZONTAL_DEFAUT;

function lireSeuilHorizontal(brut) {
  const valeur = Math.round(Number(brut));
  return Number.isFinite(valeur) && valeur >= 1 ? valeur : SEUIL_HORIZONTAL_DEFAUT;
}

function getSeuilHorizontal() {
  return seuilHorizontal;
}

// Limites de l'équilibrage calculé ("fixe_joker", cf. calculerEquilibrageFixe
// dans _lib/draft.js), par palier de théâtre de la draft (1 sardine ... 4
// baleine), réglables sur la page admin (config.limites_equilibrage) :
//   min_persos : nombre de persos sous lequel aucune box ne descend ;
//   seuil_bas  : top 12 du petit joueur à ne pas franchir (et "petit compte"
//                sous ce seuil) ;
//   seuil_haut : top 12 du gros joueur au-dessus duquel le petit compte a
//                droit au joker dès un ban qui le touche ;
//   plancher   : petit compte face à un gros joueur entre seuil_bas et
//                seuil_haut : top 12 des 2 joueurs à garder au-dessus ;
//   points_max_box : points max d'une box jouable hors full box (opti,
//                personnalisée) dans une draft de ce palier (toutes
//                méthodes ; cf. erreurPointsBox dans _lib/boxes.js).
const CHAMPS_LIMITES = ["min_persos", "seuil_bas", "seuil_haut", "plancher", "points_max_box"];
const LIMITES_EQUILIBRAGE_DEFAUT = {
  1: { min_persos: 14, seuil_bas: 1000, seuil_haut: 1500, plancher: 850, points_max_box: 3000 },
  2: { min_persos: 16, seuil_bas: 1000, seuil_haut: 1500, plancher: 850, points_max_box: 5000 },
  3: { min_persos: 18, seuil_bas: 1000, seuil_haut: 1500, plancher: 850, points_max_box: 7000 },
  4: { min_persos: 20, seuil_bas: 1000, seuil_haut: 1500, plancher: 850, points_max_box: 9000 }
};
let limitesEquilibrage = LIMITES_EQUILIBRAGE_DEFAUT;

// Limites d'un palier (enregistrées par les admins, valeurs par défaut sinon).
function lireLimitesEquilibrage(brutes) {
  return Object.fromEntries(Object.entries(LIMITES_EQUILIBRAGE_DEFAUT).map(([palier, defaut]) => [
    palier,
    Object.fromEntries(CHAMPS_LIMITES.map(champ => {
      const valeur = Number(brutes?.[palier]?.[champ]);
      return [champ, Number.isFinite(valeur) && valeur >= 0 ? Math.round(valeur) : defaut[champ]];
    }))
  ]));
}

function getLimitesEquilibrage(palier) {
  return limitesEquilibrage[palier] || limitesEquilibrage[2];
}

// Points max d'une box jouable hors full box dans une draft de ce palier
// (limites_equilibrage[palier].points_max_box ; cf. erreurPointsBox dans
// _lib/boxes.js).
function getPointsMaxBox(palier) {
  return getLimitesEquilibrage(palier).points_max_box;
}

function appliquerBonus(points, cle, valeur) {
  const bonus = Number(valeur ?? 0);
  if (modesBonus[cle] === "multiplication") return bonus ? points * bonus : points;
  return points + bonus;
}

function pointsPersonnage(perso, constellation, niveau = null) {
  let points = Number(perso.PPC?.[constellation] ?? 0);
  if (Number(niveau) === 95) points = appliquerBonus(points, "niveau95", perso.PPC?.[7]);
  if (Number(niveau) === 100) points = appliquerBonus(points, "niveau100", perso.PPC?.[8]);
  if (buffsTheatre.has(perso.id)) points = appliquerBonus(points, "theatre", perso.PPC?.[9]);
  return Math.round(points);
}

// Synergies réglées par les admins (config.synergies, cf.
// commun/synergies.js).
let synergies = {};

function getSynergies() {
  return synergies;
}

// Points d'un perso dans une box : malus de synergie compris (presents :
// Set des ids de la draft des persos de cette box).
function pointsPersonnageBox(perso, constellation, niveau, presents) {
  return appliquerSynergie(pointsPersonnage(perso, constellation, niveau), synergies, perso, presents);
}

// Personnages visibles (sans les masqués) : ce que voient les calculs de
// points et la draft.
function getPersonnages() {
  return personnages.filter(p => !masques.characters.has(p.id));
}

function getArmes() {
  return armes.filter(a => !masques.weapons.has(a.id));
}

// Listes complètes, masqués compris (validation des ids de la page admin).
function getCatalogueComplet(genre) {
  if (genre === "characters") return personnages;
  if (genre === "weapons") return armes;
  return bossList;
}

// ---- Points modifiés par les administrateurs (table Supabase "points",
// cf. api/points.js), appliqués par-dessus les JSON ----
// PPC : C0..C6, puis niveau 95, niveau 100 et théâtre, chacun ajouté ou
// multiplié aux points de constellation selon le mode choisi par les admins.
const MODES_POINTS = { niveau95: 7, niveau100: 8, theatre: 9 };

// Personnages, armes et boss ajoutés par les administrateurs (config.ajouts,
// cf. api/points.js) : ajoutés aux listes des JSON, retirés s'ils ont été
// supprimés depuis. Les listes sont modifiées sur place (partagées avec les
// autres modules).
const idsAjoutes = { characters: new Set(), weapons: new Set(), boss: new Set() };

function fusionnerAjouts(liste, ajouts, genre) {
  const nouveaux = (Array.isArray(ajouts) ? ajouts : []).filter(e => e && typeof e.id === "string");
  const idsNouveaux = new Set(nouveaux.map(e => e.id));
  for (let i = liste.length - 1; i >= 0; i--) {
    if (idsAjoutes[genre].has(liste[i].id) && !idsNouveaux.has(liste[i].id)) liste.splice(i, 1);
  }
  nouveaux.forEach(entree => {
    const index = liste.findIndex(e => e.id === entree.id);
    if (index === -1) liste.push({ ...entree });
    else if (idsAjoutes[genre].has(entree.id)) liste[index] = { ...entree };
  });
  idsAjoutes[genre] = idsNouveaux;
}

// Entrée ajoutée par les admins (pas dans le JSON d'origine).
function estAjout(genre, id) {
  return idsAjoutes[genre].has(id);
}

// Relue au plus toutes les 30 s (les points changent rarement).
const DUREE_CACHE_POINTS_MS = 30 * 1000;
let pointsLusA = 0;

// Koyns (cf. _lib/koyns.js) : cosmétiques exclusifs (pas en vente, gagnés
// aux classements ou aux événements) et bonus de connexion d'événement.
let configKoyns = { exclusifs: new Set(), bonusConnexion: null };

function getConfigKoyns() {
  return configKoyns;
}

async function actualiserPoints() {
  if (Date.now() - pointsLusA < DUREE_CACHE_POINTS_MS) return;
  try {
    const { supabase } = require("./supabase");
    const { data, error } = await supabase.from("points").select("data").eq("id", "config").maybeSingle();
    if (error) throw error;
    const config = data?.data || {};
    fusionnerAjouts(personnages, config.ajouts?.characters, "characters");
    fusionnerAjouts(armes, config.ajouts?.weapons, "weapons");
    fusionnerAjouts(bossList, config.ajouts?.boss, "boss");
    masques = {
      characters: new Set(Array.isArray(config.masques?.characters) ? config.masques.characters : []),
      weapons: new Set(Array.isArray(config.masques?.weapons) ? config.masques.weapons : [])
    };
    buffsTheatre = new Set(Array.isArray(config.theatre) ? config.theatre : []);
    bonusSaison = new Set(Array.isArray(config.bonus_saison) ? config.bonus_saison : []);
    carnageDesactive = config.carnage_desactive === true;
    worldBossPublic = config.world_boss_public === true;
    modeEquilibrage = MODES_EQUILIBRAGE.includes(config.equilibrage) ? config.equilibrage : "ancien";
    limitesEquilibrage = lireLimitesEquilibrage(config.limites_equilibrage);
    seuilHorizontal = lireSeuilHorizontal(config.seuil_horizontal);
    synergies = lireSynergies(config.synergies);
    modesBonus = config.modes || {};
    configKoyns = {
      exclusifs: new Set(Array.isArray(config.cosmetiques_exclusifs) ? config.cosmetiques_exclusifs : []),
      bonusConnexion: config.bonus_connexion || null
    };
    personnagesDraft = null;
    // Nom et résistances des boss modifiés par les admins (config.boss).
    bossList.forEach(b => {
      const modif = config.boss?.[b.id];
      if (typeof modif?.nom === "string") b.nom = modif.nom;
      if (Array.isArray(modif?.res)) b.res = modif.res;
    });
    personnages.forEach(p => {
      if (Array.isArray(config.characters?.[p.id])) p.PPC = config.characters[p.id];
    });
    armes.forEach(a => {
      if (Array.isArray(config.weapons?.[a.id])) a.PPW = config.weapons[a.id];
      // Valeur alternative (% : copies en double, signature sans son perso,
      // cf. calculerPointsArmesBox dans _lib/draft.js).
      a.alternatif = ALTERNATIVES_ARMES.includes(config.alternatives_armes?.[a.id]) ? config.alternatives_armes[a.id] : 100;
      if (Array.isArray(config.categoriesArmes?.[a.id])) a.categories = config.categoriesArmes[a.id];
    });
    pointsLusA = Date.now();
  } catch (erreur) {
    // Pas bloquant : on garde les points des JSON.
    console.error("Erreur lecture des points admin :", erreur);
  }
}

function getPersonnageParId(id) {
  return personnages.find(p => p.id === id) || null;
}

function getTousLesIds() {
  return personnages.map(p => p.id);
}

// Catalogue de la draft : chaque groupe réduit à un seul personnage.
let personnagesDraft = null;

function getPersonnagesDraft() {
  if (!personnagesDraft) {
    const vus = new Set();
    personnagesDraft = [];
    getPersonnages().forEach(p => {
      if (!p.groupe) {
        personnagesDraft.push(p);
      } else if (!vus.has(p.groupe)) {
        vus.add(p.groupe);
        personnagesDraft.push({ ...p, id: p.groupe, element: "all", groupe: undefined });
      }
    });
  }
  return personnagesDraft;
}

function getPersonnageDraftParId(id) {
  return getPersonnagesDraft().find(p => p.id === id) || null;
}

function estGroupe(id) {
  return personnages.some(p => p.groupe === id);
}

// Ancien format : un seul "traveler" (avant la séparation par élément).
// Sa constellation et ses sélections passent au Voyageur Anemo ; son niveau
// reste sous "traveler" (niveau commun du groupe).
function migrerCollectionPersos(collection) {
  if (!collection?.full || collection.full.traveler === undefined) return collection;

  const full = { ...collection.full };
  if (full.traveler_anemo === undefined) full.traveler_anemo = full.traveler;
  delete full.traveler;

  const selections = {};
  Object.entries(collection.selections || {}).forEach(([box, selection]) => {
    selections[box] = { ...selection };
    if (selections[box].traveler) {
      selections[box].traveler_anemo = true;
      delete selections[box].traveler;
    }
  });

  return { ...collection, full, selections };
}

// ---- Infos d'un personnage chez un joueur (historique des matchs) ----
// Constellation (Voyageur : de l'élément donné, sinon du meilleur),
// niveau 95 / 100 et meilleur raffinement de son arme signature (image
// "[id]_w.webp", copies "idArme#2"... comprises). null si inconnu.
function infosPersoJoueur(profilData, persoId, element = null) {
  const collection = migrerCollectionPersos(profilData?.characters) || {};
  const full = collection.full || {};
  const membres = personnages.filter(p => p.groupe === persoId);

  let constellation = null;
  const valeurs = membres.length
    ? membres.filter(p => !element || p.element === element).map(p => full[p.id])
    : [full[persoId]];
  valeurs.forEach(c => {
    if (typeof c === "number" && c >= 0 && (constellation === null || c > constellation)) constellation = c;
  });

  const niveau = collection.niveaux?.[persoId];

  const arme = armes.find(a => typeof a.image === "string" && a.image.endsWith(`/${persoId}_w.webp`));
  let raffinement = null;
  if (arme) {
    Object.entries(profilData?.weapons?.full || {}).forEach(([cle, valeur]) => {
      if ((cle === arme.id || cle.startsWith(`${arme.id}#`)) && valeur >= 0 && (raffinement === null || valeur > raffinement)) {
        raffinement = valeur;
      }
    });
  }

  return {
    constellation,
    niveau: niveau === 95 || niveau === 100 ? niveau : null,
    raffinement
  };
}

// Pick avec bonus de saison : id coché dans l'admin ; Voyageur (groupe) :
// sa version de l'élément joué ("traveler" + "pyro" -> "traveler_pyro").
function aBonusSaison(persoId, element = null) {
  return bonusSaison.has(persoId) || (!!element && bonusSaison.has(`${persoId}_${element}`));
}

// ---- Palier de théâtre d'un compte (calculé, plus choisi par le joueur) ----
// Cost de la full box : pour chaque 5★ limité (ni standard, ni Voyageur),
// 1 par constellation possédée (C0 comprise) qui vaut au moins SEUIL_COST
// points (PPC brut, sans bonus de niveau ni buff du théâtre). Ex. : 41 pts
// en C0 -> C6 = 7 ; 39 en C0 et 40+ dès la C1 -> C6 = 6. Palier : 0 à 15 -> 1 (sardine), 16 à 35 -> 2 (carpe), 36 à 55
// -> 3 (dauphin), 56 ou plus -> 4 (baleine). Sert au mode Auto des drafts
// (draft du plus petit palier, cf. PALIERS_THEATRE dans _lib/draft.js) et
// à la médaille à côté du pseudo. Même calcul côté client :
// palierTheatreProfil (commun/cartes.js). Valeur stockée dans le profil :
// le palier en texte ("1".."4"). Dépend des points : actualiserPoints avant.
const SEUILS_THEATRE = [[56, 4], [36, 3], [16, 2]];
const SEUIL_COST = 40;

function estLimite5(personnage) {
  return String(personnage?.rarete) === "5" && !personnage.standard && !personnage.groupe;
}

function costPersonnage(personnage, constellation) {
  let cost = 0;
  for (let c = 0; c <= constellation; c++) {
    if (Number(personnage.PPC?.[c] ?? 0) >= SEUIL_COST) cost++;
  }
  return cost;
}

function costBox(profilData) {
  const full = migrerCollectionPersos(profilData?.characters)?.full || {};
  return getPersonnages().filter(estLimite5).reduce((total, personnage) => {
    const constellation = full[personnage.id];
    return Number.isInteger(constellation) && constellation >= 0 ? total + costPersonnage(personnage, constellation) : total;
  }, 0);
}

function palierTheatre(profilData) {
  const cost = costBox(profilData);
  return SEUILS_THEATRE.find(([seuil]) => cost >= seuil)?.[1] ?? 1;
}

function codeTheatre(profilData) {
  return String(palierTheatre(profilData));
}

module.exports = {
  getConfigKoyns,
  MODES_EQUILIBRAGE,
  LIMITES_EQUILIBRAGE_DEFAUT,
  lireLimitesEquilibrage,
  getLimitesEquilibrage,
  getPointsMaxBox,
  ALTERNATIVES_ARMES,
  MODES_POINTS,
  getModeEquilibrage,
  lireSeuilHorizontal,
  getSeuilHorizontal,
  codeTheatre,
  costBox,
  palierTheatre,
  aBonusSaison,
  actualiserPoints,
  estAjout,
  estCarnageDesactive,
  estWorldBossPublic,
  getArmes,
  getCatalogueComplet,
  infosPersoJoueur,
  pointsPersonnage,
  pointsPersonnageBox,
  getSynergies,
  ELEMENTS,
  ELEMENTS_LIBRES,
  getPersonnages,
  getPersonnageParId,
  getTousLesIds,
  getPersonnagesDraft,
  getPersonnageDraftParId,
  estGroupe,
  migrerCollectionPersos
};
