// Page Theorycraft : connectés seulement, sauf shadowbans (user.theorycraft,
// cf. api/auth/me.js). Les autres sont renvoyés à l'accueil, comme si la
// page n'existait pas.
//
// Lecture seule : points des personnages et des armes (même tableau que la
// page Administration, masqués exclus), résistances et probabilités de
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
const TYPES_BOSS_CLASSE = ["weekly_boss", "legende_locale_infinie"];
const ELEMENTS_RES = ["pyro", "hydro", "electro", "cryo", "anemo", "geo", "dendro"];

// Seuil par défaut si l'API ne le donne pas (SEUIL_EQUILIBRAGE).
const SEUIL_PAR_DEFAUT = 200;

let personnages = [];
let armes = [];
let boss = [];
let modes = {};
let buffs = new Set();
let bonusSaison = new Set();
let seuil = SEUIL_PAR_DEFAUT;

let onglet = null;
let filtres = creerFiltres();
let tri = null; // { cle: "nom" | index de colonne, sens: 1 | -1 }

function creerFiltres() {
  return {
    elements: new Set(),
    armes: new Set(),
    etoiles: new Set(),
    voeux: new Set(),
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
  if (Number(config?.seuil_equilibrage) > 0) seuil = Number(config.seuil_equilibrage);
}

function points(item, vue) {
  const { champ, libelles } = COLONNES[vue];
  return Array.from({ length: libelles.length }, (_, i) => Number(item[champ]?.[i] ?? 0));
}

// ---- Onglets ----

// Onglet ouvert gardé dans l'adresse (#characters, #weapons, #boss,
// #equilibrage) : lien direct et retour au même onglet au rechargement.
const ONGLETS = ["characters", "weapons", "boss", "equilibrage"];

function ouvrirOnglet(nom) {
  onglet = nom;
  history.replaceState(null, "", `#${nom}`);
  document.querySelectorAll(".onglet-theorycraft").forEach(bouton => {
    const actif = bouton.dataset.onglet === nom;
    bouton.classList.toggle("active", actif);
    bouton.setAttribute("aria-selected", String(actif));
  });
  const tableau = nom === "characters" || nom === "weapons";
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
  const persos = vue === "characters";
  const liste = persos ? personnages : armes;
  const champType = persos ? "arme" : "type";
  const recherche = document.getElementById("recherche-theorycraft").value.trim().toLowerCase();

  const items = liste.filter(item => {
    if (recherche && !item.nom.toLowerCase().includes(recherche)) return false;
    if (persos && filtres.elements.size && !correspondElements(item)) return false;
    if (filtres.armes.size && !filtres.armes.has(item[champType])) return false;
    if (persos && filtres.etoiles.size && !filtres.etoiles.has(String(item.rarete))) return false;
    if (persos && filtres.voeux.size && !filtres.voeux.has(getVoeu(item))) return false;
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
  const persos = onglet === "characters";
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
      <div class="groupe-tc">${textes(CATEGORIES, filtres.categories, "categories")}</div>
      <div class="groupe-tc">
        <button type="button" class="filtre-tc filtre-texte${filtres.buffes ? " active" : ""}" data-bascule="buffes" title="Buffés par le théâtre du mois">Buffés théâtre</button>
        <button type="button" class="filtre-tc filtre-texte${filtres.bonusSaison ? " active" : ""}" data-bascule="bonusSaison" title="Bonus de saison (trophées en classé)">Bonus de saison</button>
      </div>` : `
      <div class="groupe-tc">${textes(CATEGORIES_ARMES_FILTRE, filtres.categoriesArmes, "categoriesArmes")}</div>`}
  `;
}

function rendreEntete() {
  const { libelles } = COLONNES[onglet];
  const persos = onglet === "characters";
  const fleche = cle => tri?.cle === cle ? `<span class="fleche-tc">${tri.sens === 1 ? "▼" : "▲"}</span>` : "";

  document.getElementById("entete-theorycraft").innerHTML = `
    <tr>
      <th class="col-nom triable" data-tri="nom" title="Trier par nom">${persos ? "Personnage" : "Arme"}${fleche("nom")}</th>
      ${libelles.map((libelle, index) => `<th class="triable" data-tri="${index}" title="Trier par ${libelle}">${libelle}${fleche(index)}</th>`).join("")}
      ${persos ? `<th class="col-bonus-saison" title="En match classé : +3 trophées par perso de l'équipe ayant le bonus (gain augmenté, perte réduite)">Bonus de saison</th>` : ""}
    </tr>
    ${persos ? `
      <tr class="ligne-modes">
        <th class="col-nom">Mode des bonus</th>
        ${libelles.map((_, index) => {
          const bonus = BONUS.find(b => b.index === index);
          return bonus ? `<th class="mode-tc ${modes[bonus.cle]}">${LIBELLES_MODES[modes[bonus.cle]]}</th>` : "<th></th>";
        }).join("")}
        <th></th>
      </tr>` : ""}
  `;
}

function rendreCorps() {
  const vue = onglet;
  const persos = vue === "characters";
  const items = itemsAffiches();
  const total = (persos ? personnages : armes).length;
  document.getElementById("compte-theorycraft").textContent =
    `${items.length} / ${total} ${persos ? "personnages" : "armes"}`;

  const corps = document.getElementById("corps-theorycraft");
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
    </tr>`).join("");
}

function rendreTableau() {
  const persos = onglet === "characters";
  document.getElementById("aide-points").innerHTML = persos
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
      if (set.has(valeur)) set.delete(valeur);
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
    (buffs.has(id) ? " · <span class=\"texte-buff\">buffé par le théâtre du mois</span>" : "");

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
// Tirage uniforme parmi les boss tirables (cf. tirerBossAleatoire,
// api/_lib/boss.js) : tous hors classé, boss hebdomadaires et légendes
// locales à l'infini en classé.

function pourcentage(n) {
  return n > 0 ? `${(100 / n).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %` : "—";
}

function rendreBoss() {
  const nbNonClasse = boss.length;
  const nbClasse = boss.filter(b => TYPES_BOSS_CLASSE.includes(b.type)).length;
  const enTete = ELEMENTS_RES.map(element =>
    `<th title="Résistance ${element}"><img class="icone-element-tc" src="${ICONES_ELEMENTS_TRI[element]}" alt="${element}"></th>`).join("");

  document.getElementById("panneau-boss").innerHTML = `
    <p class="aide-theorycraft">
      Résistances élémentaires en pourcentage. Le boss est tiré au hasard, chaque boss tirable avec la même probabilité :
      <strong>${nbNonClasse}</strong> boss hors classé (room, matchmaking, entraînement), <strong>${nbClasse}</strong> en classé
      (boss hebdomadaires et légendes locales à l'infini).
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
                  <span class="type-boss-tc">${TYPES_BOSS[b.type] || echapper(b.type || "")}</span>
                </span>
              </td>
              ${ELEMENTS_RES.map((_, i) => `<td>${Number(b.res?.[i] ?? 0)} %</td>`).join("")}
              <td>${pourcentage(nbNonClasse)}</td>
              <td>${TYPES_BOSS_CLASSE.includes(b.type) ? pourcentage(nbClasse) : "—"}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <ul class="notes-theorycraft">
      <li>Revanche : le boss de la manche précédente n'est jamais retiré, les autres se partagent sa probabilité.</li>
      <li>Hors classé, le boss tiré est soumis au vote : il n'est relancé que si les deux joueurs veulent le relancer.</li>
      <li>Légendes locales « 1 fois par jour » : celles déjà tuées par l'un des deux joueurs depuis 4 h (heure de Paris) ne sont pas tirées, les autres se partagent leur probabilité.</li>
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
    <p>Chaque personnage a des points par constellation (C0 à C6) et trois bonus (niveau 95, niveau 100, théâtre), réglés par les administrateurs (onglet Personnages).</p>
    <p class="formule-tc">
      points = C<sub>constellation</sub><br>
      si niveau 95 : points = points ${formuleBonus("niveau95", 7)}<br>
      si niveau 100 : points = points ${formuleBonus("niveau100", 8)}<br>
      si buffé par le théâtre du mois : points = points ${formuleBonus("theatre", 9)}<br>
      résultat arrondi à l'entier
    </p>
    <p>Modes actuels : ${BONUS.map(({ cle, libelle }) => `${libelle} en <strong>${modes[cle]}</strong>`).join(", ")}. Le niveau est celui renseigné par le joueur dans Mon compte (90 par défaut, sans bonus).</p>
    <p>Voyageur : un seul élément compte, celui qui rapporte le plus de points.</p>

    <h2>2. Points d'une arme</h2>
    <p class="formule-tc">points = R<sub>raffinement</sub></p>
    <p>Chaque copie d'une arme présente dans la box compte (onglet Armes).</p>

    <h2>3. Points d'une box</h2>
    <p class="formule-tc">points de la box = Σ points des personnages + Σ points des armes</p>
    <p>Seuls les personnages et armes de la box choisie pour le match comptent (Full box ou box sélectionnée).</p>

    <h2>4. Bans d'équilibrage</h2>
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
    </div>
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
