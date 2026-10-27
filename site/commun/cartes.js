// Outils communs aux pages qui affichent des cartes de personnages / armes
// (Mon compte, Tous les comptes, draft) : chargement des données, fond de
// rareté, arme signature, grille et recyclage des cartes.

const RACINE_DB = "../DB/";

// ---- Chargement des JSON de DB/ ----
// Revalidés à chaque chargement de page (réponse "pas modifié" si rien n'a
// changé, cf. vercel.json), puis gardés en mémoire pour la page.
const cacheJSON = new Map();

function chargerJSON(chemin) {
  if (!cacheJSON.has(chemin)) {
    const promesse = fetch(RACINE_DB + chemin, { cache: "no-cache" })
      .then(reponse => {
        if (!reponse.ok) throw new Error(`Impossible de charger DB/${chemin}`);
        return reponse.json();
      })
      .catch(erreur => {
        cacheJSON.delete(chemin);
        throw erreur;
      });
    cacheJSON.set(chemin, promesse);
  }
  return cacheJSON.get(chemin);
}

// Points modifiés par les administrateurs (api/points.js), appliqués
// par-dessus les JSON : PPC des personnages, PPW des armes.
let promessePointsAdmin = null;

function chargerPointsAdmin() {
  promessePointsAdmin ??= fetch("/api/points", { cache: "no-cache" })
    .then(reponse => (reponse.ok ? reponse.json() : {}))
    .catch(() => ({}));
  return promessePointsAdmin;
}

// Points max d'une box jouable hors full box, par palier de la draft (réglé
// sur la page admin, cf. erreurPointsBox dans api/_lib/boxes.js) : lu avec
// les armes (chargerArmes).
const pointsMaxBoxParPalier = { 1: 3000, 2: 5000, 3: 7000, 4: 9000 };

function pointsMaxBox(palier) {
  return pointsMaxBoxParPalier[palier] ?? pointsMaxBoxParPalier[2];
}

function appliquerPointsAdmin(liste, points, champ) {
  liste.forEach(item => {
    if (Array.isArray(points?.[item.id])) item[champ] = points[item.id];
  });
  return liste;
}

// Personnages, armes et boss ajoutés par les administrateurs : ajoutés à la
// fin des listes des JSON (une seule fois, la liste est gardée en mémoire).
function fusionnerAjouts(liste, ajouts) {
  const ids = new Set(liste.map(item => item.id));
  (Array.isArray(ajouts) ? ajouts : []).forEach(entree => {
    if (entree?.id && !ids.has(entree.id)) {
      liste.push({ ...entree, ajout: true });
      ids.add(entree.id);
    }
  });
  return liste;
}

// Personnages et armes masqués par les administrateurs (pas encore sortis
// dans le jeu) : retirés partout, sauf pour la page admin (avecMasques).
function retirerMasques(liste, masques) {
  const caches = new Set(Array.isArray(masques) ? masques : []);
  return caches.size ? liste.filter(item => !caches.has(item.id)) : liste;
}

// Résistances qui changent chaque semaine ("res_par_semaine" dans
// DB/boss.json, ex. Azhdaha : éléments absorbés selon une rotation fixe) :
// res[0] la semaine qui commence à "debut" (lundi, reset à 4 h heure du
// serveur Europe), puis une par semaine, en boucle. Appliquées avant les
// modifs des administrateurs, qui restent prioritaires.
const DUREE_SEMAINE_MS = 7 * 24 * 3600 * 1000;

function appliquerResSemaine(liste, maintenant = Date.now()) {
  liste.forEach(boss => {
    const rotation = boss.res_par_semaine;
    const debut = Date.parse(rotation?.debut);
    if (!Array.isArray(rotation?.res) || !rotation.res.length || !Number.isFinite(debut)) return;
    const n = rotation.res.length;
    const semaine = Math.floor((maintenant - debut) / DUREE_SEMAINE_MS);
    boss.res = rotation.res[((semaine % n) + n) % n];
  });
  return liste;
}

