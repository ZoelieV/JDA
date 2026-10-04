// Classement : joueurs ayant joué au moins un match classé (cf.
// api/accounts/index.js et api/_lib/trophees.js), avec leur bannière et,
// sur ordi, leurs stats en colonnes (trophées, matchs et winrate en classé,
// puis les stats de Tous les comptes). Rang toujours calculé sur les
// trophées ; tri au choix (2e clic : sens inversé).

const BANNIERE2_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";
const TRI_DEFAUT = { cle: "trophees", sens: -1 };

// Sens du 1er clic : plus grande valeur d'abord, A -> Z, plus récents d'abord.
const SENS_INITIAL = {
  trophees: -1, matchs_classes: -1, ratio: -1, points: -1, nb_persos: -1,
  nb_c6: -1, constellations_5: -1, theatre: -1, alpha: 1, activite: -1
};

let comptes = [];
let joueurs = []; // joueurs du classement affiché, avec ses stats
let classement = "classique"; // "classique" | "melee"
let tri = { ...TRI_DEFAUT };
let moiDiscordId = null;

async function chargerComptes() {
  const reponse = await fetch("/api/accounts");
  if (!reponse.ok) throw new Error("Impossible de charger le classement.");
  return reponse.json();
}

async function chargerSession() {
  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });
    return reponse.ok ? (await reponse.json()).user : null;
  } catch {
    return null;
  }
}

function getNom(joueur) {
  return joueur.discord_global_name || joueur.discord_username || "Utilisateur inconnu";
}

// Winrate en classé (0..1).
function getRatio(joueur) {
  return joueur.matchs_classes > 0 ? joueur.victoires_classees / joueur.matchs_classes : null;
}

// Valeur d'un tri ; null (théâtre non renseigné…) toujours en fin de liste.
function valeurTri(joueur, cle) {
  switch (cle) {
    case "ratio": return getRatio(joueur);
    case "alpha": return getNom(joueur);
    case "activite": return joueur.updated_at ? Date.parse(joueur.updated_at) : null;
    default: return joueur[cle] ?? null;
  }
}

// Texte d'une stat : valeur seule dans les colonnes (ordi, icône dans
// l'en-tête), avec son unité sur la pastille du téléphone (long).
function texteStat(joueur, cle, long = false) {
  const unite = (valeur, singulier, pluriel = `${singulier}s`) =>
    long ? `${valeur} ${valeur > 1 ? pluriel : singulier}` : String(valeur);
  switch (cle) {
    case "trophees": return long ? `${joueur.trophees} ${ICONE_TROPHEE}` : String(joueur.trophees);
    case "matchs_classes": return unite(joueur.matchs_classes, "match", "matchs");
    case "ratio": return `${Math.round(getRatio(joueur) * 100)} %`;
    case "points": return long ? `${joueur.points ?? 0} pts` : String(joueur.points ?? 0);
    case "nb_persos": return unite(joueur.nb_persos ?? 0, "perso");
    case "nb_c6": return long ? `${joueur.nb_c6 ?? 0} C6 5★` : String(joueur.nb_c6 ?? 0);
    case "theatre": return joueur.theatre ? (long ? `Théâtre ${joueur.theatre}` : String(joueur.theatre)) : (long ? "Théâtre -" : "-");
    case "constellations_5": return unite(joueur.constellations_5 ?? 0, "constellation") + (long ? " 5★" : "");
    default: return "";
  }
}

const COLONNES = ["trophees", "matchs_classes", "ratio", "points", "nb_persos", "nb_c6", "constellations_5", "theatre"];

// Rang sur les trophées (ex aequo : même rang).
function calculerRangs() {
  const tries = [...joueurs].sort((a, b) => b.trophees - a.trophees);
  tries.forEach((joueur, i) => {
    joueur.rang = i > 0 && tries[i - 1].trophees === joueur.trophees ? tries[i - 1].rang : i + 1;
  });
}

function joueursAffiches() {
  const recherche = document.getElementById("recherche-classement").value.trim().toLowerCase();
  return joueurs
    .filter(joueur => !recherche ||
      getNom(joueur).toLowerCase().includes(recherche) ||
      String(joueur.discord_username || "").toLowerCase().includes(recherche))
    .sort((a, b) => {
      const va = valeurTri(a, tri.cle);
      const vb = valeurTri(b, tri.cle);
      if ((va === null) !== (vb === null)) return va === null ? 1 : -1;
      const ecart = typeof va === "string"
        ? va.localeCompare(vb, "fr", { sensitivity: "base" })
        : (va ?? 0) - (vb ?? 0);
      // Égalité : rang (trophées) puis pseudo.
      return ecart * tri.sens || a.rang - b.rang || getNom(a).localeCompare(getNom(b), "fr", { sensitivity: "base" });
    });
}

