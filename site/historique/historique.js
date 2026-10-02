// Historique des matchs : une ligne par match terminé (cf. api/matches.js),
// avec pour chaque joueur sa bannière, sa photo, son temps, son équipe, ses
// bans et ses bans d'équilibrage ; boss et date au centre.

let matchs = [];     // terminés
let matchsEnCours = [];
let litiges = [];      // administrateurs : matchs invalidés par un litige
let statsLitiges = []; // administrateurs : litiges par joueur
let erreurLitiges = null; // administrateurs : problème de lecture côté base
let entrainements = []; // entraînements lancés par le joueur connecté (lui seul)
let estAdmin = false;
// Modération : colonne triée (décroissant) et joueur filtré dans les litiges.
let triLitiges = "total";
let joueurLitiges = null;
let personnagesParId = new Map(); // catalogue de draft (un seul Voyageur)
let bossParId = new Map();
let moiDiscordId = null;

// Tris combinables (cf. commun/tri.js) : 1er clic = un sens, 2e clic =
// l'autre, 3e clic = désactivé ; appliqués dans l'ordre des clics (ex. boss
// puis temps : les matchs de chaque boss triés par temps). Sans tri : plus
// récents d'abord.
const etatTri = creerEtatTri();
let mesMatchsSeulement = false;
let classesSeulement = false;

// Sens du 1er clic : plus récents, meilleurs temps, matchs les plus serrés
// et boss de A à Z d'abord.
const SENS_INITIAL = { date: -1, temps: 1, ecart: 1, boss: 1 };

// Phase d'une room en cours, affichée au centre de sa ligne.
const LIBELLES_PHASES = {
  choix_box: "Choix des box",
  analyse: "Analyse des box",
  bans_bonus: "Bans d'équilibrage",
  draft: "Draft",
  temps: "Saisie des temps",
  verification: "Vérification des temps"
};

// ---- Chargement ----