// Nom, résistances, début du chrono et recommandations (cf.
// commun/recommandations_boss.js) des boss modifiés par les
// administrateurs.
function appliquerModifsBoss(liste, modifs) {
  liste.forEach(boss => {
    const modif = modifs?.[boss.id];
    if (typeof modif?.nom === "string") boss.nom = modif.nom;
    if (Array.isArray(modif?.res)) boss.res = modif.res;
    if (modif && "chrono" in modif) boss.chrono = MOMENTS_CHRONO[modif.chrono] ? modif.chrono : null;
    if (modif && "reco" in modif) boss.reco = modif.reco || null;
  });
  return liste;
}

// ---- Début du chrono d'un boss (boss.chrono, choisi dans la fenêtre Boss
// de la page admin) : bouton "Chrono" au-dessus de "Localisation" en fin de
// draft (saisie des temps). Pas de moment choisi : pas de bouton. ----
const MOMENTS_CHRONO = {
  message: { libelle: "Fin du message", phrase: "Lance le chrono à la fin du message." },
  premier_pas: { libelle: "Premier pas", phrase: "Lance le chrono à ton premier pas." },
  barre_vie: { libelle: "Apparition de la barre de vie", phrase: "Lance le chrono à l'apparition de la barre de vie." }
};

// Bouton et sa bulle (cachée, cf. basculerChrono), ou "".
function htmlBoutonChrono(boss) {
  const moment = MOMENTS_CHRONO[boss?.chrono];
  if (!moment) return "";
  return `<button type="button" class="btn-chrono" title="Comment chronométrer" aria-expanded="false">⏱️ Chrono</button>
    <span class="bulle-chrono cache">${moment.phrase}</span>`;
}

// Clic sur le bouton Chrono : affiche ou cache sa bulle.
function basculerChrono(bouton) {
  const bulle = bouton.nextElementSibling;
  const ouvert = bulle.classList.toggle("cache") === false;
  bouton.setAttribute("aria-expanded", String(ouvert));
}

// ---- Points d'un personnage chez un joueur ----
// PPC : C0..C6, puis bonus niveau 95, niveau 100 et théâtre. Aux points de
// constellation s'appliquent le bonus du niveau renseigné par le joueur (95
// ou 100, profil.characters.niveaux[cleNiveau]), puis le bonus théâtre si le
// personnage est buffé ce mois-ci (config.theatre) ; chacun ajouté ou
// multiplié selon le mode choisi par les administrateurs (config.modes), en
// multiplication 0 = pas de bonus. Résultat arrondi. Même calcul côté
// serveur (pointsPersonnage, api/_lib/personnages.js).
let modesBonus = {};

function appliquerBonus(points, cle, valeur) {
  const bonus = Number(valeur ?? 0);
  if (modesBonus[cle] === "multiplication") return bonus ? points * bonus : points;
  return points + bonus;
}

function pointsPersonnage(perso, constellation, niveau = null) {
  let points = Number(perso.PPC?.[constellation] ?? 0);
  if (Number(niveau) === 95) points = appliquerBonus(points, "niveau95", perso.PPC?.[7]);
  if (Number(niveau) === 100) points = appliquerBonus(points, "niveau100", perso.PPC?.[8]);
  if (perso.buffTheatre) points = appliquerBonus(points, "theatre", perso.PPC?.[9]);
  return Math.round(points);
}

// ---- Synergies : valeur alternative d'un perso dans une box (cf.
// commun/synergies.js, config.synergies) ----
let synergiesPersos = {};

// Ids de la draft (Voyageur : "traveler") des persos possédés d'une box.
function idsDraftCollection(collectionPersos, personnages, box) {
  const ids = new Set();
  personnages.forEach(p => {
    const constellation = collectionPersos?.full?.[p.id];
    if (typeof constellation !== "number" || constellation < 0) return;
    if (box !== "full" && !collectionPersos.selections?.[box]?.[p.id]) return;
    ids.add(p.groupe || p.id);
  });
  return ids;
}

// Points d'un perso dans une box (presents : cf. idsDraftCollection), malus
// de synergie compris. Même calcul côté serveur (pointsPersonnageBox,
// api/_lib/personnages.js).
function pointsPersonnageBox(perso, constellation, niveau, presents) {
  return appliquerSynergie(pointsPersonnage(perso, constellation, niveau), synergiesPersos, perso, presents);
}

