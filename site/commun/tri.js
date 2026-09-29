// Tris et regroupements communs à Mon compte, Tous les comptes et la draft.
//
// Tris combinables (points, constellation, niveau, rareté, élément/type) :
// 1er clic = un sens, 2e clic = l'autre sens, 3e clic = désactivé.
// Élément/type d'arme puis rareté sont des regroupements (un changement
// d'élément / de type revient à la ligne). Les autres tris s'appliquent à
// l'intérieur des groupes, dans l'ordre des clics.

const RACINE_LOGOS = "../DB/images/others/";

// Ordre d'affichage des éléments ; "all" (Voyageur, Manekin) en dernier.
const ICONES_ELEMENTS_TRI = {
  pyro: `${RACINE_LOGOS}pyro.webp`,
  hydro: `${RACINE_LOGOS}hydro.webp`,
  electro: `${RACINE_LOGOS}electro.webp`,
  cryo: `${RACINE_LOGOS}cryo.webp`,
  anemo: `${RACINE_LOGOS}anemo.webp`,
  geo: `${RACINE_LOGOS}geo.webp`,
  dendro: `${RACINE_LOGOS}dendro.webp`,
  all: `${RACINE_LOGOS}omni_element.webp`
};

const ICONES_TYPES_ARMES_TRI = {
  sword: `${RACINE_LOGOS}sword.webp`,
  claymore: `${RACINE_LOGOS}claymore.webp`,
  polearm: `${RACINE_LOGOS}polearm.webp`,
  bow: `${RACINE_LOGOS}bow.webp`,
  catalyst: `${RACINE_LOGOS}catalyst.webp`
};

const LOGO_TRI_ELEMENT = `${RACINE_LOGOS}omni_element.webp`;
const LOGO_TRI_CONSTELLATION = `${RACINE_LOGOS}stella_fortuna_5.webp`;
const LOGO_TRI_NIVEAU = `${RACINE_LOGOS}stella.webp`;
const LOGO_TRI_POINTS = `${RACINE_LOGOS}scale.webp`;
const LOGO_TRI_ARME = `${RACINE_LOGOS}Icon_Inventory_Weapons.webp`;
const LOGO_TRI_FAVORIS = `${RACINE_LOGOS}favourite.webp`;

// Vœux : Acquaint Fate = 4★ + personnages standards (dont le Voyageur),
// Intertwined Fate = les autres 5★. Aloy et Manekin : ni l'un ni l'autre.
const VOEUX = {
  intertwined: { nom: "Personnages limités", image: `${RACINE_LOGOS}Item_Intertwined_Fate.webp` },
  acquaint: { nom: "Personnages Standards", image: `${RACINE_LOGOS}Item_Acquaint_Fate.webp` }
};

// 5★ de la bannière standard (champ "standard" de DB/characters.json) :
// comptés comme 4.5★ pour le tri par rareté (rien ne change à l'affichage).
const HORS_VOEUX = new Set(["aloy", "manekin"]);

function rangRarete(item) {
  if (item.standard) return 4.5;
  return Number(item.rarete) || 0;
}

function getVoeu(item) {
  if (HORS_VOEUX.has(item.id)) return null;
  const rang = rangRarete(item);
  if (rang === 5) return "intertwined";
  if (rang === 4 || rang === 4.5) return "acquaint";
  return null;
}

// ---- État des tris ----
// tris : [{ cle, sens }] dans l'ordre d'activation ; sens 1 = 1er sens
// (décroissant, ou ordre des logos pour élément/type), -1 = inverse.

function creerEtatTri() {
  return { tris: [] };
}

function getSensTri(etat, cle) {
  return etat.tris.find(t => t.cle === cle)?.sens || 0;
}

function cyclerTri(etat, cle) {
  const tri = etat.tris.find(t => t.cle === cle);
  if (!tri) etat.tris.push({ cle, sens: 1 });
  else if (tri.sens === 1) tri.sens = -1;
  else etat.tris = etat.tris.filter(t => t !== tri);
}

function viderTris(etat) {
  etat.tris = [];
}

// Ajoute/retire une valeur d'une sélection en gardant l'ordre des clics
// (Set : l'ordre d'insertion est conservé).
function basculerSelection(set, valeur) {
  if (set.has(valeur)) set.delete(valeur); else set.add(valeur);
}

// Contenu d'un bouton de tri : libellé (ou logo omni pour l'élément) + flèche.
function majBoutonTri(btn, etat, vue = "characters") {
  const cle = btn.dataset.tri;
  const sens = getSensTri(etat, cle);
  const libelles = {
    points: `<img class="tri-logo" src="${LOGO_TRI_POINTS}" alt="Points">`,
    constellation: vue === "weapons" ? "Raffin." : `<img class="tri-logo tri-logo-constellation" src="${LOGO_TRI_CONSTELLATION}" alt="Constellation">`,
    niveau: `<img class="tri-logo tri-logo-niveau" src="${LOGO_TRI_NIVEAU}" alt="Niveau">`,
    rarete: `<span class="tri-etoile">★</span>`,
    element: vue === "weapons" ? "Type" : `<img class="tri-logo" src="${LOGO_TRI_ELEMENT}" alt="Élément">`,
    arme: `<img class="tri-logo" src="${LOGO_TRI_ARME}" alt="Type d'arme">`,
    favoris: `<img class="tri-logo" src="${LOGO_TRI_FAVORIS}" alt="Favoris">`
  };
  btn.innerHTML = `${libelles[cle] ?? cle}<span class="fleche-tri">${sens === 1 ? "▼" : sens === -1 ? "▲" : ""}</span>`;
  const titres = {
    constellation: vue === "weapons" ? "Trier par raffinement" : "Trier par constellation",
    points: "Trier par points",
    niveau: "Trier par niveau",
    rarete: "Trier par rareté",
    element: vue === "weapons" ? "Trier par type d'arme" : "Trier par élément",
    arme: "Trier par type d'arme",
    favoris: "Favoris d'abord"
  };
  btn.title = titres[cle] || "";
  btn.classList.toggle("active", sens !== 0);
}

