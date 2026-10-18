// Résistances et recommandations d'un boss (config.boss[id].reco, saisies
// dans la fenêtre Boss de la page admin, cf. admin_ppc/admin_boss.js) :
// éléments, réactions et mécaniques conseillés pour le battre.
// - Match classé (compétitif) : ni résistances ni recommandations ;
// - autres matchs (room, matchmaking, entraînement, équipe, Random world
//   boss) : les deux, par-dessus l'image du boss (clic).
// Partagé avec le serveur (validation, cf. api/points.js).

// Même ordre que boss.res (cf. admin_ppc/admin_ajout.js).
const ELEMENTS_BOSS = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];
const NOMS_ELEMENTS_BOSS = {
  pyro: "Pyro", hydro: "Hydro", electro: "Électro", cryo: "Cryo",
  anemo: "Anémo", geo: "Géo", dendro: "Dendro"
};

// Noms officiels français (wiki Genshin FR, page Réaction élémentaire).
const REACTIONS_BOSS = {
  evaporation: "Évaporation",
  fonte: "Fonte",
  surcharge: "Surcharge",
  supraconduction: "Supraconduction",
  electrocution: "Électrocution",
  gel: "Gel",
  dispersion: "Dispersion",
  cristallisation: "Cristallisation",
  brulure: "Brûlure",
  fleurissement: "Fleurissement",
  exuberance: "Exubérance",
  bourgeonnement: "Bourgeonnement",
  stimulation: "Stimulation",
  suractivation: "Suractivation",
  propagation: "Propagation",
  selenocution: "Sélénocution",
  selenofleurissement: "Sélénofleurissement",
  selenocristallisation: "Sélénocristallisation",
  astroconduction: "Astroconduction",
  astrodispersion: "Astrodispersion"
};

// Mécaniques : texte libre (nouvelles mécaniques du jeu sans changer le
// code) ; suggestions proposées dans la page admin.
const MECANIQUES_SUGGEREES = ["Lien de vie", "Noctame", "Lunaire", "Stellaire", "Bouclier", "Soins"];
const MAX_MECANIQUES_BOSS = 8;
const LONGUEUR_MECANIQUE_BOSS = 30;

// Recommandations au bon format { elements, reactions, mecaniques } :
// valeurs connues (mécaniques : textes courts), sans doublon, dans l'ordre
// des listes ci-dessus ; null si aucune.
function lireRecommandationsBoss(brut) {
  if (!brut || typeof brut !== "object") return null;
  const liste = valeur => (Array.isArray(valeur) ? valeur : []);
  const elements = ELEMENTS_BOSS.filter(e => liste(brut.elements).includes(e));
  const reactions = Object.keys(REACTIONS_BOSS).filter(r => liste(brut.reactions).includes(r));
  const vues = new Set();
  const mecaniques = liste(brut.mecaniques)
    .map(m => (typeof m === "string" ? m.trim().replace(/\s+/g, " ") : ""))
    .filter(m => m && m.length <= LONGUEUR_MECANIQUE_BOSS && !vues.has(m.toLowerCase()) && vues.add(m.toLowerCase()))
    .slice(0, MAX_MECANIQUES_BOSS);
  return elements.length || reactions.length || mecaniques.length ? { elements, reactions, mecaniques } : null;
}

// ---- Affichage (pages de match ; utilise ICONES_ELEMENTS_TRI de
// commun/tri.js, estImmunise, texteResistance et echapperHtml de
// commun/cartes.js) ----

function htmlRecommandationsBoss(reco) {
  const propre = lireRecommandationsBoss(reco);
  if (!propre) return "";
  const elements = propre.elements.map(e =>
    `<img src="${ICONES_ELEMENTS_TRI[e]}" alt="${NOMS_ELEMENTS_BOSS[e]}" title="${NOMS_ELEMENTS_BOSS[e]}">`).join("");
  const textes = [
    ...propre.reactions.map(r => REACTIONS_BOSS[r]),
    ...propre.mecaniques
  ].map(t => `<span class="tag-reco-boss">${echapperHtml(t)}</span>`).join("");
  return `<span class="reco-boss"><span class="titre-reco-boss">Recommandé</span>${elements}${textes}</span>`;
}

// Image du boss. Hors match compétitif : cliquable, avec par-dessus ses
// résistances (en %) et ses recommandations, et une indication dessous.
function htmlImageInfosBoss(boss, competitif) {
  if (competitif) return htmlImagesBoss(boss);
  const res = ELEMENTS_BOSS.map((element, i) => {
    const valeur = Number(boss.res?.[i] ?? 0);
    const nom = NOMS_ELEMENTS_BOSS[element];
    return `<span class="res-boss${estImmunise(valeur) ? " immunise" : ""}" title="${estImmunise(valeur) ? `Immunisé ${nom}` : `Résistance ${nom}`}"><img src="${ICONES_ELEMENTS_TRI[element]}" alt="${nom}">${texteResistance(valeur, "")}</span>`;
  }).join("");
  const reco = htmlRecommandationsBoss(boss.reco);
  return `
    <button type="button" class="image-boss-res" title="Voir les résistances${reco ? " et les recommandations" : ""}">
      ${htmlImagesBoss(boss)}
      <span class="resistances-boss">${res}${reco}</span>
    </button>
    <span class="indice-res-boss">${reco ? "Voir les Res et conseils" : "Voir les Res"}</span>`;
}

if (typeof module !== "undefined") {
  module.exports = { ELEMENTS_BOSS, REACTIONS_BOSS, MECANIQUES_SUGGEREES, lireRecommandationsBoss };
}