async function chargerHistorique() {
  const reponse = await fetch("/api/matches", { credentials: "include" });
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

// Texte cherché : joueurs, boss et personnages joués (équipes seulement : un
// personnage banni ne fait pas remonter le match).
function texteRecherche(match) {
  if (!match.texte) {
    const noms = ids => ids.map(id => personnagesParId.get(id)?.nom || id);
    match.texte = [
      match.j1.nom, match.j2.nom, bossParId.get(match.boss_id)?.nom || match.boss_id,
      ...[match.j1, match.j2].flatMap(j => noms(j.equipe.map(p => p.id)))
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
    .filter(match => !classesSeulement || match.classe)
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
  document.getElementById("matchs-classes").classList.toggle("active", classesSeulement);
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

// aleatoire : choisi au hasard (temps écoulé, draft classée) -> entouré de
// doré, comme dans la page du match.
function htmlPerso(id, parametres, { element = null, banni = false, infos = null, infosJoueurs = null, aleatoire = false } = {}) {
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

  const titre = aleatoire ? `${nom} (choisi au hasard : temps écoulé)` : nom;
  return `<div class="perso-mini${infos || infosJoueurs ? " perso-equipe" : ""} ${classeFondRarete(personnage.rarete)}${banni ? " banni" : ""}${aleatoire ? " choix-aleatoire" : ""}" title="${titre}">` +
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
  // Classé : trophées gagnés par le vainqueur (bonus de série compris),
  // perdus par l'autre (plancher à 0 compris) ; à défaut, trophées en jeu.
  const perdant = match.vainqueur && !gagnant && !egalite;
  const reel = match.trophees_joueurs;
  const nbTrophees = reel ? Math.abs(reel[role]) : match.trophees;
  const bonus = gagnant && reel?.bonus ? ` dont +${reel.bonus} de série` : "";
  const trophees = match.classe && match.trophees && (gagnant || perdant)
    ? `<span class="etiquette-resultat trophees ${gagnant ? "gain" : "perte"}" title="Trophées${bonus}">${gagnant ? "+" : "−"}${nbTrophees} 🏆${bonus ? " 🔥" : ""}</span>`
    : "";

  const equipe = joueur.equipe.map(p => htmlPerso(p.id, joueur.parametres, { element: p.element, infos: p, aleatoire: p.aleatoire })).join("");
  const htmlBan = ban => htmlPerso(ban.id, joueur.parametres, { banni: true, infosJoueurs: ban.infos, aleatoire: ban.aleatoire });
  const bans = joueur.bans.map(htmlBan).join("");
  const equilibrage = joueur.bans_equilibrage.map(htmlBan).join("");

  return `
    <div class="match-joueur match-${role}${gagnant ? " gagnant" : ""}">
      <div class="match-banniere banniere-joueur${role === "j1" ? " cote-gauche" : ""}" style="--banniere2: url(&quot;${echapperHtml(banniere)}&quot;)">
        ${joueur.avatar ? `<img class="match-avatar photo-joueur" src="${joueur.avatar}" alt="">` : ""}
        <span class="match-nom"></span>
        ${htmlMedailleTheatre(joueur.theatre)}
        ${etiquette}
        ${trophees}
        <span class="match-temps">${joueur.temps ? joueur.temps.affiche : "—"}</span>
      </div>
      ${htmlLigne("Équipe", equipe)}
      ${bansConnus ? htmlLigne("Bans", bans, "ligne-bans") : ""}
      ${htmlLigne("Équilibrage", equilibrage, "ligne-bans")}
    </div>
  `;
}

// Théâtre joué (nombre de bans de la draft) avec sa médaille.
function htmlTheatreJoue(theatre) {
  if (![6, 8, 10, 12].includes(theatre)) return "";
  return `<span class="match-theatre" title="Draft du théâtre ${theatre}">` +
    `<img src="../DB/images/others/Imaginarium_Theater_Medal_${theatre}.webp" alt="">Théâtre ${theatre}</span>`;
}

// Ligne d'un match terminé, ou d'un match en cours (phase et lien pour le
// regarder en spectateur à la place de la date).
function creerLigneMatch(match) {
  const ligne = document.createElement("article");
  const enCours = !!match.room_id;
  ligne.className = enCours ? "match en-cours" : "match";
  // Classé : contour doré (et mention au centre).
  if (match.classe) ligne.classList.add("classe");
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
       ${match.bans_connus ? "" : `<span class="match-note">Bans non enregistrés</span>`}
       ${match.litige === "ouvert" ? htmlCorrectionLitige(match) : ""}
       ${match.litige === "republie" ? `<span class="match-note match-litige-corrige">Litige corrigé (${nomLitigePar(match)})</span>` : ""}`;
  if (match.litige === "ouvert") ligne.classList.add("litige");
  if (match.entrainement) ligne.classList.add("entrainement");

  ligne.innerHTML = `
    ${htmlJoueur(match, "j1", enCours || match.bans_connus)}
    <div class="match-centre">
      ${boss ? `<img class="match-boss" src="../DB/${boss.image}" alt="${boss.nom}" loading="lazy">` : ""}
      ${match.entrainement ? `<span class="match-entrainement">Entraînement 🎯</span>` : ""}
      ${match.classe ? `<span class="match-classe">Classé 🏆${match.mode_theatre === "12" ? " · Mêlée générale" : ""}</span>` : ""}
      ${match.mode_theatre === "carnage" ? `<span class="match-carnage" title="Théâtre 12 sans bans d'équilibrage">Carnage 💀</span>` : ""}
      ${htmlTheatreJoue(match.theatre)}
      <span class="match-boss-nom">${boss ? boss.nom : enCours ? "Boss pas encore tiré" : ""}</span>
      ${infos}
    </div>
    ${htmlJoueur(match, "j2", enCours || match.bans_connus)}
  `;
  // Pseudos en texte (pas d'HTML venant des comptes).
  ligne.querySelector(".match-j1 .match-nom").textContent = match.j1.nom;
  ligne.querySelector(".match-j2 .match-nom").textContent = match.j2.nom;
  if (match.litige === "ouvert") brancherCorrectionLitige(ligne, match);
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

// Entraînements : section visible seulement s'il y en a (donc pour leur
// lanceur).
function afficherEntrainements() {
  document.getElementById("section-entrainements").classList.toggle("cache", entrainements.length === 0);
  document.getElementById("liste-entrainements").replaceChildren(...entrainements.map(creerLigneMatch));
}

function afficherMatchsEnCours() {
  document.getElementById("section-en-cours").classList.toggle("cache", matchsEnCours.length === 0);
  document.getElementById("liste-en-cours").replaceChildren(...matchsEnCours.map(creerLigneMatch));
}

// ---- Litiges (administrateurs) ----

// "signalé par <pseudo>" en HTML (pseudo échappé).
function nomLitigePar(match) {
  const joueur = match[match.litige_par];
  return joueur ? `signalé par ${htmlPseudo(joueur.nom)}` : "signalé";
}

// Centre d'un litige ouvert : qui l'a signalé, les 2 temps modifiables et
// le bouton pour republier le match (vainqueur recalculé côté serveur).
function htmlCorrectionLitige(match) {
  const champ = role => `
    <label class="champ-temps-litige champ-${role}">
      <span class="nom-temps-litige"></span>
      <input type="text" inputmode="decimal" name="temps_${role}" value="${match[role].temps?.affiche || ""}" placeholder="mm:ss" title="Temps (mm:ss) ou abandon">
    </label>`;
  return `
    <span class="match-litige">Litige <span class="litige-par"></span></span>
    <form class="correction-litige">
      ${champ("j1")}
      ${champ("j2")}
      <button type="submit" class="bouton-historique bouton-republier">Corriger et republier</button>
    </form>`;
}

function brancherCorrectionLitige(ligne, match) {
  // Pseudos en texte (pas d'HTML venant des comptes).
  ligne.querySelector(".litige-par").innerHTML = nomLitigePar(match);
  ligne.querySelector(".champ-j1 .nom-temps-litige").textContent = match.j1.nom;
  ligne.querySelector(".champ-j2 .nom-temps-litige").textContent = match.j2.nom;

  const formulaire = ligne.querySelector(".correction-litige");
  formulaire.addEventListener("submit", async event => {
    event.preventDefault();
    const temps = role => formulaire.elements[`temps_${role}`].value.trim();
    if (!confirm(`Republier ce match avec les temps ${temps("j1")} (${match.j1.nom}) et ${temps("j2")} (${match.j2.nom}) ?`)) return;

    const bouton = formulaire.querySelector(".bouton-republier");
    bouton.disabled = true;
    try {
      const reponse = await fetch(`/api/matches?id=${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temps_j1: temps("j1"), temps_j2: temps("j2") })
      });
      const data = await reponse.json().catch(() => ({}));
      if (!reponse.ok) throw new Error(data.error || "Erreur lors de la republication.");
      await rafraichir();
    } catch (erreur) {
      alert(erreur.message);
      bouton.disabled = false;
    }
  });
}