// Personnages buffés par le théâtre du mois : copie marquée buffTheatre (la
// liste en mémoire reste celle des JSON).
function marquerBuffTheatre(liste, buffes) {
  const ids = new Set(Array.isArray(buffes) ? buffes : []);
  return ids.size ? liste.map(perso => ids.has(perso.id) ? { ...perso, buffTheatre: true } : perso) : liste;
}

// Personnages au bonus de saison (config.bonus_saison, trophées en classé) :
// copie marquée bonusSaison.
function marquerBonusSaison(liste, ids) {
  const set = new Set(Array.isArray(ids) ? ids : []);
  return set.size ? liste.map(perso => set.has(perso.id) ? { ...perso, bonusSaison: true } : perso) : liste;
}

// Catalogue chargé (sans les masqués) : palier de théâtre des comptes (cf.
// palierTheatreProfil).
let catalogueTheatre = null;

// avecMasques (page admin) : masqués compris, sans buff théâtre.
const chargerPersonnages = (avecMasques = false) => Promise.all([chargerJSON("characters.json"), chargerPointsAdmin()])
  .then(([liste, points]) => {
    appliquerPointsAdmin(fusionnerAjouts(liste, points.ajouts?.characters), points.characters, "PPC");
    modesBonus = points.modes || {};
    synergiesPersos = lireSynergies(points.synergies);
    // Faction (lunar, hexerei, stellar ; cf. FACTIONS, commun/tri.js).
    liste.forEach(perso => { perso.faction = points.factions?.[perso.id] || null; });
    if (avecMasques) return liste;
    catalogueTheatre = retirerMasques(liste, points.masques?.characters);
    return marquerBonusSaison(marquerBuffTheatre(catalogueTheatre, points.theatre), points.bonus_saison);
  });
const chargerArmes = (avecMasques = false) => Promise.all([chargerJSON("weapons.json"), chargerPointsAdmin()])
  .then(([liste, points]) => {
    appliquerPointsAdmin(fusionnerAjouts(liste, points.ajouts?.weapons), points.weapons, "PPW");
    Object.keys(pointsMaxBoxParPalier).forEach(palier => {
      const max = Number(points.limites_equilibrage?.[palier]?.points_max_box);
      if (max > 0) pointsMaxBoxParPalier[palier] = max;
    });
    // Valeur alternative (copies en double, signature sans son perso).
    liste.forEach(arme => { arme.alternatif = ALTERNATIVES_ARMES.includes(points.alternatives_armes?.[arme.id]) ? points.alternatives_armes[arme.id] : 100; });
    // Catégories (support, standard) modifiées par les administrateurs.
    appliquerPointsAdmin(liste, points.categoriesArmes, "categories");
    return avecMasques ? liste : retirerMasques(liste, points.masques?.weapons);
  });
const chargerBoss = () => Promise.all([chargerJSON("boss.json"), chargerPointsAdmin()])
  .then(([liste, points]) => appliquerModifsBoss(appliquerResSemaine(fusionnerAjouts(liste, points.ajouts?.boss)), points.boss));

// Icônes dans le texte (à la place des emojis 🏆 et 🎯), cf. .icone-texte
// (commun/entete.css).
const ICONE_TROPHEE = `<img class="icone-texte" src="/DB/images/others/Achievement_Wonders_of_the_World.webp" alt="trophées">`;
const ICONE_ENTRAINEMENT = `<img class="icone-texte" src="/DB/images/others/Icon_Training_Guide.webp" alt="">`;

// Image(s) d'un boss : une légende locale à 2 boss (Griffe de fer et Chèvre
// de bataille, boss.images) a ses 2 images côte à côte.
// attributs : texte ajouté à chaque <img> (classe, loading...).
function htmlImagesBoss(boss, attributs = "") {
  const images = Array.isArray(boss?.images) && boss.images.length ? boss.images : [boss?.image];
  const html = images.map(image => `<img src="../DB/${image}" alt="${boss.nom}"${attributs ? ` ${attributs}` : ""}>`).join("");
  return images.length > 1 ? `<span class="duo-boss">${html}</span>` : html;
}

