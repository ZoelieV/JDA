// Historique des matchs : une ligne par match terminé (cf. api/matches.js),
// avec pour chaque joueur sa bannière, sa photo, son temps, son équipe, ses
// bans et ses bans d'équilibrage ; boss et date au centre.

let matchs = [];     // terminés
let matchsEquipe = []; // terminés en équipe (2v2, 3v3, 4v4)
let matchsEnCours = [];
let litiges = [];      // administrateurs : matchs invalidés par un litige
let statsLitiges = []; // administrateurs : litiges par joueur
let erreurLitiges = null; // administrateurs : problème de lecture côté base
let entrainements = []; // entraînements lancés par le joueur connecté (lui seul)
let signalements = []; // administrateurs : matchs signalés, pas encore traités
let erreurSignalements = null;
// Joueur connecté : { banni, restants, signales: Set des ids de matchs déjà
// signalés } (cf. api/_lib/signalements.js), null si déconnecté.
let etatSignalement = null;
let estAdmin = false;
// Modération : colonne triée (décroissant) et joueur filtré dans les litiges.
let triLitiges = "total";
let joueurLitiges = null;
let personnagesParId = new Map(); // catalogue de draft (un seul Voyageur)
let groupeParId = new Map(); // "traveler_pyro" -> "traveler" (anciens matchs)
let bossParId = new Map();
let moiDiscordId = null;

// Tris combinables (cf. commun/tri.js) : 1er clic = un sens, 2e clic =
// l'autre, 3e clic = désactivé ; appliqués dans l'ordre des clics (ex. boss
// puis temps : les matchs de chaque boss triés par temps). Sans tri : plus
// récents d'abord.
const etatTri = creerEtatTri();
let mesMatchsSeulement = false;
let classesSeulement = false;
// Saison choisie dans la liste déroulante ("" : toutes), et saisons du
// classé (cf. api/_lib/saisons.js).
let saisonFiltre = "";
let saisons = [];

// Sens du 1er clic : plus récents, meilleurs temps, matchs les plus serrés
// et boss de A à Z d'abord.
const SENS_INITIAL = { date: -1, temps: 1, ecart: 1 };
// Boss choisi dans la liste déroulante ("" : tous).
let bossFiltre = "";
// Catégorie de boss (bouton qui défile : tous -> hebdo -> légendes locales ->
// carnage -> tous), cf. CATEGORIES_BOSS.
let categorieBossFiltre = null;

// Recherche d'un temps précis ("7:32", "7.32", "7,32", "07:32") -> "7:32"
// (format des temps enregistrés), ou null si ce n'est pas un temps.
function tempsRecherche(texte) {
  const correspondance = texte.match(/^(\d{1,3})[:.,](\d{2})$/);
  if (!correspondance || Number(correspondance[2]) > 59) return null;
  return `${Number(correspondance[1])}:${correspondance[2]}`;
}

