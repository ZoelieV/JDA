// Créer un match : room privée (lien partagé, théâtre au choix),
// matchmaking ou classé (adversaire trouvé automatiquement dans le même
// mode, classique ou mêlée générale ; cf. api/_lib/matchmaking.js), tous
// via api/rooms. On arrive ensuite sur la page du match (attente de
// l'adversaire).

async function creerMatch(corps) {
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps)
    });

    if (reponse.status === 401) {
      alert("Tu dois être connecté avec Discord pour créer un match.");
      return;
    }

    // Mode classique / auto sans théâtre renseigné (message du serveur).
    if (reponse.status === 409) {
      const { error } = await reponse.json().catch(() => ({}));
      alert(error || "Impossible de lancer ce mode.");
      return;
    }

    // Match privé : une room par minute au maximum (message du serveur).
    if (reponse.status === 429) {
      const { error } = await reponse.json().catch(() => ({}));
      alert(error || "Trop de rooms créées : réessaie dans une minute.");
      return;
    }

    if (!reponse.ok) {
      throw new Error("Échec de la création du match.");
    }

    const data = await reponse.json();

    window.location.href = `match.html?room=${data.room_id}`;
  } catch (error) {
    console.error(error);
    alert("Erreur lors de la création du match.");
  }
}

// Bouton d'une carte : affiche (ou masque) ses modes de théâtre.
document.querySelectorAll(".ouvrir-modes").forEach(bouton => {
  bouton.addEventListener("click", () => {
    const modes = bouton.parentElement.querySelector(".modes-match");
    const ouvert = modes.classList.toggle("cache") === false;
    bouton.setAttribute("aria-expanded", String(ouvert));
  });
});

// Mode choisi : room privée (mode de théâtre au choix) ou recherche
// (matchmaking / classé : classique ou mêlée générale).
document.querySelectorAll(".mode-match").forEach(bouton => {
  bouton.addEventListener("click", () => {
    const type = bouton.closest(".modes-match").dataset.type;
    const mode = bouton.dataset.mode;
    creerMatch(type === "prive" ? { mode } : { type, mode });
  });
});
