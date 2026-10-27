// Rikoyns : monnaie du site, gagnée en jouant (jamais achetable avec de
// l'argent réel), qui sert à obtenir les cosmétiques de la personnalisation
// (fonds, namecards, bannières, skins ; Voyageur / Manekin gratuits). Les filtres et
// tris de la draft restent libres. Règles et gains : api/_lib/koyns.js.
// Partagé avec le serveur.

// Prix d'un cosmétique selon son choix (début de l'id, cf. idCosmetique) :
// fonds d'écran (image importée comprise, fonds des personnages : 8) et skins 10, namecards
// ("banniere") et bannières ("banniere2") 15 ; autre choix payant :
// PRIX_COSMETIQUE (Voyageur et Manekin : gratuits, cf. COSMETIQUES_GRATUITS). Double pour les persos de PERSOS_PRIX_DOUBLE.
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
  if (choix === "skin") return SKINS_PRIX_DOUBLE.has(valeur);
  return (choix === "banniere" || choix === "banniere2") && NAMECARDS_PRIX_DOUBLE.test(valeur);
}

// Mon image (fond "perso") : PRIX_IMPORT_FOND à chaque image importée (cf.
// acheterCosmetique, api/_lib/koyns.js).
const FOND_IMPORTE = "fond:perso";
const PRIX_IMPORT_FOND = 50;

// Fonds des personnages (DB/images/bg_web/autres/personnage_<n>.webp) :
// PRIX_FOND_PERSONNAGE au lieu du prix d'un fond.
const FOND_PERSONNAGE = /^fond:bg\/autres\/personnage_\d+\.webp$/;
const PRIX_FOND_PERSONNAGE = 8;

function prixCosmetique(id) {
  if (String(id).split("#")[0] === FOND_IMPORTE) return PRIX_IMPORT_FOND;
  if (FOND_PERSONNAGE.test(String(id))) return PRIX_FOND_PERSONNAGE;
  const prix = PRIX_PAR_CHOIX[String(id).split(":")[0]] ?? PRIX_COSMETIQUE;
  return estPrixDouble(id) ? prix * 2 : prix;
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

// Choix par défaut, et les 2 variantes du Voyageur et du Manekin : gratuits
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
      : gain.raison === "suspicion" ? "Pas de Rikoyns : temps jugés suspects par l'anti-triche"
        : "";
  return texte ? `<p class="ligne-koyns${gain.montant > 0 ? " gain" : ""}">${texte}</p>` : "";
}

if (typeof module !== "undefined") {
  module.exports = { PRIX_COSMETIQUE, prixCosmetique, FOND_IMPORTE, PRIX_IMPORT_FOND, COSMETIQUES_GRATUITS, CHOIX_COSMETIQUES, idCosmetique, cosmetiquesParametres };
}
