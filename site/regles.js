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

document.querySelectorAll(".sommaire-actions [data-tout]").forEach(bouton => {
  bouton.addEventListener("click", () => {
    const ouvrir = bouton.dataset.tout === "ouvrir";
    document.querySelectorAll(".section-regles").forEach(section => { section.open = ouvrir; });
  });
});

ouvrirSection(decodeURIComponent(location.hash.slice(1)));
