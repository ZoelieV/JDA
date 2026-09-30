// Créer un match : match privé (room à lien partagé) ou matchmaking
// (adversaire trouvé automatiquement, api/_lib/matchmaking.js), tous deux
// via api/rooms. Dans les deux cas, on arrive sur la page du match
// (attente de l'adversaire).

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

document.getElementById("creer-prive").addEventListener("click", () => creerMatch({}));
document.getElementById("lancer-matchmaking").addEventListener("click", () => creerMatch({ type: "matchmaking" }));
