document.getElementById("creer-room").addEventListener("click", async () => {
  try {
    const reponse = await fetch("/api/rooms", {
      method: "POST",
      credentials: "include"
    });

    if (reponse.status === 401) {
      alert("Tu dois être connecté avec Discord pour créer un match.");
      return;
    }

    if (!reponse.ok) {
      throw new Error("Échec de la création de la room.");
    }

    const data = await reponse.json();

    window.location.href = `match.html?room=${data.room_id}`;
  } catch (error) {
    console.error(error);
    alert("Erreur lors de la création du match.");
  }
});