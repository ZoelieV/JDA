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

// Nom et résistances des boss modifiés par les administrateurs.
function appliquerModifsBoss(liste, modifs) {
  liste.forEach(boss => {
    const modif = modifs?.[boss.id];
    if (typeof modif?.nom === "string") boss.nom = modif.nom;
    if (Array.isArray(modif?.res)) boss.res = modif.res;
  });
  return liste;
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
    if (avecMasques) return liste;
    catalogueTheatre = retirerMasques(liste, points.masques?.characters);
    return marquerBonusSaison(marquerBuffTheatre(catalogueTheatre, points.theatre), points.bonus_saison);
  });
const chargerArmes = (avecMasques = false) => Promise.all([chargerJSON("weapons.json"), chargerPointsAdmin()])
  .then(([liste, points]) => {
    appliquerPointsAdmin(fusionnerAjouts(liste, points.ajouts?.weapons), points.weapons, "PPW");
    // Catégories (support, standard) modifiées par les administrateurs.
    appliquerPointsAdmin(liste, points.categoriesArmes, "categories");
    return avecMasques ? liste : retirerMasques(liste, points.masques?.weapons);
  });
const chargerBoss = () => Promise.all([chargerJSON("boss.json"), chargerPointsAdmin()])
  .then(([liste, points]) => appliquerModifsBoss(fusionnerAjouts(liste, points.ajouts?.boss), points.boss));

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
// api/_lib/personnages.js) : copies de 5★ limités de la full box (C0 = 1,
// C2 = 3, C6 = 7) ; 0 à 19 -> 1 (sardine), 20 à 39 -> 2 (carpe), 40 à 79
// -> 3 (dauphin), 80 ou plus -> 4 (baleine). Sert au mode Auto des drafts
// et à la médaille. profil.theatre garde le palier calculé par le serveur
// ("1".."4"), utilisé sans catalogue chargé. Hauteur de la médaille : 1,3 x
// le texte (cf. cartes.css).
// PALIERS_THEATRE : nom, mode de room (cf. MODES_THEATRE, api/_lib/draft.js),
// bans par joueur avant / après les 2 premiers picks et médaille (image
// provisoire de l'ancien théâtre). Anciens matchs de l'historique : théâtre
// 6, 8, 10 ou 12 (cf. infosTheatreJoue).
const PALIERS_THEATRE = {
  1: { nom: "Sardine", mode: "sardine", bans: [2, 1], medaille: 6 },
  2: { nom: "Carpe", mode: "carpe", bans: [2, 2], medaille: 8 },
  3: { nom: "Dauphin", mode: "dauphin", bans: [3, 2], medaille: 10 },
  4: { nom: "Baleine", mode: "baleine", bans: [3, 3], medaille: 12 }
};
const SEUILS_THEATRE = [[80, 4], [40, 3], [20, 2]];
// Draft de la mêlée générale (mode "12"), du carnage et du mode en équipe.
const THEATRE_CARPE = 2;

function urlMedailleTheatre(numero) {
  return `/DB/images/others/Imaginarium_Theater_Medal_${numero}.webp`;
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

function copiesLimitees(profilData, personnages = catalogueTheatre) {
  if (typeof migrerCollectionPersos === "function") migrerCollectionPersos(profilData?.characters);
  const full = profilData?.characters?.full || {};
  return (personnages || []).filter(p => String(p.rarete) === "5" && !p.standard).reduce((total, p) => {
    const constellation = full[p.id];
    return Number.isInteger(constellation) && constellation >= 0 ? total + constellation + 1 : total;
  }, 0);
}

function palierTheatreProfil(profilData, personnages = catalogueTheatre) {
  if (!profilData) return null;
  if (!personnages) return PALIERS_THEATRE[profilData.theatre] ? Number(profilData.theatre) : null;
  const copies = copiesLimitees(profilData, personnages);
  return SEUILS_THEATRE.find(([seuil]) => copies >= seuil)?.[1] ?? 1;
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
