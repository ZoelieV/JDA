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

function listeVue() {
  return vue === "characters" ? personnages : armes;
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

  document.getElementById("entete-admin").innerHTML = `
    <tr>
      <th class="col-nom">${vue === "characters" ? "Personnage" : "Arme"}</th>
      ${libelles.map(libelle => `<th>${libelle}</th>`).join("")}
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
  const recherche = document.getElementById("recherche-admin").value.trim().toLowerCase();
  const corps = document.getElementById("corps-admin");

  corps.innerHTML = listeVue()
    .filter(item => !recherche || item.nom.toLowerCase().includes(recherche))
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
  const items = listeVue().filter(item => !recherche || item.nom.toLowerCase().includes(recherche));
  corps.querySelectorAll(".nom-admin").forEach((span, i) => { span.textContent = items[i].nom; });
}

function rendre() {
  document.querySelectorAll(".vue-admin").forEach(btn => btn.classList.toggle("active", btn.dataset.vue === vue));
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
  rendre();
}

demarrer();
