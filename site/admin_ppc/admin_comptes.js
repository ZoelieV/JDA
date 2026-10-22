// Administration : comptes des joueurs (bouton Comptes). UID, lien de
// stream et niveau du monde, que les joueurs ne renseignent qu'une fois
// (cf. erreurChampsDefinitifs, api/auth/profile.js). PUT
// /api/accounts/<discord_id> (cf. modifierCompte) : administrateurs et mini
// admins (pas verrouillé par la lecture seule des mini admins).

function messageCompte(texte, type = "") {
  const message = document.getElementById("message-compte");
  message.textContent = texte;
  message.className = `message-ajout${type ? ` ${type}` : ""}`;
}

async function chargerListeComptes() {
  const reponse = await fetch("/api/accounts", { credentials: "include" });
  const comptes = reponse.ok ? await reponse.json() : [];
  document.getElementById("compte-joueur").innerHTML = `<option value="">Choisir un joueur…</option>` + comptes
    .map(c => ({ id: c.discord_id, nom: c.discord_global_name || c.discord_username || c.discord_id, pseudo: c.discord_username }))
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }))
    .map(c => `<option value="${echapper(c.id)}">${echapper(c.nom)}${c.pseudo && c.pseudo !== c.nom ? ` (@${echapper(c.pseudo)})` : ""}</option>`).join("");
}

async function afficherCompte(discordId) {
  const champs = document.getElementById("champs-compte");
  champs.classList.add("cache");
  messageCompte("");
  if (!discordId) return;
  messageCompte("Chargement…");
  try {
    const reponse = await fetch(`/api/accounts/${encodeURIComponent(discordId)}`, { credentials: "include", cache: "no-store" });
    if (!reponse.ok) throw new Error("Profil introuvable.");
    const data = (await reponse.json()).data || {};
    document.getElementById("compte-uid").value = data.uid || "";
    document.getElementById("compte-niveau").value = data.niveau_monde || "";
    document.getElementById("compte-stream").value = data.stream || "";
    champs.classList.remove("cache");
    messageCompte(data.niveau_monde_max && String(data.niveau_monde_max) !== String(data.niveau_monde)
      ? `Plus haut niveau du monde enregistré : ${data.niveau_monde_max}.` : "");
  } catch (erreur) {
    console.error(erreur);
    messageCompte(erreur.message, "erreur");
  }
}

async function enregistrerCompteJoueur() {
  const discordId = document.getElementById("compte-joueur").value;
  if (!discordId) return;
  const bouton = document.getElementById("enregistrer-compte-joueur");
  bouton.disabled = true;
  messageCompte("Enregistrement…");
  try {
    const reponse = await fetch(`/api/accounts/${encodeURIComponent(discordId)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: document.getElementById("compte-uid").value,
        stream: document.getElementById("compte-stream").value,
        niveau_monde: document.getElementById("compte-niveau").value
      })
    });
    const resultat = await reponse.json().catch(() => ({}));
    if (!reponse.ok) throw new Error(resultat.error || "Erreur d'enregistrement.");
    // Valeurs telles qu'enregistrées (lien complété en https://...).
    document.getElementById("compte-stream").value = resultat.stream || "";
    messageCompte("Compte modifié.", "succes");
  } catch (erreur) {
    console.error(erreur);
    messageCompte(erreur.message, "erreur");
  }
  bouton.disabled = false;
}

function initialiserComptes() {
  const modal = document.getElementById("modal-comptes");
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-comptes").addEventListener("click", () => {
    modal.classList.add("active");
    if (document.getElementById("compte-joueur").options.length <= 1) {
      chargerListeComptes().catch(erreur => {
        console.error(erreur);
        messageCompte("Impossible de charger les joueurs.", "erreur");
      });
    }
  });
  document.getElementById("fermer-comptes").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  document.getElementById("compte-joueur").addEventListener("change", event => afficherCompte(event.target.value));
  document.getElementById("enregistrer-compte-joueur").addEventListener("click", enregistrerCompteJoueur);
}

initialiserComptes();