function creerLigne(joueur) {
  const ligne = document.createElement("div");
  ligne.className = "ligne-classement";
  if (joueur.discord_id === moiDiscordId) ligne.classList.add("moi");
  if (joueur.rang <= 3) ligne.classList.add(`podium-${joueur.rang}`);

  const banniere = encodeURI(`DB/images/${joueur.banniere2 || BANNIERE2_DEFAUT}`);
  // Téléphone : valeur du tri en cours sur la bannière (trophées par défaut).
  const cleTelephone = COLONNES.includes(tri.cle) ? tri.cle : "trophees";
  ligne.innerHTML = `
    <span class="col-rang">${joueur.rang}</span>
    <div class="col-joueur banniere-joueur cote-gauche" style="--banniere2: url(&quot;${echapperHtml(banniere)}&quot;)">
      <img class="photo-joueur" src="${joueur.discord_avatar_url || ""}" alt="">
      <div class="joueur-infos">
        <div class="joueur-textes">
          <div class="joueur-nom"></div>
          ${joueur.prime ? `<span class="badge-prime" title="Plus longue série de victoires en cours (${joueur.serie}) : le battre rapporte +5 trophées">${ICONE_ENTRAINEMENT} Prime +5 · ${joueur.serie} victoires d'affilée</span>` : ""}
          <div class="joueur-sub"></div>
        </div>
        ${htmlMedailleTheatre(joueur.theatre)}
      </div>
      <span class="stat-telephone"></span>
    </div>
    ${COLONNES.map(cle => `<span class="col-stat${cle === tri.cle ? " active" : ""}" data-col="${cle}"></span>`).join("")}
  `;
  // Pseudos en texte (pas d'HTML venant des comptes).
  ligne.querySelector(".joueur-nom").textContent = getNom(joueur);
  ligne.querySelector(".joueur-sub").textContent = joueur.discord_username ? `@${joueur.discord_username}` : "";
  ligne.querySelector(".stat-telephone").innerHTML = texteStat(joueur, cleTelephone, true);
  COLONNES.forEach(cle => {
    ligne.querySelector(`.col-stat[data-col="${cle}"]`).innerHTML = texteStat(joueur, cle);
  });
  return ligne;
}

function mettreAJourBoutons() {
  document.querySelectorAll(".tri-classement").forEach(btn => {
    const actif = btn.dataset.tri === tri.cle;
    btn.classList.toggle("active", actif);
    btn.querySelector(".fleche").textContent = actif ? (tri.sens === 1 ? "▲" : "▼") : "";
  });
  document.querySelectorAll(".entete-classement .col-stat").forEach(col => {
    col.classList.toggle("active", col.dataset.col === tri.cle);
  });
}

function afficher() {
  mettreAJourBoutons();
  const affiches = joueursAffiches();
  const etat = document.getElementById("etat-classement");
  etat.textContent = joueurs.length === 0
    ? `Personne n'a encore joué de match classé en ${classement === "melee" ? "mêlée générale" : "classique"}.`
    : affiches.length === 0 ? "Aucun joueur trouvé." : "";
  etat.classList.toggle("cache", !etat.textContent);
  document.querySelector(".entete-classement").classList.toggle("cache", affiches.length === 0);
  document.getElementById("liste-classement").replaceChildren(...affiches.map(creerLigne));
}

// Joueurs ayant au moins un match dans ce classement, avec ses stats
// (trophées, matchs et victoires en classé, série) à plat pour les tris.
function choisirClassement(nouveau) {
  classement = nouveau;
  joueurs = comptes
    .filter(compte => compte.classements?.[classement])
    .map(compte => {
      const stats = compte.classements[classement];
      return {
        ...compte,
        trophees: stats.trophees,
        matchs_classes: stats.matchs,
        victoires_classees: stats.victoires,
        serie: stats.serie,
        // Plus longue série en cours : le battre rapporte +5 trophées.
        prime: !!stats.prime
      };
    });
  calculerRangs();
  document.querySelectorAll(".onglet-classement").forEach(onglet => {
    const actif = onglet.dataset.classement === classement;
    onglet.classList.toggle("active", actif);
    onglet.setAttribute("aria-selected", String(actif));
  });
  afficher();
}

function initialiserBarre() {
  document.querySelectorAll(".onglet-classement").forEach(onglet => {
    onglet.addEventListener("click", () => choisirClassement(onglet.dataset.classement));
  });

  document.querySelectorAll(".tri-classement").forEach(btn => {
    btn.addEventListener("click", () => {
      const cle = btn.dataset.tri;
      tri = tri.cle === cle ? { cle, sens: -tri.sens } : { cle, sens: SENS_INITIAL[cle] };
      afficher();
    });
  });
  document.getElementById("recherche-classement").addEventListener("input", afficher);
  document.getElementById("clear-classement").addEventListener("click", () => {
    document.getElementById("recherche-classement").value = "";
    tri = { ...TRI_DEFAUT };
    afficher();
  });
}

async function demarrer() {
  try {
    const [liste, utilisateur] = await Promise.all([chargerComptes(), chargerSession()]);
    comptes = liste;
    moiDiscordId = utilisateur?.id || null;
    initialiserBarre();
    choisirClassement("classique");
  } catch (erreur) {
    console.error(erreur);
    document.getElementById("etat-classement").textContent = erreur.message || "Erreur de chargement.";
  }
}

demarrer();
