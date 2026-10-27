// Litiges et signalements (matchs invalidés à corriger, sanctions) : la page
// /admin/litiges (historique/historique.html, cf. PAGE_LITIGES dans
// historique.js) dans une fenêtre, chargée à la 1re ouverture. Ouverte
// d'office avec /admin?litiges=1 (menu Admin de l'en-tête, adresse
// /admin/litiges ouverte directement).

function initialiserLitiges() {
  const modal = document.getElementById("modal-litiges");
  const cadre = document.getElementById("cadre-litiges");
  const ouvrir = () => {
    if (!cadre.getAttribute("src")) cadre.src = "/admin/litiges";
    modal.classList.add("active");
  };
  const fermer = () => modal.classList.remove("active");
  document.getElementById("ouvrir-litiges").addEventListener("click", ouvrir);
  document.getElementById("fermer-litiges").addEventListener("click", fermer);
  modal.addEventListener("click", event => {
    if (event.target === modal) fermer();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("active")) fermer();
  });
  if (new URLSearchParams(window.location.search).get("litiges") === "1") ouvrir();
}
initialiserLitiges();
