// Page Theorycraft : connectés seulement, sauf shadowbans (user.theorycraft,
// cf. api/auth/me.js). Les autres sont renvoyés à l'accueil, comme si la
// page n'existait pas.
//
// Lecture seule : points des personnages et des armes, et personnage + arme
// signature R1 (mêmes tableaux que la page Administration, masqués exclus), résistances et probabilités de
// tirage des boss, formules du système d'équilibrage. Mêmes calculs que le
// serveur (api/_lib/draft.js, api/_lib/boss.js) : à garder synchronisés.

const COLONNES = {
  characters: {
    champ: "PPC",
    libelles: ["C0", "C1", "C2", "C3", "C4", "C5", "C6", "Niv. 95", "Niv. 100", "Théâtre"]
  },
  weapons: {
    champ: "PPW",
    libelles: ["R1", "R2", "R3", "R4", "R5"]
  },
  // Personnage + arme signature R1 (vue "Perso + signa" de la page
  // Administration) : signature R1 seule (0 sans signature), puis
  // C0R1..C6R1 = points de constellation + signature R1. Cf. sommesPerso.
  sommes: {
    libelles: ["Signa R1", "C0R1", "C1R1", "C2R1", "C3R1", "C4R1", "C5R1", "C6R1"]
  }
};

// Bonus des niveaux 95 / 100 et du théâtre : ajoutés ou multipliés aux
// points de constellation, au choix des administrateurs.
const BONUS = [
  { cle: "niveau95", index: 7, libelle: "Niveau 95" },
  { cle: "niveau100", index: 8, libelle: "Niveau 100" },
  { cle: "theatre", index: 9, libelle: "Théâtre" }
];
const LIBELLES_MODES = { addition: "+ Addition", multiplication: "× Multiplication" };

const CATEGORIES = { dps: "DPS", subdps: "Sub-DPS", support: "Support" };
const CATEGORIES_ARMES_FILTRE = { support: "Support", standard: "Perma", temporaire: "Temporaire" };

// Types de boss (mêmes clés que TYPES_BOSS de api/points.js) ; classé :
// TYPES_BOSS_CLASSE de api/_lib/boss.js.
const TYPES_BOSS = {
  weekly_boss: "Boss hebdomadaire",
  legende_locale_jour: "Légende locale (1 fois par jour)",
  legende_locale_infinie: "Légende locale (à l'infini)",
  world_boss: "World boss",
  carnage_boss: "Boss de carnage"
};
const TYPES_BOSS_CLASSE = ["weekly_boss", "legende_locale_infinie", "carnage_boss"];
// Même règle que estTirableEnClasse (api/_lib/boss.js) : "classe": false
// dans DB/boss.json = jamais en classé.
const estTirableEnClasse = b => TYPES_BOSS_CLASSE.includes(b.type) && b.classe !== false;
const ELEMENTS_RES = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];

// Seuil par défaut si l'API ne le donne pas (SEUIL_EQUILIBRAGE).
const SEUIL_PAR_DEFAUT = 200;

let personnages = [];
let armes = [];
let boss = [];
// Boss du carnage désactivés par les admins (config.carnage_desactive) :
// jamais tirés hors entraînement.
let carnageDesactive = false;
let modes = {};
let buffs = new Set();
let bonusSaison = new Set();
let seuil = SEUIL_PAR_DEFAUT;
// Méthode des bans d'équilibrage choisie par les administrateurs (cf.
// getModeEquilibrage, api/_lib/personnages.js).
let methodeEquilibrage = "ancien";

let onglet = null;
let filtres = creerFiltres();
let tri = null; // { cle: "nom" | index de colonne, sens: 1 | -1 }

function creerFiltres() {
  return {
    elements: new Set(),
    armes: new Set(),
    etoiles: new Set(),
    voeux: new Set(),
    factions: new Set(),
    categories: new Set(),
    categoriesArmes: new Set(),
    buffes: false,
    bonusSaison: false
  };
}

function echapper(texte) {
  return String(texte ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Accès et chargement ----

async function verifierAcces() {
  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });
    const user = reponse.ok ? (await reponse.json()).user : null;
    return !!user?.theorycraft;
  } catch (erreur) {
    console.error(erreur);
    return false;
  }
}

async function chargerDonnees() {
  // Points du JSON + modifications des admins, masqués exclus (cf.
  // commun/cartes.js).
  const [listePersos, listeArmes, listeBoss, config] = await Promise.all([
    chargerPersonnages(), chargerArmes(), chargerBoss(), chargerPointsAdmin()
  ]);
  personnages = listePersos;
  armes = listeArmes;
  boss = listeBoss;
  modes = Object.fromEntries(BONUS.map(({ cle }) => [cle, config?.modes?.[cle] === "multiplication" ? "multiplication" : "addition"]));
  buffs = new Set(Array.isArray(config?.theatre) ? config.theatre : []);
  bonusSaison = new Set(Array.isArray(config?.bonus_saison) ? config.bonus_saison : []);
  carnageDesactive = config?.carnage_desactive === true;
  if (Number(config?.seuil_equilibrage) > 0) seuil = Number(config.seuil_equilibrage);
  if (["fixe_joker", "fixe_horizontal"].includes(config?.equilibrage)) methodeEquilibrage = config.equilibrage;
  if (Number(config?.seuil_horizontal) > 0) seuilHorizontal = Number(config.seuil_horizontal);
  limitesEquilibrage = config?.limites_equilibrage || null;
}

