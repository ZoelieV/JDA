// Administration : patchs d'équilibrage (fenêtre Patchs de la page Équilibrage,
// cf. api/_lib/patchs.js), affichés aux joueurs dans l'onglet Patchs de
// Theorycraft. Enregistrés avec le bouton de la fenêtre, à part des points.
// Mini admins : lecture seule (cf. passerEnLectureSeule dans admin_ppc.js).

const LONGUEUR_POINTS_PATCH = 40;
const LONGUEUR_EXPLICATION_PATCH = 500;

let patchsAdmin = [];

const ligneVidePatch = () => ({ perso: "", avant: "", apres: "", explication: "" });

function jourLocal() {
  const maintenant = new Date();
  return new Date(maintenant.getTime() - maintenant.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Patch en cours de saisie : gardé si la fenêtre est fermée puis rouverte.
const nouveauPatch = () => ({ id: null, date: jourLocal(), lignes: [ligneVidePatch()] });
let patchSaisi = nouveauPatch();

function dateLisiblePatch(date) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

function afficherMessagePatch(texte, type = "") {
  const message = document.getElementById("message-patchs");
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
  message.textContent = texte;
}

function optionsPersosPatch(choisi) {
  const tries = [...personnages].sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }));
  const masquesPersos = new Set(masques.characters || []);
  return `<option value="">Choisir…</option>${tries.map(p =>
    `<option value="${echapperHtml(p.id)}"${p.id === choisi ? " selected" : ""}>${echapperHtml(p.nom)}${masquesPersos.has(p.id) ? " (masqué)" : ""}</option>`).join("")}`;
}

