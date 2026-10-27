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
  // Palier de théâtre du joueur connecté ("1".."4", "" si non renseigné) :
  // médaille dans le bouton du compte (cf. appliquerMedaille). Nouvelle clé
  // depuis les paliers sardine..baleine (l'ancienne gardait "6".."12").
  const CLE_THEATRE = "theatre-palier-2";
  // Trophées de la saison en cours du joueur connecté ("" sans match
  // classé) : rang dans le bouton du compte (cf. appliquerRang).
  const CLE_TROPHEES = "trophees-saison";
  // Affichage de l'accueil (profil.parametres.accueil) : "panneau" ou
  // "cartes" gardé, rien pour "classique" (par défaut, aussi pour les
  // visiteurs). Posé sur <html data-accueil> dès le <head> (pas de
  // clignotement, cf. accueil.js). Nouvelle clé depuis le renommage des
  // affichages (l'ancienne gardait "test", "classique" pour la grille).
  const CLE_ACCUEIL = "accueil-affichage-2";
  const AFFICHAGES_ACCUEIL = ["classique", "panneau", "cartes"];
  const affichageAccueil = valeur => AFFICHAGES_ACCUEIL.includes(valeur) ? valeur : "classique";
  // Palier -> nom et icône (mêmes que PALIERS_THEATRE et urlMedailleTheatre,
  // commun/cartes.js, pas chargé sur toutes les pages : rien n'en est utilisé
  // ici).
  const PALIERS_THEATRE = {
    1: { nom: "Sardine", icone: "sardine" },
    2: { nom: "Carpe", icone: "carpe" },
    3: { nom: "Dauphin", icone: "dauphin" },
    4: { nom: "Baleine", icone: "baleine" }
  };
  // Rangs du classé selon les trophées de la saison : chaque rang a 3
  // niveaux (3, puis 2, puis 1) d'une même largeur (bronze 50 trophées,
  // argent 60, or 70, platine 80, diamant 100), à partir de 0 ; Archon à
  // 1000 trophées, sans niveaux. Icônes : DB/images/others/<icone>.webp.
  // Utilisé aussi par commun/cartes.js (htmlRangTrophees).
  const RANGS_TROPHEES = [
    { nom: "Bronze", icone: "bronze", largeur: 50 },
    { nom: "Argent", icone: "argent", largeur: 60 },
    { nom: "Or", icone: "or", largeur: 70 },
    { nom: "Platine", icone: "platine", largeur: 80 },
    { nom: "Diamant", icone: "diamand", largeur: 100 }
  ];
  const SEUIL_ARCHON = 1000;

  // Trophées -> { nom ("Or 2", "Archon"), icone, niveau (1..3, null pour
  // Archon) }, ou null (pas de trophées : aucun match classé).
  function rangTrophees(trophees) {
    if (trophees === null || trophees === undefined || trophees === "" || !Number.isFinite(Number(trophees))) return null;
    const total = Math.max(0, Number(trophees));
    if (total >= SEUIL_ARCHON) return { nom: "Archon", icone: "archon", niveau: null };
    let debut = 0;
    for (const rang of RANGS_TROPHEES) {
      const fin = debut + 3 * rang.largeur;
      if (total < fin) {
        const niveau = 3 - Math.floor((total - debut) / rang.largeur);
        return { nom: `${rang.nom} ${niveau}`, icone: rang.icone, niveau };
      }
      debut = fin;
    }
    // Entre la fin du diamant 1 et l'Archon : diamant 1.
    const diamant = RANGS_TROPHEES[RANGS_TROPHEES.length - 1];
    return { nom: `${diamant.nom} 1`, icone: diamant.icone, niveau: 1 };
  }

  // Icône du rang (image + niveau en pastille), ou null.
  function creerRang(trophees) {
    const rang = rangTrophees(trophees);
    if (!rang) return null;
    const bloc = document.createElement("span");
    bloc.className = "rang-trophees";
    bloc.title = `${rang.nom} (${Math.max(0, Number(trophees))} trophées)`;
    const image = document.createElement("img");
    image.src = `/DB/images/others/${rang.icone}.webp`;
    image.alt = rang.nom;
    bloc.appendChild(image);
    if (rang.niveau) {
      const niveau = document.createElement("span");
      niveau.className = "niveau-rang";
      niveau.textContent = String(rang.niveau);
      bloc.appendChild(niveau);
    }
    return bloc;
  }

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

  // Palier de théâtre du profil ("1".."4", calculé par le serveur sur la
  // full box, cf. palierTheatre dans api/_lib/personnages.js).
  function memoriserTheatre(theatreProfil) {
    const palier = PALIERS_THEATRE[theatreProfil] ? String(theatreProfil) : "";
    ecrire(CLE_THEATRE, palier);
    document.dispatchEvent(new CustomEvent("theatre-change", { detail: palier }));
  }

  // Trophées de la saison du profil (nombre, ou null sans match classé).
  function memoriserTrophees(trophees) {
    const valeur = trophees === null || trophees === undefined ? "" : String(trophees);
    ecrire(CLE_TROPHEES, valeur);
    document.dispatchEvent(new CustomEvent("trophees-change", { detail: valeur }));
  }

  // Pose (ou retire) le rang dans un bouton de compte, entre le pseudo et
  // la médaille du théâtre (la médaille reste la plus loin de la photo).
  function appliquerRang(element, trophees) {
    element.querySelector(".rang-trophees")?.remove();
    const rang = creerRang(trophees);
    if (!rang) return;
    const medaille = element.querySelector(".medaille-theatre");
    const pseudo = element.querySelector("span");
    if (medaille) medaille.before(rang);
    else if (pseudo) pseudo.after(rang);
    else element.appendChild(rang);
  }

  // Pose (ou retire) la médaille du théâtre dans un bouton de compte, après
  // le pseudo et le rang (même rendu que htmlMedailleTheatre, commun/cartes.js ; style
  // .medaille-theatre dans commun/entete.css).
  function appliquerMedaille(element, palier) {
    let medaille = element.querySelector(".medaille-theatre");
    const infos = PALIERS_THEATRE[palier];
    if (!infos) {
      medaille?.remove();
      return;
    }
    if (!medaille) {
      medaille = document.createElement("img");
      medaille.className = "medaille-theatre";
      const avant = element.querySelector(".rang-trophees") || element.querySelector("span");
      if (avant) avant.after(medaille);
      else element.appendChild(medaille);
    }
    medaille.src = `/DB/images/others/theatre_${infos.icone}.webp?v=3`;
    medaille.alt = infos.nom;
    medaille.title = infos.nom;
  }

  // Pose (ou retire) la deuxième bannière dans un bouton de compte.
  function memoriserAccueil(valeur) {
    const affichage = affichageAccueil(valeur);
    ecrire(CLE_ACCUEIL, affichage === "classique" ? null : affichage);
    if (document.documentElement.dataset.accueil === affichage) return;
    document.documentElement.dataset.accueil = affichage;
    document.dispatchEvent(new CustomEvent("accueil-change"));
  }

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
          memoriserAccueil(null);
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
      memoriserTrophees(profil?.trophees);
      memoriserAccueil(profil?.parametres?.accueil);
    } catch (erreur) {
      console.error(erreur);
    }
  }

  appliquer(lire(CLE_URL) || FOND_DEFAUT_URL);
  document.documentElement.dataset.accueil = affichageAccueil(lire(CLE_ACCUEIL));

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
    // Affichage de l'accueil : après l'enregistrement de la personnalisation
    // (événement "accueil-change" si l'affichage change).
    memoriserAccueil,
    appliquerMedaille,
    theatre: () => lire(CLE_THEATRE) || "",
    // Rang : FondEcran.appliquerRang(bouton, FondEcran.trophees()) puis
    // écoute de "trophees-change" ; rangTrophees et creerRang aussi pour
    // les bannières des autres joueurs (cf. htmlRangTrophees, cartes.js).
    memoriserTrophees,
    appliquerRang,
    trophees: () => lire(CLE_TROPHEES) || "",
    rangTrophees,
    creerRang
  };
})();