// Limites des bans calculés par palier (cf. getLimitesEquilibrage,
// api/_lib/personnages.js).
let limitesEquilibrage = null;
// Points d'écart par ban horizontal ("fixe_horizontal", cf.
// getSeuilHorizontal, api/_lib/personnages.js).
let seuilHorizontal = 200;
const NOMS_PALIERS = { 1: "Sardine", 2: "Carpe", 3: "Dauphin", 4: "Baleine" };

function htmlLimitesEquilibrage() {
  if (!limitesEquilibrage) return "";
  return `
    <div class="tableau-conteneur tableau-paliers-tc">
      <table class="tableau-theorycraft">
        <thead><tr><th>Draft</th><th>Persos min</th><th>Seuil bas</th><th>Seuil haut</th><th>Plancher</th><th>Box max (hors full)</th></tr></thead>
        <tbody>${Object.entries(NOMS_PALIERS).map(([palier, nom]) => {
          const l = limitesEquilibrage[palier] || {};
          return `<tr><td>${nom}${palier === "2" ? " (et mêlée générale)" : ""}</td><td>${l.min_persos}</td><td>${l.seuil_bas}</td><td>${l.seuil_haut}</td><td>${l.plancher}</td><td>${l.points_max_box}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </div>`;
}

// Échange de 5 bans contre 1 joker : toutes les méthodes (cf.
// echangerBansContreJoker, api/_lib/draft.js).
const TEXTE_ECHANGE_JOKER = "<p><strong>Échange contre un joker</strong> : celui qui bannit peut, une seule fois par draft, échanger 5 de ses bans d'équilibrage contre 1 ban joker (un personnage de la box adverse, interdit à l'adversaire : toi, tu peux encore le picker). Il s'ajoute au joker éventuellement déjà accordé. L'échange peut être annulé tant que les bans ne sont pas confirmés.</p>";

// Section "Bans d'équilibrage" selon la méthode en vigueur.
function htmlBansEquilibrage(paliers) {
  return htmlMethodeEquilibrage(paliers) + TEXTE_ECHANGE_JOKER +
    (methodeEquilibrage === "fixe_horizontal" ? htmlBansHorizontaux() : "");
}

// Bans horizontaux ("fixe_horizontal", cf. calculerBansHorizontaux,
// api/_lib/draft.js).
function htmlBansHorizontaux() {
  return `
    <h3>Bans horizontaux</h3>
    <p class="formule-tc">
      personnages horizontaux d'une box = ceux qui ne sont jamais entrés dans son top 12 pendant le calcul des bans d'équilibrage<br>
      valeur = ses points + sa signature, ou une arme libre jamais entrée dans le top 12<br>
      somme horizontale = valeur des personnages horizontaux encore disponibles après les bans d'équilibrage<br>
      bans horizontaux = ⌊ | somme J1 − somme J2 | / ${seuilHorizontal} ⌋
    </p>
    <p>Après les bans d'équilibrage, le joueur dont la somme horizontale est la plus petite bannit ce nombre de personnages, seulement parmi les personnages horizontaux de son adversaire. Ce sont des bans normaux : un personnage que les 2 box ont est retiré des 2. Un personnage horizontal banni pendant les bans d'équilibrage ne compte plus dans la somme. Le nombre est figé ; il baisse seulement s'il ne reste plus assez de personnages horizontaux à bannir, ou si une box passerait sous le nombre de persos minimum.</p>
    <p>Exemple : 2 joueurs à la même verticalité, mais 1000 points de personnages horizontaux d'un côté et 2000 de l'autre : le premier a ${Math.floor(1000 / seuilHorizontal)} bans horizontaux sur les personnages horizontaux du second. Ils sont gardés pour les revanches ; en mode carnage, il n'y en a jamais.</p>`;
}

