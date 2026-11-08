// Lecteur du visual novel : affiche les panneaux envoyés par le serveur
// (cf. api/_lib/visual_novel.js) et lui demande la suite à chaque arrêt.
const chapitreVn = new URLSearchParams(location.search).get("chapitre");
const elementVn = id => document.getElementById(id);
// Passé par le bouton Tester de l'éditeur.
const panneauTestVn = new URLSearchParams(location.search).get("panneau");

let segmentVn = null;
let indexVn = 0;
let occupeVn = false;
// Sous-chapitres finis et en cours, envoyés par le serveur.
let sousChapitresVn = [];
// Ce que le joueur possède, envoyé par le serveur.
let inventaireVn = [];
let etatsVn = [];
// Chapitre déjà terminé : le joueur peut passer les dialogues.
let passableVn = false;

function afficherEcran(titre, texte, { recommencer = false, reprendre = false, point = false, liste = false, libelleReprendre = "Reprendre" } = {}) {
  elementVn("vn-ecran-titre").textContent = titre;
  elementVn("vn-ecran-texte").textContent = texte;
  elementVn("vn-recommencer").hidden = !recommencer;
  elementVn("vn-point").hidden = !point;
  elementVn("vn-reprendre").hidden = !reprendre;
  elementVn("vn-reprendre").textContent = libelleReprendre;
  elementVn("vn-de").hidden = true;
  elementVn("vn-ecran").classList.remove("vn-ecran-opaque");
  elementVn("vn-inventaire").hidden = true;
  remplirSousChapitres(liste);
  elementVn("vn-ecran").hidden = false;
}

// Liste de l'écran : "Refaire" seulement sur les sous-chapitres déjà finis.
function remplirSousChapitres(visible) {
  const liste = elementVn("vn-sous-chapitres");
  liste.hidden = !visible || !sousChapitresVn.length;
  liste.replaceChildren(...(visible ? sousChapitresVn : []).map(sc => {
    const ligne = document.createElement("li");
    const titre = document.createElement("span");
    titre.textContent = sc.titre;
    ligne.append(titre);
    if (sc.courant) {
      const etat = document.createElement("em");
      etat.textContent = "En cours";
      ligne.append(etat);
    }
    if (sc.fini) {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.className = "vn-bouton";
      bouton.textContent = "Refaire";
      bouton.addEventListener("click", () => appelerServeur({ action: "refaire", sous_chapitre: sc.id }));
      ligne.append(bouton);
    }
    return ligne;
  }));
}

function ouvrirMenuSousChapitres() {
  const aucunFini = !sousChapitresVn.some(sc => sc.fini);
  afficherEcran("Sous-chapitres", aucunFini
    ? "Termine ce sous-chapitre pour pouvoir le refaire."
    : "Refaire un sous-chapitre reprend l'histoire depuis son début : tu quittes ta position actuelle.", { reprendre: true, liste: true });
}

const signeVn = valeur => (valeur >= 0 ? `+${valeur}` : `−${Math.abs(valeur)}`);

function ouvrirInventaire() {
  afficherEcran("Inventaire", inventaireVn.length || etatsVn.length ? "" : "Tu n'as encore rien sur toi.", { reprendre: true });
  const lignes = [
    ...inventaireVn.map(objet => ({ nom: objet.quantite > 1 ? `${objet.nom} × ${objet.quantite}` : objet.nom, description: objet.description, image: objet.image })),
    ...etatsVn.map(etat => ({ nom: `${etat.nom} (${signeVn(etat.valeur)} aux dés)`, description: etat.description }))
  ];
  const liste = elementVn("vn-inventaire");
  liste.hidden = !lignes.length;
  liste.replaceChildren(...lignes.map(({ nom, description, image }) => {
    const ligne = document.createElement("li");
    if (image) {
      const vignette = document.createElement("img");
      vignette.src = imageVn(image);
      vignette.alt = "";
      ligne.append(vignette);
    }
    const textes = document.createElement("span");
    const titre = document.createElement("strong");
    titre.textContent = nom;
    textes.append(titre);
    if (description) textes.append(document.createElement("br"), description);
    ligne.append(textes);
    return ligne;
  }));
}

