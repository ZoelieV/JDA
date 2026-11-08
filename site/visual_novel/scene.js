// Dessin d'un panneau, commun au lecteur et à l'aperçu de l'éditeur (éléments
// vn-fond, vn-persos, vn-nom et vn-texte de la page). Textes écrits avec
// textContent uniquement : rien de ce qu'ils contiennent n'est interprété.
const FAMILLES_VN = Object.fromEntries(POLICES_VN.map(p => [p.id, p.famille]));
const imageVn = chemin => encodeURI(`/DB/images/${chemin}`);

// **gras**, *italique*, ~~barré~~, {7}taille{/} (cf. decouperTexteVn).
function remplirTexteVn(element, texte) {
  element.replaceChildren(...decouperTexteVn(texte).map(morceau => {
    const span = document.createElement("span");
    span.textContent = morceau.texte;
    if (morceau.gras) span.classList.add("vn-gras");
    if (morceau.italique) span.style.fontStyle = "italic";
    if (morceau.barre) span.classList.add("vn-barre");
    if (morceau.taille !== null) {
      span.classList.add("vn-taille");
      span.style.setProperty("--taille-vn", morceau.taille);
    }
    return span;
  }));
}

// Polices importées par l'admin, chargées une fois chacune.
const policesChargeesVn = new Map();
function familleImporteeVn(id, chemin) {
  const famille = `VN import ${id}`;
  if (!policesChargeesVn.has(chemin)) {
    const police = new FontFace(famille, `url("${imageVn(chemin)}")`, { display: "swap" });
    policesChargeesVn.set(chemin, police);
    document.fonts.add(police);
    police.load().catch(erreur => console.error("Police du visual novel introuvable", chemin, erreur));
  }
  return famille;
}

// Grisé (personnage en retrait) et ombre (100 % : silhouette noire), de 0 à 100.
function filtrePersoVn(perso) {
  const gris = Math.min(100, Math.max(0, Number(perso.gris) || 0));
  const ombre = Math.min(100, Math.max(0, Number(perso.ombre) || 0));
  if (!gris && !ombre) return "";
  const luminosite = (1 - 0.45 * gris / 100) * (1 - ombre / 100);
  return `grayscale(${gris}%) brightness(${Math.round(luminosite * 1000) / 1000})`;
}

function imagePersoVn(perso) {
  const image = document.createElement("img");
  image.className = "vn-perso";
  image.alt = "";
  image.src = imageVn(perso.image);
  image.draggable = false;
  image.style.left = `${perso.x}%`;
  image.style.bottom = `${perso.y}%`;
  image.style.height = `${perso.hauteur}%`;
  image.classList.toggle("vn-miroir", perso.miroir === true);
  image.style.filter = filtrePersoVn(perso);
  return image;
}

// importees : polices importées de l'histoire (éditeur) ; le lecteur reçoit
// directement le fichier dans panneau.police.fichier.
function dessinerSceneVn(panneau, importees = []) {
  const fond = document.getElementById("vn-fond");
  fond.hidden = !panneau.fond;
  if (panneau.fond && fond.getAttribute("src") !== imageVn(panneau.fond)) fond.src = imageVn(panneau.fond);

  document.getElementById("vn-persos").replaceChildren(...(panneau.persos || []).map(imagePersoVn));

  const nom = document.getElementById("vn-nom");
  nom.textContent = panneau.nom || "";
  nom.hidden = !panneau.nom;

  const fichier = panneau.police?.fichier || importees.find(p => p.id === panneau.police?.famille)?.chemin;
  const police = lirePoliceVn(panneau.police, fichier ? [{ id: panneau.police.famille }] : []);
  const texte = document.getElementById("vn-texte");
  remplirTexteVn(texte, panneau.texte || "");
  const famille = fichier ? familleImporteeVn(police.famille, fichier) : FAMILLES_VN[police.famille];
  texte.style.fontFamily = `"${famille}", var(--police-texte)`;
  texte.style.setProperty("--taille-vn", police.taille);
  texte.dataset.famille = police.famille;
  texte.classList.toggle("vn-gras", police.gras);
  texte.style.fontStyle = police.italique ? "italic" : "normal";
}