function htmlMethodeEquilibrage(paliers) {
  if (methodeEquilibrage === "ancien") {
    return `
    <p class="formule-tc">
      écart = | points box J1 − points box J2 |<br>
      bans d'équilibrage = ⌊ écart / ${seuil} ⌋
    </p>
    <p>Le joueur avec la box la plus faible bannit ce nombre de personnages avant le tirage J1 / J2 et du boss. Les bans d'équilibrage sont gardés pour les revanches. En mode carnage, il n'y en a jamais.</p>
    <div class="tableau-conteneur tableau-paliers-tc">
      <table class="tableau-theorycraft">
        <thead><tr><th>Écart entre les box</th><th>Bans d'équilibrage</th></tr></thead>
        <tbody>${paliers}<tr><td>…</td><td>+1 tous les ${seuil} pts</td></tr></tbody>
      </table>
    </div>`;
  }
  // Bans calculés + joker ("fixe_joker").
  return `
    <p class="formule-tc">
      valeur d'un personnage = ses points + ceux de sa meilleure arme signature dans la box<br>
      armes libres (copies en double, signatures sans leur personnage, armes perma et armes sans personnage) : une par personnage sans sa signature<br>
      horizontalité = nombre de personnages qui valent des points<br>
      verticalité = moyenne des 12 meilleurs personnages<br>
      écart d'équipe prévu = 4 × écart de verticalité<br>
      bans d'équilibrage = nombre de bans qui ramène l'écart prévu à 25 ou moins, en retirant à chaque fois le personnage qui réduit le plus l'écart (un personnage que les 2 box ont est retiré des 2)
    </p>
    <p>Le nombre de bans est calculé d'après les 2 box, sans plafond : le joueur à la verticalité la plus faible (le petit joueur) choisit seulement quels personnages il bannit, avant le tirage J1 / J2 et du boss. Un personnage que les 2 box ont est retiré des 2 : bannir lui coûte aussi un de ses persos. D'où des limites, selon le <strong>top 12</strong> (somme des 12 meilleurs personnages avec leur arme) de chaque box au départ :</p>
    <ul class="notes-theorycraft">
      <li><strong>Petit joueur au-dessus du seuil bas</strong> : dès qu'un ban ferait passer son top 12 sous le seuil bas, il reçoit 1 <strong>ban joker</strong> à la place (un personnage de la box adverse, interdit à l'adversaire : toi, tu peux encore le picker).</li>
      <li><strong>Petit joueur sous le seuil bas, adversaire au-dessus du seuil haut</strong> : ban joker dès qu'un ban toucherait un de ses propres personnages.</li>
      <li><strong>Petit joueur sous le seuil bas, adversaire entre les 2 seuils</strong> : pas de joker, les 2 top 12 doivent rester au-dessus du plancher.</li>
      <li><strong>Les 2 sous le seuil bas</strong> : pas de joker.</li>
      <li>Aucune box ne descend sous le nombre de persos minimum de la draft ; si un ban y obligerait, même règle : le joker, s'il est permis.</li>
      <li>Après le joker, seuls les bans de personnages que le petit joueur n'a pas continuent.</li>
    </ul>
    ${htmlLimitesEquilibrage()}
    <p>Si l'écart prévu reste au-dessus de 30 malgré tout, le match n'est pas équilibrable : les joueurs peuvent revenir au choix des box si une autre combinaison de leurs box s'équilibre (seulement celles-là), ou annuler le match. Si aucune combinaison ne s'équilibre, le match est annulé d'office, ne compte pas et les administrateurs en sont prévenus ; en classé, ces 2 joueurs ne sont plus mis face à face tant qu'aucun des 2 n'a modifié son compte. En entraînement, tu es prévenu et tu choisis de continuer ou de changer de box.</p>
    <p><strong>Armes libres</strong> : chaque copie en double d'une arme signature, chaque arme signature dont le personnage n'est pas dans la box, et chaque arme qui n'est la signature de personne (armes perma, Ultime soupir…) est donnée à un personnage qui n'a pas sa propre signature, du même type d'arme : une arme support va à un support ou un sub-dps, une autre arme à un sub-dps ou un dps. Elle compte pour la même valeur que dans les points de la box : valeur alternative pour les copies en double et les signatures sans leur personnage, pleine valeur pour la 1re copie d'une arme qui n'est la signature de personne. Une arme par personnage, attribuée là où elle fait le plus monter la verticalité (de la plus forte à la plus faible). Ainsi, une box avec beaucoup d'armes est mieux prise en compte.</p>
    <p>Quand un personnage est banni dans le calcul, son arme signature reste dans la box comme arme libre si les 2 box ont moins de 4000 points d'écart ; à 4000 points d'écart ou plus, elle part avec lui, pour que chaque ban retire davantage.</p>
    <p>Pourquoi 12 : c'est ce qu'il reste à un joueur une fois les bans et les picks adverses passés, et ce qui prédit le mieux l'écart entre les équipes dans les simulations de drafts. Les bans d'équilibrage sont gardés pour les revanches. En mode carnage, il n'y en a jamais.</p>`;
}

function points(item, vue) {
  if (vue === "sommes") return sommesPerso(item);
  const { champ, libelles } = COLONNES[vue];
  return Array.from({ length: libelles.length }, (_, i) => Number(item[champ]?.[i] ?? 0));
}

// -> [signature R1, C0R1, ..., C6R1] (cf. COLONNES.sommes).
function sommesPerso(perso) {
  const arme = trouverArmeSignature(armes, perso);
  const signa = arme ? Number(arme.PPW?.[0] ?? 0) : 0;
  return [signa, ...Array.from({ length: 7 }, (_, c) => Number(perso.PPC?.[c] ?? 0) + signa)];
}

// ---- Onglets ----

// Onglet ouvert gardé dans l'adresse (#characters, #weapons, #sommes,
// #boss, #equilibrage) : lien direct et retour au même onglet au
// rechargement.
const ONGLETS = ["characters", "weapons", "sommes", "boss", "equilibrage"];

function ouvrirOnglet(nom) {
  onglet = nom;
  history.replaceState(null, "", `#${nom}`);
  document.querySelectorAll(".onglet-theorycraft").forEach(bouton => {
    const actif = bouton.dataset.onglet === nom;
    bouton.classList.toggle("active", actif);
    bouton.setAttribute("aria-selected", String(actif));
  });
  const tableau = nom === "characters" || nom === "weapons" || nom === "sommes";
  document.getElementById("panneau-points").hidden = !tableau;
  document.getElementById("panneau-boss").hidden = nom !== "boss";
  document.getElementById("panneau-equilibrage").hidden = nom !== "equilibrage";
  if (tableau) {
    filtres = creerFiltres();
    tri = null;
    document.getElementById("recherche-theorycraft").value = "";
    rendreTableau();
  } else if (nom === "boss") {
    rendreBoss();
  } else {
    rendreEquilibrage();
  }
}

// ---- Personnages / armes : filtres et tri ----

// Filtre élément : un groupe (Voyageur, une version par élément) maîtrise
// tous les éléments (omni).
function correspondElements(item) {
  return filtres.elements.has(item.element) || (!!item.groupe && filtres.elements.has("all"));
}

