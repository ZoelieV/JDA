// Historique des matchs : une ligne par match terminé (cf. api/matches.js),
// avec pour chaque joueur sa bannière, sa photo, son temps, son équipe, ses
// bans et ses bans d'équilibrage ; boss et date au centre.

let matchs = [];     // terminés
let matchsEnCours = [];
let personnagesParId = new Map(); // catalogue de draft (un seul Voyageur)
let bossParId = new Map();
let moiDiscordId = null;

const TRI_DEFAUT = { cle: "date", sens: -1 };
let tri = { ...TRI_DEFAUT };
let mesMatchsSeulement = false;

// Sens au 1er clic : plus récents, meilleurs temps, matchs les plus serrés
// et boss de A à Z d'abord.
const SENS_INITIAL = { date: -1, temps: 1, ecart: 1, boss: 1 };

// Phase d'une room en cours, affichée au centre de sa ligne.
const LIBELLES_PHASES = {
  choix_box: "Choix des box",
  analyse: "Analyse des box",
  bans_bonus: "Bans d'équilibrage",
  draft: "Draft",
  temps: "Saisie des temps"
};

// ---- Chargement ----

async function chargerHistorique() {
  const reponse = await fetch("/api/matches");
  if (!reponse.ok) throw new Error("Impossible de charger l'historique des matchs.");
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

// ---- Tri / filtres ----

function secondes(joueur) {
  return joueur.temps?.secondes ?? null;
}

function valeurTri(match) {
  const t1 = secondes(match.j1);
  const t2 = secondes(match.j2);
  switch (tri.cle) {
    case "temps":
      return t1 === null && t2 === null ? null : Math.min(...[t1, t2].filter(t => t !== null));
    case "ecart":
      return t1 === null || t2 === null ? null : Math.abs(t1 - t2);
    case "boss":
      return match.boss_id ? (bossParId.get(match.boss_id)?.nom || match.boss_id) : null;
    default:
      return match.date ? Date.parse(match.date) : null;
  }
}

// Texte cherché : joueurs, boss et personnages (équipes et bans).
function texteRecherche(match) {
  if (!match.texte) {
    const noms = ids => ids.map(id => personnagesParId.get(id)?.nom || id);
    match.texte = [
      match.j1.nom, match.j2.nom, bossParId.get(match.boss_id)?.nom || match.boss_id,
      ...[match.j1, match.j2].flatMap(j => noms([...j.equipe.map(p => p.id), ...j.bans, ...j.bans_equilibrage]))
    ].join(" ").toLowerCase();
  }
  return match.texte;
}

function matchsAffiches() {
  const recherche = document.getElementById("recherche").value.trim().toLowerCase();
  return matchs
    .filter(match => !mesMatchsSeulement || match.j1.discord_id === moiDiscordId || match.j2.discord_id === moiDiscordId)
    .filter(match => !recherche || texteRecherche(match).includes(recherche))
    .map((match, index) => ({ match, index, v: valeurTri(match) }))
    // Sans valeur (temps manquant, date inconnue) : toujours en fin de liste.
    .sort((a, b) => {
      if ((a.v === null) !== (b.v === null)) return a.v === null ? 1 : -1;
      const ecart = typeof a.v === "string"
        ? a.v.localeCompare(b.v, "fr", { sensitivity: "base" })
        : a.v - b.v;
      return (ecart * tri.sens) || (a.index - b.index);
    })
    .map(e => e.match);
}

function mettreAJourBoutons() {
  document.querySelectorAll(".tri-historique").forEach(btn => {
    const actif = btn.dataset.tri === tri.cle;
    btn.classList.toggle("active", actif);
    btn.querySelector(".fleche").textContent = actif ? (tri.sens === 1 ? "▲" : "▼") : "";
  });
  document.getElementById("mes-matchs").classList.toggle("active", mesMatchsSeulement);
}

// ---- Rendu ----

function formaterDate(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
}

// Petite icône de personnage (fond de rareté), élément du Voyageur / Manekin
// dans le coin ; banni : grisé avec contour rouge.
function htmlPerso(id, parametres, { element = null, banni = false } = {}) {
  const base = personnagesParId.get(id);
  if (!base) return "";
  const personnage = appliquerVariante(base, parametres);
  const nom = element ? `${personnage.nom} ${NOMS_ELEMENTS[element] || ""}`.trim() : personnage.nom;
  const logoElement = element && ICONES_ELEMENTS_TRI[element]
    ? `<img class="element-mini" src="${ICONES_ELEMENTS_TRI[element]}" alt="${element}">`
    : "";
  return `<div class="perso-mini ${classeFondRarete(personnage.rarete)}${banni ? " banni" : ""}" title="${nom}">` +
    `<img src="../DB/${personnage.image}" alt="${nom}" loading="lazy" decoding="async">${logoElement}</div>`;
}

function htmlLigne(titre, contenu, classe = "") {
  return contenu
    ? `<div class="match-ligne ${classe}"><span class="match-label">${titre}</span><div class="match-persos">${contenu}</div></div>`
    : "";
}

function htmlJoueur(match, role, bansConnus) {
  const joueur = match[role];
  const gagnant = match.vainqueur === role;
  const egalite = match.vainqueur === "egalite";
  const banniere = encodeURI(`../DB/images/${joueur.banniere2}`);
  const etiquette = gagnant ? `<span class="etiquette-resultat victoire">Victoire</span>`
    : egalite ? `<span class="etiquette-resultat egalite">Égalité</span>` : "";

  const equipe = joueur.equipe.map(p => htmlPerso(p.id, joueur.parametres, { element: p.element })).join("");
  const bans = joueur.bans.map(id => htmlPerso(id, joueur.parametres, { banni: true })).join("");
  const equilibrage = joueur.bans_equilibrage.map(id => htmlPerso(id, joueur.parametres, { banni: true })).join("");

  return `
    <div class="match-joueur match-${role}${gagnant ? " gagnant" : ""}">
      <div class="match-banniere" style="--banniere2: url(&quot;${banniere}&quot;)">
        ${joueur.avatar ? `<img class="match-avatar" src="${joueur.avatar}" alt="">` : ""}
        <span class="match-nom"></span>
        ${etiquette}
        <span class="match-temps">${joueur.temps ? joueur.temps.affiche : "—"}</span>
      </div>
      ${htmlLigne("Équipe", equipe)}
      ${bansConnus ? htmlLigne("Bans", bans, "ligne-bans") : ""}
      ${htmlLigne("Équilibrage", equilibrage, "ligne-bans")}
    </div>
  `;
}

// Ligne d'un match terminé, ou d'un match en cours (phase et lien pour le
// regarder en spectateur à la place de la date).
function creerLigneMatch(match) {
  const ligne = document.createElement("article");
  const enCours = !!match.room_id;
  ligne.className = enCours ? "match en-cours" : "match";
  const boss = bossParId.get(match.boss_id);
  const infos = enCours
    ? `<span class="match-phase">${LIBELLES_PHASES[match.phase] || match.phase}</span>
       <a class="match-regarder" href="/matchmaking/match.html?room=${encodeURIComponent(match.room_id)}">Regarder</a>`
    : `<span class="match-date">${formaterDate(match.date)}</span>
       ${match.bans_connus ? "" : `<span class="match-note">Bans non enregistrés</span>`}`;

  ligne.innerHTML = `
    ${htmlJoueur(match, "j1", enCours || match.bans_connus)}
    <div class="match-centre">
      ${boss ? `<img class="match-boss" src="../DB/${boss.image}" alt="${boss.nom}" loading="lazy">` : ""}
      <span class="match-boss-nom">${boss ? boss.nom : enCours ? "Boss pas encore tiré" : ""}</span>
      ${infos}
    </div>
    ${htmlJoueur(match, "j2", enCours || match.bans_connus)}
  `;
  // Pseudos en texte (pas d'HTML venant des comptes).
  ligne.querySelector(".match-j1 .match-nom").textContent = match.j1.nom;
  ligne.querySelector(".match-j2 .match-nom").textContent = match.j2.nom;
  return ligne;
}

// Lignes recyclées d'une frappe à l'autre dans la recherche (cf. obtenirCarte).
function afficherMatchs() {
  const liste = document.getElementById("liste-matchs");
  const affiches = matchsAffiches();
  mettreAJourBoutons();

  const etat = document.getElementById("etat-historique");
  etat.textContent = matchs.length === 0 ? "Aucun match joué pour l'instant."
    : affiches.length === 0 ? "Aucun match trouvé." : "";
  etat.classList.toggle("cache", !etat.textContent);

  liste.replaceChildren(...affiches.map(match => obtenirCarte(liste, String(match.id), () => creerLigneMatch(match))));
  terminerRendu(liste);
}

function afficherMatchsEnCours() {
  document.getElementById("section-en-cours").classList.toggle("cache", matchsEnCours.length === 0);
  document.getElementById("liste-en-cours").replaceChildren(...matchsEnCours.map(creerLigneMatch));
}

// ---- Démarrage ----

function initialiserBarre() {
  document.querySelectorAll(".tri-historique").forEach(btn => {
    btn.addEventListener("click", () => {
      const cle = btn.dataset.tri;
      tri = tri.cle === cle ? { cle, sens: -tri.sens } : { cle, sens: SENS_INITIAL[cle] };
      afficherMatchs();
    });
  });

  document.getElementById("recherche").addEventListener("input", afficherMatchs);

  const mesMatchs = document.getElementById("mes-matchs");
  mesMatchs.classList.toggle("cache", !moiDiscordId);
  mesMatchs.addEventListener("click", () => {
    mesMatchsSeulement = !mesMatchsSeulement;
    afficherMatchs();
  });

  document.getElementById("clear-historique").addEventListener("click", () => {
    document.getElementById("recherche").value = "";
    tri = { ...TRI_DEFAUT };
    mesMatchsSeulement = false;
    afficherMatchs();
  });
}

async function demarrer() {
  try {
    const [historique, personnages, boss, utilisateur] = await Promise.all([
      chargerHistorique(), chargerPersonnages(), chargerBoss(), chargerSession()
    ]);
    matchs = historique.termines || [];
    matchsEnCours = historique.en_cours || [];
    personnagesParId = new Map(regrouperPourDraft(personnages).map(p => [p.id, p]));
    bossParId = new Map(boss.map(b => [b.id, b]));
    moiDiscordId = utilisateur?.id || null;

    initialiserBarre();
    afficherMatchsEnCours();
    afficherMatchs();
  } catch (erreur) {
    console.error(erreur);
    document.getElementById("etat-historique").textContent = erreur.message || "Erreur de chargement.";
  }
}

demarrer();