function rendrePatchsAdmin() {
  const nomPerso = id => personnages.find(p => p.id === id)?.nom || id;
  document.getElementById("contenu-patchs").innerHTML = `
    <h3 class="titre-section-ajout">${patchSaisi.id ? "Modifier le patch" : "Nouveau patch"}</h3>
    <label class="date-patch">Date du patch : <input type="date" id="patch-date" value="${echapperHtml(patchSaisi.date)}"></label>
    <div class="tableau-patch-conteneur">
      <table class="tableau-patch">
        <thead><tr><th>Personnage</th><th>Points avant</th><th>Points après</th><th>Explication</th><th></th></tr></thead>
        <tbody>
          ${patchSaisi.lignes.map((ligne, i) => `
            <tr data-ligne="${i}">
              <td><select data-champ="perso" aria-label="Personnage">${optionsPersosPatch(ligne.perso)}</select></td>
              <td><input type="text" data-champ="avant" maxlength="${LONGUEUR_POINTS_PATCH}" value="${echapperHtml(ligne.avant)}" aria-label="Points avant"></td>
              <td><input type="text" data-champ="apres" maxlength="${LONGUEUR_POINTS_PATCH}" value="${echapperHtml(ligne.apres)}" aria-label="Points après"></td>
              <td><textarea data-champ="explication" rows="1" maxlength="${LONGUEUR_EXPLICATION_PATCH}" aria-label="Explication">${echapperHtml(ligne.explication)}</textarea></td>
              <td><button type="button" class="btn-masquer action-patch retirer-ligne-patch" title="Retirer cette ligne" aria-label="Retirer cette ligne">×</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="actions-patch">
      <button type="button" id="ajouter-ligne-patch" class="bouton-creer secondaire action-patch">+ Personnage</button>
      <button type="button" id="enregistrer-patch" class="bouton-creer action-patch">${patchSaisi.id ? "Enregistrer les modifications" : "Publier le patch"}</button>
      ${patchSaisi.id ? `<button type="button" id="abandonner-patch" class="bouton-creer secondaire action-patch">Annuler</button>` : ""}
    </div>
    <h3 class="titre-section-ajout">Patchs publiés (${patchsAdmin.length})</h3>
    <ul class="liste-patchs">
      ${patchsAdmin.map(patch => `
        <li>
          <span class="infos-patch"><strong>${dateLisiblePatch(patch.date)}</strong> · ${patch.lignes.map(l => echapperHtml(nomPerso(l.perso))).join(", ")}</span>
          <button type="button" class="btn-masquer action-patch modifier-patch" data-id="${echapperHtml(patch.id)}">Modifier</button>
          <button type="button" class="btn-masquer action-patch supprimer-patch" data-id="${echapperHtml(patch.id)}">Supprimer</button>
        </li>`).join("") || `<li class="aucune-synergie">Aucun patch pour l'instant.</li>`}
    </ul>`;
}

async function envoyerPatchs(corps) {
  const reponse = await fetch("/api/points", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps)
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(donnees.error || "Erreur d'enregistrement.");
  patchsAdmin = donnees.patchs;
}

async function chargerPatchsAdmin() {
  const reponse = await fetch("/api/points?patchs=1", { credentials: "include", cache: "no-store" });
  if (!reponse.ok) throw new Error("Impossible de charger les patchs.");
  patchsAdmin = (await reponse.json()).patchs;
}

// Lignes entièrement vides ignorées ; une ligne remplie sans perso est signalée.
async function enregistrerPatch() {
  const lignes = patchSaisi.lignes.filter(l => l.perso || l.avant.trim() || l.apres.trim() || l.explication.trim());
  const sansPerso = lignes.findIndex(l => !l.perso);
  if (sansPerso >= 0) return afficherMessagePatch(`Ligne ${sansPerso + 1} : choisis un personnage.`, "erreur");
  afficherMessagePatch("Enregistrement…");
  try {
    await envoyerPatchs({ patch: { ...patchSaisi, lignes } });
    patchSaisi = nouveauPatch();
    rendrePatchsAdmin();
    afficherMessagePatch("Patch enregistré : les joueurs le voient dans Theorycraft.", "succes");
  } catch (erreur) {
    console.error(erreur);
    afficherMessagePatch(erreur.message, "erreur");
  }
}

async function supprimerPatch(id) {
  const patch = patchsAdmin.find(p => p.id === id);
  if (!patch || !confirm(`Supprimer le patch du ${dateLisiblePatch(patch.date)} ? Les joueurs ne le verront plus.`)) return;
  afficherMessagePatch("Suppression…");
  try {
    await envoyerPatchs({ patch_suppression: id });
    if (patchSaisi.id === id) patchSaisi = nouveauPatch();
    rendrePatchsAdmin();
    afficherMessagePatch("Patch supprimé.", "succes");
  } catch (erreur) {
    console.error(erreur);
    afficherMessagePatch(erreur.message, "erreur");
  }
}

function initialiserPatchs() {
  const modal = document.getElementById("modal-patchs");
  const contenu = document.getElementById("contenu-patchs");
  const fermer = () => modal.classList.remove("active");

  document.getElementById("ouvrir-patchs").addEventListener("click", async () => {
    modal.classList.add("active");
    afficherMessagePatch("Chargement…");
    rendrePatchsAdmin();
    try {
      await chargerPatchsAdmin();
      rendrePatchsAdmin();
      afficherMessagePatch("");
    } catch (erreur) {
      console.error(erreur);
      afficherMessagePatch(erreur.message, "erreur");
    }
  });
  document.getElementById("fermer-patchs").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  // Saisie : gardée dans patchSaisi, sans redessiner (le champ garde le focus).
  const saisir = event => {
    afficherMessagePatch("");
    if (event.target.id === "patch-date") {
      patchSaisi.date = event.target.value;
      return;
    }
    const champ = event.target.dataset.champ;
    if (champ) patchSaisi.lignes[Number(event.target.closest("tr").dataset.ligne)][champ] = event.target.value;
  };
  contenu.addEventListener("input", saisir);
  contenu.addEventListener("change", saisir);

  contenu.addEventListener("click", event => {
    const bouton = event.target.closest("button");
    if (!bouton) return;
    if (bouton.id === "ajouter-ligne-patch") {
      patchSaisi.lignes.push(ligneVidePatch());
      rendrePatchsAdmin();
      contenu.querySelector("tbody tr:last-child select").focus();
    } else if (bouton.id === "enregistrer-patch") {
      enregistrerPatch();
    } else if (bouton.id === "abandonner-patch") {
      patchSaisi = nouveauPatch();
      rendrePatchsAdmin();
      afficherMessagePatch("");
    } else if (bouton.classList.contains("retirer-ligne-patch")) {
      patchSaisi.lignes.splice(Number(bouton.closest("tr").dataset.ligne), 1);
      if (!patchSaisi.lignes.length) patchSaisi.lignes.push(ligneVidePatch());
      rendrePatchsAdmin();
    } else if (bouton.classList.contains("modifier-patch")) {
      patchSaisi = structuredClone(patchsAdmin.find(p => p.id === bouton.dataset.id));
      rendrePatchsAdmin();
      afficherMessagePatch("");
      contenu.closest(".modal-apercu-contenu").scrollTop = 0;
    } else if (bouton.classList.contains("supprimer-patch")) {
      supprimerPatch(bouton.dataset.id);
    }
  });
}

initialiserPatchs();