function itemsAffiches() {
  const vue = onglet;
  const persos = vue !== "weapons";
  const liste = persos ? personnages : armes;
  const champType = persos ? "arme" : "type";
  const recherche = document.getElementById("recherche-theorycraft").value.trim().toLowerCase();

  const items = liste.filter(item => {
    if (recherche && !item.nom.toLowerCase().includes(recherche)) return false;
    if (persos && filtres.elements.size && !correspondElements(item)) return false;
    if (filtres.armes.size && !filtres.armes.has(item[champType])) return false;
    if (persos && filtres.etoiles.size && !filtres.etoiles.has(String(item.rarete))) return false;
    if (persos && filtres.voeux.size && !filtres.voeux.has(getVoeu(item))) return false;
    if (persos && filtres.factions.size && !filtres.factions.has(item.faction)) return false;
    if (persos && filtres.categories.size && !filtres.categories.has(item.categorie)) return false;
    if (!persos && !armeCorrespondCategories(item, [...filtres.categoriesArmes])) return false;
    if (persos && filtres.buffes && !buffs.has(item.id)) return false;
    if (persos && filtres.bonusSaison && !bonusSaison.has(item.id)) return false;
    return true;
  });

  if (!tri) return filtres.elements.size || filtres.armes.size ? trierParFiltres(items, champType) : items;
  return items
    .map((item, index) => ({ item, index, points: points(item, vue) }))
    .sort((a, b) => {
      const ecart = tri.cle === "nom"
        ? a.item.nom.localeCompare(b.item.nom, "fr", { sensitivity: "base" })
        : b.points[tri.cle] - a.points[tri.cle];
      return (ecart * tri.sens) || (a.index - b.index);
    })
    .map(e => e.item);
}

// Éléments et / ou armes filtrés, sans tri de colonne : groupés dans l'ordre
// des filtres choisis, puis par rareté, puis dans l'ordre de sortie (comme
// la page Administration).
function trierParFiltres(items, champType) {
  const ordreElements = [...filtres.elements];
  const ordreArmes = [...filtres.armes];
  const rangElement = item => ordreElements.indexOf(filtres.elements.has(item.element) ? item.element : "all");
  const rangArme = item => ordreArmes.indexOf(item[champType]);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      (rangElement(a.item) - rangElement(b.item)) ||
      (rangArme(a.item) - rangArme(b.item)) ||
      (rangRarete(b.item) - rangRarete(a.item)) ||
      (a.index - b.index))
    .map(e => e.item);
}

function rendreFiltres() {
  const persos = onglet !== "weapons";
  const icones = (valeurs, set, cle) => Object.entries(valeurs).map(([valeur, src]) =>
    `<button type="button" class="filtre-tc filtre-icone${set.has(valeur) ? " active" : ""}" data-filtre="${cle}" data-valeur="${valeur}" title="${valeur}"><img src="${src}" alt="${valeur}"></button>`
  ).join("");
  const textes = (valeurs, set, cle) => Object.entries(valeurs).map(([valeur, libelle]) =>
    `<button type="button" class="filtre-tc filtre-texte${set.has(valeur) ? " active" : ""}" data-filtre="${cle}" data-valeur="${valeur}">${libelle}</button>`
  ).join("");

  document.getElementById("filtres-theorycraft").innerHTML = `
    ${persos ? `<div class="groupe-tc">${icones(ICONES_ELEMENTS_TRI, filtres.elements, "elements")}</div>` : ""}
    <div class="groupe-tc">${icones(ICONES_TYPES_ARMES_TRI, filtres.armes, "armes")}</div>
    ${persos ? `
      <div class="groupe-tc">${textes({ 5: "5★", 4: "4★", 3: "3★" }, filtres.etoiles, "etoiles")}</div>
      <div class="groupe-tc">${Object.entries(VOEUX).map(([valeur, voeu]) =>
        `<button type="button" class="filtre-tc filtre-icone${filtres.voeux.has(valeur) ? " active" : ""}" data-filtre="voeux" data-valeur="${valeur}" title="${voeu.nom}"><img src="${voeu.image}" alt="${voeu.nom}"></button>`).join("")}</div>
      <div class="groupe-tc">${Object.entries(FACTIONS).map(([valeur, faction]) =>
        `<button type="button" class="filtre-tc filtre-icone${filtres.factions.has(valeur) ? " active" : ""}" data-filtre="factions" data-valeur="${valeur}" title="${faction.nom}"><img src="${faction.image}" alt="${faction.nom}"></button>`).join("")}</div>
      <div class="groupe-tc">${textes(CATEGORIES, filtres.categories, "categories")}</div>
      <div class="groupe-tc">
        <button type="button" class="filtre-tc filtre-texte${filtres.buffes ? " active" : ""}" data-bascule="buffes" title="Buffés par le théâtre du mois">Buffés théâtre</button>
        <button type="button" class="filtre-tc filtre-texte${filtres.bonusSaison ? " active" : ""}" data-bascule="bonusSaison" title="Bonus de saison (trophées en classé)">Bonus de saison</button>
      </div>` : `
      <div class="groupe-tc">${textes(CATEGORIES_ARMES_FILTRE, filtres.categoriesArmes, "categoriesArmes")}</div>`}
  `;
}

// ---- Valeurs alternatives (en rouge) ----
// Perso : malus sans ses persos en synergie (cf. commun/synergies.js,
// synergiesPersos chargé par commun/cartes.js) ; arme : valeur alternative
// (arme.alternatif %, copie en double ou signature sans son perso).

