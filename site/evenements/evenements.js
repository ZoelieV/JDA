// Événements : modes de jeu ponctuels ou en test, une namecard chacun (même
// présentation que Créer un match, cf. matchmaking/matchmaking.js).
//
// Chaque événement est toujours visible et jouable par les administrateurs
// et mini admins (pastille "Admin") ; activé dans la page admin, il l'est
// par tout le monde, sans pastille. Random world boss (cf.
// api/_lib/world_boss.js) : config.world_boss_public. Le serveur refuse
// aussi les autres joueurs tant qu'il n'est pas activé.

async function chargerUtilisateur() {
  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });
    return reponse.ok ? (await reponse.json()).user : null;
  } catch (erreur) {
    console.error(erreur);
    return null;
  }
}

// Room Random world boss (matchmaking : lobby en attente rejoint, ou
// nouveau lobby de matchmaking), puis page de son lobby.
async function creerWorldBoss(bouton, matchmaking = false) {
  bouton.disabled = true;
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "world_boss", ...(matchmaking ? { matchmaking: true } : {}) })
    });
    if (reponse.status === 401) {
      alerterSite("Tu dois être connecté avec Discord pour créer une room.");
      return;
    }
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      alerterSite(data.error || "Échec de la création de la room.");
      return;
    }
    window.location.href = `/world-boss?room=${data.room_id}`;
  } catch (erreur) {
    console.error(erreur);
    alerterSite("Erreur lors de la création de la room.");
  } finally {
    bouton.disabled = false;
  }
}

// Event Little Cup : file de matchmaking ou room par lien (sans trophées).
async function creerLittleCup(bouton, matchmaking) {
  bouton.disabled = true;
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: matchmaking ? "matchmaking" : "prive", little_cup: true })
    });
    if (reponse.status === 401) {
      alerterSite("Tu dois être connecté avec Discord pour jouer.");
      return;
    }
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      alerterSite(data.error || "Impossible de lancer le match.");
      return;
    }
    window.location.href = `/match?room=${data.room_id}`;
  } catch (erreur) {
    console.error(erreur);
    alerterSite("Erreur lors de la création du match.");
  } finally {
    bouton.disabled = false;
  }
}

async function afficherLittleCup(config) {
  const cup = config?.little_cup || {};
  document.querySelectorAll(".nom-little-cup").forEach(e => { e.textContent = cup.nom || "Little Cup"; });
  if (cup.namecard) document.querySelector('.carte-match[data-detail="little-cup"] img').src = encodeURI(`/DB/images/${cup.namecard}`);
  document.getElementById("room-little-cup").classList.toggle("cache", !!cup.trophees);
  document.getElementById("regle-trophees-little-cup").classList.toggle("cache", !cup.trophees);
  document.getElementById("classement-little-cup").classList.toggle("cache", !cup.trophees);
  if (!cup.trophees) return;
  const reponse = await fetch("/api/matches?little_cup=1", { credentials: "include" });
  const { classement = [] } = reponse.ok ? await reponse.json() : {};
  document.getElementById("liste-classement-little-cup").innerHTML = classement.length
    ? classement.map(j => `<li><span>${echapperCalendrier(j.nom)}</span><strong>${j.trophees} <img class="icone-texte" src="/DB/images/others/Achievement_Wonders_of_the_World.webp" alt="trophées"></strong></li>`).join("")
    : "<li>Aucun match pour l'instant.</li>";
}

// Visual novel : chapitres et avancement du joueur (cf.
// api/_lib/visual_novel.js). -> visible par ce compte (ou ce visiteur) ?
const MESSAGE_CHAPITRE_VERROUILLE = "Ce chapitre nécessite d'avoir terminé les chapitres précédents.";

const texteJoueursVn = nombre => (nombre > 1 ? `${nombre} joueurs l'ont terminé` : nombre === 1 ? "1 joueur l'a terminé" : "Personne ne l'a encore terminé");

// Réglages qui s'appliquent aux joueurs : les vrais admins passent outre.
function reperesAdminVn(c) {
  if (c.public === undefined) return "";
  const reperes = [];
  if (!c.public) reperes.push("réservé aux admins");
  if (c.sortie && Date.parse(c.sortie) > Date.now()) reperes.push(`sort le ${new Date(c.sortie).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`);
  if (c.verrou_joueurs) reperes.push("verrouillé pour un joueur à ton stade");
  return reperes.length ? `<span class="repere-chapitre-vn">Admin : ${echapperCalendrier(reperes.join(", "))}</span>` : "";
}