// Résistance d'un boss (en %) : 999 ou plus = immunisé à cet élément,
// affiché "Immunisé" au lieu d'un pourcentage (draft, Theorycraft, admin).
const RES_IMMUNITE = 999;

function estImmunise(valeur) {
  return Number(valeur) >= RES_IMMUNITE;
}

function texteResistance(valeur, separateur = " ") {
  return estImmunise(valeur) ? "Immunisé" : `${Number(valeur)}${separateur}%`;
}

// Légende locale (une fois par jour ou à l'infini, cf. api/_lib/boss.js).
function estLegendeLocale(boss) {
  return boss?.type === "legende_locale_jour" || boss?.type === "legende_locale_infinie";
}

// Défi ("score": "ennemis" dans DB/boss.json, cf. api/_lib/boss.js) : salle
// de 2 minutes, nombre d'ennemis tués saisi à la place d'un temps, le plus
// grand gagne.
function estDefiEnnemis(boss) {
  return boss?.score === "ennemis";
}

// ---- Palier de théâtre d'un compte et médaille à côté du pseudo ----
// Calculé, plus choisi par le joueur (même calcul que palierTheatre,
// api/_lib/personnages.js) : cost de la full box (5★ limités, ni standards
// ni Voyageur : 1 par constellation possédée qui vaut au moins SEUIL_COST
// points) ; 0 à
// 15 -> 1 (sardine), 16 à 35 -> 2 (carpe), 36 à 55 -> 3 (dauphin), 56 ou
// plus -> 4 (baleine). Sert au mode Auto des drafts
// et à la médaille. profil.theatre garde le palier calculé par le serveur
// ("1".."4"), utilisé sans catalogue chargé. Hauteur de la médaille : 1,3 x
// le texte (cf. cartes.css).
// PALIERS_THEATRE : nom, mode de room (cf. MODES_THEATRE, api/_lib/draft.js),
// bans par joueur avant / après les 2 premiers picks et médaille (numéro de
// l'ancien théâtre, icône du palier : cf. urlMedailleTheatre). Anciens matchs de l'historique : théâtre
// 6, 8, 10 ou 12 (cf. infosTheatreJoue).
const PALIERS_THEATRE = {
  1: { nom: "Sardine", mode: "sardine", bans: [2, 1], medaille: 6 },
  2: { nom: "Carpe", mode: "carpe", bans: [2, 2], medaille: 8 },
  3: { nom: "Dauphin", mode: "dauphin", bans: [3, 2], medaille: 10 },
  4: { nom: "Baleine", mode: "baleine", bans: [3, 3], medaille: 12 }
};
const SEUILS_THEATRE = [[56, 4], [36, 3], [16, 2]];
const SEUIL_COST = 40;
// Draft de la mêlée générale (mode "12"), du carnage et du mode en équipe.
const THEATRE_CARPE = 2;

// Icône d'un palier (sardine, carpe, dauphin, baleine) depuis le numéro de
// médaille (ancien théâtre 6, 8, 10, 12).
const ICONES_PALIERS_THEATRE = { 6: "sardine", 8: "carpe", 10: "dauphin", 12: "baleine" };

function urlMedailleTheatre(numero) {
  // ?v= : à augmenter quand une icône change (images en cache 1 jour).
  return `/DB/images/others/theatre_${ICONES_PALIERS_THEATRE[numero]}.webp?v=3`;
}

// Théâtre joué d'un match ou d'une draft : palier actuel (1..4) ou ancien
// théâtre (6, 8, 10, 12 : 4 picks et 1 à 4 bans) -> { nom, bans, medaille }
// (bans : total par joueur), ou null.
function infosTheatreJoue(theatre) {
  const palier = PALIERS_THEATRE[theatre];
  if (palier) return { nom: palier.nom, bans: palier.bans[0] + palier.bans[1], medaille: palier.medaille };
  const ancien = Number(theatre);
  return [6, 8, 10, 12].includes(ancien) ? { nom: `Théâtre ${ancien}`, bans: ancien / 2 - 2, medaille: ancien } : null;
}