// Nom d'un id de la draft (Voyageur : "traveler").
function nomPersoDraft(id) {
  const perso = personnages.find(p => (p.groupe || p.id) === id);
  if (!perso) return id;
  return perso.groupe ? perso.nom.replace(/\s+\S+$/, "") : perso.nom;
}

function htmlSynergieTc(perso) {
  const synergie = synergiesPersos[perso.id];
  if (!synergie) return "";
  const parAbsent = Math.round(synergie.malus / synergie.persos.length);
  return `<span class="valeur-alternative-tc" title="Sans aucun de ces persos dans la box : −${synergie.malus} pts (−${parAbsent} par perso absent)">−${synergie.malus}</span> sans ${synergie.persos.map(id => echapper(nomPersoDraft(id))).join(", ")}`;
}

function htmlAlternativeArmeTc(arme) {
  const pourcentage = arme.alternatif ?? 100;
  if (pourcentage === 100) return "";
  const valeurs = points(arme, "weapons").map(p => Math.round(p * pourcentage / 100));
  return `<span class="valeur-alternative-tc" title="Copie en double, ou arme signature sans son perso dans la box">${pourcentage} % : ${valeurs.join(" / ")}</span>`;
}

function rendreEntete() {
  const { libelles } = COLONNES[onglet];
  const persos = onglet === "characters";
  const fleche = cle => tri?.cle === cle ? `<span class="fleche-tc">${tri.sens === 1 ? "▼" : "▲"}</span>` : "";

  if (onglet === "sommes") {
    document.getElementById("entete-theorycraft").innerHTML = `
      <tr>
        <th class="col-nom triable" data-tri="nom" title="Trier par nom">Personnage${fleche("nom")}</th>
        ${libelles.map((libelle, index) => `<th class="triable${index === 0 ? " col-signa-tc" : ""}" data-tri="${index}" title="Trier par ${index === 0 ? "points de l'arme signature R1" : `${libelle} (perso C${index - 1} + signature R1)`}">${libelle}${fleche(index)}</th>`).join("")}
      </tr>`;
    return;
  }

  document.getElementById("entete-theorycraft").innerHTML = `
    <tr>
      <th class="col-nom triable" data-tri="nom" title="Trier par nom">${persos ? "Personnage" : "Arme"}${fleche("nom")}</th>
      ${libelles.map((libelle, index) => `<th class="triable" data-tri="${index}" title="Trier par ${libelle}">${libelle}${fleche(index)}</th>`).join("")}
      ${persos ? `<th class="col-bonus-saison" title="En match classé : +3 trophées par perso de l'équipe ayant le bonus (gain augmenté, perte réduite)">Bonus de saison</th>` : ""}
      ${persos ? `<th class="col-alternative-tc" title="Points perdus dans une box sans ses persos en synergie">Synergie</th>` : `<th class="col-alternative-tc" title="Points d'une copie en double, ou d'une arme signature sans son perso dans la box">Valeur alt.</th>`}
    </tr>
    ${persos ? `
      <tr class="ligne-modes">
        <th class="col-nom">Mode des bonus</th>
        ${libelles.map((_, index) => {
          const bonus = BONUS.find(b => b.index === index);
          return bonus ? `<th class="mode-tc ${modes[bonus.cle]}">${LIBELLES_MODES[modes[bonus.cle]]}</th>` : "<th></th>";
        }).join("")}
        <th></th>
        <th></th>
      </tr>` : ""}
  `;
}

function rendreCorps() {
  const vue = onglet;
  const persos = vue === "characters";
  const items = itemsAffiches();
  const total = (vue === "weapons" ? armes : personnages).length;
  document.getElementById("compte-theorycraft").textContent =
    `${items.length} / ${total} ${vue === "weapons" ? "armes" : "personnages"}`;

  const corps = document.getElementById("corps-theorycraft");
  if (vue === "sommes") {
    corps.innerHTML = items.map(item => {
      const [signa, ...sommes] = points(item, vue);
      const arme = trouverArmeSignature(armes, item);
      return `
        <tr>
          <td class="col-nom">
            <span class="miniature-tc ${classeFondRarete(item.rarete)}"><img src="../DB/${echapper(item.image)}" alt="" loading="lazy"></span>
            <span class="nom-tc">${echapper(item.nom)}</span>
          </td>
          <td class="col-signa-tc">
            ${arme ? `<span class="signa-tc"><span class="miniature-tc ${classeFondRarete(arme.rarete)}"><img src="../DB/${echapper(arme.image)}" alt="" loading="lazy"></span><span class="nom-signa-tc">${echapper(arme.nom)}</span><strong>${signa}</strong></span>` : `<span class="sans-signa-tc" title="Pas d'arme signature">—</span>`}
          </td>
          ${sommes.map(somme => `<td>${somme}</td>`).join("")}
        </tr>`;
    }).join("");
    return;
  }
  corps.innerHTML = items.map(item => `
    <tr>
      <td class="col-nom">
        <span class="miniature-tc ${classeFondRarete(item.rarete)}"><img src="../DB/${echapper(item.image)}" alt="" loading="lazy"></span>
        <span class="nom-tc">${echapper(item.nom)}</span>
        ${persos ? `<button type="button" class="btn-apercu-tc" data-id="${echapper(item.id)}" title="Voir toutes les combinaisons de points">Aperçu</button>` : ""}
      </td>
      ${points(item, vue).map((valeur, index) => `
        <td class="${persos && index === 9 && buffs.has(item.id) ? "avec-buff" : ""}"${persos && index === 9 && buffs.has(item.id) ? ` title="Buffé par le théâtre du mois"` : ""}>${valeur}</td>`).join("")}
      ${persos ? `<td class="col-bonus-saison">${bonusSaison.has(item.id) ? `+3 ${ICONE_TROPHEE}` : ""}</td>` : ""}
      <td class="col-alternative-tc">${persos ? htmlSynergieTc(item) : htmlAlternativeArmeTc(item)}</td>
    </tr>`).join("");
}

function rendreTableau() {
  const persos = onglet === "characters";
  document.getElementById("aide-points").innerHTML = onglet === "sommes"
    ? `Chaque personnage avec son arme signature R1 : C0R1 à C6R1 = points de constellation (sans bonus de niveau ni de théâtre) + points de la signature R1 (0 sans signature). Clic sur un titre de colonne pour trier.`
    : persos
    ? `Points de constellation (C0 à C6), puis les bonus de niveau 95 / 100 et du théâtre, chacun <strong>ajouté</strong> ou <strong>multiplié</strong> aux points de constellation selon le mode affiché sous le titre de la colonne. Le bonus théâtre ne compte que pour les personnages buffés par le théâtre du mois (case dorée). <strong>Aperçu</strong> : toutes les combinaisons d'un personnage. Clic sur un titre de colonne pour trier.`
    : `Points de chaque raffinement (R1 à R5). Chaque copie d'une arme dans une box compte. Clic sur un titre de colonne pour trier.`;
  rendreFiltres();
  rendreEntete();
  rendreCorps();
}

function cyclerTriTc(cle) {
  if (!tri || tri.cle !== cle) tri = { cle, sens: 1 };
  else if (tri.sens === 1) tri.sens = -1;
  else tri = null;
  rendreEntete();
  rendreCorps();
}

function initialiserTableau() {
  document.getElementById("filtres-theorycraft").addEventListener("click", event => {
    const bouton = event.target.closest(".filtre-tc");
    if (!bouton) return;
    if (bouton.dataset.bascule) {
      filtres[bouton.dataset.bascule] = !filtres[bouton.dataset.bascule];
    } else {
      const set = filtres[bouton.dataset.filtre];
      const valeur = bouton.dataset.valeur;
      if (bouton.dataset.filtre === "factions") basculerFiltreFaction(set, valeur);
      else if (set.has(valeur)) set.delete(valeur);
      else {
        // Omni et éléments individuels exclusifs (le Voyageur est dans les 2).
        if (bouton.dataset.filtre === "elements") {
          if (valeur === "all") set.clear();
          else set.delete("all");
        }
        set.add(valeur);
      }
    }
    rendreFiltres();
    rendreCorps();
  });
  document.getElementById("recherche-theorycraft").addEventListener("input", rendreCorps);
  document.getElementById("clear-theorycraft").addEventListener("click", () => {
    filtres = creerFiltres();
    tri = null;
    document.getElementById("recherche-theorycraft").value = "";
    rendreTableau();
  });
  document.getElementById("entete-theorycraft").addEventListener("click", event => {
    const titre = event.target.closest("[data-tri]");
    if (titre) cyclerTriTc(titre.dataset.tri === "nom" ? "nom" : Number(titre.dataset.tri));
  });
  document.getElementById("corps-theorycraft").addEventListener("click", event => {
    const bouton = event.target.closest(".btn-apercu-tc");
    if (bouton) ouvrirApercu(bouton.dataset.id);
  });
}

// ---- Aperçu : toutes les combinaisons d'un personnage ----
// Niveau (95 ou 100, aucun au 90) puis théâtre, chacun ajouté ou multiplié
// selon son mode ; arrondi à l'entier (cf. pointsPersonnage, commun/cartes.js).

function appliquerModificateur(valeur, cle, bonus) {
  return modes[cle] === "multiplication" ? valeur * bonus : valeur + bonus;
}

function pointsCombinaison(liste, constellation, niveau, theatre) {
  let resultat = liste[constellation];
  if (niveau === 95) resultat = appliquerModificateur(resultat, "niveau95", liste[7]);
  if (niveau === 100) resultat = appliquerModificateur(resultat, "niveau100", liste[8]);
  if (theatre) resultat = appliquerModificateur(resultat, "theatre", liste[9]);
  return Math.round(resultat);
}

function ouvrirApercu(id) {
  const perso = personnages.find(p => p.id === id);
  if (!perso) return;
  const liste = points(perso, "characters");
  document.getElementById("apercu-tc-titre").textContent = perso.nom;
  document.getElementById("apercu-tc-image").src = `../DB/${perso.image}`;
  document.getElementById("apercu-tc-miniature").className = `miniature-tc ${classeFondRarete(perso.rarete)}`;
  document.getElementById("apercu-tc-modes").innerHTML = BONUS.map(({ cle, index, libelle }) =>
    `${libelle} : <strong>${modes[cle] === "multiplication" ? "×" : "+"}${liste[index]}</strong>`).join(" · ") +
    (buffs.has(id) ? " · <span class=\"texte-buff\">buffé par le théâtre du mois</span>" : "") +
    (synergiesPersos[id] ? `<br>Synergie : ${htmlSynergieTc(perso)}` : "");

  const colonnes = [[90, false], [90, true], [95, false], [95, true], [100, false], [100, true]];
  document.getElementById("apercu-tc-tableau").innerHTML = `
    <thead>
      <tr>
        <th></th>
        ${colonnes.map(([niveau, theatre]) => `<th>Niv. ${niveau}${theatre ? "<br><span class=\"avec-theatre\">+ théâtre</span>" : ""}</th>`).join("")}
      </tr>
    </thead>
    <tbody>
      ${Array.from({ length: 7 }, (_, c) => `
        <tr>
          <th>C${c}</th>
          ${colonnes.map(([niveau, theatre]) => `<td>${pointsCombinaison(liste, c, niveau, theatre)}</td>`).join("")}
        </tr>`).join("")}
    </tbody>
  `;
  document.getElementById("modal-apercu-tc").hidden = false;
}

function initialiserApercu() {
  const modal = document.getElementById("modal-apercu-tc");
  const fermer = () => { modal.hidden = true; };
  document.getElementById("fermer-apercu-tc").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") fermer();
  });
}

