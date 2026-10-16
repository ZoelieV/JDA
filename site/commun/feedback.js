// Feedback (accueil) : bouton fixe en bas à gauche de l'écran ("Feedback"
// au-dessus de l'icône du courrier) qui ouvre une fenêtre pour écrire un
// commentaire aux administrateurs (page Administration, bouton Feedback).
// Joueur connecté seulement, TEXTE_MAX caractères au plus, sans lien, un
// par jour (reset à 4 h, heure de Paris) : vérifié par le serveur (cf. api/_lib/feedbacks.js),
// rappelé ici pour prévenir avant l'envoi.
// Styles : commun/feedback.css.
(function () {
  const API = "/api/matches?feedback=";
  let max = 1000;
  let connecte = false;
  let attenteJusqua = 0; // instant (ms) du prochain envoi possible

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "bouton-feedback";
  bouton.title = "Envoyer un feedback aux administrateurs";
  bouton.innerHTML = `<span class="bouton-feedback-texte">Feedback</span><img src="/DB/images/others/Icon_Mail.webp" alt="">`;

  const modal = document.createElement("div");
  modal.className = "modal-feedback";
  modal.innerHTML = `
    <div class="feedback-contenu" role="dialog" aria-modal="true" aria-labelledby="feedback-titre">
      <div class="feedback-entete">
        <h2 id="feedback-titre">Feedback</h2>
        <button type="button" class="feedback-fermer" aria-label="Fermer">×</button>
      </div>
      <p class="feedback-aide">Une idée, un bug, une remarque ? Ton message est lu par les administrateurs,
        avec ton pseudo et la date. Pas de lien, un feedback par jour (reset à 4 h).</p>
      <textarea class="feedback-texte" maxlength="1000" placeholder="Écris ton feedback…"></textarea>
      <div class="feedback-pied">
        <span class="feedback-compteur"></span>
        <span class="feedback-message" role="status"></span>
        <button type="button" class="feedback-envoyer">Envoyer</button>
      </div>
    </div>
  `;

  const zoneTexte = modal.querySelector(".feedback-texte");
  const compteur = modal.querySelector(".feedback-compteur");
  const message = modal.querySelector(".feedback-message");
  const envoyer = modal.querySelector(".feedback-envoyer");

  function afficherMessage(texte, type = "") {
    message.textContent = texte;
    message.className = `feedback-message${type ? ` ${type}` : ""}`;
  }

  function texteAttente(ms) {
    const heures = Math.floor(ms / 3600000);
    const minutes = Math.ceil((ms % 3600000) / 60000);
    if (heures === 0) return `${minutes} min`;
    if (minutes === 60) return `${heures + 1} h`;
    return minutes === 0 ? `${heures} h` : `${heures} h ${String(minutes).padStart(2, "0")}`;
  }

  // Compteur, état du bouton Envoyer et raison s'il est bloqué.
  function majEtat() {
    const longueur = Array.from(zoneTexte.value).length;
    compteur.textContent = `${longueur} / ${max}`;
    compteur.classList.toggle("trop", longueur > max);
    const attente = attenteJusqua - Date.now();
    zoneTexte.disabled = !connecte || attente > 0;
    envoyer.disabled = !connecte || attente > 0 || !zoneTexte.value.trim() || longueur > max;
    if (!connecte) afficherMessage("Connecte-toi avec Discord pour envoyer un feedback.");
    else if (attente > 0) afficherMessage(`Prochain feedback possible dans ${texteAttente(attente)}.`);
    else if (message.classList.contains("succes") || !message.classList.contains("erreur")) afficherMessage("");
  }

  async function chargerEtat() {
    try {
      const reponse = await fetch(`${API}etat`, { credentials: "include", cache: "no-store" });
      const data = await reponse.json();
      if (!reponse.ok) throw new Error(data.error || "Erreur");
      connecte = data.connecte === true;
      if (Number.isFinite(data.max)) max = data.max;
      zoneTexte.maxLength = max;
      attenteJusqua = Date.now() + (Number(data.attente) || 0);
    } catch (erreur) {
      console.error(erreur);
    }
    majEtat();
  }

  function ouvrir() {
    modal.classList.add("active");
    afficherMessage("");
    chargerEtat().then(() => { if (!zoneTexte.disabled) zoneTexte.focus(); });
  }

  function fermer() {
    modal.classList.remove("active");
  }

  envoyer.addEventListener("click", async () => {
    envoyer.disabled = true;
    afficherMessage("Envoi…");
    try {
      const reponse = await fetch(`${API}1`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texte: zoneTexte.value })
      });
      const data = await reponse.json().catch(() => ({}));
      if (reponse.status === 401) connecte = false;
      if (Number.isFinite(data.attente)) attenteJusqua = Date.now() + data.attente;
      if (!reponse.ok) {
        majEtat();
        afficherMessage(data.error || "Échec de l'envoi.", "erreur");
        envoyer.disabled = !zoneTexte.value.trim() || zoneTexte.disabled;
        return;
      }
      zoneTexte.value = "";
      majEtat();
      afficherMessage("Merci ! Ton feedback a été envoyé aux administrateurs.", "succes");
    } catch (erreur) {
      console.error(erreur);
      afficherMessage("Erreur lors de l'envoi.", "erreur");
      envoyer.disabled = false;
    }
  });

  zoneTexte.addEventListener("input", () => {
    if (message.classList.contains("erreur")) afficherMessage("");
    majEtat();
  });
  bouton.addEventListener("click", ouvrir);
  modal.querySelector(".feedback-fermer").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });

  function inserer() {
    document.body.append(bouton, modal);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", inserer);
  else inserer();
})();
