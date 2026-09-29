// Administration des points : PPC des personnages (C0..C6, niveau 95,
// niveau 100, théâtre) et PPW des armes (R1..R5), enregistrés dans Supabase
// via api/points.js (réservé aux administrateurs) et appliqués sur tout le
// site.

const COLONNES = {
  characters: {
    champ: "PPC",
    libelles: ["C0", "C1", "C2", "C3", "C4", "C5", "C6", "Niv. 95", "Niv. 100", "Théâtre"],
    // Cases calculables à partir de la précédente (*1,2) : C1..C6.
    derniereChaine: 6
  },
  weapons: {
    champ: "PPW",
    libelles: ["R1", "R2", "R3", "R4", "R5"],
    derniereChaine: 4
  }
};

// Bonus des niveaux 95 / 100 et du théâtre : ajoutés ou multipliés aux
// points de constellation, au choix des administrateurs.
const BONUS = [
  { cle: "niveau95", index: 7 },
  { cle: "niveau100", index: 8 },
  { cle: "theatre", index: 9 }
];

let vue = "characters";
let personnages = [];
let armes = [];
let valeurs = { characters: {}, weapons: {} }; // id -> liste de points
let modes = {};                                  // cle bonus -> "addition" | "multiplication"
let etatEnregistre = "";

// ---- Filtres et tri ----
// Personnages : élément, arme, étoiles, vœux, catégorie ; armes : élément,
// type. Pour les deux : à renseigner (tous les points à 0), modifiés depuis
// le dernier enregistrement, recherche. Tri : clic sur un titre de colonne
// (1er clic décroissant, 2e croissant, 3e ordre de sortie ; nom : A -> Z).
const CATEGORIES = { dps: "DPS", subdps: "Sub-DPS", support: "Support" };

let filtres = creerFiltres();
let tri = null; // { cle: "nom" | index de colonne, sens: 1 | -1 }

function creerFiltres() {
  return {
    elements: new Set(),
    armes: new Set(),
    etoiles: new Set(),
    voeux: new Set(),
    categories: new Set(),
    aRenseigner: false,
    modifies: false
  };
}

function listeVue() {
  return vue === "characters" ? personnages : armes;
}

// Points enregistrés d'un item (pour le filtre "modifiés").
function valeursEnregistrees(id) {
  return JSON.parse(etatEnregistre)[0][vue][id];
}

function itemsAffiches() {
  const recherche = document.getElementById("recherche-admin").value.trim().toLowerCase();
  const persos = vue === "characters";
  const champType = persos ? "arme" : "type";
  const nbConstellations = COLONNES[vue].derniereChaine + 1;

  const items = listeVue().filter(item => {
    const points = valeurs[vue][item.id];
    if (recherche && !item.nom.toLowerCase().includes(recherche)) return false;
    if (filtres.elements.size && !filtres.elements.has(item.element)) return false;
    if (filtres.armes.size && !filtres.armes.has(item[champType])) return false;
    if (persos && filtres.etoiles.size && !filtres.etoiles.has(String(item.rarete))) return false;
    if (persos && filtres.voeux.size && !filtres.voeux.has(getVoeu(item))) return false;
    if (persos && filtres.categories.size && !filtres.categories.has(item.categorie)) return false;
    if (filtres.aRenseigner && points.slice(0, nbConstellations).some(p => p !== 0)) return false;
    if (filtres.modifies && JSON.stringify(points) === JSON.stringify(valeursEnregistrees(item.id))) return false;
    return true;
  });

  if (!tri) return items;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ecart = tri.cle === "nom"
        ? a.item.nom.localeCompare(b.item.nom, "fr", { sensitivity: "base" })
        : valeurs[vue][b.item.id][tri.cle] - valeurs[vue][a.item.id][tri.cle];
      return (ecart * tri.sens) || (a.index - b.index);
    })
    .map(e => e.item);
}

function cyclerTriAdmin(cle) {
  if (!tri || tri.cle !== cle) tri = { cle, sens: 1 };
  else if (tri.sens === 1) tri.sens = -1;
  else tri = null;
  rendre();
}

