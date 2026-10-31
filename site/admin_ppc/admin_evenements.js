// Événements : modes de la page Événements (evenements.html), toujours
// visibles par les administrateurs, activés pour tout le monde ou non.
// Random world boss (config.world_boss_public, cf.
// api/_lib/world_boss.js) : enregistré dès le clic. Mini admins : lecture
// seule (case verrouillée, cf. ZONES_MODIFIABLES, admin_ppc.js).
// Utilise envoyerAjout (admin_ajout.js).

function initialiserEvenements() {
  const modal = document.getElementById("modal-evenements");
  const caseWorldBoss = document.getElementById("world-boss-actif");
  const message = document.getElementById("message-world-boss");
  const fermer = () => modal.classList.remove("active");

  chargerPointsAdmin().then(config => { caseWorldBoss.checked = config?.world_boss_public === true; });
  document.getElementById("ouvrir-evenements").addEventListener("click", () => modal.classList.add("active"));
  document.getElementById("fermer-evenements").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  caseWorldBoss.addEventListener("change", async () => {
    const actif = caseWorldBoss.checked;
    caseWorldBoss.disabled = true;
    message.className = "message-ajout";
    message.textContent = "Enregistrement…";
    try {
      await envoyerAjout({ world_boss_public: actif });
      message.textContent = actif ? "Random world boss ouvert à tous." : "Random world boss réservé aux administrateurs.";
      message.classList.add("succes");
    } catch (erreur) {
      console.error(erreur);
      caseWorldBoss.checked = !actif;
      message.textContent = erreur.message;
      message.classList.add("erreur");
    } finally {
      caseWorldBoss.disabled = false;
    }
  });
}

// ---- Calendrier de la page Événements (config.calendrier, cf.
// lireCalendrier dans api/points.js) ----
// D'abord les dates de la saison de JDA (jours de la frise), puis les
// événements : un ou plusieurs jours (choisis sur le sélecteur de jours de
// la saison ou écrits), bannière, description courte (sur la frise, 20
// caractères au plus) et longue (fenêtre de l'événement). Chaque
// modification envoie tout le calendrier.
const COURT_CALENDRIER_MAX = 30;
const BANNIERE_CALENDRIER_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";
const NOMS_JOURS_ADMIN = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

