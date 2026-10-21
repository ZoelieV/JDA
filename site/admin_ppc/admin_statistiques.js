// Administration : statistiques du site (bouton Statistiques ; données :
// GET /api/points?stats_site=1, cf. api/_lib/statistiques.js) : chiffres
// clés, inscrits, nouvelles inscriptions, joueurs connectés et matchs par
// journée du site (reset à 4 h), sources des inscriptions (liens de pub
// ?src=...). Lecture seule (administrateurs et mini admins).

let statistiquesSite = null;
let periodeStatistiques = 30;
const PERIODES_STATISTIQUES = [7, 30, 90];

const FORMAT_JOUR_STATS = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const libelleJour = jour => FORMAT_JOUR_STATS.format(new Date(`${jour}T00:00:00Z`));

// Graphique d'une série par journée : barres (quantités du jour) ou ligne
// (total cumulé). Une seule couleur (une seule série : le titre la nomme),
// grille et axes discrets, infobulle au survol.
function htmlGraphiqueStats(titre, jours, cle, forme = "barres") {
  // Repère proche de la taille affichée (texte lisible sans grossir).
  const L = 460, H = 170, G = 32, D = 6, HAUT = 10, BAS = 22;
  const valeurs = jours.map(j => j[cle]);
  const max = Math.max(1, ...valeurs);
  // Graduations entières (0, moitié, max arrondi).
  const pas = Math.max(1, Math.ceil(max / 4));
  const sommet = pas * Math.ceil(max / pas);
  const largeurUtile = L - G - D;
  const pasX = largeurUtile / jours.length;
  const y = v => HAUT + (H - HAUT - BAS) * (1 - v / sommet);
  const graduations = [];
  for (let v = 0; v <= sommet; v += pas) graduations.push(v);

  const marques = forme === "barres"
    ? jours.map((j, i) => {
      const hauteur = (H - BAS) - y(j[cle]);
      const largeur = Math.max(1, pasX - 2);
      return j[cle] > 0
        ? `<rect x="${(G + i * pasX + 1).toFixed(1)}" y="${y(j[cle]).toFixed(1)}" width="${largeur.toFixed(1)}" height="${Math.max(0, hauteur).toFixed(1)}" rx="${Math.min(2, largeur / 2).toFixed(1)}" class="marque-stats"/>`
        : "";
    }).join("")
    : `<polyline class="ligne-stats" points="${jours.map((j, i) => `${(G + (i + 0.5) * pasX).toFixed(1)},${y(j[cle]).toFixed(1)}`).join(" ")}"/>`;

  // Une étiquette d'axe X toutes les ~6 colonnes.
  const tousLes = Math.max(1, Math.ceil(jours.length / 5));
  // Première date calée à gauche, dernière à droite (pas coupées), sans
  // étiquette trop proche de la dernière.
  const dernier = jours.length - 1;
  const etiquettes = jours.map((j, i) => {
    const garder = i === dernier || (i % tousLes === 0 && dernier - i >= tousLes / 2);
    if (!garder) return "";
    const [x, ancre] = i === 0 ? [G, "start"] : i === dernier ? [L - D, "end"] : [G + (i + 0.5) * pasX, "middle"];
    return `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="${ancre}" class="axe-stats">${libelleJour(j.jour)}</text>`;
  }).join("");

  return `
    <figure class="graphique-stats" data-cle="${cle}">
      <figcaption>${titre}</figcaption>
      <svg viewBox="0 0 ${L} ${H}" role="img" aria-label="${titre}">
        ${graduations.map(v => `<line x1="${G}" x2="${L - D}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grille-stats"/><text x="${G - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="axe-stats">${v}</text>`).join("")}
        ${marques}
        ${etiquettes}
        <line class="repere-stats" x1="0" x2="0" y1="${HAUT}" y2="${H - BAS}" visibility="hidden"/>
        <rect class="zone-survol-stats" x="${G}" y="0" width="${largeurUtile}" height="${H - BAS}" fill="transparent"/>
      </svg>
      <div class="bulle-stats cache"></div>
    </figure>`;
}

function rendreStatistiques() {
  const zone = document.getElementById("contenu-statistiques");
  const s = statistiquesSite;
  if (!s) return;
  if (s.erreur) {
    zone.innerHTML = `<p class="message-ajout erreur">${echapperHtml(s.erreur)}</p>`;
    return;
  }
  const jours = s.jours.slice(-periodeStatistiques);
  const t = s.totaux;
  const tuile = (valeur, libelle, detail = "") =>
    `<div class="tuile-stats"><span class="valeur-tuile-stats">${valeur}</span><span class="libelle-tuile-stats">${libelle}</span>${detail ? `<span class="detail-tuile-stats">${detail}</span>` : ""}</div>`;
  const somme = cle => jours.reduce((total, j) => total + j[cle], 0);

  zone.innerHTML = `
    <div class="periodes-stats">
      ${PERIODES_STATISTIQUES.map(n => `<button type="button" class="mode-modificateur${n === periodeStatistiques ? " active" : ""}" data-periode="${n}">${n} jours</button>`).join("")}
      <span class="details-boss">Journées du site (reset à 4 h). Mis à jour le ${new Date(s.genere_le).toLocaleString("fr-FR")}.</span>
    </div>
    <div class="tuiles-stats">
      ${tuile(t.inscrits, "inscrits", `+${t.nouveaux_aujourdhui} aujourd'hui · +${t.nouveaux_7j} en 7 jours`)}
      ${tuile(t.connectes_aujourdhui, "connectés aujourd'hui")}
      ${tuile(t.actifs_7j, "joueurs actifs (7 j)", `${t.actifs_30j} sur 30 jours`)}
      ${tuile(t.matchs_7j, "matchs (7 j)", `+ ${t.world_boss_7j} Random world boss`)}
    </div>
    <div class="grille-graphiques-stats">
      ${htmlGraphiqueStats("Inscrits (total)", jours, "inscrits", "ligne")}
      ${htmlGraphiqueStats(`Nouvelles inscriptions par jour (${somme("inscriptions")} sur la période)`, jours, "inscriptions")}
      ${htmlGraphiqueStats(`Joueurs connectés par jour`, jours, "connexions")}
      ${htmlGraphiqueStats(`Matchs par jour (${somme("matchs")} sur la période, hors entraînement)`, jours, "matchs")}
    </div>
    <h3 class="titre-section-ajout">Sources des inscriptions</h3>
    <p class="aide-apercu">Lien de pub : ajoute <strong>?src=nom</strong> à l'adresse du site (ex. <code>${echapperHtml(location.origin)}/?src=tiktok</code>) ; sans ce paramètre, c'est le site d'où vient le visiteur. Retenue 30 jours, comptée à la création du compte. « (inconnue) » : accès direct ou inscrit avant le suivi.</p>
    <table class="tableau-boss tableau-sources-stats">
      <thead><tr><th class="col-nom">Source</th><th>Inscrits</th><th>Dont 7 derniers jours</th></tr></thead>
      <tbody>${s.sources.map(src => `<tr><td class="col-nom">${echapperHtml(src.source)}</td><td>${src.total}</td><td>${src.sept_jours}</td></tr>`).join("")}</tbody>
    </table>
    <details class="table-stats">
      <summary>Voir les chiffres jour par jour</summary>
      <table class="tableau-boss">
        <thead><tr><th class="col-nom">Jour</th><th>Inscrits</th><th>Nouveaux</th><th>Connectés</th><th>Matchs</th><th>World boss</th></tr></thead>
        <tbody>${[...jours].reverse().map(j => `<tr><td class="col-nom">${libelleJour(j.jour)}</td><td>${j.inscrits}</td><td>${j.inscriptions}</td><td>${j.connexions}</td><td>${j.matchs}</td><td>${j.world_boss}</td></tr>`).join("")}</tbody>
      </table>
    </details>`;

  // Survol : repère vertical et bulle avec le jour et la valeur.
  zone.querySelectorAll(".graphique-stats").forEach(figure => {
    const svg = figure.querySelector("svg");
    const zoneSurvol = svg.querySelector(".zone-survol-stats");
    const repere = svg.querySelector(".repere-stats");
    const bulle = figure.querySelector(".bulle-stats");
    const cle = figure.dataset.cle;
    const x0 = Number(zoneSurvol.getAttribute("x"));
    const largeur = Number(zoneSurvol.getAttribute("width"));
    zoneSurvol.addEventListener("mousemove", event => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const local = point.matrixTransform(svg.getScreenCTM().inverse());
      const i = Math.min(jours.length - 1, Math.max(0, Math.floor((local.x - x0) / (largeur / jours.length))));
      const cx = x0 + (i + 0.5) * (largeur / jours.length);
      repere.setAttribute("x1", cx);
      repere.setAttribute("x2", cx);
      repere.setAttribute("visibility", "visible");
      bulle.textContent = `${libelleJour(jours[i].jour)} : ${jours[i][cle]}`;
      bulle.classList.remove("cache");
      const boite = figure.getBoundingClientRect();
      bulle.style.left = `${Math.min(boite.width - bulle.offsetWidth, Math.max(0, event.clientX - boite.left + 12))}px`;
      bulle.style.top = `${event.clientY - boite.top - 30}px`;
    });
    zoneSurvol.addEventListener("mouseleave", () => {
      repere.setAttribute("visibility", "hidden");
      bulle.classList.add("cache");
    });
  });
}

async function chargerStatistiques() {
  const zone = document.getElementById("contenu-statistiques");
  zone.innerHTML = `<p class="details-boss">Chargement…</p>`;
  try {
    const reponse = await fetch("/api/points?stats_site=1", { credentials: "include", cache: "no-store" });
    const donnees = await reponse.json().catch(() => ({}));
    statistiquesSite = reponse.ok ? donnees : { erreur: donnees.error || "Statistiques indisponibles." };
  } catch (erreur) {
    console.error(erreur);
    statistiquesSite = { erreur: "Statistiques indisponibles (connexion)." };
  }
  rendreStatistiques();
}

function initialiserStatistiques() {
  const modal = document.getElementById("modal-statistiques");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-statistiques").addEventListener("click", () => {
    modal.classList.add("active");
    chargerStatistiques();
  });
  document.getElementById("fermer-statistiques").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("contenu-statistiques").addEventListener("click", event => {
    const bouton = event.target.closest("[data-periode]");
    if (!bouton) return;
    periodeStatistiques = Number(bouton.dataset.periode);
    rendreStatistiques();
  });
}

initialiserStatistiques();