// Barre des filtres (selon la vue).
function rendreFiltres() {
  const persos = vue === "characters";
  const icones = (valeurs, set, cle) => Object.entries(valeurs).map(([valeur, src]) =>
    `<button type="button" class="filtre-admin filtre-icone${set.has(valeur) ? " active" : ""}" data-filtre="${cle}" data-valeur="${valeur}" title="${valeur}"><img src="${src}" alt="${valeur}"></button>`
  ).join("");
  const textes = (valeurs, set, cle) => Object.entries(valeurs).map(([valeur, libelle]) =>
    `<button type="button" class="filtre-admin filtre-texte${set.has(valeur) ? " active" : ""}" data-filtre="${cle}" data-valeur="${valeur}">${libelle}</button>`
  ).join("");

  document.getElementById("filtres-admin").innerHTML = `
    <div class="groupe-admin">${icones(ICONES_ELEMENTS_TRI, filtres.elements, "elements")}</div>
    <div class="groupe-admin">${icones(ICONES_TYPES_ARMES_TRI, filtres.armes, "armes")}</div>
    ${persos ? `
      <div class="groupe-admin">${textes({ 5: "5★", 4: "4★", 3: "3★" }, filtres.etoiles, "etoiles")}</div>
      <div class="groupe-admin">${Object.entries(VOEUX).map(([valeur, voeu]) =>
        `<button type="button" class="filtre-admin filtre-icone${filtres.voeux.has(valeur) ? " active" : ""}" data-filtre="voeux" data-valeur="${valeur}" title="${voeu.nom}"><img src="${voeu.image}" alt="${voeu.nom}"></button>`).join("")}</div>
      <div class="groupe-admin">${textes(CATEGORIES, filtres.categories, "categories")}</div>` : ""}
    <div class="groupe-admin">
      <button type="button" class="filtre-admin filtre-texte${filtres.aRenseigner ? " active" : ""}" data-bascule="aRenseigner" title="Tous les points de ${persos ? "constellation" : "raffinement"} à 0">À renseigner</button>
      <button type="button" class="filtre-admin filtre-texte${filtres.modifies ? " active" : ""}" data-bascule="modifies" title="Modifiés depuis le dernier enregistrement">Modifiés</button>
    </div>
  `;
}

function initialiserFiltres() {
  document.getElementById("filtres-admin").addEventListener("click", event => {
    const bouton = event.target.closest(".filtre-admin");
    if (!bouton) return;
    if (bouton.dataset.bascule) {
      filtres[bouton.dataset.bascule] = !filtres[bouton.dataset.bascule];
    } else {
      const set = filtres[bouton.dataset.filtre];
      if (set.has(bouton.dataset.valeur)) set.delete(bouton.dataset.valeur);
      else set.add(bouton.dataset.valeur);
    }
    rendreFiltres();
    rendreCorps();
  });

  document.getElementById("clear-admin").addEventListener("click", () => {
    filtres = creerFiltres();
    tri = null;
    document.getElementById("recherche-admin").value = "";
    rendre();
  });

  document.getElementById("entete-admin").addEventListener("click", event => {
    const titre = event.target.closest("[data-tri]");
    if (!titre) return;
    cyclerTriAdmin(titre.dataset.tri === "nom" ? "nom" : Number(titre.dataset.tri));
  });
}

function etatActuel() {
  return JSON.stringify([valeurs, modes]);
}

// ---- Chargement ----

async function chargerSession() {
  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });
    return reponse.ok ? (await reponse.json()).user : null;
  } catch {
    return null;
  }
}

function copierValeurs(liste, champ, taille) {
  return Object.fromEntries(liste.map(item => [
    item.id,
    Array.from({ length: taille }, (_, i) => Number(item[champ]?.[i] ?? 0))
  ]));
}

async function chargerDonnees() {
  // Points déjà appliqués par cartes.js (JSON + modifications des admins).
  const [listePersos, listeArmes, config] = await Promise.all([chargerPersonnages(), chargerArmes(), chargerPointsAdmin()]);
  personnages = listePersos;
  armes = listeArmes;
  valeurs = {
    characters: copierValeurs(personnages, "PPC", COLONNES.characters.libelles.length),
    weapons: copierValeurs(armes, "PPW", COLONNES.weapons.libelles.length)
  };
  modes = Object.fromEntries(BONUS.map(({ cle }) => [cle, config?.modes?.[cle] === "multiplication" ? "multiplication" : "addition"]));
  etatEnregistre = etatActuel();
}

// ---- Tableau ----