async function afficherVisualNovel() {
  const reponse = await fetch("/api/points?vn=1", { credentials: "include" });
  if (!reponse.ok) return false;
  const histoire = await reponse.json();
  if (!histoire.visible) return false;
  document.querySelector("#nom-visual-novel").firstChild.textContent = `${histoire.nom} `;
  document.querySelector('.carte-match[data-detail="visual-novel"] h2').firstChild.textContent = `${histoire.nom} `;
  if (histoire.namecard) document.querySelector('.carte-match[data-detail="visual-novel"] img').src = encodeURI(`/DB/images/${histoire.namecard}`);
  document.querySelectorAll('[data-detail="visual-novel"] .badge-admin, [data-detail="visual-novel"] .regle-admin').forEach(e => e.classList.toggle("cache", histoire.public));
  const etats = { nouveau: "À lire", en_cours: "En cours", terminee: "Terminé", game_over: "Game over" };
  document.getElementById("chapitres-visual-novel").innerHTML = histoire.chapitres.map(c => {
    const contenu = `
      ${c.namecard ? `<img src="${echapperCalendrier(encodeURI(`/DB/images/${c.namecard}`))}" alt="" loading="lazy">` : ""}
      <span class="texte-chapitre-vn">
        <strong>${echapperCalendrier(c.titre)}</strong>
        <span>${c.verrouille ? "Verrouillé" : c.termine ? etats.terminee : etats[c.statut]} · ${c.fins_trouvees}/${c.fins_total} fins</span>
        <span>${texteJoueursVn(c.joueurs)}</span>
        ${reperesAdminVn(c)}
      </span>`;
    return c.verrouille
      ? `<button type="button" class="chapitre-vn chapitre-vn-verrouille" data-verrou>${contenu}</button>`
      : `<a class="chapitre-vn" href="/visual_novel/lecteur?chapitre=${encodeURIComponent(c.id)}">${contenu}</a>`;
  }).join("");
  return true;
}

// Clic sur un chapitre verrouillé : le joueur doit savoir pourquoi.
function brancherChapitresVn() {
  document.getElementById("chapitres-visual-novel").addEventListener("click", event => {
    if (!event.target.closest("[data-verrou]")) return;
    const message = document.getElementById("message-chapitres-vn");
    message.textContent = MESSAGE_CHAPITRE_VERROUILLE;
    message.classList.remove("cache");
  });
}

