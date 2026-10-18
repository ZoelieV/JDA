// Koyns : monnaie du site, gagnée en jouant (jamais achetable avec de
// l'argent réel), qui sert à obtenir les cosmétiques de la personnalisation
// (fonds, namecards, bannières, Voyageur / Manekin, skins). Les filtres et
// tris de la draft restent libres. Règles et gains : api/_lib/koyns.js.
// Partagé avec le serveur.

const PRIX_COSMETIQUE = 1;

// Id d'un cosmétique : "<choix>:<valeur>" (choix de profil.parametres ;
// "skin" pour chaque skin), ex. "fond:bg/autres/x.png", "skin:hutao".
function idCosmetique(choix, valeur) {
  return `${choix}:${valeur}`;
}

// Choix par défaut : gratuits pour tout le monde.
const COSMETIQUES_GRATUITS = new Set([
  "banniere:namecards/Namecard_Background_Default.webp",
  "banniere2:namecards/banners/Namecard_Banner_Default.webp",
  "fond:bg/autres/default_bg.webp",
  "voyageur:aether",
  "manekin:manekin"
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
  const texte = gain.montant > 0 ? `+${gain.montant} Koyns`
    : gain.raison === "plafond" ? "Pas de Koyns : 3 games récompensées par jour au plus contre les mêmes adversaires (reset à 4 h)"
      : gain.raison === "suspicion" ? "Pas de Koyns : temps jugés suspects par l'anti-triche"
        : "";
  return texte ? `<p class="ligne-koyns${gain.montant > 0 ? " gain" : ""}">${texte}</p>` : "";
}

if (typeof module !== "undefined") {
  module.exports = { PRIX_COSMETIQUE, COSMETIQUES_GRATUITS, CHOIX_COSMETIQUES, idCosmetique, cosmetiquesParametres };
}
