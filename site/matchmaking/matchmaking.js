// Créer un match : match privé (room à lien partagé, api/rooms) ou
// matchmaking (adversaire trouvé automatiquement, api/matchmaking.js). Dans
// les deux cas, on arrive sur la page du match (attente de l'adversaire).

async function creerMatch(url) {
  try {
    const reponse = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}"
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

document.getElementById("creer-prive").addEventListener("click", () => creerMatch("/api/rooms"));
document.getElementById("lancer-matchmaking").addEventListener("click", () => creerMatch("/api/matchmaking"));