// ---- Musique et sons ----
// Le navigateur refuse le son avant un premier clic : on réessaie à ce moment-là.
const CLE_SON_COUPE = "vn_son_coupe";
let sonCoupeVn = false;
try { sonCoupeVn = localStorage.getItem(CLE_SON_COUPE) === "1"; } catch { /* stockage indisponible */ }
const musiqueVn = new Audio();
musiqueVn.loop = true;
// Volume du site (menu des paramètres des autres pages, cf. commun/volume.js).
VolumeSite.appliquer(musiqueVn);
let cheminMusiqueVn = null;
let musiqueEnAttenteVn = false;

function lancerMusique() {
  musiqueEnAttenteVn = false;
  if (!cheminMusiqueVn || sonCoupeVn) return musiqueVn.pause();
  musiqueVn.play().catch(() => { musiqueEnAttenteVn = true; });
}

function changerMusique(chemin) {
  const nouvelle = chemin === "stop" ? null : chemin;
  if (nouvelle === cheminMusiqueVn) return;
  cheminMusiqueVn = nouvelle;
  if (nouvelle) musiqueVn.src = imageVn(nouvelle);
  else musiqueVn.removeAttribute("src");
  lancerMusique();
  afficherBoutonSon();
}

function jouerSon(chemin) {
  if (!sonCoupeVn) VolumeSite.appliquer(new Audio(imageVn(chemin))).play().catch(() => {});
}

function afficherBoutonSon() {
  const bouton = elementVn("vn-couper-son");
  bouton.textContent = sonCoupeVn ? "Son coupé" : "Son activé";
  bouton.setAttribute("aria-pressed", String(sonCoupeVn));
  // Visible dès qu'un son est passé, et ensuite jusqu'à la fin de la page.
  if (cheminMusiqueVn) bouton.hidden = false;
}

function basculerSon() {
  sonCoupeVn = !sonCoupeVn;
  try { localStorage.setItem(CLE_SON_COUPE, sonCoupeVn ? "1" : "0"); } catch { /* stockage indisponible */ }
  lancerMusique();
  afficherBoutonSon();
}

// ---- Timer ----
let finTimerVn = 0;
let dureeTimerVn = 0;
let horlogeTimerVn = null;

function arreterTimer() {
  clearInterval(horlogeTimerVn);
  horlogeTimerVn = null;
  elementVn("vn-timer").hidden = true;
}

function battreTimer() {
  const restant = Math.max(0, finTimerVn - performance.now());
  elementVn("vn-timer-barre").style.width = `${dureeTimerVn ? Math.min(100, restant / (dureeTimerVn * 10)) : 0}%`;
  elementVn("vn-timer-texte").textContent = `${Math.ceil(restant / 1000)} s`;
  if (restant > 0) return;
  arreterTimer();
  appelerServeur({ action: "avancer", depuis: segmentVn.depuis, expire: true }, { reessai: true });
}

// Le serveur donne le temps restant : l'heure de l'ordinateur ne compte pas.
function lancerTimer(timer) {
  arreterTimer();
  if (!timer) return;
  finTimerVn = performance.now() + timer.restant_ms;
  dureeTimerVn = timer.duree;
  elementVn("vn-timer").hidden = false;
  battreTimer();
  if (!elementVn("vn-timer").hidden) horlogeTimerVn = setInterval(battreTimer, 200);
}

// ---- Annonces (objet reçu, malus...) ----
let minuteurAnnoncesVn = null;

function afficherAnnonces(annonces) {
  const liste = elementVn("vn-annonces");
  clearTimeout(minuteurAnnoncesVn);
  liste.hidden = !annonces?.length;
  liste.replaceChildren(...(annonces || []).map(texte => {
    const ligne = document.createElement("li");
    ligne.textContent = texte;
    return ligne;
  }));
  if (annonces?.length) minuteurAnnoncesVn = setTimeout(() => { liste.hidden = true; }, 5000);
}