function costBox(profilData, personnages = catalogueTheatre) {
  if (typeof migrerCollectionPersos === "function") migrerCollectionPersos(profilData?.characters);
  const full = profilData?.characters?.full || {};
  return (personnages || []).filter(p => String(p.rarete) === "5" && !p.standard && !p.groupe).reduce((total, p) => {
    const constellation = full[p.id];
    if (!Number.isInteger(constellation) || constellation < 0) return total;
    for (let c = 0; c <= constellation; c++) {
      if (Number(p.PPC?.[c] ?? 0) >= SEUIL_COST) total++;
    }
    return total;
  }, 0);
}

function palierTheatreProfil(profilData, personnages = catalogueTheatre) {
  if (!profilData) return null;
  if (!personnages) return PALIERS_THEATRE[profilData.theatre] ? Number(profilData.theatre) : null;
  const cost = costBox(profilData, personnages);
  return SEUILS_THEATRE.find(([seuil]) => cost >= seuil)?.[1] ?? 1;
}

// Lien de stream : uniquement une page Twitch ou YouTube (pour ne jamais
// envoyer un joueur sur un site malveillant). Domaine exact (pas
// "twitch.tv.exemple.com" ni "exemple.com/twitch.tv"), https, sans
// identifiants ni port ("https://twitch.tv@exemple.com" refusé), ancre
// retirée ; "twitch.tv/pseudo" -> "https://twitch.tv/pseudo".
// -> lien nettoyé, "" si vide, null si refusé.
const HOTES_STREAM = new Set(["twitch.tv", "www.twitch.tv", "m.twitch.tv", "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const LONGUEUR_LIEN_STREAM = 300;

function lienStreamAutorise(texte) {
  if (typeof texte !== "string") return null;
  let lien = texte.trim();
  if (!lien) return "";
  if (lien.length > LONGUEUR_LIEN_STREAM) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(lien)) lien = `https://${lien}`;
  let url;
  try {
    url = new URL(lien);
  } catch {
    return null;
  }
  const hote = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !HOTES_STREAM.has(hote)) {
    return null;
  }
  return `https://${hote}${url.pathname}${url.search}`;
}

