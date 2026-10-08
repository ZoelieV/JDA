// Box fictives : faux profils pour l'entraînement (cf.
// api/_lib/boxes_fictives.js), gérés par les administrateurs et les mini
// admins (pas concernés par la lecture seule de la page). Créer une box
// (nom obligatoire) ouvre Mon compte pour la remplir comme une full box
// (my_account?box_fictive=<id>). API : api/accounts/[discord_id].js.
// Utilise echapper (admin_ajout.js).

const API_FICTIVES = "/api/accounts/boxes_fictives";
const PALIERS_FICTIVES = { 1: 6, 2: 8, 3: 10, 4: 12 };

let boxesFictives = [];

const lienEditionFictive = id => `/my_account?box_fictive=${encodeURIComponent(id)}`;

function afficherMessageFictives(texte, type = "") {
  const message = document.getElementById("message-fictives");
  message.textContent = texte;
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
}

async function requeteFictives(url, options = {}) {
  const reponse = await fetch(url, {
    credentials: "include",
    ...options,
    headers: options.body ? { "Content-Type": "application/json" } : undefined
  });
  const data = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(data.error || "Erreur serveur.");
  return data;
}

function rendreFictives() {
  const zone = document.getElementById("liste-fictives");
  if (!boxesFictives.length) {
    zone.innerHTML = `<p class="aide-apercu">Aucune box fictive pour l'instant.</p>`;
    return;
  }
  zone.innerHTML = `
    <table class="tableau-boss">
      <thead>
        <tr><th class="col-nom">Box</th><th>Persos</th><th>Théâtre</th><th>Modifiée</th><th></th></tr>
      </thead>
      <tbody>
        ${boxesFictives.map(box => `
          <tr>
            <td class="col-nom">
              <span class="nom-ajout">${echapper(box.nom)}</span>
              ${box.createur ? `<br><span class="details-boss">créée par ${echapper(box.createur)}</span>` : ""}
            </td>
            <td>${box.nb_persos}</td>
            <td>${PALIERS_FICTIVES[box.theatre] ?? "-"}</td>
            <td>${box.modifie_le ? new Date(box.modifie_le).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : ""}</td>
            <td>
              <div class="actions-fictive">
                <a class="action-fictive" href="${echapper(lienEditionFictive(box.id))}">Remplir</a>
                <button type="button" class="action-fictive renommer-fictive" data-id="${echapper(box.id)}">Renommer</button>
                <button type="button" class="supprimer-ajout supprimer-fictive" data-id="${echapper(box.id)}">Supprimer</button>
              </div>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

async function chargerFictives() {
  afficherMessageFictives("Chargement…");
  try {
    boxesFictives = await requeteFictives(API_FICTIVES);
    afficherMessageFictives("");
  } catch (erreur) {
    console.error(erreur);
    boxesFictives = [];
    afficherMessageFictives(erreur.message, "erreur");
  }
  rendreFictives();
}

async function creerFictive(event) {
  event.preventDefault();
  const champ = document.getElementById("nom-fictive");
  const nom = champ.value.trim();
  if (!nom) {
    afficherMessageFictives("Donne un nom à la box.", "erreur");
    champ.focus();
    return;
  }
  try {
    const { id } = await requeteFictives(API_FICTIVES, {
      method: "POST",
      body: JSON.stringify({ nom, theatre: document.getElementById("theatre-fictive").value })
    });
    // Box créée vide : direction Mon compte pour la remplir.
    window.location.href = lienEditionFictive(id);
  } catch (erreur) {
    console.error(erreur);
    afficherMessageFictives(erreur.message, "erreur");
  }
}

async function renommerFictive(id) {
  const box = boxesFictives.find(b => b.id === id);
  const nom = prompt("Nouveau nom de la box :", box?.nom || "")?.trim();
  if (!nom || nom === box?.nom) return;
  try {
    await requeteFictives(`/api/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ nom }) });
    await chargerFictives();
    afficherMessageFictives(`Box renommée en « ${nom} ».`, "succes");
  } catch (erreur) {
    console.error(erreur);
    afficherMessageFictives(erreur.message, "erreur");
  }
}

async function supprimerFictive(id) {
  const box = boxesFictives.find(b => b.id === id);
  if (!confirm(`Supprimer la box fictive « ${box?.nom || id} » ? Elle ne sera plus choisissable en entraînement.`)) return;
  try {
    await requeteFictives(`/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
    await chargerFictives();
    afficherMessageFictives("Box supprimée.", "succes");
  } catch (erreur) {
    console.error(erreur);
    afficherMessageFictives(erreur.message, "erreur");
  }
}

function initialiserFictives() {
  const modal = document.getElementById("modal-fictives");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-fictives").addEventListener("click", () => {
    modal.classList.add("active");
    chargerFictives();
  });
  document.getElementById("fermer-fictives").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("creer-fictive").addEventListener("submit", creerFictive);
  document.getElementById("liste-fictives").addEventListener("click", event => {
    const renommer = event.target.closest(".renommer-fictive");
    if (renommer) renommerFictive(renommer.dataset.id);
    const supprimer = event.target.closest(".supprimer-fictive");
    if (supprimer) supprimerFictive(supprimer.dataset.id);
  });
}

initialiserFictives();