// ---- Dé ----
// Le résultat vient du serveur : l'animation n'est qu'un habillage.
function afficherLancer(lancer, message) {
  afficherEcran("Lancer de dé", "", { reprendre: true, libelleReprendre: "Continuer" });
  const valeur = elementVn("vn-de-valeur");
  const detail = elementVn("vn-de-detail");
  const montrer = () => {
    valeur.textContent = lancer.total;
    detail.textContent = [`Dé : ${lancer.base}`, ...lancer.modificateurs.map(m => `${m.nom} : ${signeVn(m.valeur)}`)].join(" · ");
    elementVn("vn-ecran-texte").textContent = lancer.message || message || "";
  };
  elementVn("vn-de").hidden = false;
  elementVn("vn-ecran").classList.add("vn-ecran-opaque");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return montrer();
  detail.textContent = "";
  let tours = 0;
  const animation = setInterval(() => {
    valeur.textContent = 1 + Math.floor(Math.random() * 20);
    if (++tours < 12) return;
    clearInterval(animation);
    montrer();
  }, 70);
}

// ---- Temps de lecture minimal ----
// Avancer et répondre restent bloqués tant que le délai du panneau n'est pas
// écoulé (lecture_min, en secondes). Le ▼ s'allume quand on peut avancer.
let finLectureVn = 0;
let attenteLectureVn = null;
const lectureFinieVn = () => Date.now() >= finLectureVn;

function appliquerLecture() {
  const attente = !lectureFinieVn();
  elementVn("vn-suite").classList.toggle("vn-attente", attente);
  document.querySelectorAll("#vn-choix button, #vn-saisie button").forEach(bouton => { bouton.disabled = attente; });
}

function bloquerLecture(secondes) {
  clearTimeout(attenteLectureVn);
  finLectureVn = Date.now() + Math.max(0, secondes || 0) * 1000;
  appliquerLecture();
  if (!lectureFinieVn()) attenteLectureVn = setTimeout(appliquerLecture, finLectureVn - Date.now() + 20);
}

// lecture : true = le délai du panneau repart, false = aucun délai (Passer),
// null = celui en cours continue (on reste sur le même panneau).
function afficherPanneau({ sansSon = false, lecture = true } = {}) {
  const panneau = segmentVn.panneaux[indexVn];
  const dernier = indexVn === segmentVn.panneaux.length - 1;

  dessinerSceneVn(panneau);
  if (panneau.musique) changerMusique(panneau.musique);
  if (panneau.son && !sansSon) jouerSon(panneau.son);

  const options = dernier && segmentVn.arret.type === "choix" ? segmentVn.arret.options : [];
  elementVn("vn-choix").replaceChildren(...options.map(option => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "vn-bouton";
    remplirTexteVn(bouton, option.texte);
    const precisions = [option.de ? "lancer de dé" : "", option.objet ? `objet : ${option.objet}` : "", option.etat ? `état : ${option.etat}` : ""].filter(Boolean);
    if (precisions.length) {
      const mention = document.createElement("span");
      mention.className = "vn-mention";
      mention.textContent = ` (${precisions.join(", ")})`;
      bouton.append(mention);
    }
    bouton.addEventListener("click", () => avancerServeur(option.id));
    return bouton;
  }));
  const saisie = dernier && segmentVn.arret.type === "texte" ? segmentVn.arret : null;
  elementVn("vn-saisie").hidden = !saisie;
  if (saisie) {
    const champ = elementVn("vn-reponse");
    champ.maxLength = saisie.longueur;
    champ.placeholder = saisie.consigne || "Ta réponse";
    champ.focus({ preventScroll: true });
  }
  elementVn("vn-suite").hidden = options.length > 0 || !!saisie;
  elementVn("vn-repere").textContent = panneau.sous_chapitre;
  elementVn("vn-dialogue").hidden = false;
  if (lecture === null) appliquerLecture();
  else bloquerLecture(lecture ? panneau.lecture_min : 0);
  afficherBoutonPasser();
}