function rendreEntete() {
  const { libelles } = COLONNES[vue];
  const modeBonus = index => BONUS.find(b => b.index === index);

  const fleche = cle => tri?.cle === cle ? `<span class="fleche-admin">${tri.sens === 1 ? "▼" : "▲"}</span>` : "";

  document.getElementById("entete-admin").innerHTML = `
    <tr>
      <th class="col-nom triable" data-tri="nom" title="Trier par nom">${vue === "characters" ? "Personnage" : "Arme"}${fleche("nom")}</th>
      ${libelles.map((libelle, index) => `<th class="triable" data-tri="${index}" title="Trier par ${libelle}">${libelle}${fleche(index)}</th>`).join("")}
    </tr>
    ${vue === "characters" ? `
      <tr class="ligne-modes">
        <th class="col-nom">Mode des bonus</th>
        ${libelles.map((_, index) => {
          const bonus = modeBonus(index);
          return bonus ? `<th>
            <select class="mode-bonus" data-cle="${bonus.cle}" title="Ajouté ou multiplié aux points de constellation">
              <option value="addition" ${modes[bonus.cle] === "addition" ? "selected" : ""}>+ Addition</option>
              <option value="multiplication" ${modes[bonus.cle] === "multiplication" ? "selected" : ""}>× Multiplication</option>
            </select>
          </th>` : "<th></th>";
        }).join("")}
      </tr>` : ""}
  `;
}

function rendreCorps() {
  const corps = document.getElementById("corps-admin");
  const items = itemsAffiches();

  document.getElementById("compte-admin").textContent =
    `${items.length} / ${listeVue().length} ${vue === "characters" ? "personnages" : "armes"}`;

  corps.innerHTML = items
    .map(item => `
      <tr>
        <td class="col-nom">
          <span class="miniature ${classeFondRarete(item.rarete)}"><img src="../DB/${item.image}" alt="" loading="lazy"></span>
          <span class="nom-admin"></span>
        </td>
        ${valeurs[vue][item.id].map((valeur, index) => `
          <td>
            <span class="case-admin">
              <input class="case-points" data-id="${item.id}" data-index="${index}" value="${valeur}" inputmode="decimal">
              <span class="apercu-points"></span>
            </span>
          </td>`).join("")}
      </tr>`)
    .join("");

  // Noms en texte (pas d'HTML venant des données).
  corps.querySelectorAll(".nom-admin").forEach((span, i) => { span.textContent = items[i].nom; });
}

function rendre() {
  document.querySelectorAll(".vue-admin").forEach(btn => btn.classList.toggle("active", btn.dataset.vue === vue));
  rendreFiltres();
  rendreEntete();
  rendreCorps();
  mettreAJourPied();
}

// ---- Saisie ----

// "12" -> 12 ; "*1,2" -> { multiplicateur: 1.2 } ; sinon null.
function lireSaisie(texte) {
  const brut = texte.trim().replace(",", ".");
  const multiplicateur = brut.match(/^[*x×]\s*(\d+(?:\.\d+)?)$/i);
  if (multiplicateur) return { multiplicateur: Number(multiplicateur[1]) };
  if (brut !== "" && Number.isFinite(Number(brut))) return { valeur: Number(brut) };
  return null;
}

// Points de constellation : entiers ; bonus en multiplication : décimales
// permises (ex. 1.1).
function normaliser(index, valeur) {
  const bonus = BONUS.find(b => b.index === index);
  return bonus && modes[bonus.cle] === "multiplication" ? Math.round(valeur * 100) / 100 : Math.round(valeur);
}

// Valeur calculée à partir de la case précédente, ou null.
function valeurCalculee(input) {
  const saisie = lireSaisie(input.value);
  const index = Number(input.dataset.index);
  if (!saisie?.multiplicateur || index < 1 || index > COLONNES[vue].derniereChaine) return null;
  return Math.round(valeurs[vue][input.dataset.id][index - 1] * saisie.multiplicateur);
}

function afficherApercu(input) {
  const apercu = input.nextElementSibling;
  const calcul = valeurCalculee(input);
  apercu.textContent = calcul === null ? "" : `= ${calcul}`;
  input.classList.toggle("avec-apercu", calcul !== null);
  const saisie = lireSaisie(input.value);
  input.classList.toggle("invalide", input.value.trim() !== "" && !saisie ||
    (!!saisie?.multiplicateur && calcul === null));
}

function enregistrerCase(input, valeur) {
  const index = Number(input.dataset.index);
  const propre = normaliser(index, valeur);
  valeurs[vue][input.dataset.id][index] = propre;
  input.value = propre;
  input.classList.remove("avec-apercu", "invalide");
  input.nextElementSibling.textContent = "";
  mettreAJourPied();
}