function afficherStatsLitiges() {
  document.querySelectorAll(".tri-litiges").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tri === triLitiges);
    btn.querySelector(".fleche").textContent = btn.dataset.tri === triLitiges ? "▼" : "";
  });

  document.getElementById("etat-stats-litiges").textContent = statsLitiges.length === 0 ? "Aucun litige pour l'instant." : "";
  document.getElementById("table-litiges").classList.toggle("cache", statsLitiges.length === 0);

  const tries = [...statsLitiges].sort((a, b) =>
    b[triLitiges] - a[triLitiges] || b.total - a.total || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  document.querySelector("#table-litiges tbody").replaceChildren(...tries.map(stats => {
    const ligne = document.createElement("tr");
    ligne.classList.toggle("active", stats.discord_id === joueurLitiges);
    ligne.title = stats.discord_id === joueurLitiges
      ? "Afficher les litiges de tous les joueurs"
      : "N'afficher que les litiges ouverts de ce joueur";
    const cellule = document.createElement("td");
    cellule.className = "joueur-litiges";
    if (stats.avatar) {
      const avatar = document.createElement("img");
      avatar.className = "photo-joueur";
      avatar.src = stats.avatar;
      avatar.alt = "";
      cellule.append(avatar);
    }
    cellule.append(stats.nom);
    ligne.append(cellule, ...["total", "ouverts", "republies", "signales", "subis"].map(cle => {
      const td = document.createElement("td");
      td.textContent = stats[cle];
      return td;
    }));
    ligne.addEventListener("click", () => {
      joueurLitiges = joueurLitiges === stats.discord_id ? null : stats.discord_id;
      afficherLitiges();
    });
    return ligne;
  }));
}

