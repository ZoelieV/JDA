// Accueil : compte Discord en haut à droite (lien vers Mon compte), ou
// bouton de connexion si l'utilisateur n'est pas connecté.
async function afficherCompte() {
  const zone = document.getElementById("accueil-compte");

  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });

    if (reponse.ok) {
      const { user } = await reponse.json();
      const nom = user.global_name || user.username || "Mon compte";

      const lien = document.createElement("a");
      lien.className = "accueil-compte";
      lien.href = "my_account/my_account.html";
      lien.title = "Mon compte";
      if (user.avatar) {
        const avatar = document.createElement("img");
        avatar.src = user.avatar;
        avatar.alt = "";
        lien.appendChild(avatar);
      }
      lien.appendChild(document.createTextNode(nom));
      zone.appendChild(lien);
      return;
    }
  } catch (erreur) {
    console.error(erreur);
  }

  const connexion = document.createElement("a");
  connexion.className = "accueil-connexion";
  connexion.href = "/api/auth/discord/login";
  connexion.textContent = "Connexion Discord";
  zone.appendChild(connexion);
}

afficherCompte();
