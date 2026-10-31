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
// D'abord les dates de la saison de JDA (jours affichés), puis les
// événements : un ou plusieurs jours, couleur, description courte (dans le
// jour, 20 caractères au plus) et longue (fenêtre du jour). Chaque
// modification envoie tout le calendrier.
const COURT_CALENDRIER_MAX = 20;

function initialiserCalendrierAdmin() {
  const $c = id => document.getElementById(id);
  let calendrier = null; // { saison: { debut, fin }, evenements: [...] }
  let modifie = null; // id de l'événement en cours de modification

  const message = (id, texte, type = "") => {
    $c(id).className = `message-ajout ${type}`;
    $c(id).textContent = texte;
  };
  const dateLisible = jour => new Date(`${jour}T00:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const echapper = texte => String(texte).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

  function viderFormulaire() {
    modifie = null;
    ["calendrier-debut", "calendrier-fin", "calendrier-court", "calendrier-long"].forEach(id => { $c(id).value = ""; });
    $c("calendrier-couleur").value = "#e2d29a";
    $c("calendrier-titre-formulaire").textContent = "Ajouter un événement";
    $c("calendrier-valider").textContent = "Ajouter l'événement";
    $c("calendrier-annuler").hidden = true;
    majCompteur();
  }

  function majCompteur() {
    $c("calendrier-compteur").textContent = `${[...$c("calendrier-court").value].length} / ${COURT_CALENDRIER_MAX}`;
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
          <span class="pastille-couleur-calendrier" style="background-color: ${echapper(e.couleur)}"></span>
          <span class="dates-calendrier-admin">${dateLisible(e.debut)}${e.fin !== e.debut ? ` → ${dateLisible(e.fin)}` : ""}</span>
          <strong>${echapper(e.court)}</strong>
          <span class="long-calendrier-admin doux" title="${echapper(e.long)}">${echapper(e.long)}</span>
          <button type="button" class="bouton-creer secondaire action-calendrier" data-modifier="${e.id}">Modifier</button>
          <button type="button" class="bouton-creer secondaire action-calendrier" data-supprimer="${e.id}">Supprimer</button>
        </li>`).join("") : `<li class="doux">Aucun événement.</li>`;
  }

  chargerPointsAdmin().then(config => {
    calendrier = config?.calendrier || null;
    rendre();
  });

  $c("calendrier-court").addEventListener("input", majCompteur);

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
    const evenement = { id: modifie || undefined, debut, fin, court, long, couleur: $c("calendrier-couleur").value };
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
      $c("calendrier-couleur").value = e.couleur;
      $c("calendrier-court").value = e.court;
      $c("calendrier-long").value = e.long;
      $c("calendrier-titre-formulaire").textContent = `Modifier « ${e.court} »`;
      $c("calendrier-valider").textContent = "Enregistrer la modification";
      $c("calendrier-annuler").hidden = false;
      majCompteur();
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