function afficherLitiges() {
  document.getElementById("section-litiges").classList.toggle("cache", !estAdmin);
  if (!estAdmin) return;
  afficherStatsLitiges();

  const filtre = document.getElementById("filtre-litiges");
  const joueur = statsLitiges.find(s => s.discord_id === joueurLitiges);
  filtre.classList.toggle("cache", !joueur);
  filtre.innerHTML = joueur ? `— ${htmlPseudo(joueur.nom)} (cliquer à nouveau sur le joueur pour tout afficher)` : "";

  const affiches = litiges.filter(match => !joueurLitiges ||
    match.j1.discord_id === joueurLitiges || match.j2.discord_id === joueurLitiges);
  document.getElementById("etat-litiges").textContent = erreurLitiges
    || (affiches.length === 0 ? "Aucun litige ouvert." : "");
  document.getElementById("liste-litiges").replaceChildren(...affiches.map(creerLigneMatch));
}

// Après une republication : litige retiré, match ajouté aux terminés.
async function rafraichir() {
  const historique = await chargerHistorique();
  appliquerHistorique(historique);
  viderCacheCartes(document.getElementById("liste-matchs"));
  afficherMatchsEnCours();
  afficherEntrainements();
  afficherLitiges();
  afficherMatchs();
}

function appliquerHistorique(historique) {
  matchs = historique.termines || [];
  matchsEnCours = historique.en_cours || [];
  litiges = historique.litiges || [];
  statsLitiges = historique.stats_litiges || [];
  erreurLitiges = historique.erreur_litiges || null;
  entrainements = historique.entrainements || [];
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

  document.getElementById("matchs-classes").addEventListener("click", () => {
    classesSeulement = !classesSeulement;
    afficherMatchs();
  });

  const mesMatchs = document.getElementById("mes-matchs");
  mesMatchs.classList.toggle("cache", !moiDiscordId);
  mesMatchs.addEventListener("click", () => {
    mesMatchsSeulement = !mesMatchsSeulement;
    afficherMatchs();
  });

  document.querySelectorAll(".tri-litiges").forEach(btn => {
    btn.addEventListener("click", () => {
      triLitiges = btn.dataset.tri;
      afficherStatsLitiges();
    });
  });

  document.getElementById("clear-historique").addEventListener("click", () => {
    document.getElementById("recherche").value = "";
    viderTris(etatTri);
    mesMatchsSeulement = false;
    classesSeulement = false;
    afficherMatchs();
  });
}

async function demarrer() {
  try {
    const [historique, personnages, boss, utilisateur] = await Promise.all([
      chargerHistorique(), chargerPersonnages(), chargerBoss(), chargerSession()
    ]);
    appliquerHistorique(historique);
    personnagesParId = new Map(regrouperPourDraft(personnages).map(p => [p.id, p]));
    bossParId = new Map(boss.map(b => [b.id, b]));
    moiDiscordId = utilisateur?.id || null;
    estAdmin = !!utilisateur?.admin;

    initialiserBarre();
    afficherMatchsEnCours();
    afficherEntrainements();
    afficherLitiges();
    afficherMatchs();
  } catch (erreur) {
    console.error(erreur);
    document.getElementById("etat-historique").textContent = erreur.message || "Erreur de chargement.";
  }
}

demarrer();
