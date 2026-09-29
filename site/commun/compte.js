// Bouton du compte (deuxième bannière, photo, pseudo) en haut à droite des
// pages, lien vers Mon compte ; bouton de connexion Discord si l'utilisateur
// n'est pas connecté. Pas sur Mon compte (menu du compte propre) ni dans les
// rooms de match.
//
// Placé dans #zone-compte si la page en a un (accueil), sinon dans une zone
// ajoutée en haut à droite de la page. À inclure avec defer, après fond.js.
(async function () {
  let zone = document.getElementById("zone-compte");
  if (!zone) {
    zone = document.createElement("div");
    zone.id = "zone-compte";
    zone.className = "zone-compte flottante";
    document.body.prepend(zone);
  }

  try {
    const reponse = await fetch("/api/auth/me", { credentials: "include" });

    if (reponse.ok) {
      const { user } = await reponse.json();
      const nom = user.global_name || user.username || "Mon compte";

      // Accès réservés aux administrateurs (ex. carte Administration de
      // l'accueil).
      if (user.admin) {
        document.querySelectorAll(".carte-admin").forEach(carte => { carte.hidden = false; });
      }

      const lien = document.createElement("a");
      lien.className = "compte-lien";
      lien.href = "/my_account/my_account.html";
      lien.title = "Mon compte";
      if (user.avatar) {
        const avatar = document.createElement("img");
        avatar.src = user.avatar;
        avatar.alt = "";
        lien.appendChild(avatar);
      }
      const texte = document.createElement("span");
      texte.textContent = nom;
      lien.appendChild(texte);
      zone.appendChild(lien);

      // Deuxième bannière en fond du bouton (cf. commun/fond.js).
      window.FondEcran?.appliquerBanniere2(lien, window.FondEcran.banniere2());
      document.addEventListener("banniere2-change", event => {
        window.FondEcran.appliquerBanniere2(lien, event.detail);
      });
      return;
    }
  } catch (erreur) {
    console.error(erreur);
  }

  const connexion = document.createElement("a");
  connexion.className = "compte-connexion";
  connexion.href = "/api/auth/discord/login";
  connexion.textContent = "Connexion Discord";
  zone.appendChild(connexion);
})();
