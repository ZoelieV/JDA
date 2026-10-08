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
//
// Fond personnel (profil.parametres.fond = "perso") : image importée par le
// joueur, gardée seulement dans ce navigateur (IndexedDB), jamais envoyée au
// serveur. Le cache garde alors le marqueur "perso" au lieu d'une URL. Sur un
// appareil où l'image n'a pas été importée : fond par défaut.
(function () {
  const CLE_URL = "fond-ecran-url";
  const CLE_DATE = "fond-ecran-date";
  const CLE_BANNIERE2 = "banniere2-url";
  // Palier de théâtre du joueur connecté ("6".."12", "" si non renseigné) :
  // médaille dans le bouton du compte (cf. appliquerMedaille).
  const CLE_THEATRE = "theatre-palier";
  const PALIERS_THEATRE = { 1: 6, 2: 8, 3: 10, 4: 12 };

  // Choix par défaut (profil sans choix, ou visiteur non connecté pour le fond).
  const FOND_DEFAUT_ID = "bg/autres/default_bg.webp";
  const FOND_DEFAUT_URL = "/DB/images/bg_web/autres/default_bg.webp";
  const BANNIERE2_DEFAUT = "namecards/banners/Namecard_Banner_Default.webp";
  const DUREE_CACHE_MS = 10 * 60 * 1000;
  const FOND_PERSO = "perso";
  const BASE_PERSO = "bpuc-fond-perso";
  const TABLE_PERSO = "images";
  const CLE_IMAGE_PERSO = "fond";
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

  // ---- Image du fond personnel (IndexedDB) ----

  function ouvrirBasePerso() {
    return new Promise((resoudre, rejeter) => {
      const demande = indexedDB.open(BASE_PERSO, 1);
      demande.onupgradeneeded = () => demande.result.createObjectStore(TABLE_PERSO);
      demande.onsuccess = () => resoudre(demande.result);
      demande.onerror = () => rejeter(demande.error);
    });
  }

  async function transactionPerso(mode, action) {
    const base = await ouvrirBasePerso();
    return new Promise((resoudre, rejeter) => {
      const transaction = base.transaction(TABLE_PERSO, mode);
      const demande = action(transaction.objectStore(TABLE_PERSO));
      transaction.oncomplete = () => { base.close(); resoudre(demande.result); };
      transaction.onerror = transaction.onabort = () => { base.close(); rejeter(transaction.error); };
    });
  }

  // Blob de l'image, ou null (aucune, ou stockage indisponible).
  async function lireImagePerso() {
    try {
      const image = await transactionPerso("readonly", table => table.get(CLE_IMAGE_PERSO));
      return image instanceof Blob ? image : null;
    } catch {
      return null;
    }
  }

  let promesseUrlPerso = null;

  // URL (blob:) de l'image, ou null ; créée une fois par page.
  function urlPerso() {
    promesseUrlPerso ??= lireImagePerso().then(image => image ? URL.createObjectURL(image) : null);
    return promesseUrlPerso;
  }

  // image : Blob à garder, ou null pour la supprimer.
  async function enregistrerImagePerso(image) {
    await transactionPerso("readwrite", table => image ? table.put(image, CLE_IMAGE_PERSO) : table.delete(CLE_IMAGE_PERSO));
    promesseUrlPerso = null;
  }

  // Dernier appel d'appliquer : un fond perso lu après coup ne remplace pas
  // un fond appliqué entre-temps.
  let numeroApplication = 0;

  // url : URL d'image, FOND_PERSO ou null (aucun fond).
  function appliquer(url) {
    const numero = ++numeroApplication;
    const style = document.documentElement.style;
    if (url !== FOND_PERSO) {
      style.setProperty("--fond-ecran", url ? `url("${url}")` : "none");
      return;
    }
    style.setProperty("--fond-ecran", "none");
    urlPerso().then(urlImage => {
      if (numero === numeroApplication) style.setProperty("--fond-ecran", `url("${urlImage || FOND_DEFAUT_URL}")`);
    });
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

  // Théâtre du profil ("1".."4", cf. menu "Théâtre clear" de Mon compte).
  function memoriserTheatre(theatreProfil) {
    const palier = PALIERS_THEATRE[theatreProfil] ? String(PALIERS_THEATRE[theatreProfil]) : "";
    ecrire(CLE_THEATRE, palier);
    document.dispatchEvent(new CustomEvent("theatre-change", { detail: palier }));
  }

  // Pose (ou retire) la médaille du théâtre dans un bouton de compte, après
  // le pseudo (même rendu que htmlMedailleTheatre, commun/cartes.js ; style
  // .medaille-theatre dans commun/entete.css).
  function appliquerMedaille(element, palier) {
    let medaille = element.querySelector(".medaille-theatre");
    if (!palier) {
      medaille?.remove();
      return;
    }
    if (!medaille) {
      medaille = document.createElement("img");
      medaille.className = "medaille-theatre";
      const pseudo = element.querySelector("span");
      if (pseudo) pseudo.after(medaille);
      else element.appendChild(medaille);
    }
    medaille.src = `/DB/images/others/Imaginarium_Theater_Medal_${palier}.webp`;
    medaille.alt = `Théâtre ${palier}`;
    medaille.title = `Théâtre ${palier}`;
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
          memoriserTheatre(null);
        }
        return;
      }

      const { profil } = await reponse.json();
      const idFond = profil?.parametres?.fond || FOND_DEFAUT_ID;
      let url = FOND_DEFAUT_URL;

      if (idFond === FOND_PERSO) {
        url = FOND_PERSO;
      } else if (idFond !== FOND_DEFAUT_ID) {
        const cosmetiques = await (await fetch("/DB/images/cosmetiques.json")).json();
        const fond = cosmetiques.fonds.find(f => f.id === idFond);
        if (fond) url = encodeURI(`/DB/images/${fond.image}`);
      }

      const cheminBanniere2 = profil?.parametres?.banniere2 || BANNIERE2_DEFAUT;
      const banniere2 = encodeURI(`/DB/images/${cheminBanniere2}`);

      appliquer(url);
      memoriser(url, banniere2);
      memoriserTheatre(profil?.theatre);
    } catch (erreur) {
      console.error(erreur);
    }
  }

  appliquer(lire(CLE_URL) || FOND_DEFAUT_URL);

  // Revérifié si trop ancien, ou si le théâtre n'a jamais été gardé (cache
  // d'avant la médaille).
  const age = Date.now() - Number(lire(CLE_DATE) || 0);
  if (!sansRequete && (age > DUREE_CACHE_MS || lire(CLE_THEATRE) === null)) {
    rafraichir();
  }

  // memoriser : utilisé par Mon compte après l'enregistrement des paramètres
  // (url : URL d'image, FOND_PERSO ou null). appliquer : même chose sur la
  // page. Fond personnel : FOND_PERSO, urlPerso, lireImagePerso,
  // enregistrerImagePerso (fenêtre de personnalisation, Mon compte).
  // Bouton du compte : FondEcran.appliquerBanniere2(bouton, FondEcran.banniere2())
  // puis écoute de l'événement "banniere2-change" (rafraîchissement).
  // Médaille : FondEcran.appliquerMedaille(bouton, FondEcran.theatre()) puis
  // écoute de "theatre-change" ; memoriserTheatre : Mon compte, après
  // l'enregistrement du théâtre.
  window.FondEcran = {
    memoriser,
    appliquer,
    FOND_PERSO,
    urlPerso,
    lireImagePerso,
    enregistrerImagePerso,
    appliquerBanniere2,
    banniere2: () => lire(CLE_BANNIERE2) || encodeURI(`/DB/images/${BANNIERE2_DEFAUT}`),
    memoriserTheatre,
    appliquerMedaille,
    theatre: () => lire(CLE_THEATRE) || ""
  };
})();
