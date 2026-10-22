// Rikoyns (cf. api/_lib/koyns.js) : fenêtre des administrateurs pour donner
// des Rikoyns ou un cosmétique à un joueur, choisir les cosmétiques exclusifs
// (pas en vente : récompenses de classements et d'événements) et régler le
// bonus de connexion d'un événement (config.cosmetiques_exclusifs,
// config.bonus_connexion, api/points.js). Utilise envoyerAjout
// (admin_ajout.js), idCosmetique et COSMETIQUES_GRATUITS (commun/koyns.js),
// VARIANTES_PERSONNAGES et SKINS_PERSONNAGES (commun/variantes.js).

let exclusifsKoyns = [];
let nomsCosmetiquesKoyns = new Map(); // id -> nom affiché (fonds : cf. nomFond)

function messageKoyns(id, texte, type = "") {
  const message = document.getElementById(id);
  message.textContent = texte;
  message.className = `message-ajout ${type}`;
}

// Tous les cosmétiques payants (ids), pour les listes de suggestions ;
// noms des fonds dans nomsCosmetiquesKoyns.
async function chargerCatalogueKoyns() {
  const reponse = await fetch("/DB/images/cosmetiques.json");
  const cosmetiques = await reponse.json();
  nomsCosmetiquesKoyns = new Map(cosmetiques.fonds.map(fond => [idCosmetique("fond", fond.id), `Fond : ${nomFond(fond)}`]));
  return [
    ...cosmetiques.fonds.map(fond => idCosmetique("fond", fond.id)),
    idCosmetique("fond", "perso"),
    ...cosmetiques.bannieres.map(chemin => idCosmetique("banniere", chemin)),
    ...cosmetiques.bannieres2.map(chemin => idCosmetique("banniere2", chemin)),
    ...Object.values(VARIANTES_PERSONNAGES).flatMap(v => Object.keys(v.options).map(option => idCosmetique(v.parametre, option))),
    ...SKINS_PERSONNAGES.map(id => idCosmetique("skin", id))
  ].filter(id => !COSMETIQUES_GRATUITS.has(id));
}

async function chargerJoueursKoyns() {
  const reponse = await fetch("/api/accounts", { credentials: "include" });
  const comptes = reponse.ok ? await reponse.json() : [];
  const choix = document.getElementById("don-joueur");
  choix.innerHTML = `<option value="">Choisir un joueur…</option>` + comptes
    .map(c => ({ id: c.discord_id, nom: c.discord_global_name || c.discord_username || c.discord_id }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }))
    .map(c => `<option value="${echapper(c.id)}">${echapper(c.nom)}</option>`).join("");
}

function rendreExclusifs() {
  document.getElementById("liste-exclusifs").innerHTML = exclusifsKoyns.length
    ? exclusifsKoyns.map(id => `<span class="exclusif-koyns" title="${echapper(id)}">${nomsCosmetiquesKoyns.has(id) ? echapper(nomsCosmetiquesKoyns.get(id)) : `<code>${echapper(id)}</code>`}<button type="button" class="retirer-exclusif" data-id="${echapper(id)}" aria-label="Retirer">×</button></span>`).join("")
    : `<span class="aide-apercu">Aucun cosmétique exclusif pour l'instant.</span>`;
}

// "2026-10-18T20:00:00.000Z" -> valeur d'un champ datetime-local (heure locale).
function versChampDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function remplirBonus(bonus) {
  document.getElementById("bonus-debut").value = versChampDate(bonus?.debut);
  document.getElementById("bonus-fin").value = versChampDate(bonus?.fin);
  document.getElementById("bonus-koyns").value = bonus?.koyns ?? "";
  document.getElementById("bonus-cosmetique").value = bonus?.cosmetique || "";
  document.getElementById("supprimer-bonus").disabled = !bonus;
}

