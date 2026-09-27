// Fond d'écran choisi dans Mon compte (profil.parametres.fond), appliqué sur
// toutes les pages du site sauf les rooms de match. Garde aussi la deuxième
// bannière (profil.parametres.banniere2), affichée dans le bouton du compte
// (classe .avec-banniere2, cf. appliquerBanniere2).
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
  const CLE_BANNIERE2 = "banniere2-url";
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

    /* Bouton du compte avec la deuxième bannière (format 1000x137) en
       fond, assombrie à gauche pour garder la photo et le nom lisibles. */
    .avec-banniere2 {
      box-sizing: border-box;
      width: 420px;
      max-width: calc(100vw - 110px);
      aspect-ratio: 1000 / 137;
      /* Sur téléphone, la bannière est recadrée plutôt que d'écraser la photo. */
      min-height: 50px;
      border-radius: 12px;
      justify-content: flex-start;
      background-image:
        linear-gradient(90deg, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.1) 70%),
        var(--banniere2);
      background-size: cover;
      background-position: center;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
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

  // banniere2 : undefined = inchangée.
  function memoriser(url, banniere2) {
    ecrire(CLE_URL, url);
    ecrire(CLE_DATE, String(Date.now()));
    if (banniere2 !== undefined) {
      ecrire(CLE_BANNIERE2, banniere2);
      document.dispatchEvent(new CustomEvent("banniere2-change", { detail: banniere2 }));
    }
  }

  // Pose (ou retire) la deuxième bannière dans un bouton de compte.
  function appliquerBanniere2(element, url) {
    element.classList.toggle("avec-banniere2", !!url);
    if (url) element.style.setProperty("--banniere2", `url("${url}")`);
    else element.style.removeProperty("--banniere2");
  }

  async function rafraichir() {
    try {
      const reponse = await fetch("/api/auth/profile", { credentials: "include" });
      if (!reponse.ok) {
        // Non connecté : pas de fond personnalisé.
        if (reponse.status === 401) {
          appliquer(null);
          memoriser(null, null);
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

      const cheminBanniere2 = profil?.parametres?.banniere2;
      const banniere2 = cheminBanniere2 ? encodeURI(`/DB/images/${cheminBanniere2}`) : null;

      appliquer(url);
      memoriser(url, banniere2);
    } catch (erreur) {
      console.error(erreur);
    }
  }

  appliquer(lire(CLE_URL));

  const age = Date.now() - Number(lire(CLE_DATE) || 0);
  if (!sansRequete && age > DUREE_CACHE_MS) {
    rafraichir();
  }

  // memoriser : utilisé par Mon compte après l'enregistrement des paramètres.
  // Bouton du compte : FondEcran.appliquerBanniere2(bouton, FondEcran.banniere2())
  // puis écoute de l'événement "banniere2-change" (rafraîchissement).
  window.FondEcran = {
    memoriser,
    appliquerBanniere2,
    banniere2: () => lire(CLE_BANNIERE2)
  };
})();
