// Lecteur du visual novel : affiche les panneaux envoyés par le serveur
// (cf. api/_lib/visual_novel.js) et lui demande la suite à chaque arrêt.
const chapitreVn = new URLSearchParams(location.search).get("chapitre");
const elementVn = id => document.getElementById(id);
const FAMILLES_VN = Object.fromEntries(POLICES_VN.map(p => [p.id, p.famille]));

let segmentVn = null;
let indexVn = 0;
let occupeVn = false;

const imageVn = chemin => encodeURI(`/DB/images/${chemin}`);

function afficherEcran(titre, texte, { recommencer = false } = {}) {
  elementVn("vn-ecran-titre").textContent = titre;
  elementVn("vn-ecran-texte").textContent = texte;
  elementVn("vn-recommencer").hidden = !recommencer;
  elementVn("vn-ecran").hidden = false;
}

function afficherPanneau() {
  const panneau = segmentVn.panneaux[indexVn];
  const dernier = indexVn === segmentVn.panneaux.length - 1;

  const fond = elementVn("vn-fond");
  fond.hidden = !panneau.fond;
  if (panneau.fond && fond.getAttribute("src") !== imageVn(panneau.fond)) fond.src = imageVn(panneau.fond);

  elementVn("vn-persos").replaceChildren(...panneau.persos.map(perso => {
    const image = document.createElement("img");
    image.className = "vn-perso";
    image.alt = "";
    image.src = imageVn(perso.image);
    image.style.left = `${perso.x}%`;
    image.style.bottom = `${perso.y}%`;
    image.style.height = `${perso.hauteur}%`;
    image.classList.toggle("vn-miroir", perso.miroir);
    return image;
  }));

  elementVn("vn-nom").textContent = panneau.nom;
  elementVn("vn-nom").hidden = !panneau.nom;
  const texte = elementVn("vn-texte");
  texte.textContent = panneau.texte;
  texte.style.fontFamily = `"${FAMILLES_VN[panneau.police.famille]}", var(--police-texte)`;
  texte.style.setProperty("--taille-vn", panneau.police.taille);
  texte.style.fontWeight = panneau.police.gras ? "700" : "400";
  texte.style.fontStyle = panneau.police.italique ? "italic" : "normal";

  const options = dernier && segmentVn.arret.type === "choix" ? segmentVn.arret.options : [];
  elementVn("vn-choix").replaceChildren(...options.map(option => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "vn-bouton";
    bouton.textContent = option.texte;
    bouton.addEventListener("click", () => avancerServeur(option.id));
    return bouton;
  }));
  elementVn("vn-suite").hidden = options.length > 0;
  elementVn("vn-repere").textContent = panneau.sous_chapitre;
  elementVn("vn-dialogue").hidden = false;
}

// Images du segment chargées d'avance, pour ne pas voir de trou en avançant.
function prechargerImages(segment) {
  segment.panneaux.forEach(panneau => {
    [panneau.fond, ...panneau.persos.map(p => p.image)].filter(Boolean).forEach(chemin => { new Image().src = imageVn(chemin); });
  });
}

function traiterReponse(data) {
  if (data.chapitre) document.title = data.chapitre;
  if (data.statut === "terminee") {
    segmentVn = null;
    const titre = data.fin ? `Fin : ${data.fin.nom}` : data.chapitre;
    const progression = `Chapitre terminé. Fins découvertes : ${data.fins_trouvees} sur ${data.fins_total}.`;
    afficherEcran(titre, progression, { recommencer: true });
    return;
  }
  segmentVn = data.segment;
  indexVn = 0;
  prechargerImages(segmentVn);
  elementVn("vn-ecran").hidden = true;
  afficherPanneau();
}

async function appelerServeur(corps) {
  if (occupeVn) return;
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
    if (!reponse.ok) return afficherEcran("Lecture impossible", data.error || "Réessaie dans un instant.");
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
  if (!segmentVn || occupeVn) return;
  if (indexVn < segmentVn.panneaux.length - 1) {
    indexVn++;
    afficherPanneau();
  } else if (segmentVn.arret.type !== "choix") {
    avancerServeur();
  }
}

elementVn("vn-cadre").addEventListener("click", event => {
  if (!event.target.closest("a, button") && elementVn("vn-ecran").hidden) avancer();
});
document.addEventListener("keydown", event => {
  if (![" ", "Enter", "ArrowRight"].includes(event.key) || event.target.closest("a, button") || !elementVn("vn-ecran").hidden) return;
  event.preventDefault();
  avancer();
});
elementVn("vn-recommencer").addEventListener("click", () => appelerServeur({ action: "recommencer" }));

if (chapitreVn) appelerServeur({ action: "ouvrir" });
else afficherEcran("Chapitre introuvable", "Choisis un chapitre depuis la page Événements.");
