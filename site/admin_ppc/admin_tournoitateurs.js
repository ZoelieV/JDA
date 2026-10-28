// Tournoitateurs (cf. api/_lib/tournois.js) : joueurs autorisés à créer des
// tournois, désignés par les administrateurs et les mini admins (route
// /api/rooms/tournoi/tournoitateurs). Utilise echapper.

function messageTournoitateurs(texte, type = "") {
  const message = document.getElementById("message-tournoitateurs");
  message.textContent = texte;
  message.className = `message-ajout ${type}`;
}

function rendreTournoitateurs(ids) {
  const entrees = Object.entries(ids || {});
  document.getElementById("liste-tournoitateurs").innerHTML = entrees.length
    ? entrees.map(([id, infos]) => `<span class="exclusif-koyns" title="${echapper(id)}">${echapper(infos.nom || id)}<button type="button" class="retirer-exclusif" data-id="${echapper(id)}" aria-label="Retirer">×</button></span>`).join("")
    : `<span class="aide-apercu">Aucun tournoitateur pour l'instant.</span>`;
}

async function appelTournoitateurs(corps = null) {
  const reponse = await fetch("/api/rooms/tournoi/tournoitateurs", corps ? {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  } : { credentials: "include" });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error || "Erreur du serveur.");
  return donnees.tournoitateurs;
}

async function ouvrirTournoitateurs() {
  document.getElementById("modal-tournoitateurs").classList.add("active");
  messageTournoitateurs("");
  try {
    const [ids, comptes] = await Promise.all([
      appelTournoitateurs(),
      fetch("/api/accounts", { credentials: "include" }).then(r => (r.ok ? r.json() : []))
    ]);
    rendreTournoitateurs(ids);
    document.getElementById("nouveau-tournoitateur").innerHTML = `<option value="">Choisir un joueur…</option>` + comptes
      .map(c => ({ id: c.discord_id, nom: c.discord_global_name || c.discord_username || c.discord_id }))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }))
      .map(c => `<option value="${echapper(c.id)}">${echapper(c.nom)}</option>`).join("");
  } catch (erreur) {
    messageTournoitateurs(erreur.message, "erreur");
  }
}

async function modifierTournoitateur(discordId, retirer = false) {
  try {
    rendreTournoitateurs(await appelTournoitateurs({ discord_id: discordId, retirer }));
    messageTournoitateurs("Enregistré.", "succes");
  } catch (erreur) {
    messageTournoitateurs(erreur.message, "erreur");
  }
}

(function initialiserTournoitateurs() {
  const modal = document.getElementById("modal-tournoitateurs");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-tournoitateurs").addEventListener("click", ouvrirTournoitateurs);
  document.getElementById("fermer-tournoitateurs").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("ajouter-tournoitateur").addEventListener("click", () => {
    const id = document.getElementById("nouveau-tournoitateur").value;
    if (id) modifierTournoitateur(id);
  });
  document.getElementById("liste-tournoitateurs").addEventListener("click", event => {
    const bouton = event.target.closest(".retirer-exclusif");
    if (bouton) modifierTournoitateur(bouton.dataset.id, true);
  });
})();
