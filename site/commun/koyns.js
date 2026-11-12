// Rikoyns : monnaie du site, gagnée en jouant (jamais achetable avec de
// l'argent réel), qui sert à obtenir les cosmétiques de la personnalisation
// (fonds, namecards, bannières, skins ; Voyageur / Manekin gratuits). Les filtres et
// tris de la draft restent libres. Règles et gains : api/_lib/koyns.js.
// Partagé avec le serveur.

// Prix d'un cosmétique (décidés par l'utilisateur le 2026-11-12) :
// - namecards ("banniere") et bannières ("banniere2") : persos préférés de
//   la communauté (PERSOS_PRIX_DOUBLE) 30 ; sinon selon la rareté du tirage
//   (= étoiles du perso : épique 5★ 20, rare 4★ 10) ; Aloy (3★) 5 ; autres
//   (succès, régions, événements…) 15 ;
// - fonds d'écran : selon la rareté, commun 10, rare 20, épique 30 ;
// - skins 10 (double pour PERSOS_PRIX_DOUBLE) ; Mon image : PRIX_IMPORT_FOND ;
//   autre choix payant : PRIX_COSMETIQUE (Voyageur et Manekin : gratuits,
//   cf. COSMETIQUES_GRATUITS).
// Prix réglés à la main dans l'admin (config.prix_cosmetiques) : prioritaires.
const PRIX_COSMETIQUE = 1;
const PRIX_PAR_CHOIX = { fond: 10, skin: 10, banniere: 15, banniere2: 15 };

// Persos dont la namecard, la bannière et le skin valent le double : ids
// des persos (skins, "skin:<id>") et noms dans les fichiers des namecards
// ("Namecard_Background_<nom>_..." / "Namecard_Banner_<nom>_...").
const PERSOS_PRIX_DOUBLE = [
  ["fufu", "Furina"], ["columbina", "Columbina"], ["arlecchino", "Arlecchino"], ["skirk", "Skirk"],
  ["flin", "Flins"], ["hutao", "Hu_Tao"], ["neuvillette", "Neuvillette"], ["mavuika", "Mavuika"],
  ["raiden", "Raiden_Shogun"], ["wanderer", "Wanderer"], ["citlali", "Citlali"], ["wriothesley", "Wriothesley"],
  ["vodyanitsa", "Vodyanitsa"], ["durin", "Durin"], ["xiao", "Xiao"], ["lohen", "Lohen"],
  ["mitya", "Mitya"]
];
const SKINS_PRIX_DOUBLE = new Set(PERSOS_PRIX_DOUBLE.map(([id]) => id));
const NAMECARDS_PRIX_DOUBLE = new RegExp(`/Namecard_(Background|Banner)_(${PERSOS_PRIX_DOUBLE.map(([, nom]) => nom).join("|")})_`);

function estPrixDouble(id) {
  const [choix, ...reste] = String(id).split(":");
  const valeur = reste.join(":");
  if (choix === "skin") return SKINS_PRIX_DOUBLE.has(valeur.split("__")[0]);
  return (choix === "banniere" || choix === "banniere2") && NAMECARDS_PRIX_DOUBLE.test(valeur);
}

// Mon image (fond "perso") : PRIX_IMPORT_FOND à chaque image importée (cf.
// acheterCosmetique, api/_lib/koyns.js).
const FOND_IMPORTE = "fond:perso";
const PRIX_IMPORT_FOND = 100;

// Prix selon la rareté du tirage (config.cosmetiques_raretes : rare,
// epique ; commun sinon), cf. prixParDefautCosmetique.
const PRIX_FOND_PAR_RARETE = { commun: 10, rare: 20, epique: 30, legendaire: 30 };
const PRIX_NAMECARD_PAR_RARETE = { rare: 10, epique: 20, legendaire: 20 };
const PRIX_NAMECARD_PERSO_3_ETOILES = 5;
const NAMECARDS_PERSOS_3_ETOILES = /\/Namecard_(Background|Banner)_Aloy_/;
let raretesPrix = {};

// Raretés (config.cosmetiques_raretes, { id: "rare" | "epique" }) : serveur
// avec la config (actualiserPoints) ; pages avec l'état des Rikoyns
// (etat.tirage.raretes) ou la config (admin).
function definirRaretesPrix(raretes) {
  raretesPrix = raretes && typeof raretes === "object" ? raretes : {};
}

// Prix réglés par les administrateurs (config.prix_cosmetiques, { id: prix },
// fenêtre Rikoyns de l'admin) : prioritaires sur le prix par défaut.
// Serveur : chargés avec la config (actualiserPoints) ; pages : avec l'état
// des Rikoyns (etatKoyns).
let prixCosmetiquesAdmin = {};
const PRIX_COSMETIQUE_MAX = 10000;

function definirPrixCosmetiques(prix) {
  prixCosmetiquesAdmin = prix && typeof prix === "object" ? prix : {};
}

function prixCosmetique(id) {
  const regle = prixCosmetiquesAdmin[String(id).split("#")[0]];
  return Number.isInteger(regle) && regle >= 0 ? regle : prixParDefautCosmetique(id);
}