// Phase d'une room en cours, affichée au centre de sa ligne.
const LIBELLES_PHASES = {
  choix_box: "Choix des box",
  analyse: "Analyse des box",
  bans_bonus: "Bans d'équilibrage",
  boss: "Choix du boss",
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
      if (t1 === null && t2 === null) return null;
      // Défi : nombre d'ennemis tués (le plus grand est le meilleur), en
      // négatif pour être trié dans le même sens que les temps (les défis
      // passent alors avant les matchs chronométrés).
      if (estDefiEnnemis(bossParId.get(match.boss_id))) return -Math.max(...[t1, t2].filter(t => t !== null));
      return Math.min(...[t1, t2].filter(t => t !== null));
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
      ...["j1", "j2"].flatMap(role => (match.equipe?.[role]?.membres || []).map(m => m.nom)),
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

// Joueur dans ce match (les 2 joueurs, ou tous ceux des 2 équipes).
function joueDans(match, discordId) {
  if (match.equipe) return ["j1", "j2"].some(role => (match.equipe[role]?.membres || []).some(m => m.discord_id === discordId));
  return match.j1.discord_id === discordId || match.j2.discord_id === discordId;
}

// source : matchs 1v1 (onglet Matchs) ou en équipe (onglet Matchs en équipe).
function matchsAffiches(source = matchs) {
  const recherche = document.getElementById("recherche").value.trim().toLowerCase();
  // Temps précis : matchs où l'un des 2 joueurs a fait exactement ce temps.
  const temps = tempsRecherche(recherche);
  const tris = trisActifs();
  return source
    .filter(match => !bossFiltre || match.boss_id === bossFiltre)
    .filter(match => !categorieBossFiltre || bossDansCategorie(match.boss_id, categorieBossFiltre))
    .filter(match => !temps || match.j1.temps?.affiche === temps || match.j2.temps?.affiche === temps)
    .filter(match => !mesMatchsSeulement || joueDans(match, moiDiscordId))
    .filter(match => !classesSeulement || match.classe || source === matchsEquipe)
    .filter(match => saisonFiltre === "" || match.saison === Number(saisonFiltre))
    .filter(match => temps || !recherche || texteRecherche(match).includes(recherche))
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
  const categorie = CATEGORIES_BOSS.find(c => c.cle === categorieBossFiltre);
  const bouton = document.getElementById("categorie-boss");
  bouton.classList.toggle("active", !!categorie);
  bouton.textContent = categorie ? categorie.bouton : "Tous les boss";
  // Liste des boss : seulement ceux de la catégorie choisie.
  document.querySelectorAll("#filtre-boss optgroup").forEach(groupe => {
    groupe.hidden = !!categorie && groupe.dataset.categorie !== categorie.cle;
  });
}

// ---- Pages : matchs par page au choix (10, 20, 50 ou tout), par
// catégorie (matchs terminés, entraînements, litiges), sans changer de page
// web. Choix gardé sur cet appareil. ----
const CHOIX_PAR_PAGE = ["10", "20", "50", "tout"];
const CLE_PAR_PAGE = "historique-matchs-par-page";
const pages = { matchs: 1, equipe: 1, world_boss: 1, entrainements: 1, litiges: 1, signalements: 1 };

function lireParPage() {
  try {
    const valeur = localStorage.getItem(CLE_PAR_PAGE);
    return CHOIX_PAR_PAGE.includes(valeur) ? valeur : "10";
  } catch {
    return "10";
  }
}

let parPage = lireParPage();

// Nombre de matchs par page (Infinity pour "tout").
function matchsParPage() {
  return parPage === "tout" ? Infinity : Number(parPage);
}

function initialiserParPage() {
  const select = document.getElementById("matchs-par-page");
  select.value = parPage;
  select.addEventListener("change", () => {
    parPage = CHOIX_PAR_PAGE.includes(select.value) ? select.value : "10";
    try {
      localStorage.setItem(CLE_PAR_PAGE, parPage);
    } catch {
      // Stockage indisponible : choix gardé jusqu'au rechargement.
    }
    Object.keys(pages).forEach(categorie => { pages[categorie] = 1; });
    afficherEntrainements();
    afficherSignalements();
    afficherLitiges();
    afficherMatchs();
    afficherWorldBoss();
  });
}

// Matchs de la page en cours d'une catégorie (page ramenée dans les bornes)
// et barre de pages en dessous de sa liste.
function paginer(categorie, liste, reafficher) {
  const parPageNb = matchsParPage();
  const nbPages = Number.isFinite(parPageNb) ? Math.max(1, Math.ceil(liste.length / parPageNb)) : 1;
  pages[categorie] = Math.min(Math.max(1, pages[categorie]), nbPages);
  const page = pages[categorie];

  const barre = document.getElementById(`pages-${categorie}`);
  barre.classList.toggle("cache", nbPages <= 1);
  if (nbPages > 1) {
    const bouton = (texte, cible, desactive, titre) =>
      `<button type="button" class="bouton-page" data-page="${cible}"${desactive ? " disabled" : ""} title="${titre}">${texte}</button>`;
    barre.innerHTML = [
      bouton("«", 1, page === 1, "Première page"),
      bouton("‹ Préc.", page - 1, page === 1, "Page précédente"),
      `<span class="numero-page">Page ${page} / ${nbPages}</span>`,
      bouton("Suiv. ›", page + 1, page === nbPages, "Page suivante"),
      bouton("»", nbPages, page === nbPages, "Dernière page")
    ].join("");
    barre.onclick = event => {
      const btn = event.target.closest(".bouton-page");
      if (!btn || btn.disabled) return;
      pages[categorie] = Number(btn.dataset.page);
      reafficher();
      // Haut de la catégorie (la liste change de hauteur).
      barre.closest(".section-matchs").scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }
  return Number.isFinite(parPageNb) ? liste.slice((page - 1) * parPageNb, page * parPageNb) : liste;
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

// aleatoire : choisi au hasard (temps écoulé, draft classée) -> entouré
// d'orange, comme dans la page du match.
function htmlPerso(id, parametres, { element = null, banni = false, infos = null, infosJoueurs = null, aleatoire = false, joueur = null } = {}) {
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

  const titre = echapperHtml((aleatoire ? `${nom} (choisi au hasard : temps écoulé)` : nom) + (joueur ? ` — joué par ${joueur}` : ""));
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
  const saison = reel?.saison?.[role] ? `, bonus de saison ${gagnant ? "+" : "−"}${reel.saison[role]}${gagnant ? "" : " de perte"}` : "";
  const bonus = (gagnant && reel?.bonus ? ` dont +${reel.bonus} de série` : "") +
    (gagnant && reel?.prime ? `, prime +${reel.prime} (plus longue série battue)` : "") + saison;
  const trophees = match.classe && match.trophees && (gagnant || perdant)
    ? `<span class="etiquette-resultat trophees ${gagnant ? "gain" : "perte"}" title="Trophées${bonus}">${gagnant ? "+" : "−"}${nbTrophees} ${ICONE_TROPHEE}${bonus ? " 🔥" : ""}</span>`
    : "";

  // Match d'équipe : joueur qui a joué chaque perso (dans l'info-bulle).
  const membres = match.equipe?.[role]?.membres || [];
  const nomMembre = id => membres.find(m => m.discord_id === id)?.nom;
  const equipe = joueur.equipe.map(p => htmlPerso(p.id, joueur.parametres, { element: p.element, infos: p, aleatoire: p.aleatoire, joueur: nomMembre(p.joue_par) })).join("");
  const htmlBan = ban => htmlPerso(ban.id, joueur.parametres, { banni: true, infosJoueurs: ban.infos, aleatoire: ban.aleatoire });
  const bans = joueur.bans.map(htmlBan).join("");
  const equilibrage = joueur.bans_equilibrage.map(htmlBan).join("");

  // Match en équipe : bannière de chaque joueur (★ chef), puis résultat et
  // temps de l'équipe ; sinon la bannière du joueur avec son temps.
  const bannieres = match.equipe
    ? `<div class="bannieres-equipe">${membres.map(m => `
        <div class="match-banniere banniere-joueur banniere-membre${role === "j1" ? " cote-gauche" : ""}" style="--banniere2: url(&quot;${echapperHtml(encodeURI(`../DB/images/${m.banniere2}`))}&quot;)">
          ${m.avatar ? `<img class="match-avatar photo-joueur" src="${echapperHtml(m.avatar)}" alt="">` : ""}
          <span class="match-nom" data-membre="${echapperHtml(m.discord_id)}"></span>
          ${m.discord_id === match.equipe[role]?.chef ? `<span class="etiquette-resultat chef-equipe" title="Chef de l'équipe">★ Chef</span>` : ""}
        </div>`).join("")}
      </div>
      <div class="resultat-equipe">${etiquette}<span class="match-temps">${joueur.temps ? joueur.temps.affiche : "—"}</span></div>`
    : `<div class="match-banniere banniere-joueur${role === "j1" ? " cote-gauche" : ""}" style="--banniere2: url(&quot;${echapperHtml(banniere)}&quot;)">
        ${joueur.avatar ? `<img class="match-avatar photo-joueur" src="${joueur.avatar}" alt="">` : ""}
        <span class="match-nom"></span>
        ${htmlMedailleTheatre(joueur.theatre)}
        ${etiquette}
        ${trophees}
        <span class="match-temps">${joueur.temps ? joueur.temps.affiche : "—"}</span>
      </div>`;

  return `
    <div class="match-joueur match-${role}${gagnant ? " gagnant" : egalite ? " egalite" : ""}">
      ${bannieres}
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
  if (!enCours) ligne.dataset.matchId = String(match.id);
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
       ${match.litige === "republie" ? `<span class="match-note match-litige-corrige">Litige corrigé (${nomLitigePar(match)})</span>` : ""}
       ${match.signalements ? htmlTraitementSignalement(match) : htmlBoutonSignaler(match)}`;
  if (match.litige === "ouvert") ligne.classList.add("litige");
  if (match.signalements) ligne.classList.add("signale");
  if (match.entrainement) ligne.classList.add("entrainement");

  ligne.innerHTML = `
    ${htmlJoueur(match, "j1", enCours || match.bans_connus)}
    <div class="match-centre">
      ${boss ? htmlImagesBoss(boss, `class="match-boss" loading="lazy"`) : ""}
      ${match.entrainement ? `<span class="match-entrainement">Entraînement ${ICONE_ENTRAINEMENT}</span>` : ""}
      ${match.equipe ? `<span class="match-entrainement match-mode-equipe">${echapperHtml(match.equipe.mode)}</span>` : ""}
      ${match.classe ? `<span class="match-classe">Classé ${ICONE_TROPHEE}${match.mode_theatre === "12" ? " · Mêlée générale" : ""}</span>` : ""}
      ${match.mode_theatre === "carnage" ? `<span class="match-carnage" title="Théâtre 12 sans bans d'équilibrage">Carnage 💀</span>` : ""}
      ${htmlTheatreJoue(match.theatre)}
      <span class="match-boss-nom">${boss ? boss.nom : enCours ? "Boss pas encore tiré" : ""}</span>
      ${infos}
    </div>
    ${htmlJoueur(match, "j2", enCours || match.bans_connus)}
  `;
  // Pseudos en texte (pas d'HTML venant des comptes).
  if (match.equipe) {
    ["j1", "j2"].forEach(role => {
      (match.equipe[role]?.membres || []).forEach(m => {
        const nom = ligne.querySelector(`.match-${role} .match-nom[data-membre="${CSS.escape(m.discord_id)}"]`);
        if (nom) nom.textContent = m.nom;
      });
    });
  } else {
    ligne.querySelector(".match-j1 .match-nom").textContent = match.j1.nom;
    ligne.querySelector(".match-j2 .match-nom").textContent = match.j2.nom;
  }
  if (match.litige === "ouvert") brancherCorrectionLitige(ligne, match);
  if (match.signalements) brancherTraitementSignalement(ligne, match);
  ligne.querySelector(".bouton-signaler:not(:disabled)")?.addEventListener("click", () => ouvrirFenetreSignalement(match));
  return ligne;
}

// ---- Onglet Random World Boss (GET /api/matches?world_boss=1, chargé à
// la 1re ouverture) ----
let partiesWorldBoss = null;
let chargementWorldBoss = null;

function ouvrirWorldBoss() {
  if (partiesWorldBoss || chargementWorldBoss) return;
  chargementWorldBoss = fetch("/api/matches?world_boss=1", { credentials: "include" })
    .then(async reponse => {
      if (!reponse.ok) throw new Error("Impossible de charger les parties Random world boss.");
      partiesWorldBoss = (await reponse.json()).parties || [];
      afficherWorldBoss();
    })
    .catch(erreur => {
      console.error(erreur);
      document.getElementById("etat-world_boss").textContent = erreur.message;
    })
    .finally(() => { chargementWorldBoss = null; });
}

function afficherWorldBoss() {
  if (!partiesWorldBoss) return;
  const etat = document.getElementById("etat-world_boss");
  etat.textContent = partiesWorldBoss.length === 0 ? "Aucune partie jouée pour l'instant." : "";
  etat.classList.toggle("cache", !etat.textContent);
  document.getElementById("liste-world_boss").replaceChildren(...paginer("world_boss", partiesWorldBoss, afficherWorldBoss).map(creerLigneWorldBoss));
}

// Ligne d'une partie : bannières des joueurs (★ chef) à gauche, boss et
// réussite au centre, persos tirés (qui les a joués, constellation) à droite.
function creerLigneWorldBoss(partie) {
  const ligne = document.createElement("article");
  ligne.className = `match match-world-boss ${partie.reussite ? "reussite" : "echec"}`;
  const boss = bossParId.get(partie.boss_id);
  const nomMembre = id => partie.membres.find(m => m.discord_id === id)?.nom;
  const persos = partie.persos.map(p => htmlPerso(p.perso_id, {}, {
    element: p.element,
    infos: { constellation: p.constellation, niveau: p.niveau, raffinement: null },
    joueur: nomMembre(p.joue_par)
  })).join("");
  // Qui a joué quoi, en texte sous les persos.
  const repartition = partie.membres.map(m => {
    const siens = partie.persos.filter(p => p.joue_par === m.discord_id).map(p => {
      const nom = personnagesParId.get(p.perso_id)?.nom || p.perso_id;
      // Voyageur regroupé : nom de son 1er élément, remplacé par le sien.
      const sansElement = nom.replace(new RegExp(` (${Object.values(NOMS_ELEMENTS).join("|")})$`), "");
      return p.element ? `${sansElement} ${NOMS_ELEMENTS[p.element] || ""}` : nom;
    });
    return `<li><span class="nom-repartition" data-membre="${echapperHtml(m.discord_id)}"></span> : ${echapperHtml(siens.join(", ") || "—")}</li>`;
  }).join("");
  ligne.innerHTML = `
    <div class="match-joueur match-j1">
      <div class="bannieres-equipe">${partie.membres.map(m => `
        <div class="match-banniere banniere-joueur banniere-membre cote-gauche" style="--banniere2: url(&quot;${echapperHtml(encodeURI(`../DB/images/${m.banniere2}`))}&quot;)">
          ${m.avatar ? `<img class="match-avatar photo-joueur" src="${echapperHtml(m.avatar)}" alt="">` : ""}
          <span class="match-nom" data-membre="${echapperHtml(m.discord_id)}"></span>
          ${htmlMedailleTheatre(m.theatre)}
          ${m.discord_id === partie.createur ? `<span class="etiquette-resultat chef-equipe" title="Chef de la room">★ Chef</span>` : ""}
        </div>`).join("")}
      </div>
    </div>
    <div class="match-centre">
      ${boss ? htmlImagesBoss(boss, `class="match-boss" loading="lazy"`) : ""}
      <span class="match-entrainement match-mode-equipe">Random world boss</span>
      <span class="etiquette-resultat ${partie.reussite ? "victoire" : "echec-wb"}">${partie.reussite ? "Réussite" : "Échec"}</span>
      <span class="match-boss-nom">${boss ? echapperHtml(boss.nom) : ""}</span>
      <span class="match-date">${formaterDate(partie.date)}</span>
    </div>
    <div class="match-joueur match-j2">
      ${htmlLigne("Persos", persos)}
      <ul class="repartition-wb">${repartition}</ul>
    </div>`;
  // Pseudos en texte (pas d'HTML venant des comptes).
  partie.membres.forEach(m => {
    ligne.querySelectorAll(`[data-membre="${CSS.escape(m.discord_id)}"]`).forEach(element => { element.textContent = m.nom; });
  });
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

  liste.replaceChildren(...paginer("matchs", affiches, afficherMatchs)
    .map(match => obtenirCarte(liste, String(match.id), () => creerLigneMatch(match))));
  terminerRendu(liste);
  afficherMatchsEquipe();
}

// Onglet Matchs en équipe : mêmes filtres que l'onglet Matchs.
function afficherMatchsEquipe() {
  const liste = document.getElementById("liste-equipe");
  const affiches = matchsAffiches(matchsEquipe);
  const etat = document.getElementById("etat-equipe");
  etat.textContent = matchsEquipe.length === 0 ? "Aucun match en équipe joué pour l'instant."
    : affiches.length === 0 ? "Aucun match trouvé." : "";
  etat.classList.toggle("cache", !etat.textContent);
  liste.replaceChildren(...paginer("equipe", affiches, afficherMatchsEquipe)
    .map(match => obtenirCarte(liste, String(match.id), () => creerLigneMatch(match))));
  terminerRendu(liste);
}

// Filtres, recherche ou tris changés : retour à la 1re page.
function afficherMatchsDepuisPage1() {
  pages.matchs = 1;
  pages.equipe = 1;
  afficherMatchs();
}

// Entraînements du joueur connecté (onglet visible pour lui seul).
function afficherEntrainements() {
  const etat = document.getElementById("etat-entrainements");
  etat.textContent = entrainements.length === 0 ? "Aucun entraînement pour l'instant." : "";
  etat.classList.toggle("cache", !etat.textContent);
  document.getElementById("liste-entrainements").replaceChildren(...paginer("entrainements", entrainements, afficherEntrainements).map(creerLigneMatch));
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
// Temps d'un joueur modifiable (litige ou signalement). Défi (cf.
// estDefiEnnemis) : nombre d'ennemis tués seul (affiché "42 ennemis").
function htmlChampTemps(match, role) {
  const temps = match[role].temps;
  if (estDefiEnnemis(bossParId.get(match.boss_id))) {
    const valeur = temps?.abandon || temps?.secondes == null ? temps?.affiche || "" : temps.secondes;
    return `
    <label class="champ-temps-litige champ-${role}">
      <span class="nom-temps-litige"></span>
      <input type="text" inputmode="numeric" name="temps_${role}" value="${valeur}" placeholder="ennemis tués" title="Nombre d'ennemis tués ou abandon">
    </label>`;
  }
  return `
    <label class="champ-temps-litige champ-${role}">
      <span class="nom-temps-litige"></span>
      <input type="text" inputmode="decimal" name="temps_${role}" value="${temps?.affiche || ""}" placeholder="mm:ss" title="Temps (mm:ss) ou abandon">
    </label>`;
}

// Sanction d'un joueur (ban du mode classé), litige ou signalement.
function htmlSanction(role) {
  return `
    <label class="champ-sanction champ-${role}">
      <span class="nom-temps-litige"></span>
      <select name="sanction_${role}">
        <option value="aucune">Aucune conséquence</option>
        <option value="semaine">Ban classé 1 semaine</option>
        <option value="saison">Ban classé jusqu'à la fin de la saison</option>
        <option value="definitif">Ban classé définitif</option>
      </select>
    </label>`;
}

function htmlCorrectionLitige(match) {
  const champ = role => htmlChampTemps(match, role);
  // Anti-triche : temps passé à saisir et somme des temps saisis.
  const fmt = s => s == null ? "?" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const triche = match.triche && match.triche.duree_saisie != null
    ? `<span class="alerte-triche" title="Somme des temps saisis supérieure au temps écoulé depuis la fin de la draft">⚠️ Suspicion de triche : temps saisis ${fmt(match.triche.duree_saisie)} après la fin de la draft, somme des temps ${fmt(match.triche.somme_temps)}</span>`
    : "";
  // Temps sous les meilleurs temps connus du boss : danger 1 (sous le temps
  // limite) ou 2 (sous le temps minimum), preuve vidéo à demander.
  const suspects = ["j1", "j2"].filter(role => match.suspicion?.[role]).map(role => {
    const s = match.suspicion[role];
    return `<span class="alerte-triche danger-${s.niveau}">${s.niveau === 2 ? "⚠️⚠️ Danger 2" : "⚠️ Danger 1"} : ` +
      `${echapperHtml(match[role].nom)} en ${fmt(s.secondes)}, sous le temps ${s.niveau === 2 ? `minimum (${fmt(s.minimum)})` : `limite (${fmt(s.limite)})`}. Preuve vidéo à demander.</span>`;
  }).join("");
  // Sanction de chaque joueur (ban du mode classé), puis dossier clos.
  const sanction = htmlSanction;
  return `
    <span class="match-litige">${match.triche ? "Triche suspectée" : "Litige"} <span class="litige-par"></span></span>
    ${match.litige_commentaire ? `<p class="commentaire-litige-historique"></p>` : ""}
    ${triche}
    ${suspects}
    <form class="correction-litige">
      ${champ("j1")}
      ${champ("j2")}
      <button type="submit" class="bouton-historique bouton-republier">Corriger et republier</button>
    </form>
    <form class="sanction-litige">
      ${sanction("j1")}
      ${sanction("j2")}
      <label class="champ-fin-saison cache">Fin de la saison <input type="date" name="fin_saison"></label>
      <button type="submit" class="bouton-historique bouton-sanction">Appliquer et clore le dossier</button>
    </form>`;
}

// Sanctions : un choix par joueur ; "fin de la saison" demande une date.
function brancherSanctionLitige(ligne, match) {
  const formulaire = ligne.querySelector(".sanction-litige");
  formulaire.querySelector(".champ-j1 .nom-temps-litige").textContent = match.j1.nom;
  formulaire.querySelector(".champ-j2 .nom-temps-litige").textContent = match.j2.nom;
  const champSaison = formulaire.querySelector(".champ-fin-saison");
  const choix = role => formulaire.elements[`sanction_${role}`].value;
  formulaire.addEventListener("change", () => {
    champSaison.classList.toggle("cache", !["j1", "j2"].some(role => choix(role) === "saison"));
  });
  formulaire.addEventListener("submit", async event => {
    event.preventDefault();
    const libelle = role => formulaire.elements[`sanction_${role}`].selectedOptions[0].textContent;
    if (!confirm(`Clore ce dossier ?\n${match.j1.nom} : ${libelle("j1")}\n${match.j2.nom} : ${libelle("j2")}\nLe match reste invalidé.`)) return;
    const bouton = formulaire.querySelector(".bouton-sanction");
    bouton.disabled = true;
    try {
      const reponse = await fetch(`/api/matches?id=${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sanction",
          sanctions: { j1: choix("j1"), j2: choix("j2") },
          fin_saison: formulaire.elements.fin_saison.value || null
        })
      });
      const data = await reponse.json().catch(() => ({}));
      if (!reponse.ok) throw new Error(data.error || "Erreur lors de l'application des sanctions.");
      await rafraichir();
    } catch (erreur) {
      alert(erreur.message);
      bouton.disabled = false;
    }
  });
}

function brancherCorrectionLitige(ligne, match) {
  brancherSanctionLitige(ligne, match);
  // Pseudos en texte (pas d'HTML venant des comptes).
  ligne.querySelector(".litige-par").innerHTML = nomLitigePar(match);
  // Raison donnée par le joueur (texte libre : jamais en HTML).
  const commentaire = ligne.querySelector(".commentaire-litige-historique");
  if (commentaire) commentaire.textContent = `« ${match.litige_commentaire} »`;
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

// ---- Signalements : tout joueur connecté peut signaler un match terminé
// (sauf pendant un ban du classé), une fois par match et 10 par jour ; le
// match reste valide tant qu'un administrateur ne l'a pas traité (cf.
// api/_lib/signalements.js). ----
const COMMENTAIRE_SIGNALEMENT_MAX = 500;
let matchASignaler = null;

// Bouton sous la date d'un match terminé encore valide (joueur connecté).
function htmlBoutonSignaler(match) {
  if (!etatSignalement || etatSignalement.banni || !match.signalable || match.room_id) return "";
  if (etatSignalement.signales.has(String(match.id))) {
    return `<button type="button" class="bouton-signaler signale" disabled title="Un administrateur va vérifier ce match">⚑ Signalé</button>`;
  }
  const epuise = etatSignalement.restants <= 0;
  return `<button type="button" class="bouton-signaler"${epuise ? ` disabled title="10 signalements par jour au plus (reset à 4 h)"` : ` title="Signaler ce match aux administrateurs"`}>⚑ Signaler</button>`;
}

function ouvrirFenetreSignalement(match) {
  matchASignaler = match;
  const boss = bossParId.get(match.boss_id);
  document.getElementById("match-fenetre-signalement").textContent =
    `${match.j1.nom} contre ${match.j2.nom}${boss ? ` · ${boss.nom}` : ""} · ${formaterDate(match.date)}`;
  const champ = document.getElementById("commentaire-signalement");
  champ.value = "";
  mettreAJourFenetreSignalement();
  document.getElementById("fenetre-signalement").classList.remove("cache");
  champ.focus();
}

function fermerFenetreSignalement() {
  document.getElementById("fenetre-signalement").classList.add("cache");
  matchASignaler = null;
}

function mettreAJourFenetreSignalement() {
  const champ = document.getElementById("commentaire-signalement");
  document.getElementById("compteur-signalement").textContent = `${champ.value.length} / ${COMMENTAIRE_SIGNALEMENT_MAX}`;
  document.getElementById("envoyer-signalement").disabled = champ.value.trim().length === 0;
}

// Après un signalement : boutons de toutes les lignes mis à jour (match
// signalé, ou plus aucun signalement possible aujourd'hui).
function mettreAJourBoutonsSignaler() {
  document.querySelectorAll(".bouton-signaler").forEach(bouton => {
    const ligne = bouton.closest(".match");
    const match = ligne && [...matchs, ...signalements].find(m => String(m.id) === ligne.dataset.matchId);
    if (!match) return;
    const modele = document.createElement("template");
    modele.innerHTML = htmlBoutonSignaler(match).trim();
    const nouveau = modele.content.firstElementChild;
    if (!nouveau) return bouton.remove();
    if (!nouveau.disabled) nouveau.addEventListener("click", () => ouvrirFenetreSignalement(match));
    bouton.replaceWith(nouveau);
  });
}

function initialiserFenetreSignalement() {
  const fenetre = document.getElementById("fenetre-signalement");
  const champ = document.getElementById("commentaire-signalement");
  champ.maxLength = COMMENTAIRE_SIGNALEMENT_MAX;
  champ.addEventListener("input", mettreAJourFenetreSignalement);
  document.getElementById("annuler-signalement").addEventListener("click", fermerFenetreSignalement);
  fenetre.addEventListener("click", event => {
    if (event.target === fenetre) fermerFenetreSignalement();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !fenetre.classList.contains("cache")) fermerFenetreSignalement();
  });
  document.getElementById("envoyer-signalement").addEventListener("click", async () => {
    const bouton = document.getElementById("envoyer-signalement");
    const commentaire = champ.value.trim();
    const match = matchASignaler;
    if (!commentaire || !match) return;
    bouton.disabled = true;
    try {
      const reponse = await fetch(`/api/matches?id=${encodeURIComponent(match.id)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentaire })
      });
      const data = await reponse.json().catch(() => ({}));
      // Déjà signalé (autre onglet) : bouton mis à jour quand même.
      if (reponse.ok || reponse.status === 409) etatSignalement.signales.add(String(match.id));
      if (!reponse.ok) throw new Error(data.error || "Erreur lors du signalement.");
      if (typeof data.restants === "number") etatSignalement.restants = data.restants;
      fermerFenetreSignalement();
      mettreAJourBoutonsSignaler();
      // Administrateur : le match arrive dans ses signalements.
      if (estAdmin) await rafraichir();
    } catch (erreur) {
      alert(erreur.message);
      mettreAJourBoutonsSignaler();
      bouton.disabled = false;
    }
  });
}

// Administrateurs : qui a signalé, pourquoi, et la décision (sans suite,
// temps corrigés ou match invalidé ; ban du classé possible dans tous les
// cas).
function htmlTraitementSignalement(match) {
  const nb = match.signalements.length;
  return `
    <span class="match-signale">Signalé ${nb > 1 ? `${nb} fois` : ""}</span>
    <ul class="signalements-match">
      ${match.signalements.map(() => `
        <li>
          <span class="auteur-signalement"><span class="nom-signalement"></span> <span class="date-signalement"></span></span>
          <p class="commentaire-signalement"></p>
        </li>`).join("")}
    </ul>
    <form class="traitement-signalement">
      <label class="champ-decision">Décision
        <select name="decision">
          <option value="sans_suite">Classer sans suite (match inchangé)</option>
          <option value="corrige">Corriger les temps (match toujours valide)</option>
          <option value="invalide">Invalider le match (ne compte plus)</option>
        </select>
      </label>
      <div class="temps-signalement cache">
        ${htmlChampTemps(match, "j1")}
        ${htmlChampTemps(match, "j2")}
      </div>
      ${htmlSanction("j1")}
      ${htmlSanction("j2")}
      <label class="champ-fin-saison cache">Fin de la saison <input type="date" name="fin_saison"></label>
      <button type="submit" class="bouton-historique bouton-traiter-signalement">Clore le signalement</button>
    </form>`;
}

function brancherTraitementSignalement(ligne, match) {
  // Pseudos et raisons en texte (pas d'HTML venant des joueurs).
  ligne.querySelectorAll(".signalements-match li").forEach((element, index) => {
    const signalement = match.signalements[index];
    element.querySelector(".nom-signalement").textContent = signalement.nom;
    element.querySelector(".date-signalement").textContent = formaterDate(signalement.date);
    element.querySelector(".commentaire-signalement").textContent = `« ${signalement.commentaire} »`;
  });
  const formulaire = ligne.querySelector(".traitement-signalement");
  formulaire.querySelectorAll(".champ-j1 .nom-temps-litige").forEach(e => { e.textContent = match.j1.nom; });
  formulaire.querySelectorAll(".champ-j2 .nom-temps-litige").forEach(e => { e.textContent = match.j2.nom; });

  const valeur = nom => formulaire.elements[nom].value;
  const libelle = nom => formulaire.elements[nom].selectedOptions[0].textContent;
  formulaire.addEventListener("change", () => {
    formulaire.querySelector(".temps-signalement").classList.toggle("cache", valeur("decision") !== "corrige");
    formulaire.querySelector(".champ-fin-saison").classList.toggle("cache",
      !["j1", "j2"].some(role => valeur(`sanction_${role}`) === "saison"));
  });
  formulaire.addEventListener("submit", async event => {
    event.preventDefault();
    const decision = valeur("decision");
    const temps = role => formulaire.elements[`temps_${role}`].value.trim();
    const details = decision === "corrige" ? `\nTemps : ${temps("j1")} (${match.j1.nom}) et ${temps("j2")} (${match.j2.nom})` : "";
    if (!confirm(`Clore ce signalement ?\n${libelle("decision")}${details}\n${match.j1.nom} : ${libelle("sanction_j1")}\n${match.j2.nom} : ${libelle("sanction_j2")}`)) return;
    const bouton = formulaire.querySelector(".bouton-traiter-signalement");
    bouton.disabled = true;
    try {
      const reponse = await fetch(`/api/matches?id=${encodeURIComponent(match.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "signalement",
          decision,
          temps_j1: temps("j1"),
          temps_j2: temps("j2"),
          sanctions: { j1: valeur("sanction_j1"), j2: valeur("sanction_j2") },
          fin_saison: valeur("fin_saison") || null
        })
      });
      const data = await reponse.json().catch(() => ({}));
      if (!reponse.ok) throw new Error(data.error || "Erreur lors du traitement du signalement.");
      await rafraichir();
    } catch (erreur) {
      alert(erreur.message);
      bouton.disabled = false;
    }
  });
}

function afficherSignalements() {
  if (!estAdmin) return;
  const etat = document.getElementById("etat-signalements");
  etat.textContent = erreurSignalements || (signalements.length === 0 ? "Aucun match signalé." : "");
  document.getElementById("liste-signalements").replaceChildren(...paginer("signalements", signalements, afficherSignalements).map(creerLigneMatch));
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
      pages.litiges = 1;
      afficherLitiges();
    });
    return ligne;
  }));
}

function afficherLitiges() {
  if (!estAdmin) return;
  // Nombre de litiges ouverts et de matchs signalés sous le titre de l'onglet.
  document.getElementById("sous-titre-litiges").textContent =
    `${litiges.length} ouvert${litiges.length > 1 ? "s" : ""} · ${signalements.length} signalé${signalements.length > 1 ? "s" : ""}`;
  afficherStatsLitiges();

  const filtre = document.getElementById("filtre-litiges");
  const joueur = statsLitiges.find(s => s.discord_id === joueurLitiges);
  filtre.classList.toggle("cache", !joueur);
  filtre.innerHTML = joueur ? `— ${htmlPseudo(joueur.nom)} (cliquer à nouveau sur le joueur pour tout afficher)` : "";

  const affiches = litiges.filter(match => !joueurLitiges ||
    match.j1.discord_id === joueurLitiges || match.j2.discord_id === joueurLitiges);
  document.getElementById("etat-litiges").textContent = erreurLitiges
    || (affiches.length === 0 ? "Aucun litige ouvert." : "");
  document.getElementById("liste-litiges").replaceChildren(...paginer("litiges", affiches, afficherLitiges).map(creerLigneMatch));
}

// Après une republication : litige retiré, match ajouté aux terminés.
async function rafraichir() {
  const historique = await chargerHistorique();
  appliquerHistorique(historique);
  viderCacheCartes(document.getElementById("liste-matchs"));
  afficherMatchsEnCours();
  afficherEntrainements();
  afficherSignalements();
  afficherLitiges();
  afficherMatchs();
}

function appliquerHistorique(historique) {
  signalements = historique.signalements || [];
  erreurSignalements = historique.erreur_signalements || null;
  etatSignalement = historique.signalement
    ? { ...historique.signalement, signales: new Set(historique.signalement.signales || []) }
    : null;
  // Matchs 1v1 et matchs en équipe : onglets séparés.
  matchs = (historique.termines || []).filter(match => !match.equipe);
  matchsEquipe = (historique.termines || []).filter(match => match.equipe);
  matchsEnCours = historique.en_cours || [];
  litiges = historique.litiges || [];
  statsLitiges = historique.stats_litiges || [];
  erreurLitiges = historique.erreur_litiges || null;
  entrainements = historique.entrainements || [];
  saisons = historique.saisons || [];
}

// ---- Onglets : Litiges (administrateurs), Mes entraînements (joueur
// connecté), Matchs (en cours et terminés), Statistiques. Onglet ouvert
// gardé sur cet appareil. ----
const CLE_ONGLET = "historique-onglet";
let onglet = "matchs";

function ongletDisponible(nom) {
  return nom === "matchs" || nom === "equipe" || nom === "world_boss" || nom === "stats" ||
    (nom === "litiges" && estAdmin) || (nom === "entrainements" && !!moiDiscordId);
}

function choisirOnglet(nouveau) {
  onglet = ongletDisponible(nouveau) ? nouveau : "matchs";
  try {
    localStorage.setItem(CLE_ONGLET, onglet);
  } catch {
    // Stockage indisponible : onglet gardé jusqu'au rechargement.
  }
  document.querySelectorAll(".onglet-historique").forEach(bouton => {
    const actif = bouton.dataset.onglet === onglet;
    bouton.classList.toggle("active", actif);
    bouton.setAttribute("aria-selected", String(actif));
  });
  document.querySelectorAll(".panneau-historique").forEach(panneau => {
    panneau.classList.toggle("cache", panneau.dataset.panneau !== onglet);
  });
  // Barre : filtres des matchs sur Matchs seulement ; matchs par page aussi
  // sur les autres listes ; rien sur Statistiques.
  document.querySelector(".barre-historique").classList.toggle("cache", onglet === "stats");
  document.querySelectorAll(".filtre-matchs").forEach(element => {
    element.classList.toggle("masque-onglet", onglet !== "matchs" && onglet !== "equipe");
  });
  // Pas de classé en équipe : bouton Classés sur l'onglet Matchs seulement.
  document.getElementById("matchs-classes").classList.toggle("masque-onglet", onglet !== "matchs");
  if (onglet === "stats") ouvrirStatistiques();
  if (onglet === "world_boss") ouvrirWorldBoss();
}

function initialiserOnglets() {
  document.querySelectorAll(".onglet-historique").forEach(bouton => {
    bouton.classList.toggle("cache", !ongletDisponible(bouton.dataset.onglet));
    bouton.addEventListener("click", () => choisirOnglet(bouton.dataset.onglet));
  });
  let enregistre = null;
  try {
    enregistre = localStorage.getItem(CLE_ONGLET);
  } catch {
    // Stockage indisponible : onglet Matchs.
  }
  // Lien vers un onglet précis (?onglet=equipe), sinon le dernier ouvert.
  choisirOnglet(new URLSearchParams(window.location.search).get("onglet") || enregistre || "matchs");
}

// ---- Statistiques : persos les plus pick / bannis et records par boss
// (cf. GET /api/matches?stats=1) ----
const NB_PERSOS_RESUME = 10;
let statistiques = null; // réponse de l'API pour la saison affichée
let chargementStats = null;
// Saison des statistiques ("" : toutes ; par défaut, la saison en cours) et
// réponses déjà chargées par saison.
let saisonStats = null;
const cacheStats = new Map();
let categorieStats = "tous"; // "tous" | "classe" | "non_classe"
// Matchs comptés : 1v1, en équipe (2v2, 3v3, 4v4) ou Random world boss,
// séparés.
let modeStats = "1v1"; // "1v1" | "equipe" | "world_boss"
const listesDepliees = new Set();

async function ouvrirStatistiques() {
  if (statistiques || chargementStats) return;
  const etat = document.getElementById("etat-stats");
  const saison = saisonStats ?? "";
  const cle = `${saison}|${modeStats}`;
  // Classés / non classés : matchs 1v1 seulement (pas de classé en équipe).
  document.querySelector(".entete-stats .filtre-stats").classList.toggle("cache", modeStats === "equipe");
  if (cacheStats.has(cle)) {
    statistiques = cacheStats.get(cle);
    etat.classList.add("cache");
    afficherStatistiques();
    return;
  }
  etat.textContent = "Chargement…";
  etat.classList.remove("cache");
  document.getElementById("contenu-stats").classList.add("cache");
  document.getElementById("contenu-stats-wb").classList.add("cache");
  const filtreMode = modeStats === "equipe" ? "&equipe=1" : modeStats === "world_boss" ? "&world_boss=1" : "";
  chargementStats = fetch(`/api/matches?stats=1${saison === "" ? "" : `&saison=${encodeURIComponent(saison)}`}${filtreMode}`, { credentials: "include" })
    .then(async reponse => {
      if (!reponse.ok) throw new Error("Impossible de charger les statistiques.");
      const donnees = await reponse.json();
      cacheStats.set(cle, donnees);
      chargementStats = null;
      // Autre saison / mode choisi pendant le chargement : celui-là.
      if (cle !== `${saisonStats ?? ""}|${modeStats}`) return ouvrirStatistiques();
      statistiques = donnees;
      etat.classList.add("cache");
      afficherStatistiques();
    })
    .catch(erreur => {
      console.error(erreur);
      etat.textContent = erreur.message || "Erreur de chargement.";
      chargementStats = null; // réessayé à la prochaine ouverture
    });
}

// Statistiques chargées : 1v1 / en équipe (persos, records) ou Random world
// boss (réussites et échecs des persos).
function afficherStatistiques() {
  const worldBoss = modeStats === "world_boss";
  document.getElementById("contenu-stats").classList.toggle("cache", worldBoss);
  document.getElementById("contenu-stats-wb").classList.toggle("cache", !worldBoss);
  if (worldBoss) {
    afficherStatsWorldBoss();
    return;
  }
  afficherClassementsPersos();
  afficherRecords();
}

// Random world boss : un classement des réussites, un des échecs (nombre,
// puis taux de réussite du perso).
function afficherStatsWorldBoss() {
  const parId = new Map();
  Object.entries(statistiques.persos || {}).forEach(([id, stats]) => {
    const idDraft = personnagesParId.has(id) ? id : groupeParId.get(id);
    if (!personnagesParId.has(idDraft)) return; // perso retiré du catalogue
    const total = parId.get(idDraft) || { reussites: 0, echecs: 0 };
    total.reussites += stats.reussites;
    total.echecs += stats.echecs;
    parId.set(idDraft, total);
  });
  const nbParties = statistiques.parties || 0;
  document.getElementById("note-stats-wb").textContent = nbParties === 0 ? "Aucune partie jouée."
    : `Sur ${nbParties} partie${nbParties > 1 ? "s" : ""} (${statistiques.reussites} réussite${statistiques.reussites > 1 ? "s" : ""}). Taux : part des parties du perso réussies.`;
  const taux = stats => Math.round(stats.reussites / Math.max(stats.reussites + stats.echecs, 1) * 100);
  const nomPerso = id => personnagesParId.get(id).nom;

  document.querySelectorAll("#contenu-stats-wb .classement-persos").forEach(bloc => {
    const cle = bloc.dataset.liste; // "reussites" | "echecs"
    const tries = [...parId.entries()].filter(([, stats]) => stats[cle] > 0).sort((a, b) => b[1][cle] - a[1][cle] ||
      (cle === "reussites" ? taux(b[1]) - taux(a[1]) : taux(a[1]) - taux(b[1])) ||
      nomPerso(a[0]).localeCompare(nomPerso(b[0]), "fr", { sensitivity: "base" }));
    const deplie = listesDepliees.has(`wb_${cle}`);
    const affiches = deplie ? tries : tries.slice(0, NB_PERSOS_RESUME);
    const max = tries[0]?.[1][cle] || 1;
    let rang = 0;
    bloc.querySelector(".liste-classement-persos").innerHTML = affiches.length === 0
      ? `<li class="note-stats">Aucun perso.</li>`
      : affiches.map(([id, stats], i) => {
        if (i === 0 || stats[cle] !== affiches[i - 1][1][cle]) rang = i + 1;
        const nom = appliquerVariante(personnagesParId.get(id), {}).nom;
        return `<li class="ligne-perso-stats">
          <span class="rang-stats">${rang}</span>
          ${htmlPerso(id, {})}
          <span class="nom-perso-stats">${echapperHtml(nom)}</span>
          <span class="valeur-stats" title="${stats.reussites} réussite${stats.reussites > 1 ? "s" : ""}, ${stats.echecs} échec${stats.echecs > 1 ? "s" : ""}">${stats[cle]} · ${taux(stats)} % de réussite</span>
          <span class="jauge-stats"><span style="width: ${stats[cle] / max * 100}%"></span></span>
        </li>`;
      }).join("");
    const voirTout = bloc.querySelector(".voir-tout");
    voirTout.classList.toggle("cache", tries.length <= NB_PERSOS_RESUME);
    voirTout.textContent = deplie ? "Réduire" : `Tout afficher (${tries.length})`;
  });
}

// Catégorie choisie ("tous" : classés et non classés additionnés), comptes
// regroupés par perso de la draft (un seul Voyageur).
function categorieAffichee() {
  const sources = categorieStats === "tous"
    ? Object.values(statistiques.categories)
    : [statistiques.categories[categorieStats]];
  const total = { matchs: 0, matchs_bans: 0, picks: new Map(), bans: new Map(), bans_equilibrage: new Map() };
  sources.forEach(source => {
    total.matchs += source.matchs;
    total.matchs_bans += source.matchs_bans;
    ["picks", "bans", "bans_equilibrage"].forEach(cle => {
      Object.entries(source[cle]).forEach(([id, nb]) => {
        const idDraft = personnagesParId.has(id) ? id : groupeParId.get(id);
        if (!personnagesParId.has(idDraft)) return; // perso retiré du catalogue
        total[cle].set(idDraft, (total[cle].get(idDraft) || 0) + nb);
      });
    });
  });
  return total;
}

function afficherClassementsPersos() {
  document.querySelectorAll(".filtre-stats-bouton").forEach(bouton => {
    bouton.classList.toggle("active", bouton.dataset.categorie === categorieStats);
  });
  const categorie = categorieAffichee();

  document.querySelectorAll("#contenu-stats .classement-persos").forEach(bloc => {
    const cle = bloc.dataset.liste;
    // Pourcentage : part des matchs où le perso a été pick (bans : parmi
    // les matchs dont les bans sont enregistrés).
    const nbMatchs = cle === "picks" ? categorie.matchs : categorie.matchs_bans;
    const tries = [...categorie[cle].entries()].sort((a, b) => b[1] - a[1] ||
      personnagesParId.get(a[0]).nom.localeCompare(personnagesParId.get(b[0]).nom, "fr", { sensitivity: "base" }));
    const deplie = listesDepliees.has(cle);
    const affiches = deplie ? tries : tries.slice(0, NB_PERSOS_RESUME);
    const max = tries[0]?.[1] || 1;

    bloc.querySelector(".note-stats").textContent = nbMatchs === 0 ? "Aucun match compté."
      : `Sur ${nbMatchs} match${nbMatchs > 1 ? "s" : ""}.`;

    // Ex aequo : même rang.
    let rang = 0;
    bloc.querySelector(".liste-classement-persos").innerHTML = affiches.map(([id, nb], i) => {
      if (i === 0 || nb !== affiches[i - 1][1]) rang = i + 1;
      const nom = appliquerVariante(personnagesParId.get(id), {}).nom;
      const pourcentage = Math.round(nb / Math.max(nbMatchs, 1) * 100);
      return `<li class="ligne-perso-stats">
        <span class="rang-stats">${rang}</span>
        ${htmlPerso(id, {})}
        <span class="nom-perso-stats">${echapperHtml(nom)}</span>
        <span class="valeur-stats" title="${nb} match${nb > 1 ? "s" : ""} sur ${nbMatchs}">${nb} · ${pourcentage} %</span>
        <span class="jauge-stats"><span style="width: ${nb / max * 100}%"></span></span>
      </li>`;
    }).join("");

    const voirTout = bloc.querySelector(".voir-tout");
    voirTout.classList.toggle("cache", tries.length <= NB_PERSOS_RESUME);
    voirTout.textContent = deplie ? "Réduire" : `Tout afficher (${tries.length})`;
  });
}

// Carte d'un record : temps, bannière du joueur, son équipe et la date.
function creerRecord(record, titre) {
  const carte = document.createElement("div");
  carte.className = `record-boss${record ? "" : " vide"}`;
  if (!record) {
    carte.innerHTML = `<span class="record-titre">${titre}</span><span class="record-aucun">Aucun record</span>`;
    return carte;
  }
  const joueur = record.joueur;
  const banniere = encodeURI(`../DB/images/${joueur.banniere2}`);
  const equipe = joueur.equipe.map(p => htmlPerso(p.id, joueur.parametres, { element: p.element, infos: p, aleatoire: p.aleatoire })).join("");
  const melee = record.mode_theatre === "12" ? " · Mêlée générale" : "";
  carte.innerHTML = `
    <span class="record-titre">${titre}${melee}</span>
    <div class="match-banniere banniere-joueur cote-gauche" style="--banniere2: url(&quot;${echapperHtml(banniere)}&quot;)">
      ${joueur.avatar ? `<img class="match-avatar photo-joueur" src="${joueur.avatar}" alt="">` : ""}
      <span class="match-nom"></span>
      ${htmlMedailleTheatre(joueur.theatre)}
      <span class="match-temps record-temps">${joueur.temps.affiche}</span>
    </div>
    ${record.membres ? `<p class="record-membres"></p>` : ""}
    <div class="match-persos">${equipe}</div>
    <span class="match-date">${formaterDate(record.date)}${record.adversaire ? ` · contre ${record.membres ? "l'équipe de " : ""}${htmlPseudo(record.adversaire)}` : ""}</span>
  `;
  // Pseudo en texte (pas d'HTML venant des comptes) ; match en équipe :
  // bannière du chef, puis tous les joueurs de l'équipe.
  carte.querySelector(".match-nom").textContent = joueur.nom;
  if (record.membres) carte.querySelector(".record-membres").textContent = record.membres.join(" · ");
  return carte;
}

// Une ligne par boss : record hors classé puis en classé ; boss ayant un
// record d'abord, puis A -> Z.
// Boss regroupés par catégorie (records, filtre des matchs) : boss
// hebdomadaires, légendes locales (une fois par jour ou à l'infini), puis
// les autres types s'il y en a.
const CATEGORIES_BOSS = [
  { cle: "hebdo", titre: "Boss hebdomadaires", bouton: "Boss hebdo", contient: boss => boss.type === "weekly_boss" },
  { cle: "legendes", titre: "Légendes locales", bouton: "Légendes locales", contient: estLegendeLocale },
  { cle: "carnage", titre: "Boss carnage", bouton: "Boss carnage", contient: boss => boss.type === "carnage_boss" },
  // World boss : jamais dans les drafts (onglet Random World Boss seulement).
  { cle: "autres", titre: "Autres boss", contient: boss => !["weekly_boss", "carnage_boss", "world_boss"].includes(boss.type) && !estLegendeLocale(boss) }
];
// Ordre du bouton de catégorie (null = tous les boss).
const CYCLE_CATEGORIES_BOSS = [null, "hebdo", "legendes", "carnage"];

function bossDansCategorie(bossId, cle) {
  const boss = bossParId.get(bossId);
  return !!boss && !!CATEGORIES_BOSS.find(c => c.cle === cle)?.contient(boss);
}

// -> [{ titre, boss: [...] }] (catégories vides retirées), boss de chaque
// catégorie dans l'ordre de trier.
function bossParCategorie(trier) {
  const tous = [...bossParId.values()];
  return CATEGORIES_BOSS
    .map(({ cle, titre, contient }) => ({ cle, titre, boss: tous.filter(contient).sort(trier) }))
    .filter(categorie => categorie.boss.length);
}

const ordreNomBoss = (a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" });

// Par catégorie : boss ayant un record d'abord, puis A -> Z.
function afficherRecords() {
  const parBoss = new Map(statistiques.records.map(r => [r.boss_id, r]));
  const categories = bossParCategorie((a, b) => parBoss.has(b.id) - parBoss.has(a.id) || ordreNomBoss(a, b));
  const elements = categories.flatMap(({ titre, boss: liste }) => {
    const sousTitre = document.createElement("h3");
    sousTitre.className = "sous-titre-section";
    sousTitre.textContent = titre;
    return [sousTitre, ...liste.map(boss => {
      const records = parBoss.get(boss.id) || {};
      const ligne = document.createElement("article");
      ligne.className = "ligne-record";
      ligne.innerHTML = `
        <div class="record-boss-infos">
          ${htmlImagesBoss(boss, `class="match-boss" loading="lazy"`)}
          <span class="match-boss-nom">${echapperHtml(boss.nom)}</span>
        </div>`;
      // En équipe : pas de classé, un seul record par boss.
      if (modeStats === "equipe") {
        ligne.append(creerRecord(records.non_classe, "Meilleure équipe"));
        return ligne;
      }
      ligne.append(creerRecord(records.non_classe, "Non classé"), creerRecord(records.classe, `Classé ${ICONE_TROPHEE}`));
      ligne.querySelector(".record-boss:last-child").classList.add("classe");
      return ligne;
    })];
  });
  document.getElementById("records-boss").replaceChildren(...elements);
}

// Saison des statistiques : saison en cours par défaut, ou toutes.
function initialiserSaisonStats() {
  const select = document.getElementById("saison-stats");
  [...saisons].reverse().forEach((saison, i) => {
    const option = document.createElement("option");
    option.value = String(saison.numero);
    option.textContent = `Saison ${saison.numero}${saison.nom ? ` : ${saison.nom}` : ""}${i === 0 ? " (en cours)" : ""}`;
    select.appendChild(option);
  });
  saisonStats = saisons.length ? String(saisons[saisons.length - 1].numero) : "";
  select.value = saisonStats;
  select.addEventListener("change", () => {
    saisonStats = select.value;
    statistiques = null;
    ouvrirStatistiques();
  });

  document.querySelectorAll(".mode-stats-bouton").forEach(bouton => {
    bouton.addEventListener("click", () => {
      modeStats = bouton.dataset.mode;
      document.querySelectorAll(".mode-stats-bouton").forEach(b => b.classList.toggle("active", b === bouton));
      if (modeStats === "equipe") categorieStats = "tous";
      document.querySelectorAll(".filtre-stats-bouton").forEach(b => b.classList.toggle("active", b.dataset.categorie === categorieStats));
      statistiques = null;
      ouvrirStatistiques();
    });
  });
}

function initialiserStatistiques() {
  initialiserSaisonStats();
  document.querySelectorAll(".filtre-stats-bouton").forEach(bouton => {
    bouton.addEventListener("click", () => {
      categorieStats = bouton.dataset.categorie;
      afficherClassementsPersos();
    });
  });
  document.querySelectorAll("#contenu-stats .classement-persos").forEach(bloc => {
    bloc.querySelector(".voir-tout").addEventListener("click", () => {
      const cle = bloc.dataset.liste;
      if (!listesDepliees.delete(cle)) listesDepliees.add(cle);
      afficherClassementsPersos();
    });
  });
  document.querySelectorAll("#contenu-stats-wb .classement-persos").forEach(bloc => {
    bloc.querySelector(".voir-tout").addEventListener("click", () => {
      const cle = `wb_${bloc.dataset.liste}`;
      if (!listesDepliees.delete(cle)) listesDepliees.add(cle);
      afficherStatsWorldBoss();
    });
  });
}

// ---- Démarrage ----

function initialiserBarre() {
  document.querySelectorAll(".tri-historique").forEach(btn => {
    btn.addEventListener("click", () => {
      cyclerTri(etatTri, btn.dataset.tri);
      afficherMatchsDepuisPage1();
    });
  });

  document.getElementById("recherche").addEventListener("input", afficherMatchsDepuisPage1);

  document.getElementById("matchs-classes").addEventListener("click", () => {
    classesSeulement = !classesSeulement;
    afficherMatchsDepuisPage1();
  });

  const mesMatchs = document.getElementById("mes-matchs");
  mesMatchs.classList.toggle("cache", !moiDiscordId);
  mesMatchs.addEventListener("click", () => {
    mesMatchsSeulement = !mesMatchsSeulement;
    afficherMatchsDepuisPage1();
  });

  document.querySelectorAll(".tri-litiges").forEach(btn => {
    btn.addEventListener("click", () => {
      triLitiges = btn.dataset.tri;
      afficherStatsLitiges();
    });
  });

  // Boss : liste déroulante de tous les boss (A -> Z).
  const selectBoss = document.getElementById("filtre-boss");
  bossParCategorie(ordreNomBoss).forEach(({ cle, titre, boss: liste }) => {
    const groupe = document.createElement("optgroup");
    groupe.label = titre;
    groupe.dataset.categorie = cle;
    liste.forEach(boss => {
      const option = document.createElement("option");
      option.value = boss.id;
      option.textContent = boss.nom;
      groupe.appendChild(option);
    });
    selectBoss.appendChild(groupe);
  });
  selectBoss.addEventListener("change", () => {
    bossFiltre = selectBoss.value;
    selectBoss.classList.toggle("active", !!bossFiltre);
    afficherMatchsDepuisPage1();
  });

  // Saison : plus récente d'abord.
  const selectSaison = document.getElementById("filtre-saison");
  [...saisons].reverse().forEach((saison, i) => {
    const option = document.createElement("option");
    option.value = String(saison.numero);
    option.textContent = `Saison ${saison.numero}${saison.nom ? ` : ${saison.nom}` : ""}${i === 0 ? " (en cours)" : ""}`;
    selectSaison.appendChild(option);
  });
  selectSaison.addEventListener("change", () => {
    saisonFiltre = selectSaison.value;
    selectSaison.classList.toggle("active", saisonFiltre !== "");
    afficherMatchsDepuisPage1();
  });

  // Catégorie de boss : tous -> hebdo -> légendes locales -> carnage -> tous.
  // Un boss choisi dans la liste mais hors de la catégorie est retiré.
  document.getElementById("categorie-boss").addEventListener("click", () => {
    const suivant = (CYCLE_CATEGORIES_BOSS.indexOf(categorieBossFiltre) + 1) % CYCLE_CATEGORIES_BOSS.length;
    categorieBossFiltre = CYCLE_CATEGORIES_BOSS[suivant];
    if (categorieBossFiltre && bossFiltre && !bossDansCategorie(bossFiltre, categorieBossFiltre)) {
      bossFiltre = "";
      selectBoss.value = "";
      selectBoss.classList.remove("active");
    }
    afficherMatchsDepuisPage1();
  });

  document.getElementById("clear-historique").addEventListener("click", () => {
    document.getElementById("recherche").value = "";
    bossFiltre = "";
    categorieBossFiltre = null;
    selectBoss.value = "";
    selectBoss.classList.remove("active");
    viderTris(etatTri);
    mesMatchsSeulement = false;
    classesSeulement = false;
    saisonFiltre = "";
    selectSaison.value = "";
    selectSaison.classList.remove("active");
    afficherMatchsDepuisPage1();
  });
}

async function demarrer() {
  try {
    const [historique, personnages, boss, utilisateur] = await Promise.all([
      chargerHistorique(), chargerPersonnages(), chargerBoss(), chargerSession()
    ]);
    appliquerHistorique(historique);
    personnagesParId = new Map(regrouperPourDraft(personnages).map(p => [p.id, p]));
    groupeParId = new Map(personnages.filter(p => p.groupe).map(p => [p.id, p.groupe]));
    bossParId = new Map(boss.map(b => [b.id, b]));
    moiDiscordId = utilisateur?.id || null;
    // Mini admins : litiges et sanctions comme les administrateurs.
    estAdmin = !!(utilisateur?.admin || utilisateur?.mini_admin);

    initialiserBarre();
    initialiserParPage();
    initialiserStatistiques();
    initialiserFenetreSignalement();
    initialiserOnglets();
    afficherMatchsEnCours();
    afficherEntrainements();
    afficherSignalements();
    afficherLitiges();
    afficherMatchs();
  } catch (erreur) {
    console.error(erreur);
    document.getElementById("etat-historique").textContent = erreur.message || "Erreur de chargement.";
  }
}

demarrer();