// ---- Boss : résistances et probabilités de tirage ----
// Cf. tirerBossAleatoire (api/_lib/boss.js). Hors classé : catégorie tirée
// d'abord (mêmes poids que POIDS_CATEGORIES), puis boss uniforme dans la
// catégorie. Classé : tirage uniforme parmi les boss tirables.
const POIDS_CATEGORIES_BOSS = [
  { poids: 10, contient: estLegendeLocale },
  { poids: 3, contient: b => b.type === "carnage_boss" },
  { poids: 17, contient: b => !estLegendeLocale(b) && b.type !== "carnage_boss" }
];

function pourcentage(p) {
  return p > 0 ? `${(100 * p).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "—";
}

// Boss tirables (hors entraînement) : sans le carnage s'il est désactivé,
// jamais les world boss ni les légendes "world_boss_seulement" (mode Random
// world boss seulement).
const estTirable = b => b.type !== "world_boss" && b.world_boss_seulement !== true && !(carnageDesactive && b.type === "carnage_boss");

// Probabilité hors classé d'un boss (catégories vides ignorées).
function probaHorsClasse(b) {
  if (!estTirable(b)) return 0;
  const groupes = POIDS_CATEGORIES_BOSS.map(({ poids, contient }) => ({ poids, nb: boss.filter(x => estTirable(x) && contient(x)).length }));
  const total = groupes.filter(g => g.nb > 0).reduce((somme, g) => somme + g.poids, 0);
  const i = POIDS_CATEGORIES_BOSS.findIndex(({ contient }) => contient(b));
  return total > 0 ? groupes[i].poids / total / groupes[i].nb : 0;
}

function rendreBoss() {
  const nbClasse = boss.filter(b => estTirable(b) && estTirableEnClasse(b)).length;
  const enTete = ELEMENTS_RES.map(element =>
    `<th title="Résistance ${element}"><img class="icone-element-tc" src="${ICONES_ELEMENTS_TRI[element]}" alt="${element}"></th>`).join("");

  document.getElementById("panneau-boss").innerHTML = `
    <p class="aide-theorycraft">
      Résistances élémentaires en pourcentage (« Immunisé » : aucun dégât de cet élément). Le boss est tiré au hasard.
      Hors classé (room, matchmaking, entraînement, équipe) : 1 chance sur 3 de tomber sur une légende locale, 1 sur 10 sur un boss de carnage,
      le reste sur un boss hebdomadaire, puis chaque boss de la catégorie avec la même probabilité.
      En classé : les <strong>${nbClasse}</strong> boss tirables (boss hebdomadaires sauf Tartaglia, légendes locales à l'infini et boss de carnage)
      ont tous la même probabilité.
      ${carnageDesactive ? "<strong>Boss de carnage désactivés en ce moment</strong> (plus disponibles dans le jeu) : jamais tirés, sauf en entraînement." : ""}
    </p>
    <div class="tableau-conteneur">
      <table class="tableau-theorycraft tableau-boss-tc">
        <thead>
          <tr>
            <th class="col-nom">Boss</th>
            ${enTete}
            <th title="Room, matchmaking et entraînement">Proba. hors classé</th>
            <th title="Matchmaking classé">Proba. classé</th>
          </tr>
        </thead>
        <tbody>
          ${boss.map(b => `
            <tr>
              <td class="col-nom">
                <span class="images-boss-tc">${htmlImagesBoss(b, `loading="lazy"`)}</span>
                <span class="infos-boss-tc">
                  <span class="nom-tc">${echapper(b.nom)}</span>
                  <span class="type-boss-tc">${TYPES_BOSS[b.type] || echapper(b.type || "")}${b.world_boss_seulement ? ` · Random world boss${b.coop === false ? " (seul)" : ""}` : ""}${b.res_par_semaine ? " · résistances de cette semaine" : ""}</span>
                </span>
              </td>
              ${ELEMENTS_RES.map((_, i) => `<td${estImmunise(b.res?.[i]) ? ` class="immunise-tc"` : ""}>${texteResistance(b.res?.[i] ?? 0)}</td>`).join("")}
              <td>${pourcentage(probaHorsClasse(b))}</td>
              <td>${estTirable(b) && estTirableEnClasse(b) ? pourcentage(1 / nbClasse) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <ul class="notes-theorycraft">
      <li>Revanche : le boss de la manche précédente n'est jamais retiré, les autres boss de sa catégorie se partagent sa probabilité.</li>
      <li>Hors classé, le boss tiré est soumis au vote : il n'est relancé que si les deux joueurs veulent le relancer.</li>
      <li>Légendes locales « 1 fois par jour » : celles déjà tuées par l'un des deux joueurs depuis 4 h (heure de Paris) ne sont pas tirées, les autres légendes se partagent leur probabilité.</li>
      <li>Deux joueurs qui n'ont pas le même niveau du monde (ou dont l'un ne l'a pas renseigné) ne tombent jamais sur une légende locale : leurs PV dépendent du niveau du monde. Les boss de carnage et hebdomadaires se partagent alors leur probabilité (même rapport 3 / 17).</li>
      <li>Room privée et entraînement : le créateur peut aussi imposer le boss.</li>
    </ul>
  `;
}

// ---- Système d'équilibrage ----

function formuleBonus(cle, index) {
  return modes[cle] === "multiplication" ? `× bonus ${index === 9 ? "théâtre" : `niv. ${index === 7 ? 95 : 100}`}` : `+ bonus ${index === 9 ? "théâtre" : `niv. ${index === 7 ? 95 : 100}`}`;
}

function rendreEquilibrage() {
  const paliers = Array.from({ length: 5 }, (_, n) =>
    `<tr><td>${n * seuil} à ${(n + 1) * seuil - 1} pts</td><td>${n}</td></tr>`).join("");

  document.getElementById("panneau-equilibrage").innerHTML = `
    <h2>1. Points d'un personnage</h2>
    <p>Chaque personnage a des points selon sa constellation (C0 à C6) et trois bonus possibles (niveau 95, niveau 100, théâtre).</p>
    <p class="formule-tc">
      points = C<sub>constellation</sub><br>
      si niveau 95 : points = points ${formuleBonus("niveau95", 7)}<br>
      si niveau 100 : points = points ${formuleBonus("niveau100", 8)}<br>
      si buffé par le théâtre du mois : points = points ${formuleBonus("theatre", 9)}
    </p>
    <p>Modes actuels : ${BONUS.map(({ cle, libelle }) => `${libelle} en <strong>${modes[cle]}</strong>`).join(", ")}. Le niveau des personnages est celui renseigné par le joueur dans Mon compte (90 sans bonus par défaut).</p>
    <p>Voyageur : un seul élément compte, celui qui rapporte le plus de points.</p>
    <p><strong>Synergies</strong> (valeur alternative, en rouge dans Mon compte et la colonne Synergie) : certains personnages perdent des points dans une box qui ne contient pas les personnages avec lesquels ils fonctionnent.</p>
    <p class="formule-tc">
      points = points − malus × (persos en synergie absents de la box / persos en synergie)<br>
      arrondi, après les bonus de niveau et de théâtre, jamais sous 0
    </p>
    <p>Exemple : Lauma en synergie avec Nefer et Columbina, malus 20 : sans Columbina, elle perd 10 points ; sans les 2, 20 points. Ces points comptent partout : points des box, plafond des box opti, équilibrage.</p>

    <h2>2. Points d'une arme</h2>
    <p class="formule-tc">points = R<sub>raffinement</sub></p>
    <p>Chaque copie d'une arme présente dans la box compte (onglet Armes). Certaines armes ont une <strong>valeur alternative</strong> (25, 50 ou 75 % de leurs points, arrondie à l'entier), qui remplace leurs points dans 2 cas :</p>
    <ul class="notes-theorycraft">
      <li>pour chaque copie en double (la meilleure copie compte en entier),</li>
      <li>et pour une arme signature quand son personnage n'est pas dans la box.</li>
    </ul>
    <p>Si les 2 cas se cumulent, la réduction ne s'applique qu'une fois.</p>

    <h2>3. Points d'une box</h2>
    <p class="formule-tc">points de la box = Σ points des personnages + Σ points des armes</p>
    <p>Seuls les personnages et armes de la box choisie pour le match comptent (Full box ou box opti).</p>
    <p>La full box est toujours jouable. Une box opti ne l'est que si ses points ne dépassent pas le plafond du palier de la draft : ${Object.entries(NOMS_PALIERS).map(([palier, nom]) => `${nom.toLowerCase()} ${limitesEquilibrage?.[palier]?.points_max_box ?? "?"}`).join(", ")} points. Le palier de la draft est celui du mode :</p>
    <ul class="notes-theorycraft">
      <li>carpe en mêlée générale et en carnage</li>
      <li>en mode classique, le plus petit des 2 joueurs : une baleine qui affronte une sardine ne peut venir qu'avec sa full box ou une opti sous le plafond sardine.</li>
    </ul>

    <h2>4. Bans d'équilibrage</h2>
    ${htmlBansEquilibrage(paliers)}
  `;
}

// ---- Démarrage ----

async function demarrer() {
  if (!await verifierAcces()) {
    window.location.replace("/");
    return;
  }
  document.getElementById("zone-theorycraft").hidden = false;

  const etat = document.getElementById("etat-theorycraft");
  try {
    await chargerDonnees();
  } catch (erreur) {
    console.error(erreur);
    etat.textContent = "Impossible de charger les données.";
    return;
  }
  etat.hidden = true;

  document.querySelectorAll(".onglet-theorycraft").forEach(bouton => {
    bouton.addEventListener("click", () => ouvrirOnglet(bouton.dataset.onglet));
  });
  initialiserTableau();
  initialiserApercu();
  const demande = location.hash.slice(1);
  ouvrirOnglet(ONGLETS.includes(demande) ? demande : "characters");
}

demarrer();