// ---- Tri + regroupement ----
// options :
//   vue              : "characters" | "weapons"
//   valeurs          : { points, constellation, niveau } -> fonction(item) => nombre
//   elements         : Set des éléments filtrés (ordre des clics)
//   armes            : Set des types d'arme filtrés (ordre des clics)
//   rareteParDefaut  : un filtre est actif (possédés, sélectionnés, étoiles…)
// Renvoie [{ cles: { element?, arme?, rarete? }, items: [...] }].

function trierEtGrouper(items, etat, options = {}) {
  const vue = options.vue || "characters";
  const valeurs = options.valeurs || {};
  const elements = [...(options.elements || [])];
  const armes = [...(options.armes || [])];
  const sensElement = getSensTri(etat, "element");

  // Groupes : élément puis type d'arme, par les filtres (dans l'ordre des
  // clics) ou par le tri élément (= type d'arme dans la vue armes).
  const groupes = [];
  // Type d'arme : tri "élément" dans la vue armes, tri "arme" pour les persos.
  const triSurElement = vue !== "weapons" && sensElement;
  const triSurType = vue === "weapons" ? sensElement : getSensTri(etat, "arme");
  if (triSurElement || elements.length) {
    groupes.push({
      cle: "element", champ: "element",
      ordre: elements.length ? elements : Object.keys(ICONES_ELEMENTS_TRI),
      sens: triSurElement || 1
    });
  }
  if (triSurType || armes.length) {
    groupes.push({
      cle: "arme", champ: vue === "weapons" ? "type" : "arme",
      ordre: armes.length ? armes : Object.keys(ICONES_TYPES_ARMES_TRI),
      sens: triSurType || 1
    });
  }

  const sensRarete = getSensTri(etat, "rarete") ||
    (groupes.length || options.rareteParDefaut || getSensTri(etat, "constellation") ? 1 : 0);

  const trisValeurs = etat.tris.filter(t => valeurs[t.cle]);

  if (!groupes.length && !sensRarete && !trisValeurs.length) {
    return items.length ? [{ cles: {}, items }] : [];
  }

  // Valeur absente de l'ordre (ex. "all" filtré) : en fin de liste.
  const indexOrdre = (ordre, valeur) => {
    const i = ordre.indexOf(valeur);
    return i < 0 ? ordre.length : i;
  };

  const entrees = items.map((item, index) => ({
    item,
    index,
    g: groupes.map(g => indexOrdre(g.ordre, item[g.champ])),
    r: rangRarete(item),
    v: trisValeurs.map(t => Number(valeurs[t.cle](item)) || 0)
  }));

  entrees.sort((a, b) => {
    for (let i = 0; i < groupes.length; i++) {
      if (a.g[i] !== b.g[i]) return (a.g[i] - b.g[i]) * groupes[i].sens;
    }
    if (sensRarete && a.r !== b.r) return (b.r - a.r) * sensRarete;
    for (let i = 0; i < trisValeurs.length; i++) {
      if (a.v[i] !== b.v[i]) return (b.v[i] - a.v[i]) * trisValeurs[i].sens;
    }
    return a.index - b.index;
  });

  const resultat = [];
  entrees.forEach(({ item, r }) => {
    const cles = {};
    groupes.forEach(g => { cles[g.cle] = item[g.champ]; });
    if (sensRarete) cles.rarete = r;

    const dernier = resultat[resultat.length - 1];
    if (dernier && JSON.stringify(dernier.cles) === JSON.stringify(cles)) {
      dernier.items.push(item);
    } else {
      resultat.push({ cles, items: [item] });
    }
  });
  return resultat;
}

// Remplit une grille. Chaque changement d'élément / de type d'arme commence
// une nouvelle ligne (pas les changements de rareté).
// creerCartes(item) renvoie une carte ou une liste de cartes (idéalement
// recyclées via obtenirCarte, cf. commun/cartes.js). Le contenu de la
// grille est remplacé en une seule fois.
function remplirGrilleGroupee(container, groupes, creerCartes) {
  const cartes = [];
  let cleLigne = null;

  groupes.forEach(groupe => {
    const cle = JSON.stringify([groupe.cles.element, groupe.cles.arme]);
    const nouvelleLigne = cleLigne !== null && cle !== cleLigne;
    cleLigne = cle;

    groupe.items.forEach((item, index) => {
      [].concat(creerCartes(item)).forEach((carte, indexCarte) => {
        carte.classList.toggle("debut-ligne", nouvelleLigne && index === 0 && indexCarte === 0);
        cartes.push(carte);
      });
    });
  });

  // Mêmes cartes dans le même ordre (rafraîchissement sans changement) : on
  // ne touche pas au DOM (pas d'animation de survol rejouée).
  const inchangee = container.children.length === cartes.length &&
    cartes.every((carte, index) => container.children[index] === carte);
  if (!inchangee) container.replaceChildren(...cartes);
  if (typeof terminerRendu === "function") terminerRendu(container);
}