// Une seule carte ouverte à la fois ; un 2e clic referme ses détails.
function choisirCarte(carte) {
  const dejaOuvert = carte.getAttribute("aria-expanded") === "true";
  document.querySelectorAll(".carte-match").forEach(c => {
    c.setAttribute("aria-expanded", "false");
    c.classList.remove("selectionnee");
  });
  document.querySelectorAll(".detail-match").forEach(d => d.classList.add("cache"));
  if (dejaOuvert) return;
  carte.setAttribute("aria-expanded", "true");
  carte.classList.add("selectionnee");
  const detail = document.querySelector(`.detail-match[data-detail="${carte.dataset.detail}"]`);
  detail.classList.remove("cache");
  detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---- Calendrier (config.calendrier, cf. lireCalendrier dans api/points.js)
// Frise de la saison, sur le modèle du calendrier des versions de Genshin :
// mois en bandeau, jours repères (débuts d'événements, aujourd'hui) en
// pastilles avec leurs traits verticaux, puis chaque événement en barre
// arrondie à sa bannière, du premier au dernier jour, avec ses dates et sa
// description courte, qui dépasse de la barre si elle est trop courte ;
// événement d'un seul jour : pastille ronde à sa bannière, texte à côté. Rangés sur des lignes
// sans se chevaucher (texte compris). Clic : fenêtre de la description
// longue.
// Largeur d'un jour : la place disponible divisée par le nombre de jours,
// JOUR_FRISE_MIN_REM au moins (la frise défile alors en largeur) ; recalculée
// quand la largeur de la zone change (cf. rendreCalendrier).
const JOUR_FRISE_MIN_REM = 0.75;
// Pastille d'un événement court (rem), comme --pastille-frise.
const PASTILLE_FRISE_REM = 2.75;

// "AAAA-MM-JJ" <-> Date à midi UTC (pas de décalage d'heure d'été).
const versDate = jour => new Date(`${jour}T12:00:00Z`);
const versJour = date => date.toISOString().slice(0, 10);
const ecartJours = (a, b) => Math.round((versDate(b) - versDate(a)) / 86400000);

function echapperCalendrier(texte) {
  return String(texte).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// "2026-11-04" -> "04/11"
const dateCourte = jour => `${jour.slice(8)}/${jour.slice(5, 7)}`;
const datesEvenement = e => (e.debut === e.fin ? dateCourte(e.debut) : `${dateCourte(e.debut)} – ${dateCourte(e.fin)}`);

function dateLongue(jour, annee = true) {
  return versDate(jour).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", ...(annee ? { year: "numeric" } : {}), timeZone: "UTC" });
}

// Lignes de la frise : chaque événement sur la 1re ligne libre à partir de
// son début ; il occupe ses jours, ou plus si son texte dépasse de la barre.
// jourRem : largeur d'un jour.
function rangerEvenements(evenements, saison, jourRem) {
  const dernier = ecartJours(saison.debut, saison.fin);
  const finsLignes = [];
  return evenements
    .filter(e => e.fin >= saison.debut && e.debut <= saison.fin)
    .map(e => {
      const debut = Math.max(0, ecartJours(saison.debut, e.debut));
      const fin = Math.min(dernier, ecartJours(saison.debut, e.fin));
      const texte = Math.max([...e.court].length * 0.5, datesEvenement(e).length * 0.42) + 1.75;
      // Pastille pour un seul jour ; sinon barre sur toute sa durée.
      const ponctuel = fin === debut;
      const largeur = Math.ceil((texte + (ponctuel ? PASTILLE_FRISE_REM : 0)) / jourRem);
      // Trop près de la fin de la saison : texte vers la gauche.
      const aGauche = debut + largeur - 1 > dernier;
      const [a, b] = aGauche
        ? [Math.max(0, Math.min(debut, fin - largeur + 1)), fin]
        : [debut, Math.max(fin, debut + largeur - 1)];
      let ligne = finsLignes.findIndex(finLigne => finLigne < a);
      if (ligne === -1) ligne = finsLignes.push(-1) - 1;
      finsLignes[ligne] = b;
      // Pastille : la case couvre aussi son texte.
      return ponctuel
        ? { ...e, colonne: a + 1, duree: b - a + 1, ligne, ponctuel, aGauche }
        : { ...e, colonne: debut + 1, duree: fin - debut + 1, ligne, aGauche, courte: (fin - debut + 1) * jourRem < 16 };
    });
}

let calendrierCourant = null;
let evenementsFrise = [];

// Calendrier chargé : frise dessinée, fenêtre de l'événement cliqué.
function rendreCalendrier(calendrier) {
  if (!calendrier?.saison) return;
  calendrierCourant = calendrier;
  dessinerFrise();
  // Largeur de la zone changée (fenêtre, barre de défilement de la page qui
  // apparaît) : frise redessinée.
  let largeur = null;
  new ResizeObserver(([entree]) => {
    const nouvelle = Math.round(entree.contentRect.width);
    if (nouvelle && nouvelle !== largeur) {
      largeur = nouvelle;
      dessinerFrise();
    }
  }).observe(document.getElementById("calendrier"));

  const fenetre = document.getElementById("fenetre-calendrier");
  const fermer = () => { fenetre.hidden = true; };
  document.getElementById("calendrier").addEventListener("click", event => {
    const id = event.target.closest("[data-evenement]")?.dataset.evenement;
    const e = evenementsFrise.find(x => x.id === id);
    if (!e) return;
    document.getElementById("banniere-fenetre-calendrier").style.backgroundImage = `url("${encodeURI(`/DB/images/${e.banniere}`)}")`;
    document.getElementById("titre-fenetre-calendrier").textContent = e.court;
    document.getElementById("dates-fenetre-calendrier").textContent = e.debut === e.fin
      ? dateLongue(e.debut) : `Du ${dateLongue(e.debut, false)} au ${dateLongue(e.fin)}`;
    document.getElementById("long-fenetre-calendrier").textContent = e.long;
    fenetre.hidden = false;
    fenetre.querySelector(".fermer-fenetre-calendrier").focus();
  });
  fenetre.addEventListener("click", event => {
    if (event.target === fenetre || event.target.closest(".fermer-fenetre-calendrier")) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !fenetre.hidden) fermer();
  });
}

function dessinerFrise() {
  const zone = document.getElementById("calendrier");
  const calendrier = calendrierCourant;
  const saison = calendrier?.saison;
  if (!saison) return;
  const nbJours = ecartJours(saison.debut, saison.fin) + 1;
  // Place disponible (zone cachée : largeur minimale), bordure et marges de
  // la frise déduites.
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const jourRem = Math.max(JOUR_FRISE_MIN_REM, Math.floor((zone.clientWidth / rem - 0.5 - 2 / rem) / nbJours * 1000) / 1000);
  const jourDe = index => { const d = versDate(saison.debut); d.setUTCDate(d.getUTCDate() + index); return versJour(d); };
  const aujourdhui = versJour(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));
  const indexAujourdhui = aujourdhui >= saison.debut && aujourdhui <= saison.fin ? ecartJours(saison.debut, aujourdhui) : -1;
  const evenements = evenementsFrise = rangerEvenements(calendrier.evenements || [], saison, jourRem);
  const nbLignes = Math.max(1, ...evenements.map(e => e.ligne + 1));
  document.getElementById("intro-calendrier").textContent =
    `Saison du ${dateLongue(saison.debut, false)} au ${dateLongue(saison.fin)}. Clique sur un événement pour voir le détail.`;

  // Mois : bandeaux sur leurs jours.
  const mois = [];
  for (let i = 0; i < nbJours; i++) {
    const cle = jourDe(i).slice(0, 7);
    if (mois.at(-1)?.cle !== cle) mois.push({ cle, debut: i, duree: 0 });
    mois.at(-1).duree++;
  }
  // Repères : début de saison, débuts d'événements, aujourd'hui ; un repère
  // trop près du précédent (pastilles qui se toucheraient) est sauté, sauf
  // aujourd'hui.
  const candidats = [...new Set([0, ...evenements.map(e => e.colonne - 1), ...(indexAujourdhui >= 0 ? [indexAujourdhui] : [])])].sort((a, b) => a - b);
  const reperes = [];
  candidats.forEach(index => {
    const precedent = reperes.at(-1);
    if (precedent !== undefined && (index - precedent) * jourRem < 1.75) {
      if (index !== indexAujourdhui) return;
      if (precedent !== indexAujourdhui) reperes.pop();
    }
    reperes.push(index);
  });

  zone.innerHTML = `
    <div class="frise" style="--jours: ${nbJours}; --lignes: ${nbLignes}; --jour-frise: ${jourRem}rem">
      ${mois.map(m => `<div class="mois-frise" style="grid-column: ${m.debut + 1} / span ${m.duree}"><span>${versDate(`${m.cle}-01`).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" })}</span></div>`).join("")}
      ${reperes.map(index => `<span class="repere-frise${index === indexAujourdhui ? " aujourdhui" : ""}" style="grid-column: ${index + 1}" title="${index === indexAujourdhui ? "Aujourd'hui, " : ""}${dateLongue(jourDe(index))}">${Number(jourDe(index).slice(8))}</span>`).join("")}
      ${reperes.map(index => `<span class="trait-frise${index === indexAujourdhui ? " aujourdhui" : ""}" style="grid-column: ${index + 1}"></span>`).join("")}
      ${Array.from({ length: nbLignes }, (_, ligne) => `<span class="ligne-frise" style="grid-row: ${ligne + 3}"></span>`).join("")}
      ${evenements.map(e => `
        <button type="button" class="evenement-frise${e.ponctuel ? " ponctuel" : ""}${e.aGauche ? " a-gauche" : ""}${e.courte ? " courte" : ""}" data-evenement="${echapperCalendrier(e.id)}"
          style="grid-column: ${e.colonne} / span ${e.duree}; grid-row: ${e.ligne + 3}; --banniere: url(&quot;${echapperCalendrier(encodeURI(`/DB/images/${e.banniere}`))}&quot;)">
          ${e.ponctuel ? `<span class="pastille-evenement-frise"></span>` : ""}
          <span class="texte-evenement-frise">
            <span class="dates-evenement-frise">${datesEvenement(e)}</span>
            <span class="nom-evenement-frise">${echapperCalendrier(e.court)}</span>
          </span>
        </button>`).join("")}
      ${evenements.length ? "" : `<p class="vide-frise">Aucun événement pour l'instant.</p>`}
    </div>`;

  // Aujourd'hui visible dès l'ouverture (frise plus large que l'écran).
  const frise = zone.querySelector(".frise");
  if (indexAujourdhui > 0) {
    requestAnimationFrame(() => {
      const repere = frise.querySelector(".repere-frise.aujourdhui");
      if (repere) zone.scrollLeft = Math.max(0, repere.offsetLeft - zone.clientWidth / 3);
    });
  }

}

// ---- Avertissement du calendrier : fenêtre à l'ouverture de la page à la
// première visite et après chaque modification du calendrier
// (config.calendrier.modifie_le, cf. api/points.js) ; date vue gardée dans
// ce navigateur (pastille des liens Événements, cf. commun/compte.js).
const CLE_CALENDRIER_VU = "calendrier-vu";
const AVERTISSEMENT_CALENDRIER = "Les événements prévus après décembre peuvent encore changer, et de nouveaux événements peuvent être ajoutés. Tu es prévenu sur le site à chaque mise à jour du calendrier.";

async function prevenirCalendrier(calendrier) {
  if (!calendrier?.saison) return;
  const maj = calendrier.modifie_le || "";
  let vu = null;
  try { vu = localStorage.getItem(CLE_CALENDRIER_VU); } catch { /* stockage bloqué */ }
  if (vu && (!maj || vu >= maj)) return;
  try { localStorage.setItem(CLE_CALENDRIER_VU, maj || new Date().toISOString()); } catch { /* stockage bloqué */ }
  const date = maj ? new Date(maj).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  await alerterSite(`${vu && date ? `Le calendrier a été mis à jour le ${date}.\n\n` : ""}${AVERTISSEMENT_CALENDRIER}`, "Calendrier des événements");
}

async function demarrer() {
  const etat = document.getElementById("etat-evenements");
  const [utilisateur, config, visualNovelVisible] = await Promise.all([
    chargerUtilisateur(),
    chargerPointsAdmin().catch(erreur => { console.error(erreur); return {}; }),
    afficherVisualNovel().catch(erreur => { console.error(erreur); return false; })
  ]);
  const admin = !!(utilisateur?.admin || utilisateur?.mini_admin);
  // { data-detail : activé pour tous } ; calendrier : dès que la saison a
  // ses dates.
  const evenements = { "world-boss": config?.world_boss_public === true, "little-cup": config?.little_cup?.public === true, calendrier: !!config?.calendrier?.saison };
  if (admin || evenements["little-cup"]) afficherLittleCup(config).catch(console.error);
  rendreCalendrier(config?.calendrier);

  for (const [nom, public_] of Object.entries(evenements)) {
    document.querySelector(`.carte-match[data-detail="${nom}"]`).classList.toggle("cache", !public_ && !admin);
    document.querySelectorAll(`[data-detail="${nom}"] .badge-admin, [data-detail="${nom}"] .regle-admin`).forEach(e => e.classList.toggle("cache", public_));
  }

  document.querySelector('.carte-match[data-detail="visual-novel"]').classList.toggle("cache", !visualNovelVisible);
  brancherChapitresVn();

  const visibles = document.querySelectorAll(".carte-match:not(.cache)").length;
  etat.textContent = visibles ? "" : "Contenu à venir...";
  etat.classList.toggle("cache", visibles > 0);

  document.querySelectorAll(".carte-match").forEach(carte => {
    carte.addEventListener("click", () => choisirCarte(carte));
  });
  document.getElementById("creer-world-boss").addEventListener("click", event => creerWorldBoss(event.currentTarget));
  document.getElementById("mm-little-cup").addEventListener("click", event => creerLittleCup(event.currentTarget, true));
  document.getElementById("room-little-cup").addEventListener("click", event => creerLittleCup(event.currentTarget, false));
  document.getElementById("mm-world-boss").addEventListener("click", event => creerWorldBoss(event.currentTarget, true));

  // evenements.html#world-boss : détails ouverts.
  const ancre = location.hash && document.querySelector(`.carte-match:not(.cache)[data-detail="${CSS.escape(location.hash.slice(1))}"]`);
  if (ancre) choisirCarte(ancre);

  // Calendrier visible (saison ouverte, ou administrateur) : avertissement.
  document.documentElement.classList.remove("calendrier-nouveau");
  if (evenements.calendrier || admin) prevenirCalendrier(config?.calendrier);
}

demarrer();
