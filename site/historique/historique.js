// Historique des matchs : une ligne par match terminé (cf. api/matches.js),
// avec pour chaque joueur sa bannière, sa photo, son temps, son équipe, ses
// bans et ses bans d'équilibrage ; boss et date au centre.

let matchs = [];     // terminés
let matchsEnCours = [];
let personnagesParId = new Map(); // catalogue de draft (un seul Voyageur)
let bossParId = new Map();
let moiDiscordId = null;

// Tris combinables (cf. commun/tri.js) : 1er clic = un sens, 2e clic =
// l'autre, 3e clic = désactivé ; appliqués dans l'ordre des clics (ex. boss
// puis temps : les matchs de chaque boss triés par temps). Sans tri : plus
// récents d'abord.
const etatTri = creerEtatTri();
let mesMatchsSeulement = false;

// Sens du 1er clic : plus récents, meilleurs temps, matchs les plus serrés
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

function valeurTri(match, cle) {
  const t1 = secondes(match.j1);
  const t2 = secondes(match.j2);
  switch (cle) {
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
      ...[match.j1, match.j2].flatMap(j => noms([...j.equipe, ...j.bans, ...j.bans_equilibrage].map(p => p.id)))
    ].join(" ").toLowerCase();
  }
  return match.texte;
}

// Tris actifs dans l'ordre des clics, sens réel (1 = croissant) ; la date
// (plus récents d'abord) départage toujours en dernier.
function trisActifs() {
  const tris = etatTri.tris.map(t => ({ cle: t.cle, sens: SENS_INITIAL[t.cle] * t.sens }));
  if (!tris.some(t => t.cle === "date")) tris.push({ cle: "date", sens: -1 });
  return tris;
}

function matchsAffiches() {
  const recherche = document.getElementById("recherche").value.trim().toLowerCase();
  const tris = trisActifs();
  return matchs
    .filter(match => !mesMatchsSeulement || match.j1.discord_id === moiDiscordId || match.j2.discord_id === moiDiscordId)
    .filter(match => !recherche || texteRecherche(match).includes(recherche))
    .map((match, index) => ({ match, index, v: tris.map(t => valeurTri(match, t.cle)) }))
    .sort((a, b) => {
      for (let i = 0; i < tris.length; i++) {
        const va = a.v[i];
        const vb = b.v[i];
        if (va === vb) continue;
        // Sans valeur (temps manquant, date inconnue) : toujours en fin.
        if (va === null || vb === null) return va === null ? 1 : -1;
        const ecart = typeof va === "string"
          ? va.localeCompare(vb, "fr", { sensitivity: "base" })
          : va - vb;
        if (ecart) return ecart * tris[i].sens;
      }
      return a.index - b.index;
    })
    .map(e => e.match);
}

function mettreAJourBoutons() {
  document.querySelectorAll(".tri-historique").forEach(btn => {
    const sens = getSensTri(etatTri, btn.dataset.tri);
    btn.classList.toggle("active", sens !== 0);
    btn.querySelector(".fleche").textContent = sens === 1 ? "▼" : sens === -1 ? "▲" : "";
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

// Icône de personnage (fond de rareté). Équipe : une info par coin, comme
// dans Mon compte — constellation en haut à gauche, niveau en bas à gauche,
// arme signature (détourée de la couleur du raffinement) en bas à droite ;
// Voyageur / Manekin : élément en bas à gauche et niveau centré en bas.
// Banni : grisé avec contour rouge.
// Coins d'un ban, comme les cartes de la draft : infos de j1 à gauche
// (constellation en haut, arme au milieu, niveau en bas), de j2 à droite,
// chacun dans sa couleur.
function coinsDeuxJoueurs(personnage, infosJoueurs) {
  return ["j1", "j2"].map(role => {
    const infos = infosJoueurs?.[role];
    if (!infos || infos.constellation == null) return "";
    const cote = role === "j1" ? "g" : "d";
    return [
      `<span class="coin coin-h${cote} coin-${role}">C${infos.constellation}</span>`,
      htmlArmeSignature(personnage.arme, infos.raffinement, { classe: `coin coin-m${cote} arme-mini`, titre: `${role.toUpperCase()} : arme signature R${(infos.raffinement ?? 0) + 1}` }),
      infos.niveau ? `<span class="coin coin-b${cote} coin-${role}">${infos.niveau}</span>` : ""
    ].join("");
  }).join("");
}

function htmlPerso(id, parametres, { element = null, banni = false, infos = null, infosJoueurs = null } = {}) {
  const base = personnagesParId.get(id);
  if (!base) return "";
  const personnage = appliquerVariante(base, parametres);
  const nom = element ? `${personnage.nom} ${NOMS_ELEMENTS[element] || ""}`.trim() : personnage.nom;
  const avecElement = element && ICONES_ELEMENTS_TRI[element];

  const coins = [
    infos?.constellation != null ? `<span class="coin coin-hg">C${infos.constellation}</span>` : "",
    infos?.niveau ? `<span class="coin ${avecElement ? "coin-bas" : "coin-bg"}">${infos.niveau}</span>` : "",
    avecElement ? `<img class="coin coin-bg element-mini" src="${ICONES_ELEMENTS_TRI[element]}" alt="${element}" title="${NOMS_ELEMENTS[element] || element}">` : "",
    infos ? htmlArmeSignature(personnage.arme, infos.raffinement, { classe: "coin coin-bd arme-mini" }) : "",
    coinsDeuxJoueurs(personnage, infosJoueurs)
  ].join("");

  return `<div class="perso-mini${infos || infosJoueurs ? " perso-equipe" : ""} ${classeFondRarete(personnage.rarete)}${banni ? " banni" : ""}" title="${nom}">` +
    `<img src="../DB/${personnage.image}" alt="${nom}" loading="lazy" decoding="async">${coins}</div>`;
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

  const equipe = joueur.equipe.map(p => htmlPerso(p.id, joueur.parametres, { element: p.element, infos: p })).join("");
  const htmlBan = ban => htmlPerso(ban.id, joueur.parametres, { banni: true, infosJoueurs: ban.infos });
  const bans = joueur.bans.map(htmlBan).join("");
  const equilibrage = joueur.bans_equilibrage.map(htmlBan).join("");

  return `
    <div class="match-joueur match-${role}${gagnant ? " gagnant" : ""}">
      <div class="match-banniere banniere-joueur${role === "j1" ? " cote-gauche" : ""}" style="--banniere2: url(&quot;${banniere}&quot;)">
        ${joueur.avatar ? `<img class="match-avatar photo-joueur" src="${joueur.avatar}" alt="">` : ""}
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
  // Match en cours : toute la ligne mène au match, en spectateur (un joueur
  // du match y retrouve sa place, cf. api/rooms/[room_id].js).
  const lienSpectateur = enCours ? `/matchmaking/match.html?room=${encodeURIComponent(match.room_id)}&spectateur=1` : "";
  if (enCours) {
    ligne.title = "Regarder ce match en spectateur";
    ligne.addEventListener("click", event => {
      if (!event.target.closest("a")) window.location.href = lienSpectateur;
    });
  }
  const infos = enCours
    ? `<span class="match-phase">${LIBELLES_PHASES[match.phase] || match.phase}</span>
       <a class="match-regarder" href="${lienSpectateur}">Regarder</a>`
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
      cyclerTri(etatTri, btn.dataset.tri);
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
    viderTris(etatTri);
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
