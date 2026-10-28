// Rikoyns (cf. api/_lib/koyns.js) : fenêtre des administrateurs pour donner
// des Rikoyns ou un cosmétique à un joueur, choisir les cosmétiques exclusifs
// (pas en vente : récompenses de classements et d'événements) et les
// cosmétiques focus du tirage (config.cosmetiques_tirage), et régler le
// bonus de connexion d'un événement (config.cosmetiques_exclusifs,
// config.bonus_connexion, api/points.js). Utilise envoyerAjout
// (admin_ajout.js), choisirCosmetiques et htmlPastilleCosmetique (fenêtre
// de choix avec images, admin_choix_cosmetiques.js).

let exclusifsKoyns = [];
let tirageKoyns = []; // cosmétiques focus du tirage (config.cosmetiques_tirage)
let donCosmetiques = []; // cosmétiques du don en cours
let bonusCosmetique = null; // cosmétique du bonus de connexion

function messageKoyns(id, texte, type = "") {
  const message = document.getElementById(id);
  message.textContent = texte;
  message.className = `message-ajout ${type}`;
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

function htmlListeCosmetiques(liste, vide) {
  return liste.length ? liste.map(htmlPastilleCosmetique).join("") : `<span class="aide-apercu">${vide}</span>`;
}

function rendreDon() {
  document.getElementById("don-cosmetiques").innerHTML = htmlListeCosmetiques(donCosmetiques, "Aucun cosmétique.");
}

function rendreBonusCosmetique() {
  document.getElementById("bonus-cosmetique").innerHTML = htmlListeCosmetiques(bonusCosmetique ? [bonusCosmetique] : [], "Aucun cosmétique.");
}

function rendreExclusifs() {
  document.getElementById("liste-exclusifs").innerHTML = htmlListeCosmetiques(exclusifsKoyns, "Aucun cosmétique exclusif pour l'instant.");
}

function rendreTirage() {
  document.getElementById("liste-tirage").innerHTML = htmlListeCosmetiques(tirageKoyns, "Aucun cosmétique focus : les tirages ne donnent que des cosmétiques normaux.");
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
  bonusCosmetique = bonus?.cosmetique || null;
  rendreBonusCosmetique();
  document.getElementById("supprimer-bonus").disabled = !bonus;
}

async function ouvrirKoyns() {
  document.getElementById("modal-koyns").classList.add("active");
  // Catalogue (noms et miniatures des pastilles) chargé avant le rendu.
  const [config] = await Promise.all([chargerPointsAdmin(), chargerCatalogueChoix().catch(() => null), chargerJoueursKoyns()]);
  rendreDon();
  exclusifsKoyns = Array.isArray(config?.cosmetiques_exclusifs) ? [...config.cosmetiques_exclusifs] : [];
  rendreExclusifs();
  tirageKoyns = Array.isArray(config?.cosmetiques_tirage) ? [...config.cosmetiques_tirage] : [];
  rendreTirage();
  remplirBonus(config?.bonus_connexion);
}

async function donnerKoyns() {
  const discordId = document.getElementById("don-joueur").value;
  const koyns = Number(document.getElementById("don-koyns").value || 0);
  const cosmetiques = [...donCosmetiques];
  if (!discordId) return messageKoyns("message-don", "Choisis un joueur.", "erreur");
  try {
    // Pas envoyerAjout : la réponse n'est pas la config.
    const reponse = await fetch("/api/points", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ don: { discord_id: discordId, koyns, cosmetiques } })
    });
    const donnees = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(donnees.error || "Erreur d'enregistrement.");
    messageKoyns("message-don", "Envoyé.", "succes");
    document.getElementById("don-koyns").value = "";
    donCosmetiques = [];
    rendreDon();
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

async function enregistrerTirage(liste) {
  try {
    const config = await envoyerAjout({ cosmetiques_tirage: liste });
    tirageKoyns = config.cosmetiques_tirage || [];
    rendreTirage();
    messageKoyns("message-tirage", "Enregistré.", "succes");
  } catch (erreur) {
    console.error(erreur);
    messageKoyns("message-tirage", erreur.message, "erreur");
  }
}

async function enregistrerBonus(supprimer = false) {
  const champ = id => document.getElementById(id).value;
  // Champs datetime-local : heure locale de l'administrateur.
  const bonus = supprimer ? null : {
    debut: champ("bonus-debut") && new Date(champ("bonus-debut")).toISOString(),
    fin: champ("bonus-fin") && new Date(champ("bonus-fin")).toISOString(),
    koyns: Number(champ("bonus-koyns") || 0),
    cosmetique: bonusCosmetique
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
  // Fenêtres de choix (images) : la sélection actuelle est cochée,
  // valider la remplace (ajouts et retraits en une fois).
  document.getElementById("choisir-don").addEventListener("click", async () => {
    const choix = await choisirCosmetiques({ titre: "Cosmétiques à donner", selection: donCosmetiques });
    if (!choix) return;
    donCosmetiques = choix;
    rendreDon();
  });
  document.getElementById("don-cosmetiques").addEventListener("click", event => {
    const bouton = event.target.closest(".retirer-exclusif");
    if (!bouton) return;
    donCosmetiques = donCosmetiques.filter(id => id !== bouton.dataset.id);
    rendreDon();
  });
  document.getElementById("choisir-bonus").addEventListener("click", async () => {
    const choix = await choisirCosmetiques({ titre: "Cosmétique du bonus de connexion", multiple: false });
    if (!choix) return;
    bonusCosmetique = choix[0];
    rendreBonusCosmetique();
  });
  document.getElementById("bonus-cosmetique").addEventListener("click", event => {
    if (!event.target.closest(".retirer-exclusif")) return;
    bonusCosmetique = null;
    rendreBonusCosmetique();
  });
  document.getElementById("ajouter-exclusif").addEventListener("click", async () => {
    const choix = await choisirCosmetiques({ titre: "Cosmétiques exclusifs", selection: exclusifsKoyns });
    if (choix) enregistrerExclusifs(choix);
  });
  document.getElementById("liste-exclusifs").addEventListener("click", event => {
    const bouton = event.target.closest(".retirer-exclusif");
    if (bouton) enregistrerExclusifs(exclusifsKoyns.filter(id => id !== bouton.dataset.id));
  });
  document.getElementById("ajouter-tirage").addEventListener("click", async () => {
    const choix = await choisirCosmetiques({ titre: "Cosmétiques focus du tirage", selection: tirageKoyns });
    if (choix) enregistrerTirage(choix);
  });
  document.getElementById("liste-tirage").addEventListener("click", event => {
    const bouton = event.target.closest(".retirer-exclusif");
    if (bouton) enregistrerTirage(tirageKoyns.filter(id => id !== bouton.dataset.id));
  });
  document.getElementById("enregistrer-bonus").addEventListener("click", () => enregistrerBonus());
  document.getElementById("supprimer-bonus").addEventListener("click", () => enregistrerBonus(true));
}

initialiserKoyns();