function initialiserSaisie() {
  const corps = document.getElementById("corps-admin");

  corps.addEventListener("input", event => {
    const input = event.target.closest(".case-points");
    if (!input) return;
    afficherApercu(input);
    // Nombre écrit directement : pris en compte tout de suite.
    const saisie = lireSaisie(input.value);
    if (saisie && "valeur" in saisie) {
      valeurs[vue][input.dataset.id][Number(input.dataset.index)] = normaliser(Number(input.dataset.index), saisie.valeur);
      mettreAJourPied();
    }
  });

  corps.addEventListener("keydown", event => {
    const input = event.target.closest(".case-points");
    if (!input || event.key !== "Enter") return;
    event.preventDefault();
    const calcul = valeurCalculee(input);
    const saisie = lireSaisie(input.value);
    if (calcul !== null) enregistrerCase(input, calcul);
    else if (saisie && "valeur" in saisie) enregistrerCase(input, saisie.valeur);
    else return;
    // Case suivante de la même ligne.
    const suivante = input.closest("td").nextElementSibling?.querySelector(".case-points");
    if (suivante) {
      suivante.focus();
      suivante.select();
    }
  });

  // En quittant une case : on remet la valeur enregistrée (coefficient non
  // validé, saisie invalide, décimales arrondies).
  corps.addEventListener("focusout", event => {
    const input = event.target.closest(".case-points");
    if (!input) return;
    const valeur = valeurs[vue][input.dataset.id][Number(input.dataset.index)];
    input.value = valeur;
    input.classList.remove("avec-apercu", "invalide");
    input.nextElementSibling.textContent = "";
  });

  document.getElementById("entete-admin").addEventListener("change", event => {
    const select = event.target.closest(".mode-bonus");
    if (!select) return;
    modes[select.dataset.cle] = select.value;
    mettreAJourPied();
  });
}

// ---- Enregistrer / Annuler ----

function mettreAJourPied() {
  const modifie = etatActuel() !== etatEnregistre;
  const enregistrer = document.getElementById("enregistrer-admin");
  enregistrer.disabled = !modifie;
  enregistrer.classList.toggle("modifie", modifie);
  document.getElementById("annuler-admin").classList.toggle("modifie", modifie);
}

async function enregistrer() {
  const bouton = document.getElementById("enregistrer-admin");
  bouton.disabled = true;
  try {
    const reponse = await fetch("/api/points", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characters: valeurs.characters, weapons: valeurs.weapons, modes })
    });
    if (!reponse.ok) throw new Error((await reponse.json().catch(() => ({}))).error || "Erreur d'enregistrement.");
    etatEnregistre = etatActuel();
    afficherEtat("Points enregistrés : ils s'appliquent sur tout le site.", "succes");
  } catch (erreur) {
    console.error(erreur);
    afficherEtat(erreur.message, "erreur");
  }
  mettreAJourPied();
}

function annuler() {
  [valeurs, modes] = JSON.parse(etatEnregistre);
  rendre();
}

function afficherEtat(message, type = "") {
  const etat = document.getElementById("etat-admin");
  etat.textContent = message;
  etat.className = `etat-admin ${type}`;
  etat.classList.toggle("cache", !message);
}

// ---- Démarrage ----

async function demarrer() {
  const utilisateur = await chargerSession();
  if (!utilisateur?.admin) {
    afficherEtat("Cette page est réservée aux administrateurs.", "erreur");
    return;
  }

  try {
    await chargerDonnees();
  } catch (erreur) {
    console.error(erreur);
    afficherEtat("Impossible de charger les points.", "erreur");
    return;
  }

  afficherEtat("");
  document.getElementById("zone-admin").classList.remove("cache");
  document.getElementById("pied-admin").classList.remove("cache");

  document.querySelectorAll(".vue-admin").forEach(btn => {
    btn.addEventListener("click", () => {
      vue = btn.dataset.vue;
      document.getElementById("recherche-admin").value = "";
      tri = null; // colonnes différentes
      rendre();
    });
  });
  document.getElementById("recherche-admin").addEventListener("input", rendreCorps);
  document.getElementById("enregistrer-admin").addEventListener("click", enregistrer);
  document.getElementById("annuler-admin").addEventListener("click", annuler);
  window.addEventListener("beforeunload", event => {
    if (etatActuel() !== etatEnregistre) event.preventDefault();
  });

  initialiserSaisie();
  initialiserFiltres();
  suivreHauteurBarre();
  rendre();
}

// En-tête du tableau figé juste sous la barre des filtres (figée elle
// aussi) : sa hauteur change quand les filtres reviennent à la ligne.
function suivreHauteurBarre() {
  const barre = document.querySelector(".barre-admin");
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--hauteur-barre-admin", `${barre.offsetHeight}px`);
  }).observe(barre);
}

demarrer();
