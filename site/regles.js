// Pages de règles : sections repliables (<details>, dépliées par défaut)
// et sommaire.
// Un lien du sommaire (ou une adresse avec #section) déplie la section
// visée avant d'y aller.

function ouvrirSection(id) {
  const section = id && document.getElementById(id);
  if (!section || section.tagName !== "DETAILS") return;
  section.open = true;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll(".sommaire-regles a[href^='#']").forEach(lien => {
  lien.addEventListener("click", event => {
    event.preventDefault();
    const id = lien.getAttribute("href").slice(1);
    history.replaceState(null, "", "#" + id);
    ouvrirSection(id);
  });
});

// Bouton unique : "Tout replier" si tout est déplié, sinon "Tout déplier".
const sectionsRegles = document.querySelectorAll(".section-regles");
const boutonTout = document.querySelector(".sommaire-actions .btn-tout");

function toutEstOuvert() {
  return [...sectionsRegles].every(section => section.open);
}

function majBoutonTout() {
  if (boutonTout) boutonTout.textContent = toutEstOuvert() ? "Tout replier" : "Tout déplier";
}

boutonTout?.addEventListener("click", () => {
  const ouvrir = !toutEstOuvert();
  sectionsRegles.forEach(section => { section.open = ouvrir; });
});

sectionsRegles.forEach(section => section.addEventListener("toggle", majBoutonTout));
majBoutonTout();

ouvrirSection(decodeURIComponent(location.hash.slice(1)));