// ---- Passer ----
// Un timer en cours retient le joueur dans le segment : le serveur n'ira pas plus loin.
function afficherBoutonPasser() {
  const reste = indexVn < segmentVn.panneaux.length - 1;
  const auDela = segmentVn.arret.type === "continuer" && horlogeTimerVn === null;
  elementVn("vn-passer").hidden = !passableVn || !(reste || auDela);
}

function allerAuDernierPanneau() {
  // La musique des panneaux sautés compte : le serveur la retient aussi.
  segmentVn.panneaux.slice(indexVn + 1).forEach(panneau => { if (panneau.musique) changerMusique(panneau.musique); });
  indexVn = segmentVn.panneaux.length - 1;
  afficherPanneau({ sansSon: true, lecture: false });
}

// La suite du segment est déjà là ; au-delà, seul le serveur la connaît.
function passer() {
  if (!segmentVn || occupeVn) return;
  if (segmentVn.arret.type === "continuer" && horlogeTimerVn === null) appelerServeur({ action: "passer", depuis: segmentVn.depuis });
  else allerAuDernierPanneau();
}

// Images du segment chargées d'avance, pour ne pas voir de trou en avançant.
function prechargerImages(segment) {
  segment.panneaux.forEach(panneau => {
    [panneau.fond, ...panneau.persos.map(p => p.image)].filter(Boolean).forEach(chemin => { new Image().src = imageVn(chemin); });
  });
}

function traiterReponse(data) {
  if (data.chapitre) document.title = data.chapitre;
  sousChapitresVn = data.sous_chapitres || [];
  inventaireVn = data.inventaire || [];
  etatsVn = data.etats || [];
  passableVn = data.passable === true;
  if (data.statut !== "en_cours") {
    segmentVn = null;
    arreterTimer();
    afficherAnnonces([]);
    elementVn("vn-passer").hidden = true;
    elementVn("vn-ouvrir-menu").hidden = true;
    elementVn("vn-ouvrir-inventaire").hidden = true;
    if (data.statut === "game_over") {
      const fins = data.fins_total ? ` Fins découvertes : ${data.fins_trouvees} sur ${data.fins_total}.` : "";
      afficherEcran(data.fin ? `Game over : ${data.fin.nom}` : "Game over", `${data.fin?.message || "Ta partie s'arrête ici."}${fins}`, { recommencer: true, point: data.reprise, liste: true });
      return;
    }
    const titre = data.fin ? `Fin : ${data.fin.nom}` : data.chapitre;
    const progression = `Chapitre terminé. Fins découvertes : ${data.fins_trouvees} sur ${data.fins_total}.`;
    afficherEcran(titre, progression, { recommencer: true, liste: true });
    return;
  }
  // Mauvaise réponse ou timer sans suite : on reste où l'on en est.
  const surPlace = data.reste && segmentVn?.depuis === data.segment.depuis;
  segmentVn = data.segment;
  if (!surPlace) indexVn = 0;
  indexVn = Math.min(indexVn, segmentVn.panneaux.length - 1);
  prechargerImages(segmentVn);
  elementVn("vn-ecran").hidden = true;
  elementVn("vn-ouvrir-menu").hidden = false;
  elementVn("vn-ouvrir-inventaire").hidden = false;
  if (!surPlace) {
    elementVn("vn-reponse").value = "";
    // Musique en cours côté serveur, sauf si ce panneau en lance une autre : sans
    // ce détour, elle redémarrerait pour rien.
    changerMusique(segmentVn.panneaux[0].musique || data.musique);
  }
  if (data.passe) {
    allerAuDernierPanneau();
  } else {
    afficherPanneau({ sansSon: surPlace, lecture: surPlace ? null : true });
  }
  const refus = elementVn("vn-refus");
  refus.hidden = !(data.reste && data.message);
  refus.textContent = data.reste ? data.message || "" : "";
  lancerTimer(data.timer);
  afficherBoutonPasser();
  afficherAnnonces(data.annonces);
  if (data.lancer) afficherLancer(data.lancer, data.message);
  else if (data.message && !data.reste) afficherEcran("", data.message, { reprendre: true, libelleReprendre: "Continuer" });
}