// Prix sans réglage des administrateurs.
function prixParDefautCosmetique(id) {
  const brut = String(id).split("#")[0];
  if (brut === FOND_IMPORTE) return PRIX_IMPORT_FOND;
  const choix = brut.split(":")[0];
  const rarete = raretesPrix[brut] || "commun";
  if (choix === "fond") return PRIX_FOND_PAR_RARETE[rarete] ?? PRIX_PAR_CHOIX.fond;
  if (choix === "banniere" || choix === "banniere2") {
    if (estPrixDouble(brut)) return PRIX_PAR_CHOIX[choix] * 2;
    if (PRIX_NAMECARD_PAR_RARETE[rarete]) return PRIX_NAMECARD_PAR_RARETE[rarete];
    if (NAMECARDS_PERSOS_3_ETOILES.test(brut)) return PRIX_NAMECARD_PERSO_3_ETOILES;
    return PRIX_PAR_CHOIX[choix];
  }
  const prix = PRIX_PAR_CHOIX[choix] ?? PRIX_COSMETIQUE;
  return estPrixDouble(brut) ? prix * 2 : prix;
}

// Icône du Rikoyn (DB/images/others/rikoyn.webp), à côté des montants.
const ICONE_KOYN = `<img class="icone-koyn" src="/DB/images/others/rikoyn.webp" alt="Rikoyns">`;

// Id d'un cosmétique : "<choix>:<valeur>" (choix de profil.parametres ;
// "skin" pour chaque skin), ex. "fond:bg/autres/x.png", "skin:hutao".
function idCosmetique(choix, valeur) {
  return `${choix}:${valeur}`;
}

// Nom affiché d'un fond (DB/images/cosmetiques.json) : celui de son image,
// pas son id (ancien nom de fichier, gardé pour les achats et les fonds
// choisis). "bg_web/autres/temple_de_l_espace3.webp" -> "Temple de l'espace 3".
function nomFond(fond) {
  const nom = fond.image.split("/").pop()
    .replace(/\.[a-z]+$/i, "")
    .replace(/(^|_)([dl])_/gi, "$1$2'")
    .replace(/_/g, " ")
    .replace(/(\D)(\d+)$/, "$1 $2");
  return nom.charAt(0).toUpperCase() + nom.slice(1);
}

// Choix par défaut (Default : namecard bleue étoilée et sa bannière ; Mondstadt
// Hero's Fame, ancien défaut, caché et retiré de tous les comptes le
// 2026-11-12), et les 2 variantes du Voyageur et du Manekin : gratuits
// pour tout le monde.
const COSMETIQUES_GRATUITS = new Set([
  "banniere:namecards/Namecard_Background_Default.webp",
  "banniere2:namecards/banners/Namecard_Banner_Default.webp",
  "fond:bg/autres/default_bg.webp",
  "voyageur:aether",
  "voyageur:lumine",
  "manekin:manekin",
  "manekin:manekina"
]);

const CHOIX_COSMETIQUES = ["fond", "banniere", "banniere2", "voyageur", "manekin"];

// Flex cosmétiques (parametres.flex) : 12 emplacements (grille de 3 lignes
// de 4) montrés sur la page Joueurs (onglet Flex) ; id de cosmétique possédé
// ou null. Choisis dans la personnalisation.
const TAILLE_FLEX = 12;

// Cosmétiques payants portés avec ces paramètres (ids).
function cosmetiquesParametres(parametres = {}) {
  const ids = CHOIX_COSMETIQUES
    .filter(choix => typeof parametres[choix] === "string" && parametres[choix])
    .map(choix => idCosmetique(choix, parametres[choix]));
  if (Array.isArray(parametres.skins)) parametres.skins.forEach(id => ids.push(idCosmetique("skin", id)));
  return ids.filter(id => !COSMETIQUES_GRATUITS.has(id));
}

// Ligne de l'écran de fin de match (gain : { montant, raison } du joueur,
// cf. crediterPartie dans api/_lib/koyns.js), ou "" (spectateur,
// entraînement).
function htmlGainKoyns(gain) {
  if (!gain) return "";
  const texte = gain.montant > 0 ? `+${gain.montant} ${ICONE_KOYN}`
    : gain.raison === "plafond" ? "Pas de Rikoyns : 3 games récompensées par jour au plus contre les mêmes adversaires (reset à 4 h)"
      : gain.raison === "plafond_wb" ? "Pas de Rikoyns : 1 Random world boss récompensé par jour (reset à 4 h)"
      : gain.raison === "suspicion" ? "Pas de Rikoyns : temps jugés suspects par l'anti-triche"
        : "";
  return texte ? `<p class="ligne-koyns${gain.montant > 0 ? " gain" : ""}">${texte}</p>` : "";
}

if (typeof module !== "undefined") {
  module.exports = { PRIX_COSMETIQUE, PRIX_COSMETIQUE_MAX, prixCosmetique, prixParDefautCosmetique, definirPrixCosmetiques, definirRaretesPrix, FOND_IMPORTE, PRIX_IMPORT_FOND, COSMETIQUES_GRATUITS, CHOIX_COSMETIQUES, TAILLE_FLEX, idCosmetique, cosmetiquesParametres };
}
