// Bans du mode classé en cours (sanctions décidées dans la section
// Litiges de l'historique, cf. api/_lib/sanctions.js) : liste, recherche et
// levée d'un ban (api/matches.js, ?bans=1 et action "lever_ban").
// Utilise echapper (admin_ajout.js).

const LIBELLES_BANS = {
  semaine: "1 semaine",
  saison: "Jusqu'à la fin de la saison",
  definitif: "Définitif"
};

let bansEnCours = [];

function formaterDateBan(date) {
  return new Date(date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

function afficherMessageBans(texte, type = "") {
  const message = document.getElementById("message-bans");
  message.textContent = texte;
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
}

function rendreBans() {
  const recherche = document.getElementById("recherche-bans").value.trim().toLowerCase();
  const liste = bansEnCours.filter(ban => !recherche || ban.nom.toLowerCase().includes(recherche));
  document.getElementById("compte-bans").textContent = `${liste.length} ban${liste.length > 1 ? "s" : ""} en cours`;
  const zone = document.getElementById("liste-bans");
  if (!liste.length) {
    zone.innerHTML = `<p class="aide-apercu">${bansEnCours.length ? "Aucun joueur trouvé." : "Aucun ban en cours."}</p>`;
    return;
  }
  zone.innerHTML = `
    <table class="tableau-boss tableau-bans">
      <thead>
        <tr><th>Joueur</th><th>Ban</th><th>Fin</th><th>Décidé</th><th></th></tr>
      </thead>
      <tbody>
        ${liste.map(ban => `
          <tr class="${ban.type === "definitif" ? "ban-definitif" : ""}">
            <td class="col-nom">
              <div class="entete-boss">
                ${ban.avatar ? `<img class="photo-ban" src="${echapper(ban.avatar)}" alt="">` : ""}
                <span class="nom-ajout pseudo">${echapper(ban.nom)}</span>
              </div>
            </td>
            <td>${LIBELLES_BANS[ban.type] || echapper(ban.type)}</td>
            <td>${ban.fin ? formaterDateBan(ban.fin) : "Jamais"}</td>
            <td>${formaterDateBan(ban.depuis)}${ban.admin ? `<br><span class="details-boss">par ${echapper(ban.admin)}</span>` : ""}</td>
            <td><button type="button" class="bouton-annuler lever-ban" data-id="${echapper(String(ban.id))}" data-nom="${echapper(ban.nom)}">Lever le ban</button></td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

async function chargerBans() {
  afficherMessageBans("Chargement…");
  try {
    const reponse = await fetch("/api/matches?bans=1", { credentials: "include" });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(data.error || "Impossible de charger les bans.");
    bansEnCours = data.bans || [];
    afficherMessageBans(data.erreur || "", data.erreur ? "erreur" : "");
  } catch (erreur) {
    console.error(erreur);
    bansEnCours = [];
    afficherMessageBans(erreur.message, "erreur");
  }
  rendreBans();
}

async function leverBan(id, nom) {
  if (!confirm(`Lever le ban de ${nom} ? Il pourra rejouer en classé tout de suite.`)) return;
  try {
    const reponse = await fetch("/api/matches", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lever_ban", sanction_id: Number(id) })
    });
    const data = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(data.error || "Impossible de lever le ban.");
    await chargerBans();
    afficherMessageBans(`Ban de ${nom} levé.`, "succes");
  } catch (erreur) {
    console.error(erreur);
    afficherMessageBans(erreur.message, "erreur");
  }
}

function initialiserBans() {
  const modal = document.getElementById("modal-bans");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-bans").addEventListener("click", () => {
    document.getElementById("recherche-bans").value = "";
    modal.classList.add("active");
    chargerBans();
  });
  document.getElementById("fermer-bans").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("recherche-bans").addEventListener("input", rendreBans);
  document.getElementById("liste-bans").addEventListener("click", event => {
    const bouton = event.target.closest(".lever-ban");
    if (bouton) leverBan(bouton.dataset.id, bouton.dataset.nom);
  });
}

initialiserBans();