// reessai : appel lancé par le timer, à ne pas perdre si un autre est en cours.
async function appelerServeur(corps, { reessai = false } = {}) {
  if (occupeVn) {
    if (reessai) setTimeout(() => { if (segmentVn?.depuis === corps.depuis) appelerServeur(corps, { reessai }); }, 300);
    return;
  }
  occupeVn = true;
  try {
    const reponse = await fetch("/api/points", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vn: { chapitre: chapitreVn, ...corps } })
    });
    const data = await reponse.json().catch(() => ({}));
    if (reponse.status === 401) return afficherEcran("Connexion nécessaire", "Connecte-toi avec Discord pour lire cette histoire.");
    if (!reponse.ok) return afficherEcran(data.titre || "Lecture impossible", data.error || "Réessaie dans un instant.");
    traiterReponse(data);
  } catch (erreur) {
    console.error(erreur);
    afficherEcran("Lecture impossible", "Connexion perdue : recharge la page pour reprendre où tu en étais.");
  } finally {
    occupeVn = false;
  }
}

const avancerServeur = option => appelerServeur({ action: "avancer", depuis: segmentVn.depuis, ...(option ? { option } : {}) });

// Panneau suivant, ou serveur à la fin du segment (sauf choix : boutons).
function avancer() {
  if (!segmentVn || occupeVn || !lectureFinieVn()) return;
  if (indexVn < segmentVn.panneaux.length - 1) {
    indexVn++;
    afficherPanneau();
  } else if (segmentVn.arret.type === "incomplet") {
    afficherEcran("À suivre", "La suite de ce passage n'est pas encore écrite.", { reprendre: true });
  } else if (segmentVn.arret.type !== "choix") {
    avancerServeur();
  }
}

elementVn("vn-cadre").addEventListener("click", event => {
  if (!event.target.closest("a, button, form") && elementVn("vn-ecran").hidden) avancer();
});
document.addEventListener("click", () => { if (musiqueEnAttenteVn) lancerMusique(); });
document.addEventListener("keydown", event => {
  if (musiqueEnAttenteVn) lancerMusique();
  if (![" ", "Enter", "ArrowRight"].includes(event.key) || event.target.closest("a, button, form") || !elementVn("vn-ecran").hidden) return;
  event.preventDefault();
  avancer();
});
elementVn("vn-saisie").addEventListener("submit", event => {
  event.preventDefault();
  const reponse = elementVn("vn-reponse").value.trim();
  if (reponse && lectureFinieVn()) appelerServeur({ action: "avancer", depuis: segmentVn.depuis, reponse });
});
elementVn("vn-passer").addEventListener("click", passer);
elementVn("vn-ouvrir-menu").addEventListener("click", ouvrirMenuSousChapitres);
elementVn("vn-ouvrir-inventaire").addEventListener("click", ouvrirInventaire);
elementVn("vn-couper-son").addEventListener("click", basculerSon);
elementVn("vn-point").addEventListener("click", () => appelerServeur({ action: "reprendre" }));
elementVn("vn-reprendre").addEventListener("click", () => { elementVn("vn-ecran").hidden = true; });
elementVn("vn-recommencer").addEventListener("click", () => appelerServeur({ action: "recommencer" }));

if (chapitreVn) {
  appelerServeur({ action: "ouvrir", ...(panneauTestVn ? { panneau: panneauTestVn } : {}) });
  // Recharger la page reprend la partie, sans revenir au panneau testé.
  if (panneauTestVn) history.replaceState(null, "", `?chapitre=${encodeURIComponent(chapitreVn)}`);
}
else afficherEcran("Chapitre introuvable", "Choisis un chapitre depuis la page Événements.");
