// Fond d'écran choisi dans Mon compte (profil.parametres.fond), appliqué sur
// toutes les pages du site sauf les rooms de match.
//
// À inclure dans le <head> : <script src="/commun/fond.js"></script>
//
// Pour éviter un appel API à chaque page, l'URL du fond est gardée en local
// (localStorage) : affichée immédiatement, puis revérifiée auprès du serveur
// au plus toutes les DUREE_CACHE_MS (changement fait depuis un autre appareil).
// Attribut data-sans-requete : affichage depuis le cache uniquement (page
// Mon compte, qui charge déjà le profil et met le cache à jour elle-même).
(function () {
  const CLE_URL = "fond-ecran-url";
  const CLE_DATE = "fond-ecran-date";
  const DUREE_CACHE_MS = 10 * 60 * 1000;
  const sansRequete = document.currentScript?.hasAttribute("data-sans-requete");

  // Calque fixe de la taille de l'écran : reste figé et centré au défilement,
  // y compris sur téléphone (background-attachment: fixed y est ignoré).
  const style = document.createElement("style");
  style.textContent = `
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -1;
      background-image: var(--fond-ecran, none);
      background-repeat: no-repeat;
      background-position: center;
      background-size: cover;
    }
  `;
  document.head.appendChild(style);

  function lire(cle) {
    try { return localStorage.getItem(cle); } catch { return null; }
  }

  function ecrire(cle, valeur) {
    try {
      if (valeur === null) localStorage.removeItem(cle);
      else localStorage.setItem(cle, valeur);
    } catch { /* stockage indisponible : on se passe du cache */ }
  }

  function appliquer(url) {
    document.documentElement.style.setProperty("--fond-ecran", url ? `url("${url}")` : "none");
  }

  function memoriser(url) {
    ecrire(CLE_URL, url);
    ecrire(CLE_DATE, String(Date.now()));
  }

  async function rafraichir() {
    try {
      const reponse = await fetch("/api/auth/profile", { credentials: "include" });
      if (!reponse.ok) {
        // Non connecté : pas de fond personnalisé.
        if (reponse.status === 401) {
          appliquer(null);
          memoriser(null);
        }
        return;
      }

      const { profil } = await reponse.json();
      const idFond = profil?.parametres?.fond;
      let url = null;

      if (idFond) {
        const cosmetiques = await (await fetch("/DB/images/cosmetiques.json")).json();
        const fond = cosmetiques.fonds.find(f => f.id === idFond);
        url = fond ? encodeURI(`/DB/images/${fond.image}`) : null;
      }

      appliquer(url);
      memoriser(url);
    } catch (erreur) {
      console.error(erreur);
    }
  }

  appliquer(lire(CLE_URL));

  const age = Date.now() - Number(lire(CLE_DATE) || 0);
  if (!sansRequete && age > DUREE_CACHE_MS) {
    rafraichir();
  }

  // Utilisé par Mon compte après l'enregistrement des paramètres.
  window.FondEcran = { memoriser };
})();
