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

  // Choix par défaut (profil sans choix, ou visiteur non connecté pour le fond).
  const FOND_DEFAUT_ID = "bg/autres/default_bg.webp";
  const FOND_DEFAUT_URL = "/DB/images/bg_web/autres/default_bg.webp";
  const BANNIERE2_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";
  const DUREE_CACHE_MS = 10 * 60 * 1000;
  const sansRequete = document.currentScript?.hasAttribute("data-sans-requete");

  // Styles du fond (calque fixe body::before) et du bouton du compte
  // (.avec-banniere2) : commun/entete.css.

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
        // Non connecté : fond par défaut.
        if (reponse.status === 401) {
          appliquer(FOND_DEFAUT_URL);
          memoriser(FOND_DEFAUT_URL, null);
        }
        return;
      }

      const { profil } = await reponse.json();
      const idFond = profil?.parametres?.fond || FOND_DEFAUT_ID;
      let url = FOND_DEFAUT_URL;

      if (idFond !== FOND_DEFAUT_ID) {
        const cosmetiques = await (await fetch("/DB/images/cosmetiques.json")).json();
        const fond = cosmetiques.fonds.find(f => f.id === idFond);
        if (fond) url = encodeURI(`/DB/images/${fond.image}`);
      }

      const cheminBanniere2 = profil?.parametres?.banniere2 || BANNIERE2_DEFAUT;
      const banniere2 = encodeURI(`/DB/images/${cheminBanniere2}`);

      appliquer(url);
      memoriser(url, banniere2);
    } catch (erreur) {
      console.error(erreur);
    }
  }

  appliquer(lire(CLE_URL) || FOND_DEFAUT_URL);

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
    banniere2: () => lire(CLE_BANNIERE2) || encodeURI(`/DB/images/${BANNIERE2_DEFAUT}`)
  };
})();