function initialiserCalendrierAdmin() {
  const $c = id => document.getElementById(id);
  let calendrier = null; // { saison: { debut, fin }, evenements: [...] }
  let modifie = null; // id de l'événement en cours de modification
  let banniere = BANNIERE_CALENDRIER_DEFAUT;

  const message = (id, texte, type = "") => {
    $c(id).className = `message-ajout ${type}`;
    $c(id).textContent = texte;
  };
  // "AAAA-MM-JJ" <-> Date à midi UTC (pas de décalage d'heure d'été).
  const versDate = jour => new Date(`${jour}T12:00:00Z`);
  const versJour = date => date.toISOString().slice(0, 10);
  const dateLisible = jour => versDate(jour).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const echapper = texte => String(texte).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const urlBanniere = chemin => encodeURI(`/DB/images/${chemin}`);

  async function enregistrer(nouveau, idMessage, succes) {
    message(idMessage, "Enregistrement…");
    try {
      const config = await envoyerAjout({ calendrier: nouveau });
      calendrier = config.calendrier;
      message(idMessage, succes, "succes");
      rendre();
      return true;
    } catch (erreur) {
      console.error(erreur);
      message(idMessage, erreur.message, "erreur");
      return false;
    }
  }

  function majBanniere() {
    $c("calendrier-banniere").style.backgroundImage = `url("${urlBanniere(banniere)}")`;
    $c("calendrier-banniere").title = banniere.split("/").pop().replace(/^Namecard_Banner_|\.webp$/g, "").replace(/_/g, " ");
  }

  function viderFormulaire() {
    modifie = null;
    ["calendrier-debut", "calendrier-fin", "calendrier-court", "calendrier-long"].forEach(id => { $c(id).value = ""; });
    banniere = BANNIERE_CALENDRIER_DEFAUT;
    $c("calendrier-titre-formulaire").textContent = "Ajouter un événement";
    $c("calendrier-valider").textContent = "Ajouter l'événement";
    $c("calendrier-annuler").hidden = true;
    majCompteur();
    majBanniere();
    rendreSelecteur();
  }

  function majCompteur() {
    $c("calendrier-compteur").textContent = `${[...$c("calendrier-court").value].length} / ${COURT_CALENDRIER_MAX}`;
  }

  // Sélecteur de jours : un mois par bloc, jours de la saison cliquables ;
  // période choisie surlignée, jours qui ont déjà un événement pointés.
  function rendreSelecteur() {
    const zone = $c("calendrier-selecteur");
    const saison = calendrier?.saison;
    if (!saison) {
      zone.innerHTML = "";
      return;
    }
    const debut = $c("calendrier-debut").value;
    const fin = $c("calendrier-fin").value || debut;
    const occupes = new Set();
    (calendrier.evenements || []).filter(e => e.id !== modifie).forEach(e => {
      for (let d = versDate(e.debut); versJour(d) <= e.fin; d.setUTCDate(d.getUTCDate() + 1)) occupes.add(versJour(d));
    });
    const mois = [];
    for (let d = versDate(saison.debut); versJour(d) <= saison.fin; d.setUTCDate(d.getUTCDate() + 1)) {
      const jour = versJour(d);
      if (mois.at(-1)?.cle !== jour.slice(0, 7)) mois.push({ cle: jour.slice(0, 7), jours: [] });
      mois.at(-1).jours.push(jour);
    }
    zone.innerHTML = mois.map(({ cle, jours }) => `
      <div class="mois-selecteur">
        <h4>${versDate(`${cle}-01`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })}</h4>
        <div class="grille-selecteur">
          ${NOMS_JOURS_ADMIN.map(nom => `<span class="nom-jour-selecteur">${nom}</span>`).join("")}
          ${"<span></span>".repeat((versDate(jours[0]).getUTCDay() + 6) % 7)}
          ${jours.map(jour => {
            const classes = ["jour-selecteur",
              debut && jour >= debut && jour <= fin ? "choisi" : "",
              jour === debut || jour === fin ? "borne" : "",
              occupes.has(jour) ? "occupe" : ""].filter(Boolean).join(" ");
            return `<button type="button" class="${classes} action-calendrier" data-jour="${jour}">${Number(jour.slice(8))}</button>`;
          }).join("")}
        </div>
      </div>`).join("");
  }

  function rendre() {
    const saison = calendrier?.saison;
    $c("calendrier-saison-debut").value = saison?.debut || "";
    $c("calendrier-saison-fin").value = saison?.fin || "";
    // Bornes des dates d'événements : la saison.
    ["calendrier-debut", "calendrier-fin"].forEach(id => {
      $c(id).min = saison?.debut || "";
      $c(id).max = saison?.fin || "";
    });
    const evenements = calendrier?.evenements || [];
    $c("calendrier-liste").innerHTML = !saison
      ? `<li class="doux">Choisis d'abord les dates de la saison.</li>`
      : evenements.length ? evenements.map(e => `
        <li>
          <span class="apercu-banniere-calendrier petit" style="background-image: url(&quot;${echapper(urlBanniere(e.banniere))}&quot;)"></span>
          <span class="dates-calendrier-admin">${dateLisible(e.debut)}${e.fin !== e.debut ? ` → ${dateLisible(e.fin)}` : ""}</span>
          <strong>${echapper(e.court)}</strong>
          <span class="long-calendrier-admin doux" title="${echapper(e.long)}">${echapper(e.long)}</span>
          <button type="button" class="bouton-creer secondaire action-calendrier" data-modifier="${e.id}">Modifier</button>
          <button type="button" class="bouton-creer secondaire action-calendrier" data-supprimer="${e.id}">Supprimer</button>
        </li>`).join("") : `<li class="doux">Aucun événement.</li>`;
    rendreSelecteur();
  }

  chargerPointsAdmin().then(config => {
    calendrier = config?.calendrier || null;
    rendre();
  });
  majBanniere();

  $c("calendrier-court").addEventListener("input", majCompteur);
  ["calendrier-debut", "calendrier-fin"].forEach(id => $c(id).addEventListener("change", rendreSelecteur));

  // 1er clic : début (et fin le même jour) ; 2e clic à partir du début :
  // fin ; clic avant le début, ou une fois la période choisie : nouveau début.
  let attenteFin = false;
  $c("calendrier-selecteur").addEventListener("click", event => {
    const jour = event.target.closest("[data-jour]")?.dataset.jour;
    if (!jour) return;
    const debut = $c("calendrier-debut").value;
    if (attenteFin && debut && jour >= debut) {
      $c("calendrier-fin").value = jour;
      attenteFin = false;
    } else {
      $c("calendrier-debut").value = jour;
      $c("calendrier-fin").value = jour;
      attenteFin = true;
    }
    rendreSelecteur();
  });

  $c("calendrier-choisir-banniere").addEventListener("click", async () => {
    const choix = await choisirCosmetiques({ titre: "Bannière de l'événement", multiple: false, selection: [`banniere2:${banniere}`], onglets: ["banniere2"] });
    if (!choix?.length) return;
    banniere = choix[0].replace(/^banniere2:/, "");
    majBanniere();
  });

  $c("calendrier-enregistrer-saison").addEventListener("click", () => {
    const debut = $c("calendrier-saison-debut").value;
    const fin = $c("calendrier-saison-fin").value;
    if (!debut || !fin || fin < debut) return message("message-calendrier-saison", "Choisis un début et une fin (le jour du début ou après).", "erreur");
    enregistrer({ saison: { debut, fin }, evenements: calendrier?.evenements || [] }, "message-calendrier-saison", "Dates de la saison enregistrées.");
  });

  $c("calendrier-valider").addEventListener("click", async () => {
    if (!calendrier?.saison) return message("message-calendrier", "Enregistre d'abord les dates de la saison.", "erreur");
    const debut = $c("calendrier-debut").value;
    const fin = $c("calendrier-fin").value || debut;
    const court = $c("calendrier-court").value.trim();
    const long = $c("calendrier-long").value.trim();
    if (!debut || fin < debut) return message("message-calendrier", "Choisis le jour de début (et de fin, le même jour ou après).", "erreur");
    if (!court || [...court].length > COURT_CALENDRIER_MAX) return message("message-calendrier", `Description courte : 1 à ${COURT_CALENDRIER_MAX} caractères.`, "erreur");
    if (!long) return message("message-calendrier", "Écris la description longue.", "erreur");
    const evenement = { id: modifie || undefined, debut, fin, court, long, banniere };
    const evenements = modifie
      ? calendrier.evenements.map(e => (e.id === modifie ? evenement : e))
      : [...calendrier.evenements, evenement];
    if (await enregistrer({ ...calendrier, evenements }, "message-calendrier", modifie ? "Événement modifié." : "Événement ajouté.")) viderFormulaire();
  });

  $c("calendrier-annuler").addEventListener("click", () => {
    viderFormulaire();
    message("message-calendrier", "");
  });

  $c("calendrier-liste").addEventListener("click", event => {
    const bouton = event.target.closest("button");
    if (!bouton) return;
    if (bouton.dataset.modifier) {
      const e = calendrier.evenements.find(x => x.id === bouton.dataset.modifier);
      if (!e) return;
      modifie = e.id;
      $c("calendrier-debut").value = e.debut;
      $c("calendrier-fin").value = e.fin;
      $c("calendrier-court").value = e.court;
      $c("calendrier-long").value = e.long;
      banniere = e.banniere || BANNIERE_CALENDRIER_DEFAUT;
      $c("calendrier-titre-formulaire").textContent = `Modifier « ${e.court} »`;
      $c("calendrier-valider").textContent = "Enregistrer la modification";
      $c("calendrier-annuler").hidden = false;
      attenteFin = false;
      majCompteur();
      majBanniere();
      rendreSelecteur();
      $c("calendrier-titre-formulaire").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (bouton.dataset.supprimer) {
      const e = calendrier.evenements.find(x => x.id === bouton.dataset.supprimer);
      if (!e) return;
      if (modifie === e.id) viderFormulaire();
      enregistrer({ ...calendrier, evenements: calendrier.evenements.filter(x => x.id !== e.id) }, "message-calendrier", `« ${e.court} » supprimé.`);
    }
  });
}

initialiserEvenements();
initialiserCalendrierAdmin();