// Pseudo Discord inséré dans du HTML : échappé (un pseudo peut contenir
// "<", "&"...) et dans la police des pseudos (classe .pseudo, cf.
// commun/entete.css).
function echapperHtml(texte) {
  return String(texte).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function htmlPseudo(nom) {
  return `<span class="pseudo">${echapperHtml(nom)}</span>`;
}

// Rang du classé selon les trophées de la saison (Bronze 3 ... Archon, cf.
// rangTrophees dans commun/fond.js), à côté de la médaille du théâtre ; ""
// sans trophées (aucun match classé) ou sans commun/fond.js.
function htmlRangTrophees(trophees) {
  return window.FondEcran?.creerRang?.(trophees)?.outerHTML || "";
}

function htmlMedailleTheatre(palier) {
  const infos = PALIERS_THEATRE[palier];
  if (!infos) return "";
  return `<img class="medaille-theatre" src="${urlMedailleTheatre(infos.medaille)}" alt="${infos.nom}" title="${infos.nom}">`;
}

// ---- Fond de carte selon la rareté (classes de commun/cartes.css) ----
function classeFondRarete(rarete) {
  const valeur = String(rarete);
  if (valeur === "5") return "fond-5";
  if (valeur === "3") return "fond-3";
  return "fond-4";
}

// ---- Arme signature ----
// Image nommée "[cle]_w.webp", cle = id du personnage (ou de son groupe :
// arme commune à tous les éléments du Voyageur).

const ICONES_ARMES_SIGNATURE = {
  sword: `${RACINE_DB}images/others/sword_icon.webp`,
  claymore: `${RACINE_DB}images/others/claymore_icon.webp`,
  polearm: `${RACINE_DB}images/others/polearm_icon.webp`,
  bow: `${RACINE_DB}images/others/bow_icon.webp`,
  catalyst: `${RACINE_DB}images/others/catalyst_icon.webp`
};

function getCleSignature(personnage) {
  return personnage.groupe || personnage.id;
}

// Index construit une seule fois par liste d'armes : cle perso -> arme et
// id arme -> cle perso.
const cacheIndexSignatures = new WeakMap();

function getIndexSignatures(armes) {
  if (!cacheIndexSignatures.has(armes)) {
    const armeParCle = new Map();
    const cleParArme = new Map();
    armes.forEach(arme => {
      const m = typeof arme.image === "string" && arme.image.match(/([^/]+)_w\.webp$/);
      if (!m) return;
      armeParCle.set(m[1], arme);
      cleParArme.set(arme.id, m[1]);
    });
    cacheIndexSignatures.set(armes, { armeParCle, cleParArme });
  }
  return cacheIndexSignatures.get(armes);
}

function trouverArmeSignature(armes, personnage) {
  return getIndexSignatures(armes).armeParCle.get(getCleSignature(personnage)) || null;
}

// Personnage (parmi personnages) dont l'arme est la signature, ou null.
function trouverPersonnageSignature(armes, personnages, idArme) {
  const cle = getIndexSignatures(armes).cleParArme.get(idArme);
  return cle ? personnages.find(p => getCleSignature(p) === cle) || null : null;
}

// ---- Valeur alternative des armes ----
// Pourcentage des points d'une copie d'arme (ALTERNATIVES_ARMES), réglé
// par arme sur la page admin (arme.alternatif, 100 par défaut), appliqué
// dans les points d'une box à chaque copie en double (toutes sauf la
// meilleure) et à une arme signature dont le perso n'est pas dans la box
// (une seule fois si les 2). Arrondi à l'entier. Même calcul côté serveur :
// calculerPointsArmesBox (api/_lib/draft.js).
const ALTERNATIVES_ARMES = [0, 25, 50, 75, 100];

// Clés signature (cf. getCleSignature) des persos d'une box.
function clesPersosBox(collectionPersos, personnages, box) {
  const cles = new Set();
  personnages.forEach(p => {
    const constellation = collectionPersos?.full?.[p.id];
    if (typeof constellation !== "number" || constellation < 0) return;
    if (box !== "full" && !collectionPersos.selections?.[box]?.[p.id]) return;
    cles.add(getCleSignature(p));
  });
  return cles;
}

// Copies d'armes d'une box -> [{ arme, raffinement, instance }].
function copiesArmesBox(collectionArmes, armes, box) {
  const parId = new Map(armes.map(arme => [arme.id, arme]));
  return Object.entries(collectionArmes?.full || {})
    .filter(([instance, raffinement]) => Number.isInteger(raffinement) && raffinement >= 0 &&
      (box === "full" || !!collectionArmes.selections?.[box]?.[instance]))
    .map(([instance, raffinement]) => ({ arme: parId.get(instance.split("#")[0]), raffinement, instance }))
    .filter(copie => copie.arme);
}

// Points des armes d'une box (copies : cf. copiesArmesBox ; clesPersos :
// cf. clesPersosBox), valeur alternative comprise. personnages : catalogue
// (une arme n'est une signature que si un perso a sa clé).
function pointsArmesBox(copies, clesPersos, armes, personnages) {
  return pointsCopiesArmes(copies, clesPersos, armes, personnages).reduce((total, c) => total + c.points, 0);
}

// Points de chaque copie -> [{ ...copie, points, reduite (valeur
// alternative), double (pas la meilleure copie) }].
function pointsCopiesArmes(copies, clesPersos, armes, personnages) {
  const { cleParArme } = getIndexSignatures(armes);
  const clesCatalogue = new Set(personnages.map(getCleSignature));
  const parId = new Map();
  copies.forEach(copie => {
    if (!parId.has(copie.arme.id)) parId.set(copie.arme.id, []);
    parId.get(copie.arme.id).push(copie);
  });
  const resultat = [];
  parId.forEach(liste => {
    liste.sort((a, b) => b.raffinement - a.raffinement).forEach((copie, index) => {
      const points = Number(copie.arme.PPW?.[copie.raffinement] ?? 0);
      const cle = cleParArme.get(copie.arme.id);
      const reduite = index > 0 || (clesCatalogue.has(cle) && !clesPersos.has(cle));
      resultat.push({ ...copie, reduite, double: index > 0, points: reduite ? Math.round(points * (copie.arme.alternatif ?? 100) / 100) : points });
    });
  });
  return resultat;
}

// Meilleur raffinement (0 = R1 ... 4 = R5) d'une arme parmi ses copies
// ("idArme#2"...), ou -1 si elle n'est pas possédée.
function meilleurRaffinement(armesFull, idArme) {
  let meilleur = -1;
  Object.entries(armesFull || {}).forEach(([cle, valeur]) => {
    if ((cle === idArme || cle.startsWith(`${idArme}#`)) && valeur > meilleur) meilleur = valeur;
  });
  return meilleur;
}

// Logo du type d'arme détouré de la couleur du raffinement (classes
// .ref-1 ... .ref-5 de commun/cartes.css).
function htmlArmeSignature(typeArme, raffinement, { classe = "character-raffinement", titre = null } = {}) {
  const icone = ICONES_ARMES_SIGNATURE[typeArme];
  if (!icone || raffinement === null || raffinement === undefined || raffinement < 0) return "";
  const niveau = Math.min(raffinement, 4) + 1;
  return `<img class="${classe} ref-${niveau}" src="${icone}" alt="R${raffinement + 1}" title="${titre || `Arme signature R${raffinement + 1}`}">`;
}

// ---- Grille de cartes : écarts homogènes ----
// Autant de colonnes que possible avec un écart >= ECART_MIN_GRILLE, puis
// l'espace restant est réparti également ; le même écart sert entre les
// lignes. bordsAlignes : 1re et dernière colonnes collées aux bords (sinon
// même écart sur les bords). Téléphone : toujours 4 cartes par ligne,
// réduites à la largeur de l'écran.

const ECART_MIN_GRILLE = 10;
const MEDIA_TELEPHONE = window.matchMedia("(max-width: 700px)");
const COLONNES_TELEPHONE = 4;

function taillePoliceRacine() {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

// --taille-carte converti en px (la variable CSS est en rem, cf. l'échelle
// du site dans commun/entete.css).
function lireTailleCarte() {
  const valeur = getComputedStyle(document.documentElement).getPropertyValue("--taille-carte").trim();
  const nombre = parseFloat(valeur);
  return valeur.endsWith("rem") ? nombre * taillePoliceRacine() : nombre;
}

function ajusterGrille(grille, { bordsAlignes = false, tailleDefaut = 110 } = {}) {
  const largeur = grille.clientWidth;
  if (!largeur) return;

  const ecartMin = ECART_MIN_GRILLE * taillePoliceRacine() / 16;
  // Nombre d'écarts pour n colonnes : entre les cartes, plus les 2 bords.
  const nbEcarts = n => (bordsAlignes ? n - 1 : n + 1);
  let taille = lireTailleCarte() || tailleDefaut;
  let colonnes;
  let tailleTelephone = "";

  if (MEDIA_TELEPHONE.matches) {
    colonnes = COLONNES_TELEPHONE;
    taille = Math.floor((largeur - nbEcarts(colonnes) * ecartMin) / colonnes);
    tailleTelephone = `${taille}px`;
  } else {
    colonnes = Math.max(1, Math.floor((largeur + (bordsAlignes ? ecartMin : -ecartMin)) / (taille + ecartMin)));
  }

  const ecart = nbEcarts(colonnes) > 0 ? Math.max(0, (largeur - colonnes * taille) / nbEcarts(colonnes)) : 0;
  const colonnesCss = `repeat(${colonnes}, ${taille}px)`;
  const ecartCss = `${ecart}px`;

  // Écritures seulement si quelque chose change (pas de recalcul de mise en
  // page inutile pendant un redimensionnement).
  if (grille.style.getPropertyValue("--taille-carte") !== tailleTelephone) {
    if (tailleTelephone) grille.style.setProperty("--taille-carte", tailleTelephone);
    else grille.style.removeProperty("--taille-carte");
  }
  if (grille.style.gridTemplateColumns !== colonnesCss) grille.style.gridTemplateColumns = colonnesCss;
  if (grille.style.gap !== ecartCss) grille.style.gap = ecartCss;
}

function observerGrilles(grilles, options) {
  const observateur = new ResizeObserver(entrees => entrees.forEach(e => ajusterGrille(e.target, options)));
  grilles.forEach(grille => observateur.observe(grille));
}

// ---- Recyclage des cartes ----
// Une carte dont la clé n'a pas changé depuis le dernier rendu de la grille
// est réutilisée telle quelle : pas de nouvelle image à décoder, pas de
// clignotement, beaucoup moins de travail à chaque clic ou filtre.

function obtenirCarte(grille, cle, creer) {
  const cache = grille.cacheCartes ??= { precedent: new Map(), courant: new Map() };
  let carte = cache.precedent.get(cle);
  if (carte) cache.precedent.delete(cle);
  else carte = creer();
  cache.courant.set(cle, carte);
  return carte;
}

// Fin d'un rendu : seules les cartes utilisées restent en cache.
function terminerRendu(grille) {
  const cache = grille.cacheCartes;
  if (!cache) return;
  cache.precedent = cache.courant;
  cache.courant = new Map();
}

function viderCacheCartes(grille) {
  grille.cacheCartes = null;
}

// Match classé en cours (cf. matchClasseEnCours, api/_lib/room.js), qui
// bloque tout autre match : fenêtre pour y retourner, ou l'abandonner sans
// finir la draft (défaite, trophées au maximum pour l'adversaire, aucun
// Rikoyn ; cf. abandonner_classe, api/rooms/[room_id]/[action].js) pour
// faire autre chose.
// -> true si le match a été abandonné (l'appelant relance sa demande) ;
// sinon, retour à ce match.
function proposerAbandonClasse(roomEnCours) {
  const allerAuMatch = () => { window.location.href = `/match?room=${encodeURIComponent(roomEnCours)}`; };
  // Styles en ligne : page du match sans commun/theme.css.
  const STYLE_BOUTON = "padding: 0.5rem 1rem; border: 2px solid; border-radius: 0.625rem; color: white; font: inherit; font-weight: bold; cursor: pointer;";
  return new Promise(resoudre => {
    const fenetre = document.createElement("dialog");
    fenetre.style.cssText = "max-width: min(26rem, calc(100vw - 2rem)); padding: 1.25rem; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 0.75rem; background: #2a2a2a; color: white; text-align: center;";
    fenetre.innerHTML = `
      <p style="margin: 0 0 0.5rem; font-weight: bold;">Tu as un match classé en cours.</p>
      <p style="margin: 0 0 1rem; font-size: 0.875rem; opacity: 0.85;">L'abandonner compte comme une défaite : ton adversaire gagne 30 trophées et tu ne gagnes aucun Rikoyn.</p>
      <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: center;">
        <button type="button" data-choix="retour" style="${STYLE_BOUTON} border-color: #f5c542; background-color: rgba(245, 197, 66, 0.18);">Retourner au match</button>
        <button type="button" data-choix="abandon" style="${STYLE_BOUTON} border-color: #e74c3c; background-color: rgba(231, 76, 60, 0.25);">Abandonner le match</button>
      </div>
      <p class="etat-abandon" style="margin: 0.75rem 0 0; font-size: 0.875rem;" hidden></p>`;
    document.body.appendChild(fenetre);
    // Échap : comme "Retourner au match".
    fenetre.addEventListener("cancel", event => {
      event.preventDefault();
      allerAuMatch();
    });
    fenetre.addEventListener("click", async event => {
      const choix = event.target.closest("[data-choix]")?.dataset.choix;
      if (choix === "retour") return allerAuMatch();
      if (choix !== "abandon") return;
      fenetre.querySelectorAll("button").forEach(bouton => { bouton.disabled = true; });
      const etat = fenetre.querySelector(".etat-abandon");
      try {
        const reponse = await fetch(`/api/rooms/${encodeURIComponent(roomEnCours)}/abandonner_classe`, { method: "POST", credentials: "include" });
        if (!reponse.ok) {
          const { error } = await reponse.json().catch(() => ({}));
          throw new Error(error || "Abandon impossible.");
        }
        fenetre.close();
        fenetre.remove();
        resoudre(true);
      } catch (erreur) {
        etat.textContent = `${erreur.message} Retour au match…`;
        etat.hidden = false;
        setTimeout(allerAuMatch, 1500);
      }
    });
    fenetre.showModal();
  });
}