async function ouvrirKoyns() {
  document.getElementById("modal-koyns").classList.add("active");
  const [config, catalogue] = await Promise.all([chargerPointsAdmin(), chargerCatalogueKoyns(), chargerJoueursKoyns()]);
  document.getElementById("catalogue-koyns").innerHTML = catalogue.map(id => `<option value="${echapper(id)}"${nomsCosmetiquesKoyns.has(id) ? ` label="${echapper(nomsCosmetiquesKoyns.get(id))}"` : ""}></option>`).join("");
  exclusifsKoyns = Array.isArray(config?.cosmetiques_exclusifs) ? [...config.cosmetiques_exclusifs] : [];
  rendreExclusifs();
  remplirBonus(config?.bonus_connexion);
}

async function donnerKoyns() {
  const discordId = document.getElementById("don-joueur").value;
  const koyns = Number(document.getElementById("don-koyns").value || 0);
  const cosmetique = document.getElementById("don-cosmetique").value.trim() || null;
  if (!discordId) return messageKoyns("message-don", "Choisis un joueur.", "erreur");
  try {
    // Pas envoyerAjout : la réponse n'est pas la config.
    const reponse = await fetch("/api/points", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ don: { discord_id: discordId, koyns, cosmetique } })
    });
    const donnees = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(donnees.error || "Erreur d'enregistrement.");
    messageKoyns("message-don", "Envoyé.", "succes");
    document.getElementById("don-koyns").value = "";
    document.getElementById("don-cosmetique").value = "";
  } catch (erreur) {
    console.error(erreur);
    messageKoyns("message-don", erreur.message, "erreur");
  }
}

async function enregistrerExclusifs(liste) {
  try {
    const config = await envoyerAjout({ cosmetiques_exclusifs: liste });
    exclusifsKoyns = config.cosmetiques_exclusifs || [];
    rendreExclusifs();
    messageKoyns("message-exclusifs", "Enregistré.", "succes");
  } catch (erreur) {
    console.error(erreur);
    messageKoyns("message-exclusifs", erreur.message, "erreur");
  }
}

async function enregistrerBonus(supprimer = false) {
  const champ = id => document.getElementById(id).value;
  // Champs datetime-local : heure locale de l'administrateur.
  const bonus = supprimer ? null : {
    debut: champ("bonus-debut") && new Date(champ("bonus-debut")).toISOString(),
    fin: champ("bonus-fin") && new Date(champ("bonus-fin")).toISOString(),
    koyns: Number(champ("bonus-koyns") || 0),
    cosmetique: champ("bonus-cosmetique").trim() || null
  };
  try {
    const config = await envoyerAjout({ bonus_connexion: bonus });
    remplirBonus(config.bonus_connexion);
    messageKoyns("message-bonus", supprimer ? "Bonus supprimé." : "Bonus enregistré.", "succes");
  } catch (erreur) {
    console.error(erreur);
    messageKoyns("message-bonus", erreur.message, "erreur");
  }
}

function initialiserKoyns() {
  const modal = document.getElementById("modal-koyns");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-koyns").addEventListener("click", ouvrirKoyns);
  document.getElementById("fermer-koyns").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("donner-koyns").addEventListener("click", donnerKoyns);
  document.getElementById("ajouter-exclusif").addEventListener("click", () => {
    const champ = document.getElementById("nouvel-exclusif");
    const id = champ.value.trim();
    if (!id) return;
    champ.value = "";
    enregistrerExclusifs([...exclusifsKoyns, id]);
  });
  document.getElementById("liste-exclusifs").addEventListener("click", event => {
    const bouton = event.target.closest(".retirer-exclusif");
    if (bouton) enregistrerExclusifs(exclusifsKoyns.filter(id => id !== bouton.dataset.id));
  });
  document.getElementById("enregistrer-bonus").addEventListener("click", () => enregistrerBonus());
  document.getElementById("supprimer-bonus").addEventListener("click", () => enregistrerBonus(true));
}

initialiserKoyns();
