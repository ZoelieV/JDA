// Administration : tuile Tutoriel. Lance le tutoriel pour l'admin seul
// (commun/tutoriel.js) : progression gardée dans ce navigateur, rien au serveur.

document.getElementById("lancer-tutoriel").addEventListener("click", () => {
  try {
    localStorage.setItem("tutoriel-test", "0");
    window.location.href = "/";
  } catch {
    alert("Stockage du navigateur bloqué : impossible de lancer le tutoriel.");
  }
});
