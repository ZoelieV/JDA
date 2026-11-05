// Dessin d'un panneau, commun au lecteur et à l'aperçu de l'éditeur (éléments
// vn-fond, vn-persos, vn-nom et vn-texte de la page). Textes écrits avec
// textContent uniquement : rien de ce qu'ils contiennent n'est interprété.
const FAMILLES_VN = Object.fromEntries(POLICES_VN.map(p => [p.id, p.famille]));
const imageVn = chemin => encodeURI(`/DB/images/${chemin}`);

// **gras**, *italique*, ~~barré~~ (cf. decouperTexteVn).
function remplirTexteVn(element, texte) {
  element.replaceChildren(...decouperTexteVn(texte).map(morceau => {
    const span = document.createElement("span");
    span.textContent = morceau.texte;
    if (morceau.gras) span.classList.add("vn-gras");
    if (morceau.italique) span.style.fontStyle = "italic";
    if (morceau.barre) span.classList.add("vn-barre");
    return span;
  }));
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
  return image;
}

function dessinerSceneVn(panneau) {
  const fond = document.getElementById("vn-fond");
  fond.hidden = !panneau.fond;
  if (panneau.fond && fond.getAttribute("src") !== imageVn(panneau.fond)) fond.src = imageVn(panneau.fond);

  document.getElementById("vn-persos").replaceChildren(...(panneau.persos || []).map(imagePersoVn));

  const nom = document.getElementById("vn-nom");
  nom.textContent = panneau.nom || "";
  nom.hidden = !panneau.nom;

  const police = lirePoliceVn(panneau.police);
  const texte = document.getElementById("vn-texte");
  remplirTexteVn(texte, panneau.texte || "");
  texte.style.fontFamily = `"${FAMILLES_VN[police.famille]}", var(--police-texte)`;
  texte.style.setProperty("--taille-vn", police.taille);
  texte.dataset.famille = police.famille;
  texte.classList.toggle("vn-gras", police.gras);
  texte.style.fontStyle = police.italique ? "italic" : "normal";
}
