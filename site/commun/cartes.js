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

const chargerPersonnages = (avecMasques = false) => Promise.all([chargerJSON("characters.json"), chargerPointsAdmin()])
  .then(([liste, points]) => {
    appliquerPointsAdmin(fusionnerAjouts(liste, points.ajouts?.characters), points.characters, "PPC");
    return avecMasques ? liste : retirerMasques(liste, points.masques?.characters);
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
