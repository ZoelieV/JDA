// Feedbacks des joueurs (envoyés depuis l'accueil, cf. commun/feedback.js et
// api/_lib/feedbacks.js) : texte, pseudo, jour et heure. Administrateurs :
// statut (nouveau, pris en compte, terminé) et suppression ; mini admins :
// lecture (boutons verrouillés, cf. ZONES_MODIFIABLES, admin_ppc.js).
// Utilise echapper (admin_ajout.js).

const STATUTS_FEEDBACK = {
  nouveau: "Nouveau",
  pris_en_compte: "Pris en compte",
  termine: "Terminé"
};

let feedbacks = [];
let filtreFeedback = "tous"; // "tous" ou un statut

function afficherMessageFeedback(texte, type = "") {
  const message = document.getElementById("message-feedback");
  message.textContent = texte;
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
}

function formaterDateFeedback(date) {
  return new Date(date).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Nombre de feedbacks nouveaux sur le bouton de la barre.
function majBoutonFeedback() {
  const nouveaux = feedbacks.filter(f => f.statut === "nouveau").length;
  document.getElementById("ouvrir-feedback").textContent = nouveaux ? `Feedback (${nouveaux})` : "Feedback";
}

function rendreFeedbacks() {
  majBoutonFeedback();
  document.querySelectorAll(".filtre-feedback").forEach(bouton => {
    const n = bouton.dataset.statut === "tous" ? feedbacks.length : feedbacks.filter(f => f.statut === bouton.dataset.statut).length;
    bouton.classList.toggle("active", bouton.dataset.statut === filtreFeedback);
    bouton.textContent = `${bouton.dataset.libelle} (${n})`;
  });
  const liste = feedbacks.filter(f => filtreFeedback === "tous" || f.statut === filtreFeedback);
  const zone = document.getElementById("liste-feedbacks");
  if (!liste.length) {
    zone.innerHTML = `<p class="aide-apercu">${feedbacks.length ? "Aucun feedback avec ce statut." : "Aucun feedback pour le moment."}</p>`;
    return;
  }
  // Texte du joueur échappé (jamais interprété) et affiché tel quel, retours
  // à la ligne compris.
  zone.innerHTML = liste.map(f => `
    <article class="carte-feedback statut-${echapper(f.statut)}">
      <div class="entete-feedback">
        ${f.avatar ? `<img class="photo-ban" src="${echapper(f.avatar)}" alt="">` : ""}
        <div class="infos-feedback">
          <span class="nom-ajout pseudo">${echapper(f.nom)}</span>
          <span class="details-boss">${formaterDateFeedback(f.date)}</span>
        </div>
        <span class="statut-feedback">${STATUTS_FEEDBACK[f.statut] || ""}</span>
      </div>
      <p class="texte-feedback">${echapper(f.texte)}</p>
      ${f.traite_par ? `<p class="details-boss">${STATUTS_FEEDBACK[f.statut]} par ${echapper(f.traite_par)}${f.traite_le ? `, ${formaterDateFeedback(f.traite_le)}` : ""}</p>` : ""}
      <div class="actions-feedback">
        ${Object.entries(STATUTS_FEEDBACK).filter(([statut]) => statut !== f.statut).map(([statut, libelle]) =>
          `<button type="button" class="mode-modificateur action-feedback" data-id="${echapper(String(f.id))}" data-statut="${statut}">${statut === "nouveau" ? "Remettre en nouveau" : libelle}</button>`).join("")}
        <button type="button" class="bouton-annuler action-feedback" data-id="${echapper(String(f.id))}" data-supprimer="1">Supprimer</button>
      </div>
    </article>`).join("");
}

async function chargerFeedbacks() {
  afficherMessageFeedback("Chargement…");
  try {
    const reponse = await fetch("/api/matches?feedback=liste", { credentials: "include", cache: "no-store" });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(data.error || "Impossible de charger les feedbacks.");
    feedbacks = data.feedbacks || [];
    afficherMessageFeedback(data.erreur || "", data.erreur ? "erreur" : "");
  } catch (erreur) {
    console.error(erreur);
    feedbacks = [];
    afficherMessageFeedback(erreur.message, "erreur");
  }
  rendreFeedbacks();
}

async function modifierFeedback(bouton) {
  const id = Number(bouton.dataset.id);
  const supprimer = bouton.dataset.supprimer === "1";
  if (supprimer && !confirm("Supprimer ce feedback ? Il ne pourra pas être récupéré.")) return;
  bouton.disabled = true;
  try {
    const reponse = await fetch("/api/matches", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(supprimer ? { action: "feedback_supprimer", id } : { action: "feedback", id, statut: bouton.dataset.statut })
    });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(data.error || "Modification impossible.");
    await chargerFeedbacks();
    afficherMessageFeedback(supprimer ? "Feedback supprimé." : `Feedback : ${STATUTS_FEEDBACK[bouton.dataset.statut].toLowerCase()}.`, "succes");
  } catch (erreur) {
    console.error(erreur);
    afficherMessageFeedback(erreur.message, "erreur");
    bouton.disabled = false;
  }
}

function initialiserFeedback() {
  const modal = document.getElementById("modal-feedback");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-feedback").addEventListener("click", () => {
    modal.classList.add("active");
    chargerFeedbacks();
  });
  document.getElementById("fermer-feedback").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.querySelectorAll(".filtre-feedback").forEach(bouton => {
    bouton.addEventListener("click", () => {
      filtreFeedback = bouton.dataset.statut;
      rendreFeedbacks();
    });
  });
  document.getElementById("liste-feedbacks").addEventListener("click", event => {
    const bouton = event.target.closest(".action-feedback");
    if (bouton && !bouton.disabled) modifierFeedback(bouton);
  });
  // Nombre de nouveaux feedbacks dès l'ouverture de la page.
  chargerFeedbacks();
}

initialiserFeedback();
