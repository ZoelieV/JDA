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
      alert("Tu dois être connecté avec Discord pour créer une room.");
      return;
    }
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) {
      alert(data.error || "Échec de la création de la room.");
      return;
    }
    window.location.href = `/world-boss?room=${data.room_id}`;
  } catch (erreur) {
    console.error(erreur);
    alert("Erreur lors de la création de la room.");
  } finally {
    bouton.disabled = false;
  }
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
// Un mois par bloc (semaines du lundi au dimanche), jours de la saison
// seulement ; chaque jour d'un événement prend sa couleur et sa description
// courte ; clic : fenêtre des descriptions longues du jour.
const NOMS_JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

// "AAAA-MM-JJ" <-> Date à midi UTC (pas de décalage d'heure d'été).
const versDate = jour => new Date(`${jour}T12:00:00Z`);
const versJour = date => date.toISOString().slice(0, 10);

function echapperCalendrier(texte) {
  return String(texte).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function dateLongue(jour, annee = true) {
  return versDate(jour).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", ...(annee ? { year: "numeric" } : {}), timeZone: "UTC" });
}

function rendreCalendrier(calendrier) {
  const zone = document.getElementById("calendrier");
  const saison = calendrier?.saison;
  if (!saison) return;
  const evenements = calendrier.evenements || [];
  const duJour = jour => evenements.filter(e => e.debut <= jour && jour <= e.fin);
  const aujourdhui = versJour(new Date(Date.now() - new Date().getTimezoneOffset() * 60000));

  const mois = [];
  for (let date = versDate(saison.debut); versJour(date) <= saison.fin; date.setUTCDate(date.getUTCDate() + 1)) {
    const cle = versJour(date).slice(0, 7);
    if (mois.at(-1)?.cle !== cle) mois.push({ cle, jours: [] });
    mois.at(-1).jours.push(versJour(date));
  }

  zone.innerHTML = mois.map(({ cle, jours }) => {
    const titre = versDate(`${cle}-01`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
    // Cases vides avant le 1er jour affiché (lundi = 0).
    const decalage = (versDate(jours[0]).getUTCDay() + 6) % 7;
    const cases = jours.map(jour => {
      const liste = duJour(jour);
      const classes = ["jour-calendrier", liste.length ? "avec-evenement" : "", jour === aujourdhui ? "aujourdhui" : "", jour < aujourdhui ? "passe" : ""].filter(Boolean).join(" ");
      const etiquettes = liste.map(e => `<span class="etiquette-calendrier" style="--couleur: ${echapperCalendrier(e.couleur)}">${echapperCalendrier(e.court)}</span>`).join("");
      const attributs = liste.length
        ? ` type="button" data-jour="${jour}" style="--couleur: ${echapperCalendrier(liste[0].couleur)}" title="${echapperCalendrier(liste.map(e => e.court).join(" · "))}"`
        : "";
      const balise = liste.length ? "button" : "div";
      return `<${balise} class="${classes}"${attributs}><span class="numero-jour">${Number(jour.slice(8))}</span>${etiquettes}</${balise}>`;
    }).join("");
    return `
      <div class="mois-calendrier">
        <h3>${titre}</h3>
        <div class="grille-calendrier">
          ${NOMS_JOURS.map(nom => `<span class="nom-jour">${nom}</span>`).join("")}
          ${'<span class="jour-vide"></span>'.repeat(decalage)}
          ${cases}
        </div>
      </div>`;
  }).join("");

  const fenetre = document.getElementById("fenetre-jour");
  const fermer = () => { fenetre.hidden = true; };
  zone.addEventListener("click", event => {
    const jour = event.target.closest("[data-jour]")?.dataset.jour;
    if (!jour) return;
    document.getElementById("titre-fenetre-jour").textContent = dateLongue(jour);
    document.getElementById("corps-fenetre-jour").innerHTML = duJour(jour).map(e => `
      <article class="evenement-jour" style="--couleur: ${echapperCalendrier(e.couleur)}">
        <h3>${echapperCalendrier(e.court)}</h3>
        ${e.debut !== e.fin ? `<p class="dates-evenement">Du ${dateLongue(e.debut, false)} au ${dateLongue(e.fin)}</p>` : ""}
        <p class="long-evenement">${echapperCalendrier(e.long)}</p>
      </article>`).join("");
    fenetre.hidden = false;
    fenetre.querySelector(".fermer-fenetre-jour").focus();
  });
  fenetre.addEventListener("click", event => {
    if (event.target === fenetre || event.target.closest(".fermer-fenetre-jour")) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !fenetre.hidden) fermer();
  });
}

async function demarrer() {
  const etat = document.getElementById("etat-evenements");
  const [utilisateur, config] = await Promise.all([
    chargerUtilisateur(),
    chargerPointsAdmin().catch(erreur => { console.error(erreur); return {}; })
  ]);
  const admin = !!(utilisateur?.admin || utilisateur?.mini_admin);
  // { data-detail : activé pour tous } ; calendrier : dès que la saison a
  // ses dates.
  const evenements = { "world-boss": config?.world_boss_public === true, calendrier: !!config?.calendrier?.saison };
  rendreCalendrier(config?.calendrier);

  for (const [nom, public_] of Object.entries(evenements)) {
    document.querySelector(`.carte-match[data-detail="${nom}"]`).classList.toggle("cache", !public_ && !admin);
    document.querySelectorAll(`[data-detail="${nom}"] .badge-admin, [data-detail="${nom}"] .regle-admin`).forEach(e => e.classList.toggle("cache", public_));
  }

  const visibles = document.querySelectorAll(".carte-match:not(.cache)").length;
  etat.textContent = visibles ? "" : "Contenu à venir...";
  etat.classList.toggle("cache", visibles > 0);

  document.querySelectorAll(".carte-match").forEach(carte => {
    carte.addEventListener("click", () => choisirCarte(carte));
  });
  document.getElementById("creer-world-boss").addEventListener("click", event => creerWorldBoss(event.currentTarget));
  document.getElementById("mm-world-boss").addEventListener("click", event => creerWorldBoss(event.currentTarget, true));

  // evenements.html#world-boss : détails ouverts.
  const ancre = location.hash && document.querySelector(`.carte-match:not(.cache)[data-detail="${CSS.escape(location.hash.slice(1))}"]`);
  if (ancre) choisirCarte(ancre);
}

demarrer();
